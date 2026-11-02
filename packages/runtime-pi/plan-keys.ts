import { HarnessError } from '../contracts/index.ts';
import { SUBSCRIPTION_PLAN_PROVIDER_IDS, type SubscriptionPlanProviderId } from '../contracts/connections.ts';
import type { PiSdk } from './sdk.ts';
import type { SubscriptionRuntime } from './models.ts';

type NativeProvider = Parameters<SubscriptionRuntime['registerNativeProvider']>[0];
type PlanCredential = NonNullable<Parameters<NonNullable<NativeProvider['auth']['apiKey']>['resolve']>[0]['credential']>;
type Model = ReturnType<NativeProvider['getModels']>[number];
type RequestOptions = NonNullable<Parameters<NativeProvider['stream']>[2] | Parameters<NativeProvider['streamSimple']>[2]>;
const markers: Record<SubscriptionPlanProviderId, string> = { 'kimi-coding': 'kimi-code-membership-v1', 'opencode-go': 'opencode-go-v1' };
const USER_AGENT = 'GenerativeHarness (Pi SDK 1.4.0; interactive coding)';
const KIMI_BASE = 'https://api.kimi.com/coding/v1';
const GO_BASES: Record<string, string> = {
  'openai-completions': 'https://opencode.ai/inference/go/openai/v1',
  'openai-responses': 'https://opencode.ai/inference/go/openai/v1',
  'anthropic-messages': 'https://opencode.ai/inference/go/anthropic',
};
const MODEL_BYTES = 256 * 1024;

export function isPlanProvider(value: string): value is SubscriptionPlanProviderId {
  return SUBSCRIPTION_PLAN_PROVIDER_IDS.some(id => id === value);
}
/** A user-selected connection kind, never proof of an account's entitlement. */
export function isPlanCredential(provider: SubscriptionPlanProviderId, value: unknown): value is PlanCredential & { key: string } {
  if (!value || typeof value !== 'object') return false;
  const credential = value as PlanCredential;
  return credential.type === 'api_key' && typeof credential.key === 'string' && /^[\x21-\x7e]{1,4096}$/.test(credential.key) && !credential.key.startsWith('!') && !credential.key.includes('$')
    && credential.env?.HARNESS_CONNECTION_KIND === markers[provider];
}
function planError(message: string) { return new HarnessError('PI_PLAN_VALIDATION_FAILED', message); }
function beforeDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('Plan validation deadline reached.')); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function cancelBody(response: Response) { void response.body?.cancel().catch(() => {}); }

/** Authenticated coding catalog only: no Moonshot endpoint, redirect, cache or unbounded body. */
async function kimiModels(key: string, signal?: AbortSignal): Promise<Set<string>> {
  const timeout = AbortSignal.timeout(10_000), bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await beforeDeadline(fetch(`${KIMI_BASE}/models`, { headers: { Authorization: `Bearer ${key}`, 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'error', signal: bounded }), bounded);
    if (!response.ok || response.redirected) { cancelBody(response); throw new Error(); }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) { cancelBody(response); throw new Error(); }
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > MODEL_BYTES)) { cancelBody(response); throw new Error(); }
    if (!response.body) throw new Error();
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    try {
      for (;;) {
        const chunk = await beforeDeadline(reader.read(), bounded); if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > MODEL_BYTES) throw new Error();
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const result: unknown = JSON.parse(text);
    if (!result || typeof result !== 'object' || !('data' in result) || !Array.isArray(result.data) || !result.data.length || result.data.length > 2048) throw new Error();
    const ids = new Set<string>();
    for (const item of result.data) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-z\d][a-z\d._:-]{0,199}$/i.test(item.id) || ids.has(item.id)) throw new Error();
      ids.add(item.id);
    }
    return ids;
  } catch {
    throw planError('Kimi Code credential/model validation failed. Check the membership key, account access and quota, then refresh models. No app-side API billing fallback.');
  }
}

function endpoint(provider: SubscriptionPlanProviderId, model: Model): string | undefined {
  return provider === 'kimi-coding' ? model.api === 'openai-completions' ? KIMI_BASE : undefined : GO_BASES[model.api];
}
function inferencePath(model: Model): string {
  if (model.api === 'openai-completions') return `${model.baseUrl}/chat/completions`;
  if (model.api === 'openai-responses') return `${model.baseUrl}/responses`;
  if (model.api === 'anthropic-messages') return `${model.baseUrl}/v1/messages`;
  throw planError('This model API is not supported by the bounded plan connection.');
}
function planFetch(provider: SubscriptionPlanProviderId, model: Model, key: string, sessionId?: string): typeof fetch {
  const expected = inferencePath(model);
  return async (input, init) => {
    const request = new Request(input, init);
    const allowedUrl = request.url === expected || (model.api === 'anthropic-messages' && request.url === `${expected}?beta=true`);
    if (!allowedUrl || request.method !== 'POST') throw planError('The plan request attempted an unexpected endpoint.');
    const headers = new Headers(request.headers);
    for (const name of ['authorization', 'x-api-key', 'x-goog-api-key', 'user-agent', 'x-opencode-session']) headers.delete(name);
    headers.set(model.api === 'anthropic-messages' ? 'x-api-key' : 'authorization', model.api === 'anthropic-messages' ? key : `Bearer ${key}`);
    headers.set('User-Agent', USER_AGENT);
    if (provider === 'opencode-go') headers.set('x-opencode-session', sessionId!);
    const response = await fetch(request, { headers, redirect: 'error' });
    if (response.redirected || (response.status >= 300 && response.status < 400)) { cancelBody(response); throw planError('The plan endpoint returned a redirect. Sign in again or check provider status.'); }
    if (!response.ok) {
      cancelBody(response);
      // Provider error bodies can echo secrets; expose only status and actionable plan guidance.
      return Response.json({ error: { type: 'plan_connection_error', message: `${provider === 'opencode-go' ? 'OpenCode Go' : 'Kimi Code'} request failed (HTTP ${response.status}). Check the plan key, account access and quota. No app-side API billing fallback; provider Extra Usage still applies.` } }, { status: response.status });
    }
    return response;
  };
}

/** Native registration replaces auth entirely, avoiding the SDK's configurable auth composer. */
export async function registerPlanKeyProvider(runtime: SubscriptionRuntime, provider: SubscriptionPlanProviderId,
  { authPath, readStoredCredential, login = false }: { authPath: string; readStoredCredential: PiSdk['readStoredCredential']; login?: boolean }) {
  const native = runtime.getProvider(provider);
  if (!native) throw planError('The installed Pi SDK does not include this plan provider.');
  const installed = native.getModels().filter(model => model.provider === provider && endpoint(provider, model));
  let admitted = installed;
  if (provider === 'kimi-coding' && !login) {
    const stored = readStoredCredential(provider, authPath);
    if (!isPlanCredential(provider, stored)) throw planError('Sign in with a dedicated Kimi Code membership key.');
    const ids = await kimiModels(stored.key);
    admitted = installed.filter(model => ids.has(model.id));
  }
  if (!admitted.length) throw planError('No supported plan models match the installed Pi catalog. Refresh after updating the SDK.');
  const models = Object.freeze(admitted.map(model => Object.freeze({ ...structuredClone(model), baseUrl: endpoint(provider, model)!, headers: undefined })));
  const storedFor = (input?: PlanCredential) => {
    const stored = readStoredCredential(provider, authPath);
    return isPlanCredential(provider, stored) && isPlanCredential(provider, input) && stored.key === input.key ? stored : undefined;
  };
  const prepareRequest = (model: Model, options: RequestOptions = {}) => {
    const canonical = models.find(candidate => candidate.id === model.id && candidate.api === model.api && model.provider === provider);
    if (!canonical) throw planError('The selected model API is unavailable for this plan connection.');
    const stored = readStoredCredential(provider, authPath);
    if (!isPlanCredential(provider, stored) || options.apiKey !== stored.key) throw planError('The plan key changed or is unavailable. Sign in again and refresh models.');
    if (provider === 'opencode-go' && (typeof options.sessionId !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(options.sessionId))) throw planError('OpenCode Go requires a stable conversation session. Start an interactive thread.');
    return { model: canonical, options: { ...options, client: undefined, env: undefined, maxRetries: 0, fetch: planFetch(provider, canonical, stored.key, options.sessionId), identity: { userAgent: { custom: USER_AGENT } } } };
  };
  const replacement: NativeProvider = {
    id: provider, name: provider === 'kimi-coding' ? 'Kimi Code membership' : 'OpenCode Go',
    auth: { apiKey: {
      name: provider === 'kimi-coding' ? 'Kimi Code membership key' : 'OpenCode Go plan key',
      async login(interaction) {
        const kimi = provider === 'kimi-coding';
        const confirmation = await interaction.prompt({ type: 'select', message: kimi
          ? 'Use a Kimi Code membership key for your personal interactive coding only. This is separate from a Moonshot API key; batch, scheduled and resale use are unsupported.'
          : 'Use an OpenCode Console key from a workspace subscribed to Go. A saved key does not prove Go entitlement. No app-side API billing fallback; provider Extra Usage still applies.',
          options: [{ id: 'cancel', label: 'Cancel' }, { id: 'confirm', label: 'Confirm this dedicated plan connection' }] });
        if (confirmation !== 'confirm') throw planError('Plan connection setup cancelled.');
        const secret = await interaction.prompt({ type: 'secret', message: kimi ? 'Kimi Code membership key' : 'OpenCode Go plan key' });
        const credential = { type: 'api_key' as const, key: secret, env: { HARNESS_CONNECTION_KIND: markers[provider] } };
        if (!isPlanCredential(provider, credential)) throw planError('Enter a literal plan key with at most 4096 visible ASCII characters, no whitespace, no leading ! and no $ environment syntax.');
        if (kimi) { const ids = await kimiModels(secret, interaction.signal); if (!installed.some(model => ids.has(model.id))) throw planError('No Kimi Code models match the installed Pi catalog.'); }
        return credential;
      },
      async check({ credential }) { return storedFor(credential) ? { type: 'api_key', source: 'Dedicated stored plan key' } : undefined; },
      async resolve({ credential }) { const stored = storedFor(credential); return stored ? { auth: { apiKey: stored.key, headers: { 'User-Agent': USER_AGENT } }, source: 'Dedicated stored plan key' } : undefined; },
    } },
    getModels: () => models,
    getAllModels: () => models,
    stream(model, context, options) { const prepared = prepareRequest(model, options); return native.stream(prepared.model as typeof model, context, prepared.options as typeof options); },
    streamSimple(model, context, options) { const prepared = prepareRequest(model, options); return native.streamSimple(prepared.model, context, prepared.options as typeof options); },
  };
  runtime.registerNativeProvider(replacement);
}
