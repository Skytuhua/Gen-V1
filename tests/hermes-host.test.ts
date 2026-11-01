import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {launchHost,type RunningHost} from '../apps/server/host.ts';
import type {RuntimeAdapter,Snapshot} from '../packages/contracts/index.ts';
import type {SkillDetail,SkillSummary} from '../packages/contracts/skills.ts';
import {Store} from '../packages/storage/store.ts';
import {applySkillOperations} from '../packages/core/skills.ts';
async function freePort(){const server=createServer();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();if(!address||typeof address==='string')throw Error('No test port');await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));return address.port;}
const catalog=():RuntimeAdapter=>({configure:()=>{},models:async()=>[],start:async()=>{throw Error('No inference in host CRUD verification');},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}});
it('serves original source CRUD, approval-aware UI saves, archive/restore/history and restart through the default host',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'hermes-default-host-')),port=await freePort();let widgetPort=await freePort();while(widgetPort===port)widgetPort=await freePort();
 const options={dataDir,port,widgetPort,dev:true};let host:RunningHost|undefined,cookie='',csrf='';
 const legacy=new Store(dataDir);legacy.internal('fixture.legacy',null,()=>applySkillOperations(legacy,[{action:'create',name:'legacy-large',description:'A preserved legacy description that is longer than the original Hermes sixty character index permits.',content:'Preserve the complete legacy body and all supporting files.',baseRevision:0},...Array.from({length:20},(_,index)=>({action:'write_file' as const,name:'legacy-large',baseRevision:index+1,path:`references/${index}.md`,content:`Preserved legacy source ${index}.`}))],{kind:'user'}));legacy.close();
 const bootstrap=async()=>{const response=await fetch(host!.origin+'/api/bootstrap');cookie=response.headers.get('set-cookie')!.split(';')[0];csrf=(await response.json()).csrfToken;};
 const json=async(path:string,body?:unknown)=>{const response=await fetch(host!.origin+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:host!.origin,Cookie:cookie,'X-Harness-CSRF':csrf},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();expect(response.status,JSON.stringify(value)).toBe(200);return value;};
 const command=(type:string,payload:Record<string,unknown>)=>json('/api/commands',{id:crypto.randomUUID(),type,payload});
 const read=()=>json('/api/skills/http-source?includeInactive=true') as Promise<SkillDetail>;
 try{
  host=await launchHost(options,{createRuntime:catalog});
  await bootstrap();
  const preserved=await json('/api/skills/legacy-large?includeInactive=true') as SkillDetail;expect(preserved.skill.migrationError).toBeTruthy();expect(preserved.content).toContain('complete legacy body');expect(preserved.files).toHaveLength(20);
  await command('skill.manage',{operations:[{action:'create',name:'http-source',description:'Verify source-backed host behavior.',content:'Inspect the actual source and preserve verification receipts.',baseRevision:0}]});
  let detail=await read();const initial=detail.skill.revision;expect(detail.document).toContain('name: http-source');
  await command('settings.update',{preferences:{learningApproval:true}});
  const saved=await command('skill.manage',{operations:[{action:'write_file',name:'http-source',path:'references/check.md',content:'A retained supporting source.',baseRevision:detail.skill.revision}]});expect(saved.result.status).toBe('applied');
  detail=await read();expect(detail.files).toContain('references/check.md');
  await command('skill.manage',{operations:[{action:'patch',name:'http-source',content:'Inspect source and run the focused host checks.',baseRevision:detail.skill.revision}]});
  detail=await read();await command('skill.manage',{operations:[{action:'delete',name:'http-source',baseRevision:detail.skill.revision}]});detail=await read();expect(detail.skill.state).toBe('archived');
  await command('skill.manage',{operations:[{action:'restore',name:'http-source',baseRevision:detail.skill.revision}]});detail=await read();
  await command('skill.manage',{operations:[{action:'rollback',name:'http-source',revision:initial,baseRevision:detail.skill.revision}]});
  detail=await read();expect(detail.content).toBe('Inspect the actual source and preserve verification receipts.');expect(detail.files).toEqual([]);expect(detail.versions.length).toBeGreaterThan(1);
  await host.close();host=await launchHost(options,{createRuntime:catalog});await bootstrap();detail=await read();expect(detail.content).toContain('preserve verification receipts');
  const snapshot=await json('/api/snapshot') as Snapshot;expect(snapshot.skills?.find((skill:SkillSummary)=>skill.name==='http-source')?.revision).toBe(detail.skill.revision);expect(JSON.stringify(snapshot.skills)).not.toContain(detail.content);expect(snapshot.skillProposals).toEqual([]);
 }finally{await host?.close();await rm(dataDir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
},90000);
