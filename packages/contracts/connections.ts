/** Public connection capabilities only. Never include account identifiers or credentials. */
export const SUBSCRIPTION_OAUTH_PROVIDER_IDS = ['openai', 'openai-codex', 'github-copilot', 'xai'] as const;
export const SUBSCRIPTION_PLAN_PROVIDER_IDS = ['kimi-coding', 'opencode-go'] as const;
export type SubscriptionOAuthProviderId = typeof SUBSCRIPTION_OAUTH_PROVIDER_IDS[number];
export type SubscriptionPlanProviderId = typeof SUBSCRIPTION_PLAN_PROVIDER_IDS[number];
export const SUBSCRIPTION_PROVIDER_IDS = [...SUBSCRIPTION_OAUTH_PROVIDER_IDS, ...SUBSCRIPTION_PLAN_PROVIDER_IDS] as const;
export type SubscriptionProviderId = typeof SUBSCRIPTION_PROVIDER_IDS[number];
export function isSubscriptionProviderId(value: unknown): value is SubscriptionProviderId {
  return typeof value === 'string' && SUBSCRIPTION_PROVIDER_IDS.some(id => id === value);
}
export function isSubscriptionOAuthProviderId(value: unknown): value is SubscriptionOAuthProviderId {
  return typeof value === 'string' && SUBSCRIPTION_OAUTH_PROVIDER_IDS.some(id => id === value);
}
export function isSubscriptionPlanProviderId(value: unknown): value is SubscriptionPlanProviderId {
  return typeof value === 'string' && SUBSCRIPTION_PLAN_PROVIDER_IDS.some(id => id === value);
}
export const OFFICIAL_RUNTIME_PROVIDER_IDS = ['claude-code', 'gemini-cli', 'cursor-sdk'] as const;
export type OfficialRuntimeProviderId = typeof OFFICIAL_RUNTIME_PROVIDER_IDS[number];
export function isOfficialRuntimeProviderId(value: unknown): value is OfficialRuntimeProviderId {
  return typeof value === 'string' && OFFICIAL_RUNTIME_PROVIDER_IDS.some(id => id === value);
}
export type ConnectionProviderId = SubscriptionProviderId | OfficialRuntimeProviderId;
export function isConnectionProviderId(value: unknown): value is ConnectionProviderId {
  return (isSubscriptionProviderId(value) || isOfficialRuntimeProviderId(value)) && SUBSCRIPTION_CONNECTIONS.some(row => row.id === value && row.status === 'available');
}

export interface SubscriptionConnection {
  id: string;
  label: string;
  status: 'available' | 'runtime-pending' | 'plan-key-pending' | 'unavailable';
  method: 'oauth' | 'official-runtime' | 'plan-key' | 'unavailable';
  description: string;
  sources: readonly string[];
}

/** Available means the integration exists, not that this installation is signed in. */
export const SUBSCRIPTION_CONNECTIONS: readonly SubscriptionConnection[] = [
  {
    id: 'openai', label: 'ChatGPT / Codex', status: 'available', method: 'oauth',
    description: 'Sign in with ChatGPT using Pi. Select an account-available model after refreshing. No API-key fallback.',
    sources: ['https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/providers/openai.ts'],
  },
  {
    id: 'openai-codex', label: 'ChatGPT / Codex (legacy)', status: 'available', method: 'oauth',
    description: 'Legacy ChatGPT subscription connection for existing Codex sessions. New connections should use ChatGPT / Codex.',
    sources: ['https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/providers/openai-codex.ts'],
  },
  {
    id: 'github-copilot', label: 'GitHub Copilot', status: 'available', method: 'oauth',
    description: 'GitHub.com device sign-in through Pi. Available models follow your account policy. Provider-side usage budgets and overage settings still apply; Enterprise domains are not configured here.',
    sources: ['https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/providers/github-copilot.ts', 'https://docs.github.com/en/billing/how-tos/set-up-budgets'],
  },
  {
    id: 'xai', label: 'xAI / Grok', status: 'available', method: 'oauth',
    description: 'SuperGrok / eligible X subscription device sign-in through Pi. Access depends on your account entitlement; provider-side usage limits and overage settings still apply.',
    sources: ['https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/providers/xai.ts', 'https://opencode.ai/docs/providers/#xai'],
  },
  {
    id: 'claude-code', label: 'Claude', status: 'available', method: 'official-runtime',
    description: 'Runs the published official Claude Code binary. Sign in directly with your own Claude plan; the harness does not handle Claude credentials. Models follow your native account access.',
    sources: ['https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use'],
  },
  {
    id: 'gemini-cli', label: 'Gemini', status: 'available', method: 'official-runtime',
    description: 'Uses the official Gemini CLI with Google-account sign-in in its own app profile. Native sessions and host task tools are preserved. No API-key billing fallback.',
    sources: ['https://geminicli.com/docs/get-started/authentication/', 'https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/providers/google.ts'],
  },
  {
    id: 'cursor-sdk', label: 'Cursor', status: 'available', method: 'official-runtime',
    description: 'Preview connection using the official Cursor SDK and private browser sign-in. Runs use your Cursor plan; paid tier and remaining allowance are not reported. Provider-side usage limits and overage settings still apply.',
    sources: ['https://cursor.com/docs/sdk/typescript'],
  },
  {
    id: 'kimi-coding', label: 'Kimi Code', status: 'available', method: 'plan-key',
    description: 'Connect a Kimi Code membership key for personal interactive coding. Uses the coding endpoint only. Provider-side Extra Usage settings still apply; no Moonshot billing fallback.',
    sources: ['https://www.kimi.com/en/help/kimi-code/membership-guide'],
  },
  {
    id: 'opencode-go', label: 'OpenCode Go', status: 'available', method: 'plan-key',
    description: 'Connect your Go workspace key. Uses Go endpoints only; provider-side Extra Usage may use your Console balance. OpenCode Zen is never substituted.',
    sources: ['https://opencode.ai/v2/docs/console/go/', 'https://opencode.ai/v2/docs/console/harnesses'],
  },
  {
    id: 'opencode', label: 'OpenCode runtime', status: 'runtime-pending', method: 'official-runtime',
    description: 'OpenCode is also an agent application with its own provider connections. Integrating that runtime is separate from an OpenCode Go subscription.',
    sources: ['https://opencode.ai/docs/acp/', 'https://opencode.ai/docs/providers/'],
  },
  {
    id: 'meta', label: 'Meta / Muse', status: 'unavailable', method: 'unavailable',
    description: 'The installed SDK includes a subscription adapter, but its account entitlement and third-party integration requirements have not been verified for this harness.',
    sources: ['https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/providers/meta.ts'],
  },
];
