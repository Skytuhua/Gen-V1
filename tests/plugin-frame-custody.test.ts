import {afterAll,beforeAll,expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,type Browser} from '@playwright/test';
import {createServer,type Server} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {buildServer} from '../apps/server/server.ts';
import type {PluginRegistry} from '../packages/plugins/host.ts';
import {trustedPluginDocument,trustedPluginManifest,trustedPluginScript} from './fixtures/trusted-plugin-frame.ts';

let browser:Browser,app:Awaited<ReturnType<typeof buildServer>>,attacker:Server,service:Service,store:Store;
let directory='',documentPath='',documentName='',origin='',attackerOrigin='',externalLoads=0;
const operations:string[]=[],slow=new Map<string,(value:unknown)=>void>();
const manifest=trustedPluginManifest;
const parentDocument='<!doctype html><html><body><div id="root"></div><button id="flush">Save and close</button><output id="saved"></output><script src="/__custody-parent.js"></script></body></html>';
async function bundle(contents:string,development=false,globalName?:string){return (await build({stdin:{contents,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',globalName,define:{'process.env.NODE_ENV':JSON.stringify(development?'development':'production')},nodePaths:(process.env.NODE_PATH??'').split(delimiter).filter(Boolean),loader:{'.css':'empty'}})).outputFiles[0].text;}
async function listen(server:Server){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;}
beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'gen-plugin-custody-'));
 attacker=createServer((request,response)=>{response.setHeader('Content-Type','text/html');if(request.url?.startsWith('/widget/')){response.end('<!doctype html><p>Generated widget shell</p>');return;}externalLoads++;response.end(`<!doctype html><script>
  const query=new URLSearchParams(location.search),session=query.get('session');window.received=[];
  addEventListener('message',event=>{window.received.push(event.data);if(event.data?.type==='gen.plugin.flush')parent.postMessage({type:'gen.plugin.flushed',session:event.data.session,id:event.data.id,ok:true},'*');});
  parent.postMessage({type:'gen.plugin.request',pluginId:'sample-plugin',session,id:'forged-before-load',operation:'state.read',input:{key:'attacker'}},'*');
  parent.postMessage({type:'gen.plugin.connect',pluginId:'sample-plugin',session},'*',[new MessageChannel().port1]);
  parent.postMessage({type:'gen.plugin.flushed',session,id:query.get('flush'),ok:true},'*');
 </script>`);});attackerOrigin=await listen(attacker);
 const probe=createServer();const free=await listen(probe);const port=Number(new URL(free).port);await new Promise<void>(resolve=>probe.close(()=>resolve()));
 store=new Store(join(directory,'store'));
 // Only the real document/plug-in routes are exercised; no model/runtime starts.
 service={store,dispose:async()=>{}} as unknown as Service;
 const registry={list:()=>[manifest],validateSurface:async()=>true,readAsset:async()=>({bytes:Buffer.from(trustedPluginDocument),contentType:'text/html'}),dispatch:async(_id:string,operation:string,input:{key?:string})=>{operations.push(input.key??operation);if(input.key==='slow')return new Promise(resolve=>slow.set('slow',resolve));return {private:'owner-only',key:input.key};}} as unknown as PluginRegistry;
 app=await buildServer(service,{port,dev:false,widgetPort:Number(new URL(attackerOrigin).port),plugins:registry});
 const parentJs=await bundle(`import React from 'react';import {createRoot} from 'react-dom/client';import {PluginFrame} from './apps/web/src/PluginFrame.tsx';import {prepareEditorHandoff} from './apps/web/src/editor-handoff.ts';
  const manifest=${JSON.stringify(manifest)};window.__lastFlush='';window.__globalRequests=[];addEventListener('message',event=>{if(event.data?.type==='gen.plugin.request')window.__globalRequests.push(event.data.id);});const original=MessagePort.prototype.postMessage;MessagePort.prototype.postMessage=function(value,...rest){if(value?.type==='gen.plugin.flush')window.__lastFlush=value.id;return original.call(this,value,...rest);};
  const surface=location.search.includes('scoped')?{kind:'plugin',pluginId:'sample-plugin',scopeId:'project-a',surfaceId:'plan',resourceId:'order-a'}:undefined;
  createRoot(document.getElementById('root')).render(<React.StrictMode><PluginFrame plugin={manifest} surface={surface} theme="dark" onReady={()=>{document.body.dataset.ready='true';}}/></React.StrictMode>);
  document.getElementById('flush').onclick=()=>{document.getElementById('saved').textContent='pending';void prepareEditorHandoff().then(()=>{document.getElementById('saved').textContent='saved';},()=>{document.getElementById('saved').textContent='blocked';});};`,true);
 // Match the real installed-package ordering: the server injects the actual
 // classic GenPluginUI host runtime in <head>, before the private UI script.
 const runtimeJs=await bundle(`export * from './apps/web/src/plugin-runtime.tsx';`,false,'GenPluginUI');
 const childJs=trustedPluginScript;
 app.get('/plugin-runtime/runtime.js',(_request,reply)=>reply.type('text/javascript').send(runtimeJs));
 app.get('/plugin-runtime/runtime.css',(_request,reply)=>reply.type('text/css').send(''));
 app.get('/__custody-parent.js',(_request,reply)=>reply.type('text/javascript').send(parentJs));
 app.get('/__custody-child.js',(_request,reply)=>reply.type('text/javascript').send(childJs));
 // The unrestricted document deliberately removes the CSP layer so that a real
 // replacement document exercises the independent document-bound RPC defense.
 app.get('/__custody-unrestricted',(_request,reply)=>reply.type('text/html').send(parentDocument));
 documentName=`plugin-custody-${randomUUID()}.html`;documentPath=resolve('dist/web',documentName);await mkdir(resolve('dist/web'),{recursive:true});await writeFile(documentPath,parentDocument,{flag:'wx'});
 origin=await app.listen({port,host:'127.0.0.1'});
 browser=await chromium.launch({headless:true,...(process.env.GEN_TEST_CHROMIUM_EXECUTABLE?{executablePath:process.env.GEN_TEST_CHROMIUM_EXECUTABLE}:{})});
});
afterAll(async()=>{for(const finish of slow.values())finish(null);await browser?.close();await app?.close();await service?.dispose();store?.close();if(attacker?.listening)await new Promise<void>(resolve=>attacker.close(()=>resolve()));if(documentPath)await rm(documentPath,{force:true});if(directory)await rm(directory,{recursive:true,force:true});});

it('restricts parent frames to installed plug-in documents and the explicit widget destination',async()=>{
 const response=await app.inject({url:`/${documentName}`,headers:{host:new URL(origin).host}});
 expect(response.headers['content-security-policy']).toContain(`${origin}/plugins/sample-plugin/frame`);
 expect(response.headers['content-security-policy']).toContain(`http://localhost:${new URL(attackerOrigin).port}/widget/`);
 const page=await browser.newPage();try{
  await page.goto(`${origin}/${documentName}`);await page.locator('body[data-ready="true"]').waitFor();
  const child=page.frames().find(frame=>frame.url().includes('/plugins/sample-plugin/frame'))!;expect(await child.locator('#result').textContent()).toBe('owner-only');
  const widget=`http://localhost:${new URL(attackerOrigin).port}/widget/sample/1?ticket=synthetic#token=synthetic`;
  await page.evaluate(url=>{const frame=document.createElement('iframe');frame.title='Generated widget';frame.sandbox.add('allow-scripts');frame.src=url;document.body.append(frame);},widget);
  await expect.poll(()=>page.frames().find(frame=>frame.url()===widget)?.locator('body').textContent()).toBe('Generated widget shell');
  const previousLoads=externalLoads;await child.evaluate(url=>{const anchor=document.createElement('a');anchor.href=url;anchor.target='_self';document.body.append(anchor);anchor.click();},`${attackerOrigin}/unapproved`);
  await expect.poll(()=>page.locator('[role="alert"]').textContent()).toContain('Reload');
  expect(externalLoads).toBe(previousLoads);
  // A deliberate parent-driven fresh frame must remain usable after denial.
  await page.getByRole('button',{name:'Reload plug-in'}).click();
  await expect.poll(()=>page.frames().filter(frame=>frame.url().includes('/plugins/sample-plugin/frame')).length).toBe(1);
  await expect.poll(()=>page.frames().find(frame=>frame.url().includes('/plugins/sample-plugin/frame'))?.locator('#result').textContent()).toBe('owner-only');
 }finally{await page.close();}
});

it('never gives a replacement document the bridge, pending results or a successful flush, even with the old session',async()=>{
 const page=await browser.newPage();try{
  await page.goto(`${origin}/__custody-unrestricted`);await page.locator('body[data-ready="true"]').waitFor();
  const child=page.frames().find(frame=>frame.url().includes('/plugins/sample-plugin/frame'))!;await child.locator('#result').waitFor();
  await child.evaluate(()=>{const client=(window as unknown as {client:{pluginRequest:(operation:string,input:unknown)=>Promise<unknown>;registerEditorHandoff:(id:string,guard:()=>Promise<void>)=>void}}).client;client.registerEditorHandoff('unsaved',()=>new Promise(()=>{}));void client.pluginRequest('state.read',{key:'slow'}).catch(()=>{});});
  await expect.poll(()=>slow.has('slow')).toBe(true);await page.locator('#flush').click();await expect.poll(()=>page.locator('#saved').textContent()).toBe('pending');
  const session=new URL(child.url()).searchParams.get('session')!;
  const flush=await page.evaluate(()=>String((window as unknown as {__lastFlush?:string}).__lastFlush??''))||await child.evaluate(()=>String((window as unknown as {__lastFlush?:string}).__lastFlush??''));expect(flush).not.toBe('');
  await child.evaluate(url=>{location.href=url;},`${attackerOrigin}/replacement?session=${encodeURIComponent(session)}&flush=${encodeURIComponent(flush)}`);
  await expect.poll(()=>page.frames().some(frame=>frame.url().includes('/replacement?'))).toBe(true);
  slow.get('slow')?.({private:'late-private-result'});slow.delete('slow');
  await expect.poll(()=>page.locator('#saved').textContent()).toBe('blocked');
  expect(operations).not.toContain('attacker');
  const replacement=page.frames().find(frame=>frame.url().includes('/replacement?'))!;
  expect(await replacement.evaluate(()=>JSON.stringify((window as unknown as {received:unknown[]}).received))).toBe('[]');
  // A known session also cannot reconnect or issue global RPC after replacement.
  await replacement.evaluate(session=>parent.postMessage({type:'gen.plugin.request',pluginId:'sample-plugin',session,id:'old-session',operation:'state.read',input:{key:'attacker'}},'*'),session);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__globalRequests:string[]}).__globalRequests)).toContain('old-session');
  expect(operations).not.toContain('attacker');
 }finally{await page.close();}
});

it('revokes an unexpected same-URL reload and recovers only through a fresh parent remount',async()=>{
 const page=await browser.newPage();try{
  await page.goto(`${origin}/__custody-unrestricted?scoped`);await page.locator('body[data-ready="true"]').waitFor();
  const child=page.frames().find(frame=>frame.url().includes('/plugins/sample-plugin/frame'))!,old=child.url();
  expect(new URL(old).searchParams.get('scopeId')).toBe('project-a');expect(new URL(old).searchParams.get('resourceId')).toBe('order-a');
  await child.evaluate(()=>location.reload());await expect.poll(()=>page.locator('[role="alert"]').textContent()).toContain('Reload');
  await page.getByRole('button',{name:'Reload plug-in'}).click();
  await expect.poll(()=>page.frames().find(frame=>frame.url().includes('/plugins/sample-plugin/frame'))?.url()).not.toBe(old);
  await expect.poll(()=>page.frames().find(frame=>frame.url().includes('/plugins/sample-plugin/frame'))?.locator('#result').textContent()).toBe('owner-only');
  await page.locator('#flush').click();await expect.poll(()=>page.locator('#saved').textContent()).toBe('saved');
 }finally{await page.close();}
});

it('rejects a redirected replacement before the initial trusted bootstrap can connect',async()=>{
 const page=await browser.newPage();const previousLoads=externalLoads;
 try{
  await page.route('**/plugins/sample-plugin/frame?*',route=>route.fulfill({status:302,headers:{location:`${attackerOrigin}/before-bootstrap?session=${new URL(route.request().url()).searchParams.get('session')}`}}));
  await page.goto(`${origin}/${documentName}`);
  await expect.poll(()=>page.locator('[role="alert"]').textContent()).toContain('Reload');
  expect(externalLoads).toBe(previousLoads);expect(operations).not.toContain('attacker');
 }finally{await page.close();}
});
