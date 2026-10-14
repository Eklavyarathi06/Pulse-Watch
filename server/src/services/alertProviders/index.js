import { DiscordProvider } from './DiscordProvider.js';
import { SlackProvider } from './SlackProvider.js';
import { EmailProvider } from './EmailProvider.js';
import { WebhookProvider } from './WebhookProvider.js';

// Single registry so the dispatcher and the "send test" endpoint can never drift apart.
export const providers = {
  discord: new DiscordProvider(),
  slack: new SlackProvider(),
  email: new EmailProvider(),
  webhook: new WebhookProvider(),
};
