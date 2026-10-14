import { z } from 'zod';
import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import { AlertChannel } from '../models/AlertChannel.js';
import { Monitor } from '../models/Monitor.js';
import { AppError } from '../utils/AppError.js';
import { sealChannelTarget, openChannelTarget, maskChannelTarget } from '../services/secrets.js';
import { audit } from '../services/audit.js';
import { validateUrlSSRF } from '../utils/ssrf.js';
import { providers } from '../services/alertProviders/index.js';
import { limitsFor } from '../config/plans.js';

// Discord/Slack webhooks must point at the vendor — never at an arbitrary host the server would POST to.
const TARGET_RULES = {
  email: {
    test: (t) => z.string().email().safeParse(t).success,
    message: 'Enter a valid email address',
  },
  discord: {
    test: (t) => /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(t),
    message: 'Discord webhooks look like https://discord.com/api/webhooks/{id}/{token}',
  },
  slack: {
    test: (t) => /^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/.test(t),
    message: 'Slack webhooks look like https://hooks.slack.com/services/T000/B000/XXXX',
  },
  webhook: {
    test: (t) => {
      try {
        const u = new URL(t);
        return u.protocol === 'https:' || u.protocol === 'http:';
      } catch {
        return false;
      }
    },
    message: 'Enter a full http(s) URL',
  },
};

const channelSchema = z.object({
  type: z.enum(['email', 'discord', 'slack', 'webhook']),
  label: z.string().trim().min(1, 'Label is required').max(60),
  target: z.string().trim().min(1, 'Target is required').max(500),
});

const updateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  isActive: z.boolean().optional(),
});

const testSchema = z.object({
  message: z.string().trim().max(300).optional(),
});

const toPublic = (channel, plainTarget) => {
  const obj = channel.toObject();
  obj.target = maskChannelTarget(channel, plainTarget);
  delete obj.secretEncrypted;
  delete obj.__v;
  return obj;
};

const findOwned = async (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return AlertChannel.findOne({ _id: req.params.id, workspaceId: req.workspace._id });
};

export const createChannel = asyncHandler(async (req, res, next) => {
  const parsed = channelSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new AppError('Invalid input data', 400, parsed.error.format()));
  }

  const { type, label, target } = parsed.data;
  const rule = TARGET_RULES[type];
  if (!rule.test(target)) {
    return next(new AppError(rule.message, 400));
  }

  if (type === 'webhook') {
    const ssrf = await validateUrlSSRF(target);
    if (!ssrf.isValid) return next(new AppError(`Security Error: ${ssrf.error}`, 400));
  }

  const max = limitsFor(req.workspace).channels;
  const count = await AlertChannel.countDocuments({ workspaceId: req.workspace._id });
  if (count >= max) {
    return next(new AppError(`Your plan allows up to ${max} alert channels.`, 403));
  }

  // Targets are secrets (webhook URLs carry tokens) — only the encrypted form is stored.
  const channel = new AlertChannel({
    workspaceId: req.workspace._id,
    userId: req.user._id,
    type,
    label,
  });
  sealChannelTarget(channel, target); // bound to this workspace + channel id
  await channel.save();
  audit(req, 'channel.created', { targetType: 'channel', targetId: channel._id, targetName: `${type}: ${label}` });

  res.status(201).json({ success: true, data: { channel: toPublic(channel, target) } });
});

export const getChannels = asyncHandler(async (req, res) => {
  const channels = await AlertChannel.find({ workspaceId: req.workspace._id }).sort({ createdAt: -1 });

  // How many monitors route to each channel — handy for the UI.
  const usage = await Monitor.aggregate([
    { $match: { workspaceId: req.workspace._id } },
    { $unwind: '$alertChannelIds' },
    { $group: { _id: '$alertChannelIds', count: { $sum: 1 } } },
  ]);
  const usageMap = Object.fromEntries(usage.map((u) => [u._id.toString(), u.count]));

  res.status(200).json({
    success: true,
    data: {
      channels: channels.map((c) => ({ ...toPublic(c), monitorCount: usageMap[c._id.toString()] || 0 })),
    },
  });
});

export const updateChannel = asyncHandler(async (req, res, next) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new AppError('Invalid input data', 400, parsed.error.format()));
  }

  const channel = await findOwned(req);
  if (!channel) return next(new AppError('Channel not found', 404));

  Object.assign(channel, parsed.data);
  await channel.save();
  audit(req, 'channel.updated', { targetType: 'channel', targetId: channel._id, targetName: channel.label, meta: parsed.data });

  res.status(200).json({ success: true, data: { channel: toPublic(channel) } });
});

export const deleteChannel = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return next(new AppError('Channel not found', 404));
  const channel = await AlertChannel.findOneAndDelete({ _id: req.params.id, workspaceId: req.workspace._id });
  if (!channel) return next(new AppError('Channel not found', 404));

  // Cascade: detach from every monitor that referenced it.
  await Monitor.updateMany(
    { workspaceId: req.workspace._id, alertChannelIds: channel._id },
    { $pull: { alertChannelIds: channel._id } }
  );

  audit(req, 'channel.deleted', { targetType: 'channel', targetId: channel._id, targetName: channel.label });
  res.status(204).end();
});

export const testChannel = asyncHandler(async (req, res, next) => {
  const parsed = testSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return next(new AppError('Invalid input data', 400, parsed.error.format()));
  }

  const channel = await findOwned(req);
  if (!channel) return next(new AppError('Channel not found', 404));

  const provider = providers[channel.type];
  if (!provider) return next(new AppError(`No provider for type ${channel.type}`, 400));

  const target = openChannelTarget(channel);
  if (!target) return next(new AppError('Stored channel secret could not be decrypted. Re-create this channel.', 422));

  const startedAt = Date.now();
  const result = await provider.send(
    {
      channel: { ...channel.toObject(), target },
      event: 'TEST',
      monitor: { name: 'PulseWatch test', url: 'https://pulsewatch.dev' },
      incident: { cause: parsed.data.message || null, startedAt: new Date() },
    },
    { maxAttempts: 1 } // the user is waiting on this — fail fast
  );

  channel.lastTestedAt = new Date();
  channel.lastTestOk = result.ok;
  channel.lastError = result.ok ? null : String(result.error || 'Unknown error').slice(0, 300);
  if (result.ok) channel.isVerified = true;
  await channel.save();

  res.status(200).json({
    success: true,
    data: {
      ok: result.ok,
      error: result.ok ? null : channel.lastError,
      latencyMs: Date.now() - startedAt,
      channel: toPublic(channel, target),
    },
  });
});
