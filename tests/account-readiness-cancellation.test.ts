import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import {spawn} from 'node:child_process';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';
import {claudeAccountStatus} from '../packages/runtime-official/claude-account.ts';
import {cursorAccountStatus} from '../packages/runtime-official/cursor.ts';

vi.mock('node:child_process', async original => ({...await original<typeof import('node:child_process')>(), spawn:vi.fn()}));
vi.mock('../packages/runtime-pi/process-tree.ts', () => ({terminateProcessTree:vi.fn()}));
const roots:string[]=[];
afterEach(async()=>{vi.clearAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
function gate<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
it.each([['claude-code',false],['cursor-sdk',false],['claude-code',true],['cursor-sdk',true]] as const)('cancels %s readiness and awaits child cleanup (unconfirmed=%s)',async(provider,unconfirmed)=>{
  const root=await mkdtemp(join(tmpdir(),'readiness-cancel-'));roots.push(root);
  const control=new AbortController(), cleanup=gate<void>(), account=gate<any>();let started=false,finished=false;
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,signalCode:null,connected:true,pid:undefined,
    send(frame:any,callback?:()=>void){if(frame.type==='initialize')started=true;if(frame.type==='close')queueMicrotask(()=>child.emit('message',{type:'closed'}));callback?.();},
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  vi.mocked(terminateProcessTree).mockReturnValue(cleanup.promise);
  const query={accountInfo:()=>{started=true;return account.promise;},interrupt:vi.fn(async()=>{}),close:vi.fn()};
  const reading=provider==='claude-code'?claudeAccountStatus(root,{query:({options}:any)=>{options.spawnClaudeCodeProcess({command:'synthetic-native',args:[],cwd:root,env:{}});return query as any;}},control.signal):cursorAccountStatus(root,control.signal);
  const settled=reading.then(value=>{finished=true;return value;},error=>{finished=true;return error;});
  try{
    await vi.waitFor(()=>expect(started).toBe(true));control.abort();
    await vi.waitFor(()=>expect(terminateProcessTree).toHaveBeenCalledOnce());
    expect(finished).toBe(false);
    if(unconfirmed)cleanup.reject(Object.assign(Error('synthetic unconfirmed cleanup'),{code:'RUNTIME_TEARDOWN_FAILED'}));else cleanup.resolve();
    expect(await settled).toMatchObject(unconfirmed?{code:'RUNTIME_TEARDOWN_FAILED'}:{name:'AbortError'});
    if(provider==='claude-code')expect(query.close).toHaveBeenCalledOnce();
  }finally{
    account.resolve({apiProvider:'firstParty',subscriptionType:'Claude Max',apiKeySource:'none'});
    child.emit('message',{type:'auth-status',identity:null});cleanup.resolve();await settled;
  }
});
