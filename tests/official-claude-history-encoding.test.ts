import {PassThrough} from 'node:stream';
import {ChildProcess,type spawn} from 'node:child_process';
import {expect,it} from 'vitest';
import {claudeHistory} from '../packages/runtime-official/history.ts';
import type {ManifestState} from '../packages/runtime-official/manifest.ts';

it('preserves receipt text when the native reader splits a UTF-8 character across chunks',async()=>{
 const stdout=new PassThrough(),child=new ChildProcess();
 Object.defineProperty(child,'stdout',{value:stdout});
 const receipt={uuid:'fixture-session',inputIds:['follow-up-續']};
 const bytes=Buffer.from(JSON.stringify([receipt])),split=bytes.indexOf(Buffer.from('續'))+1;
 const start=(()=>{queueMicrotask(()=>{
  stdout.write(bytes.subarray(0,split));stdout.end(bytes.subarray(split));child.emit('close',0);
 });return child;}) as typeof spawn;
 const manifest={path:'fixture/manifest.json',value:{threadId:'test-thread',sessionId:'fixture-session'}} as ManifestState;
 await expect(claudeHistory('fixture',manifest,start)).resolves.toEqual([receipt]);
});
