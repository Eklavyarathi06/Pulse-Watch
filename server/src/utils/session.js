import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ISSUER = 'pulsewatch';
const SESSION_TTL = '7d';
const MFA_TTL = '5m';

const secure = () => env.NODE_ENV === 'production' || env.COOKIE_SAMESITE === 'none';

/**
 * In production the cookie uses the "__Host-" prefix: browsers then refuse it unless it is
 * Secure, path=/ and has no Domain — so no subdomain or plain-http page can set or overwrite it.
 */
export const SESSION_COOKIE = secure() && !env.COOKIE_DOMAIN ? '__Host-pw_session' : 'pw_session';

export const cookieBase = () => ({
  httpOnly: true,
  secure: secure(),
  sameSite: env.COOKIE_SAMESITE,
  path: '/',
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
});

const sign = (payload, audience, expiresIn) =>
  jwt.sign(payload, env.JWT_SECRET, { algorithm: 'HS256', issuer: ISSUER, audience, expiresIn });

const verify = (token, audience) =>
  jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience });

export const signSession = (user) => sign({ id: String(user._id), tv: user.tokenVersion }, 'session', SESSION_TTL);
export const verifySession = (token) => verify(token, 'session');

// Short-lived ticket proving the password step passed; only redeemable at /auth/login/2fa.
export const signMfaTicket = (user) => sign({ id: String(user._id), tv: user.tokenVersion }, 'mfa', MFA_TTL);
export const verifyMfaTicket = (token) => verify(token, 'mfa');

export const setSessionCookie = (res, user) =>
  res.cookie(SESSION_COOKIE, signSession(user), { ...cookieBase(), maxAge: 7 * 24 * 60 * 60 * 1000 });

export const clearSessionCookie = (res) => {
  res.clearCookie(SESSION_COOKIE, cookieBase());
  res.clearCookie('jwt', cookieBase()); // pre-hardening cookie name
};
