import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { User } from '../models/User.js';
import { resolveWorkspaceContext, hasRole } from '../services/workspaceService.js';
import { SESSION_COOKIE, verifySession } from '../utils/session.js';

export const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers?.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const token = req.cookies?.[SESSION_COOKIE] || req.cookies?.pw_session || req.cookies?.token || bearerToken;
    if (!token) {
      return next(new AppError('You are not logged in! Please log in to get access.', 401));
    }

    // Pinned algorithm, issuer and audience — an MFA ticket or a forged "alg: none" token is rejected.
    const decoded = verifySession(token);

    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return next(new AppError('The user belonging to this token does no longer exist.', 401));
    }

    // Tokens issued before a password change/reset or "sign out everywhere" are dead.
    if (decoded.tv !== currentUser.tokenVersion) {
      return next(new AppError('User session revoked. Please log in again.', 401));
    }

    req.user = currentUser;
    next();
  } catch {
    next(new AppError('Invalid token or session expired', 401));
  }
};

/** Loads req.workspace + req.membership for the user's active workspace. Use after `protect`. */
export const withWorkspace = async (req, res, next) => {
  try {
    const { workspace, membership } = await resolveWorkspaceContext(req.user);
    if (!workspace || !membership) return next(new AppError('Workspace not found', 404));
    // Workspace security policy: nothing is readable without 2FA when the owner requires it.
    if (workspace.require2FA && !req.user.totpEnabled) {
      return next(new AppError(`${workspace.name} requires two-factor authentication. Enable it in Settings → Security to continue.`, 403, { code: 'TWO_FACTOR_REQUIRED' }));
    }
    req.workspace = workspace;
    req.membership = membership;
    next();
  } catch (err) {
    next(err);
  }
};

export const requireRole = (minRole) => (req, res, next) => {
  if (!hasRole(req.membership, minRole)) {
    return next(new AppError(`Only workspace ${minRole}s${minRole === 'owner' ? '' : ' and owners'} can do that.`, 403));
  }
  next();
};

export const requireVerified = (req, res, next) => {
  if (env.REQUIRE_EMAIL_VERIFICATION && !req.user.emailVerified) {
    return next(new AppError('Please confirm your email address first — check your inbox for the link.', 403, { code: 'EMAIL_NOT_VERIFIED' }));
  }
  next();
};
