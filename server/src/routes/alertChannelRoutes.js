import express from 'express';
import { protect, withWorkspace, requireRole, requireVerified } from '../middleware/authMiddleware.js';
import {
  createChannel,
  getChannels,
  updateChannel,
  deleteChannel,
  testChannel
} from '../controllers/alertChannelController.js';

const router = express.Router();

router.use(protect, withWorkspace);

// Everyone in the workspace can see and test channels; admins manage them.
router.route('/')
  .get(getChannels)
  .post(requireRole('admin'), requireVerified, createChannel);

router.route('/:id')
  .patch(requireRole('admin'), updateChannel)
  .delete(requireRole('admin'), deleteChannel);

router.post('/:id/test', requireVerified, testChannel);

export default router;
