import { Workspace } from '../models/Workspace.js';
import { Membership } from '../models/Membership.js';
import { Invitation } from '../models/Invitation.js';
import { Monitor } from '../models/Monitor.js';
import { AlertChannel } from '../models/AlertChannel.js';
import { Incident } from '../models/Incident.js';
import { CheckLog } from '../models/CheckLog.js';
import { DailyStat } from '../models/DailyStat.js';
import { User } from '../models/User.js';
import { Domain } from '../models/Domain.js';

/** Removes a workspace and everything that belongs to it. Payments are kept as accounting records. */
export const deleteWorkspaceCascade = async (workspaceId) => {
  const monitorIds = (await Monitor.find({ workspaceId }).select('_id').lean()).map((m) => m._id);
  await Promise.all([
    CheckLog.deleteMany({ monitorId: { $in: monitorIds } }),
    DailyStat.deleteMany({ monitorId: { $in: monitorIds } }),
    Incident.deleteMany({ workspaceId }),
    Monitor.deleteMany({ workspaceId }),
    AlertChannel.deleteMany({ workspaceId }),
    Invitation.deleteMany({ workspaceId }),
    Membership.deleteMany({ workspaceId }),
    Domain.deleteMany({ workspaceId }),
    User.updateMany({ currentWorkspaceId: workspaceId }, { $set: { currentWorkspaceId: null } }),
  ]);
  await Workspace.deleteOne({ _id: workspaceId });
};
