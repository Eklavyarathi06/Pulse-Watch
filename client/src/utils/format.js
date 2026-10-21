// Display helpers shared by dashboard, status page and landing.

export const fmtMs = (ms) => {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms >= 10000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
};

export const fmtUptime = (pct, digits = 2) => {
  if (pct === null || pct === undefined) return '—';
  if (pct >= 100) return '100%';
  // Never round 99.996 up to "100%" — that would hide real downtime.
  const f = 10 ** digits;
  return `${(Math.floor(pct * f) / f).toFixed(digits)}%`;
};

export const fmtDuration = (seconds) => {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60 ? `${s % 60}s` : ''}`.trim();
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24 ? `${h % 24}h` : ''}`.trim();
};

/** Long-form for the SLA calculator: "8h 45m 36s". */
export const fmtDurationLong = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (sec || parts.length === 0) parts.push(`${sec}s`);
  return parts.slice(0, 3).join(' ');
};

const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat
  ? new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })
  : null;

export const fmtRelative = (date) => {
  if (!date) return 'never';
  const diff = (new Date(date).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 5) return 'just now';
  const table = [
    [60, 'second', 1],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [604800, 'day', 86400],
    [Infinity, 'week', 604800],
  ];
  for (const [limit, unit, div] of table) {
    if (abs < limit) {
      const v = Math.round(diff / div);
      return rtf ? rtf.format(v, unit) : `${Math.abs(v)} ${unit}s ago`;
    }
  }
  return '';
};

export const fmtTime = (date) =>
  new Date(date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const fmtDateTime = (date) =>
  new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtDay = (date) =>
  new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const fmtInterval = (s) => (s < 60 ? `${s}s` : `${s / 60}m`);

export const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export const ERROR_LABELS = {
  TIMEOUT: 'Timed out',
  DNS: 'DNS failure',
  CONNECTION_REFUSED: 'Connection refused',
  CONNECTION_RESET: 'Connection dropped (site may block automated checks)',
  TLS: 'TLS / certificate error',
  STATUS_MISMATCH: 'Unexpected status',
  KEYWORD_MISSING: 'Keyword missing',
  BLOCKED_TARGET: 'Blocked target',
  UNKNOWN: 'Unknown error',
};

const inr = typeof Intl !== 'undefined' ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 }) : null;
/** Razorpay amounts are in paise. */
export const fmtMoney = (paise, currency = 'INR') =>
  currency === 'INR' && inr ? inr.format(paise / 100) : `${(paise / 100).toFixed(2)} ${currency}`;
