import mongoose from 'mongoose';

const dailyStatSchema = new mongoose.Schema(
  {
    monitorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Monitor',
      required: true,
    },
    date: {
      type: Date, // UTC day (00:00:00)
      required: true,
    },
    totalChecks: {
      type: Number,
      default: 0,
    },
    upChecks: {
      type: Number,
      default: 0,
    },
    uptimePercent: {
      type: Number,
      default: 100,
    },
    avgResponseMs: {
      type: Number,
      default: 0,
    },
    p95ResponseMs: {
      type: Number,
      default: 0,
    },
    minResponseMs: {
      type: Number,
      default: 0,
    },
    maxResponseMs: {
      type: Number,
      default: 0,
    },
    incidentCount: {
      type: Number,
      default: 0,
    },
    downtimeSeconds: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: false }
);

// Unique index for upserts
dailyStatSchema.index({ monitorId: 1, date: 1 }, { unique: true });

// Retention: 1 year (Free tier will be filtered out on API read or via a different TTL logic, but we keep 365 days here globally or use TTL)
dailyStatSchema.index({ date: 1 }, { expireAfterSeconds: 31536000 }); 

export const DailyStat = mongoose.model('DailyStat', dailyStatSchema);
