import {afterEach,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,rename,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {chromium,expect as browserExpect} from '@playwright/test';
import {trustedPluginManifest} from './fixtures/trusted-plugin-frame.ts';

const repository=resolve('.'),directories:string[]=[],children:ChildProcess[]=[];
function signal(child:ChildProcess,value:'SIGINT'|'SIGTERM'){
  if(process.platform==='win32')child.send(value);else child.kill(value);
}
afterEach(async()=>{
  for(const child of children.splice(0))if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');signal(child,'SIGTERM');await exited;}
  await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200})));
});

async function scratch(brokenRuntime=false){
  const directory=await mkdtemp(join(tmpdir(),'gen-dev-plugin-runtime-'));directories.push(directory);
  await mkdir(join(directory,'scripts'));
  for(const name of ['dev.mjs','build-widgets.mjs','build-plugin-runtime.mjs'])await cp(join(repository,'scripts',name),join(directory,'scripts',name));
  await cp(join(repository,'package.json'),join(directory,'package.json'));
  for(const name of ['node_modules','packages'])await symlink(join(repository,name),join(directory,name),'junction');
  if(brokenRuntime){
    await mkdir(join(directory,'apps/web/src'),{recursive:true});
    await writeFile(join(directory,'apps/web/src/plugin-runtime.tsx'),"import './missing-owned-build-failure-control';");
  }else await symlink(join(repository,'apps'),join(directory,'apps'),'junction');
  // Instrument only the fixed child-launch boundary. The real startup and
  // prerequisite builders run unchanged, with all output confined to scratch.
  await writeFile(join(directory,'launch-probe.mjs'),`
    import childProcess from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    import {appendFileSync,statSync} from 'node:fs';
    // Windows kill() terminates immediately. Deliver fixture signals over IPC
    // so the real launcher and fixture handlers execute their cleanup paths.
    if(process.platform==='win32')process.on('message',signal=>{
      if((signal==='SIGINT'||signal==='SIGTERM')&&!process.emit(signal))process.exit(1);
    });
    const spawn=childProcess.spawn;
    childProcess.spawn=(command,args,options)=>{
      const kind=args[0]==='--import'&&args[1]==='tsx'&&args[2]==='apps/server/main.ts'?'server':args[0]==='node_modules/vite/bin/vite.js'?'vite':null;
      if(!kind)return spawn(command,args,options);
      const assets=['dist/widget-runtime/worker.js','dist/widget-runtime/receiver.js','dist/plugin-runtime/runtime.js','dist/plugin-runtime/runtime.css'].map(path=>{try{return statSync(path).size;}catch{return 0;}});
      appendFileSync('launches.jsonl',JSON.stringify({kind,args,dev:options.env?.HARNESS_DEV,nodeEnv:(options.env??process.env).NODE_ENV,assets})+'\\n');
      const fixtureArgs=kind==='server'?['--import','tsx',${JSON.stringify(join(repository,'tests/fixtures/dev-plugin-runtime-host.ts'))}]:['--eval',"require('node:fs').appendFileSync('vite-started.log','started');setInterval(()=>{},1000);process.on('SIGTERM',()=>{require('node:fs').appendFileSync('stopped.log','vite\\\\n');process.exit(0);});"];
      if(process.platform==='win32')fixtureArgs.unshift('--import',import.meta.url);
      const child=spawn(command,fixtureArgs,process.platform==='win32'?{...options,stdio:['inherit','inherit','inherit','ipc']}:options);
      if(process.platform==='win32')child.kill=(signal='SIGTERM')=>{if(!child.connected)return false;child.send(signal);return true;};
      return child;
    };
    syncBuiltinESMExports();
  `);
  return directory;
}

function run(directory:string,dev=true){
  const args=dev?['--import',pathToFileURL(join(directory,'launch-probe.mjs')).href,'scripts/dev.mjs']:['--import','tsx',join(repository,'tests/fixtures/dev-plugin-runtime-host.ts')];
  if(process.platform==='win32'&&!dev)args.unshift('--import',pathToFileURL(join(directory,'launch-probe.mjs')).href);
  const child=spawn(process.execPath,args,{cwd:directory,env:{...process.env,NODE_ENV:'development'},stdio:process.platform==='win32'?['ignore','pipe','pipe','ipc']:['ignore','pipe','pipe']});children.push(child);
  let output='';child.stdout!.on('data',chunk=>{output+=chunk;});child.stderr!.on('data',chunk=>{output+=chunk;});
  return {child,output:()=>output};
}

async function originOf(startup:ReturnType<typeof run>){
  return new Promise<string>((resolve,reject)=>{
    const check=()=>{const origin=startup.output().match(/GEN_DEV_FIXTURE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/)?.[1];if(origin){cleanup();resolve(origin);}};
    const failed=()=>{cleanup();reject(Error(startup.output()));};
    const timer=setTimeout(failed,60000);
    const cleanup=()=>{clearTimeout(timer);startup.child.stdout!.off('data',check);startup.child.off('exit',failed);};
    startup.child.stdout!.on('data',check);startup.child.once('exit',failed);check();
  });
}

it('returns 503 for fixed runtime routes in a source-only checkout',async()=>{
  const directory=await scratch();
  // Runtime assets resolve beside the server module, so simulate a source-only
  // checkout by hiding the built runtime for the duration of the assertions.
  const runtimeDir=join(repository,'dist/plugin-runtime'),hidden=join(repository,'dist/plugin-runtime.hidden-by-test');
  const built=await stat(runtimeDir).then(()=>true).catch(()=>false);
  if(built)await rename(runtimeDir,hidden);
  try {
    const host=run(directory,false),origin=await originOf(host);
    for(const asset of ['runtime.js','runtime.css']){
      expect((await fetch(`${origin}/plugin-runtime/${asset}`)).status).toBe(503);
    }
  } finally {if(built)await rename(hidden,runtimeDir);}
});

it('prepares widgets and shared runtime before dev children, serves the trusted frame, and closes owned children',async()=>{
  const directory=await scratch();
  const parent=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PluginFrame} from './apps/web/src/PluginFrame.tsx';createRoot(document.getElementById('root')).render(<PluginFrame plugin={${JSON.stringify(trustedPluginManifest)}} theme="dark" onReady={()=>{document.body.dataset.ready='true';}}/>);`,resolveDir:repository,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':JSON.stringify('production')},loader:{'.css':'empty'}});
  await writeFile(join(directory,'parent.js'),parent.outputFiles[0].contents);
  const dev=run(directory),origin=await originOf(dev);
  const launches=(await readFile(join(directory,'launches.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as {kind:string;dev?:string;nodeEnv:string;assets:number[]});
  expect(launches.map(launch=>launch.kind)).toEqual(['server','vite']);
  expect(launches[0].dev).toBe('1');
  expect(launches.map(launch=>launch.nodeEnv)).toEqual(['development','development']);
  const responses=[];
  for(const asset of ['runtime.js','runtime.css']){
    const response=await fetch(`${origin}/plugin-runtime/${asset}`);
    responses.push({status:response.status,bytes:(await response.text()).length});
  }
  expect(responses.map(response=>response.status)).toEqual([200,200]);
  for(const response of responses)expect(response.bytes).toBeGreaterThan(0);
  for(const launch of launches)expect(launch.assets.every(bytes=>bytes>0),`${launch.kind} launched before widget/runtime assets existed`).toBe(true);
  const response=await fetch(`${origin}/plugins/sample-plugin/frame?session=fixture&theme=dark`);
  expect(response.status).toBe(200);expect(await response.text()).toContain('/plugin-runtime/runtime.js');
  const browser=await chromium.launch({headless:true,...(process.env.GEN_TEST_CHROMIUM_EXECUTABLE?{executablePath:process.env.GEN_TEST_CHROMIUM_EXECUTABLE}:{})});
  try{
    const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);
    await browserExpect(page.locator('body')).toHaveAttribute('data-ready','true');
    await browserExpect(page.frameLocator('iframe').locator('#result')).toHaveText('owner-only');
    expect(errors).toEqual([]);
  }finally{await browser.close();}
  // Wait until both fixture children have installed their signal handlers.
  await expect.poll(()=>readFile(join(directory,'vite-started.log'),'utf8')).toBe('started');
  const exited=once(dev.child,'exit');signal(dev.child,'SIGINT');expect((await exited)[0]).toBe(0);
  await expect.poll(async()=>(await readFile(join(directory,'stopped.log'),'utf8')).trim().split('\n').sort()).toEqual(['server','vite']);
},90000);

it('does not launch development children when the shared runtime build fails',async()=>{
  const directory=await scratch(true),dev=run(directory);
  const exited=once(dev.child,'exit');
  const [code]=await exited;
  expect(code).not.toBe(0);expect(dev.output()).toContain('missing-owned-build-failure-control');
  await expect(readFile(join(directory,'launches.jsonl'))).rejects.toMatchObject({code:'ENOENT'});
  await expect(stat(join(directory,'dist/plugin-runtime/runtime.js'))).rejects.toMatchObject({code:'ENOENT'});
  expect((await stat(join(directory,'dist/widget-runtime/worker.js'))).size).toBeGreaterThan(0);
},60000);
