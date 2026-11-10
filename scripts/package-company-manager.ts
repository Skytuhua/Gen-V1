import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {copyFile,lstat,mkdir,readFile,readdir,readlink,realpath,writeFile,chmod} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const MANAGER_PINS={
  node:{version:'24.22.2',sha256:'48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75'},
  python:{version:'3.14.10',sha256:'4d3c16c59ed0802a3d1d34d8bce504b15ceeaff39d62dadecc6a9fa803412aed',release:'20261026'},
  uv:{version:'0.13.5',sha256:'f68d291c75783122dad58ab77def0e13f3233f358731db5d6d7e8715603b928f'},
  pnpm:{version:'10.30.3',sha256:'ff0a72140f6a6d66c0b284f6c9560aff605518e28c29aeac25fb262b74331588'},
  hermesCommit:'c627ec84664d43e0b18b95d9d86d8963747d56c7',provider:'openai-codex',model:'gpt-6.1-sol',thinking:'max',
} as const;
export const MANAGER_NPM_ROOTS={
  '@earendil-works/pi-coding-agent':'1.4.0','@modelcontextprotocol/sdk':'1.32.2','@sinclair/typebox':'0.34.41',
  ajv:'8.18.0',esbuild:'0.25.12',fastify:'5.12.7',tsx:'4.20.6',zod:'4.6.6',
} as const;
export const REQUIRED_MANAGER_FILES=[
  'runtime/bin/node','hermes-python/bin/python3.14','apps/server/company-manager-main.ts','apps/server/company-lifecycle.ts',
  'apps/server/company-manager-host.ts','packages/company-manager/runtime.ts','packages/company-manager/journal.ts',
  'packages/core/linux-path-guard.ts','packages/core/linux-path-guard.py',
  'packages/runtime-hermes/index.ts','packages/runtime-hermes/client.ts','packages/runtime-hermes/worker.py',
  'packages/runtime-pi/worker.ts','third-party/hermes-agent/upstream/run_agent.py',
  'third-party/hermes-agent/UPSTREAM_MANIFEST.json','third-party/hermes-agent/RUNTIME_DEPENDENCIES.json',
  'node_modules/tsx/dist/loader.mjs','node_modules/@earendil-works/pi-coding-agent/package.json',
  'node_modules/@earendil-works/pi-ai/package.json','node_modules/@esbuild/linux-x64/bin/esbuild',
] as const;
type Project={version:string;packageManager:string;dependencies:Record<string,string>;devDependencies?:Record<string,string>;pnpm:{overrides:Record<string,string>}};
type LockEntry={specifier:string;version:string};
type Lock={importers:Record<string,{dependencies?:Record<string,LockEntry>;devDependencies?:Record<string,LockEntry>}>;[key:string]:unknown};
export function selectManagerNpmInputs(project:Project,lock:Lock){
  const importer=lock.importers['.'],selected:Record<string,LockEntry>={};
  if(!importer||project.packageManager!=='pnpm@'+MANAGER_PINS.pnpm.version)throw Error('Pinned manager package-manager/lock missing');
  for(const [name,pin] of Object.entries(MANAGER_NPM_ROOTS)){
    if((project.dependencies[name]??project.devDependencies?.[name])!==pin)throw Error('Manager dependency pin changed: '+name);
    const entry=importer.dependencies?.[name]??importer.devDependencies?.[name];
    if(!entry||entry.specifier!==pin||!new RegExp('^'+pin.replaceAll('.','\\.')+'(?:\\(|$)').test(entry.version))throw Error('Manager lock entry changed: '+name);
    selected[name]=structuredClone(entry);
  }
  return {pkg:{name:'gen-v1-company-manager',version:project.version,private:true,type:'module',packageManager:project.packageManager,
    engines:{node:MANAGER_PINS.node.version},dependencies:{...MANAGER_NPM_ROOTS},pnpm:structuredClone(project.pnpm)},
    lock:{...structuredClone(lock),importers:{'.':{dependencies:selected}}}};
}
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export function validateManagerArchive(name:'node'|'python'|'uv'|'pnpm',bytes:Uint8Array){if(sha(bytes)!==MANAGER_PINS[name].sha256)throw Error('Manager '+name+' archive checksum mismatch');}
const inside=(root:string,path:string)=>{const part=relative(root,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('../')&&!part.startsWith('..\\');};
async function bytes(path:string,limit=16*1024*1024){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>limit)throw Error('Invalid bounded package input: '+path);const data=await readFile(path);if(data.length!==info.size)throw Error('Changing package input');return data;}
async function run(file:string,args:string[],cwd:string,env:NodeJS.ProcessEnv=process.env){
  await new Promise<void>((done,reject)=>{const child=spawn(file,args,{cwd,env,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?done():reject(Error(file+' exited '+code)));});
}

/** Public source/dependency build inputs only; never copies an account, profile or credential. */
export async function prepareCompanyManager(root:string,target:string,webRoot:string,downloads:Record<'node'|'python'|'uv'|'pnpm',string>){
  root=await realpath(root);target=resolve(target);
  if(inside(root,target))throw Error('Manager staging must be outside source');
  const project=JSON.parse((await bytes(join(root,'package.json'))).toString()) as Project;
  const sdkRequire=createRequire(join(await realpath(join(root,'node_modules/@earendil-works/pi-coding-agent')),'package.json'));
  const yaml=sdkRequire('yaml') as {parse(text:string):Lock;stringify(value:unknown):string};
  const selected=selectManagerNpmInputs(project,yaml.parse((await bytes(join(root,'pnpm-lock.yaml'))).toString()));
  await bytes(join(root,'apps/server/company-manager-main.ts'));
  await mkdir(target);await mkdir(join(target,'archives'));
  for(const name of ['node','python','uv','pnpm'] as const){const data=await bytes(downloads[name],100*1024*1024);validateManagerArchive(name,data);await writeFile(join(target,'archives',name+'.tar'),data,{flag:'wx'});}
  const {runtimeSourceAllowed}=await import('./desktop-assets.ts');
  const source:{path:string;bytes:number;sha256:string}[]=[];
  async function add(part:string,expected?:{sha256:string;bytes:number}){
    if(!part||part.includes('\\')||part.split('/').some(p=>!p||p==='.'||p==='..'||/[\r\n]/.test(p))||!inside(root,resolve(root,part)))throw Error('Invalid source path');
    const data=await bytes(join(root,part));
    if(expected&&(data.length!==expected.bytes||sha(data)!==expected.sha256))throw Error('Pinned Hermes source changed: '+part);
    source.push({path:part,bytes:data.length,sha256:sha(data)});
  }
  async function walk(path:string,part:string){for(const entry of await readdir(path,{withFileTypes:true})){
    if(entry.name.startsWith('.')||['node_modules','tests','fixtures'].includes(entry.name))continue;
    if(entry.isSymbolicLink())throw Error('Source links forbidden');
    const next=part+'/'+entry.name;if(entry.isDirectory())await walk(join(path,entry.name),next);else if(runtimeSourceAllowed(next))await add(next);
  }}
  await walk(join(root,'apps/server'),'apps/server');await walk(join(root,'packages'),'packages');
  const upstream=JSON.parse((await bytes(join(root,'third-party/hermes-agent/UPSTREAM_MANIFEST.json'))).toString());
  const pythonLock=JSON.parse((await bytes(join(root,'third-party/hermes-agent/RUNTIME_DEPENDENCIES.json'))).toString());
  if(upstream.commit!==MANAGER_PINS.hermesCommit||pythonLock.sourceCommit!==MANAGER_PINS.hermesCommit||pythonLock.python!=='CPython >=3.14,<3.15')throw Error('Hermes engine/Python pin changed');
  const requirements=await bytes(join(root,'third-party/hermes-agent/runtime-requirements.txt'));
  if(sha(requirements)!==pythonLock.requirementsSha256)throw Error('Hermes requirements hash mismatch');
  for(const file of upstream.files)await add('third-party/hermes-agent/upstream/'+file.path,file);
  for(const name of ['LICENSE','runtime-requirements.txt','RUNTIME_DEPENDENCIES.json','UPSTREAM_MANIFEST.json'])await add('third-party/hermes-agent/'+name);
  await add('third-party/t3code/LICENSE');await add('LICENSE');
  const list=source.map(file=>file.path).sort();if(new Set(list).size!==list.length)throw Error('Duplicate source input');
  await writeFile(join(target,'source-files.txt'),list.join('\n')+'\n',{flag:'wx'});
  await run('tar',['-czf',join(target,'source.tar.gz'),'-C',root,'-T',join(target,'source-files.txt')],root);
  for(const item of source)if(sha(await bytes(join(root,item.path)))!==item.sha256)throw Error('Source changed while staging');
  await run('tar',['-czf',join(target,'web.tar.gz'),'-C',resolve(webRoot),'.'],root);
  await writeFile(join(target,'package.json'),JSON.stringify(selected.pkg,null,2)+'\n',{flag:'wx'});
  await writeFile(join(target,'pnpm-lock.yaml'),yaml.stringify(selected.lock),{flag:'wx'});
  await writeFile(join(target,'.npmrc'),'node-linker=hoisted\npackage-import-method=copy\n',{flag:'wx'});
  await copyFile(join(root,'scripts/company-host/start-manager.sh'),join(target,'start-manager.sh'));
  const {transform}=await import('esbuild');
  const self=await bytes(fileURLToPath(import.meta.url));
  await writeFile(join(target,'build-manager.mjs'),(await transform(self.toString(),{loader:'ts',format:'esm',target:'node24'})).code,{flag:'wx'});
  const inputs=['source.tar.gz','web.tar.gz','package.json','pnpm-lock.yaml','.npmrc','start-manager.sh','build-manager.mjs'];
  await writeFile(join(target,'inputs.json'),JSON.stringify({version:project.version,pins:MANAGER_PINS,source,pythonDistributions:pythonLock.distributions,
    files:await Promise.all(inputs.map(async path=>({path,sha256:sha(await bytes(join(target,path),100*1024*1024))})))},null,2)+'\n',{flag:'wx'});
  return {inputs:target,sourceFiles:source.length,pythonDistributions:pythonLock.distributionCount};
}

/** Runs only on a native Linux filesystem using previously verified public inputs. */
export async function buildCompanyManager(input:string,work:string,output:string){
  if(process.platform!=='linux'||process.arch!=='x64'||process.version!=='v'+MANAGER_PINS.node.version)throw Error('Use pinned Node on Linux x64');
  input=resolve(input);work=resolve(work);output=resolve(output);
  if(work.startsWith('/mnt/')||inside(input,work)||inside(work,output))throw Error('Use separate native Linux work and external archive paths');
  try{await lstat(output);throw Error('Manager archive already exists');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const meta=JSON.parse((await bytes(join(input,'inputs.json'))).toString());
  if(!/^\d+\.\d+\.\d+$/.test(meta.version)||JSON.stringify(meta.pins)!==JSON.stringify(MANAGER_PINS))throw Error('Manager input pin mismatch');
  for(const file of meta.files)if(sha(await bytes(join(input,file.path),100*1024*1024))!==file.sha256)throw Error('Manager build input changed');
  for(const name of ['node','python','uv','pnpm'] as const)validateManagerArchive(name,await bytes(join(input,'archives',name+'.tar'),100*1024*1024));
  await mkdir(work);const pkg=join(work,'gen-v1-company-manager-'+meta.version+'-linux-x64');await mkdir(pkg);
  const tools=join(work,'build-tools'),home=join(work,'build-home');await mkdir(tools);await mkdir(home,{mode:0o700});
  const env:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin',HOME:home,LANG:'C.UTF-8',CI:'true',UV_NO_CONFIG:'1',UV_NO_PROGRESS:'1',UV_PYTHON_DOWNLOADS:'never',UV_LINK_MODE:'copy',UV_CACHE_DIR:join(work,'uv-cache'),npm_config_userconfig:join(home,'empty.npmrc'),npm_config_globalconfig:join(home,'empty-global.npmrc'),PNPM_HOME:join(home,'pnpm'),PNPM_DISABLE_SELF_UPDATE_CHECK:'1'};
  await writeFile(env.npm_config_userconfig!,'');await writeFile(env.npm_config_globalconfig!,'');
  await run('tar',['-xzf',join(input,'source.tar.gz'),'-C',pkg],work,env);
  for(const name of ['runtime','hermes-python','dist/web','bin'])await mkdir(join(pkg,name),{recursive:true});
  await run('tar',['-xJf',join(input,'archives/node.tar'),'-C',join(pkg,'runtime'),'--strip-components=1','node-v24.22.2-linux-x64/bin/node','node-v24.22.2-linux-x64/LICENSE'],work,env);
  await run('tar',['-xzf',join(input,'archives/python.tar'),'-C',join(pkg,'hermes-python'),'--strip-components=1'],work,env);
  for(const name of ['uv','pnpm']){await mkdir(join(tools,name));await run('tar',['-xzf',join(input,'archives',name+'.tar'),'-C',join(tools,name),'--strip-components=1'],work,env);}
  for(const name of ['package.json','pnpm-lock.yaml','.npmrc'])await copyFile(join(input,name),join(pkg,name));
  const node=join(pkg,'runtime/bin/node'),python=join(pkg,'hermes-python/bin/python3.14');env.PATH=join(pkg,'runtime/bin')+':'+env.PATH;
  await run(node,[join(tools,'pnpm/bin/pnpm.cjs'),'install','--prod','--frozen-lockfile','--ignore-scripts','--ignore-workspace','--store-dir',join(work,'pnpm-store')],pkg,env);
  await run(join(tools,'uv/uv'),['--no-config','pip','install','--python',python,'--target',join(pkg,'.harness-hermes-python-deps'),'--no-deps','--only-binary',':all:','-r',join(pkg,'third-party/hermes-agent/runtime-requirements.txt')],pkg,env);
  await run('tar',['-xzf',join(input,'web.tar.gz'),'-C',join(pkg,'dist/web')],work,env);
  await copyFile(join(input,'start-manager.sh'),join(pkg,'bin/start-manager.sh'));await chmod(join(pkg,'bin/start-manager.sh'),0o700);
  for(const path of REQUIRED_MANAGER_FILES){const info=await lstat(join(pkg,path));if(!info.isFile()&&!info.isSymbolicLink())throw Error('Required manager runtime missing: '+path);}
  for(const item of meta.source)if(sha(await bytes(join(pkg,item.path)))!==item.sha256)throw Error('Staged original source changed: '+item.path);
  for(const [name,version]of Object.entries(MANAGER_NPM_ROOTS)){const info=JSON.parse((await bytes(join(pkg,'node_modules',name,'package.json'))).toString());if(info.version!==version)throw Error('Installed version mismatch: '+name);}
  const files:Record<string,unknown>[]=[];
  async function inventory(path:string){for(const entry of await readdir(path,{withFileTypes:true})){
    const next=join(path,entry.name),part=relative(pkg,next);
    if(entry.isSymbolicLink()){const link=await readlink(next);if(isAbsolute(link)||!inside(pkg,await realpath(next)))throw Error('Runtime link escapes package: '+part);files.push({path:part,link});}
    else if(entry.isDirectory())await inventory(next);
    else{const data=await bytes(next,150*1024*1024);files.push({path:part,bytes:data.length,sha256:sha(data)});}
    if(files.length>150000)throw Error('Manager runtime file limit');
  }}await inventory(pkg);
  await writeFile(join(pkg,'manager-manifest.json'),JSON.stringify({component:'Gen company manager runtime',version:meta.version,pins:MANAGER_PINS,
    entry:'apps/server/company-manager-main.ts',composition:'launchCompanyManagerHost with no authority by default',authorityInstalled:false,
    source:meta.source,pythonDistributions:meta.pythonDistributions,files},null,2)+'\n',{flag:'wx'});
  await mkdir(dirname(output),{recursive:true});await run('tar',['-czf',output,'-C',work,pkg.slice(work.length+1)],work,env);
  const outputHash=sha(await bytes(output,1024*1024*1024));await writeFile(output+'.sha256',outputHash+'  '+output.split('/').at(-1)+'\n',{flag:'wx'});
  return {directory:pkg,archive:output,sha256:outputHash,files:files.length};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [mode,...args]=process.argv.slice(2);
  if(mode==='prepare'&&args.length===4)console.log(JSON.stringify(await prepareCompanyManager(resolve(args[0]),resolve(args[1]),resolve(args[2]),JSON.parse((await bytes(resolve(args[3]))).toString()))));
  else if(mode==='build'&&args.length===3)console.log(JSON.stringify(await buildCompanyManager(args[0],args[1],args[2])));
  else throw Error('Usage: package-company-manager.ts prepare <source> <new-inputs> <web> <downloads.json> OR compiled-builder build <inputs> <new-native-work> <archive>');
}
