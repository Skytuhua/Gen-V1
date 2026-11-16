import {it,expect} from 'vitest';
import {DebugRegistry,type DebugAdapter,type DebugRecipe} from '../packages/core/debug-session.ts';
import {debugSessionV1Schema} from '../packages/contracts/code-intelligence.ts';
import type {ExecutionBackend,PlatformProof} from '../packages/core/execution-policy.ts';
import {HarnessError} from '../packages/contracts/index.ts';

const signal=()=>new AbortController().signal;
const recipe:DebugRecipe={recipeId:'recipe-1',executableDigest:'a'.repeat(64),confinementProfile:'workspace-execute-no-network'};
const proof=(status:PlatformProof['status']):PlatformProof=>({platformProofRef:'proof-1',platform:process.platform,status,recordedAt:new Date().toISOString()});
const backend=(id:string,over:Partial<ExecutionBackend>={}):ExecutionBackend=>({backendId:id,platform:process.platform,installed:true,approved:true,proof:proof('PASS'),launch:async()=>({id:'h-1',terminate:async()=>{}}),...over});

class FakeDebug implements DebugAdapter{
 private st:'STARTING'|'PAUSED'|'RUNNING'|'STOPPED'|'UNKNOWN'='STARTING';
 launched=0;terminated=0;inspected:string[]=[];effects:string[]=[];
 frames=Array.from({length:150},(_,i)=>({id:i,name:`frame${i}`}));
 vars=Array.from({length:150},(_,i)=>({name:`v${i}`,value:`x`.repeat(10),variablesReference:0}));
 async launch(){this.launched++;this.st='PAUSED';return'pid-42';}
 async send(command:string){this.effects.push(command);this.st=command==='continue'?'RUNNING':'PAUSED';return{};}
 async inspect(command:string){this.inspected.push(command);
  if(command==='stackTrace')return{stackFrames:this.frames};
  if(command==='variables')return{variables:this.vars};
  return{};}
 state(){return this.st;}
 async terminate(){this.terminated++;this.st='STOPPED';}
}

it('launch requires the approved backend with a PASS platform proof',async()=>{
 const registry=new DebugRegistry([backend('ok')],'ok',()=>new FakeDebug());
 const session=await registry.launch({owner:'acct-1',recipe,signal:signal()});
 expect(debugSessionV1Schema.parse(session)).toEqual(session);
 expect(session.state).toBe('PAUSED');
 expect(session.processIdentity).toBe('pid-42');
 // Untested proof: denied, not a best-effort shell.
 const untested=new DebugRegistry([backend('u',{proof:proof('UNTESTED')})],'u',()=>new FakeDebug());
 await expect(untested.launch({owner:'a',recipe,signal:signal()})).rejects.toThrowError(/proven execution backend/i);
 // Backend not approved/installed.
 const unapproved=new DebugRegistry([backend('x',{approved:false})],'x',()=>new FakeDebug());
 await expect(unapproved.launch({owner:'a',recipe,signal:signal()})).rejects.toThrowError(HarnessError);
});

it('inspect is a bounded read of a paused process; it does not authorize execution',async()=>{
 const adapter=new FakeDebug();
 const registry=new DebugRegistry([backend('ok')],'ok',()=>adapter);
 const session=await registry.launch({owner:'acct-1',recipe,signal:signal()});
 const trace=await registry.inspect(session.sessionId,'acct-1','stackTrace',{},signal()) as {stackFrames:unknown[]};
 expect(trace.stackFrames.length).toBeLessThanOrEqual(100);
 const vars=await registry.inspect(session.sessionId,'acct-1','variables',{},signal()) as {variables:unknown[]};
 expect(vars.variables.length).toBeLessThanOrEqual(100);
 // A running process cannot be inspected.
 adapter.state=()=>'RUNNING';
 await expect(registry.inspect(session.sessionId,'acct-1','stackTrace',{},signal())).rejects.toThrowError(/paused/i);
});

it('launch controls and evaluate are effectful commands, separated from inspect',async()=>{
 const adapter=new FakeDebug();
 const registry=new DebugRegistry([backend('ok')],'ok',()=>adapter);
 const session=await registry.launch({owner:'acct-1',recipe,signal:signal()});
 await registry.effect(session.sessionId,'acct-1','continue',{},signal());
 expect(adapter.effects).toContain('continue');
 await registry.effect(session.sessionId,'acct-1','next',{},signal());
 await registry.effect(session.sessionId,'acct-1','evaluate',{expression:'1+1'},signal());
 expect(adapter.effects).toContain('evaluate');
 // Oversized expressions are rejected rather than passed through.
 await expect(registry.effect(session.sessionId,'acct-1','evaluate',{expression:'x'.repeat(5000)},signal())).rejects.toThrowError(/bound/i);
});

it('sessions are owner-scoped and revoke terminates owned resources',async()=>{
 const adapter=new FakeDebug();
 const registry=new DebugRegistry([backend('ok')],'ok',()=>adapter);
 const session=await registry.launch({owner:'acct-1',recipe,signal:signal()});
 expect(registry.get(session.sessionId,'acct-2')).toBeNull();
 await expect(registry.inspect(session.sessionId,'acct-2','stackTrace',{},signal())).rejects.toThrowError(HarnessError);
 const revoked=await registry.revoke('acct-1',signal());
 expect(revoked.terminated).toBe(1);
 expect(adapter.terminated).toBe(1);
 expect(registry.get(session.sessionId,'acct-1')).toBeNull();
});
