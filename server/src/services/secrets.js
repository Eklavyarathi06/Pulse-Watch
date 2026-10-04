import { encryptField, decryptField, maskUrl, maskSecret } from '../utils/crypto.js';

/*
 * One place that knows how customer secrets are sealed and opened. Contexts bind every
 * ciphertext to its tenant, record and field, so values can't be swapped between records.
 */

const monitorCtx = (monitor, field) => `ws:${monitor.workspaceId}:monitor:${monitor._id}:${field}`;
const channelCtx = (channel) => `ws:${channel.workspaceId}:channel:${channel._id}:target`;
export const userCtx = (userId, field) => `user:${userId}:${field}`;

/**
 * Writes encrypted secrets onto a monitor document (which must already have _id and workspaceId).
 * `headers` is a plain { name: value } object; `body` a string. Pass undefined to leave a field as is.
 */
export const sealMonitorSecrets = (monitor, { url, headers, body }) => {
  if (url !== undefined) {
    monitor.urlEnc = encryptField(url, monitorCtx(monitor, 'url'));
    monitor.urlDisplay = maskUrl(url);
    try {
      monitor.host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    } catch {
      monitor.host = null;
    }
  }
  if (headers !== undefined) {
    const names = Object.keys(headers || {});
    monitor.headerNames = names;
    monitor.headersEnc = names.length ? encryptField(JSON.stringify(headers), monitorCtx(monitor, 'headers')) : null;
  }
  if (body !== undefined) {
    monitor.hasBody = Boolean(body);
    monitor.bodyEnc = body ? encryptField(body, monitorCtx(monitor, 'body')) : null;
  }
  return monitor;
};

/** Decrypts a monitor's secrets. The document must have been loaded with SECRET_FIELDS. */
export const openMonitorSecrets = (monitor) => {
  const url = decryptField(monitor.urlEnc, monitorCtx(monitor, 'url'));
  let headers = {};
  if (monitor.headersEnc) {
    try {
      headers = JSON.parse(decryptField(monitor.headersEnc, monitorCtx(monitor, 'headers')) || '{}');
    } catch {
      headers = {};
    }
  }
  const body = monitor.bodyEnc ? decryptField(monitor.bodyEnc, monitorCtx(monitor, 'body')) || '' : '';
  return { url, headers, body };
};

export const sealChannelTarget = (channel, target) => {
  channel.secretEncrypted = encryptField(target, channelCtx(channel));
  return channel;
};

export const openChannelTarget = (channel) => decryptField(channel.secretEncrypted, channelCtx(channel));

export const maskChannelTarget = (channel, plain) => maskSecret(plain ?? openChannelTarget(channel), channel.type);
