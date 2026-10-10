import mongoose from 'mongoose';

const alertSentSchema = new mongoose.Schema(
  {
    channel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AlertChannel',
    },
    event: {
      type: String,
      enum: ['DOWN', 'RECOVERED'],
      required: true,
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
    ok: {
      type: Boolean,
      required: true,
    },
    error: {
      type: String,
    },
  },
  { _id: false }
);

const incidentSchema = new mongoose.Schema(
  {
    monitorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Monitor',
      required: true,
      index: true,
    },
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
    startedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    resolvedAt: {
      type: Date,
      default: null, // null while open
    },
    durationSeconds: {
      type: Number,
      default: null,
    },
    cause: {
      type: String, // error type + last status code
    },
    errorType: {
      type: String,
    },
    statusCode: {
      type: Number,
      default: null,
    },
    resolution: {
      type: String, // 'RECOVERED' | 'PAUSED' | 'DELETED'
      default: null,
    },
    alertsSent: [alertSentSchema],
  },
  { timestamps: true }
);

incidentSchema.index({ monitorId: 1, resolvedAt: 1 });
incidentSchema.index({ monitorId: 1, startedAt: -1 });

export const Incident = mongoose.model('Incident', incidentSchema);
