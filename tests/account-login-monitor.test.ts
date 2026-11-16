import {afterEach,expect,it,vi} from 'vitest';
import type {DesktopBridge} from '../packages/desktop-contract/index.ts';
import type {AccountLoginFlow} from '../packages/contracts/authentication.ts';
import {createAccountLoginMonitor} from '../apps/web/src/account-login-monitor.ts';
import {getAccountAuth} from '../apps/web/src/account-api.ts';
vi.mock('../apps/web/src/account-api.ts',()=>({getAccountAuth:vi.fn(async()=>({state:'configured'}))}));
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
const flow=(id:string,state:AccountLoginFlow['state']='waiting'):AccountLoginFlow=>({id,providerId:'openai',accountId:null,state,startedAt:'2026-11-15T00:00:00Z',updatedAt:'2026-11-15T00:00:00Z',message:state});
it('does not report confirmed absence from a getter that raced a newer sign-in',async()=>{
  let release!:(value:null)=>void;
  const monitor=createAccountLoginMonitor({activeSignIn:()=>new Promise(resolve=>{release=resolve;}),signIn:async()=>flow('newer')} as unknown as DesktopBridge,vi.fn(),vi.fn(async()=>{}));
  try{const recovering=monitor.recover();await monitor.start('openai');release(null);expect(await recovering).toBeUndefined();}
  finally{monitor.close();}
});
it('serializes polls and fences a cancelled flow after retry replaces its ID',async()=>{
  vi.useFakeTimers();let release!:(value:AccountLoginFlow)=>void,count=0;
  const status=vi.fn(()=>new Promise<AccountLoginFlow>(resolve=>{release=resolve;})),changed=vi.fn(),authenticated=vi.fn(async()=>{});
  const bridge={signIn:async()=>flow(`flow-${++count}`),signInStatus:status,cancelSignIn:async(id:string)=>flow(id,'cancelled')} as unknown as DesktopBridge;
  const monitor=createAccountLoginMonitor(bridge,changed,authenticated);
  try{
    await monitor.start('openai');await vi.advanceTimersByTimeAsync(750);expect(status).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);expect(status).toHaveBeenCalledOnce();
    await monitor.cancel('flow-1');await monitor.start('openai');release(flow('flow-1','completed'));await vi.advanceTimersByTimeAsync(0);
    expect(changed.mock.calls.at(-1)![0]['["openai",null]']).toMatchObject({id:'flow-2',state:'waiting'});
    expect(authenticated).not.toHaveBeenCalled();
  }finally{monitor.close();}
});
it('recovers active metadata and reports completed auth once after checking the exact target',async()=>{
  vi.useFakeTimers();const active=flow('recovered'),authenticated=vi.fn(async()=>{}),status=vi.fn(async()=>({...active,state:'completed' as const}));
  const monitor=createAccountLoginMonitor({activeSignIn:async()=>active,signInStatus:status} as unknown as DesktopBridge,vi.fn(),authenticated);
  try{
    await monitor.recover();await vi.advanceTimersByTimeAsync(750);
    expect(getAccountAuth).toHaveBeenCalledWith({providerId:'openai',accountId:null},expect.any(AbortSignal));
    expect(authenticated).toHaveBeenCalledExactlyOnceWith({providerId:'openai',accountId:null},'completed','recovered');
    await vi.advanceTimersByTimeAsync(3000);expect(status).toHaveBeenCalledOnce();expect(authenticated).toHaveBeenCalledOnce();
  }finally{monitor.close();}
});
it('does not publish a completion after its application generation is disposed',async()=>{
  vi.useFakeTimers();let release!:(value:any)=>void;
  vi.mocked(getAccountAuth).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const authenticated=vi.fn(async()=>{}),monitor=createAccountLoginMonitor({activeSignIn:async()=>flow('old'),signInStatus:async()=>flow('old','completed')} as unknown as DesktopBridge,vi.fn(),authenticated);
  await monitor.recover();await vi.advanceTimersByTimeAsync(750);monitor.close();release({state:'configured'});await vi.advanceTimersByTimeAsync(0);
  expect(authenticated).not.toHaveBeenCalled();
});
