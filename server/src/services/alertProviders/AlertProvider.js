import { logger } from '../../utils/logger.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export class AlertProvider {
  // Subclasses must implement _send({ target, event, monitor, incident }) -> { ok, error }
  async send({ channel, event, monitor, incident }, { maxAttempts = 3 } = {}) {
    let attempt = 1;
    const MAX_ATTEMPTS = maxAttempts;
    let lastError = null;

    while (attempt <= MAX_ATTEMPTS) {
      try {
        const result = await this._send({ target: channel.target, event, monitor, incident });
        if (result.ok) {
          return { ok: true, error: null };
        }
        lastError = result.error;
      } catch (error) {
        lastError = error.message;
      }

      logger.warn(`AlertProvider send failed (Attempt ${attempt}): ${lastError}`);
      
      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s
        await sleep(backoffMs);
      }
      attempt++;
    }

    return { ok: false, error: lastError };
  }
}
