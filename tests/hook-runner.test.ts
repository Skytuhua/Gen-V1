import {describe,it,expect} from 'vitest';
import {HookRunner,type HookRunnerOptions} from '../packages/core/hook-runner.ts';
import type {Hook,HooksDocument,HookRunRecord} from '../packages/contracts/hooks.ts';
import type {runProcess} from '../packages/capabilities/process.ts';

// Cross-platform hook commands use `node -e` scripts, per the plan.
const sh=(code:string)=>process.platform==='win32'?`node -e "${code.replace(/"/g,'\\"')}"`:`node -e '${code.replace(/'/g,"'\\''")}'`;
const mkhook=(over:Partial<Hook>={}):Hook=>({id:'hook_abcd1234',name:'',event:'PreToolUse',matcher:'*',command:'exit 0',timeoutSeconds:30,onError:'continue',enabled:true,...over});
const doc=(hooks:Hook[],enabled=true):HooksDocument=>({version:1,revision:1,enabled,hooks});
const runner=(hooks:Hook[],opts:HookRunnerOptions={},enabled=true)=>{
 const recorded:{hook:Hook;record:HookRunRecord}[]=[];
 const r=new HookRunner({snapshot:()=>doc(hooks,enabled)},{...opts,onRecord:(h,rec)=>recorded.push({hook:h,record:rec})});
 return{runner:r,recorded};
};
const payload=(over:Record<string,unknown>={})=>({hook_event_name:'PreToolUse',session_id:'t1',thread_id:'t1',run_id:null,cwd:process.cwd(),project_dir:null,gen_version:'0.0.0-test',tool_name:'file_replace_prepare',tool_use_id:'u1',tool_input:{path:'a.txt'},...over});
const signal=()=>new AbortController().signal;

describe('HookRunner.matching',()=>{
 it('matches * and empty matchers against any key',()=>{
  const{runner:r}=runner([mkhook({id:'hook_a',matcher:'*'}),mkhook({id:'hook_b',matcher:''})]);
  expect(r.matching('PreToolUse','anything')).toHaveLength(2);
 });
 it('uses full-string regex semantics',()=>{
  const{runner:r}=runner([mkhook({matcher:'file'})]);
  expect(r.matching('PreToolUse','file')).toHaveLength(1);
  expect(r.matching('PreToolUse','file_replace_prepare')).toHaveLength(0);
 });
 it('skips disabled hooks and honors the master switch',()=>{
  expect(runner([mkhook({enabled:false})]).runner.matching('PreToolUse','x')).toHaveLength(0);
  expect(runner([mkhook()],{},false).runner.matching('PreToolUse','x')).toHaveLength(0);
 });
});

describe('HookRunner result protocol',()=>{
 it('exit 0 -> succeeded',async()=>{
  const{runner:r}=runner([mkhook({command:sh('')})]);
  expect((await r.pre('PreToolUse','k',payload(),signal())).blocked).toBe(false);
 });
 it('exit 2 + stderr -> blocked with the stderr reason',async()=>{
  const{runner:r}=runner([mkhook({command:sh('require("fs").writeSync(2,"blocked by my hook");process.exit(2)')})]);
  const res=await r.pre('PreToolUse','k',payload(),signal());
  expect(res).toMatchObject({blocked:true,reason:'blocked by my hook'});
 });
 it('exit 2 without stderr -> default reason',async()=>{
  const{runner:r}=runner([mkhook({command:sh('process.exit(2)')})]);
  expect(await r.pre('PreToolUse','k',payload(),signal())).toMatchObject({blocked:true,reason:expect.stringContaining('Blocked by hook')});
 });
 for(const body of [`process.stdout.write(JSON.stringify({decision:"block",reason:"json says no"}))`,`process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:"deny",permissionDecisionReason:"policy"}}))`])
  it('JSON '+body.includes('decision')+' -> blocked',async()=>{
   const{runner:r}=runner([mkhook({command:sh(body)})]);
   expect(await r.pre('PreToolUse','k',payload(),signal())).toMatchObject({blocked:true});
  });
 it('systemMessage is captured',async()=>{
  const{runner:r,recorded}=runner([mkhook({command:sh('process.stdout.write(JSON.stringify({systemMessage:"heads up"}))')})]);
  await r.pre('PreToolUse','k',payload(),signal());
  expect(recorded[0].record.systemMessage).toBe('heads up');
 });
 it('unsupported JSON fields are listed in ignoredFields',async()=>{
  const{runner:r,recorded}=runner([mkhook({command:sh('process.stdout.write(JSON.stringify({updatedInput:{x:1},additionalContext:"ctx",continue:true}))')})]);
  await r.pre('PreToolUse','k',payload(),signal());
  expect(recorded[0].record.ignoredFields).toEqual(expect.arrayContaining(['updatedInput','additionalContext','continue']));
 });
 it('invalid JSON starting with { -> failed',async()=>{
  const{runner:r,recorded}=runner([mkhook({command:sh('process.stdout.write("{oops")')})]);
  await r.pre('PreToolUse','k',payload(),signal());
  expect(recorded[0].record.outcome).toBe('failed');
 });
 it('exit 1: onError continue proceeds, onError block blocks',async()=>{
  const cmd=sh('process.exit(1)');
  expect((await runner([mkhook({command:cmd})]).runner.pre('PreToolUse','k',payload(),signal())).blocked).toBe(false);
  expect(await runner([mkhook({command:cmd,onError:'block'})]).runner.pre('PreToolUse','k',payload(),signal())).toMatchObject({blocked:true,reason:expect.stringContaining('failed')});
 });
 it('timeout kills and reports timed_out',async()=>{
  const{runner:r,recorded}=runner([mkhook({command:sh('setInterval(()=>{},1000)'),timeoutSeconds:1})]);
  await r.pre('PreToolUse','k',payload(),signal());
  expect(recorded[0].record).toMatchObject({outcome:'timed_out'});
 },15_000);
 it('spawn failure -> spawn_failed, onError block blocks',async()=>{
  const fail:typeof runProcess=async()=>{throw new Error('ENOENT');};
  const{runner:r,recorded}=runner([mkhook({onError:'block'})],{runProcess:fail});
  expect(await r.pre('PreToolUse','k',payload(),signal())).toMatchObject({blocked:true});
  expect(recorded[0].record.outcome).toBe('spawn_failed');
 });
 it('abort cancels a running hook',async()=>{
  const ac=new AbortController();
  const{runner:r,recorded}=runner([mkhook({command:sh('setInterval(()=>{},1000)')})]);
  const done=r.pre('PreToolUse','k',payload(),ac.signal);
  setTimeout(()=>ac.abort(),200);
  await done;
  expect(recorded[0].record.outcome).toBe('cancelled');
 },15_000);
});

describe('payload and ordering',()=>{
 it('sends the JSON payload on stdin and sets R05 env vars',async()=>{
  const script=`let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.stringify({p:JSON.parse(d),e:[process.env.GEN_HOOK_EVENT,process.env.GEN_THREAD_ID,process.env.GEN_TOOL_NAME]})));`;
  const{runner:r,recorded}=runner([mkhook({command:sh(script)})]);
  await r.pre('PreToolUse','file_replace_prepare',payload(),signal());
  const out=JSON.parse(recorded[0].record.stdout);
  expect(out.p.hook_event_name).toBe('PreToolUse');
  expect(out.p.tool_name).toBe('file_replace_prepare');
  expect(out.p.thread_id).toBe('t1');
  expect(out.e).toEqual(['PreToolUse','t1','file_replace_prepare']);
 });
 it('truncates payloads over 1 MiB and flags truncated',async()=>{
  const script=`let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).truncated===true&&d.length<1024*1024+100)));`;
  const{runner:r,recorded}=runner([mkhook({command:sh(script)})]);
  await r.pre('PreToolUse','k',payload({tool_input:{blob:'x'.repeat(1500*1024)}}),signal());
  expect(recorded[0].record.stdout).toBe('true');
 });
 it('first block stops later Pre hooks; Post runs all',async()=>{
  const calls:string[]=[];
  const fake:typeof runProcess=async(_c,args)=>{calls.push(args[args.length-1]);return{status:'succeeded',exitCode:2,signal:null,cancelled:false,timedOut:false,stdout:'',stderr:'stop '+args[args.length-1],truncated:false,pid:1};};
  const{runner:r}=runner([mkhook({id:'hook_1'}),mkhook({id:'hook_2'})],{runProcess:fake});
  const res=await r.pre('PreToolUse','k',payload(),signal());
  expect(res.blocked).toBe(true);
  expect(calls).toHaveLength(1);
  const ok:typeof runProcess=async(_c,args)=>{calls.push(args[args.length-1]);return{status:'succeeded',exitCode:0,signal:null,cancelled:false,timedOut:false,stdout:'',stderr:'',truncated:false,pid:1};};
  const{runner:r2}=runner([mkhook({id:'hook_1',event:'PostToolUse'}),mkhook({id:'hook_2',event:'PostToolUse'})],{runProcess:ok});
  expect(await r2.post('k',payload({hook_event_name:'PostToolUse'}),signal())).toHaveLength(2);
 });
 it('Stop queue runs at most 4 concurrently',async()=>{
  let running=0,max=0;const resolvers:(()=>void)[]=[];
  const fake:typeof runProcess=async()=>{running++;max=Math.max(max,running);await new Promise<void>(done=>resolvers.push(done));running--;return{status:'succeeded',exitCode:0,signal:null,cancelled:false,timedOut:false,stdout:'',stderr:'',truncated:false,pid:1};};
  const hooks=Array.from({length:6},(_,i)=>mkhook({id:'hook_'+i,event:'Stop'}));
  const{runner:r}=runner(hooks,{runProcess:fake});
  r.stop(payload({hook_event_name:'Stop'}));
  await new Promise(done=>setTimeout(done,50));
  expect(max).toBe(4);expect(resolvers).toHaveLength(4);
  for(const done of resolvers.splice(0))done();
  await new Promise(done=>setTimeout(done,50));
  expect(resolvers.length).toBeGreaterThan(0);
  for(const done of resolvers.splice(0))done();
  await new Promise(done=>setTimeout(done,50));
  expect(r.lastRuns.size).toBe(6);
 });
 it('master off -> zero spawns',async()=>{
  let calls=0;
  const fake:typeof runProcess=async()=>{calls++;return{status:'succeeded',exitCode:0,signal:null,cancelled:false,timedOut:false,stdout:'',stderr:'',truncated:false,pid:1};};
  const{runner:r}=runner([mkhook(),mkhook({event:'PostToolUse'}),mkhook({event:'Stop'})],{runProcess:fake},false);
  await r.pre('PreToolUse','k',payload(),signal());
  await r.post('k',payload(),signal());
  r.stop(payload({hook_event_name:'Stop'}));
  await new Promise(done=>setTimeout(done,20));
  expect(calls).toBe(0);
 });
 it('lastRuns and onRecord track each run',async()=>{
  const{runner:r,recorded}=runner([mkhook({command:sh('')})]);
  await r.pre('PreToolUse','k',payload(),signal());
  expect(recorded).toHaveLength(1);
  expect(r.lastRuns.get('hook_abcd1234')).toMatchObject({outcome:'succeeded',exitCode:0});
 });
});
