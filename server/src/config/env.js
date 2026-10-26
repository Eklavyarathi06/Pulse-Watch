import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load server/.env no matter which directory the process was started from
// (`npm start` at the repo root, `npm run dev` in server/, Docker…). Real env vars win.
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const bool = (fallback) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback)
    .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  PORT: z.string().default('5000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGO_URI: z.string().startsWith('mongodb').default('mongodb://localhost:27017/pulse-watch'),
  JWT_SECRET: z.string().min(32).default('super_secret_jwt_key_replace_me_in_prod_must_be_32_chars'),
  // One origin, or several separated by commas. Accepts FRONTEND_URL or CLIENT_URL.
  FRONTEND_URL: z
    .string()
    .default(process.env.CLIENT_URL || 'http://localhost:5173')
    .refine((v) => v.split(',').every((o) => z.string().url().safeParse(o.trim()).success), 'FRONTEND_URL must be URL(s)'),
  ENCRYPTION_KEY: z.string().min(32).default('super_secret_encryption_key_replace_me_32_chars'),
  // Set during key rotation: the old key, still accepted for reading until everything is re-encrypted.
  ENCRYPTION_KEY_PREVIOUS: z.string().min(32).optional(),
  SMTP_HOST: z.string().default('smtp.ethereal.email'),
  SMTP_PORT: z.string().default('587').transform(Number),
  SMTP_USER: z.string().default('user'),
  SMTP_PASS: z.string().default('pass'),
  SMTP_FROM: z.string().default('alerts@pulse-watch.com'),
  // Seconds between scheduler sweeps for due monitors.
  SCHEDULER_TICK_SECONDS: z.string().default('10').transform(Number),
  // Per-IP attempts per 15 minutes on sign-in/sign-up/reset endpoints.
  AUTH_RATE_LIMIT_MAX: z.string().default('20').transform(Number),
  // Lets a local dev instance monitor localhost / LAN targets. Ignored when NODE_ENV=production.
  ALLOW_PRIVATE_TARGETS: bool('false'),
  // One-click "Explore the demo" login. Ignored when NODE_ENV=production.
  ALLOW_DEMO_LOGIN: bool('true'),

  // Public URL of the web app, used in email links. Defaults to the first FRONTEND_URL.
  APP_URL: z.string().url().optional(),
  // Session cookie. Defaults to 'none' in production (cross-site Vercel <-> Render) and 'lax' in dev.
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default(process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
  COOKIE_DOMAIN: z.string().optional(),
  // Serve client/dist from this server (single-origin deploy, recommended).
  SERVE_CLIENT: bool('false'),
  // Block monitor/channel/invite/billing actions until the email address is confirmed.
  REQUIRE_EMAIL_VERIFICATION: bool('true'),

  // Razorpay keys (dashboard.razorpay.com -> Settings -> API Keys; use Test Mode keys)
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;

env.APP_URL = (env.APP_URL || env.FRONTEND_URL.split(',')[0]).trim().replace(/\/$/, '');
env.RAZORPAY_ENABLED = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

if (env.COOKIE_SAMESITE === 'none' && env.NODE_ENV !== 'production') {
  console.warn('COOKIE_SAMESITE=none requires HTTPS (Secure cookies); browsers drop it over plain http.');
}

if (env.NODE_ENV === 'production') {
  const weak = ['JWT_SECRET', 'ENCRYPTION_KEY'].filter((k) => !process.env[k]);
  if (weak.length) {
    console.error(`❌ ${weak.join(', ')} must be set explicitly in production.`);
    process.exit(1);
  }
  if (env.JWT_SECRET === env.ENCRYPTION_KEY) {
    console.error('❌ JWT_SECRET and ENCRYPTION_KEY must be different secrets.');
    process.exit(1);
  }
}
