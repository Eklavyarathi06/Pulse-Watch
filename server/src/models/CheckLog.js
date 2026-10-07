import mongoose from 'mongoose';

const checkLogSchema = new mongoose.Schema(
  {
    monitorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Monitor',
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
    },
    status: {
      type: String,
      enum: ['UP', 'DOWN'],
      required: true,
    },
    statusCode: {
      type: Number,
    },
    responseTimeMs: {
      type: Number,
    },
    errorType: {
      type: String,
      enum: [
        'TIMEOUT',
        'DNS',
        'CONNECTION_REFUSED',
        'TLS',
        'STATUS_MISMATCH',
        'KEYWORD_MISSING',
        'BLOCKED_TARGET',
        'CONNECTION_RESET',
        'UNKNOWN',
      ],
    },
    errorMessage: {
      type: String,
    },
    attempt: {
      type: Number,
      enum: [1, 2, 3],
      default: 1,
    },
  },
  { timestamps: false }
);

// Index for fetching logs for a monitor
checkLogSchema.index({ monitorId: 1, timestamp: -1 });

// TTL index to auto-delete raw logs after 25 hours
checkLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90000 });

export const CheckLog = mongoose.model('CheckLog', checkLogSchema);
