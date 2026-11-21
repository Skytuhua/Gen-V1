import {afterEach,expect,it,vi} from 'vitest';
import {createPolling} from '../apps/web/src/usePolling';

function fixture(visible='visible'){
 const page=Object.assign(new EventTarget(),{visibilityState:visible});
 vi.stubGlobal('document',page);
 return page;
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it('runs immediately then on the interval while visible',async()=>{
 fixture();
 vi.useFakeTimers();
 const task=vi.fn(async()=>{});
 createPolling(task,4000);
 await vi.advanceTimersByTimeAsync(0);
 expect(task).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(8000);
 expect(task).toHaveBeenCalledTimes(3);
});

it('does not fire while the document is hidden and resumes immediately on visible',async()=>{
 const page=fixture('hidden');
 vi.useFakeTimers();
 const task=vi.fn(async()=>{});
 createPolling(task,4000);
 await vi.advanceTimersByTimeAsync(20000);
 expect(task).not.toHaveBeenCalled();
 page.visibilityState='visible';
 page.dispatchEvent(new Event('visibilitychange'));
 await vi.advanceTimersByTimeAsync(0);
 expect(task).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(4000);
 expect(task).toHaveBeenCalledTimes(2);
});

it('backs off exponentially up to 60s after consecutive failures and reports through onError',async()=>{
 fixture();
 vi.useFakeTimers();
 const task=vi.fn(async()=>{throw new Error('down');});
 const onError=vi.fn();
 createPolling(task,4000,onError);
 await vi.advanceTimersByTimeAsync(0);
 expect(task).toHaveBeenCalledTimes(1);expect(onError).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(7999);expect(task).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);expect(task).toHaveBeenCalledTimes(2); // 8s
 await vi.advanceTimersByTimeAsync(16000);expect(task).toHaveBeenCalledTimes(3); // 16s
 await vi.advanceTimersByTimeAsync(32000);expect(task).toHaveBeenCalledTimes(4); // 32s
 await vi.advanceTimersByTimeAsync(60000);expect(task).toHaveBeenCalledTimes(5); // capped at 60s
 await vi.advanceTimersByTimeAsync(60000);expect(task).toHaveBeenCalledTimes(6);
});

it('resets the interval after a successful task',async()=>{
 fixture();
 vi.useFakeTimers();
 let fail=true;
 const task=vi.fn(async()=>{if(fail)throw new Error('down');});
 createPolling(task,4000);
 await vi.advanceTimersByTimeAsync(0);expect(task).toHaveBeenCalledTimes(1);
 fail=false;
 await vi.advanceTimersByTimeAsync(8000);expect(task).toHaveBeenCalledTimes(2); // succeeded at 8s
 await vi.advanceTimersByTimeAsync(4000);expect(task).toHaveBeenCalledTimes(3); // back to 4s
});

it('stops firing after stop()',async()=>{
 fixture();
 vi.useFakeTimers();
 const task=vi.fn(async()=>{});
 const polling=createPolling(task,4000);
 await vi.advanceTimersByTimeAsync(0);expect(task).toHaveBeenCalledTimes(1);
 polling.stop();
 await vi.advanceTimersByTimeAsync(20000);
 expect(task).toHaveBeenCalledTimes(1);
});
