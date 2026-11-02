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
