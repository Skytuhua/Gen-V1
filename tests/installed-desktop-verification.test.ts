import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nsisApplicationGuid,assertClearInstallPreflight,assertOwnedInstallEntries,installedCommandArguments,packageContentManifest,assertMatchingContents,parseOwnedUninstaller,assertInstalledCleanExit,assertZipDestinationFits,type InstallPreflight} from '../scripts/verify-installed-desktop.ts';

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
   {...clear(),shortcuts:[{path:'C:\\fixture\\Generative Harness.lnk',present:true}]},
   {...clear(),updaterCache:{path:'C:\\fixture\\cache',present:true}}
  ] as InstallPreflight[])expect(()=>assertClearInstallPreflight(value)).toThrow(/existing|running/i);
 });
 it('keeps NSIS directory-tail arguments literal and rejects command-line syntax in paths',()=>{
  expect(installedCommandArguments('install',directory)).toEqual(['/S','/D='+directory]);
  expect(installedCommandArguments('uninstall',directory)).toEqual(['/S','/KEEP_APP_DATA','/currentuser','_?='+directory]);
  for(const path of ['relative/path','C:\\a"b','C:\\a\nb','C:\\a\0b'])expect(()=>installedCommandArguments('install',path)).toThrow();
 });
 it('accepts only a quoted exact owned uninstaller and known per-user flag',()=>{
  expect(parseOwnedUninstaller('"'+directory+'\\Uninstall Generative Harness.exe" /currentuser',directory)).toBe(directory+'\\Uninstall Generative Harness.exe');
  for(const command of [
   '"C:\\other\\Uninstall Generative Harness.exe" /currentuser',
   '"'+directory+'\\Uninstall Generative Harness.exe" /allusers',
   '"'+directory+'\\Uninstall Generative Harness.exe" /delete-app-data',
   directory+'\\Uninstall Generative Harness.exe /currentuser',
   '"'+directory+'\\other.exe"'
  ])expect(()=>parseOwnedUninstaller(command,directory)).toThrow(/owned|uninstall/i);
 });
 it('requires matching per-user installation and uninstall entries before cleanup',()=>{
  const entries=[{hive:'HKCU',view:64,kind:'install',values:{InstallLocation:directory}},{hive:'HKCU',view:64,kind:'uninstall',values:{UninstallString:'"'+directory+'\\Uninstall Generative Harness.exe" /currentuser',DisplayVersion:'0.4.0'}}] as const;
  expect(assertOwnedInstallEntries([...entries],directory,'0.4.0')).toBe(directory+'\\Uninstall Generative Harness.exe');
  expect(()=>assertOwnedInstallEntries([entries[0]],directory,'0.4.0')).toThrow();
  expect(()=>assertOwnedInstallEntries([...entries,{...entries[0],hive:'HKLM'}],directory,'0.4.0')).toThrow();
  expect(()=>assertOwnedInstallEntries([...entries],directory,'0.5.0')).toThrow();
 });
 it('compares all installed payload files while allowing only the fixed added uninstaller',async()=>{
  const fixture=await mkdtemp(join(tmpdir(),'harness-installed-manifest-'));
  try{
   const source=join(fixture,'source'),installed=join(fixture,'installed');
   for(const path of [source,installed]){await mkdir(path);await mkdir(join(path,'resources'));await writeFile(join(path,'Generative Harness.exe'),'app');await writeFile(join(path,'resources','chunk.js'),'lazy');}
   await writeFile(join(installed,'Uninstall Generative Harness.exe'),'uninstaller');
   const expected=await packageContentManifest(source);
   const actual=await packageContentManifest(installed,{installed:true});assertMatchingContents(expected,actual);
   await writeFile(join(installed,'resources','chunk.js'),'changed');
   const changed=await packageContentManifest(installed,{installed:true});expect(()=>assertMatchingContents(expected,changed)).toThrow(/differ/i);
   await writeFile(join(installed,'resources','chunk.js'),'lazy');await writeFile(join(installed,'unexpected.exe'),'extra');
   const extra=await packageContentManifest(installed,{installed:true});expect(()=>assertMatchingContents(expected,extra)).toThrow(/differ/i);
  }finally{await rm(fixture,{recursive:true,force:true});}
 });
});
