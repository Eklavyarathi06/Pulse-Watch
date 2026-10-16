import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import { Monitor } from '../models/Monitor.js';
import { CheckLog } from '../models/CheckLog.js';
import { Incident } from '../models/Incident.js';
import { AppError } from '../utils/AppError.js';
import { DAY_MS, daysAgoUtc, dailySeries, uptimeOf, summarizeLogs } from '../services/statsService.js';

const HOUR_MS = 60 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000;

export const getDashboardSummary = asyncHandler(async (req, res) => {
  const monitors = await Monitor.find({ workspaceId: req.workspace._id }).select('_id name currentStatus isActive').lean();

  if (monitors.length === 0) {
    return res.status(200).json({
      success: true,
      data: {
        overallUptime: null,
        uptime24h: null,
        activeIncidents: 0,
        incidents24h: 0,
        monitorCount: 0,
        activeMonitorCount: 0,
        upCount: 0,
        downCount: 0,
        avgLatency: null,
        p95Latency: null,
        checks24h: 0,
        sparklines: {},
        recentIncidents: [],
      },
    });
  }

  const monitorIds = monitors.map((m) => m._id);
  const since24h = new Date(Date.now() - DAY_MS);

  const [activeIncidents, incidents24h, series30, logs24h, recentIncidents] = await Promise.all([
    Incident.countDocuments({ monitorId: { $in: monitorIds }, resolvedAt: null }),
    Incident.countDocuments({ monitorId: { $in: monitorIds }, startedAt: { $gte: since24h } }),
    dailySeries(monitorIds, 30),
    CheckLog.find({ monitorId: { $in: monitorIds }, timestamp: { $gte: since24h } })
      .select('monitorId timestamp status responseTimeMs')
      .sort({ timestamp: 1 })
      .lean(),
    Incident.find({ monitorId: { $in: monitorIds } }).sort({ startedAt: -1 }).limit(20).lean(),
  ]);

  const overallUptime = uptimeOf([...series30.values()].flat());
  const summary24h = summarizeLogs(logs24h);

  // Real sparklines: 24 hourly buckets of average latency per monitor.
  const nowMs = Date.now();
  const firstBucketStart = nowMs - 24 * HOUR_MS;
  const sparklines = {};
  const logsByMonitor = new Map(monitorIds.map((id) => [id.toString(), []]));
  for (const log of logs24h) logsByMonitor.get(log.monitorId.toString())?.push(log);

  for (const [id, logs] of logsByMonitor) {
    const buckets = Array.from({ length: 24 }, () => ({ sum: 0, n: 0, down: 0 }));
    for (const log of logs) {
      const idx = Math.min(23, Math.floor((new Date(log.timestamp).getTime() - firstBucketStart) / HOUR_MS));
      if (idx < 0) continue;
      if (typeof log.responseTimeMs === 'number') {
        buckets[idx].sum += log.responseTimeMs;
        buckets[idx].n += 1;
      }
      if (log.status === 'DOWN') buckets[idx].down += 1;
    }
    const s = summarizeLogs(logs);
    sparklines[id] = {
      points: buckets.map((b, i) => ({
        t: new Date(firstBucketStart + i * HOUR_MS).toISOString(),
        responseTime: b.n ? Math.round(b.sum / b.n) : null,
        down: b.down > 0,
      })),
      uptime24h: s.uptimePercent,
      avgResponseMs: s.avgResponseMs,
      lastResponseMs: logs.length ? logs[logs.length - 1].responseTimeMs ?? null : null,
      checks24h: s.checks,
    };
  }

  const nameById = Object.fromEntries(monitors.map((m) => [m._id.toString(), m.name]));

  res.status(200).json({
    success: true,
    data: {
      overallUptime,
      uptime24h: summary24h.uptimePercent,
      activeIncidents,
      incidents24h,
      monitorCount: monitors.length,
      activeMonitorCount: monitors.filter((m) => m.isActive).length,
      upCount: monitors.filter((m) => m.currentStatus === 'UP').length,
      downCount: monitors.filter((m) => m.currentStatus === 'DOWN').length,
      avgLatency: summary24h.avgResponseMs,
      p95Latency: summary24h.p95ResponseMs,
      checks24h: summary24h.checks,
      sparklines,
      recentIncidents: recentIncidents.map((i) => ({
        _id: i._id,
        monitorId: i.monitorId,
        monitorName: nameById[i.monitorId.toString()] || 'Deleted monitor',
        startedAt: i.startedAt,
        resolvedAt: i.resolvedAt,
        durationSeconds: i.durationSeconds,
        cause: i.cause,
        resolution: i.resolution,
      })),
    },
  });
});

export const getMonitorStats = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return next(new AppError('Monitor not found', 404));
  const monitor = await Monitor.findOne({ _id: req.params.id, workspaceId: req.workspace._id });
  if (!monitor) return next(new AppError('Monitor not found', 404));

  const since24h = new Date(Date.now() - DAY_MS);

  const [logs24h, series90, incidents] = await Promise.all([
    CheckLog.find({ monitorId: monitor._id, timestamp: { $gte: since24h } }).sort({ timestamp: 1 }).lean(),
    dailySeries([monitor._id], 90),
    Incident.find({ monitorId: monitor._id })
      .sort({ startedAt: -1 })
      .limit(25)
      .select('-alertsSent.error')
      .lean(),
  ]);

  // 1. 24h response-time chart in 5-minute buckets (≤ 288 points).
  const bucketMap = new Map();
  for (const log of logs24h) {
    const key = Math.floor(new Date(log.timestamp).getTime() / BUCKET_MS) * BUCKET_MS;
    const b = bucketMap.get(key) || { sum: 0, n: 0, max: 0, down: 0, checks: 0 };
    b.checks += 1;
    if (typeof log.responseTimeMs === 'number') {
      b.sum += log.responseTimeMs;
      b.n += 1;
      b.max = Math.max(b.max, log.responseTimeMs);
    }
    if (log.status === 'DOWN') b.down += 1;
    bucketMap.set(key, b);
  }
  const chartData = [...bucketMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, b]) => ({
      timestamp: new Date(ts).toISOString(),
      responseTime: b.n ? Math.round(b.sum / b.n) : null,
      maxResponseTime: b.max || null,
      status: b.down > 0 ? 'DOWN' : 'UP',
      checks: b.checks,
    }));

  const daily = series90.get(monitor._id.toString()) || [];
  // Last n calendar days including today.
  const lastN = (n) => {
    const cutoff = daysAgoUtc(n - 1).getTime();
    return daily.filter((d) => new Date(d.date).getTime() >= cutoff);
  };

  const recentChecks = logs24h.slice(-50).reverse().map((l) => ({
    _id: l._id,
    timestamp: l.timestamp,
    status: l.status,
    statusCode: l.statusCode ?? null,
    responseTimeMs: l.responseTimeMs ?? null,
    errorType: l.errorType || null,
    errorMessage: l.errorMessage || null,
    attempt: l.attempt,
  }));

  const summary24h = summarizeLogs(logs24h);

  res.status(200).json({
    success: true,
    data: {
      chartData,
      summary24h,
      uptime: {
        d1: summary24h.uptimePercent,
        d7: uptimeOf(lastN(7)),
        d30: uptimeOf(lastN(30)),
        d90: uptimeOf(daily),
      },
      dailyStats: daily.map((d) => ({
        date: d.date,
        uptimePercent: d.uptimePercent,
        downtimeSeconds: d.downtimeSeconds,
        totalChecks: d.totalChecks,
        avgResponseMs: d.avgResponseMs,
        incidentCount: d.incidentCount,
        live: Boolean(d.live),
      })),
      recentChecks,
      incidents: incidents.map((i) => ({
        _id: i._id,
        startedAt: i.startedAt,
        resolvedAt: i.resolvedAt,
        durationSeconds: i.durationSeconds,
        cause: i.cause,
        errorType: i.errorType || null,
        statusCode: i.statusCode ?? null,
        resolution: i.resolution,
        alertsSent: (i.alertsSent || []).map((a) => ({ event: a.event, ok: a.ok, sentAt: a.sentAt })),
      })),
    },
  });
});
