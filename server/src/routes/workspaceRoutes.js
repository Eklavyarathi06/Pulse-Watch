import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect, withWorkspace, requireRole, requireVerified } from '../middleware/authMiddleware.js';
import {
  listWorkspaces,
  createWorkspace,
  switchWorkspace,
  updateWorkspace,
  deleteWorkspace,
  listMembers,
  inviteMember,
  resendInvite,
  revokeInvite,
  changeMemberRole,
  removeMember,
  transferOwnership,
  listAuditLog,
} from '../controllers/workspaceController.js';

const router = express.Router();

const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user._id.toString(),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 429, message: 'Too many invitations sent. Try again later.' } },
});

router.use(protect);

router.get('/', listWorkspaces);
router.post('/', requireVerified, createWorkspace);
router.post('/switch', switchWorkspace);

router.use('/current', withWorkspace);
router.patch('/current', requireRole('admin'), updateWorkspace);
router.delete('/current', requireRole('owner'), deleteWorkspace);
router.get('/current/members', listMembers);
router.post('/current/invites', requireRole('admin'), requireVerified, inviteLimiter, inviteMember);
router.post('/current/invites/:inviteId/resend', requireRole('admin'), inviteLimiter, resendInvite);
router.delete('/current/invites/:inviteId', requireRole('admin'), revokeInvite);
router.patch('/current/members/:userId', requireRole('owner'), changeMemberRole);
router.delete('/current/members/:userId', removeMember); // permission checked inside (self-leave vs removal)
router.post('/current/transfer', requireRole('owner'), transferOwnership);
router.get('/current/audit', requireRole('admin'), listAuditLog);

export default router;
