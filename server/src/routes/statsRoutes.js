import express from 'express';
import { protect, withWorkspace } from '../middleware/authMiddleware.js';
import { getDashboardSummary } from '../controllers/statsController.js';

const router = express.Router();

router.use(protect, withWorkspace);

router.get('/summary', getDashboardSummary);
// Per-monitor stats live in monitorRoutes as GET /monitors/:id/stats.

export default router;
