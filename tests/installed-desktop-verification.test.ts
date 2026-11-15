import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rename,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nsisApplicationGuid,assertClearInstallPreflight,assertOwnedInstallEntries,installedCommandArguments,packageContentManifest,assertMatchingContents,parseOwnedUninstaller,assertInstalledCleanExit,assertZipDestinationFits,type InstallPreflight} from '../scripts/verify-installed-desktop.ts';
import * as installedVerification from '../scripts/verify-installed-desktop.ts';
import {Store} from '../packages/storage/store.ts';
import {ProjectMemory} from '../packages/core/project-memory.ts';
import {registeredCapabilityFlags} from '../packages/core/capability-flags.ts';

const directory='C:\\verification\\exclusive\\installed';
const clear=():InstallPreflight=>({entries:[],runningAppPids:[],shortcuts:[],updaterCache:{path:'C:\\fixture\\generative-harness-desktop-updater',present:false}});
describe('installed desktop verification custody',()=>{
 it('rejects a destination that exceeds the pinned ZIP extractor Windows path limit',()=>{
  const file='resources\\host\\node_modules\\'+'x'.repeat(139);
  expect(()=>assertZipDestinationFits('C:\\Users\\user\\AppData\\Local\\Programs\\generative-harness-desktop',[file])).not.toThrow();
  expect(()=>assertZipDestinationFits('C:\\'+ 'x'.repeat(130),[file])).toThrow(/path|260/i);
 });
 it('requires an observed clean process exit before accepting an installed launch',()=>{
  expect(()=>assertInstalledCleanExit({exitCode:0,signalCode:null})).not.toThrow();
  for(const state of [{exitCode:1,signalCode:null},{exitCode:null,signalCode:'SIGTERM'},{exitCode:null,signalCode:null}])expect(()=>assertInstalledCleanExit(state)).toThrow(/exit/i);
 });
 it('derives the same fixed NSIS identity as the pinned builder',()=>{
  expect(nsisApplicationGuid('local.generativeharness.desktop')).toBe('f973205b-ac9b-56c0-baad-730abd2ca4b3');
 });
 it('refuses existing registry state, native processes, shortcuts and updater caches',()=>{
  expect(()=>assertClearInstallPreflight(clear())).not.toThrow();
  for(const value of [
   {...clear(),entries:[{hive:'HKCU',view:64,kind:'install',values:{InstallLocation:directory}}]},
   {...clear(),runningAppPids:[123]},
   {...clear(),shortcuts:[{path:'C:\\fixture\\Gen V1.lnk',present:true}]},
   {...clear(),updaterCache:{path:'C:\\fixture\\cache',present:true}}
  ] as InstallPreflight[])expect(()=>assertClearInstallPreflight(value)).toThrow(/existing|running/i);
 });
 it('keeps NSIS directory-tail arguments literal and rejects command-line syntax in paths',()=>{
  expect(installedCommandArguments('install',directory)).toEqual(['/S','/D='+directory]);
  expect(installedCommandArguments('uninstall',directory)).toEqual(['/S','/KEEP_APP_DATA','/currentuser','_?='+directory]);
  for(const path of ['relative/path','C:\\a"b','C:\\a\nb','C:\\a\0b'])expect(()=>installedCommandArguments('install',path)).toThrow();
 });
 it('accepts only a quoted exact owned uninstaller and known per-user flag',()=>{
  expect(parseOwnedUninstaller('"'+directory+'\\Uninstall Gen V1.exe" /currentuser',directory)).toBe(directory+'\\Uninstall Gen V1.exe');
  for(const command of [
   '"C:\\other\\Uninstall Gen V1.exe" /currentuser',
   '"'+directory+'\\Uninstall Gen V1.exe" /allusers',
   '"'+directory+'\\Uninstall Gen V1.exe" /delete-app-data',
   directory+'\\Uninstall Gen V1.exe /currentuser',
   '"'+directory+'\\other.exe"'
  ])expect(()=>parseOwnedUninstaller(command,directory)).toThrow(/owned|uninstall/i);
 });
 it('requires matching per-user installation and uninstall entries before cleanup',()=>{
  const entries=[{hive:'HKCU',view:64,kind:'install',values:{InstallLocation:directory}},{hive:'HKCU',view:64,kind:'uninstall',values:{UninstallString:'"'+directory+'\\Uninstall Gen V1.exe" /currentuser',DisplayVersion:'0.4.0'}}] as const;
  expect(assertOwnedInstallEntries([...entries],directory,'0.4.0')).toBe(directory+'\\Uninstall Gen V1.exe');
  expect(()=>assertOwnedInstallEntries([entries[0]],directory,'0.4.0')).toThrow();
  expect(()=>assertOwnedInstallEntries([...entries,{...entries[0],hive:'HKLM'}],directory,'0.4.0')).toThrow();
  expect(()=>assertOwnedInstallEntries([...entries],directory,'0.5.0')).toThrow();
 });
 it('compares all installed payload files while allowing only the fixed added uninstaller',async()=>{
  const fixture=await mkdtemp(join(tmpdir(),'harness-installed-manifest-'));
  try{
   const source=join(fixture,'source'),installed=join(fixture,'installed');
   for(const path of [source,installed]){await mkdir(path);await mkdir(join(path,'resources'));await writeFile(join(path,'Gen V1.exe'),'app');await writeFile(join(path,'resources','chunk.js'),'lazy');}
   await writeFile(join(installed,'Uninstall Gen V1.exe'),'uninstaller');
   const expected=await packageContentManifest(source);
   const actual=await packageContentManifest(installed,{installed:true});assertMatchingContents(expected,actual);
   await writeFile(join(installed,'resources','chunk.js'),'changed');
   const changed=await packageContentManifest(installed,{installed:true});expect(()=>assertMatchingContents(expected,changed)).toThrow(/differ/i);
   await writeFile(join(installed,'resources','chunk.js'),'lazy');await writeFile(join(installed,'unexpected.exe'),'extra');
   const extra=await packageContentManifest(installed,{installed:true});expect(()=>assertMatchingContents(expected,extra)).toThrow(/differ/i);
  }finally{await rm(fixture,{recursive:true,force:true});}
 });
});

describe('installed project memory retention fixture',()=>{
 it('requires an explicit retention option and rejects unknown or duplicated options',()=>{
  expect(installedVerification.readInstalledVerificationArguments(['setup','unpacked'])).toEqual({setup:'setup',unpacked:'unpacked',memoryRetention:false});
  expect(installedVerification.readInstalledVerificationArguments(['setup','unpacked','--project-memory-retention'])).toEqual({setup:'setup',unpacked:'unpacked',memoryRetention:true});
  for(const args of [[],['setup'],['setup','unpacked','--enable-memory'],['setup','unpacked','--project-memory-retention','--project-memory-retention']])expect(()=>installedVerification.readInstalledVerificationArguments(args)).toThrow(/usage|pass|option/i);
 });
 it('seeds source-linked records in place and reopens them with the production default-off policy and no model owner',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'installed-memory-retention-'))),flags=registeredCapabilityFlags();
  try{
   const {seedInstalledMemoryProfile,INSTALLED_MEMORY_CASE}=await import('../scripts/installed-memory-retention.ts');
   const seed=await seedInstalledMemoryProfile(root);
   expect(seed.profile.path).toBe(await realpath(join(root,'host')));
   const store=new Store(seed.profile.path);
   try{
    const memory=new ProjectMemory(store),access=await memory.access(seed.projectId,seed.threadId),view=memory.read(access);
    expect(view).toMatchObject({available:false,enabled:false,sourceThreadIds:[seed.threadId]});
    expect(access).toMatchObject({profileId:seed.profileId,projectIdentity:seed.projectIdentity,accountId:null});
    expect(store.get('thread',seed.threadId)).toMatchObject({modelId:null,accountId:null,runId:null,status:'completed'});
    expect(view.items).toHaveLength(4);
    expect(view.items.find(row=>row.item.id===seed.items.edit.id)?.item).toMatchObject({state:'ACCEPTED',revision:2,text:INSTALLED_MEMORY_CASE.initialText});
    expect(view.items.find(row=>row.item.id===seed.items.reject.id)?.item.state).toBe('PROPOSED');
    expect(view.items.find(row=>row.item.id===seed.items.accept.id)?.item.state).toBe('PROPOSED');
    expect(memory.source(access,seed.items.edit.id,2,seed.items.edit.source.digest,seed.items.edit.source).content).toBe(INSTALLED_MEMORY_CASE.sourceText);
    expect(store.get<{content:string}>('message',seed.items.edit.source.sourceId)?.content).toBe(INSTALLED_MEMORY_CASE.changedSourceText);
    expect(memory.accepted(access)).toEqual([]);
    expect(memory.export(access).items.find(item=>item.id===seed.items.forget.id)?.text).toBe('[redacted]');
    expect(store.snapshot().accounts??[]).toEqual([]);
    expect(store.snapshot().usage).toEqual({});
    for(const kind of ['outbox','modelRequest','projectMemoryAuxiliaryUsage','projectMemoryRequestUsage','projectMemoryExtraction'])expect(store.all(kind)).toEqual([]);
   }finally{store.close();}
   expect(registeredCapabilityFlags()).toEqual(flags);
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('refuses an existing host profile without changing its contents',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'installed-memory-existing-')));
  try{
   const {seedInstalledMemoryProfile}=await import('../scripts/installed-memory-retention.ts');
   await mkdir(join(root,'host'));await writeFile(join(root,'host','existing.txt'),'Keep this profile');
   await expect(seedInstalledMemoryProfile(root)).rejects.toThrow(/exist|exclusive|profile/i);
   expect(await readFile(join(root,'host','existing.txt'),'utf8')).toBe('Keep this profile');
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('refuses a redirected evidence root before creating a backend profile',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'installed-memory-redirect-')));
  try{
   const {seedInstalledMemoryProfile}=await import('../scripts/installed-memory-retention.ts');
   await mkdir(join(root,'target'));await symlink(join(root,'target'),join(root,'alias'),'junction');
   await expect(seedInstalledMemoryProfile(join(root,'alias'))).rejects.toThrow(/redirect|canonical|ordinary/i);
   await expect(readFile(join(root,'target','host','harness.sqlite'))).rejects.toMatchObject({code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('rejects a replaced backend directory before an installed launch can adopt it',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'installed-memory-replaced-')));
  try{
   const {seedInstalledMemoryProfile,assertInstalledMemoryProfile}=await import('../scripts/installed-memory-retention.ts');
   const seed=await seedInstalledMemoryProfile(root);
   await assertInstalledMemoryProfile(seed);
   await rename(seed.profile.path,join(root,'original-host'));await mkdir(seed.profile.path);
   await expect(assertInstalledMemoryProfile(seed)).rejects.toThrow(/identity changed/i);
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
