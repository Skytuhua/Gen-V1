import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubscriptionRuntime, selectSubscriptionModel, subscriptionModels } from '../packages/runtime-pi/models.ts';
import { loginSubscription } from '../packages/runtime-pi/login.ts';

const fixture = vi.hoisted(() => ({ sdk: undefined as any }));
vi.mock('../packages/runtime-pi/credentials.ts', () => ({ createLiteralCredentialStore: async (authPath: string) => ({ read: async (provider: string) => fixture.sdk.readStoredCredential(provider, authPath) }) }));
vi.mock('../packages/runtime-pi/sdk.ts', async original => ({
  ...await original<typeof import('../packages/runtime-pi/sdk.ts')>(),
  loadSdk: async () => fixture.sdk,
}));
vi.mock('node:fs/promises', async original => ({
  ...await original<typeof import('node:fs/promises')>(),
  mkdir: vi.fn(async () => undefined),
  chmod: vi.fn(async () => undefined),
  readFile: vi.fn(async () => 'e6596859-48bb-491d-b5c4-271cc8042721'),
}));

const enabled = ['openai', 'openai-codex', 'github-copilot', 'xai'];
function fakeSdk(credentials: Record<string, 'oauth' | 'api_key'> = {}) {
  const providers = new Map(enabled.map(id => [id, { id, auth: { oauth: { isSubscription: true }, apiKey: { resolve: vi.fn() } } }]));
  const models = enabled.map(provider => ({ provider, id: 'model', name: provider, thinkingLevelMap: { low: 'low', off: null } }));
  const runtime = {
    getProvider: vi.fn((id: string) => providers.get(id)),
    registerNativeProvider: vi.fn((provider: any) => providers.set(provider.id, provider)),
    getAvailable: vi.fn(async (id: string) => models.filter(model => model.provider === id)),
    getModel: vi.fn((provider: string, id: string) => models.find(model => model.provider === provider && model.id === id)),
    checkAuth: vi.fn(async () => ({ type: 'oauth' })),
    login: vi.fn(async (_provider: string, _method: string, _channel: unknown, _options: unknown): Promise<unknown> => ({ type: 'oauth' })),
  };
  fixture.sdk = {
    readStoredCredential: vi.fn((provider: string) => credentials[provider] && ({ type: credentials[provider] })),
    ModelRuntime: { create: vi.fn(async () => runtime) },
  };
  return { runtime, sdk: fixture.sdk, providers, models };
}
function interaction() { return { signal: new AbortController().signal, prompt: vi.fn(async () => ''), notify: vi.fn() }; }
beforeEach(() => fakeSdk());
afterEach(() => { vi.restoreAllMocks(); });

describe('subscription connection boundaries', () => {
  it('discovers only approved OAuth providers and strips every API-key resolver', async () => {
    const { sdk, runtime } = fakeSdk({ openai: 'oauth', 'github-copilot': 'oauth', xai: 'oauth', anthropic: 'oauth', google: 'api_key' });
    expect((await subscriptionModels('fake-auth')).map(model => model.provider)).toEqual(['openai', 'github-copilot', 'xai']);
    expect(runtime.registerNativeProvider.mock.calls.map(([provider]) => provider.id)).toEqual(['openai', 'github-copilot', 'xai']);
    for (const [provider] of runtime.registerNativeProvider.mock.calls) expect(Object.keys(provider.auth)).toEqual(['oauth']);
    expect(sdk.readStoredCredential.mock.calls.map(([id]: string[]) => id)).not.toContain('anthropic');
    expect(sdk.ModelRuntime.create).toHaveBeenCalledWith({ authPath: 'fake-auth', credentials: expect.objectContaining({ read: expect.any(Function) }), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  });

  it('never uses API keys or an unapproved OAuth provider when no approved subscription is present', async () => {
    const { sdk } = fakeSdk({ openai: 'api_key', xai: 'api_key', anthropic: 'oauth', 'kimi-coding': 'oauth' });
    await expect(createSubscriptionRuntime('fake-auth')).rejects.toMatchObject({ code: 'PI_AUTH_REQUIRED' });
    expect(sdk.ModelRuntime.create).not.toHaveBeenCalled();
  });

  it.each(['github-copilot', 'xai'])('selects %s with fresh auth and account-model validation', async provider => {
    const { runtime } = fakeSdk({ [provider]: 'oauth' });
    await expect(selectSubscriptionModel('fake-auth', `${provider}/model`)).resolves.toMatchObject({ model: { provider, id: 'model' } });
    expect(runtime.checkAuth).toHaveBeenCalledWith(provider);
    expect(runtime.getAvailable).toHaveBeenCalledWith(provider);
  });

  it('rejects a removed account model despite its presence in the installed catalog', async () => {
    const { runtime } = fakeSdk({ 'github-copilot': 'oauth' });
    runtime.getAvailable.mockResolvedValue([]);
    await expect(selectSubscriptionModel('fake-auth', 'github-copilot/model')).rejects.toMatchObject({ code: 'PI_MODEL_UNAVAILABLE' });
  });

  it('does not fall back when OAuth expires or resolves to another auth type', async () => {
    const { runtime } = fakeSdk({ xai: 'oauth' });
    runtime.checkAuth.mockResolvedValue({ type: 'api_key' });
    await expect(selectSubscriptionModel('fake-auth', 'xai/model')).rejects.toMatchObject({ code: 'PI_AUTH_REQUIRED' });
  });

  it.each(['anthropic', 'google', 'meta', 'xai/model', ''])('denies unsupported connection %s before runtime setup', async provider => {
    const { sdk } = fakeSdk();
    await expect(loginSubscription({ dataDir: 'fake-data', provider, interaction: interaction() })).rejects.toThrow(/unavailable|choose|supported/i);
    expect(sdk.ModelRuntime.create).not.toHaveBeenCalled();
  });

  it.each(['github-copilot', 'xai'])('passes %s through only the OAuth login method', async provider => {
    const { runtime } = fakeSdk();
    await loginSubscription({ dataDir: 'fake-data', provider, interaction: interaction() });
    expect(runtime.login).toHaveBeenCalledWith(provider, 'oauth', expect.anything(), expect.objectContaining({ agentName: 'Generative Harness' }));
  });

  it('validates device URLs before exposing them to the caller', async () => {
    const { runtime } = fakeSdk();
    runtime.login.mockImplementation(async (_provider: any, _method: any, channel: any) => {
      channel.notify({ type: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://evil.example/oauth2/device' });
    });
    const channel = interaction();
    await expect(loginSubscription({ dataDir: 'fake-data', provider: 'xai', interaction: channel })).rejects.toThrow(/authorization|sign-in|verification/i);
    expect(channel.notify).not.toHaveBeenCalled();
  });

  it('preserves device-code fields on a validated provider path', async () => {
    const { runtime } = fakeSdk();
    const event = { type: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-1234', expiresInSeconds: 900 };
    runtime.login.mockImplementation(async (_provider: any, _method: any, channel: any) => { channel.notify(event); });
    const channel = interaction();
    await loginSubscription({ dataDir: 'fake-data', provider: 'xai', interaction: channel });
    expect(channel.notify).toHaveBeenCalledWith(event);
  });

  it('rejects unconfigured GitHub Enterprise domains before the SDK can use them', async () => {
    const { runtime } = fakeSdk();
    runtime.login.mockImplementation(async (_provider: any, _method: any, channel: any) => {
      await channel.prompt({ type: 'text', message: 'GitHub Enterprise URL/domain (blank for github.com)' });
    });
    const channel = interaction(); channel.prompt.mockResolvedValue('company.example');
    await expect(loginSubscription({ dataDir: 'fake-data', provider: 'github-copilot', interaction: channel })).rejects.toThrow(/github.com|Enterprise/i);
  });

  it('publishes explicit unavailable reasons instead of advertising every SDK provider as connected', async () => {
    const { SUBSCRIPTION_CONNECTIONS, SUBSCRIPTION_PROVIDER_IDS, isSubscriptionProviderId, isOfficialRuntimeProviderId, isConnectionProviderId } = await import('../packages/contracts/connections.ts');
    expect(SUBSCRIPTION_PROVIDER_IDS).toEqual([...enabled, 'kimi-coding', 'opencode-go']);
    expect(SUBSCRIPTION_CONNECTIONS.filter(row => row.status === 'available' && row.method !== 'official-runtime').map(row => row.id)).toEqual([...enabled, 'kimi-coding', 'opencode-go']);
    expect(SUBSCRIPTION_CONNECTIONS.find(row => row.id === 'claude-code')).toMatchObject({ status: 'available', method: 'official-runtime' });
    expect(SUBSCRIPTION_CONNECTIONS.find(row => row.id === 'gemini-cli')).toMatchObject({ status: 'available', method: 'official-runtime' });
    expect(SUBSCRIPTION_CONNECTIONS.find(row => row.id === 'cursor-sdk')).toMatchObject({ status: 'available', method: 'official-runtime' });
    expect(isOfficialRuntimeProviderId('cursor-sdk')).toBe(true);
    expect(isConnectionProviderId('cursor-sdk')).toBe(true);
    expect(SUBSCRIPTION_CONNECTIONS.filter(row=>isConnectionProviderId(row.id)).map(row=>row.id)).toEqual([...enabled,'claude-code','gemini-cli','cursor-sdk','kimi-coding','opencode-go']);
    expect(SUBSCRIPTION_CONNECTIONS.find(row => row.id === 'opencode-go')).toMatchObject({ status: 'available', method: 'plan-key' });
    expect(SUBSCRIPTION_CONNECTIONS.every(row => row.description && row.sources.length)).toBe(true);
    expect(isSubscriptionProviderId('xai')).toBe(true);
    expect(isSubscriptionProviderId('anthropic')).toBe(false);
  });
});

describe('provider authorization URL admission', () => {
  it.each([
    ['openai', 'https://auth.openai.com/api/accounts/authorize?state=test', 'auth_url'],
    ['openai-codex', 'https://auth.openai.com/oauth/authorize?state=test', 'auth_url'],
    ['openai-codex', 'https://auth.openai.com/codex/device', 'device_code'],
    ['github-copilot', 'https://github.com/login/device', 'device_code'],
    ['xai', 'https://accounts.x.ai/oauth2/device?user_code=ABCD-1234', 'device_code'],
  ])('admits the exact %s login endpoint', async (provider, url, kind) => {
    const { validateSubscriptionAuthUrl } = await import('../packages/runtime-pi/connections.ts');
    expect(validateSubscriptionAuthUrl(provider, url, kind as 'auth_url' | 'device_code')).toBe(url);
  });

  it.each([
    ['xai', 'http://accounts.x.ai/oauth2/device'],
    ['xai', 'https://accounts.x.ai.evil.example/oauth2/device'],
    ['xai', 'https://accounts.x.ai@evil.example/oauth2/device'],
    ['xai', 'https://user:password@accounts.x.ai/oauth2/device'],
    ['xai', 'https://accounts.x.ai:444/oauth2/device'],
    ['xai', 'https://accounts.x.ai/oauth2/device/redirect'],
    ['xai', 'https://accounts.x.ai/oauth2/device#payload'],
    ['xai', 'https://accounts.x.ai/oauth2/%64evice'],
    ['xai', 'https://accounts.x.ai\\evil.example/oauth2/device'],
    ['xai', 'https://accounts.x.ai/oauth2/device\n'],
    ['github-copilot', 'https://github.com/login/oauth/authorize'],
    ['openai', 'https://auth.openai.com/codex/device'],
    ['google', 'https://accounts.google.com/o/oauth2/auth'],
  ])('rejects a mismatched or ambiguous %s device URL', async (provider, url) => {
    const { validateSubscriptionAuthUrl } = await import('../packages/runtime-pi/connections.ts');
    expect(() => validateSubscriptionAuthUrl(provider, url, 'device_code')).toThrow();
  });
});
