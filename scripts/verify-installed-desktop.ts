import {chromium,expect,type Browser} from '@playwright/test';
import {spawn,type ChildProcess} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,readdir,lstat,realpath,copyFile,unlink,rmdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,relative,isAbsolute,win32} from 'node:path';
import {pathToFileURL} from 'node:url';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';
import {SUBSCRIPTION_CONNECTIONS} from '../packages/contracts/connections.ts';
import {verificationPorts,assertWrapperArguments} from './portable-verification.ts';
import {verifyPackagedProviders} from './verify-packaged-providers.ts';

const APP_ID='local.generativeharness.desktop';
const APP_FILE='Gen V1.exe',UNINSTALL_FILE='Uninstall Gen V1.exe';
type RegistryEntry={hive:'HKCU'|'HKLM';view:32|64;kind:'install'|'uninstall';values:Record<string,string|undefined>};
export type InstallPreflight={entries:RegistryEntry[];runningAppPids:number[];shortcuts:{path:string;present:boolean}[];updaterCache:{path:string;present:boolean}};
type ContentManifest={files:{path:string;bytes:number;sha256:string}[];bytes:number;sha256:string};
type FileIdentity={dev:string;ino:string;sha256:string};
type OwnedCache={path:string;dev:string;ino:string;file:FileIdentity}|null;

export function nsisApplicationGuid(appId:string){
 const namespace=Buffer.from('50e065bc313411e69bab38c9862bdaf3','hex');
 const bytes=createHash('sha1').update(namespace).update(appId,'utf8').digest().subarray(0,16);
 bytes[6]=(bytes[6]!&15)|80;bytes[8]=(bytes[8]!&63)|128;
 const hex=bytes.toString('hex');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
export function assertClearInstallPreflight(value:InstallPreflight){
 if(value.entries.length)throw Error('An existing Harness installation registry key is present; verification will not upgrade or remove it.');
 if(value.runningAppPids.length)throw Error('A Harness native application is already running; verification will not close it.');
 if(value.shortcuts.some(shortcut=>shortcut.present))throw Error('An existing Harness shortcut is present; verification will not replace it.');
 if(value.updaterCache.present)throw Error('An existing Harness installer cache is present; verification will not overwrite it.');
}
export function assertInstalledCleanExit(state:{exitCode:number|null;signalCode:string|null}){
 if(state.exitCode!==0||state.signalCode!==null)throw Error('Installed application did not exit cleanly.');
}
export function assertZipDestinationFits(directory:string,paths:readonly string[]){
 let longest=directory.length;for(const path of paths)longest=Math.max(longest,win32.join(directory,path).length);
 if(longest>=260)throw Error('Installation destination exceeds the pinned ZIP extractor 260-character path limit.');
 return longest;
}
export function installedCommandArguments(kind:'install'|'uninstall',directory:string){
 if(!/^[A-Za-z]:\\/.test(directory)||/["\r\n\0]/.test(directory))throw Error('The owned install directory must be an ordinary absolute Windows path.');
 // NSIS parses these final directory switches from the raw command-line tail.
 return kind==='install'?['/S','/D='+directory]:['/S','/KEEP_APP_DATA','/currentuser','_?='+directory];
}
function sameWindowsPath(left:string,right:string){return win32.normalize(left).replace(/[\\/]+$/,'').toLowerCase()===win32.normalize(right).replace(/[\\/]+$/,'').toLowerCase();}
export function parseOwnedUninstaller(command:string,directory:string){
 const match=/^"([^"\r\n\0]+)"(?:\s+(\/currentuser))?\s*$/.exec(command);
 const expected=win32.join(directory,UNINSTALL_FILE);
 if(!match||!sameWindowsPath(match[1]!,expected))throw Error('Registry uninstall command does not identify the exact owned uninstaller.');
 return expected;
}
export function assertOwnedInstallEntries(entries:readonly RegistryEntry[],directory:string,version:string){
 let installation=false,uninstaller:string|undefined;
 for(const entry of entries){
  if(entry.hive!=='HKCU')throw Error('Installation unexpectedly changed machine-wide registry state; cleanup is withheld.');
  if(entry.kind==='install'){
   if(!entry.values.InstallLocation||!sameWindowsPath(entry.values.InstallLocation,directory))throw Error('Registry installation location is not the owned directory.');
   installation=true;
  }else{
   if(entry.values.DisplayVersion!==version)throw Error('Registry installed version differs from the expected package.');
   const path=parseOwnedUninstaller(entry.values.UninstallString??'',directory);
   if(uninstaller&&!sameWindowsPath(uninstaller,path))throw Error('Registry uninstaller identities disagree.');
   uninstaller=path;
  }
 }
 if(!installation||!uninstaller)throw Error('Owned install and uninstall entries are both required before cleanup.');
 return uninstaller;
}
async function hashFile(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function packageContentManifest(directory:string,options:{installed?:boolean}={}):Promise<ContentManifest>{
 const root=await realpath(directory),files:ContentManifest['files']=[];let bytes=0,entries=0;
 async function walk(path:string,depth:number){
  if(depth>64)throw Error('Installed payload exceeds its depth bound.');
  for(const entry of await readdir(path,{withFileTypes:true})){
   if(++entries>150000)throw Error('Installed payload exceeds its entry bound.');
   const child=join(path,entry.name),part=relative(root,child).replaceAll('\\','/'),info=await lstat(child);
   if(info.isSymbolicLink())throw Error('Installed payload contains a redirected entry.');
   if(info.isDirectory()){await walk(child,depth+1);continue;}
   if(!info.isFile())throw Error('Installed payload contains a non-file entry.');
   if(options.installed&&[UNINSTALL_FILE,'uninstallerIcon.ico'].includes(part))continue;
   bytes+=info.size;if(bytes>4*1024**3)throw Error('Installed payload exceeds its byte bound.');
   files.push({path:part,bytes:info.size,sha256:await hashFile(child)});
  }
 }
 await walk(root,0);files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return {files,bytes,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}
export function assertMatchingContents(expected:ContentManifest,actual:ContentManifest){
 if(expected.files.length!==actual.files.length||expected.bytes!==actual.bytes||expected.sha256!==actual.sha256)throw Error('Installed and expected unpacked payload contents differ.');
}
function baseEnvironment():NodeJS.ProcessEnv{
 const env:NodeJS.ProcessEnv={};
 for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','LANG','LC_ALL','TERM','TEMP','TMP','USERPROFILE','HOME','LOCALAPPDATA','APPDATA'])if(process.env[key]!==undefined)env[key]=process.env[key];
 return env;
}
async function runOwned(file:string,args:string[],options:{cwd:string;env:NodeJS.ProcessEnv;timeoutMs:number;rawTail?:boolean}){
 const started=Date.now(),child=spawn(file,args,{cwd:options.cwd,env:options.env,windowsHide:true,windowsVerbatimArguments:options.rawTail,stdio:['ignore','pipe','pipe']});
 const output=await new Promise<{exitCode:number;stdout:string;stderr:string}>((accept,reject)=>{
  let stdout='',stderr='',bytes=0,failed=false;
  const fail=(error:Error)=>{if(failed)return;failed=true;clearTimeout(timer);void terminateProcessTree(child).then(()=>reject(error),reject);};
  const timer=setTimeout(()=>fail(Error('Owned installer verification process exceeded its deadline.')),options.timeoutMs);
  child.once('error',fail);
  for(const stream of [child.stdout,child.stderr])stream.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>256*1024){fail(Error('Owned verification process exceeded its output bound.'));return;}if(stream===child.stdout)stdout+=String(chunk);else stderr=(stderr+String(chunk)).slice(-16000);});
  child.once('close',code=>{clearTimeout(timer);if(failed)return;failed=true;code===0?accept({exitCode:code,stdout,stderr}):reject(Error('Owned verification process exited '+code+'. '+stderr));});
 });
 return {...output,elapsedMs:Date.now()-started};
}
const REGISTRY_PROBE=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$guid=$env:HARNESS_VERIFY_NSIS_GUID
if($guid -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'){throw 'Invalid fixed installer identity'}
$entries=@()
foreach($hiveName in @('HKCU','HKLM')){
 $hive=if($hiveName -eq 'HKCU'){[Microsoft.Win32.RegistryHive]::CurrentUser}else{[Microsoft.Win32.RegistryHive]::LocalMachine}
 foreach($viewNumber in @(64,32)){
  $view=if($viewNumber -eq 64){[Microsoft.Win32.RegistryView]::Registry64}else{[Microsoft.Win32.RegistryView]::Registry32}
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
  try{
   foreach($kind in @('install','uninstall')){
    $path=if($kind -eq 'install'){'Software\'+$guid}else{'Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid}
    $key=$base.OpenSubKey($path,$false)
    if($null -ne $key){
     try{$values=@{};foreach($name in @('InstallLocation','UninstallString','DisplayVersion')){$value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);if($null -ne $value){$values[$name]=[string]$value}}
      $entries+=@{hive=$hiveName;view=$viewNumber;kind=$kind;values=$values}
     }finally{$key.Dispose()}
    }
   }
  }finally{$base.Dispose()}
 }
}
function Exists-Literally([string]$path){try{$null=[System.IO.File]::GetAttributes($path);return $true}catch{$errorType=$_.Exception.GetBaseException();if($errorType -is [System.IO.FileNotFoundException] -or $errorType -is [System.IO.DirectoryNotFoundException]){return $false};throw}}
$shortcuts=@();foreach($folderName in @('DesktopDirectory','CommonDesktopDirectory','Programs','CommonPrograms')){$folder=[Environment]::GetFolderPath([Enum]::Parse([Environment+SpecialFolder],$folderName));if([string]::IsNullOrWhiteSpace($folder)){throw 'Windows shortcut folder is unavailable'};foreach($name in @('Gen V1.lnk','Generative Harness.lnk')){$path=[IO.Path]::Combine($folder,$name);$shortcuts+=@{path=$path;present=(Exists-Literally $path)}}}
$cache=[IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData),'generative-harness-desktop-updater')
$pids=@(foreach($name in @('Gen V1','Generative Harness')){[Diagnostics.Process]::GetProcessesByName($name)|ForEach-Object{$_.Id; $_.Dispose()}})
@{entries=@($entries);runningAppPids=@($pids);shortcuts=@($shortcuts);updaterCache=@{path=$cache;present=(Exists-Literally $cache)}}|ConvertTo-Json -Depth 6 -Compress
`;
async function installPreflight(directory:string):Promise<InstallPreflight>{
 const systemRoot=process.env.SystemRoot??process.env.SYSTEMROOT;
 if(!systemRoot||!win32.isAbsolute(systemRoot))throw Error('Windows system directory is unavailable.');
 const output=await runOwned(join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(REGISTRY_PROBE,'utf16le').toString('base64')],{cwd:directory,env:{...baseEnvironment(),HARNESS_VERIFY_NSIS_GUID:nsisApplicationGuid(APP_ID)},timeoutMs:15000});
 const result=JSON.parse(output.stdout.trim()) as InstallPreflight;
 if(!Array.isArray(result.entries)||result.entries.length>8||!Array.isArray(result.runningAppPids)||!Array.isArray(result.shortcuts)||typeof result.updaterCache?.path!=='string'||typeof result.updaterCache.present!=='boolean')throw Error('Windows installation preflight returned an invalid shape.');
 return result;
}
async function identity(path:string):Promise<FileIdentity>{const stat=await lstat(path,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n)throw Error('Owned executable is not a single ordinary file.');return {dev:String(stat.dev),ino:String(stat.ino),sha256:await hashFile(path)};}
function sameIdentity(left:FileIdentity,right:FileIdentity){return left.dev===right.dev&&left.ino===right.ino&&left.sha256===right.sha256;}
async function captureOwnedCache(path:string,setupSha256:string):Promise<OwnedCache>{
 let info;try{info=await lstat(path,{bigint:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 if(!info.isDirectory()||info.isSymbolicLink()||!sameWindowsPath(await realpath(path),path))throw Error('Installer cache is redirected; cleanup is withheld.');
 const children=await readdir(path);if(children.length!==1||children[0]!=='installer.exe')throw Error('Installer cache contains unexpected files; cleanup is withheld.');
 const file=await identity(join(path,'installer.exe'));if(file.sha256!==setupSha256)throw Error('Cached installer differs from the invoked setup; cleanup is withheld.');
 return {path,dev:String(info.dev),ino:String(info.ino),file};
}
async function cleanOwnedCache(cache:OwnedCache){
 if(!cache)return {status:'not-created'};
 const info=await lstat(cache.path,{bigint:true});if(!info.isDirectory()||info.isSymbolicLink()||String(info.dev)!==cache.dev||String(info.ino)!==cache.ino)throw Error('Installer cache directory identity changed; it is retained.');
 if((await readdir(cache.path)).join('\0')!=='installer.exe'||!sameIdentity(await identity(join(cache.path,'installer.exe')),cache.file))throw Error('Installer cache content changed; it is retained.');
 await unlink(join(cache.path,'installer.exe'));await rmdir(cache.path);return {status:'removed-owned-exact-file',sha256:cache.file.sha256};
}
async function waitForOwnedExit(child:ChildProcess,timeoutMs=15000){
 if(child.exitCode!==null||child.signalCode!==null)return;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([new Promise<void>(done=>child.once('close',()=>done())),new Promise<never>((_done,reject)=>{timer=setTimeout(()=>reject(Error('Installed application did not exit after closing its last window.')),timeoutMs);})]);}finally{clearTimeout(timer);}
}
async function launchInstalled(executable:string,directory:string,iteration:number,receipt:Record<string,unknown>,ports:readonly[number,number,number],company=false){
 const [hostPort,widgetPort,debugPort]=ports,nonce=randomUUID(),origin='http://127.0.0.1:'+hostPort,debugOrigin='http://127.0.0.1:'+debugPort;
 const child=spawn(executable,[...(company?['--company']:[]),'--remote-debugging-port='+debugPort,'--remote-debugging-address=127.0.0.1','--enable-automation','--harness-verification='+nonce],{cwd:win32.dirname(executable),env:{...baseEnvironment(),HARNESS_DESKTOP_TEST_DATA_DIR:directory,HARNESS_DESKTOP_PORT:String(hostPort),HARNESS_COMPANY_PORT:String(hostPort),HARNESS_DESKTOP_WIDGET_PORT:String(widgetPort)},windowsHide:false,stdio:'ignore'});
 let browser:Browser|undefined,verifiedOwner=false,launchError:Error|undefined;const started=Date.now();child.once('error',error=>{launchError=error;});
 try{
  await expect.poll(async()=>{if(launchError)throw launchError;if(child.exitCode!==null||child.signalCode!==null)throw Error('Installed application exited before readiness.');try{return (await fetch(debugOrigin+'/json/version',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:45000,intervals:[100,250,500]}).toBe(true);
  browser=await chromium.connectOverCDP(debugOrigin);const session=await browser.newBrowserCDPSession();
  try{const {arguments:args}=await session.send('Browser.getBrowserCommandLine');assertWrapperArguments(args,nonce);if(!sameWindowsPath(args[0]??'',executable))throw Error('Debug browser is not the exact installed executable.');verifiedOwner=true;}finally{await session.detach();}
  await expect.poll(()=>browser!.contexts().flatMap(context=>context.pages()).some(page=>page.url().startsWith(origin+'/')),{timeout:30000}).toBe(true);
  const page=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith(origin+'/'))!;
  const message=page.getByRole('textbox',{name:company?'Owner notes':'Message',exact:true});await expect(message).toBeEnabled({timeout:30000});const readyMs=Date.now()-started;
  expect(await page.evaluate(async()=>({surface:(await window.harnessDesktop!.getContext()).surface.kind,node:typeof (window as unknown as {process?:unknown}).process}))).toEqual({surface:'main',node:'undefined'});
  if(company){
   expect(new URL(page.url()).pathname).toBe('/company/communications');
   expect(await page.evaluate(()=>window.harnessDesktop!.signIn('openai').then(()=>false,()=>true))).toBe(true);
   await page.getByRole('button',{name:'Communications',exact:true}).click();
   await expect(page.getByRole('region',{name:'Communication workspace',exact:true})).toBeVisible();
   const source=page.getByLabel('Communication data source',{exact:true}),fixedUrl=page.url();
   if(iteration===2){
    await expect(message).toHaveValue('Keep this installed company note.');
    await expect(source).toHaveValue('fixture');
    await expect(page.getByText('Synthetic fixture · no live employees',{exact:true})).toBeVisible();
    await source.selectOption('company');
   }
   const task=page.getByRole('region',{name:'Owner task',exact:true}),project=task.getByRole('textbox',{name:'Project ID',exact:true}),instruction=task.getByRole('textbox',{name:'Task outcome',exact:true});
   await expect(instruction).toBeEnabled();
   if(iteration===1){
    await message.fill('Keep this installed company note.');
    await project.fill('qa-project');await instruction.fill('Keep this installed task draft. Do not submit it.');
   }else{await expect(project).toHaveValue('qa-project');await expect(instruction).toHaveValue('Keep this installed task draft. Do not submit it.');}
   await expect(task.getByRole('button',{name:'Request plan',exact:true})).toBeDisabled();
   await expect(task.getByRole('button',{name:'Authorize task unavailable',exact:true})).toBeDisabled();
   await source.selectOption('fixture');
   await expect(source).toHaveValue('fixture');
   await expect(page.getByText('Synthetic fixture · no live employees',{exact:true})).toBeVisible();
   expect(page.url()).toBe(fixedUrl);
   await page.screenshot({path:join(directory,'installed-company-'+iteration+'.png')});
  }else if(iteration===1){
   await message.fill('Keep this installed-app draft.');
   await expect.poll(()=>page.evaluate(()=>new Promise<unknown>((accept,reject)=>{const opened=indexedDB.open('generative-harness-journal',1);opened.onerror=()=>reject(opened.error);opened.onsuccess=()=>{const db=opened.result,read=db.transaction('entries').objectStore('entries').get('draft:new');read.onsuccess=()=>{accept(read.result?.value);db.close();};read.onerror=()=>{reject(read.error);db.close();};};}))).toBe('Keep this installed-app draft.');
   await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Providers',exact:true}).click();
   for(const connection of SUBSCRIPTION_CONNECTIONS.filter(item=>item.status==='available'))await expect(page.locator(`.connection-row[data-provider="${connection.id}"]`).getByRole('button',{name:`Connect ${connection.label}`,exact:true})).toBeEnabled();
   await page.screenshot({path:join(directory,'installed-settings.png')});await page.locator('.connection-row[data-provider="gemini-cli"]').scrollIntoViewIfNeeded();await page.screenshot({path:join(directory,'installed-official-connections.png')});
   await page.getByRole('button',{name:'Close settings',exact:true}).click();await page.screenshot({path:join(directory,'installed-main.png')});
  }else await expect(message).toHaveValue('Keep this installed-app draft.');
  expect((await fetch(origin+(company?'/api/bootstrap':'/health'),{signal:AbortSignal.timeout(1000)})).ok).toBe(true);
  await page.evaluate(()=>window.close()).catch(error=>{if(!page.isClosed())throw error;});await waitForOwnedExit(child);assertInstalledCleanExit(child);
  await expect.poll(async()=>{try{return (await fetch(origin+(company?'/api/bootstrap':'/health'),{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:15000}).toBe(false);
  const result={iteration,mode:company?'company':'personal',readyMs,verifiedOwner,ports:{hostPort,widgetPort,debugPort},exitCode:child.exitCode,executable,passed:true,...(company?{companyData:'explicit synthetic fixture; no live task',recovered:iteration===2?['owner notes','source selection','unsent project and task draft']:[]}: {})};
  (receipt.launches as unknown[]).push(result);return result;
 }finally{
  if(verifiedOwner)await browser?.close().catch(()=>{});
  if(child.exitCode===null&&child.signalCode===null)await terminateProcessTree(child);
 }
}

export async function verifyInstalledDesktop(setupPath:string,expectedUnpackedPath:string){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('This verification requires Windows x64.');
 if(!isAbsolute(setupPath)||!isAbsolute(expectedUnpackedPath))throw Error('Pass absolute installer and expected unpacked-directory paths.');
 const setup=await realpath(setupPath),expectedUnpacked=await realpath(expectedUnpackedPath),setupIdentity=await identity(setup);
 const directory=resolve('.harness-desktop-installed','run-'+Date.now()+'-'+randomUUID());await mkdir(directory,{recursive:true});
 const ownedDirectory=await realpath(directory),workspace=await realpath(resolve('.')),part=relative(workspace,ownedDirectory);
 if(part==='..'||part.startsWith('..\\')||isAbsolute(part))throw Error('Verification output was redirected outside the workspace.');
 // A nested evidence UUID path exceeds legacy nsisunz limits for Gemini assets.
 // Keep the exclusive application sibling short; evidence remains in its own directory.
 const installDirectory=join(workspace,'.harness-app-'+randomUUID().replaceAll('-','').slice(0,12)),version=(JSON.parse(await readFile(join(expectedUnpacked,'resources/host/package.json'),'utf8')) as {version:string}).version;
 const receipt:Record<string,unknown>={createdAt:new Date().toISOString(),setup,setupSha256:setupIdentity.sha256,expectedUnpacked,installDirectory,nsisGuid:nsisApplicationGuid(APP_ID),version,scope:'Owned temporary per-user installation, exact payload/provider custody, two personal and two company installed executable launches with local recovery, and identity-bound uninstall. Company fixture presentation is synthetic, not live task acceptance. No sign-in, credentials, inference or user-profile adoption.',inference:false,auth:false,launches:[],passed:false};
 let installedUninstaller:{path:string;identity:FileIdentity}|undefined,ownedCache:OwnedCache|undefined,installationInvoked=false,mainError:unknown;
 try{
  const before=await installPreflight(ownedDirectory);assertClearInstallPreflight(before);receipt.preflight=before;
  try{await lstat(installDirectory);throw Error('Exclusive install destination already exists.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const expected=await packageContentManifest(expectedUnpacked);receipt.expectedPayload={files:expected.files.length,bytes:expected.bytes,sha256:expected.sha256,maxInstalledPathLength:assertZipDestinationFits(installDirectory,expected.files.map(file=>file.path))};
  // Repeat the read-only preflight immediately before installation; never upgrade an existing user installation.
  assertClearInstallPreflight(await installPreflight(ownedDirectory));
  if(!sameIdentity(await identity(setup),setupIdentity))throw Error('Installer changed since verification began.');
  await writeFile(join(ownedDirectory,'owner.json'),JSON.stringify({setup,setupSha256:setupIdentity.sha256,installDirectory,guid:nsisApplicationGuid(APP_ID)},null,2),{flag:'wx'});
  installationInvoked=true;receipt.installCommand=await runOwned(setup,installedCommandArguments('install',installDirectory),{cwd:ownedDirectory,env:baseEnvironment(),timeoutMs:600000,rawTail:true});
  if(!sameWindowsPath(await realpath(installDirectory),installDirectory))throw Error('Installer did not create the exact ordinary owned directory.');
  const after=await installPreflight(ownedDirectory),uninstaller=assertOwnedInstallEntries(after.entries,installDirectory,version);
  installedUninstaller={path:uninstaller,identity:await identity(uninstaller)};receipt.installedRegistry=after.entries;
  if(after.runningAppPids.length)throw Error('Installer unexpectedly started the native application.');
  ownedCache=await captureOwnedCache(after.updaterCache.path,setupIdentity.sha256);
  const actual=await packageContentManifest(installDirectory,{installed:true});assertMatchingContents(expected,actual);receipt.payloadCustody={matches:true,files:actual.files.length,bytes:actual.bytes,sha256:actual.sha256};
  const providers=await verifyPackagedProviders(installDirectory);receipt.providerVerification={passed:providers.receipt.passed,receipt:join(providers.directory,'verification.json')};
  // Native journals are origin-scoped: restart must use the same application ports.
  // A new nonce still proves ownership of each launched process independently.
  const executable=join(installDirectory,APP_FILE),ports=await verificationPorts();await launchInstalled(executable,ownedDirectory,1,receipt,ports);await launchInstalled(executable,ownedDirectory,2,receipt,ports);
  await launchInstalled(executable,ownedDirectory,1,receipt,ports,true);await launchInstalled(executable,ownedDirectory,2,receipt,ports,true);
 }catch(error){mainError=error;receipt.error=error instanceof Error?error.message:'Installed verification failed.';}
 finally{
  if(installedUninstaller){
   try{
    const current=await installPreflight(ownedDirectory);if(current.runningAppPids.length)throw Error('A Harness application remains running; uninstall is withheld.');
    const path=assertOwnedInstallEntries(current.entries,installDirectory,version);if(!sameWindowsPath(path,installedUninstaller.path)||!sameIdentity(await identity(path),installedUninstaller.identity))throw Error('Owned uninstaller identity changed; uninstall is withheld.');
    const cleanupExecutable=join(ownedDirectory,'owned-uninstaller.exe');await copyFile(path,cleanupExecutable);if((await identity(cleanupExecutable)).sha256!==installedUninstaller.identity.sha256)throw Error('Uninstaller copy differs; cleanup is withheld.');
    const result=await runOwned(cleanupExecutable,installedCommandArguments('uninstall',installDirectory),{cwd:ownedDirectory,env:baseEnvironment(),timeoutMs:180000,rawTail:true});
    await expect.poll(async()=>{const state=await installPreflight(ownedDirectory);let exists=true;try{await lstat(installDirectory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')exists=false;else throw error;}return !state.entries.length&&!exists;},{timeout:120000,intervals:[250,500,1000]}).toBe(true);
    const cache=ownedCache===undefined?{status:'not-confirmed-owned-retained'}:await cleanOwnedCache(ownedCache);
    assertClearInstallPreflight(await installPreflight(ownedDirectory));
    receipt.cleanup={status:'uninstalled-owned-installation',command:result,cache,shortcuts:'absent',installationKeys:'absent',nativeProcesses:'absent'};
   }catch(error){receipt.cleanup={status:'preserved-for-inspection',error:error instanceof Error?error.message:'Owned cleanup failed.'};mainError??=error;}
  }else receipt.cleanup={status:installationInvoked?'preserved-unconfirmed-installation':'not-installed'};
  receipt.passed=!mainError&&installedUninstaller!==undefined&&(receipt.cleanup as {status:string}).status==='uninstalled-owned-installation';
  await writeFile(join(ownedDirectory,'verification.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({directory:ownedDirectory,passed:receipt.passed}));
 }
 if(mainError)throw mainError;return {directory:ownedDirectory,receipt};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const [setup,unpacked]=process.argv.slice(2);if(!setup||!unpacked)throw Error('Pass absolute Setup.exe and expected win-unpacked directory paths.');
 await verifyInstalledDesktop(setup,unpacked);
}
