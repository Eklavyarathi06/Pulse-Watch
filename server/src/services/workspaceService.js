import crypto from 'crypto';
import { Workspace } from '../models/Workspace.js';
import { Membership, ROLE_RANK } from '../models/Membership.js';
import { User } from '../models/User.js';
import { Monitor } from '../models/Monitor.js';
import { AlertChannel } from '../models/AlertChannel.js';
import { Incident } from '../models/Incident.js';
import { PLANS, effectivePlanId } from '../config/plans.js';
import { slugify } from '../utils/tokens.js';

// Slugs that would collide with app routes or read as official.
const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'status', 'www', 'pulsewatch', 'dashboard', 'auth', 'billing', 'support', 'help']);

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

export const isSlugAllowed = (slug) => SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);

export const uniqueSlug = async (base) => {
  let root = slugify(base);
  if (root.length < 3) root = `${root}-team`.replace(/^-/, '');
  if (RESERVED_SLUGS.has(root)) root = `${root}-team`;
  let candidate = root;
  for (let i = 0; i < 20; i++) {
    if (!(await Workspace.exists({ slug: candidate }))) return candidate;
    candidate = `${root.slice(0, 33)}-${crypto.randomBytes(3).toString('hex')}`;
  }
  return `${root.slice(0, 30)}-${Date.now().toString(36)}`;
};

export const createWorkspaceFor = async (user, name) => {
  const workspace = await Workspace.create({
    name: (name || `${user.name.split(' ')[0]}'s workspace`).slice(0, 80),
    slug: await uniqueSlug(name || user.name),
    ownerId: user._id,
  });
  await Membership.create({ workspaceId: workspace._id, userId: user._id, role: 'owner' });
  await User.updateOne({ _id: user._id }, { $set: { currentWorkspaceId: workspace._id } });
  user.currentWorkspaceId = workspace._id;
  return workspace;
};

/** Public shape of a workspace for the client. */
export const serializeWorkspace = (ws, role) => {
  const planId = effectivePlanId(ws);
  const plan = PLANS[planId];
  return {
    _id: ws._id,
    name: ws.name,
    slug: ws.slug,
    role,
    plan: planId,
    purchasedPlan: ws.plan,
    billingCycle: ws.billingCycle,
    planExpiresAt: ws.planExpiresAt,
    limits: { monitors: plan.monitors, minInterval: plan.minInterval, channels: plan.channels, members: plan.members },
    require2FA: Boolean(ws.require2FA),
    statusPageEnabled: Boolean(ws.statusPageEnabled),
    createdAt: ws.createdAt,
  };
};

/** All workspaces a user belongs to, with their role in each. */
export const listWorkspacesFor = async (userId) => {
  const memberships = await Membership.find({ userId }).lean();
  if (!memberships.length) return [];
  const workspaces = await Workspace.find({ _id: { $in: memberships.map((m) => m.workspaceId) } }).sort({ createdAt: 1 }).lean();
  const roleById = Object.fromEntries(memberships.map((m) => [m.workspaceId.toString(), m.role]));
  return workspaces.map((ws) => serializeWorkspace(ws, roleById[ws._id.toString()]));
};

/**
 * Resolves the workspace a request acts on: the user's current workspace if they are still
 * a member of it, otherwise their oldest membership. Creates a personal workspace for users
 * that somehow have none (e.g. their last workspace was deleted).
 */
export const resolveWorkspaceContext = async (user) => {
  let membership = null;
  if (user.currentWorkspaceId) {
    membership = await Membership.findOne({ userId: user._id, workspaceId: user.currentWorkspaceId });
  }
  if (!membership) {
    membership = await Membership.findOne({ userId: user._id }).sort({ createdAt: 1 });
    if (membership) await User.updateOne({ _id: user._id }, { $set: { currentWorkspaceId: membership.workspaceId } });
  }
  if (!membership) {
    const ws = await createWorkspaceFor(user);
    return { workspace: ws, membership: await Membership.findOne({ workspaceId: ws._id, userId: user._id }) };
  }
  const workspace = await Workspace.findById(membership.workspaceId);
  return { workspace, membership };
};

export const hasRole = (membership, minRole) => ROLE_RANK[membership?.role] >= ROLE_RANK[minRole];

/**
 * One-time, idempotent migration from the old per-user model: every user gets a personal
 * workspace, and their monitors, channels and incidents are moved into it.
 */
export const migrateLegacyData = async (logger) => {
  const users = await User.find({}).select('_id name plan currentWorkspaceId emailVerified').lean();
  let migrated = 0;
  for (const u of users) {
    let membership = await Membership.findOne({ userId: u._id, role: 'owner' }).sort({ createdAt: 1 });
    if (!membership) {
      membership = await Membership.findOne({ userId: u._id });
    }
    if (!membership) {
      const ws = await Workspace.create({
        name: `${u.name.split(' ')[0]}'s workspace`,
        slug: await uniqueSlug(u.name),
        ownerId: u._id,
        plan: u.plan && u.plan !== 'free' ? u.plan : 'free',
        statusPageEnabled: true, // pre-existing accounts keep their public page
      });
      membership = await Membership.create({ workspaceId: ws._id, userId: u._id, role: 'owner' });
      migrated++;
    }
    const wsId = membership.workspaceId;
    await Promise.all([
      Monitor.updateMany({ userId: u._id, workspaceId: { $exists: false } }, { $set: { workspaceId: wsId } }),
      Monitor.updateMany({ userId: u._id, workspaceId: null }, { $set: { workspaceId: wsId } }),
      AlertChannel.updateMany({ userId: u._id, $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }] }, { $set: { workspaceId: wsId } }),
      Incident.updateMany({ userId: u._id, $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }] }, { $set: { workspaceId: wsId } }),
      u.currentWorkspaceId ? null : User.updateOne({ _id: u._id }, { $set: { currentWorkspaceId: wsId } }),
    ]);
  }
  // Accounts that existed before email verification shipped are trusted as verified.
  const legacy = await User.updateMany(
    { emailVerified: { $exists: false } },
    { $set: { emailVerified: true } }
  );
  if (migrated || legacy.modifiedCount) {
    logger.info(`Migration: created ${migrated} workspace(s), marked ${legacy.modifiedCount} legacy user(s) verified.`);
  }
};
