import axios from 'axios';
import { AlertProvider } from './AlertProvider.js';

const post = async (target, payload) => {
  try {
    await axios.post(target, payload, { timeout: 8000, maxRedirects: 0 });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.response ? `Slack responded ${error.response.status}` : error.message };
  }
};

export class SlackProvider extends AlertProvider {
  async _send({ target, event, monitor, incident }) {
    if (event === 'TEST') {
      return post(target, {
        text: `🔔 *PulseWatch test notification*\n${incident?.cause || 'This channel is connected. Real DOWN and RECOVERED alerts will look like this.'}`,
      });
    }

    const isDown = event === 'DOWN';
    const emoji = isDown ? '🚨' : '✅';
    const text = `${emoji} Monitor ${isDown ? 'DOWN' : 'RECOVERED'}: *${monitor.name}*`;

    const fields = [{ type: 'mrkdwn', text: `*URL:*\n${(monitor.urlDisplay || monitor.url)}` }];

    if (isDown) {
      fields.push({ type: 'mrkdwn', text: `*Reason:*\n${incident?.cause || 'Unknown failure'}` });
    } else if (incident?.durationSeconds) {
      fields.push({ type: 'mrkdwn', text: `*Downtime:*\n${Math.max(1, Math.round(incident.durationSeconds / 60))} minutes` });
    }

    // `text` is the notification fallback; blocks are the rich message.
    return post(target, {
      text,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text } },
        { type: 'section', fields },
      ],
    });
  }
}
