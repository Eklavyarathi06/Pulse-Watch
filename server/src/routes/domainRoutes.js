import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect, withWorkspace, requireRole, requireVerified } from '../middleware/authMiddleware.js';
import { listDomains, addDomain, verifyDomainNow, removeDomain, reachabilityTest } from '../controllers/domainController.js';

const router = express.Router();

// Each verification does a DNS lookup and an outbound request — keep it civil.
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user._id.toString(),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 429, message: 'Too many verification attempts. Try again in a minute.' } },
});

router.use(protect, withWorkspace);
router.get('/', listDomains);
router.post('/', requireRole('admin'), requireVerified, addDomain);
router.post('/:id/verify', requireRole('admin'), verifyLimiter, verifyDomainNow);
router.post('/:id/test', verifyLimiter, reachabilityTest);
router.delete('/:id', requireRole('admin'), removeDomain);

export default router;
