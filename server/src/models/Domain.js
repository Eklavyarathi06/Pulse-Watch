import mongoose from 'mongoose';

/**
 * A domain a workspace has claimed. A workspace may only monitor hosts on domains it has
 * verified (DNS TXT record or a file on the site); verification covers subdomains and is
 * exclusive — no other workspace can claim the same domain or a parent/child of it.
 */
const domainSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    domain: { type: String, required: true, lowercase: true, trim: true },
    // Public proof value the customer publishes; unique per workspace + domain.
    token: { type: String, required: true },
    status: { type: String, enum: ['pending', 'verified', 'lost'], default: 'pending' },
    method: { type: String, enum: ['dns', 'file', 'demo', null], default: null },
    verifiedAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    // Consecutive failed re-checks of a verified domain; 3 in a row = ownership lost.
    failedRechecks: { type: Number, default: 0 },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

domainSchema.index({ workspaceId: 1, domain: 1 }, { unique: true });
domainSchema.index({ status: 1, lastCheckedAt: 1 });

export const Domain = mongoose.model('Domain', domainSchema);
