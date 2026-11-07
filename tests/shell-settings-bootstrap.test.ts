import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,lstatSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Store} from '../packages/storage/store';
import {Service} from '../packages/core/service';
import {buildServer} from '../apps/server/server';
import type {RuntimeAdapter} from '../packages/contracts';

const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const base=realpathSync(tmpdir()),dir=mkdtempSync(join(base,'shell-settings-read-')),store=new Store(dir),runtime:RuntimeAdapter={configure(){},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 store.internal('fixture',null,()=>{store.put('settings','global',null,{theme:'light',modelId:'private-model-id',unrecognizedPrivateValue:'never-publish',preferences:{density:'compact',chatWidth:'wide',unrecognizedPrivateValue:'never-publish',keybindings:{unrecognizedPrivateValue:'never-publish'}}});store.put('message','synthetic-private-message','owner',{content:'Do not bootstrap transcript text. '.repeat(20000)});});
 const service=new Service(store,runtime),app=await buildServer(service,{port:4317,dev:false});cleanup.push(async()=>{await app.close();await service.dispose();store.close();if(realpathSync(dir)!==resolve(dir)||!dir.startsWith(base+sep)||lstatSync(dir).isSymbolicLink())throw Error('Unsafe fixture cleanup');rmSync(dir,{recursive:true,force:true,maxRetries:5});});
 const bootstrap=await app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:4317'}}),headers={host:'127.0.0.1:4317',cookie:String(bootstrap.headers['set-cookie']).split(';')[0]};return{store,app,headers};
}
it('loads safe shell presentation without reading a global snapshot or transcript',async()=>{
 const f=await fixture(),snapshot=vi.spyOn(f.store,'snapshot');const response=await f.app.inject({url:'/api/shell-settings',headers:f.headers});
 expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({theme:'light',preferences:{density:'compact',chatWidth:'wide'}});expect(Object.keys(response.json()).sort()).toEqual(['preferences','theme']);
 expect(response.body).not.toMatch(/Do not bootstrap|private-model-id|never-publish|synthetic-private-message/);expect(snapshot).not.toHaveBeenCalled();expect(response.headers['cache-control']).toBe('no-store');
 expect(f.store.get<{unrecognizedPrivateValue:string}>('settings','global')!.unrecognizedPrivateValue).toBe('never-publish');
});
it('keeps shell presentation behind the normal session and origin boundary',async()=>{
 const f=await fixture();expect((await f.app.inject({url:'/api/shell-settings',headers:{host:'127.0.0.1:4317'}})).statusCode).toBe(401);
 expect((await f.app.inject({url:'/api/shell-settings',headers:{...f.headers,origin:'https://untrusted.invalid'}})).statusCode).toBe(403);
});
