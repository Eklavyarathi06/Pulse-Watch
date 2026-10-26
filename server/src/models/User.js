import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      default: null,
    },
    googleId: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    name: {
      type: String,
      required: true,
    },
    // Legacy per-user plan; plans now live on Workspace. Kept so old data migrates.
    plan: {
      type: String,
      enum: ['free', 'pro', 'team'],
      default: 'free',
    },
    emailVerified: { type: Boolean, default: false },
    emailVerifyTokenHash: { type: String, default: null, index: true, sparse: true },
    emailVerifyCode: { type: String, default: null, select: false },
    emailVerifyExpires: { type: Date, default: null },
    emailVerifySentAt: { type: Date, default: null },
    resetTokenHash: { type: String, default: null, index: true, sparse: true },
    resetExpires: { type: Date, default: null },
    currentWorkspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },

    // Two-factor authentication (TOTP). Seeds are encrypted per user and never selected by default.
    totpEnabled: { type: Boolean, default: false },
    totpSecretEnc: { type: String, default: null, select: false },
    totpPendingEnc: { type: String, default: null, select: false },
    totpLastStep: { type: Number, default: -1, select: false },
    recoveryCodeHashes: { type: [String], default: [], select: false },

    // Brute-force protection: per-account, on top of per-IP rate limits.
    failedLogins: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    lastLoginAt: {
      type: Date,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Hash password before save.
// Mongoose 9 no longer passes a `next` callback to middleware — async hooks resolve on return.
userSchema.pre('save', async function () {
  if (!this.isModified('passwordHash') || !this.passwordHash) return;
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.passwordHash) return false;
  return await bcrypt.compare(candidatePassword, this.passwordHash);
};

// Never leak hashes or tokens through JSON responses
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.tokenVersion;
    delete ret.emailVerifyTokenHash;
    delete ret.emailVerifyExpires;
    delete ret.resetTokenHash;
    delete ret.resetExpires;
    delete ret.plan;
    delete ret.totpSecretEnc;
    delete ret.totpPendingEnc;
    delete ret.totpLastStep;
    delete ret.recoveryCodeHashes;
    delete ret.failedLogins;
    delete ret.lockUntil;
    delete ret.__v;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);
