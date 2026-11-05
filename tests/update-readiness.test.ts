import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import type {RuntimeAdapter} from '../packages/contracts';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
function setup(){const dir=mkdtempSync(join(tmpdir(),'gen-update-idle-')),store=new Store(dir);const runtime:RuntimeAdapter={configure:()=>{},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};const service=new Service(store,runtime);cleanup.push(async()=>{await service.dispose();store.close();rmSync(dir,{recursive:true,force:true});});return {service,store};}
it('blocks updates for unresolved native operations and durable input',()=>{
 const {service,store}=setup();expect(service.isUpdateIdle()).toBe(true);
 store.internal('fixture',null,()=>store.put('operation','operation',null,{id:'operation',status:'unknown'}));expect(service.isUpdateIdle()).toBe(false);
 store.internal('fixture',null,()=>{store.put('operation','operation',null,{id:'operation',status:'succeeded'});store.put('outbox','input',null,{id:'input',status:'persisted'});});expect(service.isUpdateIdle()).toBe(false);
});
it('closes admission before reporting update readiness',async()=>{
 const {service}=setup();expect(service.freezeForUpdate()).toBe(true);
 await expect(service.command({id:'late-create',type:'thread.create',payload:{}})).rejects.toThrow(/closing/i);
});
