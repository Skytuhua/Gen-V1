import {afterEach,describe,expect,it} from 'vitest';
import {link,mkdtemp,rm,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {observeContext7Executable} from '../packages/integrations/context7-secret-reference.ts';
import {captureContext7Binding,withContext7Binding,type Context7LaunchDescriptor} from '../packages/integrations/context7-execution.ts';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const dir=async()=>{const root=await mkdtemp(join(tmpdir(),'harness-context7-errors-'));roots.push(root);return root;};
const file=async(root:string,name:string,body='bytes')=>{const path=join(root,name);await writeFile(path,body);return path;};

describe('context7 launch error contract',()=>{
 it('maps filesystem failures to SECRET_REF_UNAVAILABLE instead of raw ENOENT',async()=>{
  const root=await dir();
  await expect(observeContext7Executable('relative/tool.exe')).rejects.toMatchObject({code:'SECRET_REF_UNAVAILABLE'});
  await expect(observeContext7Executable(join(root,'missing.exe'))).rejects.toMatchObject({code:'SECRET_REF_UNAVAILABLE'});
  await expect(observeContext7Executable(root)).rejects.toMatchObject({code:'SECRET_REF_UNAVAILABLE'});
  await expect(observeContext7Executable(await file(root,'empty.exe',''))).rejects.toMatchObject({code:'SECRET_REF_UNAVAILABLE'});
  const linked=await file(root,'tool.exe','v1');await link(linked,join(root,'alias.exe'));
  await expect(observeContext7Executable(linked)).rejects.toMatchObject({code:'SECRET_REF_UNAVAILABLE'});
 });
 it('maps a missing launch cwd to PRECONDITION_FAILED',async()=>{
  const root=await dir();
  const launch:Context7LaunchDescriptor={executable:await file(root,'node.exe'),entry:await file(root,'entry.js'),manifest:await file(root,'manifest.json'),packageManifest:await file(root,'package.json'),cwd:join(root,'gone'),args:[]};
  await expect(captureContext7Binding(launch)).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
  await expect(captureContext7Binding({...launch,cwd:await file(root,'not-a-dir')})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
 });
 it('reports PRECONDITION_FAILED when an approved file changes before dispatch',async()=>{
  const root=await dir();
  const launch:Context7LaunchDescriptor={executable:await file(root,'node.exe'),entry:await file(root,'entry.js'),manifest:await file(root,'manifest.json'),packageManifest:await file(root,'package.json'),cwd:root,args:[]};
  const approved=await captureContext7Binding(launch);
  await utimes(launch.entry,new Date(),new Date(Date.now()+5000));
  await expect(withContext7Binding(launch,approved,new AbortController().signal,async()=>'never')).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
  const vanished:Context7LaunchDescriptor={executable:await file(root,'b-node.exe'),entry:await file(root,'b-entry.js'),manifest:await file(root,'b-manifest.json'),packageManifest:await file(root,'b-package.json'),cwd:root,args:[]};
  const vanishedApproved=await captureContext7Binding(vanished);
  await rm(vanished.entry);
  await expect(withContext7Binding(vanished,vanishedApproved,new AbortController().signal,async()=>'never')).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 },120000);
});
