import axios from 'axios';
import { AlertProvider } from './AlertProvider.js';

const post = async (target, payload) => {
  try {
    await axios.post(target, payload, { timeout: 8000, maxRedirects: 0 });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.response ? `Discord responded ${error.response.status}` : error.message };
  }
};

export class DiscordProvider extends AlertProvider {
  async _send({ target, event, monitor, incident }) {
    if (event === 'TEST') {
      return post(target, {
        embeds: [{
          title: '🔔 PulseWatch test notification',
          description: incident?.cause || 'This channel is connected. Real DOWN and RECOVERED alerts will look like this.',
          color: 16734751,
          footer: { text: 'PulseWatch' },
          timestamp: new Date().toISOString(),
        }],
      });
    }

    const isDown = event === 'DOWN';
    const color = isDown ? 16731498 : 2291104; // Red : Green
    const title = isDown ? `🚨 Monitor DOWN: ${monitor.name}` : `✅ Monitor RECOVERED: ${monitor.name}`;

    let description = `**URL:** ${(monitor.urlDisplay || monitor.url)}\n`;
    if (isDown) {
      description += `**Reason:** ${incident?.cause || 'Unknown failure'}\n`;
      description += `**Started:** <t:${Math.floor(new Date(incident?.startedAt || Date.now()).getTime() / 1000)}:R>`;
    } else {
      if (incident?.durationSeconds) {
        description += `**Downtime:** ${Math.max(1, Math.round(incident.durationSeconds / 60))} minutes\n`;
      }
      description += `**Recovered:** <t:${Math.floor(Date.now() / 1000)}:R>`;
    }

    return post(target, { embeds: [{ title, description, color, timestamp: new Date().toISOString() }] });
  }
}
