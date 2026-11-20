import { afterEach, describe, expect, it, vi } from 'vitest';
import { HarnessError } from '../packages/contracts/index.ts';
import { isPlanCredential, isPlanProvider, registerPlanKeyProvider } from '../packages/runtime-pi/plan-keys.ts';
import type { SubscriptionRuntime } from '../packages/runtime-pi/models.ts';
import type { PiSdk } from '../packages/runtime-pi/sdk.ts';

type Model = { id: string; provider: string; api: string; baseUrl?: string; headers?: unknown };
type NativeProvider = { getModels: () => Model[]; stream: ReturnType<typeof vi.fn>; streamSimple: ReturnType<typeof vi.fn> };

const marks = { 'kimi-coding': 'kimi-code-membership-v1', 'opencode-go': 'opencode-go-v1' } as const;
const credential = (provider: keyof typeof marks, key = 'fixture-plan-key') =>
  ({ type: 'api_key', key, env: { HARNESS_CONNECTION_KIND: marks[provider] } });

function runtimeWith(models: Model[]) {
  const native: NativeProvider = { getModels: () => models, stream: vi.fn(), streamSimple: vi.fn() };
  const registered: unknown[] = [];
  const runtime = {
    getProvider: vi.fn(() => native),
    registerNativeProvider: vi.fn((provider: unknown) => { registered.push(provider); }),
  };
  return { runtime: runtime as unknown as SubscriptionRuntime, native, registered };
}
const readStoredCredential: PiSdk['readStoredCredential'] = () => undefined;

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('isPlanProvider', () => {
  it.each([
    ['kimi-coding', true], ['opencode-go', true],
    ['', false], ['KIMI-CODING', false], ['openai', false], ['kimi', false],
    ['opencode', false], ['oauth-google', false], ['kimi-coding ', false],
  ])('classifies %s as %s', (value, expected) => {
    expect(isPlanProvider(value)).toBe(expected);
  });
});

describe('isPlanCredential', () => {
  it('accepts a matching api_key credential for each provider', () => {
    expect(isPlanCredential('kimi-coding', credential('kimi-coding'))).toBe(true);
    expect(isPlanCredential('opencode-go', credential('opencode-go'))).toBe(true);
  });
  it.each([
    ['marker swapped', credential('opencode-go')],
    ['missing marker', { type: 'api_key', key: 'fixture-plan-key' }],
    ['wrong type', { ...credential('kimi-coding'), type: 'oauth' }],
    ['leading bang', credential('kimi-coding', '!abc123')],
    ['dollar syntax', credential('kimi-coding', 'a$b')],
    ['whitespace', credential('kimi-coding', 'a b')],
    ['empty key', credential('kimi-coding', '')],
    ['non-ascii', credential('kimi-coding', 'kλy')],
    ['oversized key', credential('kimi-coding', 'x'.repeat(4097))],
    ['null', null], ['string', 'x'], ['number', 5],
  ])('rejects %s', (_name, value) => {
    expect(isPlanCredential('kimi-coding', value)).toBe(false);
  });
  it('rejects a credential whose env marker is not a string match', () => {
    const value = { type: 'api_key', key: 'fixture-plan-key', env: { HARNESS_CONNECTION_KIND: 'other' } };
    expect(isPlanCredential('opencode-go', value)).toBe(false);
  });
});

describe('registerPlanKeyProvider', () => {
  const goModel = (api = 'openai-completions'): Model => ({ id: 'go-m1', provider: 'opencode-go', api });

  it('registers a frozen replacement provider without touching credential storage for opencode-go', async () => {
    const { runtime, registered } = runtimeWith([goModel()]);
    await registerPlanKeyProvider(runtime, 'opencode-go', { authPath: '/unused', readStoredCredential });
    expect(registered).toHaveLength(1);
    const replacement = registered[0] as { id: string; name: string; getModels: () => Model[] };
    expect(replacement.id).toBe('opencode-go');
    expect(replacement.name).toBe('OpenCode Go');
    const models = replacement.getModels();
    expect(models).toHaveLength(1);
    expect(Object.isFrozen(models)).toBe(true);
    expect(Object.isFrozen(models[0])).toBe(true);
    expect(models[0].baseUrl).toBe('https://opencode.ai/inference/go/openai/v1');
    expect(models[0].headers).toBeUndefined();
  });

  it('rejects when the SDK has no provider with that id', async () => {
    const runtime = { getProvider: vi.fn(() => undefined), registerNativeProvider: vi.fn() } as unknown as SubscriptionRuntime;
    await expect(registerPlanKeyProvider(runtime, 'opencode-go', { authPath: '/unused', readStoredCredential }))
      .rejects.toMatchObject({ name: 'HarnessError', code: 'PI_PLAN_VALIDATION_FAILED' });
  });

  it('rejects when no installed model has a bounded endpoint', async () => {
    const { runtime } = runtimeWith([{ id: 'g-x', provider: 'opencode-go', api: 'unknown-api' }]);
    await expect(registerPlanKeyProvider(runtime, 'opencode-go', { authPath: '/unused', readStoredCredential }))
      .rejects.toMatchObject({ code: 'PI_PLAN_VALIDATION_FAILED' });
  });

  it('rejects kimi-coding without a stored plan credential', async () => {
    const { runtime } = runtimeWith([{ id: 'k1', provider: 'kimi-coding', api: 'openai-completions' }]);
    await expect(registerPlanKeyProvider(runtime, 'kimi-coding', { authPath: '/unused', readStoredCredential }))
      .rejects.toMatchObject({ code: 'PI_PLAN_VALIDATION_FAILED' });
  });

  it('admits kimi-coding models only when the catalog fetch confirms them', async () => {
    const stored = () => credential('kimi-coding');
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: 'k1' }, { id: 'other' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { runtime, registered } = runtimeWith([
      { id: 'k1', provider: 'kimi-coding', api: 'openai-completions' },
      { id: 'k2', provider: 'kimi-coding', api: 'openai-completions' },
    ]);
    await registerPlanKeyProvider(runtime, 'kimi-coding', { authPath: '/unused', readStoredCredential: stored as PiSdk['readStoredCredential'] });
    expect(fetchMock).toHaveBeenCalledOnce();
    const replacement = registered[0] as { getModels: () => Model[] };
    expect(replacement.getModels().map(model => model.id)).toEqual(['k1']);
  });

  it('maps catalog validation failures to a HarnessError with the plan code', async () => {
    const stored = () => credential('kimi-coding');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } })));
    const { runtime } = runtimeWith([{ id: 'k1', provider: 'kimi-coding', api: 'openai-completions' }]);
    const failure = await registerPlanKeyProvider(runtime, 'kimi-coding', { authPath: '/unused', readStoredCredential: stored as PiSdk['readStoredCredential'] })
      .then(() => { throw new Error('expected rejection'); }, error => error as HarnessError);
    expect(failure).toBeInstanceOf(HarnessError);
    expect(failure.code).toBe('PI_PLAN_VALIDATION_FAILED');
  });
});
