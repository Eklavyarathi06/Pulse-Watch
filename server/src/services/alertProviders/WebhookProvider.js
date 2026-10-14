import axios from 'axios';
import { AlertProvider } from './AlertProvider.js';
import { safeHttpAgent, safeHttpsAgent } from '../../utils/ssrf.js';

// Generic JSON webhook — lets users pipe PulseWatch events into anything (Zapier, n8n, PagerDuty Events, their own API).
export class WebhookProvider extends AlertProvider {
  async _send({ target, event, monitor, incident }) {
    const payload = {
      source: 'pulsewatch',
      event, // 'DOWN' | 'RECOVERED' | 'TEST'
      monitor: {
        id: monitor._id?.toString?.() || null,
        name: monitor.name,
        url: (monitor.urlDisplay || monitor.url),
        status: event === 'RECOVERED' ? 'UP' : 'DOWN',
      },
      incident: incident
        ? {
            id: incident._id?.toString?.() || null,
            cause: incident.cause || null,
            startedAt: incident.startedAt || null,
            resolvedAt: incident.resolvedAt || null,
            durationSeconds: incident.durationSeconds ?? null,
          }
        : null,
      sentAt: new Date().toISOString(),
    };

    try {
      await axios.post(target, payload, {
        timeout: 8000,
        headers: { 'User-Agent': 'PulseWatch-Webhook/1.0' },
        httpAgent: safeHttpAgent,
        httpsAgent: safeHttpsAgent,
        proxy: false,
        maxRedirects: 0,
      });
      return { ok: true };
    } catch (error) {
      const status = error.response?.status;
      return { ok: false, error: status ? `Endpoint responded ${status}` : error.message };
    }
  }
}
