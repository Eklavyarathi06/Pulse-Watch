import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect, withWorkspace, requireRole, requireVerified } from '../middleware/authMiddleware.js';
import {
  getPlans,
  getBilling,
  createCheckoutOrder,
  verifyCheckout,
  reportCheckoutFailure,
} from '../controllers/billingController.js';

const router = express.Router();

const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user._id.toString(),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 429, message: 'Too many checkout attempts. Try again in a few minutes.' } },
});

router.get('/plans', getPlans);

router.use(protect, withWorkspace);
router.get('/', getBilling);
// Only the owner can spend money on the workspace.
router.post('/order', requireRole('owner'), requireVerified, checkoutLimiter, createCheckoutOrder);
router.post('/verify', requireRole('owner'), verifyCheckout);
router.post('/failed', requireRole('owner'), reportCheckoutFailure);

export default router;
