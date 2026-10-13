import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect, withWorkspace, requireRole, requireVerified } from '../middleware/authMiddleware.js';
import {
  createMonitor,
  getMonitors,
  getMonitor,
  updateMonitor,
  deleteMonitor,
  togglePause,
  checkNow
} from '../controllers/monitorController.js';
import { getMonitorStats } from '../controllers/statsController.js';

const router = express.Router();

// Manual checks hit third-party hosts — keep them from being used as a hammer.
const checkNowLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user._id.toString(), // runs after protect, so a user is always present
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 429, message: 'Too many manual checks. Try again in a minute.' } },
});

router.use(protect, withWorkspace);

// Members create, edit, pause and check monitors; deleting history needs an admin.
router.route('/')
  .get(getMonitors)
  .post(requireVerified, createMonitor);

router.route('/:id')
  .get(getMonitor)
  .patch(requireVerified, updateMonitor)
  .delete(requireRole('admin'), deleteMonitor);

router.post('/:id/toggle-pause', togglePause);
router.post('/:id/check', checkNowLimiter, checkNow);
router.get('/:id/stats', getMonitorStats);

export default router;
