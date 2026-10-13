import pLimit from 'p-limit';
import { Monitor, SECRET_FIELDS } from '../models/Monitor.js';
import { CheckLog } from '../models/CheckLog.js';
import { Incident } from '../models/Incident.js';
import { pingMonitor, buildTarget } from './pingEngine.js';
import { nextState } from './stateMachine.js';
import { logger } from '../utils/logger.js';
import { dispatchAlerts } from './alertDispatcher.js';
import { env } from '../config/env.js';
import { isLeader } from './leader.js';
import { ownershipCheckerFor } from './domainVerification.js';

const inFlight = new Set();
const limit = pLimit(20); // Max 20 concurrent checks

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes one full check for a monitor and persists the outcome.
 * Returns { result, monitor } or null if a check for this monitor is already running.
 */
export const runCheck = async (monitor, { jitter = true } = {}) => {
  const id = monitor._id.toString();
  if (inFlight.has(id)) return null; // Overlap guard

  inFlight.add(id);

  try {
    // Jitter (0–5s) spreads scheduled load; manual checks skip it.
    if (jitter) await sleep(Math.random() * 5000);

    // Secrets are decrypted only here, only in memory, only for this check.
    const withSecrets = monitor.urlEnc ? monitor : await Monitor.findById(monitor._id).select(SECRET_FIELDS);
    if (!withSecrets) return null;

    // Hard rule: PulseWatch only ever contacts sites the workspace has proven it owns.
    // Anything else (legacy data, a lost domain) is stopped here, before a single request is made.
    const isOwned = await ownershipCheckerFor(withSecrets.workspaceId);
    if (!isOwned(withSecrets.host)) {
      await Monitor.updateOne(
        { _id: withSecrets._id },
        { $set: { isActive: false, pausedByOwnership: true, currentStatus: 'PAUSED', showOnStatusPage: false, lastStatusChangeAt: new Date() } }
      );
      logger.warn(`Stopped monitor ${id}: ${withSecrets.host} is not a verified domain of its workspace`);
      return { result: null, monitor: null, notOwned: true };
    }

    const result = await pingMonitor(buildTarget(withSecrets, isOwned));
    const now = new Date();

    await CheckLog.create({
      monitorId: monitor._id,
      timestamp: now,
      status: result.status,
      statusCode: result.statusCode,
      responseTimeMs: result.responseTimeMs,
      errorType: result.errorType,
      errorMessage: result.errorMessage?.slice(0, 500),
      attempt: result.attempt,
    });

    const { newStatus, shouldAlert, alertType } = nextState({
      prevStatus: monitor.currentStatus,
      checkResult: result.status,
    });

    const update = {
      $set: {
        currentStatus: newStatus,
        lastCheckedAt: now,
        nextCheckAt: new Date(now.getTime() + monitor.intervalSeconds * 1000),
        consecutiveFailures: result.status === 'DOWN' ? (monitor.consecutiveFailures || 0) + 1 : 0,
        ...(newStatus !== monitor.currentStatus ? { lastStatusChangeAt: now } : {}),
      },
    };

    // Only write if the monitor is still active — a pause or delete during the check wins.
    const saved = await Monitor.findOneAndUpdate({ _id: monitor._id, isActive: true }, update, { returnDocument: 'after' });
    if (!saved) return { result, monitor: null };

    if (shouldAlert) {
      logger.info(`🚨 ALERT FOR MONITOR ${id}: ${alertType}`);
      let incident = null;

      if (alertType === 'DOWN') {
        // Reuse an incident that is somehow still open instead of stacking duplicates.
        incident = await Incident.findOne({ monitorId: monitor._id, resolvedAt: null });
        if (!incident) {
          incident = await Incident.create({
            monitorId: monitor._id,
            workspaceId: monitor.workspaceId,
            userId: monitor.userId,
            startedAt: now,
            cause: `${result.errorType || 'HTTP_ERROR'} — ${result.errorMessage || 'Unknown failure'}`.slice(0, 500),
            errorType: result.errorType,
            statusCode: result.statusCode,
          });
        }
      } else if (alertType === 'RECOVERED') {
        incident = await Incident.findOne({ monitorId: monitor._id, resolvedAt: null });
        if (incident) {
          incident.resolvedAt = now;
          incident.resolution = 'RECOVERED';
          incident.durationSeconds = Math.round((now.getTime() - incident.startedAt.getTime()) / 1000);
          await incident.save();
        }
      }

      if (incident) {
        dispatchAlerts(saved, incident, alertType).catch((err) =>
          logger.error(`Alert dispatch failed for monitor ${id}: ${err.message}`)
        );
      }
    }

    return { result, monitor: saved };
  } catch (error) {
    logger.error(`Error running check for monitor ${id}: ${error.message}`);
    throw error;
  } finally {
    inFlight.delete(id);
  }
};

export const isCheckInFlight = (monitorId) => inFlight.has(monitorId.toString());

let tickRunning = false;

export const startScheduler = () => {
  const tickMs = Math.max(5, env.SCHEDULER_TICK_SECONDS) * 1000;

  const tick = async () => {
    if (tickRunning || !isLeader()) return; // only one instance runs scheduled checks
    tickRunning = true;
    try {
      const dueMonitors = await Monitor.find({ isActive: true, nextCheckAt: { $lte: new Date() } }).select(SECRET_FIELDS);
      if (dueMonitors.length > 0) {
        logger.debug(`Scheduler ticking: ${dueMonitors.length} monitors due.`);
      }
      // Fire and forget so a slow target never delays the next sweep.
      dueMonitors.forEach((monitor) => {
        limit(() => runCheck(monitor)).catch(() => {});
      });
    } catch (error) {
      logger.error(`Scheduler error: ${error.message}`);
    } finally {
      tickRunning = false;
    }
  };

  setInterval(tick, tickMs);
  tick();
  logger.info(`Scheduler started (sweep every ${tickMs / 1000}s).`);
};
