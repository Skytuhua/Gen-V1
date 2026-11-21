import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {args,hash,json,main,output,pnpm,required,windows} from './common.ts';
import {compare,snapshot} from './profile-manifest.ts';
import {flagsOff} from './flags-off.ts';
import {installedSession} from './installed-session.ts';
import {restoreProfile} from './profile-archive.ts';
import {installedCommandArguments,verifyInstalledDesktop} from '../verify-installed-desktop.ts';
import {terminateProcessTree} from '../../packages/runtime-pi/process-tree.ts';

const phases=['build','clean','native','flags','dpapi','physical','upgrade','failed-setup'];
export function assertCleanLifecycle(receipt:{passed?:boolean;setupSha256?:string;memoryRetentionRequested?:boolean;cleanup?:{status?:string}},sha256:string,continueAfterFailure=false){if(receipt.setupSha256!==sha256||!receipt.memoryRetentionRequested||receipt.cleanup?.status!=='uninstalled-owned-installation')throw Error('Need a candidate-bound clean lifecycle receipt with completed owned uninstall.');if(!receipt.passed&&!continueAfterFailure)throw Error('Clean lifecycle failed; explicit --continue-after-clean-failure is required to continue a dry run.');}
export function parseInterruptDelay(value:string){const milliseconds=Number(value);if(!Number.isInteger(milliseconds)||milliseconds<1||milliseconds>2_147_483_647)throw Error('Invalid --interrupt-ms.');return milliseconds;}
main(import.meta.url,async()=>{
 windows();const {options}=args(),phase=required(options,'phase'),out=output(options);if(!phases.includes(phase))throw Error('Phases: '+phases.join(', '));await mkdir(out,{recursive:true});
 const capture=async(argv:string[],name:string)=>{try{const log=await pnpm(argv,true);await writeFile(join(out,name+'.log'),log+'\n');return log;}catch(error){await writeFile(join(out,name+'.log'),((error as {stdout?:string}).stdout??'')+'\n'+String(error)+'\n');throw error;}};
 const script=async(name:string,argv:string[])=>{console.log(await capture(['exec','tsx','scripts/rc-review/'+name+'.ts',...argv],name));};
 if(phase==='build'){await script('build-candidate',['--commit',required(options,'commit'),'--label',required(options,'label'),'--out',out,...(options.worktree?['--worktree',options.worktree]:[])]);return;}
 const receiptPath=resolve(options.build??join(out,'rc-build.json')),build=JSON.parse(await readFile(receiptPath,'utf8'));if(await hash(build.setup.path)!==build.setup.sha256||await hash(build.buildManifest.path)!==build.buildManifest.sha256)throw Error('Candidate custody mismatch.');
 const install=resolve(options.install??join(out,'installed')),exe=join(install,'Gen V1.exe'),profile=join(process.env.APPDATA!,'GenerativeHarnessDesktop'),host=join(process.env.LOCALAPPDATA!,'GenerativeHarness');
 const authorize=()=>{if(options['allow-install']!=='disposable-vm')throw Error('Installation requires --allow-install disposable-vm. Back up profiles; setup may not be atomic.');};
 const setup=async(path:string,interruptMs?:number)=>{authorize();await new Promise<void>((accept,reject)=>{const child=spawn(path,installedCommandArguments('install',install),{windowsVerbatimArguments:true,stdio:'ignore'});let interrupted=false;const timer=interruptMs===undefined?undefined:setTimeout(()=>{interrupted=true;void terminateProcessTree(child).catch(reject);},interruptMs);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);if(interruptMs!==undefined&&!interrupted)reject(Error('Setup completed before interruption; failed-setup scenario NOT exercised.'));else if(interruptMs===undefined&&code!==0)reject(Error('Setup exited '+code));else accept();});});};
 const installedVersion=async()=>JSON.parse(await readFile(join(install,'resources/host/package.json'),'utf8')).version as string;
 const collect=async(log:string,name:string)=>{await writeFile(join(out,name+'.log'),log);const last=log.trim().split(/\r?\n/).at(-1)!;const receipt=JSON.parse(last);await copyFile(join(receipt.directory,'verification.json'),join(out,name+'.json'));await json(join(out,name+'-source.json'),{directory:receipt.directory});if(!receipt.passed)throw Error(name+' did not pass.');};
 if(phase==='clean'){authorize();const root=resolve('.harness-desktop-installed'),previous:string[]=await readdir(root).catch(error=>{if(error.code==='ENOENT')return [];throw error;});let failure:unknown;try{await verifyInstalledDesktop(build.setup.path,build.unpacked,{memoryRetention:true});}catch(error){failure=error;}const created=(await readdir(root)).filter(name=>!previous.includes(name));if(created.length!==1)throw Error('Cannot identify exclusive clean lifecycle evidence.');const directory=join(root,created[0]),receipt=JSON.parse(await readFile(join(directory,'verification.json'),'utf8'));if(receipt.setupSha256!==build.setup.sha256)throw Error('Clean receipt candidate mismatch.');await copyFile(join(directory,'verification.json'),join(out,'clean.json'));const provider=receipt.providerVerification as {receipt:string}|undefined;if(provider)await copyFile(provider.receipt,join(out,'packaged-providers.json'));await json(join(out,'clean-source.json'),{directory,providerReceipt:provider?.receipt});if(failure)throw failure;}
 if(phase==='native'){
  assertCleanLifecycle(JSON.parse(await readFile(join(out,'clean.json'),'utf8')),build.setup.sha256,options['continue-after-clean-failure']==='true');
  if((await readdir(install).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).length)throw Error('Native phase requires an empty exclusive install directory.');await setup(build.setup.path);await json(join(out,'native-install-owner.json'),{install,setupSha256:build.setup.sha256});try{await collect(await capture(['exec','tsx','scripts/verify-desktop.ts',exe],'native'),'native');}catch(error){const log=(error as {stdout?:string}).stdout;if(log)await collect(log,'native');throw error;}
 }
 if(phase==='flags')await flagsOff(install,out);
 if(phase==='dpapi')await capture(['exec','vitest','run','tests/host-effect-authenticator-v3.test.ts','tests/protected-effect-host-v3.test.mjs','--maxWorkers=1'],'dpapi');
 if(phase==='physical')await capture(['exec','tsx','scripts/verify-physical-displays.ts',exe,join(out,'physical')],'physical');
 if(phase==='upgrade'){
  authorize();assertCleanLifecycle(JSON.parse(await readFile(join(out,'clean.json'),'utf8')),build.setup.sha256,options['continue-after-clean-failure']==='true');
  for(const path of [install,profile,host])if((await readdir(path).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).length)throw Error('Upgrade starts with empty default profiles and install directory. Uninstall owned native run and manually relocate its profiles first.');
  const baseline=resolve(options.baseline??'C:/gen-rc/baseline/v0.6.1'),oldSetup=join(baseline,'Gen-V1-Setup-0.6.1-win-x64.exe'),lines=(await readFile(join(baseline,'SHA256SUMS.txt'),'utf8')).split(/\r?\n/),line=lines.find(value=>/\s\*?Gen-V1-Setup-0\.6\.1-win-x64\.exe$/.test(value));if(!line||await hash(oldSetup)!==line.split(/\s+/)[0])throw Error('Baseline SHA-256 mismatch.');await json(join(out,'baseline-custody.json'),{path:oldSetup,sha256:await hash(oldSetup)});await setup(oldSetup);
  if(options['profile-archive'])await restoreProfile(resolve(options['profile-archive']),profile,host,out,install);else await script('seed-v061-profile',['--v061-worktree',required(options,'v061-worktree'),'--exe',exe,'--out',out]);
  const before=await snapshot(profile,host,install);await json(join(out,'before.json'),before);await setup(build.setup.path);const after=await snapshot(profile,host,install);await json(join(out,'after.json'),after);const difference=compare(before,after);await json(join(out,'profile-compare.json'),difference);
  await script('upgrade-check',['--seed',join(out,'seed.json'),'--exe',exe,'--out',out]);if(!difference.passed)throw Error('Upgrade has profile losses/changes requiring review; see profile-compare.json.');
 }
 if(phase==='failed-setup'){
  authorize();if(await installedVersion()!=='0.6.1')throw Error('Restore a separate VM checkpoint with installed and seeded 0.6.1 before interrupted setup.');const milliseconds=parseInterruptDelay(required(options,'interrupt-ms'));let passed=false,error:string|undefined;
  try{await setup(build.setup.path,milliseconds);if(await installedVersion()!=='0.6.1')throw Error('Interrupted setup did not retain 0.6.1. No rollback is promised.');await installedSession(exe,async page=>{await page.screenshot({path:join(out,'failed-setup-v061-launch.png')});});passed=true;}catch(cause){error=String(cause);}await json(join(out,'failed-setup.json'),{passed,error,interruptMs:milliseconds,scope:'One interrupted setup timing only; not proof of atomic installation or rollback.'});if(!passed)throw Error(error);
 }
 await json(join(out,phase+'-phase.json'),{phase,passed:true,timestamp:new Date().toISOString(),candidate:build.commit,receiptPath});console.log('Completed phase: '+phase);
});
