import dns from 'dns';
import dnsPromises from 'dns/promises';
import http from 'http';
import https from 'https';
import ipaddr from 'ipaddr.js';
import { env } from '../config/env.js';

// Anything that isn't plain public unicast is off-limits for outbound checks.
const BLOCKED_RANGES = new Set([
  'unspecified', 'broadcast', 'multicast', 'linkLocal', 'loopback', 'carrierGradeNat',
  'private', 'reserved', 'uniqueLocal', 'ipv4Mapped', 'rfc6145', 'rfc6052', '6to4', 'teredo',
  'benchmarking', 'amt', 'as112', 'deprecated', 'orchid2',
]);

export const isBlockedIp = (ipStr) => {
  if (!ipaddr.isValid(ipStr)) return true;
  // Local development escape hatch (e.g. monitoring a service on localhost). Never enable in production.
  if (env.ALLOW_PRIVATE_TARGETS && env.NODE_ENV !== 'production') return false;
  let ip = ipaddr.parse(ipStr);
  // Unwrap ::ffff:10.0.0.1 style addresses and judge the embedded IPv4.
  if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) {
    ip = ip.toIPv4Address();
  }
  return BLOCKED_RANGES.has(ip.range());
};

export const validateUrlSSRF = async (inputUrl) => {
  let parsedUrl;
  try {
    parsedUrl = new URL(inputUrl);
  } catch {
    return { isValid: false, error: 'Invalid URL' };
  }

  // 1. Protocol check
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { isValid: false, error: 'Only http and https protocols are allowed' };
  }
  if (parsedUrl.username || parsedUrl.password) {
    return { isValid: false, error: 'Credentials in URLs are not allowed — use a request header instead' };
  }

  // 2. Resolve every address the host maps to; one bad record is enough to refuse.
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '');
  let records;
  try {
    records = ipaddr.isValid(hostname)
      ? [{ address: hostname }]
      : await dnsPromises.lookup(hostname, { all: true });
  } catch {
    return { isValid: false, error: `DNS resolution failed for ${hostname}` };
  }

  if (!records.length) {
    return { isValid: false, error: 'Could not resolve a valid IP address' };
  }

  const blocked = records.find((r) => isBlockedIp(r.address));
  if (blocked) {
    return { isValid: false, error: 'Target resolves to a private or reserved IP address' };
  }

  return { isValid: true, ip: records[0].address };
};

/**
 * DNS lookup used by the outbound HTTP agents. It runs at socket-connect time for
 * the original request AND every redirect hop, so a host that re-resolves to an
 * internal address after validation (DNS rebinding) or redirects to one is refused.
 */
const guardedLookup = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (bad) {
      const blockedErr = new Error(`Blocked request to private address ${bad.address}`);
      blockedErr.code = 'EBLOCKED';
      return callback(blockedErr);
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

export const safeHttpAgent = new http.Agent({ lookup: guardedLookup, keepAlive: false });
export const safeHttpsAgent = new https.Agent({ lookup: guardedLookup, keepAlive: false });
