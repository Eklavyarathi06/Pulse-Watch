import mongoose from 'mongoose';
import { Monitor, SECRET_FIELDS } from '../models/Monitor.js';
import { AlertChannel } from '../models/AlertChannel.js';
import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { decryptLegacy, needsRotation, decryptField, encryptField } from '../utils/crypto.js';
import { sealMonitorSecrets, openMonitorSecrets, sealChannelTarget, openChannelTarget, userCtx } from './secrets.js';

/**
 * Runs on boot, idempotent:
 *  1. Encrypts any monitor still holding a plaintext url / headers / body (pre-encryption data),
 *     then removes the plaintext fields from the database.
 *  2. Re-encrypts channel targets from the legacy single-key format to per-record keys.
 *  3. Re-encrypts anything sealed with ENCRYPTION_KEY_PREVIOUS under the current key (rotation).
 */
export const runSecurityMigration = async (logger) => {
  await Workspace.updateMany({ statusPageEnabled: { $exists: false } }, { $set: { statusPageEnabled: true } });

  const raw = mongoose.connection.db.collection('monitors');
  let sealed = 0;
  const legacyCursor = raw.find({ url: { $type: 'string' }, urlEnc: { $exists: false } });
  for await (const doc of legacyCursor) {
    const headersObj = doc.headers && typeof doc.headers === 'object' ? Object.fromEntries(Object.entries(doc.headers)) : {};
    const holder = { _id: doc._id, workspaceId: doc.workspaceId };
    sealMonitorSecrets(holder, { url: doc.url, headers: headersObj, body: doc.body || '' });
    await raw.updateOne(
      { _id: doc._id },
      {
        $set: { urlEnc: holder.urlEnc, urlDisplay: holder.urlDisplay, headersEnc: holder.headersEnc, headerNames: holder.headerNames, bodyEnc: holder.bodyEnc, hasBody: holder.hasBody },
        $unset: { url: '', headers: '', body: '' },
      }
    );
    sealed++;
  }

  let channels = 0;
  for await (const ch of AlertChannel.find({ secretEncrypted: { $not: /^v2\./ } }).cursor()) {
    const plain = decryptLegacy(ch.secretEncrypted);
    if (!plain) continue;
    sealChannelTarget(ch, plain);
    await ch.save();
    channels++;
  }

  // Key rotation: anything still under the previous key gets re-sealed under the current one.
  let rotated = 0;
  for await (const m of Monitor.find({}).select(SECRET_FIELDS).cursor()) {
    if (![m.urlEnc, m.headersEnc, m.bodyEnc].some(needsRotation)) continue;
    const s = openMonitorSecrets(m);
    if (!s.url) continue;
    sealMonitorSecrets(m, { url: s.url, headers: s.headers, body: s.body });
    await m.save();
    rotated++;
  }
  for await (const ch of AlertChannel.find({ secretEncrypted: /^v2\./ }).cursor()) {
    if (!needsRotation(ch.secretEncrypted)) continue;
    const plain = openChannelTarget(ch);
    if (!plain) continue;
    sealChannelTarget(ch, plain);
    await ch.save();
    rotated++;
  }
  for await (const u of User.find({ totpSecretEnc: { $ne: null } }).select('+totpSecretEnc').cursor()) {
    if (!needsRotation(u.totpSecretEnc)) continue;
    const plain = decryptField(u.totpSecretEnc, userCtx(u._id, 'totp'));
    if (!plain) continue;
    u.totpSecretEnc = encryptField(plain, userCtx(u._id, 'totp'));
    await u.save({ validateBeforeSave: false });
    rotated++;
  }

  // Hostname for ownership checks (derived from the encrypted URL, which only the server can open).
  for await (const m of Monitor.find({ $or: [{ host: null }, { host: { $exists: false } }] }).select(SECRET_FIELDS).cursor()) {
    const s = openMonitorSecrets(m);
    if (!s.url) continue;
    try {
      await Monitor.updateOne({ _id: m._id }, { $set: { host: new URL(s.url).hostname.toLowerCase() } });
    } catch {
      // unparsable legacy URL — leave it
    }
  }

  if (sealed || channels || rotated) {
    logger.info(`Security migration: encrypted ${sealed} monitor(s), upgraded ${channels} channel secret(s), rotated ${rotated} value(s).`);
  }
};
