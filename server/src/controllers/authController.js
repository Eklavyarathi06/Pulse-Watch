import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import asyncHandler from 'express-async-handler';
import { User } from '../models/User.js';
import { Monitor } from '../models/Monitor.js';
import { Workspace } from '../models/Workspace.js';
import { Membership } from '../models/Membership.js';
import { Invitation } from '../models/Invitation.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { createToken, hashToken } from '../utils/tokens.js';
import { checkPassword } from '../utils/passwordPolicy.js';
import { encryptField, decryptField } from '../utils/crypto.js';
import { generateTotpSecret, verifyTotp, otpauthUrl, generateRecoveryCodes, hashRecoveryCode } from '../utils/totp.js';
import { setSessionCookie, clearSessionCookie, signMfaTicket, verifyMfaTicket } from '../utils/session.js';
import { sealMonitorSecrets, userCtx } from '../services/secrets.js';
import { sendMail } from '../services/mailer.js';
import { verifyEmailTemplate, resetPasswordTemplate } from '../services/email/templates.js';
import { createWorkspaceFor, listWorkspacesFor, resolveWorkspaceContext, serializeWorkspace } from '../services/workspaceService.js';
import { deleteWorkspaceCascade } from '../services/workspaceCleanup.js';
import { audit } from '../services/audit.js';
import { logger } from '../utils/logger.js';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const DUMMY_HASH = bcrypt.hashSync('pulsewatch-timing-equaliser', 10);

// Keep in-memory map of latest issued codes for sandbox/helper fallback when SMTP is unconfigured
const pendingVerificationCodes = new Map();

/** Everything the client needs after any auth event. */
export const sessionPayload = async (user) => {
  const { workspace, membership } = await resolveWorkspaceContext(user);
  const fresh = await User.findById(user._id);
  const isUnverified = Boolean(fresh && !fresh.emailVerified && env.REQUIRE_EMAIL_VERIFICATION);
  // Security: NEVER expose verification codes on screen in production!
  // Codes are only accessible via real email delivery, or in local development.
  const helperCode = env.NODE_ENV === 'development' && isUnverified
    ? pendingVerificationCodes.get(String(fresh._id))
    : undefined;

  return {
    user: fresh.toJSON(),
    workspace: serializeWorkspace(workspace, membership.role),
    workspaces: await listWorkspacesFor(user._id),
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
    twoFactorRequired: Boolean(workspace.require2FA && !fresh.totpEnabled),
    devVerificationCode: helperCode,
  };
};

const sendSession = async (user, statusCode, res) => {
  setSessionCookie(res, user);
  res.status(statusCode).json({ success: true, data: await sessionPayload(user) });
};

const issueVerification = async (user) => {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const { token, hash } = createToken();
  user.emailVerifyTokenHash = hash;
  user.emailVerifyCode = hashToken(code);
  user.emailVerifyExpires = new Date(Date.now() + VERIFY_TTL_MS);
  user.emailVerifySentAt = new Date();
  await user.save({ validateBeforeSave: false });

  pendingVerificationCodes.set(String(user._id), code);
  setTimeout(() => pendingVerificationCodes.delete(String(user._id)), VERIFY_TTL_MS).unref?.();

  const mail = await sendMail({ to: user.email, ...verifyEmailTemplate({ name: user.name, token, code }) });
  return { ...mail, code };
};

const firstIssue = (parsed, fallback = 'Invalid input data') => parsed.error.issues[0]?.message || fallback;

/* ─────────────── account lockout ─────────────── */

const lockedMessage = 'Too many failed attempts. This account is temporarily locked — try again later or reset your password.';

const isLocked = (user) => user.lockUntil && user.lockUntil.getTime() > Date.now();

/** Exponential lock after 5 failures: 15 min, 30 min, 1 h … capped at 24 h. */
const registerFailure = async (req, user, reason) => {
  const failed = (user.failedLogins || 0) + 1;
  const update = { failedLogins: failed };
  if (failed >= MAX_FAILED_LOGINS) {
    const minutes = Math.min(24 * 60, 15 * 2 ** (failed - MAX_FAILED_LOGINS));
    update.lockUntil = new Date(Date.now() + minutes * 60 * 1000);
  }
  await User.updateOne({ _id: user._id }, { $set: update });
  audit(req, update.lockUntil ? 'auth.account_locked' : 'auth.login_failed', { actor: user, workspaceId: null, meta: { reason, failed } });
};

const clearFailures = (user) => User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockUntil: null, lastLoginAt: new Date() } });

/* ─────────────── register / login ─────────────── */

const registerSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(254),
  password: z.string().max(200),
  name: z.string().trim().min(1, 'Name is required').max(80),
  company: z.string().trim().max(80).optional(),
  inviteToken: z.string().max(200).optional(),
});

export const register = asyncHandler(async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError(firstIssue(parsed), 400, parsed.error.format()));

  const { email, password, name, company, inviteToken } = parsed.data;
  const normalized = email.toLowerCase();
  const weak = checkPassword(password, { email: normalized, name });
  if (weak) return next(new AppError(weak, 400));

  if (await User.exists({ email: normalized })) {
    return next(new AppError('An account with this email already exists. Sign in instead.', 400));
  }

  // Joining via invitation: the invite link proves ownership of the inbox.
  let invitation = null;
  if (inviteToken) {
    invitation = await Invitation.findOne({ tokenHash: hashToken(inviteToken), acceptedAt: null, expiresAt: { $gt: new Date() } });
    if (!invitation) return next(new AppError('This invitation is invalid or has expired.', 400));
    if (invitation.email !== normalized) {
      return next(new AppError(`This invitation was sent to ${invitation.email}. Sign up with that address.`, 400));
    }
  }

  const user = await User.create({
    email: normalized,
    passwordHash: password, // pre-save hook hashes it
    name,
    emailVerified: Boolean(invitation),
    lastLoginAt: new Date(),
    passwordChangedAt: new Date(),
  });

  if (invitation) {
    await Membership.updateOne(
      { workspaceId: invitation.workspaceId, userId: user._id },
      { $setOnInsert: { role: invitation.role } },
      { upsert: true }
    );
    invitation.acceptedAt = new Date();
    await invitation.save();
    user.currentWorkspaceId = invitation.workspaceId;
    await user.save({ validateBeforeSave: false });
    audit(req, 'member.joined', { actor: user, workspaceId: invitation.workspaceId, targetType: 'user', targetId: user._id, targetName: user.email, meta: { role: invitation.role } });
  } else {
    const ws = await createWorkspaceFor(user, company || null);
    audit(req, 'workspace.created', { actor: user, workspaceId: ws._id, targetType: 'workspace', targetId: ws._id, targetName: ws.name });
    await issueVerification(user);
  }

  await sendSession(user, 201, res);
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

export const login = asyncHandler(async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('Please provide email and password', 400));

  const { email, password } = parsed.data;
  const invalidMsg = 'Invalid email or password';

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    // Same bcrypt cost as a real check, so response time doesn't reveal which emails exist.
    await bcrypt.compare(password, DUMMY_HASH);
    return next(new AppError(invalidMsg, 401));
  }
  if (isLocked(user)) {
    await bcrypt.compare(password, DUMMY_HASH);
    return next(new AppError(lockedMessage, 429));
  }
  if (!(await user.comparePassword(password))) {
    await registerFailure(req, user, 'password');
    return next(new AppError(invalidMsg, 401));
  }

  // Second factor: the password alone never yields a session.
  if (user.totpEnabled) {
    return res.status(200).json({ success: true, data: { mfaRequired: true, mfaTicket: signMfaTicket(user) } });
  }

  await clearFailures(user);
  audit(req, 'auth.login', { actor: user, workspaceId: user.currentWorkspaceId });
  await sendSession(user, 200, res);
});

const mfaSchema = z.object({
  mfaTicket: z.string().min(10).max(2000),
  code: z.string().trim().min(6).max(20),
});

/** Second step of login: authenticator code or a single-use recovery code. */
export const loginTwoFactor = asyncHandler(async (req, res, next) => {
  const parsed = mfaSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('Enter the 6-digit code from your authenticator app', 400));

  let ticket;
  try {
    ticket = verifyMfaTicket(parsed.data.mfaTicket);
  } catch {
    return next(new AppError('Your sign-in expired. Enter your password again.', 401));
  }

  const user = await User.findById(ticket.id).select('+totpSecretEnc +totpLastStep +recoveryCodeHashes');
  if (!user || user.tokenVersion !== ticket.tv || !user.totpEnabled) {
    return next(new AppError('Your sign-in expired. Enter your password again.', 401));
  }
  if (isLocked(user)) return next(new AppError(lockedMessage, 429));

  const code = parsed.data.code;
  let usedRecovery = false;
  if (/^\d{6}$/.test(code.replace(/\s/g, ''))) {
    const secret = decryptField(user.totpSecretEnc, userCtx(user._id, 'totp'));
    const step = secret ? verifyTotp(secret, code, { lastStep: user.totpLastStep }) : null;
    if (step === null) {
      await registerFailure(req, user, '2fa');
      return next(new AppError('That code is not valid. Check your authenticator app and try again.', 401));
    }
    await User.updateOne({ _id: user._id }, { $set: { totpLastStep: step } }); // a code works once
  } else {
    const hash = hashRecoveryCode(code);
    const res2 = await User.updateOne({ _id: user._id, recoveryCodeHashes: hash }, { $pull: { recoveryCodeHashes: hash } });
    if (!res2.modifiedCount) {
      await registerFailure(req, user, 'recovery_code');
      return next(new AppError('That recovery code is not valid or was already used.', 401));
    }
    usedRecovery = true;
  }

  await clearFailures(user);
  audit(req, usedRecovery ? 'auth.login_recovery_code' : 'auth.login', { actor: user, workspaceId: user.currentWorkspaceId, meta: { mfa: true } });
  await sendSession(user, 200, res);
});

export const logout = (req, res) => {
  clearSessionCookie(res);
  res.status(200).json({ success: true, data: null });
};

export const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: await sessionPayload(req.user) });
});

// Signs out every device by invalidating all previously issued tokens.
export const logoutAll = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  audit(req, 'auth.logout_all', { workspaceId: req.user.currentWorkspaceId });
  clearSessionCookie(res);
  res.status(200).json({ success: true, data: null });
});

/* ─────────────── two-factor authentication ─────────────── */

export const twoFactorSetup = asyncHandler(async (req, res, next) => {
  if (req.user.totpEnabled) return next(new AppError('Two-factor authentication is already on', 409));
  const secret = generateTotpSecret();
  await User.updateOne({ _id: req.user._id }, { $set: { totpPendingEnc: encryptField(secret, userCtx(req.user._id, 'totp-pending')) } });
  const url = otpauthUrl({ secret, account: req.user.email });
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0b0b0a', light: '#ede8df' } });
  // The seed goes to the account owner only, once, so they can add it to their app.
  res.json({ success: true, data: { secret, otpauthUrl: url, qr } });
});

export const twoFactorEnable = asyncHandler(async (req, res, next) => {
  const code = String(req.body?.code || '');
  const user = await User.findById(req.user._id).select('+totpPendingEnc');
  const secret = decryptField(user.totpPendingEnc, userCtx(user._id, 'totp-pending'));
  if (!secret) return next(new AppError('Start the setup again — the pending secret expired.', 400));
  const step = verifyTotp(secret, code);
  if (step === null) return next(new AppError('That code is not valid. Make sure your phone’s clock is correct.', 400));

  const codes = generateRecoveryCodes();
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        totpEnabled: true,
        totpSecretEnc: encryptField(secret, userCtx(user._id, 'totp')),
        totpPendingEnc: null,
        totpLastStep: step,
        recoveryCodeHashes: codes.map(hashRecoveryCode),
      },
    }
  );
  audit(req, 'auth.2fa_enabled', { workspaceId: req.user.currentWorkspaceId });
  res.json({ success: true, data: { recoveryCodes: codes } });
});

const requirePasswordAndCode = async (req, user) => {
  if (!(await user.comparePassword(String(req.body?.password || '')))) return 'Password is incorrect';
  const full = await User.findById(user._id).select('+totpSecretEnc +totpLastStep');
  const secret = decryptField(full.totpSecretEnc, userCtx(user._id, 'totp'));
  if (!secret || verifyTotp(secret, req.body?.code, { lastStep: full.totpLastStep }) === null) return 'Authenticator code is not valid';
  return null;
};

export const twoFactorDisable = asyncHandler(async (req, res, next) => {
  if (!req.user.totpEnabled) return next(new AppError('Two-factor authentication is not on', 409));
  const err = await requirePasswordAndCode(req, req.user);
  if (err) return next(new AppError(err, 400));
  const enforced = await Membership.find({ userId: req.user._id }).then((ms) =>
    Workspace.findOne({ _id: { $in: ms.map((m) => m.workspaceId) }, require2FA: true }).select('name')
  );
  if (enforced) return next(new AppError(`${enforced.name} requires two-factor authentication, so it can’t be turned off.`, 409));
  await User.updateOne({ _id: req.user._id }, { $set: { totpEnabled: false, totpSecretEnc: null, recoveryCodeHashes: [], totpLastStep: -1 } });
  audit(req, 'auth.2fa_disabled', { workspaceId: req.user.currentWorkspaceId });
  res.json({ success: true, data: await sessionPayload(req.user) });
});

export const regenerateRecoveryCodes = asyncHandler(async (req, res, next) => {
  if (!req.user.totpEnabled) return next(new AppError('Turn on two-factor authentication first', 409));
  const err = await requirePasswordAndCode(req, req.user);
  if (err) return next(new AppError(err, 400));
  const codes = generateRecoveryCodes();
  await User.updateOne({ _id: req.user._id }, { $set: { recoveryCodeHashes: codes.map(hashRecoveryCode) } });
  audit(req, 'auth.recovery_codes_regenerated', { workspaceId: req.user.currentWorkspaceId });
  res.json({ success: true, data: { recoveryCodes: codes } });
});

/* ─────────────── email verification ─────────────── */

export const verifyEmail = asyncHandler(async (req, res, next) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.slice(0, 200) : '';
  if (!token) return next(new AppError('Verification token is missing', 400));

  const user = await User.findOne({ emailVerifyTokenHash: hashToken(token) });
  if (!user) return next(new AppError('This link is invalid or was already used.', 400));
  if (!user.emailVerifyExpires || user.emailVerifyExpires < new Date()) {
    return next(new AppError('This link has expired. Request a new one from your dashboard.', 400, { code: 'TOKEN_EXPIRED' }));
  }

  user.emailVerified = true;
  user.emailVerifyTokenHash = null;
  user.emailVerifyExpires = null;
  pendingVerificationCodes.delete(String(user._id));
  await user.save({ validateBeforeSave: false });
  audit(req, 'auth.email_verified', { actor: user, workspaceId: user.currentWorkspaceId });

  res.status(200).json({ success: true, data: { email: user.email } });
});

export const verifyEmailCode = asyncHandler(async (req, res, next) => {
  const rawCode = String(req.body?.code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(rawCode)) {
    return next(new AppError('Please enter a valid 6-digit numeric verification code.', 400));
  }

  const user = await User.findById(req.user._id).select('+emailVerifyCode');
  if (!user) return next(new AppError('User not found', 404));

  if (user.emailVerified) {
    return res.status(200).json({ success: true, data: await sessionPayload(user) });
  }

  if (!user.emailVerifyCode || !user.emailVerifyExpires || user.emailVerifyExpires < new Date()) {
    return next(new AppError('Verification code has expired. Please click Resend to get a fresh code.', 400, { code: 'TOKEN_EXPIRED' }));
  }

  if (hashToken(rawCode) !== user.emailVerifyCode) {
    return next(new AppError('Incorrect verification code. Please check your code and try again.', 400));
  }

  user.emailVerified = true;
  user.emailVerifyCode = null;
  user.emailVerifyTokenHash = null;
  user.emailVerifyExpires = null;
  pendingVerificationCodes.delete(String(user._id));
  await user.save({ validateBeforeSave: false });
  audit(req, 'auth.email_verified', { actor: user, workspaceId: user.currentWorkspaceId, meta: { method: 'otp_code' } });

  res.status(200).json({ success: true, data: await sessionPayload(user) });
});

export const resendVerification = asyncHandler(async (req, res, next) => {
  const user = req.user;
  if (user.emailVerified) return res.status(200).json({ success: true, data: { alreadyVerified: true } });
  if (user.emailVerifySentAt && Date.now() - user.emailVerifySentAt.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - user.emailVerifySentAt.getTime())) / 1000);
    return next(new AppError(`Please wait ${wait}s before requesting another email.`, 429));
  }
  const mail = await issueVerification(user);
  res.status(200).json({
    success: true,
    data: {
      sent: mail.ok,
      devCode: env.NODE_ENV === 'development' ? mail.code : undefined,
    },
  });
});

/** Helper to determine the canonical public URL for OAuth redirects & callbacks */
export const getCanonicalOrigin = (req) => {
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  }
  if (req) {
    const host = req.get('x-forwarded-host') || req.get('host');
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      return `${proto}://${host}`;
    }
  }
  if (env.APP_URL && (!env.APP_URL.includes('localhost') || env.NODE_ENV !== 'production')) {
    return env.APP_URL.replace(/\/$/, '');
  }
  if (env.NODE_ENV === 'production') {
    return 'https://pulse-watch-frkc.onrender.com';
  }
  return env.APP_URL || 'http://localhost:5000';
};

export const getOAuthCallbackUrl = (req) => {
  return `${getCanonicalOrigin(req)}/api/v1/auth/google/callback`;
};

/** Redirect user to Google's real OAuth 2.0 consent screen. */
export const googleRedirect = asyncHandler(async (req, res, next) => {
  if (!env.GOOGLE_ENABLED) {
    return next(new AppError('Google sign-in is not configured on this server.', 501));
  }

  const { OAuth2Client } = await import('google-auth-library');
  const callbackUrl = getOAuthCallbackUrl(req);
  logger.info({ callbackUrl }, 'Initiating Google OAuth redirect');

  const client = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, callbackUrl);

  const authorizeUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account', // Always show account picker so user can choose / add account
    redirect_uri: callbackUrl, // Strictly ensure redirect_uri matches
  });

  res.redirect(authorizeUrl);
});

/** Google redirects here with ?code=…. Exchange it for tokens and log the user in. */
export const googleCallback = asyncHandler(async (req, res, next) => {
  if (!env.GOOGLE_ENABLED) {
    return next(new AppError('Google sign-in is not configured on this server.', 501));
  }

  const origin = getCanonicalOrigin(req);
  const code = req.query.code;
  if (!code) {
    // User cancelled or Google returned an error
    return res.redirect(`${origin}/auth?mode=login&error=google_cancelled`);
  }

  const { OAuth2Client } = await import('google-auth-library');
  const callbackUrl = getOAuthCallbackUrl(req);
  const client = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, callbackUrl);

  let tokens;
  try {
    const tokenResponse = await client.getToken({
      code,
      redirect_uri: callbackUrl,
    });
    tokens = tokenResponse.tokens;
  } catch (err) {
    logger.error({ err: err.message, code: err.code }, 'Google token exchange failed');
    return res.redirect(`${origin}/auth?mode=login&error=google_failed`);
  }

  // Verify the id_token to get the user's profile
  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    logger.error({ err: err.message }, 'Google ID token verification failed');
    return res.redirect(`${origin}/auth?mode=login&error=google_failed`);
  }

  if (!payload || !payload.email) {
    return res.redirect(`${origin}/auth?mode=login&error=google_failed`);
  }

  const email = payload.email.toLowerCase();
  const name = payload.name || payload.given_name || email.split('@')[0];
  const picture = payload.picture || null;
  const googleId = payload.sub; // Google's unique user ID

  let user = await User.findOne({ email });
  if (user) {
    if (!user.googleId) user.googleId = googleId;
    if (!user.avatarUrl && picture) user.avatarUrl = picture;
    user.emailVerified = true; // Google verified the email
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });
  } else {
    user = await User.create({
      email,
      name,
      googleId,
      avatarUrl: picture,
      emailVerified: true,
      lastLoginAt: new Date(),
      passwordChangedAt: new Date(),
    });
    const ws = await createWorkspaceFor(user, null);
    audit(req, 'workspace.created', { actor: user, workspaceId: ws._id, targetType: 'workspace', targetId: ws._id, targetName: ws.name });
  }

  audit(req, 'auth.google_login', { actor: user, workspaceId: user.currentWorkspaceId });
  
  // Set the session cookie, then redirect to the frontend dashboard
  setSessionCookie(res, user);
  res.redirect(`${origin}/dashboard`);
});

/* ─────────────── password reset ─────────────── */

export const forgotPassword = asyncHandler(async (req, res) => {
  const parsed = z.object({ email: z.string().trim().email().max(254) }).safeParse(req.body);
  // Same response whether or not the account exists — no account enumeration.
  const generic = { success: true, data: { message: 'If an account exists for that email, a reset link is on its way.' } };
  if (!parsed.success) return res.status(200).json(generic);

  const user = await User.findOne({ email: parsed.data.email.toLowerCase() });
  if (user) {
    const { token, hash } = createToken();
    user.resetTokenHash = hash;
    user.resetExpires = new Date(Date.now() + RESET_TTL_MS);
    await user.save({ validateBeforeSave: false });
    await sendMail({ to: user.email, ...resetPasswordTemplate({ name: user.name, token }) });
    audit(req, 'auth.password_reset_requested', { actor: user, workspaceId: user.currentWorkspaceId });
  }
  res.status(200).json(generic);
});

export const resetPassword = asyncHandler(async (req, res, next) => {
  const parsed = z.object({ token: z.string().min(10).max(200), password: z.string().max(200) }).safeParse(req.body);
  if (!parsed.success) return next(new AppError(firstIssue(parsed), 400));

  const user = await User.findOne({ resetTokenHash: hashToken(parsed.data.token) });
  if (!user || !user.resetExpires || user.resetExpires < new Date()) {
    return next(new AppError('This reset link is invalid or has expired. Request a new one.', 400));
  }
  const weak = checkPassword(parsed.data.password, { email: user.email, name: user.name });
  if (weak) return next(new AppError(weak, 400));

  user.passwordHash = parsed.data.password;
  user.passwordChangedAt = new Date();
  user.resetTokenHash = null;
  user.resetExpires = null;
  user.emailVerified = true; // they just proved they control the inbox
  user.failedLogins = 0;
  user.lockUntil = null;
  user.tokenVersion += 1; // sign out every other session
  await user.save();
  audit(req, 'auth.password_reset', { actor: user, workspaceId: user.currentWorkspaceId });

  // With 2FA on, a reset link alone must not grant a session: finish with the second factor.
  if (user.totpEnabled) {
    return res.status(200).json({ success: true, data: { mfaRequired: true, mfaTicket: signMfaTicket(user) } });
  }
  await sendSession(user, 200, res);
});

/* ─────────────── account settings ─────────────── */

export const updateProfile = asyncHandler(async (req, res, next) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) return next(new AppError(firstIssue(parsed), 400));
  req.user.name = parsed.data.name;
  await req.user.save({ validateBeforeSave: false });
  res.status(200).json({ success: true, data: await sessionPayload(req.user) });
});

export const changePassword = asyncHandler(async (req, res, next) => {
  const parsed = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().max(200) }).safeParse(req.body);
  if (!parsed.success) return next(new AppError(firstIssue(parsed), 400));

  if (!(await req.user.comparePassword(parsed.data.currentPassword))) {
    await registerFailure(req, req.user, 'change_password');
    return next(new AppError('Current password is incorrect', 400));
  }
  const weak = checkPassword(parsed.data.newPassword, { email: req.user.email, name: req.user.name });
  if (weak) return next(new AppError(weak, 400));
  req.user.passwordHash = parsed.data.newPassword;
  req.user.passwordChangedAt = new Date();
  req.user.tokenVersion += 1; // other devices are signed out; this one gets a fresh cookie
  await req.user.save();
  audit(req, 'auth.password_changed', { workspaceId: req.user.currentWorkspaceId });
  await sendSession(req.user, 200, res);
});

export const deleteAccount = asyncHandler(async (req, res, next) => {
  const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) return next(new AppError('Enter your password to confirm', 400));
  if (!(await req.user.comparePassword(parsed.data.password))) {
    return next(new AppError('Password is incorrect', 400));
  }

  const owned = await Workspace.find({ ownerId: req.user._id });
  for (const ws of owned) {
    const others = await Membership.countDocuments({ workspaceId: ws._id, userId: { $ne: req.user._id } });
    if (others > 0) {
      return next(new AppError(`You own "${ws.name}", which has other members. Transfer ownership or remove them first.`, 409));
    }
  }

  for (const ws of owned) await deleteWorkspaceCascade(ws._id);
  await Membership.deleteMany({ userId: req.user._id });
  await User.deleteOne({ _id: req.user._id });
  audit(req, 'auth.account_deleted', { workspaceId: null, targetType: 'user', targetId: req.user._id, targetName: req.user.email });

  clearSessionCookie(res);
  res.status(200).json({ success: true, data: null });
});

/* ─────────────── demo ─────────────── */

/**
 * One-click demo workspace so visitors can explore without signing up. Disabled in production.
 */
export const demoLogin = asyncHandler(async (req, res, next) => {
  if (!env.ALLOW_DEMO_LOGIN || env.NODE_ENV === 'production') {
    return next(new AppError('Demo login is disabled', 403));
  }

  const email = 'demo@pulsewatch.dev';
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      email,
      name: 'Demo Workspace',
      passwordHash: crypto.randomBytes(24).toString('hex'), // unusable random password
      emailVerified: true,
    });
    const ws = await createWorkspaceFor(user, 'Demo Workspace');
    // Seed a few real, public endpoints so the dashboard has live data within seconds.
    const seeds = [
      { name: 'GitHub API', url: 'https://api.github.com/zen' },
      { name: 'Cloudflare Edge', url: 'https://www.cloudflare.com/cdn-cgi/trace', keyword: 'colo=' },
      { name: 'Example.com', url: 'https://example.com', keyword: 'Example Domain' },
    ];
    for (const { url, ...rest } of seeds) {
      const m = new Monitor({ ...rest, workspaceId: ws._id, userId: user._id, intervalSeconds: 300, nextCheckAt: new Date() });
      sealMonitorSecrets(m, { url, headers: {}, body: '' });
      await m.save();
    }
  } else if (!user.emailVerified) {
    user.emailVerified = true;
  }

  // Development-only demo: its sample sites count as verified so the demo works out of the box.
  const demoWs = await Workspace.findOne({ ownerId: user._id }).select('_id');
  if (demoWs) {
    const { Domain } = await import('../models/Domain.js');
    for (const domain of ['api.github.com', 'cloudflare.com', 'example.com']) {
      await Domain.updateOne(
        { workspaceId: demoWs._id, domain },
        { $setOnInsert: { token: 'demo', status: 'verified', method: 'demo', verifiedAt: new Date(), lastCheckedAt: new Date() } },
        { upsert: true }
      );
    }
    await Monitor.updateMany({ workspaceId: demoWs._id, pausedByOwnership: true }, { $set: { isActive: true, pausedByOwnership: false, currentStatus: 'PENDING', nextCheckAt: new Date() } });
  }

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  await sendSession(user, 200, res);
});

export const isValidId = (id) => mongoose.isValidObjectId(id);
