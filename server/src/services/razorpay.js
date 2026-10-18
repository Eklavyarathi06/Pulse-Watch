import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { safeEqualHex } from '../utils/tokens.js';

const client = () =>
  axios.create({
    baseURL: 'https://api.razorpay.com/v1',
    auth: { username: env.RAZORPAY_KEY_ID, password: env.RAZORPAY_KEY_SECRET },
    timeout: 15000,
  });

const unwrap = async (promise) => {
  try {
    const res = await promise;
    return res.data;
  } catch (err) {
    const description = err.response?.data?.error?.description || err.message;
    const e = new Error(`Razorpay: ${description}`);
    e.status = err.response?.status;
    throw e;
  }
};

export const isTestMode = () => String(env.RAZORPAY_KEY_ID || '').startsWith('rzp_test_');

export const createOrder = ({ amount, currency, receipt, notes }) =>
  unwrap(client().post('/orders', { amount, currency, receipt, notes, payment_capture: 1 }));

export const fetchPayment = (paymentId) => unwrap(client().get(`/payments/${encodeURIComponent(paymentId)}`));

export const fetchOrderPayments = (orderId) =>
  unwrap(client().get(`/orders/${encodeURIComponent(orderId)}/payments`)).then((d) => d.items || []);

export const capturePayment =(paymentId, amount, currency) =>
  unwrap(client().post(`/payments/${encodeURIComponent(paymentId)}/capture`, { amount, currency }));

const hmac = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

/** Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export const verifyPaymentSignature = ({ orderId, paymentId, signature }) =>
  Boolean(env.RAZORPAY_KEY_SECRET) && safeEqualHex(hmac(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`), String(signature || ''));

/** Webhook signature: HMAC_SHA256(raw request body, webhook secret). */
export const verifyWebhookSignature = (rawBody, signature) =>
  Boolean(env.RAZORPAY_WEBHOOK_SECRET) && safeEqualHex(hmac(env.RAZORPAY_WEBHOOK_SECRET, rawBody), String(signature || ''));
