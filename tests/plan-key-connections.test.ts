import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createSubscriptionRuntime, selectSubscriptionModel, subscriptionModels } from '../packages/runtime-pi/models.ts';
import { loginSubscription, loginMain } from '../packages/runtime-pi/login.ts';

const marks = { 'kimi-coding': 'kimi-code-membership-v1', 'opencode-go': 'opencode-go-v1' } as const;
const key = 'fixture-plan-key.with-no-required-prefix';
const directories: string[] = [];
const requests: Request[] = [];
const nativeChild = createRequire(import.meta.url)('node:child_process') as typeof import('node:child_process');
let execProbe: MockInstance<typeof nativeChild.execSync>, spawnProbe: MockInstance<typeof nativeChild.spawnSync>;
let respond: (request: Request) => Response | Promise<Response>;
beforeEach(() => {
  execProbe = vi.spyOn(nativeChild, 'execSync').mockImplementation(() => { throw new Error('Synthetic command intercepted; nothing executed.'); });
  spawnProbe = vi.spyOn(nativeChild, 'spawnSync').mockImplementation(() => { throw new Error('Synthetic command intercepted; nothing executed.'); });
  syncBuiltinESMExports();
  requests.length = 0;
  respond = () => Response.json({ error: { message: 'Fixture authorization failure' } }, { status: 401 });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init); requests.push(request); return respond(request);
  }));
});
afterEach(async () => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); syncBuiltinESMExports();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 })));
});
async function storage(credentials: Record<string, unknown> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'harness-plan-')); directories.push(dataDir);
  const authPath = join(dataDir, 'pi', 'auth.json');
  await mkdir(join(dataDir, 'pi')); await writeFile(authPath, JSON.stringify(credentials));
  return { dataDir, authPath };
}
function credential(provider: keyof typeof marks) { return { type: 'api_key', key, env: { HARNESS_CONNECTION_KIND: marks[provider] } }; }
async function installed(provider: string) {
  const { authPath } = await storage();
  return (await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })).getProvider(provider)!.getModels();
}

describe('dedicated stored plan-key connections', () => {
  it('selects a healthy Go model without validating an unrelated expired Kimi key',async()=>{
    const model=(await installed('opencode-go')).find(item=>item.api==='openai-completions')!;
    const {authPath}=await storage({'opencode-go':credential('opencode-go'),'kimi-coding':credential('kimi-coding')});
    await expect(selectSubscriptionModel(authPath,`opencode-go/${model.id}`)).resolves.toMatchObject({model:{id:model.id}});
    expect(requests).toHaveLength(0);
  });
  it('keeps healthy model discovery available when another plan connection has expired',async()=>{
    const {authPath}=await storage({'opencode-go':credential('opencode-go'),'kimi-coding':credential('kimi-coding')});
    const models=await subscriptionModels(authPath);
    expect(models.length).toBeGreaterThan(0);expect(models.every(model=>model.provider==='opencode-go')).toBe(true);
    expect(requests).toHaveLength(1);
  });
  it.each([
    { 'kimi-coding': { type: 'api_key', key } },
    { 'opencode-go': { type: 'api_key', key } },
    { 'kimi-coding': { type: 'oauth', access: key, refresh: 'fixture', expires: Date.now() + 60_000 } },
    { 'opencode-go': { ...credential('opencode-go'), env: { HARNESS_CONNECTION_KIND: marks['kimi-coding'] } } },
    { opencode: credential('opencode-go') },
    {},
  ])('rejects ambient, legacy, OAuth and mismatched credentials: %j', async credentials => {
    vi.stubEnv('KIMI_API_KEY', key); vi.stubEnv('OPENCODE_API_KEY', key);
    const { authPath } = await storage(credentials);
    await expect(createSubscriptionRuntime(authPath)).rejects.toMatchObject({ code: 'PI_AUTH_REQUIRED' });
    expect(requests).toHaveLength(0); vi.unstubAllEnvs();
  });

  it('freezes installed Go models to documented endpoints and replaces all inherited auth/catalog hooks', async () => {
    const { authPath } = await storage({ 'opencode-go': credential('opencode-go') });
    const { runtime, eligible } = await createSubscriptionRuntime(authPath);
    expect(eligible).toEqual(['opencode-go']);
    const provider = runtime.getProvider('opencode-go')!;
    expect(provider.auth.oauth).toBeUndefined(); expect(provider.refreshModels).toBeUndefined();
    const bases: Record<string, string> = { 'openai-completions': 'https://opencode.ai/inference/go/openai/v1', 'openai-responses': 'https://opencode.ai/inference/go/openai/v1', 'anthropic-messages': 'https://opencode.ai/inference/go/anthropic' };
    expect(provider.getModels().length).toBeGreaterThan(0);
    for (const model of provider.getModels()) { expect(model.baseUrl).toBe(bases[model.api]); expect(Object.isFrozen(model)).toBe(true); }
    expect(provider.getModels().some(model => model.api === 'google-generative-ai')).toBe(false);
    expect(requests).toHaveLength(0); // Public model catalogs cannot prove Go entitlement.
  });

  it('resolves only the matching stored marked key, including against synthesized SDK overrides', async () => {
    const { authPath } = await storage({ 'opencode-go': credential('opencode-go') });
    const { runtime } = await createSubscriptionRuntime(authPath);
    const ctx = { env: vi.fn(async () => key), fileExists: vi.fn(async () => true) }, signal = new AbortController().signal;
    const auth = runtime.getProvider('opencode-go')!.auth.apiKey!;
    await expect(auth.resolve({ ctx, signal })).resolves.toBeUndefined();
    await expect(auth.resolve({ ctx, signal, credential: { ...credential('opencode-go'), key: 'other-fixture-key' } as any })).resolves.toBeUndefined();
    await expect(auth.resolve({ ctx, signal, credential: credential('opencode-go') as any })).resolves.toMatchObject({ auth: { apiKey: key } });
    await writeFile(authPath, JSON.stringify({ 'opencode-go': { type: 'api_key', key } }));
    await expect(auth.resolve({ ctx, signal, credential: credential('opencode-go') as any })).resolves.toBeUndefined();
    expect(ctx.env).not.toHaveBeenCalled(); expect(requests).toHaveLength(0);
  });

  it('validates Kimi credentials against bounded authenticated coding models and intersects the installed catalog', async () => {
    const catalog = await installed('kimi-coding'); const id = catalog[0].id;
    respond = () => Response.json({ data: [{ id }, { id: 'not-in-installed-sdk' }] });
    const { authPath } = await storage({ 'kimi-coding': credential('kimi-coding') });
    expect(await subscriptionModels(authPath)).toEqual([expect.objectContaining({ id: `kimi-coding/${id}` })]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://api.kimi.com/coding/v1/models');
    expect(requests[0].headers.get('authorization')).toBe(`Bearer ${key}`);
    expect(requests[0].redirect).toBe('error'); expect(requests[0].signal).toBeInstanceOf(AbortSignal);
    expect(requests[0].headers.get('user-agent')).toMatch(/GenerativeHarness/);
  });

  it.each([401, 403, 429, 302])('stops Kimi model validation after HTTP %s without fallback', async status => {
    respond = () => new Response('', { status, headers: { location: 'https://api.moonshot.ai/v1/models' } });
    const { authPath } = await storage({ 'kimi-coding': credential('kimi-coding') });
    await expect(subscriptionModels(authPath)).rejects.toMatchObject({ code: 'PI_PLAN_VALIDATION_FAILED' });
    expect(requests).toHaveLength(1);
  });

  it.each([{ data: 'wrong' }, { data: [{ id: 42 }] }, { data: [{ id: 'unknown' }] }, { data: [{ id: '../escape' }] }])('fails closed on malformed or unmatched Kimi models', async data => {
    respond = () => Response.json(data);
    const { authPath } = await storage({ 'kimi-coding': credential('kimi-coding') });
    await expect(subscriptionModels(authPath)).rejects.toThrow(); expect(requests).toHaveLength(1);
  });

  it('rejects an oversized Kimi response before accepting any models', async () => {
    respond = () => new Response(' '.repeat(256 * 1024 + 1));
    const { authPath } = await storage({ 'kimi-coding': credential('kimi-coding') });
    await expect(subscriptionModels(authPath)).rejects.toMatchObject({ code: 'PI_PLAN_VALIDATION_FAILED' });
  });

  it('bounds Kimi validation when the transport does not answer', async () => {
    const { authPath } = await storage({ 'kimi-coding': credential('kimi-coding') });
    const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    respond = () => new Promise(() => {});
    const pending = subscriptionModels(authPath);
    const outcome = expect(pending).rejects.toMatchObject({ code: 'PI_PLAN_VALIDATION_FAILED' });
    await vi.waitFor(() => expect(requests).toHaveLength(1)); deadline.abort(); await outcome;
    expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000);
    expect(requests).toHaveLength(1);
  });

  it('uses the same deadline while reading a stalled Kimi response body', async () => {
    const { authPath } = await storage({ 'kimi-coding': credential('kimi-coding') });
    const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    respond = () => new Response(new ReadableStream(), { headers: { 'content-type': 'application/json' } });
    const pending = subscriptionModels(authPath), outcome = expect(pending).rejects.toMatchObject({ code: 'PI_PLAN_VALIDATION_FAILED' });
    await vi.waitFor(() => expect(requests).toHaveLength(1)); deadline.abort(); await outcome;
  });

  it('captures fresh Kimi model validation and fixed coding inference without OAuth or Moonshot fallback', async () => {
    const catalog = await installed('kimi-coding');
    const { authPath } = await storage({ 'kimi-coding': credential('kimi-coding') });
    respond = request => request.url.endsWith('/models') ? Response.json({ data: [{ id: catalog[0].id }] }) : Response.json({ error: { message: key } }, { status: 403 });
    const { runtime, model } = await selectSubscriptionModel(authPath, `kimi-coding/${catalog[0].id}`);
    const result = await runtime.completeSimple(model, { messages: [] }, { sessionId: 'fixture-kimi-session' });
    expect(result.stopReason).toBe('error'); expect(result.errorMessage).not.toContain(key);
    expect(requests.map(request => request.url)).toEqual(['https://api.kimi.com/coding/v1/models', 'https://api.kimi.com/coding/v1/chat/completions']);
    for (const request of requests) { expect(request.headers.get('authorization')).toBe(`Bearer ${key}`); expect(request.headers.get('user-agent')).toMatch(/GenerativeHarness/); expect(request.redirect).toBe('error'); }
  });

  it.each(['openai-completions', 'openai-responses', 'anthropic-messages'])('captures %s Go SDK transport through the fixed plan boundary', async api => {
    const { authPath } = await storage({ 'opencode-go': credential('opencode-go') });
    const { runtime } = await createSubscriptionRuntime(authPath);
    const model = runtime.getModels('opencode-go').find(model => model.api === api)!;
    expect(model).toBeDefined();
    for (const status of [401, 403, 429]) {
      requests.length = 0; respond = () => Response.json({ error: { message: 'Fixture denied', type: 'authentication_error' } }, { status });
      const result = await runtime.completeSimple(model, { messages: [{ role: 'user', content: 'Fixture interactive turn', timestamp: 1 }] }, { sessionId: 'fixture-session-stable' });
      expect(result.stopReason).toBe('error'); expect(requests, result.errorMessage).toHaveLength(1);
      const request = requests[0];
      const path = api === 'anthropic-messages' ? 'anthropic/v1/messages' : `openai/v1/${api === 'openai-responses' ? 'responses' : 'chat/completions'}`;
      expect(request.url).toBe(`https://opencode.ai/inference/go/${path}${api === 'anthropic-messages' ? '?beta=true' : ''}`);
      expect(request.redirect).toBe('error');
      expect(request.headers.get(api === 'anthropic-messages' ? 'x-api-key' : 'authorization')).toBe(api === 'anthropic-messages' ? key : `Bearer ${key}`);
      expect(request.headers.get('x-opencode-session')).toBe('fixture-session-stable');
      expect(request.headers.get('user-agent')).toMatch(/GenerativeHarness/);
    }
    await expect(selectSubscriptionModel(authPath, `opencode-go/${model.id}`)).resolves.toMatchObject({ model: { id: model.id } });
  });

  it('requires a stable Go session before any inference transport', async () => {
    const { authPath } = await storage({ 'opencode-go': credential('opencode-go') });
    const { runtime } = await createSubscriptionRuntime(authPath);
    const result = await runtime.completeSimple(runtime.getModels('opencode-go')[0], { messages: [] });
    expect(result.stopReason).toBe('error'); expect(requests).toHaveLength(0);
  });

  it('never follows a Go redirect or propagates provider error bodies that can echo a key', async () => {
    const { authPath } = await storage({ 'opencode-go': credential('opencode-go') });
    const { runtime } = await createSubscriptionRuntime(authPath);
    respond = () => new Response('', { status: 302, headers: { location: 'https://opencode.ai/inference/openai/v1/chat/completions' } });
    const result = await runtime.completeSimple(runtime.getModels('opencode-go')[0], { messages: [] }, { sessionId: 'fixture-session' });
    expect(result.stopReason).toBe('error'); expect(result.errorMessage).not.toContain(key); expect(requests).toHaveLength(1); expect(requests[0].redirect).toBe('error');
  });

  it('rejects unsupported Go API families instead of substituting another provider or catalog', async () => {
    const google = (await installed('opencode-go')).find(model => model.api === 'google-generative-ai')!;
    expect(google).toBeDefined();
    const { authPath } = await storage({ 'opencode-go': credential('opencode-go') });
    await expect(selectSubscriptionModel(authPath, `opencode-go/${google.id}`)).rejects.toMatchObject({ code: 'PI_MODEL_UNAVAILABLE' });
    expect(requests).toHaveLength(0);
  });

  it.each(['kimi-coding', 'opencode-go'] as const)('logs in %s only through hidden secret input and explicit plan confirmation', async provider => {
    const catalog = await installed('kimi-coding'); respond = () => Response.json({ data: [{ id: catalog[0].id }] });
    const { dataDir, authPath } = await storage();
    const prompt = vi.fn(async (input: any) => input.type === 'select' ? 'confirm' : key), notify = vi.fn();
    await loginSubscription({ dataDir, provider, interaction: { prompt, notify } });
    expect(prompt.mock.calls[0][0]).toMatchObject({ type: 'select' });
    expect(prompt.mock.calls[1][0]).toMatchObject({ type: 'secret' });
    expect(JSON.parse(await readFile(authPath, 'utf8'))[provider]).toEqual(credential(provider));
    expect(JSON.stringify(notify.mock.calls)).not.toContain(key);
  });

  it('preserves existing credentials when dedicated-plan confirmation is cancelled', async () => {
    const previous = { 'opencode-go': { type: 'api_key', key: 'previous-fixture-secret' } };
    const { dataDir, authPath } = await storage(previous), prompt = vi.fn(async () => 'cancel');
    await expect(loginSubscription({ dataDir, provider: 'opencode-go', interaction: { prompt, notify: vi.fn() } })).rejects.toThrow(/cancel/i);
    expect(prompt).toHaveBeenCalledTimes(1); expect(JSON.parse(await readFile(authPath, 'utf8'))).toEqual(previous); expect(requests).toHaveLength(0);
  });

  it.each(['', 'with whitespace', 'with\nnewline', '非ASCII', 'a'.repeat(4097), '!synthetic-probe', '${HARNESS_SYNTHETIC_SECRET}'])('rejects unsafe plan secret input without saving it', async secret => {
    const { dataDir, authPath } = await storage(), prompt = vi.fn(async (input: any) => input.type === 'select' ? 'confirm' : secret);
    await expect(loginSubscription({ dataDir, provider: 'opencode-go', interaction: { prompt, notify: vi.fn() } })).rejects.toThrow(/key|ASCII/i);
    expect(JSON.parse(await readFile(authPath, 'utf8'))).toEqual({}); expect(requests).toHaveLength(0); expect(execProbe).not.toHaveBeenCalled(); expect(spawnProbe).not.toHaveBeenCalled();
  });

  it('never resolves a foreign command credential during native provider background refresh', async () => {
    const { authPath } = await storage({ 'opencode-go': credential('opencode-go'), anthropic: { type: 'api_key', key: '!synthetic-foreign-probe' } });
    const { runtime } = await createSubscriptionRuntime(authPath);
    await runtime.refresh({ allowNetwork: false });
    await expect(runtime.getAvailable('opencode-go')).resolves.not.toHaveLength(0);
    expect(execProbe).not.toHaveBeenCalled(); expect(spawnProbe).not.toHaveBeenCalled();
  });

  it.each(['!synthetic-stored-probe', '${HARNESS_SYNTHETIC_SECRET}'])('rejects stored marked command/environment syntax without resolving it', async unsafe => {
    const { authPath } = await storage({ 'opencode-go': { ...credential('opencode-go'), key: unsafe } });
    await expect(createSubscriptionRuntime(authPath)).rejects.toMatchObject({ code: 'PI_AUTH_REQUIRED' });
    expect(execProbe).not.toHaveBeenCalled(); expect(spawnProbe).not.toHaveBeenCalled(); expect(requests).toHaveLength(0);
  });

  it('rejects secret command-line arguments before setup', async () => {
    await expect(loginMain(['--provider', 'opencode-go', '--key', key])).rejects.toThrow(/argument|option|terminal/i);
    expect(requests).toHaveLength(0);
  });
});
