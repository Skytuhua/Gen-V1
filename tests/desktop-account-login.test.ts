import { expect, it, vi } from 'vitest';
import { createAccountLoginFlows } from '../apps/desktop/account-login.ts';

function deferred() { let resolve!: () => void, reject!: (e: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
it('owns completion and cancellation by flow id and permits retry only after cleanup', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const cancel = vi.fn(async () => { first.reject(Error('cancelled')); });
  const flows = createAccountLoginFlows(async () => ({ completion: ++count === 1 ? first.promise : second.promise, cancel }));
  const flow = await flows.start('openai', null);
  expect(flow.state).toBe('opening');
  await vi.waitFor(() => expect(flows.status(flow.id)?.state).toBe('waiting'));
  expect(await flows.start('openai', null)).toMatchObject({ id: flow.id });
  await expect(flows.cancel('not-owned')).rejects.toThrow();
  await flows.cancel(flow.id);
  expect(flows.status(flow.id)?.state).toBe('cancelled');
  const retry = await flows.start('openai', null);
  expect(retry.id).not.toBe(flow.id);
  first.resolve(); await Promise.resolve();
  expect(flows.status(retry.id)?.state).toBe('waiting');
  second.resolve(); await vi.waitFor(() => expect(flows.status(retry.id)?.state).toBe('completed'));
});
it('keeps unconfirmed cancellation visible and blocks a successor', async () => {
  const complete = deferred();
  const flows = createAccountLoginFlows(async () => ({ completion: complete.promise, cancel: async () => { throw Error('unconfirmed'); } }));
  const flow = await flows.start('cursor-sdk', null);
  await vi.waitFor(() => expect(flows.status(flow.id)?.state).toBe('waiting'));
  await expect(flows.cancel(flow.id)).rejects.toThrow();
  expect(flows.status(flow.id)?.state).toBe('blocked');
  await expect(flows.start('openai', null)).rejects.toThrow();
});
it('publishes opening ownership before native readiness and can cancel startup', async()=>{
  const flows=createAccountLoginFlows(async(_provider,_account,signal)=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});}));
  const flow=await flows.start('openai',null);expect(flow.state).toBe('opening');
  expect(await flows.cancel(flow.id)).toMatchObject({id:flow.id,state:'cancelled'});
});
it('keeps unconfirmed startup failure owned and prevents retry',async()=>{
  const flows=createAccountLoginFlows(async()=>{throw Object.assign(Error('private-native-error'),{code:'RUNTIME_TEARDOWN_FAILED'});});
  const flow=await flows.start('openai',null);await vi.waitFor(()=>expect(flows.status(flow.id)?.state).toBe('blocked'));
  await expect(flows.start('openai',null)).rejects.toThrow();expect(JSON.stringify(flows.status(flow.id))).not.toContain('private-native-error');
});
it('cannot clear a blocked startup by cancelling without a native handle',async()=>{
 const flows=createAccountLoginFlows(async()=>{throw Object.assign(Error('unconfirmed'),{code:'RUNTIME_TEARDOWN_FAILED'});});
 const flow=await flows.start('openai',null);await vi.waitFor(()=>expect(flows.status(flow.id)?.state).toBe('blocked'));
 await expect(flows.cancel(flow.id)).rejects.toThrow();expect(flows.status(flow.id)?.state).toBe('blocked');await expect(flows.start('openai',null)).rejects.toThrow();
});
it('retains blocked ownership when cancellation races an unconfirmed startup failure',async()=>{
 const flows=createAccountLoginFlows(async(_provider,_account,signal)=>new Promise((_yes,no)=>signal.addEventListener('abort',()=>no(Object.assign(Error('unconfirmed'),{code:'RUNTIME_TEARDOWN_FAILED'})),{once:true})));
 const flow=await flows.start('openai',null);await expect(flows.cancel(flow.id)).rejects.toThrow();expect(flows.status(flow.id)?.state).toBe('blocked');await expect(flows.start('openai',null)).rejects.toThrow();
});
