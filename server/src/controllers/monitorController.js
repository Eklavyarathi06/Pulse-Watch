import { z } from 'zod';
import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import { Monitor, SECRET_FIELDS } from '../models/Monitor.js';
import { CheckLog } from '../models/CheckLog.js';
import { Incident } from '../models/Incident.js';
import { DailyStat } from '../models/DailyStat.js';
import { AlertChannel } from '../models/AlertChannel.js';
import { AppError } from '../utils/AppError.js';
import { validateUrlSSRF } from '../utils/ssrf.js';
import { runCheck, isCheckInFlight } from '../services/scheduler.js';
import { sealMonitorSecrets, openMonitorSecrets } from '../services/secrets.js';
import { audit } from '../services/audit.js';
import { logger } from '../utils/logger.js';
import { limitsFor, effectivePlanId } from '../config/plans.js';
import { isHostVerified, hostOfUrl } from '../services/domainVerification.js';

const ALLOWED_INTERVALS = [30, 60, 300, 900];
// Hop-by-hop / framing / identity headers a user must not set.
const FORBIDDEN_HEADERS = ['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'te', 'trailer', 'keep-alive', 'proxy-authorization', 'proxy-connection'];
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;
const NO_CRLF = /^[^\r\n\0]*$/;

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

/**
 * Headers are write-only. They arrive as [{ name, value }]; on edit a header sent without a
 * value means "keep the value already stored" — the client never sees stored values.
 * (A { name: value } object is also accepted for API clients.)
 */
const headerItem = z.object({
  name: z.string().trim(),
  value: z.string().max(4000).regex(NO_CRLF, 'Header values cannot contain line breaks').optional().nullable(),
});
const headersInput = z
  .union([z.array(headerItem), z.record(z.string().max(4000))])
  .transform((h) => (Array.isArray(h) ? h : Object.entries(h).map(([name, value]) => ({ name, value }))))
  .superRefine((items, ctx) => {
    if (items.length > 20) ctx.addIssue({ code: 'custom', message: 'At most 20 headers' });
    const seen = new Set();
    for (const { name, value } of items) {
      if (!HEADER_NAME.test(name)) ctx.addIssue({ code: 'custom', message: `"${name}" is not a valid header name` });
      else if (FORBIDDEN_HEADERS.includes(name.toLowerCase())) ctx.addIssue({ code: 'custom', message: `"${name}" header cannot be overridden` });
      if (typeof value === 'string' && !NO_CRLF.test(value)) ctx.addIssue({ code: 'custom', message: 'Header values cannot contain line breaks' });
      if (seen.has(name.toLowerCase())) ctx.addIssue({ code: 'custom', message: `Duplicate header "${name}"` });
      seen.add(name.toLowerCase());
    }
  });

const urlInput = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), 'Only http and https URLs are allowed');

const baseFields = {
  name: z.string().trim().min(1).max(100),
  method: z.enum(['GET', 'POST', 'PUT', 'HEAD']),
  intervalSeconds: z
    .number()
    .int()
    .refine((val) => ALLOWED_INTERVALS.includes(val), { message: 'Invalid interval. Allowed: 30, 60, 300, 900' }),
  keyword: z.string().trim().max(200),
  timeoutMs: z.number().int().min(1000).max(30000),
  expectedStatusCodes: z.array(z.number().int().min(100).max(599)).min(1, 'Pick at least one expected status code').max(20),
  alertChannelIds: z.array(objectId).max(25),
  showOnStatusPage: z.boolean(),
};

const createSchema = z.object({
  ...baseFields,
  url: urlInput,
  method: baseFields.method.default('GET'),
  intervalSeconds: baseFields.intervalSeconds.default(300),
  keyword: baseFields.keyword.default(''),
  timeoutMs: baseFields.timeoutMs.default(10000),
  expectedStatusCodes: baseFields.expectedStatusCodes.default([200, 201, 202, 203, 204]),
  alertChannelIds: baseFields.alertChannelIds.default([]),
  showOnStatusPage: baseFields.showOnStatusPage.default(true),
  headers: headersInput.default([]),
  body: z.string().max(10000).default(''),
});

const updateSchema = z.object({
  ...Object.fromEntries(Object.entries(baseFields).map(([k, v]) => [k, v.optional()])),
  url: urlInput.optional(),
  headers: headersInput.optional(),
  // undefined = keep stored body, '' = remove it, string = replace it
  body: z.string().max(10000).optional(),
});

const findOwned = async (req, { withSecrets = false } = {}) => {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  const q = Monitor.findOne({ _id: req.params.id, workspaceId: req.workspace._id });
  return withSecrets ? q.select(SECRET_FIELDS) : q;
};

const checkInterval = (req, intervalSeconds) => {
  const plan = limitsFor(req.workspace);
  if (intervalSeconds !== undefined && intervalSeconds < plan.minInterval) {
    return new AppError(`Your ${effectivePlanId(req.workspace)} plan supports checks every ${plan.minInterval}s or slower. Upgrade for 30-second checks.`, 403);
  }
  return null;
};

// Only allow channels from this workspace; reject so the UI can tell the user.
const checkChannels = async (req, ids) => {
  if (!ids || ids.length === 0) return null;
  const unique = [...new Set(ids)];
  const owned = await AlertChannel.countDocuments({ _id: { $in: unique }, workspaceId: req.workspace._id });
  if (owned !== unique.length) return new AppError('One or more alert channels were not found', 400);
  return null;
};

const closeOpenIncident = async (monitorId, resolution) => {
  const open = await Incident.findOne({ monitorId, resolvedAt: null });
  if (!open) return;
  const now = new Date();
  open.resolvedAt = now;
  open.resolution = resolution;
  open.durationSeconds = Math.round((now.getTime() - open.startedAt.getTime()) / 1000);
  await open.save();
};

/**
 * Ownership rule (strict): a workspace can only monitor websites on domains it has verified.
 * PulseWatch never sends a single request to a site a company hasn't proven is theirs.
 */
const notVerifiedError = (host) =>
  new AppError(
    host
      ? `You can only monitor websites your company owns. Verify ${host} under Domains first — it takes a minute.`
      : 'Enter a valid website address on a domain you have verified.',
    403,
    { code: 'DOMAIN_NOT_VERIFIED', domain: host }
  );

/** Merges submitted headers with stored ones: a header without a value keeps its stored value. */
const mergeHeaders = (items, stored) => {
  const storedByName = new Map(Object.entries(stored || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const out = {};
  for (const { name, value } of items) {
    if (typeof value === 'string' && value.length > 0) out[name] = value;
    else if (storedByName.has(name.toLowerCase())) out[name] = storedByName.get(name.toLowerCase());
    else return { error: `Header "${name}" needs a value` };
  }
  return { headers: out };
};

export const createMonitor = asyncHandler(async (req, res, next) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new AppError(parsed.error.issues[0]?.message || 'Invalid input data', 400, parsed.error.format()));
  }
  const { url, headers: headerItems, body, ...fields } = parsed.data;

  // 1. Plan limits
  const plan = limitsFor(req.workspace);
  const monitorCount = await Monitor.countDocuments({ workspaceId: req.workspace._id });
  if (monitorCount >= plan.monitors) {
    return next(new AppError(`Plan limit reached. Your ${effectivePlanId(req.workspace)} plan allows up to ${plan.monitors} monitors. Upgrade to add more.`, 403));
  }
  const intervalErr = checkInterval(req, fields.intervalSeconds);
  if (intervalErr) return next(intervalErr);

  const channelErr = await checkChannels(req, fields.alertChannelIds);
  if (channelErr) return next(channelErr);

  const merged = mergeHeaders(headerItems, {});
  if (merged.error) return next(new AppError(merged.error, 400));

  // Ownership: only verified domains of this workspace can be monitored.
  const host = hostOfUrl(url);
  if (!(await isHostVerified(req.workspace._id, host))) return next(notVerifiedError(host));

  // 2. SSRF pre-check
  const ssrfCheck = await validateUrlSSRF(url);
  if (!ssrfCheck.isValid) {
    return next(new AppError(`Security Error: ${ssrfCheck.error}`, 400));
  }

  // 3. Create — secrets are encrypted before the document ever reaches the database.
  const monitor = new Monitor({ ...fields, workspaceId: req.workspace._id, userId: req.user._id });
  sealMonitorSecrets(monitor, { url, headers: merged.headers, body: ['POST', 'PUT'].includes(fields.method) ? body : '' });
  await monitor.save();

  audit(req, 'monitor.created', { targetType: 'monitor', targetId: monitor._id, targetName: monitor.name });

  // Instant first check (no jitter) so the dashboard fills in within seconds.
  runCheck(monitor, { jitter: false }).catch((err) => logger.error(`Instant check failed: ${err.message}`));

  res.status(201).json({ success: true, data: { monitor } });
});

export const getMonitors = asyncHandler(async (req, res) => {
  const monitors = await Monitor.find({ workspaceId: req.workspace._id }).sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: { monitors } });
});

export const getMonitor = asyncHandler(async (req, res, next) => {
  const monitor = await findOwned(req);
  if (!monitor) return next(new AppError('Monitor not found', 404));
  res.status(200).json({ success: true, data: { monitor } });
});

export const updateMonitor = asyncHandler(async (req, res, next) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new AppError(parsed.error.issues[0]?.message || 'Invalid input data', 400, parsed.error.format()));
  }

  const monitor = await findOwned(req, { withSecrets: true });
  if (!monitor) return next(new AppError('Monitor not found', 404));

  const { url, headers: headerItems, body, ...fields } = parsed.data;

  if (fields.intervalSeconds !== undefined && fields.intervalSeconds !== monitor.intervalSeconds) {
    const intervalErr = checkInterval(req, fields.intervalSeconds);
    if (intervalErr) return next(intervalErr);
  }

  const channelErr = await checkChannels(req, fields.alertChannelIds);
  if (channelErr) return next(channelErr);

  const current = openMonitorSecrets(monitor);
  const urlChanged = url !== undefined && url !== current.url;
  if (urlChanged) {
    const ssrfCheck = await validateUrlSSRF(url);
    if (!ssrfCheck.isValid) {
      return next(new AppError(`Security Error: ${ssrfCheck.error}`, 400));
    }
  }

  let newHeaders;
  if (headerItems !== undefined) {
    const merged = mergeHeaders(headerItems, current.headers);
    if (merged.error) return next(new AppError(merged.error, 400));
    newHeaders = merged.headers;
  }

  const method = fields.method || monitor.method;
  let newBody = body;
  if (!['POST', 'PUT'].includes(method) && monitor.hasBody) newBody = ''; // methods without bodies drop it

  // Ownership: the monitor (and any new address) must be on a verified domain of this workspace.
  const host = urlChanged ? hostOfUrl(url) : monitor.host || hostOfUrl(current.url);
  if (!(await isHostVerified(req.workspace._id, host))) return next(notVerifiedError(host));

  const targetChanged = urlChanged || (fields.method && fields.method !== monitor.method);
  const secretsChanged = urlChanged || newHeaders !== undefined || newBody !== undefined;

  Object.assign(monitor, fields);
  sealMonitorSecrets(monitor, {
    url: urlChanged ? url : undefined,
    headers: newHeaders,
    body: newBody,
  });

  if (fields.intervalSeconds !== undefined && monitor.isActive) {
    // Re-plan around the new cadence instead of waiting out the old one.
    const base = monitor.lastCheckedAt ? monitor.lastCheckedAt.getTime() : Date.now();
    monitor.nextCheckAt = new Date(Math.max(Date.now(), base + monitor.intervalSeconds * 1000));
  }
  if (targetChanged && monitor.isActive) {
    // A different endpoint is effectively a new monitor: verify it right away.
    monitor.nextCheckAt = new Date();
  }

  await monitor.save();

  audit(req, secretsChanged ? 'monitor.secrets_updated' : 'monitor.updated', {
    targetType: 'monitor',
    targetId: monitor._id,
    targetName: monitor.name,
    meta: { fields: [...Object.keys(fields), ...(urlChanged ? ['url'] : []), ...(newHeaders ? ['headers'] : []), ...(newBody !== undefined ? ['body'] : [])] },
  });

  res.status(200).json({ success: true, data: { monitor } });
});

export const deleteMonitor = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return next(new AppError('Monitor not found', 404));
  const monitor = await Monitor.findOneAndDelete({ _id: req.params.id, workspaceId: req.workspace._id });
  if (!monitor) return next(new AppError('Monitor not found', 404));

  // Cascade all telemetry
  await Promise.all([
    CheckLog.deleteMany({ monitorId: monitor._id }),
    Incident.deleteMany({ monitorId: monitor._id }),
    DailyStat.deleteMany({ monitorId: monitor._id }),
  ]);

  audit(req, 'monitor.deleted', { targetType: 'monitor', targetId: monitor._id, targetName: monitor.name });
  res.status(204).end();
});

export const togglePause = asyncHandler(async (req, res, next) => {
  const monitor = await findOwned(req);
  if (!monitor) return next(new AppError('Monitor not found', 404));

  monitor.isActive = !monitor.isActive;
  monitor.lastStatusChangeAt = new Date();
  if (!monitor.isActive) {
    monitor.currentStatus = 'PAUSED';
    // Paused monitors can't recover on their own, so don't leave an incident dangling.
    await closeOpenIncident(monitor._id, 'PAUSED');
  } else {
    if (!(await isHostVerified(req.workspace._id, monitor.host))) return next(notVerifiedError(monitor.host));
    monitor.pausedByOwnership = false;
    // Resuming must respect the plan (a lapsed plan may have paused overflow monitors).
    const plan = limitsFor(req.workspace);
    const active = await Monitor.countDocuments({ workspaceId: req.workspace._id, isActive: true });
    if (active >= plan.monitors) {
      return next(new AppError(`Your ${effectivePlanId(req.workspace)} plan allows ${plan.monitors} active monitors. Upgrade or pause another one first.`, 403));
    }
    if (monitor.intervalSeconds < plan.minInterval) monitor.intervalSeconds = plan.minInterval;
    monitor.currentStatus = 'PENDING';
    monitor.pausedByPlan = false;
    monitor.consecutiveFailures = 0;
    monitor.nextCheckAt = new Date(); // check immediately
  }

  await monitor.save();
  audit(req, monitor.isActive ? 'monitor.resumed' : 'monitor.paused', { targetType: 'monitor', targetId: monitor._id, targetName: monitor.name });

  res.status(200).json({ success: true, data: { monitor } });
});

export const checkNow = asyncHandler(async (req, res, next) => {
  const monitor = await findOwned(req, { withSecrets: true });
  if (!monitor) return next(new AppError('Monitor not found', 404));
  if (!(await isHostVerified(req.workspace._id, monitor.host))) return next(notVerifiedError(monitor.host));
  if (!monitor.isActive) return next(new AppError('Resume this monitor before running a check', 409));
  if (isCheckInFlight(monitor._id)) return next(new AppError('A check is already running for this monitor', 409));

  const outcome = await runCheck(monitor, { jitter: false });
  if (!outcome) return next(new AppError('A check is already running for this monitor', 409));
  if (outcome.notOwned) return next(notVerifiedError(monitor.host));

  const fresh = outcome.monitor || (await Monitor.findById(monitor._id));
  res.status(200).json({ success: true, data: { result: outcome.result, monitor: fresh } });
});
