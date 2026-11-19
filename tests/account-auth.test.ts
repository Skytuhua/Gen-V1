import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { accountResolver, beginAccountLogin, endAccountLogin, holdAccountLogin } from '../packages/core/accounts.ts';
import { parseAccountAuthTarget, readAccountAuth, signOutAccount } from '../packages/runtime/account-auth.ts';
import { unavailableIdentity } from '../packages/contracts/authentication.ts';
import { HarnessError } from '../packages/contracts/index.ts';

const stores: Store[] = []; afterEach(() => { for (const store of stores.splice(0)) store.close(); });
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'harness-account-auth-')), store = new Store(root); stores.push(store); return { root, store }; }
it('requires an explicit token-free target and rejects extra input', () => {
  for (const value of [{providerId:'openai'}, {providerId:'openai',accountId:''}, {providerId:'openai',accountId:null,token:'secret'}, {providerId:'google',accountId:null}]) expect(() => parseAccountAuthTarget(value)).toThrow();
  expect(parseAccountAuthTarget({providerId:'openai',accountId:null})).toEqual({providerId:'openai',accountId:null});
});
it('reports only local credential readiness for Pi and never infers authenticated identity', async () => {
  const {root,store} = await fixture(); await mkdir(join(root,'pi')); await writeFile(join(root,'pi','auth.json'),JSON.stringify({openai:{type:'oauth',access:'never-return-secret',refresh:'private-refresh',expires:Date.now()+60000}}));
  const value = await readAccountAuth(store,{providerId:'openai',accountId:null});
  expect(value).toMatchObject({state:'configured',identity:unavailableIdentity(),lastCheckedAt:expect.any(String)});
  expect(JSON.stringify(value)).not.toMatch(/never-return-secret|private-refresh/); expect(store.snapshot()).not.toHaveProperty('accountAuth');
});
it('exposes Gemini status as unknown without claiming native identity', async () => {
  const {store} = await fixture(); expect(await readAccountAuth(store,{providerId:'gemini-cli',accountId:null})).toMatchObject({state:'unknown',identity:unavailableIdentity(),localSignout:false});
});
it('does not claim or probe an already-aborted readiness request', async () => {
  const {store}=await fixture(), control=new AbortController(), inspect=vi.fn(); control.abort();
  await expect(readAccountAuth(store,{providerId:'openai',accountId:null},inspect,control.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(inspect).not.toHaveBeenCalled();expect(store.all('accountUse')).toEqual([]);
});
it.each([false,true])('awaits cancelled readiness teardown before releasing custody (unconfirmed=%s)', async unconfirmed => {
  const {store}=await fixture(), control=new AbortController(), target={providerId:'openai' as const,accountId:null};
  let finish!:()=>void;
  const inspect=vi.fn(async (_root:string,_target:unknown,signal?:AbortSignal) => {
    await new Promise<void>(resolve=>{finish=resolve;});
    if(unconfirmed)throw new HarnessError('RUNTIME_TEARDOWN_FAILED','private teardown detail');
    signal!.throwIfAborted();
    return {state:'configured' as const,identity:unavailableIdentity(),message:'configured'};
  });
  const reading=readAccountAuth(store,target,inspect,control.signal);
  const settled=reading.then(value=>value,error=>error);
  await vi.waitFor(()=>expect(inspect).toHaveBeenCalledOnce()); control.abort();
  await expect(signOutAccount(store,target,vi.fn())).rejects.toMatchObject({code:'ACCOUNT_BUSY'});
  finish(); const result=await settled;
  expect(inspect.mock.calls[0][2]).toBe(control.signal);
  if(unconfirmed){expect(result).toMatchObject({state:'blocked'});await expect(signOutAccount(store,target,vi.fn())).rejects.toMatchObject({code:'ACCOUNT_BUSY'});}
  else {expect(result).toMatchObject({name:'AbortError'});expect(store.all('accountUse')).toEqual([]);}
});
it('retains durable unconfirmed ownership and never probes a signing-in account', async () => {
  const {store}=await fixture(), target={providerId:'openai' as const,accountId:null}, lease=beginAccountLogin(store,'openai'), probe=vi.fn();
  expect(await readAccountAuth(store,target,probe)).toMatchObject({state:'signing-in'}); holdAccountLogin(store,lease);endAccountLogin(store,lease);
  expect(await readAccountAuth(store,target,probe)).toMatchObject({state:'blocked'});expect(probe).not.toHaveBeenCalled();
});
it('blocks local credential mutation during account use and releases mutation ownership only after completion', async () => {
  const {store}=await fixture(), target={providerId:'openai' as const,accountId:null}, resolver=accountResolver(store), use=resolver.claimUse!('openai',null), remove=vi.fn(async()=>{});
  await expect(signOutAccount(store,target,remove)).rejects.toMatchObject({code:'ACCOUNT_BUSY'});expect(remove).not.toHaveBeenCalled();resolver.releaseUse!(use);
  expect(await signOutAccount(store,target,async()=>{expect(resolver.isSigningIn!('openai',null)).toBe(true);})).toMatchObject({state:'signed-out',identity:unavailableIdentity(),message:expect.stringContaining('not revoked')});
  expect(resolver.isSigningIn!('openai',null)).toBe(false);
});
it('retains mutation and use holds if native cleanup cannot be confirmed', async () => {
  const {store}=await fixture(), target={providerId:'openai' as const,accountId:null};
  const failed=async()=>{throw new HarnessError('RUNTIME_TEARDOWN_FAILED','private-provider-text');};
  const value=await readAccountAuth(store,target,failed);expect(value.state).toBe('blocked');expect(JSON.stringify(value)).not.toContain('private-provider-text');
  await expect(signOutAccount(store,target,vi.fn())).rejects.toMatchObject({code:'ACCOUNT_BUSY'});
});
it('does not invent signout commands for unsupported official providers', async () => {
  const {store}=await fixture(), remove=vi.fn();await expect(signOutAccount(store,{providerId:'claude-code',accountId:null},remove)).rejects.toMatchObject({code:'ACCOUNT_SIGNOUT_UNSUPPORTED'});expect(remove).not.toHaveBeenCalled();
});
const planKey = 'sk-kimi-never-return-fixture';
async function planFixture(provider: 'kimi-coding' | 'opencode-go') {
  const {root,store}=await fixture(), mark = provider === 'kimi-coding' ? 'kimi-code-membership-v1' : 'opencode-go-v1';
  await mkdir(join(root,'pi')); await writeFile(join(root,'pi','auth.json'),JSON.stringify({[provider]:{type:'api_key',key:planKey,env:{HARNESS_CONNECTION_KIND:mark}}}));
  return store;
}
function stubFetch(respond: () => Response | Promise<Response>) { const requests: Request[] = []; vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => { requests.push(new Request(input, init)); return respond(); })); return requests; }
afterEach(() => { vi.unstubAllGlobals(); });
it('reports Kimi as signed in only after a bounded authenticated catalog check accepts the saved key', async () => {
  const store = await planFixture('kimi-coding'), requests = stubFetch(() => Response.json({ data: [{ id: 'kimi-for-coding' }] }));
  const value = await readAccountAuth(store,{providerId:'kimi-coding',accountId:null});
  expect(value).toMatchObject({state:'authenticated',identity:unavailableIdentity(),lastCheckedAt:expect.any(String)});
  expect(requests).toHaveLength(1); expect(requests[0].url).toBe('https://api.kimi.com/coding/v1/models');
  expect(requests[0].headers.get('authorization')).toBe(`Bearer ${planKey}`); expect(requests[0].redirect).toBe('error'); expect(requests[0].signal).toBeInstanceOf(AbortSignal);
  expect(JSON.stringify(value)).not.toContain(planKey); expect(store.all('accountUse')).toEqual([]);
});
it.each([401, 403])('reports a Kimi key the provider refuses (HTTP %i) as rejected', async status => {
  const store = await planFixture('kimi-coding'); stubFetch(() => new Response('{"error":"private provider detail"}', { status, headers: { 'content-type': 'application/json' } }));
  const value = await readAccountAuth(store,{providerId:'kimi-coding',accountId:null});
  expect(value).toMatchObject({state:'rejected',identity:unavailableIdentity()}); expect(value.message).toMatch(/No app-side API billing fallback/);
  expect(JSON.stringify(value)).not.toMatch(new RegExp(`${planKey}|private provider detail`));
});
it.each([
  ['rate limit', () => new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } })],
  ['provider error', () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } })],
  ['redirect', () => new Response(null, { status: 302, headers: { location: 'https://example.invalid' } })],
  ['non-JSON body', () => new Response('<html>', { headers: { 'content-type': 'text/html' } })],
  ['malformed catalog', () => Response.json({ data: [] })],
  ['oversized body', () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024) } })],
  ['network failure', () => Promise.reject(new TypeError('private network detail'))]
] as const)('keeps a Kimi check that fails without an authentication refusal unconfirmed (%s)', async (_name, respond) => {
  const store = await planFixture('kimi-coding'); stubFetch(respond);
  const value = await readAccountAuth(store,{providerId:'kimi-coding',accountId:null});
  expect(value).toMatchObject({state:'unavailable',identity:unavailableIdentity()}); expect(JSON.stringify(value)).not.toMatch(new RegExp(`${planKey}|private network detail`));
});
it('propagates cancellation of an in-flight Kimi check instead of reporting a result', async () => {
  const store = await planFixture('kimi-coding'), control = new AbortController();
  vi.stubGlobal('fetch', vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)); queueMicrotask(() => control.abort()); })));
  await expect(readAccountAuth(store,{providerId:'kimi-coding',accountId:null},undefined,control.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(store.all('accountUse')).toEqual([]);
});
it.each(['opencode-go', 'openai'] as const)('keeps %s saved but not verified without any network check', async providerId => {
  const requests = stubFetch(() => Response.json({}));
  const store = providerId === 'opencode-go' ? await planFixture('opencode-go') : await (async () => { const {root,store} = await fixture(); await mkdir(join(root,'pi')); await writeFile(join(root,'pi','auth.json'),JSON.stringify({openai:{type:'oauth',access:'private-access',refresh:'private-refresh',expires:Date.now()+60000}})); return store; })();
  expect(await readAccountAuth(store,{providerId,accountId:null})).toMatchObject({state:'configured',identity:unavailableIdentity()}); expect(requests).toEqual([]);
});
const githubToken = 'gho_never_return_fixture';
async function copilotFixture(extra: Record<string, unknown> = {}) {
  const {root,store}=await fixture(); await mkdir(join(root,'pi'));
  await writeFile(join(root,'pi','auth.json'),JSON.stringify({'github-copilot':{type:'oauth',access:'tid=private-copilot-access',refresh:githubToken,expires:Date.now()+60000,...extra}}));
  return store;
}
it('reports Copilot as signed in only after the bounded token exchange issues a Copilot token, without returning it', async () => {
  const store = await copilotFixture(), requests = stubFetch(() => Response.json({ token: 'tid=issued-private-token', expires_at: 1_900_000_000 }));
  const value = await readAccountAuth(store,{providerId:'github-copilot',accountId:null});
  expect(value).toMatchObject({state:'authenticated',identity:unavailableIdentity()});
  expect(requests).toHaveLength(1); expect(requests[0].url).toBe('https://api.github.com/copilot_internal/v2/token');
  expect(requests[0].headers.get('authorization')).toBe(`Bearer ${githubToken}`); expect(requests[0].redirect).toBe('error'); expect(requests[0].signal).toBeInstanceOf(AbortSignal);
  expect(JSON.stringify(value)).not.toMatch(new RegExp(`${githubToken}|issued-private-token|private-copilot-access`));
});
it('sends the Copilot check only to the saved enterprise host', async () => {
  const store = await copilotFixture({ enterpriseUrl: 'https://ghe.example.com' }), requests = stubFetch(() => Response.json({ token: 't', expires_at: 1 }));
  expect(await readAccountAuth(store,{providerId:'github-copilot',accountId:null})).toMatchObject({state:'authenticated'});
  expect(requests[0].url).toBe('https://api.ghe.example.com/copilot_internal/v2/token');
});
it.each(['http://ghe.example.com', 'https://ghe.example.com:8443', 'https://user@ghe.example.com', 'localhost', 7])('keeps an unsafe Copilot enterprise host unconfirmed without a request (%s)', async enterpriseUrl => {
  const store = await copilotFixture({ enterpriseUrl }), requests = stubFetch(() => Response.json({ token: 't', expires_at: 1 }));
  expect(await readAccountAuth(store,{providerId:'github-copilot',accountId:null})).toMatchObject({state:'unavailable'}); expect(requests).toEqual([]);
});
it.each([401, 403])('reports a GitHub token refused for Copilot (HTTP %i) as rejected', async status => {
  const store = await copilotFixture(); stubFetch(() => new Response('{"message":"private detail"}', { status, headers: { 'content-type': 'application/json' } }));
  const value = await readAccountAuth(store,{providerId:'github-copilot',accountId:null});
  expect(value).toMatchObject({state:'rejected'}); expect(JSON.stringify(value)).not.toMatch(new RegExp(`${githubToken}|private detail`));
});
it.each([
  ['rate limit', () => new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } })],
  ['missing token', () => Response.json({ expires_at: 1 })],
  ['network failure', () => Promise.reject(new TypeError('private network detail'))]
] as const)('keeps a Copilot check without an authentication refusal unconfirmed (%s)', async (_name, respond) => {
  const store = await copilotFixture(); stubFetch(respond);
  expect(await readAccountAuth(store,{providerId:'github-copilot',accountId:null})).toMatchObject({state:'unavailable'});
});
