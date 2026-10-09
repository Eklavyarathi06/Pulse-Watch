import axios from 'axios';
import { createRequire } from 'module';
import { validateUrlSSRF, safeHttpAgent, safeHttpsAgent } from '../utils/ssrf.js';
import { openMonitorSecrets } from './secrets.js';

/*
 * Identity sent with every check. Many sites sit behind bot firewalls (Akamai, Cloudflare…) that
 * silently drop or tarpit unknown "bot" User-Agents while allowing common HTTP clients — a UA like
 * "PulseWatch/1.0 (+…/bot)" made sites such as redbus.in look DOWN while they were up. Naming the
 * HTTP client after our own product name passes those firewalls and still identifies PulseWatch, so
 * site owners can recognise and allow-list it. A monitor can override it with its own User-Agent header.
 */
const AXIOS_VERSION = createRequire(import.meta.url)('axios/package.json').version;
export const USER_AGENT = `PulseWatch/1.0 axios/${AXIOS_VERSION}`;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // keyword search reads at most 2 MB
const DEFAULT_EXPECTED = [200, 201, 202, 203, 204];
const RETRY_DELAY_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Headers can arrive as a Mongoose Map, a plain object (lean / API payload) or nothing.
 * Always hand axios a flat { name: string } object.
 */
export const normalizeHeaders = (headers) => {
  if (!headers) return {};
  const entries = headers instanceof Map ? [...headers.entries()] : Object.entries(headers);
  return entries.reduce((acc, [k, v]) => {
    // Drop anything that could smuggle extra header lines (CR/LF injection).
    if (k && v !== undefined && v !== null && !/[\r\n\0]/.test(`${k}${v}`)) acc[String(k)] = String(v);
    return acc;
  }, {});
};

export const determineErrorType = (error) => {
  const msg = (error?.message || '').toLowerCase();
  const code = error?.code || error?.cause?.code;
  if (code === 'EBLOCKED') return 'BLOCKED_TARGET';
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || msg.includes('timeout')) return 'TIMEOUT';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS';
  if (code === 'ECONNREFUSED') return 'CONNECTION_REFUSED';
  // The server accepted the connection and then dropped it — typically a firewall rejecting the request.
  if (code === 'ECONNRESET' || code === 'EPIPE') return 'CONNECTION_RESET';
  if (
    (code && String(code).startsWith('ERR_TLS')) ||
    ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(code) ||
    msg.includes('ssl') || msg.includes('tls') || msg.includes('certificate')
  ) return 'TLS';
  return 'UNKNOWN';
};

const scrubUrl = (message, url) => {
  let msg = String(message || '');
  if (url) {
    msg = msg.split(url).join('[url]');
    try {
      const u = new URL(url);
      if (u.search) msg = msg.split(u.search).join('?[redacted]');
    } catch {
      // ignore
    }
  }
  return msg.slice(0, 300);
};

const bodyToText = (data) => {
  if (data === undefined || data === null) return '';
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
};

/**
 * Builds the in-memory request target for a monitor. Decrypted secrets live only in this object
 * for the duration of one check and are never logged or persisted.
 */
export const buildTarget = (monitor, isOwned) => {
  const { url, headers, body } = openMonitorSecrets(monitor);
  return {
    isOwned, // (host) => boolean — every redirect hop must stay on the workspace's verified domains
    url,
    headers,
    body,
    method: monitor.method,
    keyword: monitor.keyword,
    timeoutMs: monitor.timeoutMs,
    expectedStatusCodes: monitor.expectedStatusCodes,
  };
};

const makeSingleRequest = async (monitor) => {
  if (!monitor.url) {
    return { status: 'DOWN', errorType: 'UNKNOWN', errorMessage: 'Monitor secrets could not be decrypted (encryption key changed?)', responseTimeMs: 0, statusCode: null };
  }
  // Fail fast with a readable reason; the guarded agents re-check at connect time.
  const ssrfCheck = await validateUrlSSRF(monitor.url);
  if (!ssrfCheck.isValid) {
    return {
      status: 'DOWN',
      errorType: 'BLOCKED_TARGET',
      errorMessage: ssrfCheck.error,
      responseTimeMs: 0,
      statusCode: null,
    };
  }

  const method = monitor.method || 'GET';
  const sendsBody = ['POST', 'PUT'].includes(method) && monitor.body;
  const headers = { 'User-Agent': USER_AGENT, ...normalizeHeaders(monitor.headers) };
  if (sendsBody && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    // Guess JSON when the body parses as JSON, otherwise plain text.
    try {
      JSON.parse(monitor.body);
      headers['Content-Type'] = 'application/json';
    } catch {
      headers['Content-Type'] = 'text/plain';
    }
  }

  const startTime = performance.now();
  try {
    // Redirects are followed by hand so that every hop can be checked: a check may never be
    // bounced to a site outside the workspace's verified domains.
    const deadline = Date.now() + (monitor.timeoutMs || 10000);
    let currentUrl = monitor.url;
    let currentMethod = method;
    let data = sendsBody ? monitor.body : undefined;
    let response;
    for (let hop = 0; ; hop++) {
      response = await axios({
        method: currentMethod,
        url: currentUrl,
        data,
        timeout: Math.max(1, deadline - Date.now()),
        validateStatus: () => true, // resolve all HTTP statuses; we judge them ourselves
        headers,
        maxRedirects: 0,
        maxContentLength: MAX_BODY_BYTES,
        responseType: 'text',
        transformResponse: [(d) => d], // keep the raw body for keyword search
        httpAgent: safeHttpAgent,
        httpsAgent: safeHttpsAgent,
        proxy: false,
      });
      const location = response.headers?.location;
      if (!(response.status >= 300 && response.status < 400 && location) || hop >= MAX_REDIRECTS) break;
      let next;
      try {
        next = new URL(location, currentUrl);
      } catch {
        break;
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') break;
      const nextHost = next.hostname.toLowerCase();
      if (monitor.isOwned && !monitor.isOwned(nextHost)) {
        return {
          status: 'DOWN',
          errorType: 'BLOCKED_TARGET',
          errorMessage: `Redirected to ${nextHost}, which is not one of your verified domains`,
          responseTimeMs: Math.round(performance.now() - startTime),
          statusCode: response.status,
        };
      }
      // Same semantics as browsers: 303 (and 301/302 after POST) continue as GET without a body.
      if (response.status === 303 || ([301, 302].includes(response.status) && !['GET', 'HEAD'].includes(currentMethod))) {
        currentMethod = 'GET';
        data = undefined;
      }
      currentUrl = next.toString();
    }

    const responseTimeMs = Math.round(performance.now() - startTime);
    const expectedCodes = monitor.expectedStatusCodes?.length ? monitor.expectedStatusCodes : DEFAULT_EXPECTED;

    if (!expectedCodes.includes(response.status)) {
      return {
        status: 'DOWN',
        errorType: 'STATUS_MISMATCH',
        errorMessage: `Expected ${expectedCodes.join('/')} but received ${response.status}`,
        responseTimeMs,
        statusCode: response.status,
      };
    }

    const keyword = monitor.keyword?.trim();
    if (keyword && method !== 'HEAD' && !bodyToText(response.data).includes(keyword)) {
      return {
        status: 'DOWN',
        errorType: 'KEYWORD_MISSING',
        errorMessage: `Keyword "${keyword}" not found in response body`,
        responseTimeMs,
        statusCode: response.status,
      };
    }

    return { status: 'UP', responseTimeMs, statusCode: response.status };
  } catch (error) {
    const responseTimeMs = Math.round(performance.now() - startTime);
    const errorType = determineErrorType(error);
    return {
      status: 'DOWN',
      errorType,
      // Error text never echoes the URL (it may carry tokens).
      errorMessage: errorType === 'BLOCKED_TARGET' ? 'Target resolved to a private or reserved IP address' : scrubUrl(error.message, monitor.url),
      responseTimeMs,
      statusCode: error.response?.status || null,
    };
  }
};

/**
 * Runs up to three attempts. A monitor is only reported DOWN when every attempt fails,
 * which is what keeps one dropped packet from paging somebody at 3am.
 */
export const pingMonitor = async (monitor, { maxAttempts = 3, retryDelayMs = RETRY_DELAY_MS } = {}) => {
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await makeSingleRequest(monitor);
    lastResult.attempt = attempt;

    // A blocked target will never succeed on retry.
    if (lastResult.status === 'UP' || lastResult.errorType === 'BLOCKED_TARGET') {
      return lastResult;
    }

    if (attempt < maxAttempts) await sleep(retryDelayMs);
  }

  return lastResult;
};
