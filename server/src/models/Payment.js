import mongoose from 'mongoose';

// One Razorpay order = one Payment row. Activation is idempotent on `status`.
const paymentSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, default: 'razorpay' },
    orderId: { type: String, required: true, unique: true },
    paymentId: { type: String, default: null },
    plan: { type: String, enum: ['pro', 'team'], required: true },
    cycle: { type: String, enum: ['monthly', 'annual'], required: true },
    amount: { type: Number, required: true }, // paise
    currency: { type: String, default: 'INR' },
    receipt: { type: String, required: true },
    status: { type: String, enum: ['created', 'paid', 'failed'], default: 'created', index: true },
    method: { type: String, default: null },
    failureReason: { type: String, default: null },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Payment = mongoose.model('Payment', paymentSchema);
