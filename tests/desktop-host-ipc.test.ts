import {it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {nextMessage} from './desktop-host-ipc.ts';

it('fails readiness immediately when the sidecar reports a startup failure',async()=>{
 vi.useFakeTimers();
 try{
  const child=new EventEmitter() as ChildProcess;
  const ready=nextMessage(child,'harness.ready');
  const settled=vi.fn();void ready.then(settled,settled);
  child.emit('message',{type:'harness.error',token:'fixture-token',message:'private fixture data'});
  await Promise.resolve();
  const notified=settled.mock.calls.length;
  // Drain the original timeout as well when exercising the baseline.
  await vi.runAllTimersAsync();
  expect(notified).toBe(1);
  await expect(ready).rejects.toThrow(/^Desktop host reported a startup error before harness.ready$/);
  expect(child.listenerCount('message')).toBe(0);
  expect(child.listenerCount('exit')).toBe(0);
 }finally{vi.useRealTimers();}
});

it('still returns an error event when that event is what the fixture requested',async()=>{
 const child=new EventEmitter() as ChildProcess;
 const startupError=nextMessage(child,'harness.error');
 const event={type:'harness.error',token:'fixture-token',message:'fixture collision'};
 child.emit('message',event);
 await expect(startupError).resolves.toBe(event);
 expect(child.listenerCount('message')).toBe(0);
 expect(child.listenerCount('exit')).toBe(0);
});
