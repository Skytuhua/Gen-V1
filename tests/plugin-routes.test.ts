import {afterEach,describe,expect,it} from 'vitest';
import Fastify from 'fastify';
import {registerPluginRoutes} from '../apps/server/plugin-routes.ts';
import type {PluginRegistry} from '../packages/plugins/host.ts';
import {request as httpRequest} from 'node:http';

const apps:ReturnType<typeof Fastify>[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
function setup(){
  const app=Fastify();apps.push(app);
  const seen:string[]=[];
  const registry={list:()=>[{id:'sample-plugin',name:'Sample',version:'1.0.0',apiVersion:1,compatibleGenVersions:'^0.6.3',frontendEntry:'frontend/index.html',hostEntry:'host/main.mjs'}],
    validateSurface:async()=>false,
    readAsset:async(_id:string,path:string)=>{seen.push(path);return {bytes:Buffer.from('<html><head></head><body>Private UI</body></html>'),contentType:'text/html'};},
    dispatch:async(_id:string,operation:string)=>{seen.push(operation);if(operation!=='read')throw Error('private secret');return {available:false};},
  } as unknown as PluginRegistry;
  registerPluginRoutes(app,registry,'http://127.0.0.1:4317');return {app,seen};
}
describe('installed plugin routes',()=>{
  it.each(['Recovered owner notes','',42,false,null,['draft'],{draft:'saved'}])('round-trips a JSON recovery value without converting strings to plain text: %j',async value=>{
    const app=Fastify();apps.push(app);
    const registry={dispatch:async()=>value} as unknown as PluginRegistry;
    registerPluginRoutes(app,registry,'http://127.0.0.1:4317');
    const response=await app.inject({method:'POST',url:'/api/plugins/sample-plugin/rpc',payload:{operation:'state.read',input:{key:'company:owner-notes'}}});
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toEqual(value);
  });
  it('refuses protected frame bytes until the host validates the complete current surface',async()=>{
    const {app,seen}=setup();
    const denied=await app.inject('/plugins/sample-plugin/frame?scopeId=project&surfaceId=plan&resourceId=order');
    expect(denied.statusCode).toBe(403);expect(seen).toEqual([]);
    const incomplete=await app.inject('/plugins/sample-plugin/frame?scopeId=project');
    expect(incomplete.statusCode).toBe(400);expect(seen).toEqual([]);
  });
  it('revokes the operation signal when a client disconnects after sending its body',async()=>{
    const app=Fastify();apps.push(app);let started!:()=>void;const running=new Promise<void>(resolve=>{started=resolve;});let cancelled!:()=>void;const revoked=new Promise<void>(resolve=>{cancelled=resolve;});
    const registry={dispatch:async(_id:string,_operation:string,_input:unknown,signal:AbortSignal)=>{started();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{cancelled();resolve();},{once:true}));return null;}} as unknown as PluginRegistry;
    registerPluginRoutes(app,registry,'http://127.0.0.1:4317');const origin=await app.listen({port:0,host:'127.0.0.1'});
    const request=httpRequest(origin+'/api/plugins/sample-plugin/rpc',{method:'POST',headers:{'content-type':'application/json'}},response=>response.resume());request.on('error',()=>{});request.end(JSON.stringify({operation:'read',input:null}));await running;request.destroy();
    await Promise.race([revoked,new Promise<never>((_resolve,reject)=>setTimeout(()=>reject(Error('The operation signal remained live after disconnect.')),500))]);
  });
  it('keeps the frame opaque and prevents network, forms and nested frames',async()=>{
    const {app,seen}=setup();const response=await app.inject('/plugins/sample-plugin/frame');
    expect(response.statusCode).toBe(200);expect(response.headers['content-security-policy']).toContain('sandbox allow-scripts');
    expect(response.headers['content-security-policy']).toContain("connect-src 'none'");
    expect(response.headers['content-security-policy']).toContain("form-action 'none'");
    expect(response.body).toContain('gen-plugin-id');expect(response.body).toContain('/plugin-runtime/runtime.js');
    expect(seen).toEqual(['frontend/index.html']);
  });
  it('dispatches only plugin operations and sanitizes failures',async()=>{
    const {app,seen}=setup();const response=await app.inject({method:'POST',url:'/api/plugins/sample-plugin/rpc',payload:{operation:'read',input:null}});
    expect(response.json()).toEqual({available:false});
    const denied=await app.inject({method:'POST',url:'/api/plugins/sample-plugin/rpc',payload:{operation:'message.send',input:{}}});
    expect(denied.statusCode).toBe(503);expect(denied.body).not.toContain('private secret');expect(seen).toEqual(['read','message.send']);
    const invalid=await app.inject({method:'POST',url:'/api/plugins/sample-plugin/rpc',payload:{operation:'read',input:null,url:'/api/commands'}});
    expect(invalid.statusCode).toBe(400);
  });
  it('boots with no installed plugin and never serves host files',async()=>{
    const app=Fastify();apps.push(app);registerPluginRoutes(app,undefined,'http://127.0.0.1:4317');
    expect((await app.inject('/api/plugins')).json()).toEqual({plugins:[]});
    expect((await app.inject('/plugins/absent/frame')).statusCode).toBe(404);
    const {app:installed}=setup();expect((await installed.inject('/plugins/sample-plugin/host/main.mjs')).statusCode).toBe(404);
    expect((await installed.inject('/plugins/sample-plugin/index.html')).statusCode).toBe(404);
    expect((await installed.inject('/plugins/sample-plugin/logo.svg')).statusCode).toBe(404);
  });
});
