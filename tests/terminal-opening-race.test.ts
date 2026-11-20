import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({spawn:vi.fn(()=>({onData:vi.fn(),onExit:vi.fn(),write:vi.fn(),kill:vi.fn()})),resolve:vi.fn(async()=>({EXAMPLE_API_KEY:'fixture'}))}));
vi.mock('node-pty',()=>({spawn:mocks.spawn}));
vi.mock('../packages/core/environment-settings.ts',()=>({environmentSettingsFor:()=>({resolve:mocks.resolve})}));
import {TerminalHost} from '../packages/workspace/terminal.ts';
import type {ProjectTools} from '../packages/workspace/tools.ts';
beforeEach(()=>{mocks.spawn.mockClear();mocks.resolve.mockClear();});
function fixture(){const saved=new Map<string,unknown>();const projects={binding:vi.fn(async()=>({path:'C:/fixture'})),store:{dataDir:'C:/unused',all:()=>[],get:(_kind:string,id:string)=>saved.get(id),internal:(_type:string,_thread:unknown,apply:()=>unknown)=>apply(),put:(_kind:string,id:string,_thread:unknown,value:unknown)=>saved.set(id,value)}};return{host:new TerminalHost(projects as unknown as ProjectTools),projects};}
it('deduplicates concurrent same-pane opens after asynchronous environment resolution',async()=>{
 const {host}=fixture();const input={projectId:'project-a',threadId:'thread-a',terminalId:'terminal-a'};
 const results=await Promise.all([host.open(input),host.open(input)]);
 expect(mocks.spawn).toHaveBeenCalledTimes(1);expect(results[0].id).toBe(results[1].id);
});
it('revalidates the canonical binding after secret resolution before starting a process',async()=>{
 const {host,projects}=fixture();projects.binding.mockResolvedValueOnce({path:'C:/before'}).mockResolvedValue({path:'C:/after'});
 await expect(host.open({projectId:'project-a',threadId:'thread-a'})).rejects.toThrow('changed');expect(mocks.spawn).not.toHaveBeenCalled();
});
it('returns an empty range at the current end for a cursor beyond the transcript',async()=>{
 const {host}=fixture();const input={projectId:'project-a',terminalId:'terminal-a'};
 await host.open(input);
 const emit=(mocks.spawn.mock.results[0]?.value.onData.mock.calls as unknown as [(data:string)=>void][])?.[0]?.[0];
 emit('ready');
 await expect(host.read(input.terminalId,input.projectId,undefined,500)).resolves.toMatchObject({output:'',start:5,cursor:5});
 await expect(host.read(input.terminalId,input.projectId,undefined,2)).resolves.toMatchObject({output:'ady',start:2,cursor:5});
});

it('rejects an oversized initial command before starting or reserving a terminal',async()=>{
 const {host}=fixture();const input={projectId:'project-a',threadId:'thread-a',terminalId:'terminal-a'};
 await expect(host.open({...input,command:'x'.repeat(8001)})).rejects.toThrow();
 expect(mocks.spawn).not.toHaveBeenCalled();
 await expect(host.open({...input,command:'echo ready'})).resolves.toMatchObject({id:'terminal-a'});
 expect(mocks.spawn).toHaveBeenCalledOnce();
 expect(mocks.spawn.mock.results[0]?.value.write).toHaveBeenCalledWith('echo ready\r');
});

it('keeps the retained output and its cursor on a complete UTF-16 character boundary',async()=>{
 const {host}=fixture();
 const opened=await host.open({projectId:'project-a',terminalId:'unicode'});
 const onData=mocks.spawn.mock.results[0]!.value.onData.mock.calls[0]![0] as (data:string)=>void;
 const cap=512*1024;
 onData('😀'+'x'.repeat(cap-1));
 const result=await host.read(opened.id,opened.projectId);
 expect(result.start).toBe(2);
 expect(result.cursor).toBe(cap+1);
 expect(result.output).toBe('x'.repeat(cap-1));
 expect((await host.read(opened.id,opened.projectId,undefined,result.cursor)).output).toBe('');
});

it('terminates an unregistered native process before allowing a retry of that pane',async()=>{
 const {host,projects}=fixture();const input={projectId:'project-a',terminalId:'unregistered'};
 const persist=projects.store.internal;let fail=true;projects.store.internal=(kind,owner,apply)=>{if(fail){fail=false;throw Error('synthetic start write failed');}return persist(kind,owner,apply);};
 let exit!:(event:{exitCode:number})=>void;
 const kill=vi.fn(()=>exit({exitCode:1}));
 mocks.spawn.mockReturnValueOnce({onData:vi.fn(),onExit:vi.fn(handler=>{exit=handler;}),write:vi.fn(),kill});
 await expect(host.open({...input,command:'echo ready'})).rejects.toThrow('synthetic start write failed');
 expect(kill).toHaveBeenCalledOnce();
 expect(mocks.spawn.mock.results[0]!.value.write).not.toHaveBeenCalled();
 expect(projects.store.get('terminalSession',input.terminalId)).toBeUndefined();
 await expect(host.open(input)).resolves.toMatchObject({id:input.terminalId,exited:false});
 expect(mocks.spawn).toHaveBeenCalledTimes(2);
});

it('does not expose an unregistered pane while its native exit is still pending',async()=>{
 const {host,projects}=fixture();const input={projectId:'project-a',terminalId:'closing'};
 const persist=projects.store.internal;let fail=true;projects.store.internal=(kind,owner,apply)=>{if(fail){fail=false;throw Error('synthetic start write failed');}return persist(kind,owner,apply);};
 let exit!:(event:{exitCode:number})=>void;
 const kill=vi.fn();
 mocks.spawn.mockReturnValueOnce({onData:vi.fn(),onExit:vi.fn(handler=>{exit=handler;}),write:vi.fn(),kill});
 const opening=host.open(input).catch(error=>error);
 try{
  await vi.waitFor(()=>expect(kill).toHaveBeenCalledOnce());
  await expect(host.open(input)).rejects.toMatchObject({code:'TERMINAL_CANCEL_UNCONFIRMED'});
  await expect(host.read(input.terminalId,input.projectId)).rejects.toMatchObject({code:'TERMINAL_CANCEL_UNCONFIRMED'});
  expect(mocks.spawn).toHaveBeenCalledOnce();
 }finally{exit({exitCode:1});await opening;}
 expect(await opening).toMatchObject({message:'synthetic start write failed'});
 await expect(host.open(input)).resolves.toMatchObject({id:input.terminalId,exited:false});
});


it('settles an observed native exit even when recording it in the Store fails',async()=>{
 const {host,projects}=fixture();
 const opened=await host.open({projectId:'project-a',terminalId:'exit-storage'});
 const pty=mocks.spawn.mock.results[0]!.value;
 const onExit=pty.onExit.mock.calls[0]![0] as (event:{exitCode:number})=>void;
 vi.spyOn(projects.store,'put').mockImplementationOnce(()=>{throw new Error('Fixture storage is full');});
 pty.kill.mockImplementationOnce(()=>{
  expect(()=>onExit({exitCode:0})).not.toThrow();
 });
 await expect(host.command(opened.id,opened.projectId,undefined,{type:'stop'})).resolves.toMatchObject({exited:true,exitCode:0});
 await expect(host.read(opened.id,opened.projectId)).resolves.toMatchObject({exited:true,exitCode:0});
 expect(projects.store.get('terminalSession',opened.id)).toMatchObject({exited:false});
});


it('retains newly exited scrollback by exit order, not by when the terminal opened',async()=>{
 const {host}=fixture();
 const projectId='project-a';
 const finish=(index:number,output:string)=>{
  const pty=mocks.spawn.mock.results[index]!.value;
  const onData=pty.onData.mock.calls[0]![0] as (data:string)=>void;
  const onExit=pty.onExit.mock.calls[0]![0] as (event:{exitCode:number})=>void;
  onData(output);onExit({exitCode:0});
 };
 const oldest=await host.open({projectId,terminalId:'long-lived'});
 for(let index=1;index<=48;index++){
  await host.open({projectId,terminalId:'short-'+index});
  finish(index,'short '+index);
 }
 finish(0,'most recently finished');
 await expect(host.read(oldest.id,projectId)).resolves.toMatchObject({output:'most recently finished',exited:true});
 await expect(host.read('short-1',projectId)).rejects.toMatchObject({code:'TERMINAL_ENDED'});
 await expect(host.read('short-2',projectId)).resolves.toMatchObject({output:'short 2',exited:true});
});

