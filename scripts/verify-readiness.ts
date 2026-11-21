// WO-F01 readiness baseline runner. Executes the exact package scripts as child
// processes (shell:false, explicit cwd, bounded timeout) and writes one JSON
// manifest keyed by repository SHA, platform, command, timestamps, exitCode,
// errorKind and artifact path. Never reports PASS for an unavailable integration,
// and never reports an aggregate PASS while a required suite is skipped or unrun.
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {finished} from 'node:stream/promises';
import {createWriteStream,existsSync,mkdirSync,readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolvePackageManager,type PackageManagerResolution} from './research-baseline.ts';

export type ReadinessStatus='PASS'|'FAIL'|'SKIP'|'BLOCKED';

export interface CheckSpec{
  id:string;command:string;args:string[];cwd:string;timeoutMs:number;
  required:boolean;logPath:string;env?:Record<string,string>;
}
export interface CheckResult{
  id:string;command:string;args:string[];cwd:string;required:boolean;
  startedAt:string;endedAt:string;durationMs:number;
  exitCode:number|null;signal:string|null;
  status:ReadinessStatus;errorKind:string|null;artifact:string;note?:string;
}
export interface Manifest{
  schemaVersion:1;repositorySha:string;platform:string;runId:string;
  startedAt:string;endedAt:string;aggregate:'PASS'|'FAIL';
  checks:Array<CheckResult&{repositorySha:string;platform:string}>;
}

// Only these variables reach child processes; tokens and ambient secrets never do.
const ENV_ALLOWLIST=['PATH','HOME','TMPDIR','TEMP','TMP','LANG','LC_ALL','USER','LOGNAME',
  'PLAYWRIGHT_BROWSERS_PATH','SystemRoot','windir','ProgramFiles','ProgramFiles(x86)',
  'LOCALAPPDATA','APPDATA','PATHEXT','COMSPEC'];
export function childEnvironment(extra:Record<string,string>={}):NodeJS.ProcessEnv{
  const env:NodeJS.ProcessEnv={};
  for(const key of ENV_ALLOWLIST){const value=process.env[key];if(value!==undefined)env[key]=value;}
  return {...env,...extra};
}

const SECRET_PATTERNS:Array<[RegExp,string]>=[
  [/(bearer\s+)[A-Za-z0-9._\-\/+=]+/gi,'$1[REDACTED]'],
  [/((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|password|passwd|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,'$1[REDACTED]'],
  [/((?:postgres|postgresql|mysql|mongodb|redis|amqp|https?):\/\/[^:\s\/]+:)[^@\s]+@/gi,'$1[REDACTED]@'],
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]'],
];
export function redactSecrets(text:string):string{
  let redacted=text;
  for(const [pattern,replacement] of SECRET_PATTERNS)redacted=redacted.replace(pattern,replacement);
  return redacted;
}

// Keep partial lines from different pipes separate before redaction.
function redactedLogSink(stream:ReturnType<typeof createWriteStream>){
  const carry={stdout:'',stderr:''};
  return {
    write(source:keyof typeof carry,chunk:string){
      const lines=(carry[source]+chunk).split('\n');carry[source]=lines.pop()!;
      for(const line of lines)stream.write(redactSecrets(line)+'\n');
    },
    end(){
      const tails=Object.values(carry).filter(Boolean).map(redactSecrets);
      if(tails.length)stream.write(tails.join('\n'));
      stream.end();
    },
  };
}

function killProcessTree(child:ChildProcess){
  const pid=child.pid;
  if(pid===undefined)return;
  if(process.platform==='win32'){
    spawn('taskkill',['/pid',String(pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'}).once('error',()=>{});
    return;
  }
  // Children spawned by pnpm/vitest share the detached process group.
  try{process.kill(-pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{/* already gone */}}
}

export async function runCheck(spec:CheckSpec):Promise<CheckResult>{
  const startedAtMs=Date.now();
  const base={id:spec.id,command:spec.command,args:spec.args,cwd:spec.cwd,required:spec.required,
    startedAt:new Date(startedAtMs).toISOString(),artifact:spec.logPath};
  const finish=(partial:{status:ReadinessStatus;errorKind:string|null;exitCode?:number|null;signal?:string|null}):CheckResult=>{
    const endedAtMs=Date.now();
    return {...base,endedAt:new Date(endedAtMs).toISOString(),durationMs:endedAtMs-startedAtMs,
      exitCode:partial.exitCode??null,signal:partial.signal??null,status:partial.status,errorKind:partial.errorKind};
  };
  let cwdIsDirectory=false;
  try{cwdIsDirectory=statSync(spec.cwd).isDirectory();}catch{/* missing cwd */}
  if(!cwdIsDirectory)return finish({status:'FAIL',errorKind:'bad-cwd'});
  try{mkdirSync(dirname(spec.logPath),{recursive:true});}catch{return finish({status:'FAIL',errorKind:'log-error'});}
  const logStream=createWriteStream(spec.logPath);
  try{await once(logStream,'open');}catch{return finish({status:'FAIL',errorKind:'log-error'});}
  const sink=redactedLogSink(logStream);
  let child:ChildProcess;
  try{
    child=spawn(spec.command,spec.args,{shell:false,cwd:spec.cwd,env:childEnvironment(spec.env),
      stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
  }catch{
    // Argument validation can throw before a child exists or emits 'error'.
    const drained=finished(logStream,{cleanup:true});
    sink.end();
    try{await drained;}catch{return finish({status:'FAIL',errorKind:'log-error'});}
    return finish({status:'FAIL',errorKind:'spawn-error'});
  }
  return await new Promise<CheckResult>(resolvePromise=>{
    let settled=false,timedOut=false;
    let killTimer:ReturnType<typeof setTimeout>|undefined;
    const settle=(partial:{status:ReadinessStatus;errorKind:string|null;exitCode?:number|null;signal?:string|null})=>{
      if(settled)return;settled=true;
      clearTimeout(timeoutTimer);if(killTimer!==undefined)clearTimeout(killTimer);
      logStream.once('finish',()=>resolvePromise(finish(partial)));
      sink.end();
    };
    const timeoutTimer=setTimeout(()=>{
      timedOut=true;killProcessTree(child);
      // Bounded even if the child ignores the kill: never hang the baseline.
      killTimer=setTimeout(()=>settle({status:'FAIL',errorKind:'timeout'}),5_000);
    },spec.timeoutMs);
    logStream.once('error',()=>{
      if(!settled){settled=true;clearTimeout(timeoutTimer);if(killTimer!==undefined)clearTimeout(killTimer);killProcessTree(child);}
      resolvePromise(finish({status:'FAIL',errorKind:'log-error'}));
    });
    // Decode each byte stream incrementally before merging and redacting lines.
    child.stdout?.setEncoding('utf8').on('data',chunk=>{if(!settled)sink.write('stdout',chunk);});
    child.stderr?.setEncoding('utf8').on('data',chunk=>{if(!settled)sink.write('stderr',chunk);});
    child.once('error',(error:NodeJS.ErrnoException)=>{
      settle(error.code==='ENOENT'
        ?{status:'BLOCKED',errorKind:'missing-binary'}
        :{status:'FAIL',errorKind:'spawn-error'});
    });
    child.once('close',(code,signal)=>{
      if(timedOut)settle({status:'FAIL',errorKind:'timeout',exitCode:code,signal});
      else if(code===0)settle({status:'PASS',errorKind:null,exitCode:code,signal});
      else if(code!==null)settle({status:'FAIL',errorKind:'nonzero-exit',exitCode:code,signal});
      else settle({status:'FAIL',errorKind:'signal',exitCode:null,signal});
    });
  });
}

export function blockedResult(spec:CheckSpec,errorKind:string,note?:string):CheckResult{
  const now=new Date().toISOString();
  return {id:spec.id,command:spec.command,args:spec.args,cwd:spec.cwd,required:spec.required,
    startedAt:now,endedAt:now,durationMs:0,exitCode:null,signal:null,
    status:'BLOCKED',errorKind,artifact:spec.logPath,...(note!==undefined?{note}:{})};
}

export function aggregateStatus(results:CheckResult[]): 'PASS'|'FAIL'{
  const required=results.filter(result=>result.required);
  return required.length>0&&required.every(result=>result.status==='PASS')?'PASS':'FAIL';
}

export function buildManifest(input:{repositorySha:string;platform:string;runId:string;startedAt:string;endedAt:string;results:CheckResult[]}):Manifest{
  return {schemaVersion:1,repositorySha:input.repositorySha,platform:input.platform,runId:input.runId,
    startedAt:input.startedAt,endedAt:input.endedAt,aggregate:aggregateStatus(input.results),
    checks:input.results.map(result=>({...result,repositorySha:input.repositorySha,platform:input.platform}))};
}

export function detectBrowserPrerequisite(resolveExecutable:()=>string,exists:(path:string)=>boolean):
  {ok:boolean;executable:string|null;errorKind:string|null}{
  let executable:string|null=null;
  try{executable=resolveExecutable();}catch{return {ok:false,executable:null,errorKind:'missing-browser-prerequisite'};}
  if(!executable||!exists(executable))return {ok:false,executable,errorKind:'missing-browser-prerequisite'};
  return {ok:true,executable,errorKind:null};
}

// Packaged Windows verification: package the installer, then verify the installed
// application. Both steps require Windows x64 (scripts/package-desktop.ts and
// scripts/verify-installed-desktop.ts refuse other platforms).
export function windowsVerificationPlan(platform:string,version:string,outputRoot:string,architecture:string):
  {blocked:boolean;errorKind:string|null;commands:Array<{command:string;args:string[]}>}{
  const release=join(outputRoot,`desktop-release-${version}`);
  const commands=[
    {command:'pnpm',args:['desktop:package','--output-root',outputRoot]},
    {command:'pnpm',args:['exec','tsx','scripts/verify-installed-desktop.ts',
      join(release,`Gen-V1-Setup-${version}-win-x64.exe`),join(release,'win-unpacked')]},
  ];
  return platform==='win32'&&architecture==='x64'
    ?{blocked:false,errorKind:null,commands}
    :{blocked:true,errorKind:'platform-unavailable',commands};
}

/** Use a real binary or pnpm's JS entry; shell:false cannot run a .cmd shim. */
export function readinessPackageChecks(root:string):(spec:CheckSpec)=>Promise<CheckResult>{
  let manager:PackageManagerResolution;
  try{manager=resolvePackageManager(root);}
  catch{return async spec=>blockedResult(spec,'missing-binary','Could not resolve a runnable pnpm executable or JavaScript entry.');}
  return spec=>runCheck({...spec,command:manager.file,args:[...manager.prefix,...spec.args]});
}

async function main(){
  const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
  const startedAt=new Date().toISOString();
  const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',shell:false,windowsHide:true});
  const repositorySha=git.status===0?git.stdout.trim():'unknown';
  const platform=`${process.platform}-${process.arch}`;
  const runId=`run-${Date.now()}-${randomUUID()}`;
  const artifactRoot=resolve(root,'test-results','readiness',runId);
  mkdirSync(artifactRoot,{recursive:true});
  const version=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version as string;
  const spec=(id:string,args:string[],timeoutMs:number):CheckSpec=>({
    id,command:'pnpm',args,cwd:root,timeoutMs,required:true,
    logPath:resolve(artifactRoot,`${id.replaceAll(':','-')}.log`)});
  const results:CheckResult[]=[];
  const runPackageCheck=readinessPackageChecks(root);
  const run=async(check:CheckSpec)=>{
    console.log(`RUN ${check.id}: ${check.command} ${check.args.join(' ')}`);
    const result=await runPackageCheck(check);
    console.log(`${result.status} ${check.id} exit=${result.exitCode??'-'} ${result.errorKind??''} (${result.durationMs}ms)`);
    results.push(result);
    return result;
  };

  await run(spec('typecheck',['typecheck'],600_000));
  await run(spec('test',['test'],3_600_000));
  await run(spec('build',['build'],900_000));

  const browserSpec=spec('test:browser',['test:browser'],3_600_000);
  let resolveExecutable:()=>string=()=>{throw Error('Playwright is not installed');};
  try{const {chromium}=await import('@playwright/test');resolveExecutable=()=>chromium.executablePath();}catch{/* gate below */}
  const prerequisite=detectBrowserPrerequisite(resolveExecutable,existsSync);
  if(prerequisite.ok)await run(browserSpec);
  else{
    const blocked=blockedResult(browserSpec,prerequisite.errorKind!,
      `Chromium executable unavailable (${prerequisite.executable??'unresolvable'}). Required setup: pnpm exec playwright install chromium`);
    console.log(`BLOCKED test:browser ${blocked.errorKind}`);results.push(blocked);
  }

  // Without --host/--model the eval runner writes an honest pending manifest and
  // exits 2; a live authenticated host is a separate gate, never assumed here.
  const evalResult=await run(spec('eval',['eval','--out',resolve(artifactRoot,'eval')],600_000));
  if(evalResult.exitCode===2)evalResult.note='Honest pending eval manifest: no live host/model supplied; all gates pending.';

  const packageOutput=resolve(artifactRoot,'desktop-package');
  const plan=windowsVerificationPlan(process.platform,version,packageOutput,process.arch);
  const windowsSpec=spec('windows-packaged-verification',plan.commands[0]!.args,3_600_000);
  if(plan.blocked){
    const blocked=blockedResult(windowsSpec,plan.errorKind!,
      `BLOCKED - needs a Windows machine to run it. Exact Windows x64 commands: ${plan.commands.map(command=>[command.command,...command.args].join(' ')).join(' && ')}`);
    console.log(`BLOCKED windows-packaged-verification ${blocked.errorKind}`);results.push(blocked);
  }else{
    const packageResult=await run(windowsSpec);
    const verifyCommand=plan.commands[1]!;
    const verifySpec=spec('windows-installed-verification',verifyCommand.args,1_800_000);
    if(packageResult.status!=='PASS'){
      results.push(blockedResult(verifySpec,'prerequisite-unavailable','Packaging did not pass; installed verification was not run.'));
    }else{
      const releaseDirectory=resolve(packageOutput,`desktop-release-${version}`);
      const setup=readdirSync(releaseDirectory).find(name=>/^Gen-V1-Setup-.*-win-x64\.exe$/.test(name));
      if(!setup)results.push(blockedResult(verifySpec,'prerequisite-unavailable',`No setup executable found in ${releaseDirectory}`));
      else await run({...verifySpec,args:['exec','tsx','scripts/verify-installed-desktop.ts',
        resolve(releaseDirectory,setup),resolve(releaseDirectory,'win-unpacked')]});
    }
  }

  const manifest=buildManifest({repositorySha,platform,runId,startedAt,endedAt:new Date().toISOString(),results});
  const manifestPath=resolve(artifactRoot,'manifest.json');
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
  console.log(`Aggregate: ${manifest.aggregate}`);
  console.log(`Manifest: ${manifestPath}`);
  process.exitCode=manifest.aggregate==='PASS'?0:1;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error(error);process.exitCode=1;});
}
