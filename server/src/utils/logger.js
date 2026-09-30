import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  redact: {
    paths: [
      'req.headers.cookie', 'req.headers.authorization', 'headers.cookie', 'headers.authorization',
      'err.config.headers', 'err.config.data', 'err.config.url', 'err.request', 'err.response.config',
      '*.password', '*.passwordHash', '*.token', '*.secret', '*.totpSecretEnc', '*.urlEnc', '*.headersEnc', '*.bodyEnc',
    ],
    censor: '[redacted]',
  },
  transport: env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    }
  } : undefined,
});
