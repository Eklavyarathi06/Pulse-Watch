import dns from 'dns/promises';
import crypto from 'crypto';
import axios from 'axios';
import ipaddr from 'ipaddr.js';
import { Domain } from '../models/Domain.js';
import { Monitor } from '../models/Monitor.js';
import { Workspace } from '../models/Workspace.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { safeHttpAgent, safeHttpsAgent } from '../utils/ssrf.js';
import { sendMail } from './mailer.js';
import { logger } from '../utils/logger.js';

export const TXT_PREFIX = '_pulsewatch';
export const FILE_PATH = '/.well-known/pulsewatch-verify.txt';
const RECHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const LOSS_AFTER_FAILURES = 3;

/** "https://API.Example.com:8443/x" → "api.example.com"; returns null for anything that isn't a domain name. */
export const normalizeDomain = (input) => {
  let raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) raw = `https://${raw}`;
  let host;
  try {
    host = new URL(raw).hostname; // also converts unicode names to punycode
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '').replace(/^\*\./, '').replace(/^www\./, '');
  if (ipaddr.isValid(host.replace(/^\[|\]$/g, ''))) return null; // IP addresses can't be verified
  if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host)) return null;
  return host;
};

export const hostOfUrl = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
};

export const generateProofToken = () => crypto.randomBytes(18).toString('base64url');

export const proofInstructions = (d) => ({
  dns: { type: 'TXT', name: `${TXT_PREFIX}.${d.domain}`, value: `pulsewatch-verify=${d.token}` },
  file: { url: `https://${d.domain}${FILE_PATH}`, content: d.token },
});

/** Local development: private/loopback targets (allowed by ALLOW_PRIVATE_TARGETS) count as owned. */
const devPrivateBypass = (host) => {
  if (env.NODE_ENV === 'production' || !env.ALLOW_PRIVATE_TARGETS || !host) return false;
  const bare = host.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (!ipaddr.isValid(bare)) return false;
  const range = ipaddr.parse(bare).range();
  return ['loopback', 'private', 'uniqueLocal', 'linkLocal'].includes(range);
};

/** Pure matcher: is `host` the domain itself, its www., or any subdomain of a verified domain in `domains`? */
export const hostCoveredBy = (host, domains) =>
  Boolean(host) && domains.some((d) => host === d || host === `www.${d}` || host.endsWith(`.${d}`));

export const verifiedDomainsFor = async (workspaceId) =>
  (await Domain.find({ workspaceId, status: 'verified' }).select('domain').lean()).map((d) => d.domain);

/** Does this workspace own the host (exact domain or any subdomain of one of its verified domains)? */
export const isHostVerified = async (workspaceId, host) => {
  if (!host) return false;
  if (devPrivateBypass(host)) return true;
  return hostCoveredBy(host, await verifiedDomainsFor(workspaceId));
};

/** Ownership predicate for one check run (domains loaded once; used for every redirect hop). */
export const ownershipCheckerFor = async (workspaceId) => {
  const domains = await verifiedDomainsFor(workspaceId);
  return (host) => devPrivateBypass(host) || hostCoveredBy(host, domains);
};

/**
 * One company per domain: a domain (or any parent/child of it) verified by another workspace
 * can't be claimed again. Returns the conflicting domain name, or null.
 */
export const findOwnershipConflict = async (workspaceId, domain) => {
  const others = await Domain.find({ workspaceId: { $ne: workspaceId }, status: 'verified' }).select('domain').lean();
  const hit = others.find((o) => o.domain === domain || domain.endsWith(`.${o.domain}`) || o.domain.endsWith(`.${domain}`));
  return hit ? hit.domain : null;
};

export const checkDnsProof = async (domain, token) => {
  try {
    const records = await dns.resolveTxt(`${TXT_PREFIX}.${domain}`);
    const values = records.map((parts) => parts.join(''));
    if (values.includes(`pulsewatch-verify=${token}`)) return { ok: true };
    return { ok: false, error: values.length ? 'TXT record found, but the value doesn’t match' : 'TXT record not found yet' };
  } catch (err) {
    return { ok: false, error: err.code === 'ENOTFOUND' || err.code === 'ENODATA' ? 'TXT record not found yet' : `DNS lookup failed (${err.code || err.message})` };
  }
};

export const checkFileProof = async (domain, token, { baseUrl } = {}) => {
  const url = `${baseUrl || `https://${domain}`}${FILE_PATH}`;
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 2,
      maxContentLength: 4096,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
      httpAgent: safeHttpAgent,
      httpsAgent: safeHttpsAgent,
      proxy: false,
      headers: { 'User-Agent': 'PulseWatch-Verify/1.0' },
    });
    if (res.status !== 200) return { ok: false, error: `Verification file returned HTTP ${res.status}` };
    return String(res.data || '').trim() === token ? { ok: true } : { ok: false, error: 'Verification file found, but its content doesn’t match' };
  } catch (err) {
    return { ok: false, error: `Couldn’t fetch the verification file (${err.code || err.message})` };
  }
};

/** Tries DNS first, then the file. Updates the record; returns it. */
export const verifyDomain = async (domainDoc, { fileBaseUrl } = {}) => {
  const dnsResult = await checkDnsProof(domainDoc.domain, domainDoc.token);
  const fileResult = dnsResult.ok ? null : await checkFileProof(domainDoc.domain, domainDoc.token, { baseUrl: fileBaseUrl });
  const ok = dnsResult.ok || fileResult?.ok;

  domainDoc.lastCheckedAt = new Date();
  if (ok) {
    domainDoc.status = 'verified';
    domainDoc.method = dnsResult.ok ? 'dns' : 'file';
    domainDoc.verifiedAt ||= new Date();
    domainDoc.lastError = null;
    domainDoc.failedRechecks = 0;
  } else {
    domainDoc.lastError = `${dnsResult.error}; ${fileResult?.error || ''}`.replace(/; $/, '');
    if (domainDoc.status === 'verified') domainDoc.failedRechecks += 1;
  }
  await domainDoc.save();
  return domainDoc;
};

/**
 * Ownership can change hands, so verified domains are re-checked daily. After 3 consecutive
 * failures the domain is marked lost and every monitor under it is paused (pausedByOwnership)
 * and hidden from the status page until the domain is verified again.
 */
export const monitorsUnderDomain = (workspaceId, domain) => ({
  workspaceId,
  $or: [{ host: domain }, { host: `www.${domain}` }, { host: { $regex: `\\.${domain.replace(/\./g, '\\.')}$` } }],
});

/**
 * Ownership lost: every monitor on the domain stops (unless another verified domain of the same
 * workspace still covers it) and the owner is emailed. Re-verifying resumes them.
 */
export const handleOwnershipLost = async (domainDoc, { notify = true } = {}) => {
  const monitors = await Monitor.find({ ...monitorsUnderDomain(domainDoc.workspaceId, domainDoc.domain), isActive: true }).select('_id host');
  const isOwned = await ownershipCheckerFor(domainDoc.workspaceId);
  const stop = monitors.filter((m) => !isOwned(m.host)).map((m) => m._id);
  if (stop.length) {
    await Monitor.updateMany(
      { _id: { $in: stop } },
      { $set: { isActive: false, pausedByOwnership: true, currentStatus: 'PAUSED', showOnStatusPage: false, lastStatusChangeAt: new Date() } }
    );
  }
  const ws = await Workspace.findById(domainDoc.workspaceId).select('name ownerId');
  const owner = notify && ws && (await User.findById(ws.ownerId).select('email name'));
  if (owner) {
    sendMail({
      to: owner.email,
      subject: `PulseWatch could no longer verify ${domainDoc.domain}`,
      text: `Hi ${owner.name},\n\nWe couldn't find the verification record for ${domainDoc.domain} on three daily checks in a row, so its ${stop.length} monitor(s) are paused. PulseWatch only checks websites a workspace has proven it owns.\n\nAdd the record again and press Verify under Domains — the monitors resume automatically.\n\n— PulseWatch`,
    }).catch(() => {});
  }
  logger.warn(`Domain ownership lost: ${domainDoc.domain} (workspace ${domainDoc.workspaceId}); paused ${stop.length} monitor(s)`);
};

/** Verification (re)gained: resume monitors that were stopped only because of ownership. */
export const resumeOwnedMonitors = async (domainDoc) => {
  const res = await Monitor.updateMany(
    { ...monitorsUnderDomain(domainDoc.workspaceId, domainDoc.domain), pausedByOwnership: true },
    { $set: { isActive: true, pausedByOwnership: false, currentStatus: 'PENDING', nextCheckAt: new Date(), consecutiveFailures: 0 } }
  );
  return res.modifiedCount;
};

/**
 * Reachability: one real request to the domain with PulseWatch's identity, so the customer learns
 * immediately whether their firewall lets checks through.
 */
export const testReachability = async (domain) => {
  const { pingMonitor, USER_AGENT } = await import('./pingEngine.js');
  const result = await pingMonitor(
    { url: `https://${domain}/`, method: 'GET', headers: {}, body: '', timeoutMs: 10000, expectedStatusCodes: [200, 201, 202, 203, 204, 301, 302, 304, 401, 403, 404], isOwned: () => true },
    { maxAttempts: 1 }
  );
  const answered = result.statusCode !== null && result.statusCode !== undefined;
  return {
    reachable: answered,
    statusCode: result.statusCode ?? null,
    responseTimeMs: result.responseTimeMs,
    error: answered ? null : result.errorMessage,
    blockedLikely: !answered && ['TIMEOUT', 'CONNECTION_RESET'].includes(result.errorType),
    userAgent: USER_AGENT,
  };
};

export const recheckDomains = async () => {
  const due = await Domain.find({
    status: 'verified',
    method: { $ne: 'demo' },
    $or: [{ lastCheckedAt: null }, { lastCheckedAt: { $lt: new Date(Date.now() - RECHECK_EVERY_MS) } }],
  }).limit(200);
  for (const d of due) {
    await verifyDomain(d);
    if (d.status === 'verified' && d.failedRechecks >= LOSS_AFTER_FAILURES) {
      d.status = 'lost';
      await d.save();
      await handleOwnershipLost(d);
    }
  }
};
