import cron from 'node-cron';
import { Monitor } from '../models/Monitor.js';
import { CheckLog } from '../models/CheckLog.js';
import { DailyStat } from '../models/DailyStat.js';
import { Incident } from '../models/Incident.js';
import { logger } from '../utils/logger.js';
import { percentile, downtimeSecondsBetween } from './statsService.js';
import { isLeader } from './leader.js';

// Aggregate raw logs into a DailyStat for a specific monitor and date
export const rollupDailyStats = async (monitorId, targetDate) => {
  const startOfDay = new Date(targetDate);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(startOfDay.getUTCDate() + 1);

  try {
    const logs = await CheckLog.find({ monitorId, timestamp: { $gte: startOfDay, $lt: endOfDay } })
      .select('status responseTimeMs')
      .lean();

    if (logs.length === 0) return;

    const upChecks = logs.filter((l) => l.status === 'UP').length;
    const times = logs.map((l) => l.responseTimeMs).filter((t) => typeof t === 'number');
    const uptimePercent = (upChecks / logs.length) * 100;

    // Downtime seconds for the day from incidents overlapping it
    const incidents = await Incident.find({
      monitorId,
      startedAt: { $lt: endOfDay },
      $or: [{ resolvedAt: null }, { resolvedAt: { $gte: startOfDay } }],
    }).lean();

    await DailyStat.findOneAndUpdate(
      { monitorId, date: startOfDay },
      {
        $set: {
          totalChecks: logs.length,
          upChecks,
          uptimePercent: Number(uptimePercent.toFixed(4)),
          avgResponseMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
          p95ResponseMs: percentile(times, 95),
          minResponseMs: times.length ? Math.min(...times) : 0,
          maxResponseMs: times.length ? Math.max(...times) : 0,
          incidentCount: incidents.filter((i) => i.startedAt >= startOfDay).length,
          downtimeSeconds: downtimeSecondsBetween(incidents, startOfDay, endOfDay),
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (error) {
    logger.error(`Rollup failed for monitor ${monitorId} on ${startOfDay.toISOString()}: ${error.message}`);
  }
};

const rollupYesterday = async () => {
  if (!isLeader()) return;
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const monitors = await Monitor.find({}, '_id').lean();
  for (const monitor of monitors) {
    await rollupDailyStats(monitor._id, yesterday);
  }
};

export const startRollupJob = () => {
  // Run every day at 00:10 UTC
  cron.schedule('10 0 * * *', async () => {
    logger.info('Starting nightly rollup job...');
    try {
      await rollupYesterday();
      logger.info('Nightly rollup job completed.');
    } catch (error) {
      logger.error(`Nightly rollup job failed: ${error.message}`);
    }
  }, {
    timezone: 'UTC',
  });

  // Catch-up: if the server was down at 00:10, yesterday's raw logs (25h TTL) are
  // still here — roll them up on boot so the 90-day bars never get a hole. Idempotent upsert.
  rollupYesterday().catch((error) => logger.error(`Startup rollup failed: ${error.message}`));
};
