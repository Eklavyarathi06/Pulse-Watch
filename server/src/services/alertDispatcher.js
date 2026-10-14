import { AlertChannel } from '../models/AlertChannel.js';
import { Incident } from '../models/Incident.js';
import { providers } from './alertProviders/index.js';
import { openChannelTarget } from './secrets.js';
import { logger } from '../utils/logger.js';

export const dispatchAlerts = async (monitor, incident, event) => {
  if (!monitor.alertChannelIds || monitor.alertChannelIds.length === 0) return;

  const channels = await AlertChannel.find({
    _id: { $in: monitor.alertChannelIds },
    workspaceId: monitor.workspaceId, // never deliver to a channel from another workspace
    isActive: true,
  });

  // Re-read the incident so a concurrent dispatch for the same event is seen.
  const fresh = await Incident.findById(incident._id).lean();
  const sentLog = fresh?.alertsSent || incident.alertsSent || [];

  const alertPromises = channels.map(async (channel) => {
    // Idempotency: one successful delivery per incident + event + channel.
    const alreadySent = sentLog.some(
      (a) => a.channel?.toString() === channel._id.toString() && a.ok && a.event === event
    );
    if (alreadySent) return null;

    const provider = providers[channel.type];
    if (!provider) return null;

    const target = openChannelTarget(channel);
    if (!target) {
      return { channel: channel._id, event, sentAt: new Date(), ok: false, error: 'Channel secret could not be decrypted' };
    }

    const result = await provider.send({
      channel: { ...channel.toObject(), target },
      event,
      monitor,
      incident,
    });

    if (!result.ok) logger.warn(`Alert via ${channel.type} (${channel._id}) failed: ${result.error}`);

    return { channel: channel._id, event, sentAt: new Date(), ok: result.ok, error: result.error || undefined };
  });

  const results = (await Promise.all(alertPromises)).filter(Boolean);

  if (results.length > 0) {
    await Incident.findByIdAndUpdate(incident._id, { $push: { alertsSent: { $each: results } } });
  }
};
