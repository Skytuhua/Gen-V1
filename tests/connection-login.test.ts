import {expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {connectionLoginMain,parseConnectionLogin} from '../packages/runtime-login/index.ts';
import {SUBSCRIPTION_CONNECTIONS} from '../packages/contracts/connections.ts';
const cursor=vi.hoisted(()=>({login:vi.fn(async()=>{})}));
vi.mock('../packages/runtime-official/cursor.ts',()=>({cursorLogin:cursor.login}));

it('routes fixed official providers to native login and retains Pi login options',async()=>{
 const pi=vi.fn(async()=>{}),official=vi.fn(async()=>{}),directory=resolve('.harness-login-fixture');
 await connectionLoginMain(['--provider','claude-code','--data-dir',directory],{pi,official});
 expect(official).toHaveBeenCalledWith({provider:'claude-code',dataDir:directory});expect(pi).not.toHaveBeenCalled();
 const args=['--provider','kimi-coding','--data-dir',directory,'--no-open'];await connectionLoginMain(args,{pi,official});expect(pi).toHaveBeenCalledWith(args);
});
it('never accepts secret arguments, arbitrary executables or unknown login flags',()=>{
 for(const args of [['--api-key','fixture-secret'],['--provider','cmd.exe'],['--exec','calc.exe'],['--provider'],['--data-dir']]){
  expect(()=>parseConnectionLogin(args)).toThrow();
 }
 expect(()=>parseConnectionLogin(['--provider','gemini-cli','--no-open'])).toThrow(/native/i);
});
it('does not substitute providers when a selected native login fails',async()=>{
 const pi=vi.fn(async()=>{}),official=vi.fn(async()=>{throw Error('Fixture native failure');});
 await expect(connectionLoginMain(['--provider','gemini-cli'],{pi,official})).rejects.toThrow('Fixture native failure');expect(pi).not.toHaveBeenCalled();
});
it('rejects the unadmitted Cursor login without falling back to Pi or another native provider',async()=>{
 const pi=vi.fn(async()=>{}),official=vi.fn(async()=>{}),row=SUBSCRIPTION_CONNECTIONS.find(value=>value.id==='cursor-sdk')!,status=row.status;
 row.status='runtime-pending';
 try{await expect(connectionLoginMain(['--provider','cursor-sdk'],{pi,official})).rejects.toThrow(/available connection/);expect(pi).not.toHaveBeenCalled();expect(official).not.toHaveBeenCalled();}
 finally{row.status=status;}
});
it('dispatches an admitted Cursor login only to its fixed SDK helper and rejects Pi browser options',async()=>{
 const row=SUBSCRIPTION_CONNECTIONS.find(value=>value.id==='cursor-sdk')!,directory=resolve('.harness-cursor-login-fixture'),status=row.status;
 row.status='available';cursor.login.mockClear();
 try{expect(()=>parseConnectionLogin(['--provider','cursor-sdk','--no-open'])).toThrow(/native/i);await connectionLoginMain(['--provider','cursor-sdk','--data-dir',directory]);expect(cursor.login).toHaveBeenCalledExactlyOnceWith(directory);}
 finally{row.status=status;}
});
