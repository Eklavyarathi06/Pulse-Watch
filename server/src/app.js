import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { AppError } from './utils/AppError.js';
import authRoutes from './routes/authRoutes.js';
import monitorRoutes from './routes/monitorRoutes.js';
import alertChannelRoutes from './routes/alertChannelRoutes.js';
import statsRoutes from './routes/statsRoutes.js';
import publicRoutes from './routes/publicRoutes.js';
import workspaceRoutes from './routes/workspaceRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import domainRoutes from './routes/domainRoutes.js';
import { razorpayWebhook } from './controllers/billingController.js';
import { sanitizeInput, noStore, globalLimiter, permissionsPolicy } from './middleware/hardening.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');

  // Behind a proxy (Render/Fly/Railway/Nginx) this makes req.ip and secure cookies correct.
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

  // FRONTEND_URL or CLIENT_URL may list several origins (comma-separated). In development any
  // localhost / 127.0.0.1 port is accepted too, since Vite hops to 5174, 5175… when 5173 is busy.
  const rawOrigins = [env.FRONTEND_URL, process.env.CLIENT_URL].filter(Boolean).join(',');
  const allowedOrigins = rawOrigins.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  const devLocalOrigin = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;
  const isAllowedOrigin = (origin) =>
    allowedOrigins.includes(origin) || (env.NODE_ENV !== 'production' && devLocalOrigin.test(origin));

  // Security headers. The CSP matters when this server also serves the web app (SERVE_CLIENT):
  // it allows Google Fonts and Razorpay Checkout and nothing else third-party.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", 'https://checkout.razorpay.com', 'https://accounts.google.com'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'img-src': ["'self'", 'data:', 'https:'],
          'connect-src': ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com', 'https://accounts.google.com', ...allowedOrigins],
          'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://accounts.google.com'],
        },
      },
      crossOriginEmbedderPolicy: false,
      // Two years, all subdomains, eligible for browser preload lists (production / HTTPS only).
      strictTransportSecurity: env.NODE_ENV === 'production' ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );
  app.use(permissionsPolicy);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || isAllowedOrigin(origin)) return callback(null, true);
        logger.warn(`CORS blocked request from ${origin}. Add it to FRONTEND_URL.`);
        return callback(null, false);
      },
      credentials: true,
    })
  );

  // Razorpay webhook needs the exact raw bytes to verify its HMAC — register before express.json().
  app.post('/api/v1/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }), razorpayWebhook);

  app.use('/api', globalLimiter);
  app.use(express.json({ limit: '64kb', strict: true })); // request bodies on monitors can be up to 10k chars
  app.use(cookieParser());
  app.use(sanitizeInput);
  app.use('/api', noStore);

  // CSRF defence-in-depth: browsers always send Origin on cross-site state-changing requests.
  // With SameSite=None cookies this is what stops another site from acting as the user.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next(); // non-browser clients (curl, server-to-server)
    if (isAllowedOrigin(origin)) return next();
    const self = `${req.protocol}://${req.get('host')}`;
    if (origin === self) return next();
    return next(new AppError('Cross-site request blocked', 403));
  });

  // Request logging
  app.use((req, res, next) => {
    logger.debug({ method: req.method, url: req.url }, 'Incoming request');
    next();
  });

  // API Routes — public first, and every router mounted on its own prefix so a
  // router-level `protect` can never swallow someone else's paths.
  app.use('/api/v1/public', publicRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/workspaces', workspaceRoutes);
  app.use('/api/v1/billing', billingRoutes);
  app.use('/api/v1/domains', domainRoutes);
  app.use('/api/v1/monitors', monitorRoutes);
  app.use('/api/v1/alert-channels', alertChannelRoutes);
  app.use('/api/v1/dashboard', statsRoutes);

  // Health check
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is running', timestamp: new Date().toISOString() });
  });

  // Single-origin deploy: serve the built web app and let the SPA handle its own routes.
  if (env.SERVE_CLIENT) {
    if (!fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
      logger.warn(`SERVE_CLIENT=true but ${CLIENT_DIST} has no build. Run "npm run build" in client/.`);
    } else {
      app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1y', immutable: true, setHeaders: (res, file) => {
        if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      } }));
      app.get(/^\/(?!api\/|health$).*/, (req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(CLIENT_DIST, 'index.html'));
      });
    }
  }

  // 404 Handler
  app.use((req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
  });

  // Centralized Error Handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Normalise well-known library errors into operational ones.
    if (err.type === 'entity.parse.failed') err = new AppError('Malformed JSON body', 400);
    else if (err.type === 'entity.too.large') err = new AppError('Request body too large', 413);
    else if (err.name === 'CastError') err = new AppError(`Invalid ${err.path}`, 400);
    else if (err.name === 'ValidationError') err = new AppError('Invalid input data', 400, err.errors);
    else if (err.code === 11000) err = new AppError('Duplicate value', 409);

    const statusCode = err.statusCode || 500;

    if (env.NODE_ENV === 'development') {
      if (statusCode >= 500) logger.error({ err }, err.message);
      return res.status(statusCode).json({
        success: false,
        error: { code: statusCode, message: err.message, details: err.details, stack: err.stack },
      });
    }

    // Production: don't leak stack traces
    if (statusCode >= 500) logger.error({ err }, 'Error');
    if (err.isOperational) {
      return res.status(statusCode).json({
        success: false,
        error: { code: statusCode, message: err.message, details: err.details },
      });
    }
    return res.status(500).json({ success: false, error: { code: 500, message: 'Something went very wrong!' } });
  });

  return app;
};
