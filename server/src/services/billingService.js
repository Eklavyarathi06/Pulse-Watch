import { Payment } from '../models/Payment.js';
import { Workspace } from '../models/Workspace.js';
import { Monitor } from '../models/Monitor.js';
import { Incident } from '../models/Incident.js';
import { User } from '../models/User.js';
import { PLANS, PLAN_RANK, CYCLE_DAYS, effectivePlanId } from '../config/plans.js';
import { env } from '../config/env.js';
import { sendMail } from './mailer.js';
import { receiptTemplate, renewalReminderTemplate, planEndedTemplate } from './email/templates.js';
import { fetchOrderPayments, capturePayment } from './razorpay.js';
import { logger } from '../utils/logger.js';
import { isLeader } from './leader.js';
import { recheckDomains } from './domainVerification.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_AMOUNT = 100; // Razorpay's minimum order is ₹1
const REMINDER_DAYS = [7, 1];

/**
 * Quotes a purchase. Rules:
 *  - same plan while active → extends from the current expiry (renewal)
 *  - upgrade while active   → starts now; unused time on the old plan is credited (prorated)
 *  - downgrade while active → refused until the current plan ends
 */
export const quote = async (workspace, planId, cycle) => {
  const plan = PLANS[planId];
  const price = plan.price[cycle];
  const now = Date.now();
  const current = effectivePlanId(workspace);
  const activeUntil = current !== 'free' && workspace.planExpiresAt ? new Date(workspace.planExpiresAt).getTime() : null;

  if (current !== 'free' && PLAN_RANK[planId] < PLAN_RANK[current]) {
    const until = new Date(activeUntil).toDateString();
    return { error: `You're on ${PLANS[current].name} until ${until}. You can switch to ${plan.name} after it ends.` };
  }

  let credit = 0;
  let periodStart = now;
  if (current === planId && activeUntil) {
    periodStart = activeUntil; // renewal stacks onto remaining time
  } else if (current !== 'free' && activeUntil) {
    const last = await Payment.findOne({ workspaceId: workspace._id, status: 'paid', plan: current }).sort({ periodEnd: -1 });
    if (last?.periodStart && last?.periodEnd) {
      const span = last.periodEnd.getTime() - last.periodStart.getTime();
      const remaining = Math.max(0, Math.min(span, activeUntil - now));
      credit = Math.floor((last.amount * remaining) / span);
    }
  }

  const amount = Math.max(MIN_AMOUNT, price - credit);
  credit = price - amount;
  const periodEnd = periodStart + CYCLE_DAYS[cycle] * DAY_MS;
  return { plan, price, credit, amount, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), isRenewal: current === planId };
};

/**
 * After a (re)activation, bring back monitors that a lapsed plan paused or slowed —
 * oldest first, up to the new plan's limits — so paying again restores things exactly.
 */
export const restoreAfterUpgrade = async (workspace) => {
  const limits = PLANS[effectivePlanId(workspace)];
  const active = await Monitor.countDocuments({ workspaceId: workspace._id, isActive: true });
  const room = Math.max(0, limits.monitors - active);
  const paused = await Monitor.find({ workspaceId: workspace._id, pausedByPlan: true, isActive: false }).sort({ createdAt: 1 }).limit(room).select('_id');
  if (paused.length) {
    await Monitor.updateMany(
      { _id: { $in: paused.map((m) => m._id) } },
      { $set: { isActive: true, pausedByPlan: false, currentStatus: 'PENDING', consecutiveFailures: 0, nextCheckAt: new Date(), lastStatusChangeAt: new Date() } }
    );
  }
  // Put back intervals that were slowed down, if the plan allows them again.
  const slowed = await Monitor.updateMany(
    { workspaceId: workspace._id, intervalBeforeDowngrade: { $gte: limits.minInterval } },
    [{ $set: { intervalSeconds: '$intervalBeforeDowngrade', intervalBeforeDowngrade: null } }],
    { updatePipeline: true }
  );
  return { resumed: paused.length, intervalsRestored: slowed.modifiedCount };
};

/**
 * Marks a payment paid and applies the plan. Safe to call from the checkout callback, the
 * webhook and the reconciler concurrently: only the call that flips the status applies the period.
 */
export const activatePayment = async (orderId, { paymentId, method } = {}) => {
  const payment = await Payment.findOneAndUpdate(
    { orderId, status: { $in: ['created', 'failed'] } },
    { $set: { status: 'paid', paymentId, method: method || null, paidAt: new Date(), failureReason: null } },
    { returnDocument: 'after' }
  );
  if (!payment) {
    return { payment: await Payment.findOne({ orderId }), applied: false };
  }

  const workspace = await Workspace.findById(payment.workspaceId);
  if (!workspace) return { payment, applied: false };

  // Compute the period at activation time (the order may have been paid hours later).
  const now = Date.now();
  const current = effectivePlanId(workspace);
  const start =
    current === payment.plan && workspace.planExpiresAt && workspace.planExpiresAt.getTime() > now
      ? workspace.planExpiresAt.getTime()
      : now;
  const end = start + CYCLE_DAYS[payment.cycle] * DAY_MS;

  workspace.plan = payment.plan;
  workspace.billingCycle = payment.cycle;
  workspace.planExpiresAt = new Date(end);
  workspace.planEnforcedAt = null;
  await workspace.save();

  payment.periodStart = new Date(start);
  payment.periodEnd = new Date(end);
  await payment.save();

  const restored = await restoreAfterUpgrade(workspace);
  logger.info(
    `💳 ${workspace.name} activated ${payment.plan}/${payment.cycle} until ${payment.periodEnd.toISOString()} (order ${orderId}); resumed ${restored.resumed} monitor(s)`
  );

  const payer = await User.findById(payment.userId).select('name email');
  if (payer) {
    sendMail({
      to: payer.email,
      ...receiptTemplate({
        name: payer.name,
        workspaceName: workspace.name,
        planName: PLANS[payment.plan].name,
        cycle: payment.cycle,
        amount: payment.amount,
        currency: payment.currency,
        paymentId: payment.paymentId,
        periodEnd: payment.periodEnd,
      }),
    }).catch(() => {});
  }

  return { payment, applied: true };
};

export const markPaymentFailed = async (orderId, { paymentId, reason } = {}) =>
  Payment.updateOne(
    { orderId, status: 'created' },
    { $set: { status: 'failed', paymentId: paymentId || null, failureReason: String(reason || 'Payment failed').slice(0, 300) } }
  );

/**
 * Asks Razorpay what actually happened to an order and settles our record to match.
 * This is the safety net for "paid, but the browser never confirmed and no webhook arrived".
 */
export const reconcileOrder = async (payment) => {
  if (!env.RAZORPAY_ENABLED || payment.status === 'paid') return { status: payment.status };
  const attempts = await fetchOrderPayments(payment.orderId);

  let captured = attempts.find((p) => p.status === 'captured' && p.amount === payment.amount);
  const authorized = attempts.find((p) => p.status === 'authorized' && p.amount === payment.amount);
  if (!captured && authorized) {
    captured = await capturePayment(authorized.id, payment.amount, payment.currency);
  }
  if (captured?.status === 'captured') {
    await activatePayment(payment.orderId, { paymentId: captured.id, method: captured.method });
    return { status: 'paid' };
  }

  const failed = attempts.filter((p) => p.status === 'failed');
  if (failed.length && failed.length === attempts.length && payment.status === 'created') {
    const last = failed[failed.length - 1];
    await markPaymentFailed(payment.orderId, { paymentId: last.id, reason: last.error_description });
    return { status: 'failed' };
  }
  return { status: payment.status };
};

/** Reconciles recent unsettled orders (optionally for one workspace). Never throws. */
export const reconcilePending = async ({ workspaceId, maxAgeDays = 3, limit = 50 } = {}) => {
  if (!env.RAZORPAY_ENABLED) return 0;
  const filter = { status: 'created', createdAt: { $gte: new Date(Date.now() - maxAgeDays * DAY_MS) } };
  if (workspaceId) filter.workspaceId = workspaceId;
  const pending = await Payment.find(filter).sort({ createdAt: -1 }).limit(limit);
  let settled = 0;
  for (const p of pending) {
    try {
      const r = await reconcileOrder(p);
      if (r.status === 'paid') settled++;
    } catch (err) {
      logger.warn(`Reconcile ${p.orderId} failed: ${err.message}`);
    }
  }
  return settled;
};

const ownerOf = (ws) => User.findById(ws.ownerId).select('name email');

/**
 * When a paid plan lapses, bring the workspace back inside Free limits:
 * keep the oldest active monitors, pause the overflow, and slow 30s checks to 60s.
 * Both are remembered on the monitor so renewing restores them exactly.
 */
export const enforceExpiredPlans = async () => {
  const lapsed = await Workspace.find({ plan: { $ne: 'free' }, planExpiresAt: { $lt: new Date() } });
  for (const ws of lapsed) {
    const free = PLANS.free;
    const lapsedPlan = PLANS[ws.plan]?.name || ws.plan;
    const active = await Monitor.find({ workspaceId: ws._id, isActive: true }).sort({ createdAt: 1 }).select('_id');
    const overflow = active.slice(free.monitors).map((m) => m._id);
    if (overflow.length) {
      await Monitor.updateMany(
        { _id: { $in: overflow } },
        { $set: { isActive: false, pausedByPlan: true, currentStatus: 'PAUSED', lastStatusChangeAt: new Date() } }
      );
      await Incident.updateMany(
        { monitorId: { $in: overflow }, resolvedAt: null },
        [{ $set: { resolvedAt: '$$NOW', resolution: 'PAUSED', durationSeconds: { $round: [{ $divide: [{ $subtract: ['$$NOW', '$startedAt'] }, 1000] }, 0] } } }],
        { updatePipeline: true } // Mongoose 9 requires opting in to pipeline-style updates
      );
    }
    await Monitor.updateMany(
      { workspaceId: ws._id, intervalSeconds: { $lt: free.minInterval } },
      [{ $set: { intervalBeforeDowngrade: '$intervalSeconds', intervalSeconds: free.minInterval } }],
      { updatePipeline: true }
    );
    ws.plan = 'free';
    ws.billingCycle = null;
    ws.planEnforcedAt = new Date();
    await ws.save();
    logger.info(`Plan lapsed for ${ws.name}: moved to Free, paused ${overflow.length} monitor(s).`);

    const owner = await ownerOf(ws);
    if (owner) {
      sendMail({ to: owner.email, ...planEndedTemplate({ name: owner.name, workspaceName: ws.name, planName: lapsedPlan, pausedCount: overflow.length }) }).catch(() => {});
    }
  }
};

/** Emails the owner 7 days and 1 day before a paid plan ends — once per billing period. */
export const sendRenewalReminders = async () => {
  const now = Date.now();
  const soon = await Workspace.find({
    plan: { $ne: 'free' },
    planExpiresAt: { $gt: new Date(now), $lte: new Date(now + Math.max(...REMINDER_DAYS) * DAY_MS) },
  });
  for (const ws of soon) {
    const msLeft = ws.planExpiresAt.getTime() - now;
    // The tightest window we're inside (1 day beats 7 days).
    const window = [...REMINDER_DAYS].sort((a, b) => a - b).find((d) => msLeft <= d * DAY_MS);
    if (!window) continue;
    const key = `${window}d:${ws.planExpiresAt.toISOString()}`;
    if (ws.renewalRemindersSent.includes(key)) continue;

    const owner = await ownerOf(ws);
    if (!owner) continue;
    const mail = await sendMail({
      to: owner.email,
      ...renewalReminderTemplate({
        name: owner.name,
        workspaceName: ws.name,
        planName: PLANS[ws.plan].name,
        expiresAt: ws.planExpiresAt,
        daysLeft: Math.max(1, Math.ceil(msLeft / DAY_MS)),
      }),
    });
    if (mail.ok || env.NODE_ENV !== 'production') {
      await Workspace.updateOne({ _id: ws._id }, { $addToSet: { renewalRemindersSent: key } });
    }
  }
};

export const runBillingMaintenance = async () => {
  if (!isLeader()) return;
  await reconcilePending().catch((err) => logger.error(`Payment reconciliation failed: ${err.message}`));
  await sendRenewalReminders().catch((err) => logger.error(`Renewal reminders failed: ${err.message}`));
  await enforceExpiredPlans().catch((err) => logger.error(`Plan enforcer failed: ${err.message}`));
  await recheckDomains().catch((err) => logger.error(`Domain re-verification failed: ${err.message}`));
};

export const startPlanEnforcer = () => {
  runBillingMaintenance();
  setInterval(runBillingMaintenance, 10 * 60 * 1000).unref();
};
