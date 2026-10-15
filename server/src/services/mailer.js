import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let transporter = null;

export const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      // Don't let a slow or unreachable mail server hold an HTTP request hostage.
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 15000,
    });
  }
  return transporter;
};

/**
 * Sends a transactional email. Never throws — returns { ok, error }.
 * In development the message (with its links) is also printed to the server log, so
 * verification / reset / invite flows can be tested without a working SMTP account.
 */
export const sendMail = async ({ to, subject, text, html }) => {
  if (env.NODE_ENV !== 'production') {
    const body = text.split('\n').map((l) => `   ${l}`).join('\n');
    logger.info(`\n✉️  EMAIL to ${to}\n   Subject: ${subject}\n${body}\n`);
  }
  try {
    await getTransporter().sendMail({ from: env.SMTP_FROM, to, subject, text, html });
    return { ok: true, error: null };
  } catch (error) {
    logger.warn(`Email to ${to} failed: ${error.message}`);
    return { ok: false, error: error.message };
  }
};
