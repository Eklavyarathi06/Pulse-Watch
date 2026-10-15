import { env } from '../../config/env.js';
import { AlertProvider } from './AlertProvider.js';
import { getTransporter } from '../mailer.js';

const buildMessage = ({ event, monitor, incident }) => {
  if (event === 'TEST') {
    return {
      subject: '🔔 PulseWatch test notification',
      text: `${incident?.cause || 'This email channel is connected.'}\n\nReal DOWN and RECOVERED alerts for your monitors will arrive at this address.\n\n— PulseWatch`,
    };
  }

  const isDown = event === 'DOWN';
  const subject = isDown ? `🚨 Monitor DOWN: ${monitor.name}` : `✅ Monitor RECOVERED: ${monitor.name}`;

  let text = `Monitor Name: ${monitor.name}\nURL: ${(monitor.urlDisplay || monitor.url)}\n\n`;
  if (isDown) {
    text += `Status: DOWN\n`;
    text += `Reason: ${incident?.cause || 'Unknown failure'}\n`;
    text += `Time: ${new Date(incident?.startedAt || Date.now()).toUTCString()}\n`;
  } else {
    text += `Status: RECOVERED\n`;
    if (incident?.durationSeconds) {
      text += `Downtime: ${Math.max(1, Math.round(incident.durationSeconds / 60))} minutes\n`;
    }
    text += `Time: ${new Date().toUTCString()}\n`;
  }
  return { subject, text };
};

export class EmailProvider extends AlertProvider {
  async _send({ target, event, monitor, incident }) {
    try {
      const { subject, text } = buildMessage({ event, monitor, incident });
      await getTransporter().sendMail({ from: env.SMTP_FROM, to: target, subject, text });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
}
