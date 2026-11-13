import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Store} from '../packages/storage/store.ts';
import {ProjectTools} from '../packages/workspace/tools.ts';
import {TerminalHost} from '../packages/workspace/terminal.ts';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';
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
it.skipIf(process.platform!=='win32')('releases native helpers after a terminal exits naturally while retaining its output',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'gen-pty-natural-exit-'));await mkdir(join(directory,'project'));
 const program=String.raw`
  import assert from 'node:assert/strict';
  import {join} from 'node:path';
  import {Store} from ${JSON.stringify(new URL('../packages/storage/store.ts',import.meta.url).href)};
  import {ProjectTools} from ${JSON.stringify(new URL('../packages/workspace/tools.ts',import.meta.url).href)};
  import {TerminalHost} from ${JSON.stringify(new URL('../packages/workspace/terminal.ts',import.meta.url).href)};
  // node-pty's conpty pipe can throw writeAfterFIN asynchronously when the
  // child exits naturally; it is internal socket noise outside the host's
  // contract, so only that code is tolerated here.
  process.on('uncaughtException',error=>{if((error&&error.code)!=='EPIPE')throw error;});
  const directory=process.argv[2],store=new Store(join(directory,'data')),tools=new ProjectTools(store),host=new TerminalHost(tools);
  try{
   const receipt=await tools.connect({id:'connect',type:'workspace.project.connect',payload:{name:'Natural exit fixture',path:join(directory,'project')}});
   const projectId=receipt.result.projects[0].id,opened=await host.open({projectId,terminalId:'natural',program:process.execPath,args:['-e',"process.stdout.write('GEN_NATURAL_OUTPUT\\n')"]});
   let state=opened;const deadline=Date.now()+10000;
   while(!state.exited&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,25));state=await host.read(opened.id,projectId);}
   assert.equal(state.exited,true);assert.equal(state.exitCode,0);assert.ok(state.output.includes('GEN_NATURAL_OUTPUT'));
   const cursor=state.cursor;assert.equal((await host.read(opened.id,projectId,undefined,cursor)).output,'');
   await host.dispose();const retained=await host.read(opened.id,projectId);assert.equal(retained.output,state.output);assert.equal(retained.cursor,cursor);
   console.log('GEN_TERMINAL_NATURAL_EXIT_OK');
  }finally{await host.dispose();await tools.dispose();store.close();}
 `;
 const fixture=join(directory,'natural-terminal.mjs');await writeFile(fixture,program);
 const child=spawn(process.execPath,['--import',pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,fixture,directory],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',timer:ReturnType<typeof setTimeout>|undefined;child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
 const closed=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 try{
  const result=await Promise.race([closed,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Native terminal helpers kept the disposed host alive.')),15000);})]);
  expect(result,`child stdout:\n${stdout}\nchild stderr:\n${stderr}`).toEqual({code:0,signal:null});expect(stdout).toContain('GEN_TERMINAL_NATURAL_EXIT_OK');expect(stderr).not.toContain('AttachConsole failed');
 }finally{clearTimeout(timer);await terminateProcessTree(child);await rm(directory,{recursive:true,force:true,maxRetries:5});}
},25000);
