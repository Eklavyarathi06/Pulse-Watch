import rateLimit from 'express-rate-limit';

/**
 * Removes MongoDB operator keys ("$gt", "$where", …) and dotted paths from any client-supplied
 * object, so a JSON body or query string can never turn into a query operator (NoSQL injection).
 * Also drops prototype-pollution keys.
 */
const BAD_KEY = /^\$|\./;
const POLLUTION = new Set(['__proto__', 'constructor', 'prototype']);

const scrub = (value, depth = 0) => {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  for (const key of Object.keys(value)) {
    if (BAD_KEY.test(key) || POLLUTION.has(key)) delete value[key];
    else value[key] = scrub(value[key], depth + 1);
  }
  return value;
};

export const sanitizeInput = (req, res, next) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) scrub(req.body);
  if (req.params) scrub(req.params);
  // req.query is a getter in Express 5-style routers; mutate keys in place.
  if (req.query && typeof req.query === 'object') scrub(req.query);
  next();
};

/** Private API responses must never be stored by browsers, proxies or CDNs. */
export const noStore = (req, res, next) => {
  if (!req.path.startsWith('/v1/public') && !req.path.startsWith('/v1/billing/plans')) {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
  }
  next();
};

/** Coarse per-IP ceiling for the whole API; individual routes have tighter limits. */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 429, message: 'Too many requests. Please slow down.' } },
});

export const permissionsPolicy = (req, res, next) => {
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com" "https://api.razorpay.com"), usb=(), interest-cohort=()');
  next();
};
