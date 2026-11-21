import {afterEach,describe,expect,it} from 'vitest';
import Fastify from 'fastify';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {buildServer} from '../apps/server/server.ts';
import {registerPluginRoutes} from '../apps/server/plugin-routes.ts';
import type {PluginRegistry} from '../packages/plugins/host.ts';
import type {RuntimeAdapter} from '../packages/contracts/index.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();});
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'hooks-http-')),store=new Store(dir);
 const runtime:RuntimeAdapter={configure:()=>{},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime),app=await buildServer(service,{port:4317,dev:false});
 const bootstrap=await app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:4317'}});
 const headers={host:'127.0.0.1:4317',cookie:String(bootstrap.headers['set-cookie']).split(';')[0],'x-harness-csrf':bootstrap.json().csrfToken as string};
 cleanups.push(async()=>{await app.close();await service.dispose();store.close();rmSync(dir,{recursive:true,force:true});});
 return{app,headers};
}
const hookBody={hook:{event:'PreToolUse',matcher:'*',command:'node -e "process.exit(0)"'},baseRevision:0};

describe('hook routes',()=>{
 it('serves the empty document with coverage and no-store',async()=>{
  const{app,headers}=await setup();
  const response=await app.inject({url:'/api/hooks',headers});
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({revision:0,enabled:true,hooks:[],coverage:{covered:expect.any(Array),notCovered:expect.any(Array)}});
 });
 it('round-trips save, delete and the master switch',async()=>{
  const{app,headers}=await setup();
  const saved=(await app.inject({method:'PUT',url:'/api/hooks',headers,payload:hookBody})).json();
  expect(saved.revision).toBe(1);
  expect(saved.hooks).toHaveLength(1);
  const id=saved.hooks[0].id;
  const listed=(await app.inject({url:'/api/hooks',headers})).json();
  expect(listed.hooks[0]).toMatchObject({id,lastRun:null});
  const toggled=(await app.inject({method:'PUT',url:'/api/hooks/enabled',headers,payload:{enabled:false,baseRevision:1}})).json();
  expect(toggled).toMatchObject({revision:2,enabled:false});
  const removed=(await app.inject({method:'DELETE',url:'/api/hooks',headers,payload:{id,baseRevision:2}})).json();
  expect(removed).toMatchObject({revision:3,hooks:[]});
 });
 it('rejects a stale baseRevision like environment routes',async()=>{
  const{app,headers}=await setup();
  await app.inject({method:'PUT',url:'/api/hooks',headers,payload:hookBody});
  const stale=await app.inject({method:'PUT',url:'/api/hooks',headers,payload:hookBody});
  expect(stale.statusCode).toBe(400);
  expect(stale.json().error.code).toBe('HOOKS_CHANGED');
 });
 it('enforces the 64 KiB body limit',async()=>{
  const{app,headers}=await setup();
  const big=await app.inject({method:'PUT',url:'/api/hooks',headers,payload:{hook:{event:'PreToolUse',command:'x'.repeat(64*1024)},baseRevision:0}});
  expect(big.statusCode).toBe(413);
  expect(big.json().error.code).toBe('RESOURCE_LIMIT');
 });
 it('runs the Test endpoint with a sample payload',async()=>{
  const{app,headers}=await setup();
  const unsaved=await app.inject({method:'POST',url:'/api/hooks/test',headers,payload:{hook:{event:'UserPromptSubmit',command:process.platform==='win32'?'node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c).on(\'end\',()=>process.stdout.write(JSON.parse(d).hook_event_name))"':'node -e \'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).hook_event_name))\''}}});
  expect(unsaved.statusCode).toBe(200);
  expect(unsaved.json()).toMatchObject({outcome:'succeeded',stdout:'UserPromptSubmit',hookId:'hook_test00000000'});
  const missing=await app.inject({method:'POST',url:'/api/hooks/test',headers,payload:{id:'hook_00000000'}});
  expect(missing.statusCode).toBe(404);
 });
 it('refuses the Test endpoint while the master switch is off',async()=>{
  const{app,headers}=await setup();
  const saved=await app.inject({method:'PUT',url:'/api/hooks',headers,payload:hookBody});
  expect(saved.statusCode).toBe(200);
  const off=await app.inject({method:'PUT',url:'/api/hooks/enabled',headers,payload:{enabled:false,baseRevision:saved.json().revision}});
  expect(off.statusCode).toBe(200);
  const byId=await app.inject({method:'POST',url:'/api/hooks/test',headers,payload:{id:saved.json().hooks[0].id}});
  expect(byId.statusCode).toBe(400);
  expect(byId.json().error.code).toBe('HOOKS_DISABLED');
  const unsaved=await app.inject({method:'POST',url:'/api/hooks/test',headers,payload:{hook:{event:'UserPromptSubmit',command:'node -e "process.exit(0)"'}}});
  expect(unsaved.statusCode).toBe(400);
  expect(unsaved.json().error.code).toBe('HOOKS_DISABLED');
 });
 it('rejects requests without the session cookie like environment routes',async()=>{
  const{app,headers}=await setup();
  for(const method of ['GET','PUT']){
   const denied=await app.inject({method,url:'/api/hooks',headers:{host:headers.host}});
   expect(denied.statusCode).toBe(401);
  }
 });
 it('cannot be reached through plug-in RPC',async()=>{
  const app=Fastify();cleanups.push(async()=>{await app.close();});
  const seen:string[]=[];
  const registry={dispatch:async(_id:string,operation:string)=>{seen.push(operation);throw Error('private secret');}} as unknown as PluginRegistry;
  registerPluginRoutes(app,registry,'http://127.0.0.1:4317');
  for(const operation of ['hooks.save','hooks.read','/api/hooks']){
   const denied=await app.inject({method:'POST',url:'/api/plugins/sample-plugin/rpc',payload:{operation,input:{}}});
   // Rejected before reaching any hook store or runner: invalid operation
   // names fail schema (400) and valid-looking ones fail dispatch (503).
   expect([400,503]).toContain(denied.statusCode);
   expect(denied.body).not.toContain('private secret');
  }
  expect(seen).not.toContain('/api/hooks');
 });
});
