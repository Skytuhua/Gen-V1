import {deferred} from './fixtures/deferred.ts';
import { expect, it, vi } from 'vitest';
import { finishBackendStartup } from '../apps/desktop/backend-policy';

it.each([{ exitCode: 7, signalCode: null }, { exitCode: null, signalCode: 'SIGTERM' as const }])(
  'does not activate a backend that stops while the old relay closes (%j)',
  async stopped => {
    const drain = deferred(), activate = vi.fn();
    const child: { exitCode: number | null; signalCode: NodeJS.Signals | null } = { exitCode: null, signalCode: null };
    const result = finishBackendStartup(child, drain.promise, () => 'backend diagnostic', activate);
    const rejection = expect(result).rejects.toThrow(/stopped during startup.*backend diagnostic/);
    Object.assign(child, stopped);
    drain.resolve();
    await rejection;
    expect(activate).not.toHaveBeenCalled();
  }
);

it('activates a live backend only after the old relay is closed', async () => {
  const drain = deferred(), activate = vi.fn();
  const result = finishBackendStartup({ exitCode: null, signalCode: null }, drain.promise, () => '', activate);
  expect(activate).not.toHaveBeenCalled();
  drain.resolve();
  await result;
  expect(activate).toHaveBeenCalledOnce();
});


it('keeps the original relay rejection when diagnostic observation fails',async()=>{
 const original=Error('PRIVATE_RELAY_FAILURE'),events:unknown[]=[],activate=vi.fn();
 const outcome=(finishBackendStartup as unknown as (...args:unknown[])=>Promise<void>)({exitCode:null,signalCode:null},Promise.reject(original),()=>'',activate,(event:unknown)=>{events.push(event);throw Error('PRIVATE_OBSERVER_FAILURE');}).catch(error=>error);
 expect(await outcome).toBe(original);expect(activate).not.toHaveBeenCalled();expect(events).toEqual([{stage:'backend-relay-error',error:{category:'error',code:null}}]);
});
it('records a backend stopped during relay close without changing refusal',async()=>{
 const events:unknown[]=[],activate=vi.fn();
 const outcome=(finishBackendStartup as unknown as (...args:unknown[])=>Promise<void>)({exitCode:9,signalCode:null},undefined,()=>'',activate,(event:unknown)=>events.push(event)).catch(error=>error);
 expect(await outcome).toBeInstanceOf(Error);expect(activate).not.toHaveBeenCalled();expect(events).toEqual([{stage:'backend-activation-stopped',error:null}]);
});
