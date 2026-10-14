import mongoose from 'mongoose';

const alertChannelSchema = new mongoose.Schema(
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
    type: {
      type: String,
      enum: ['email', 'discord', 'slack', 'webhook'],
      required: true,
    },
    label: {
      type: String,
      required: true,
    },
    target: {
      type: String, // webhook URL or phone
    },
    secretEncrypted: {
      type: String, // AES-256-GCM encrypted
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastTestedAt: {
      type: Date,
      default: null,
    },
    lastTestOk: {
      type: Boolean,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

export const AlertChannel = mongoose.model('AlertChannel', alertChannelSchema);
