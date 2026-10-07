import mongoose from 'mongoose';

/**
 * Customer secrets (the full URL, request headers, request body) are stored ONLY encrypted
 * (`*Enc`, see utils/crypto.js) and are excluded from every query unless explicitly selected
 * with `+urlEnc +headersEnc +bodyEnc` — which only the check engine and the edit flow do.
 * They are never serialised to JSON: the API exposes a masked URL and header *names* only.
 */
const monitorSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    // Display-safe URL: query values and token-like path segments masked.
    urlDisplay: {
      type: String,
      required: true,
    },
    // Hostname only (no path/query) — used to match verified domains.
    host: { type: String, lowercase: true, index: true, default: null },
    urlEnc: { type: String, required: true, select: false },
    headerNames: { type: [String], default: [] },
    headersEnc: { type: String, default: null, select: false },
    hasBody: { type: Boolean, default: false },
    bodyEnc: { type: String, default: null, select: false },
    method: {
      type: String,
      enum: ['GET', 'POST', 'PUT', 'HEAD'],
      default: 'GET',
    },
    expectedStatusCodes: {
      type: [Number],
      default: [200, 201, 202, 203, 204],
    },
    keyword: {
      type: String,
    },
    intervalSeconds: {
      type: Number,
      enum: [30, 60, 300, 900],
      default: 300,
    },
    timeoutMs: {
      type: Number,
      min: 1000,
      max: 30000,
      default: 10000,
    },
    // Shown on the workspace's public status page (only when the page itself is enabled).
    showOnStatusPage: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    currentStatus: {
      type: String,
      enum: ['UP', 'DOWN', 'PENDING', 'PAUSED'],
      default: 'PENDING',
    },
    consecutiveFailures: {
      type: Number,
      default: 0,
    },
    lastCheckedAt: {
      type: Date,
    },
    nextCheckAt: {
      type: Date,
      default: Date.now,
    },
    lastStatusChangeAt: {
      type: Date,
      default: Date.now,
    },
    // Set when a lapsed plan paused or slowed this monitor, so paying again restores it exactly.
    pausedByPlan: {
      type: Boolean,
      default: false,
    },
    // Set when the monitor was stopped because its domain is not (or no longer) verified by this workspace.
    pausedByOwnership: {
      type: Boolean,
      default: false,
    },
    intervalBeforeDowngrade: {
      type: Number,
      default: null,
    },
    alertChannelIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AlertChannel',
      },
    ],
  },
  { timestamps: true }
);

// Compound index for scheduler
monitorSchema.index({ isActive: 1, nextCheckAt: 1 });

monitorSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.url = ret.urlDisplay;
    delete ret.urlEnc;
    delete ret.headersEnc;
    delete ret.bodyEnc;
    delete ret.__v;
    return ret;
  },
});

export const SECRET_FIELDS = '+urlEnc +headersEnc +bodyEnc';

export const Monitor = mongoose.model('Monitor', monitorSchema);
