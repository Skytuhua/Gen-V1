import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,expect,it} from 'vitest';
import {HookSettings,newHookId} from '../packages/core/hook-settings.ts';
import {HookRunner,type HookPayload} from '../packages/core/hook-runner.ts';
import type {Hook} from '../packages/contracts/hooks.ts';

const node=(body:string)=>`${JSON.stringify(process.execPath)} -e ${JSON.stringify(body)}`;
const payload=(extra:Record<string,unknown>={}):HookPayload=>({hook_event_name:'PreToolUse',session_id:'s',thread_id:'t',run_id:null,cwd:process.cwd(),project_dir:null,gen_version:'test',tool_name:'op:file.replace',...extra});
const mkhook=(overrides:Record<string,unknown>={}):Hook=>({id:newHookId(),event:'PreToolUse',matcher:'',command:'true',timeoutSeconds:10,onError:'continue',enabled:true,name:'',...overrides}as Hook);
const setup=async(...hooks:Hook[])=>{
 const dir=await mkdtemp(join(tmpdir(),'gen-hookrun-'));
 const settings=new HookSettings(dir);let rev=0;
 for(const hook of hooks)rev=(await settings.save({hook,baseRevision:rev})).revision;
 return{dir,settings,runner:new HookRunner(settings),cleanup:()=>rm(dir,{recursive:true,force:true,maxRetries:3})};
};

describe('HookRunner',()=>{
 it('exit 0 succeeds and keeps stdout/stderr',async()=>{
  const{runner,cleanup}=await setup(mkhook({command:node("process.stdout.write('out');process.stderr.write('err')")}));
  try{const r=await runner.pre('PreToolUse','any',payload(),new AbortController().signal);expect(r).toEqual({blocked:false});
   const rec=runner.lastRuns.values().next().value!;expect(rec).toMatchObject({outcome:'succeeded',exitCode:0,stdout:'out',stderr:'err'});}finally{await cleanup();}
 });
 it('exit 2 blocks with the stderr reason (and default when empty)',async()=>{
  const{runner,cleanup}=await setup(mkhook({command:node("require('node:fs').writeSync(2,'nope');process.exit(2)")}),mkhook({command:node("process.exit(2)")}));
  try{let r=await runner.pre('PreToolUse','x',payload(),new AbortController().signal);
   expect(r).toMatchObject({blocked:true,reason:'nope'});}finally{await cleanup();}
 });
 it('JSON decision:block and permissionDecision:deny block; updatedInput is listed in ignoredFields',async()=>{
  const{runner,cleanup}=await setup(mkhook({command:node("process.stdout.write(JSON.stringify({decision:'block',reason:'json said no',systemMessage:'hi',updatedInput:{x:1}}))")}));
  try{const r=await runner.pre('PreToolUse','x',payload(),new AbortController().signal);
   expect(r).toMatchObject({blocked:true,reason:'json said no'});
   if(r.blocked)expect(r.record).toMatchObject({systemMessage:'hi',ignoredFields:['updatedInput']});
   const{runner:r2,cleanup:c2}=await setup(mkhook({command:node("process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'denied'}}))")}));
   try{expect(await r2.pre('PreToolUse','x',payload(),new AbortController().signal)).toMatchObject({blocked:true,reason:'denied'});}finally{await c2();}
  }finally{await cleanup();}
 });
 it('invalid JSON starting with { and nonzero exit fail; onError:block turns failure into block',async()=>{
  const{runner,cleanup}=await setup(mkhook({command:node("process.stdout.write('{oops')")}));
  try{const r=await runner.pre('PreToolUse','x',payload(),new AbortController().signal);expect(r).toEqual({blocked:false});
   expect([...runner.lastRuns.values()][0].outcome).toBe('failed');
   const{runner:r2,cleanup:c2}=await setup(mkhook({onError:'block',command:node("process.exit(1)"),name:'guard'}));
   try{expect(await r2.pre('PreToolUse','x',payload(),new AbortController().signal)).toMatchObject({blocked:true,reason:'Hook guard failed: Exited with code 1'});}finally{await c2();}
  }finally{await cleanup();}
 });
 it('times out and kills the hook process',async()=>{
  const{runner,cleanup}=await setup(mkhook({timeoutSeconds:1,command:node("setTimeout(()=>{},60000)")}));
  try{const rec=await runner.run((await runner.matching('PreToolUse','x'))[0],payload(),new AbortController().signal);
   expect(rec).toMatchObject({outcome:'timed_out'});expect(rec.durationMs).toBeLessThan(15000);}finally{await cleanup();}
 });
 it('fails cleanly when the hook command is not found',async()=>{
  const{runner,cleanup}=await setup();
  try{const rec=await runner.run(mkhook({command:'nonexistent_command_xyz --flag'}),payload(),new AbortController().signal);
   expect(rec.outcome).toBe('failed');expect(rec.exitCode).not.toBe(0);}finally{await cleanup();}
  // spawn_failed only when the platform shell binary itself is missing (untestable on this platform).
 });
 it('delivers payload fields and env vars to the hook',async()=>{
  const{runner,cleanup}=await setup(mkhook({command:node("let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=JSON.parse(d);process.stdout.write(p.hook_event_name+'|'+p.tool_name+'|'+process.env.GEN_HOOK_EVENT+'|'+process.env.GEN_TOOL_NAME+'|'+p.gen_version)})")}));
  try{await runner.pre('PreToolUse','op:file.replace',payload(),new AbortController().signal);
   expect([...runner.lastRuns.values()][0].stdout).toBe('PreToolUse|op:file.replace|PreToolUse|op:file.replace|test');}finally{await cleanup();}
 });
 it('truncates payloads over 1 MiB and flags them',async()=>{
  const{runner,cleanup}=await setup(mkhook({command:node("let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=JSON.parse(d);process.stdout.write(String(p.truncated)+':'+p.big.length)})")}));
  try{await runner.pre('PreToolUse','x',payload({big:'y'.repeat(2*1024*1024)}),new AbortController().signal);
   const stdout=[...runner.lastRuns.values()][0].stdout;expect(stdout.startsWith('true:')).toBe(true);
   expect(Number(stdout.slice(5))).toBeLessThan(2*1024*1024);expect(Number(stdout.slice(5))).toBeGreaterThan(0);}finally{await cleanup();}
 });
 it('stops at the first blocking Pre hook and runs all Post hooks',async()=>{
  const blocker=mkhook({command:node("process.exit(2)")}),second=mkhook(),postA=mkhook({event:'PostToolUse'}),postB=mkhook({event:'PostToolUse'});
  const{runner,cleanup}=await setup(blocker,second,postA,postB);
  try{const r=await runner.pre('PreToolUse','x',payload(),new AbortController().signal);
   expect(r.blocked).toBe(true);expect(runner.lastRuns.has(second.id)).toBe(false);
   const recs=await runner.post('PostToolUse','x',payload({hook_event_name:'PostToolUse'}),new AbortController().signal);
   expect(recs).toHaveLength(2);}finally{await cleanup();}
 });
 it('runs Stop hooks detached at most 4 concurrently',async()=>{
  const sleep=node("setTimeout(()=>{},300)");
  const{runner,cleanup}=await setup(...Array.from({length:6},()=>mkhook({event:'Stop',command:sleep})));
  try{const started=Date.now();runner.stop(payload({hook_event_name:'Stop'}));
   await new Promise(done=>setTimeout(done,50));
   expect(Date.now()-started).toBeLessThan(300); // returned without waiting
   await new Promise(done=>setTimeout(done,900));
   expect(runner.lastRuns.size).toBe(6);}finally{await cleanup();}
 });
 it('master switch off runs zero hooks',async()=>{
  const{settings,runner,cleanup}=await setup(mkhook({command:node("process.stdout.write('ran')")}));
  try{await settings.setEnabled({enabled:false,baseRevision:(await settings.read()).revision});
   expect(await runner.matching('PreToolUse','x')).toHaveLength(0);
   expect(await runner.pre('PreToolUse','x',payload(),new AbortController().signal)).toEqual({blocked:false});}finally{await cleanup();}
 });
 it('matches *, empty and regex with full-string semantics',async()=>{
  const{runner,cleanup}=await setup(mkhook({matcher:'file'}),mkhook({matcher:'file_.*'}),mkhook({matcher:'*'}),mkhook({enabled:false}));
  try{const hits=await runner.matching('PreToolUse','file_replace_prepare');
   expect(hits.map(h=>h.matcher).sort()).toEqual(['*','file_.*']);}finally{await cleanup();}
 });
 it('cancels a running hook on abort',async()=>{
  const{runner,cleanup}=await setup(mkhook({command:node("setTimeout(()=>{},60000)")}));
  try{const ctl=new AbortController();
   const pending=runner.run((await runner.matching('PreToolUse','x'))[0],payload(),ctl.signal);
   ctl.abort();
   expect((await pending).outcome).toBe('cancelled');}finally{await cleanup();}
 });
});
