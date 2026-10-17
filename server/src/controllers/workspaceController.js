import { z } from 'zod';
import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import { Workspace } from '../models/Workspace.js';
import { Membership, ROLE_RANK } from '../models/Membership.js';
import { Invitation } from '../models/Invitation.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { createToken, hashToken } from '../utils/tokens.js';
import { sendMail } from '../services/mailer.js';
import { inviteTemplate } from '../services/email/templates.js';
import { createWorkspaceFor, isSlugAllowed, listWorkspacesFor, serializeWorkspace, hasRole } from '../services/workspaceService.js';
import { deleteWorkspaceCascade } from '../services/workspaceCleanup.js';
import { limitsFor, effectivePlanId } from '../config/plans.js';
import { sessionPayload } from './authController.js';
import { env } from '../config/env.js';
import { AuditLog } from '../models/AuditLog.js';
import { audit } from '../services/audit.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OWNED_WORKSPACES = 10;

const firstIssue = (parsed) => parsed.error.issues[0]?.message || 'Invalid input data';

/* ─────────────── workspaces ─────────────── */

export const listWorkspaces = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { workspaces: await listWorkspacesFor(req.user._id) } });
});

export const createWorkspace = asyncHandler(async (req, res, next) => {
  const parsed = z.object({ name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80) }).safeParse(req.body);
  if (!parsed.success) return next(new AppError(firstIssue(parsed), 400));
  const owned = await Workspace.countDocuments({ ownerId: req.user._id });
  if (owned >= MAX_OWNED_WORKSPACES) return next(new AppError(`You can own up to ${MAX_OWNED_WORKSPACES} workspaces.`, 403));
  await createWorkspaceFor(req.user, parsed.data.name);
  res.status(201).json({ success: true, data: await sessionPayload(req.user) });
});

export const switchWorkspace = asyncHandler(async (req, res, next) => {
  const id = req.body?.workspaceId;
  if (!mongoose.isValidObjectId(id)) return next(new AppError('Workspace not found', 404));
  const membership = await Membership.findOne({ userId: req.user._id, workspaceId: id });
  if (!membership) return next(new AppError('You are not a member of that workspace', 403));
  req.user.currentWorkspaceId = membership.workspaceId;
  await User.updateOne({ _id: req.user._id }, { $set: { currentWorkspaceId: membership.workspaceId } });
  res.json({ success: true, data: await sessionPayload(req.user) });
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  slug: z.string().trim().toLowerCase().max(40).optional(),
  statusPageEnabled: z.boolean().optional(),
  require2FA: z.boolean().optional(),
});

export const updateWorkspace = asyncHandler(async (req, res, next) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError(firstIssue(parsed), 400));
  const { name, slug, statusPageEnabled, require2FA } = parsed.data;
  const changed = {};

  if (require2FA !== undefined && require2FA !== Boolean(req.workspace.require2FA)) {
    if (req.membership.role !== 'owner') return next(new AppError('Only the owner can change the two-factor policy', 403));
    if (require2FA && !req.user.totpEnabled) {
      return next(new AppError('Turn on two-factor authentication for your own account first.', 409));
    }
    req.workspace.require2FA = require2FA;
    changed.require2FA = require2FA;
  }
  if (statusPageEnabled !== undefined && statusPageEnabled !== Boolean(req.workspace.statusPageEnabled)) {
    req.workspace.statusPageEnabled = statusPageEnabled;
    changed.statusPageEnabled = statusPageEnabled;
  }

  if (slug !== undefined && slug !== req.workspace.slug) {
    if (!isSlugAllowed(slug)) {
      return next(new AppError('Use 3–40 lowercase letters, numbers or dashes (not starting or ending with a dash). Some words are reserved.', 400));
    }
    if (await Workspace.exists({ slug, _id: { $ne: req.workspace._id } })) {
      return next(new AppError('That status page address is taken', 409));
    }
    req.workspace.slug = slug;
    changed.slug = slug;
  }
  if (name && name !== req.workspace.name) {
    req.workspace.name = name;
    changed.name = name;
  }
  await req.workspace.save();
  if (Object.keys(changed).length) audit(req, 'workspace.updated', { targetType: 'workspace', targetId: req.workspace._id, targetName: req.workspace.name, meta: changed });

  res.json({ success: true, data: { workspace: serializeWorkspace(req.workspace, req.membership.role) } });
});

export const deleteWorkspace = asyncHandler(async (req, res, next) => {
  const confirm = String(req.body?.confirm || '').trim();
  if (confirm !== req.workspace.name) {
    return next(new AppError('Type the workspace name exactly to confirm deletion', 400));
  }
  audit(req, 'workspace.deleted', { workspaceId: null, targetType: 'workspace', targetId: req.workspace._id, targetName: req.workspace.name });
  await deleteWorkspaceCascade(req.workspace._id);
  res.json({ success: true, data: await sessionPayload(req.user) });
});

/* ─────────────── members ─────────────── */

export const listMembers = asyncHandler(async (req, res) => {
  const memberships = await Membership.find({ workspaceId: req.workspace._id }).lean();
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).select('name email emailVerified lastLoginAt').lean();
  const userById = Object.fromEntries(users.map((u) => [u._id.toString(), u]));

  const members = memberships
    .map((m) => {
      const u = userById[m.userId.toString()];
      return u && { userId: u._id, name: u.name, email: u.email, role: m.role, joinedAt: m.createdAt, lastLoginAt: u.lastLoginAt };
    })
    .filter(Boolean)
    .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || new Date(a.joinedAt) - new Date(b.joinedAt));

  const invitations = hasRole(req.membership, 'admin')
    ? (await Invitation.find({ workspaceId: req.workspace._id, acceptedAt: null }).sort({ createdAt: -1 }).lean()).map((i) => ({
        _id: i._id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt,
        expired: i.expiresAt < new Date(),
        createdAt: i.createdAt,
      }))
    : [];

  res.json({ success: true, data: { members, invitations, limit: limitsFor(req.workspace).members } });
});

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  role: z.enum(['admin', 'member']).default('member'),
});

const sendInviteEmail = async (req, invitation, token) =>
  sendMail({
    to: invitation.email,
    ...inviteTemplate({ inviterName: req.user.name, workspaceName: req.workspace.name, role: invitation.role, token }),
  });

export const inviteMember = asyncHandler(async (req, res, next) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError(firstIssue(parsed), 400));
  const { email, role } = parsed.data;

  // Only owners may create admins.
  if (role === 'admin' && req.membership.role !== 'owner') {
    return next(new AppError('Only the workspace owner can invite admins', 403));
  }

  const existingUser = await User.findOne({ email }).select('_id');
  if (existingUser && (await Membership.exists({ workspaceId: req.workspace._id, userId: existingUser._id }))) {
    return next(new AppError(`${email} is already a member of this workspace`, 409));
  }

  const limit = limitsFor(req.workspace).members;
  const [members, pending] = await Promise.all([
    Membership.countDocuments({ workspaceId: req.workspace._id }),
    Invitation.countDocuments({ workspaceId: req.workspace._id, acceptedAt: null, expiresAt: { $gt: new Date() }, email: { $ne: email } }),
  ]);
  if (members + pending >= limit) {
    return next(new AppError(`Your ${effectivePlanId(req.workspace)} plan allows ${limit} members (including pending invitations). Upgrade to add more.`, 403));
  }

  const { token, hash } = createToken();
  // Re-inviting the same address replaces the old link.
  await Invitation.deleteMany({ workspaceId: req.workspace._id, email, acceptedAt: null });
  const invitation = await Invitation.create({
    workspaceId: req.workspace._id,
    email,
    role,
    tokenHash: hash,
    invitedBy: req.user._id,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  const mail = await sendInviteEmail(req, invitation, token);
  audit(req, 'member.invited', { targetType: 'invitation', targetId: invitation._id, targetName: email, meta: { role } });

  res.status(201).json({
    success: true,
    data: {
      invitation: { _id: invitation._id, email, role, expiresAt: invitation.expiresAt, expired: false, createdAt: invitation.createdAt },
      emailSent: mail.ok,
      // Lets an admin share the link manually if email delivery isn't set up yet.
      inviteUrl: `${env.APP_URL}/invite/${token}`,
    },
  });
});

export const resendInvite = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.inviteId)) return next(new AppError('Invitation not found', 404));
  const invitation = await Invitation.findOne({ _id: req.params.inviteId, workspaceId: req.workspace._id, acceptedAt: null });
  if (!invitation) return next(new AppError('Invitation not found', 404));
  const { token, hash } = createToken();
  invitation.tokenHash = hash;
  invitation.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await invitation.save();
  const mail = await sendInviteEmail(req, invitation, token);
  res.json({
    success: true,
    data: { emailSent: mail.ok, expiresAt: invitation.expiresAt, inviteUrl: `${env.APP_URL}/invite/${token}` },
  });
});

export const revokeInvite = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.inviteId)) return next(new AppError('Invitation not found', 404));
  const result = await Invitation.deleteOne({ _id: req.params.inviteId, workspaceId: req.workspace._id, acceptedAt: null });
  if (!result.deletedCount) return next(new AppError('Invitation not found', 404));
  audit(req, 'member.invite_revoked', { targetType: 'invitation', targetId: req.params.inviteId });
  res.status(204).end();
});

export const changeMemberRole = asyncHandler(async (req, res, next) => {
  const parsed = z.object({ role: z.enum(['admin', 'member']) }).safeParse(req.body);
  if (!parsed.success) return next(new AppError('Role must be admin or member', 400));
  if (!mongoose.isValidObjectId(req.params.userId)) return next(new AppError('Member not found', 404));

  const target = await Membership.findOne({ workspaceId: req.workspace._id, userId: req.params.userId });
  if (!target) return next(new AppError('Member not found', 404));
  if (target.role === 'owner') return next(new AppError('Transfer ownership to change the owner’s role', 400));

  target.role = parsed.data.role;
  await target.save();
  audit(req, 'member.role_changed', { targetType: 'user', targetId: target.userId, meta: { role: target.role } });
  res.json({ success: true, data: { userId: target.userId, role: target.role } });
});

export const removeMember = asyncHandler(async (req, res, next) => {
  const leaving = req.params.userId === 'me' || req.params.userId === req.user._id.toString();
  const userId = leaving ? req.user._id : req.params.userId;
  if (!mongoose.isValidObjectId(userId)) return next(new AppError('Member not found', 404));

  const target = await Membership.findOne({ workspaceId: req.workspace._id, userId });
  if (!target) return next(new AppError('Member not found', 404));
  if (target.role === 'owner') {
    return next(new AppError(leaving ? 'Owners can’t leave — transfer ownership or delete the workspace.' : 'The owner can’t be removed', 400));
  }
  if (!leaving) {
    // Admins can remove members; only the owner can remove admins.
    const needed = target.role === 'admin' ? 'owner' : 'admin';
    if (!hasRole(req.membership, needed)) return next(new AppError('You don’t have permission to remove this member', 403));
  }

  await target.deleteOne();
  audit(req, leaving ? 'member.left' : 'member.removed', { targetType: 'user', targetId: userId });
  await User.updateOne({ _id: userId, currentWorkspaceId: req.workspace._id }, { $set: { currentWorkspaceId: null } });

  if (leaving) return res.json({ success: true, data: await sessionPayload(req.user) });
  res.status(204).end();
});

export const transferOwnership = asyncHandler(async (req, res, next) => {
  const userId = req.body?.userId;
  if (!mongoose.isValidObjectId(userId) || userId === req.user._id.toString()) return next(new AppError('Choose another member', 400));
  const target = await Membership.findOne({ workspaceId: req.workspace._id, userId });
  if (!target) return next(new AppError('Member not found', 404));

  target.role = 'owner';
  await target.save();
  await Membership.updateOne({ _id: req.membership._id }, { $set: { role: 'admin' } });
  req.workspace.ownerId = target.userId;
  await req.workspace.save();
  audit(req, 'workspace.ownership_transferred', { targetType: 'user', targetId: target.userId });

  res.json({ success: true, data: await sessionPayload(req.user) });
});

/* ─────────────── invitation links (public lookup + accept) ─────────────── */

const findLiveInvite = (token) =>
  Invitation.findOne({ tokenHash: hashToken(token), acceptedAt: null });

export const getInvitation = asyncHandler(async (req, res, next) => {
  const invitation = await findLiveInvite(req.params.token);
  if (!invitation) return next(new AppError('This invitation is invalid or was already used.', 404));
  const [workspace, inviter, existing] = await Promise.all([
    Workspace.findById(invitation.workspaceId).select('name'),
    User.findById(invitation.invitedBy).select('name'),
    User.exists({ email: invitation.email }),
  ]);
  if (!workspace) return next(new AppError('This workspace no longer exists.', 404));
  res.json({
    success: true,
    data: {
      workspaceName: workspace.name,
      inviterName: inviter?.name || 'A teammate',
      email: invitation.email,
      role: invitation.role,
      expired: invitation.expiresAt < new Date(),
      hasAccount: Boolean(existing),
    },
  });
});

export const acceptInvitation = asyncHandler(async (req, res, next) => {
  const invitation = await findLiveInvite(req.params.token);
  if (!invitation) return next(new AppError('This invitation is invalid or was already used.', 404));
  if (invitation.expiresAt < new Date()) return next(new AppError('This invitation has expired. Ask for a new one.', 410));
  if (invitation.email !== req.user.email) {
    return next(new AppError(`This invitation is for ${invitation.email}, but you're signed in as ${req.user.email}.`, 403));
  }
  if (!(await Workspace.exists({ _id: invitation.workspaceId }))) return next(new AppError('This workspace no longer exists.', 404));

  await Membership.updateOne(
    { workspaceId: invitation.workspaceId, userId: req.user._id },
    { $setOnInsert: { role: invitation.role } },
    { upsert: true }
  );
  invitation.acceptedAt = new Date();
  await invitation.save();
  audit(req, 'member.joined', { workspaceId: invitation.workspaceId, targetType: 'user', targetId: req.user._id, targetName: req.user.email, meta: { role: invitation.role } });

  req.user.currentWorkspaceId = invitation.workspaceId;
  req.user.emailVerified = true; // the link reached their inbox
  await req.user.save({ validateBeforeSave: false });

  res.json({ success: true, data: await sessionPayload(req.user) });
});

/* ─────────────── audit log ─────────────── */

export const listAuditLog = asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const before = req.query.before && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
  const filter = { workspaceId: req.workspace._id, ...(before ? { createdAt: { $lt: before } } : {}) };
  const entries = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({
    success: true,
    data: {
      entries: entries.map((e) => ({
        _id: e._id,
        action: e.action,
        actorEmail: e.actorEmail,
        targetType: e.targetType,
        targetName: e.targetName,
        ip: e.ip,
        userAgent: e.userAgent,
        meta: e.meta,
        createdAt: e.createdAt,
      })),
    },
  });
});
