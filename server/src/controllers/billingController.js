import { z } from 'zod';
import crypto from 'crypto';
import asyncHandler from 'express-async-handler';
import { Payment } from '../models/Payment.js';
import { Workspace } from '../models/Workspace.js';
import { Monitor } from '../models/Monitor.js';
import { AlertChannel } from '../models/AlertChannel.js';
import { Membership } from '../models/Membership.js';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';
import { PLANS, CURRENCY, effectivePlanId } from '../config/plans.js';
import { createOrder, fetchPayment, capturePayment, verifyPaymentSignature, verifyWebhookSignature, isTestMode } from '../services/razorpay.js';
import { quote, activatePayment, markPaymentFailed, reconcilePending } from '../services/billingService.js';
import { serializeWorkspace } from '../services/workspaceService.js';
import { logger } from '../utils/logger.js';

const publicPlans = () =>
  Object.values(PLANS).map((p) => ({
    id: p.id,
    name: p.name,
    monitors: p.monitors,
    minInterval: p.minInterval,
    channels: p.channels,
    members: p.members,
    price: p.price,
  }));

const toPublicPayment = (p) => ({
  _id: p._id,
  orderId: p.orderId,
  paymentId: p.paymentId,
  plan: p.plan,
  cycle: p.cycle,
  amount: p.amount,
  currency: p.currency,
  status: p.status,
  method: p.method,
  failureReason: p.failureReason,
  periodStart: p.periodStart,
  periodEnd: p.periodEnd,
  paidAt: p.paidAt,
  createdAt: p.createdAt,
});

export const getPlans = (req, res) => {
  res.json({ success: true, data: { currency: CURRENCY, plans: publicPlans(), enabled: env.RAZORPAY_ENABLED } });
};

export const getBilling = asyncHandler(async (req, res) => {
  const wsId = req.workspace._id;
  // Settle any order Razorpay says was paid but we never heard back about (closed tab, lost callback).
  const settled = await reconcilePending({ workspaceId: wsId, limit: 5 }).catch(() => 0);
  const workspace = settled ? await Workspace.findById(wsId) : req.workspace;
  const [monitors, activeMonitors, channels, members, payments] = await Promise.all([
    Monitor.countDocuments({ workspaceId: wsId }),
    Monitor.countDocuments({ workspaceId: wsId, isActive: true }),
    AlertChannel.countDocuments({ workspaceId: wsId }),
    Membership.countDocuments({ workspaceId: wsId }),
    Payment.find({ workspaceId: wsId, status: { $in: ['paid', 'failed'] } }).sort({ createdAt: -1 }).limit(24).lean(),
  ]);

  res.json({
    success: true,
    data: {
      workspace: serializeWorkspace(workspace, req.membership.role),
      usage: { monitors, activeMonitors, channels, members },
      reconciled: settled,
      plans: publicPlans(),
      currency: CURRENCY,
      payments: payments.map(toPublicPayment),
      razorpay: { enabled: env.RAZORPAY_ENABLED, keyId: env.RAZORPAY_KEY_ID || null, testMode: isTestMode() },
      canManage: req.membership.role === 'owner',
    },
  });
});

const orderSchema = z.object({
  plan: z.enum(['pro', 'team']),
  cycle: z.enum(['monthly', 'annual']),
});

export const createCheckoutOrder = asyncHandler(async (req, res, next) => {
  if (!env.RAZORPAY_ENABLED) {
    return next(new AppError('Payments are not configured yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to server/.env.', 503));
  }
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('Choose a plan and billing cycle', 400));
  const { plan, cycle } = parsed.data;

  const q = await quote(req.workspace, plan, cycle);
  if (q.error) return next(new AppError(q.error, 409));

  const receipt = `pw_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`; // ≤ 40 chars
  let order;
  try {
    order = await createOrder({
      amount: q.amount,
      currency: CURRENCY,
      receipt,
      notes: { workspaceId: req.workspace._id.toString(), plan, cycle, userId: req.user._id.toString() },
    });
  } catch (err) {
    logger.error(`Razorpay order failed: ${err.message}`);
    return next(new AppError(err.status === 401 ? 'Razorpay rejected the API keys. Check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.' : 'Could not start checkout. Please try again.', 502));
  }

  await Payment.create({
    workspaceId: req.workspace._id,
    userId: req.user._id,
    orderId: order.id,
    plan,
    cycle,
    amount: q.amount,
    currency: CURRENCY,
    receipt,
  });

  res.status(201).json({
    success: true,
    data: {
      keyId: env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: q.amount,
      currency: CURRENCY,
      price: q.price,
      credit: q.credit,
      isRenewal: q.isRenewal,
      periodEnd: q.periodEnd,
      description: `${PLANS[plan].name} · ${cycle === 'annual' ? '1 year' : '1 month'} · ${req.workspace.name}`,
      prefill: { name: req.user.name, email: req.user.email },
    },
  });
});

const verifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export const verifyCheckout = asyncHandler(async (req, res, next) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('Incomplete payment confirmation', 400));
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = parsed.data;

  const payment = await Payment.findOne({ orderId, workspaceId: req.workspace._id });
  if (!payment) return next(new AppError('Order not found for this workspace', 404));

  // 1) Signature proves the callback really came from Razorpay checkout for this order.
  if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
    await markPaymentFailed(orderId, { paymentId, reason: 'Signature verification failed' });
    return next(new AppError('Payment could not be verified. You have not been charged twice — contact support if money left your account.', 400));
  }

  if (payment.status !== 'paid') {
    // 2) Ask Razorpay directly: right order, right amount, money actually captured.
    let rp;
    try {
      rp = await fetchPayment(paymentId);
    } catch (err) {
      return next(new AppError(`Could not confirm the payment with Razorpay (${err.message}). It will be applied automatically once confirmed.`, 502));
    }
    if (rp.order_id !== orderId || rp.amount !== payment.amount || rp.currency !== payment.currency) {
      await markPaymentFailed(orderId, { paymentId, reason: 'Payment did not match the order' });
      return next(new AppError('Payment details did not match this order.', 400));
    }
    if (rp.status === 'authorized') {
      rp = await capturePayment(paymentId, payment.amount, payment.currency);
    }
    if (rp.status !== 'captured') {
      await markPaymentFailed(orderId, { paymentId, reason: rp.error_description || `Payment ${rp.status}` });
      return next(new AppError(`Payment is ${rp.status}. Please try again.`, 402));
    }
    await activatePayment(orderId, { paymentId, method: rp.method });
  }

  const fresh = await Payment.findOne({ orderId });
  const workspace = await Workspace.findById(req.workspace._id);
  res.json({
    success: true,
    data: { payment: toPublicPayment(fresh), workspace: serializeWorkspace(workspace, req.membership.role) },
  });
});

export const reportCheckoutFailure = asyncHandler(async (req, res) => {
  const orderId = String(req.body?.orderId || '');
  if (orderId) {
    await Payment.updateOne(
      { orderId, workspaceId: req.workspace._id, status: 'created' },
      { $set: { status: 'failed', paymentId: req.body?.paymentId || null, failureReason: String(req.body?.reason || 'Payment failed').slice(0, 300) } }
    );
  }
  res.json({ success: true, data: null });
});

/**
 * Razorpay webhook (Dashboard → Webhooks → URL /api/v1/billing/webhook, events: payment.captured,
 * order.paid, payment.failed). Covers the case where the buyer closes the tab right after paying.
 */
export const razorpayWebhook = asyncHandler(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!verifyWebhookSignature(raw, req.get('x-razorpay-signature'))) {
    logger.warn('Rejected Razorpay webhook with an invalid signature');
    return res.status(400).json({ success: false });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ success: false });
  }

  const entity = event.payload?.payment?.entity;
  const orderId = entity?.order_id || event.payload?.order?.entity?.id;
  if (!orderId) return res.json({ success: true });

  const payment = await Payment.findOne({ orderId });
  if (!payment) return res.json({ success: true }); // not one of ours

  if ((event.event === 'payment.captured' || event.event === 'order.paid') && (!entity || entity.amount === payment.amount)) {
    await activatePayment(orderId, { paymentId: entity?.id, method: entity?.method });
  } else if (event.event === 'payment.failed') {
    await markPaymentFailed(orderId, { paymentId: entity?.id, reason: entity?.error_description });
  }

  res.json({ success: true });
});

export const currentPlanId = (ws) => effectivePlanId(ws);
