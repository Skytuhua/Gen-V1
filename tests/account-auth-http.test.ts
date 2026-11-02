import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import type { RuntimeAdapter } from '../packages/contracts/index.ts';
import { buildServer } from '../apps/server/server.ts';

const close: (() => Promise<void>)[] = [];afterEach(async()=>{for(const action of close.splice(0))await action();});
async function fixture() {
  const store = new Store(await mkdtemp(join(tmpdir(), 'account-auth-http-')));
  const runtime: RuntimeAdapter = { configure:()=>{}, models:async()=>[], start:async()=>{}, followUp:async()=>{}, cancel:async()=>{}, compact:async()=>{}, dispose:async()=>{}, history:async()=>[] };
  const service = new Service(store, runtime), app = await buildServer(service,{port:4317,dev:false});
  close.push(async()=>{await app.close();await service.dispose();store.close();});
  const response = await app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:4317'}}), bootstrap = response.json();
  const headers = {host:'127.0.0.1:4317',cookie:String(response.headers['set-cookie']).split(';')[0],'x-harness-csrf':bootstrap.csrfToken};
  return {store,service,app,headers};
}
it('uses existing session/CSRF protection and requires a provider plus explicit legacy or named target', async()=>{
  const {app,headers}=await fixture();
  expect((await app.inject({url:'/api/account-auth?providerId=gemini-cli&accountId=',headers:{host:headers.host}})).statusCode).toBe(401);
  for(const url of ['/api/account-auth?providerId=gemini-cli','/api/account-auth?providerId=gemini-cli&accountId=&token=secret','/api/account-auth?providerId=openai&accountId=not-an-account'])expect((await app.inject({url,headers})).statusCode).toBe(400);
  const response=await app.inject({url:'/api/account-auth?providerId=gemini-cli&accountId=',headers});
  expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');expect(response.json()).toMatchObject({providerId:'gemini-cli',accountId:null,state:'unknown',identity:{availability:'unavailable'}});
  expect((await app.inject({method:'POST',url:'/api/account-auth/signout',headers:{host:headers.host,cookie:headers.cookie},payload:{providerId:'openai',accountId:null}})).statusCode).toBe(403);
});
it('awaits prediction teardown before exclusive local signout and never accepts credentials',async()=>{
  const {app,service,headers}=await fixture();let release!:()=>void;
  const teardown = new Promise<void>(resolve=>{release=resolve;}), cancel=vi.spyOn(service,'cancelComposerPredictions').mockReturnValue(teardown);
  const pending=app.inject({method:'POST',url:'/api/account-auth/signout',headers,payload:{providerId:'openai',accountId:null}});
  let finished=false;void pending.then(()=>{finished=true;});await vi.waitFor(()=>expect(cancel).toHaveBeenCalledOnce());expect(finished).toBe(false);release();
  const response=await pending;expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({state:'signed-out',accountId:null,message:expect.stringContaining('not revoked')});
  expect((await app.inject({method:'POST',url:'/api/account-auth/signout',headers,payload:{providerId:'openai',accountId:null,accessToken:'must-not-accept'}})).statusCode).toBe(400);
},15000);
