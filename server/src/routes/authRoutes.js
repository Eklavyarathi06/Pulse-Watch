import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  register,
  login,
  loginTwoFactor,
  twoFactorSetup,
  twoFactorEnable,
  twoFactorDisable,
  regenerateRecoveryCodes,
  logout,
  logoutAll,
  getMe,
  demoLogin,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  updateProfile,
  changePassword,
  deleteAccount,
} from '../controllers/authController.js';
import { getInvitation, acceptInvitation } from '../controllers/workspaceController.js';
import { protect } from '../middleware/authMiddleware.js';
import { env } from '../config/env.js';

const router = express.Router();

const limiter = (max, minutes = 15) =>
  rateLimit({
    windowMs: minutes * 60 * 1000,
    max,
    message: { success: false, error: { code: 429, message: `Too many attempts. Please try again in ${minutes} minutes.` } },
    standardHeaders: true,
    legacyHeaders: false,
  });

// Brute-force protection for credential endpoints
const authLimiter = limiter(env.AUTH_RATE_LIMIT_MAX);
// Email-sending endpoints get a tighter budget so they can't be used to spam inboxes.
const mailLimiter = limiter(5);

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/login/2fa', authLimiter, loginTwoFactor);
router.post('/demo', authLimiter, demoLogin);
router.post('/logout', logout);
router.post('/logout-all', protect, logoutAll);
router.get('/me', protect, getMe);

router.post('/verify-email', authLimiter, verifyEmail);
router.post('/resend-verification', protect, mailLimiter, resendVerification);
router.post('/forgot-password', mailLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);

router.patch('/profile', protect, updateProfile);
router.post('/password', protect, authLimiter, changePassword);
router.delete('/account', protect, authLimiter, deleteAccount);

router.post('/2fa/setup', protect, authLimiter, twoFactorSetup);
router.post('/2fa/enable', protect, authLimiter, twoFactorEnable);
router.post('/2fa/disable', protect, authLimiter, twoFactorDisable);
router.post('/2fa/recovery-codes', protect, authLimiter, regenerateRecoveryCodes);

router.get('/invites/:token', limiter(60), getInvitation);
router.post('/invites/:token/accept', protect, authLimiter, acceptInvitation);

router.get('/config', (req, res) => {
  res.json({
    success: true,
    data: {
      demoLogin: env.ALLOW_DEMO_LOGIN && env.NODE_ENV !== 'production',
      requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
      payments: env.RAZORPAY_ENABLED,
    },
  });
});

export default router;
