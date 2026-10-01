import mongoose from 'mongoose';

// A workspace is a company / team. Monitors, channels, incidents and billing all belong to it.
const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Public status page lives at /status/:slug
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: String, enum: ['free', 'pro', 'team'], default: 'free' },
    billingCycle: { type: String, enum: ['monthly', 'annual', null], default: null },
    planExpiresAt: { type: Date, default: null },
    // Set by the plan enforcer once a lapsed plan's limits have been applied.
    planEnforcedAt: { type: Date, default: null },
    // Keys like "7d:2027-10-17T…" so each reminder goes out once per billing period.
    renewalRemindersSent: { type: [String], default: [] },
    // Security policy: every member must have 2FA enabled to access this workspace.
    require2FA: { type: Boolean, default: false },
    // Public status page is opt-in: off for new workspaces until an admin turns it on.
    statusPageEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

workspaceSchema.index({ plan: 1, planExpiresAt: 1 });

export const Workspace = mongoose.model('Workspace', workspaceSchema);
