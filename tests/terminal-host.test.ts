import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {ProjectTools} from '../packages/workspace/tools.ts';
import {TerminalHost} from '../packages/workspace/terminal.ts';
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
it('keeps a real host PTY across readers, scopes input, and confirms termination',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gen-pty-')),store=new Store(join(root,'data')),tools=new ProjectTools(store),host=new TerminalHost(tools);cleanup.push(async()=>{await host.dispose();store.close();await rm(root,{recursive:true,force:true,maxRetries:5});});
 const receipt=await tools.connect({id:'connect',type:'workspace.project.connect',payload:{name:'Terminal fixture',path:root+'\\project'}}).catch(async()=>{const{mkdir}=await import('node:fs/promises');await mkdir(join(root,'project'));return tools.connect({id:'connect',type:'workspace.project.connect',payload:{name:'Terminal fixture',path:join(root,'project')}});});
 const projectId=(receipt.result as {projects:{id:string}[]}).projects[0]!.id,first=await host.open({projectId,terminalId:'continuity'});
 const independent=await host.open({projectId,terminalId:'independent'});expect(independent.id).not.toBe(first.id);
 await host.command(first.id,projectId,undefined,{type:'input',data:'echo GEN_PTY_CONTINUITY\r'});
 await expect.poll(async()=>(await host.read(first.id,projectId)).output,{timeout:10000}).toContain('GEN_PTY_CONTINUITY');
 const moved=await host.open({projectId,terminalId:'continuity'});expect(moved.id).toBe(first.id);expect(moved.output).toContain('GEN_PTY_CONTINUITY');
 expect((await host.read(independent.id,projectId)).output).not.toContain('GEN_PTY_CONTINUITY');
 await expect(host.command(first.id,'other-project',undefined,{type:'input',data:'echo wrong\r'})).rejects.toThrow();
 const original=tools.binding.bind(tools);tools.binding=async()=>{throw Error('The project folder disappeared.');};
 try{expect((await host.command(first.id,projectId,undefined,{type:'stop'})).exited).toBe(true);}finally{tools.binding=original;}
 expect((await host.read(independent.id,projectId)).exited).toBe(false);await host.command(independent.id,projectId,undefined,{type:'stop'});
},20000);
