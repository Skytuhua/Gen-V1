import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { HarnessError } from '../contracts/index.ts';
import { isSubscriptionProviderId, isSubscriptionOAuthProviderId, SUBSCRIPTION_CONNECTIONS, type SubscriptionProviderId, type SubscriptionOAuthProviderId } from '../contracts/connections.ts';

type Interaction = Parameters<ModelRuntime['login']>[2];
type AuthUrlKind = 'auth_url' | 'device_code';
const endpoints: Record<SubscriptionOAuthProviderId, Partial<Record<AuthUrlKind, readonly string[]>>> = {
  openai: { auth_url: ['https://auth.openai.com/api/accounts/authorize'] },
  'openai-codex': { auth_url: ['https://auth.openai.com/oauth/authorize'], device_code: ['https://auth.openai.com/codex/device'] },
  'github-copilot': { device_code: ['https://github.com/login/device'] },
  xai: { device_code: ['https://accounts.x.ai/oauth2/device'] },
};

export function requireSubscriptionProvider(value: unknown): SubscriptionProviderId {
  if (!isSubscriptionProviderId(value)) throw new HarnessError('PI_PROVIDER_UNAVAILABLE', 'Choose an available subscription connection: openai, openai-codex, github-copilot, xai, kimi-coding or opencode-go.');
  return value;
}
export function subscriptionProviderLabel(provider: SubscriptionProviderId): string {
  return SUBSCRIPTION_CONNECTIONS.find(connection => connection.id === provider)!.label;
}

/** Fixed SDK authorization surfaces, not arbitrary URLs received through a notification. */
export function validateSubscriptionAuthUrl(provider: unknown, raw: string, kind: AuthUrlKind): string {
  const id = requireSubscriptionProvider(provider);
  if (!isSubscriptionOAuthProviderId(id)) throw new HarnessError('PI_AUTH_URL_INVALID', 'This plan-key connection does not use browser authorization.');
  let url: URL;
  try {
    if (typeof raw !== 'string' || raw.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(raw)) throw new Error();
    url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error();
    const allowed = endpoints[id][kind] ?? [];
    if (!allowed.includes(url.origin + url.pathname)) throw new Error();
  } catch { throw new HarnessError('PI_AUTH_URL_INVALID', 'The subscription provider returned an unexpected authorization or verification URL. Sign-in was stopped.'); }
  return url.href;
}

/** Validate before callers display/open URLs; keep authorization codes inside the console. */
export function subscriptionInteraction(provider: SubscriptionProviderId, interaction: Interaction): Interaction {
  return {
    signal: interaction.signal,
    async prompt(prompt) {
      const result = await interaction.prompt(prompt);
      // Pi supports arbitrary Enterprise domains. This bounded connector does not.
      if (provider === 'github-copilot' && prompt.type === 'text') {
        if (result.trim() !== '' && result.trim() !== 'github.com') throw new HarnessError('PI_ENTERPRISE_UNAVAILABLE', 'Only github.com sign-in is configured. GitHub Enterprise domains require a separate connection.');
        return '';
      }
      return result;
    },
    notify(event) {
      if (event.type === 'auth_url') interaction.notify({ ...event, url: validateSubscriptionAuthUrl(provider, event.url, event.type) });
      else if (event.type === 'device_code') {
        if (!/^[a-z\d][a-z\d -]{0,127}$/i.test(event.userCode)) throw new HarnessError('PI_AUTH_CODE_INVALID', 'The subscription provider returned an invalid device code. Sign-in was stopped.');
        interaction.notify({ ...event, verificationUri: validateSubscriptionAuthUrl(provider, event.verificationUri, event.type) });
      } else interaction.notify(event);
    },
  };
}
