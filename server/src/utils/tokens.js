import crypto from 'crypto';

/** Random, URL-safe single-use token. Only its SHA-256 hash is ever stored. */
export const createToken = () => {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
};

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** Constant-time comparison for HMAC hex strings. */
export const safeEqualHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
};

export const slugify = (input) =>
  String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';
