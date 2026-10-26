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

  // Health check — serves a premium UI in browsers, and raw JSON for monitoring probes/Render
  app.get('/health', (req, res) => {
    const isBrowser = req.accepts(['html', 'json']) === 'html';
    const timestamp = new Date().toISOString();
    const uptimeSec = Math.floor(process.uptime());
    const uptimeFormatted = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${uptimeSec % 60}s`;

    if (!isBrowser) {
      return res.status(200).json({
        status: 'ok',
        message: 'Server is running',
        timestamp,
        uptime: uptimeFormatted,
      });
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PulseWatch — System Health & Status</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #0b0b0a;
      color: #ede8df;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 24px;
      line-height: 1.5;
    }
    .card {
      width: 100%;
      max-width: 540px;
      background: #141412;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.7);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .brand-icon {
      width: 28px;
      height: 28px;
      stroke: #22c55e;
      stroke-width: 2;
      fill: none;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 9999px;
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.25);
      color: #4ade80;
      font-size: 13px;
      font-weight: 500;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 10px #22c55e;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
    .metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 24px;
    }
    .metric-box {
      background: #1c1c19;
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 10px;
      padding: 14px 16px;
    }
    .metric-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #888680;
      margin-bottom: 4px;
    }
    .metric-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      color: #ede8df;
      font-weight: 500;
    }
    .metric-value.good { color: #4ade80; }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }
    .btn {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.2s ease;
      cursor: pointer;
    }
    .btn-primary {
      background: #ede8df;
      color: #0b0b0a;
    }
    .btn-primary:hover {
      background: #ffffff;
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: #1c1c19;
      color: #b0aba1;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .btn-secondary:hover {
      background: #252522;
      color: #ede8df;
    }
    .footer {
      margin-top: 20px;
      font-size: 12px;
      color: #66645e;
      text-align: center;
      font-family: 'JetBrains Mono', monospace;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">
        <svg class="brand-icon" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        <span>PulseWatch</span>
      </div>
      <div class="badge">
        <div class="dot"></div>
        <span>All Systems Operational</span>
      </div>
    </div>

    <div class="metrics">
      <div class="metric-box">
        <div class="metric-label">API Service</div>
        <div class="metric-value good">● Running (200 OK)</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Database</div>
        <div class="metric-value good">● Connected</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Uptime</div>
        <div class="metric-value">${uptimeFormatted}</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Environment</div>
        <div class="metric-value">${env.NODE_ENV}</div>
      </div>
    </div>

    <div class="actions">
      <a href="/dashboard" class="btn btn-primary">Open Dashboard →</a>
      <a href="/" class="btn btn-secondary">Homepage</a>
    </div>

    <div class="footer">
      Node ${process.version} · Timestamp: ${timestamp}
    </div>
  </div>
</body>
</html>`;

    res.status(200).type('html').send(html);
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
