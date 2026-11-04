import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {IntegrationManager} from '../packages/integrations/index.ts';
import type {IntegrationPreferences,IntegrationScope} from '../packages/contracts/integrations.ts';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function setup(){
 const dataRoot=await mkdtemp(join(tmpdir(),'harness-integrations-'));roots.push(dataRoot);
 let preferences:IntegrationPreferences={};const disabled:string[]=[];
 const manager=new IntegrationManager({root:resolve('.'),dataRoot,nodeExecutable:process.execPath,
  getPreferences:()=>preferences,setPreference:async(id,preference)=>{preferences={...preferences,[id]:preference};},
  authorize:async(scope)=>{if(scope.authority.kind!=='local')throw Error('Company authority denied');return {profileId:'test',projectRoot:resolve('.')};},
  onDisable:async id=>{disabled.push(id);},hostComplete:async()=>{throw Error('No inference during integration verification');}});
 return {manager,disabled};
}
const local:IntegrationScope={authority:{kind:'local'},projectId:'test',modelId:'selected',accountId:'account'};
it('admits exactly the ten bundled integrations without starting their MCP services',async()=>{
 const {manager}=await setup();try{
  const statuses=await manager.inventory(local);expect(statuses).toHaveLength(10);
  expect(statuses.every(item=>item.installed&&item.enabled&&item.state==='ready')).toBe(true);
  expect(statuses.find(item=>item.id==='humanizer')?.capabilities.mcp).toBe(false);
  expect(statuses.find(item=>item.id==='context7')?.capabilities.mcp).toBe(true);
 }finally{await manager.dispose();}
});
it('rejects company scope before dispatch and preserves explicit disable across future calls',async()=>{
 const {manager,disabled}=await setup();try{
  await expect(manager.listTools('context7',{authority:{kind:'company',companyId:'foreign'}})).rejects.toThrow('Company authority denied');
  await manager.disable('context7',local);expect(disabled).toEqual(['context7']);
  expect((await manager.status('context7',local)).state).toBe('disabled');
  await expect(manager.listTools('context7',local)).rejects.toThrow(/disabled/i);
  expect((await manager.workerConfig(local)).enabled).not.toContain('context7');
 }finally{await manager.dispose();}
});
it('only persists public Ponytail modes and never configuration secrets',async()=>{
 const {manager}=await setup();try{
  await manager.configure('ponytail',{mode:'lite'},local);
  expect((await manager.workerConfig(local)).ponytailMode).toBe('lite');
  await expect(manager.configure('ponytail',{apiKey:'private'} as never,local)).rejects.toThrow(/configuration/i);
  await expect(manager.configure('humanizer',{mode:'full'},local)).rejects.toThrow(/Ponytail/i);
 }finally{await manager.dispose();}
});
it('records original upstream payload hashes and keeps the later Impeccable hook separately pinned',async()=>{
 const manifest=JSON.parse(await readFile('third-party/integrations/manifest.json','utf8'));
 expect(manifest.integrations).toHaveLength(10);
 const impeccable=manifest.integrations.find((item:{id:string})=>item.id==='impeccable');
 expect(impeccable.upstream.pin).toBe('414603bf14c7a344edb466bb1f85690c77ce8b7d');
 expect(impeccable.additionalSources[0].pin).toBe('e89e3ada3e875a89ac2c5d33d11e65ebef6fe285');
 expect(impeccable.files.some((file:{path:string;sha256:string})=>file.path.endsWith('.exe')&&file.sha256==='8f61e96b0c97001546a824d79b44f46b423b560f3eb1a0cc44a8695a1b395d9f')).toBe(true);
});
