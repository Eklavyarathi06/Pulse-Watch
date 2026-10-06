import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../utils/logger.js';

const clip = (v, n = 200) => (v === null || v === undefined ? null : String(v).slice(0, n));

/**
 * Records a security-relevant event. Fire-and-forget: auditing must never break the request.
 * Callers pass names/ids only — never secret values.
 */
export const audit = (req, action, { workspaceId, targetType, targetId, targetName, meta, actor } = {}) => {
  const user = actor || req?.user;
  AuditLog.create({
    workspaceId: workspaceId ?? req?.workspace?._id ?? null,
    actorId: user?._id ?? null,
    actorEmail: user?.email ?? null,
    action,
    targetType: clip(targetType, 40),
    targetId: clip(targetId, 64),
    targetName: clip(targetName, 120),
    ip: clip(req?.ip, 64),
    userAgent: clip(req?.get?.('user-agent'), 200),
    meta: meta ?? null,
  }).catch((err) => logger.warn(`Audit write failed (${action}): ${err.message}`));
};
