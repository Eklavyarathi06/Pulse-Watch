import { CheckLog } from '../models/CheckLog.js';
import { DailyStat } from '../models/DailyStat.js';
import { Incident } from '../models/Incident.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

export const startOfUtcDay = (d = new Date()) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

export const daysAgoUtc = (n) => {
  const d = startOfUtcDay();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};

/** Nearest-rank percentile on an unsorted numeric array. */
export const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
};

const round = (n, digits = 0) => {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Seconds of [from, to) covered by incidents of the given monitors. */
export const downtimeSecondsBetween = (incidents, from, to) => {
  let total = 0;
  for (const inc of incidents) {
    const s = Math.max(new Date(inc.startedAt).getTime(), from.getTime());
    const e = Math.min(inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : Date.now(), to.getTime());
    if (e > s) total += (e - s) / 1000;
  }
  return Math.round(total);
};

/**
 * DailyStat rows only exist after the nightly rollup. This computes the same shape
 * for "today so far" straight from raw CheckLogs so numbers are right from minute zero.
 * Returns Map<monitorId, DailyStat-like object>.
 */
export const liveTodayStats = async (monitorIds) => {
  const since = startOfUtcDay();
  const result = new Map();
  if (!monitorIds.length) return result;

  const [groups, incidents] = await Promise.all([
    CheckLog.aggregate([
      { $match: { monitorId: { $in: monitorIds }, timestamp: { $gte: since } } },
      {
        $group: {
          _id: '$monitorId',
          totalChecks: { $sum: 1 },
          upChecks: { $sum: { $cond: [{ $eq: ['$status', 'UP'] }, 1, 0] } },
          times: { $push: '$responseTimeMs' },
        },
      },
    ]),
    Incident.find({
      monitorId: { $in: monitorIds },
      startedAt: { $lt: new Date() },
      $or: [{ resolvedAt: null }, { resolvedAt: { $gte: since } }],
    }).lean(),
  ]);

  for (const g of groups) {
    const times = g.times.filter((t) => typeof t === 'number');
    const id = g._id.toString();
    const own = incidents.filter((i) => i.monitorId.toString() === id);
    result.set(id, {
      monitorId: g._id,
      date: since,
      totalChecks: g.totalChecks,
      upChecks: g.upChecks,
      uptimePercent: g.totalChecks ? round((g.upChecks / g.totalChecks) * 100, 4) : 100,
      avgResponseMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
      p95ResponseMs: percentile(times, 95),
      minResponseMs: times.length ? Math.min(...times) : 0,
      maxResponseMs: times.length ? Math.max(...times) : 0,
      incidentCount: own.filter((i) => new Date(i.startedAt) >= since).length,
      downtimeSeconds: downtimeSecondsBetween(own, since, new Date()),
      live: true,
    });
  }
  return result;
};

/** Past DailyStats (excluding today) + today's live row, grouped per monitor. */
export const dailySeries = async (monitorIds, days) => {
  const today = startOfUtcDay();
  const [past, live] = await Promise.all([
    DailyStat.find({ monitorId: { $in: monitorIds }, date: { $gte: daysAgoUtc(days - 1), $lt: today } })
      .sort({ date: 1 })
      .lean(),
    liveTodayStats(monitorIds),
  ]);

  const byMonitor = new Map(monitorIds.map((id) => [id.toString(), []]));
  for (const row of past) byMonitor.get(row.monitorId.toString())?.push(row);
  for (const [id, row] of live) byMonitor.get(id)?.push(row);
  return byMonitor;
};

/** Check-weighted uptime over a list of DailyStat-like rows. */
export const uptimeOf = (rows) => {
  let up = 0;
  let total = 0;
  for (const r of rows) {
    up += r.upChecks || 0;
    total += r.totalChecks || 0;
  }
  return total ? round((up / total) * 100, 3) : null;
};

/** Summary over raw logs in a window (avg / p95 / min / max / uptime). */
export const summarizeLogs = (logs) => {
  const times = logs.map((l) => l.responseTimeMs).filter((t) => typeof t === 'number');
  const up = logs.filter((l) => l.status === 'UP').length;
  return {
    checks: logs.length,
    uptimePercent: logs.length ? round((up / logs.length) * 100, 3) : null,
    avgResponseMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    p95ResponseMs: times.length ? percentile(times, 95) : null,
    minResponseMs: times.length ? Math.min(...times) : null,
    maxResponseMs: times.length ? Math.max(...times) : null,
  };
};
