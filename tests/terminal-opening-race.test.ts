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
