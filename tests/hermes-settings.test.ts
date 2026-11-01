import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {hermesSettings} from '../packages/runtime-hermes/settings.ts';
import type {StartRun} from '../packages/contracts/index.ts';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){const path=await mkdtemp(join(tmpdir(),'hermes-settings-')),store=new Store(path);cleanup.push(async()=>{store.close();await rm(path,{recursive:true,force:true,maxRetries:5});});return store;}
it('uses original cadence config and original skill schemas while retaining only host-owned capabilities',async()=>{
 const store=await fixture();store.internal('fixture',null,()=>{store.put('skill','disabled',null,{name:'disabled',enabled:false,state:'active',protected:false});store.put('skill','protected',null,{name:'protected',enabled:true,state:'active',protected:true});});
 const settings=await hermesSettings(store);expect(settings.config).toMatchObject({skills:{creation_nudge_interval:10,write_approval:false,disabled:['disabled']}});expect(settings.skillPolicy).toMatchObject({enabled:true,allowWrites:true,disabledNames:['disabled'],protectedNames:['protected']});
 const names=settings.hostTools!.map(tool=>tool.name);expect(names).toContain('task_finish');expect(names).toContain('harness_session_search');expect(names).not.toContain('session_search');expect(names).not.toContain('skill_manage');expect(names).not.toContain('bash');
});
it('disables source automatic learning and writes in Plan without removing skill reading',async()=>{
 const store=await fixture();store.internal('fixture',null,()=>store.put('thread','plan','plan',{id:'plan',mode:'plan'}));
 const settings=await hermesSettings(store,{threadId:'plan'} as StartRun);expect(settings.config).toMatchObject({skills:{creation_nudge_interval:0}});expect(settings.skillPolicy).toMatchObject({enabled:true,allowWrites:false});
});
