import crypto from 'crypto';
import { env } from '../config/env.js';

/**
 * Field-level encryption for customer secrets (monitor URLs, auth headers, request bodies,
 * alert-channel targets, 2FA seeds).
 *
 *  - AES-256-GCM (authenticated encryption).
 *  - Every value gets its own key, derived with HKDF from the master key and a context string
 *    such as "ws:<workspaceId>:monitor:<monitorId>:url". The same context is bound as GCM
 *    additional data, so a ciphertext copied to another record or tenant will not decrypt.
 *  - The master key lives only in the server environment (ENCRYPTION_KEY), never in MongoDB:
 *    a database leak or backup exposes ciphertext only.
 *  - Ciphertexts carry a key id, so keys can be rotated: set the new ENCRYPTION_KEY, move the old
 *    one to ENCRYPTION_KEY_PREVIOUS, restart — values are re-encrypted with the new key on boot.
 *
 * Format: v2.<kid>.<iv>.<ciphertext>.<tag>  (base64url parts)
 */

const PREFIX = 'v2';
const roots = new Map(); // kid -> root key

const deriveRoot = (secret) => {
  const root = crypto.scryptSync(secret, 'pulsewatch/field-encryption/v2', 32);
  const kid = crypto.createHash('sha256').update(root).digest('hex').slice(0, 8);
  return { kid, root };
};

let current = null;
const keyring = () => {
  if (!current) {
    current = deriveRoot(env.ENCRYPTION_KEY);
    roots.set(current.kid, current.root);
    if (env.ENCRYPTION_KEY_PREVIOUS) {
      const prev = deriveRoot(env.ENCRYPTION_KEY_PREVIOUS);
      roots.set(prev.kid, prev.root);
    }
  }
  return current;
};

const subkey = (root, context) =>
  Buffer.from(crypto.hkdfSync('sha256', root, Buffer.from('pulsewatch'), Buffer.from(context), 32));

export const currentKeyId = () => keyring().kid;

export const encryptField = (plaintext, context) => {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  if (!context) throw new Error('encryptField requires a context');
  const { kid, root } = keyring();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', subkey(root, context), iv);
  cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [PREFIX, kid, iv.toString('base64url'), ct.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
};

export const decryptField = (token, context) => {
  if (!token) return null;
  keyring();
  try {
    const [prefix, kid, iv, ct, tag] = String(token).split('.');
    if (prefix !== PREFIX) return null;
    const root = roots.get(kid);
    if (!root) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', subkey(root, context), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null; // wrong key, wrong context, or tampered
  }
};

/** True when a v2 value was sealed with a key other than the current one (rotation pending). */
export const needsRotation = (token) =>
  typeof token === 'string' && token.startsWith(`${PREFIX}.`) && token.split('.')[1] !== currentKeyId();

/* ── Legacy v1 format ("iv:ct:tag", one scrypt key for everything) — read only, for migration ── */
const legacyKeys = new Map();
export const decryptLegacy = (encryptedText) => {
  if (!encryptedText || String(encryptedText).startsWith(`${PREFIX}.`)) return null;
  const parts = String(encryptedText).split(':');
  if (parts.length !== 3) return null;
  for (const secret of [env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS].filter(Boolean)) {
    try {
      if (!legacyKeys.has(secret)) legacyKeys.set(secret, crypto.scryptSync(secret, 'salt', 32));
      const decipher = crypto.createDecipheriv('aes-256-gcm', legacyKeys.get(secret), Buffer.from(parts[0], 'hex'));
      decipher.setAuthTag(Buffer.from(parts[2], 'hex'));
      return decipher.update(parts[1], 'hex', 'utf8') + decipher.final('utf8');
    } catch {
      // try the next key
    }
  }
  return null;
};

export const maskSecret = (secret, type) => {
  if (!secret) return '';
  if (type === 'email') {
    const [user, domain] = secret.split('@');
    if (!domain) return '***';
    return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`;
  }
  try {
    // Webhook URLs carry their token in the path — show the host only.
    const u = new URL(secret);
    return `${u.protocol}//${u.host}/••••••`;
  } catch {
    return '***';
  }
};

const TOKENISH = /^[A-Za-z0-9_\-.~%+=]{20,}$/;
/**
 * Display-safe version of a monitored URL: credentials and fragment dropped, every query value
 * hidden, long token-like path segments hidden. Used wherever a URL is shown or put in an alert.
 */
export const maskUrl = (raw) => {
  try {
    const u = new URL(raw);
    const path = u.pathname
      .split('/')
      .map((seg) => (TOKENISH.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg) ? '•••' : seg))
      .join('/');
    const keys = [...new Set(u.searchParams.keys())];
    const query = keys.length ? `?${keys.map((k) => `${encodeURIComponent(k)}=•••`).join('&')}` : '';
    return `${u.protocol}//${u.host}${path}${query}`;
  } catch {
    return '•••';
  }
};
