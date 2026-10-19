import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import { Monitor } from '../models/Monitor.js';
import { Incident } from '../models/Incident.js';
import { Workspace } from '../models/Workspace.js';
import { Membership } from '../models/Membership.js';
import { AppError } from '../utils/AppError.js';
import { DAY_MS, dailySeries, uptimeOf } from '../services/statsService.js';
import { isHostVerified } from '../services/domainVerification.js';

/** Finds the workspace for a status-page slug. Old links used a user id or workspace id. */
const resolveWorkspace = async (slug) => {
  const bySlug = await Workspace.findOne({ slug: String(slug).toLowerCase().slice(0, 40) }).select('name slug statusPageEnabled');
  if (bySlug) return bySlug;
  if (!mongoose.isValidObjectId(slug)) return null;
  const byId = await Workspace.findById(slug).select('name slug statusPageEnabled');
  if (byId) return byId;
  const legacyOwner = await Membership.findOne({ userId: slug, role: 'owner' }).sort({ createdAt: 1 });
  return legacyOwner ? Workspace.findById(legacyOwner.workspaceId).select('name slug statusPageEnabled') : null;
};

/**
 * Public status page for a workspace, addressed by its slug (/status/acme).
 * Monitor URLs are deliberately NOT exposed — they can contain tokens or internal hostnames.
 */
export const getPublicStatus = asyncHandler(async (req, res, next) => {
  const workspace = await resolveWorkspace(req.params.slug);
  // Disabled pages are indistinguishable from missing ones — nothing leaks about the workspace.
  if (!workspace || !workspace.statusPageEnabled) return next(new AppError('Status page not found', 404));

  const candidates = await Monitor.find({ workspaceId: workspace._id, isActive: true, showOnStatusPage: { $ne: false } })
    .select('name host currentStatus intervalSeconds lastCheckedAt lastStatusChangeAt')
    .sort({ name: 1 })
    .lean();
  // Only sites the workspace has proven it owns appear publicly.
  const monitors = [];
  for (const m of candidates) {
    if (await isHostVerified(workspace._id, m.host)) {
      delete m.host;
      monitors.push(m);
    }
  }

  const monitorIds = monitors.map((m) => m._id);
  const nameById = Object.fromEntries(monitors.map((m) => [m._id.toString(), m.name]));

  const [series, incidents] = await Promise.all([
    dailySeries(monitorIds, 90),
    Incident.find({
      monitorId: { $in: monitorIds },
      $or: [{ resolvedAt: null }, { startedAt: { $gte: new Date(Date.now() - 14 * DAY_MS) } }],
    })
      .sort({ startedAt: -1 })
      .limit(30)
      .select('monitorId startedAt resolvedAt durationSeconds errorType statusCode resolution')
      .lean(),
  ]);

  const enriched = monitors.map((m) => {
    const daily = series.get(m._id.toString()) || [];
    return {
      _id: m._id,
      name: m.name,
      currentStatus: m.currentStatus,
      intervalSeconds: m.intervalSeconds,
      lastCheckedAt: m.lastCheckedAt,
      uptime90d: uptimeOf(daily),
      dailyStats: daily.map((d) => ({
        date: d.date,
        uptimePercent: d.uptimePercent,
        downtimeSeconds: d.downtimeSeconds,
        incidentCount: d.incidentCount,
      })),
    };
  });

  const thirtyDayCutoff = Date.now() - 30 * DAY_MS;
  const overallUptime = uptimeOf(
    [...series.values()].flat().filter((d) => new Date(d.date).getTime() >= thirtyDayCutoff)
  );

  // Public-safe incident view: which service, when, how long, what class of failure.
  const toPublicIncident = (i) => ({
    _id: i._id,
    monitorId: i.monitorId,
    monitorName: nameById[i.monitorId.toString()] || 'Service',
    startedAt: i.startedAt,
    resolvedAt: i.resolvedAt,
    durationSeconds: i.durationSeconds,
    errorType: i.errorType || null,
    statusCode: i.statusCode ?? null,
  });

  const activeIncidents = incidents.filter((i) => !i.resolvedAt).map(toPublicIncident);
  const pastIncidents = incidents.filter((i) => i.resolvedAt && i.resolution !== 'PAUSED').map(toPublicIncident);

  res.set('Cache-Control', 'public, max-age=15');
  res.status(200).json({
    success: true,
    data: {
      page: { name: workspace.name, slug: workspace.slug },
      hasActiveIncidents: activeIncidents.length > 0,
      overallUptime,
      monitors: enriched,
      activeIncidents,
      pastIncidents,
      generatedAt: new Date().toISOString(),
    },
  });
});
