import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe,it,expect} from 'vitest';
import {distributionManifest,assertDistributionMatches,assertContainedPath,cursorDependencyVersion,resolveCursorDistributions,assertPackagedProbe,probeCursorBootstrap} from '../scripts/verify-packaged-providers.ts';

async function cursorFixture(directory:string){
 await writeFile(join(directory,'package.json'),JSON.stringify({dependencies:{'@cursor/sdk':'1.0.38'}}));
 const sdk=join(directory,'node_modules/@cursor/sdk'),native=join(directory,'node_modules/@cursor/sdk-win32-x64');
 for(const [root,files] of [[sdk,['dist/cjs/index.js','dist/esm/index.js','dist/bundled/index.js','LICENSE.md']],[native,['bin/rg.exe','bin/cursorsandbox.exe','vendor/tree-sitter/binding.node','vendor/tree-sitter/index.js','vendor/tree-sitter/package.json','vendor/tree-sitter-bash/binding.node','vendor/tree-sitter-bash/index.js','vendor/tree-sitter-bash/node-types.json','vendor/tree-sitter-bash/package.json']]] as const){
  for(const file of files){await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),'fixture');}
 }
 await writeFile(join(sdk,'package.json'),JSON.stringify({name:'@cursor/sdk',version:'1.0.38',exports:{'.':{require:'./dist/cjs/index.js',import:'./dist/esm/index.js'}}}));
 await writeFile(join(native,'package.json'),JSON.stringify({name:'@cursor/sdk-win32-x64',version:'1.0.38'}));
 return {sdk,native};
}

describe('packaged provider custody',()=>{
 it('keeps legacy inventory explicit and rejects a declared SDK that is absent or unpinned',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'harness-package-cursor-'));
  try{
   await writeFile(join(directory,'package.json'),JSON.stringify({dependencies:{}}));
   expect(await cursorDependencyVersion(directory)).toBeUndefined();
   await writeFile(join(directory,'package.json'),JSON.stringify({dependencies:{'@cursor/sdk':'1.0.38'}}));
   expect(await cursorDependencyVersion(directory)).toBe('1.0.38');
   await expect(resolveCursorDistributions(directory)).rejects.toThrow();
   await writeFile(join(directory,'package.json'),JSON.stringify({dependencies:{'@cursor/sdk':'^1.0.38'}}));
   await expect(cursorDependencyVersion(directory)).rejects.toThrow(/pinned/i);
  }finally{await rm(directory,{recursive:true,force:true});}
 });
 it('resolves the unexported SDK manifest from its entry and refuses fake versions and missing helper assets',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'harness-package-cursor-'));
  try{
   const {sdk,native}=await cursorFixture(directory);
   expect(await resolveCursorDistributions(directory)).toMatchObject({cursorSdk:sdk,cursorNative:native,entry:join(sdk,'dist/cjs/index.js'),rg:join(native,'bin/rg.exe')});
   await writeFile(join(native,'package.json'),JSON.stringify({name:'@cursor/sdk-win32-x64',version:'0.0.0'}));
   await expect(resolveCursorDistributions(directory)).rejects.toThrow(/version/i);
   await writeFile(join(native,'package.json'),JSON.stringify({name:'@cursor/sdk-win32-x64',version:'1.0.38'}));
   await rm(join(native,'vendor/tree-sitter-bash/node-types.json'));
   await expect(resolveCursorDistributions(directory)).rejects.toThrow(/asset/i);
  }finally{await rm(directory,{recursive:true,force:true});}
 });
 it('refuses an entry-only SDK and resolved native distributions outside the target host',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'harness-package-cursor-'));
  try{
   const {sdk}=await cursorFixture(directory);
   await rm(join(sdk,'LICENSE.md'));
   await expect(resolveCursorDistributions(directory)).rejects.toThrow(/asset/i);
   await writeFile(join(sdk,'LICENSE.md'),'fixture');
   const host=join(directory,'host');await mkdir(host);await writeFile(join(host,'package.json'),'{}');
   await mkdir(join(host,'node_modules/@cursor'),{recursive:true});await symlink(sdk,join(host,'node_modules/@cursor/sdk'),process.platform==='win32'?'junction':'dir');
   await expect(resolveCursorDistributions(host)).rejects.toThrow(/outside/i);
  }finally{await rm(directory,{recursive:true,force:true});}
 });
 it('does not accept a child omitting the caller-required Cursor bootstrap or claiming authentication',()=>{
  const host=join(tmpdir(),'packaged-host'),roots={claudeSdk:join(host,'claude'),claudeNative:join(host,'claude-native'),geminiBundle:join(host,'gemini')};
  const checks=['claude-code','gemini-cli'].map(provider=>({provider,entry:join(host,provider),versionOutput:'1',elapsedMs:1,arguments:['--version'],home:join(tmpdir(),'private'),auth:false,inference:false}));
  const result={node:{path:join(host,'node.exe'),version:'24'},checks,roots};
  expect(()=>assertPackagedProbe(host,result,false)).not.toThrow();
  expect(()=>assertPackagedProbe(host,result,true)).toThrow(/unexpected/i);
  expect(()=>assertPackagedProbe(host,{...result,checks:[{...checks[0],auth:true},checks[1]]},false)).toThrow(/unexpected/i);
  const cursorRoots={...roots,cursorSdk:join(host,'cursor'),cursorNative:join(host,'cursor-native')};
  const cursor={...checks[0],provider:'cursor-sdk',entry:join(cursorRoots.cursorSdk,'dist/esm/index.js'),versionOutput:'1.0.38',arguments:[],bootstrap:{credentialStore:'empty-memory',authStatus:'logged-out',agentCreate:true,networkRequests:0,sandboxExecution:false,nativeHelper:{entry:join(cursorRoots.cursorNative,'bin/rg.exe'),versionOutput:'ripgrep 14.1.1',arguments:['--version']}}};
  expect(()=>assertPackagedProbe(host,{...result,checks:[...checks,cursor],roots:cursorRoots},true)).not.toThrow();
  expect(()=>assertPackagedProbe(host,{...result,checks:[...checks,{...cursor,bootstrap:undefined}],roots:cursorRoots},true)).toThrow(/unexpected/i);
  expect(()=>assertPackagedProbe(host,{...result,checks:[...checks,{...cursor,entry:join(host,'unrelated.js')}],roots:cursorRoots},true)).toThrow(/unexpected/i);
  expect(()=>assertPackagedProbe(host,{...result,checks:[...checks,cursor],roots:{...cursorRoots,cursorNative:join(host,'..','outside')}},true)).toThrow(/outside/i);
 });
 it('imports the actual installed SDK with an explicit empty store and runs only the stock rg version helper',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'harness-cursor-bootstrap-'));
  try{
   const result=await probeCursorBootstrap(fileURLToPath(new URL('..',import.meta.url)),process.execPath,directory);
   expect(result.check).toMatchObject({provider:'cursor-sdk',versionOutput:'1.0.38',arguments:[],auth:false,inference:false,bootstrap:{credentialStore:'empty-memory',authStatus:'logged-out',agentCreate:true,networkRequests:0,sandboxExecution:false,nativeHelper:{arguments:['--version']}}});
   expect(result.check.bootstrap.nativeHelper.versionOutput).toMatch(/^ripgrep /);
  }finally{await rm(directory,{recursive:true,force:true});}
 },45000);
 it('detects missing lazy Cursor code and changed native helper bytes in full custody manifests',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'harness-package-cursor-'));
  try{
   const {sdk,native}=await cursorFixture(directory);await writeFile(join(sdk,'dist/esm/448.index.js'),'lazy');
   const sdkBefore=await distributionManifest(sdk,{excludeNodeModules:true}),nativeBefore=await distributionManifest(native,{excludeNodeModules:true});
   await rm(join(sdk,'dist/esm/448.index.js'));await writeFile(join(native,'bin/rg.exe'),'tampered');
   const sdkAfter=await distributionManifest(sdk,{excludeNodeModules:true}),nativeAfter=await distributionManifest(native,{excludeNodeModules:true});
   expect(()=>assertDistributionMatches(sdkBefore,sdkAfter)).toThrow(/differ/i);
   expect(()=>assertDistributionMatches(nativeBefore,nativeAfter)).toThrow(/differ/i);
  }finally{await rm(directory,{recursive:true,force:true});}
 });
 it('includes lazy chunks and nested distribution assets in an ordered content manifest',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'harness-package-custody-'));
  try{
   await mkdir(join(directory,'worker'));await writeFile(join(directory,'gemini.js'),'entry');await writeFile(join(directory,'chunk-lazy.js'),'lazy');await writeFile(join(directory,'worker','policy.json'),'{}');
   const before=await distributionManifest(directory);
   expect(before.files.map(file=>file.path)).toEqual(['chunk-lazy.js','gemini.js','worker/policy.json']);
   await writeFile(join(directory,'chunk-lazy.js'),'changed');
   const after=await distributionManifest(directory);
   expect(()=>assertDistributionMatches(before,after)).toThrow(/differ/i);
  }finally{await rm(directory,{recursive:true,force:true});}
 });
 it('allows a distribution root junction while refusing nested links and escaping paths',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'harness-package-custody-'));
  try{
   await mkdir(join(directory,'real'));await writeFile(join(directory,'real','sdk.mjs'),'sdk');
   await symlink(join(directory,'real'),join(directory,'root'),process.platform==='win32'?'junction':'dir');
   expect((await distributionManifest(join(directory,'root'))).files).toHaveLength(1);
   await symlink(join(directory,'real'),join(directory,'real','nested'),process.platform==='win32'?'junction':'dir');
   await expect(distributionManifest(join(directory,'root'))).rejects.toThrow(/link/i);
   expect(()=>assertContainedPath(join(directory,'real'),join(directory,'real-other','sdk.mjs'))).toThrow(/outside/i);
  }finally{await rm(directory,{recursive:true,force:true});}
 });
 it('excludes dependency installation shape only when explicitly requested for the SDK package',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'harness-package-custody-'));
  try{
   await mkdir(join(directory,'node_modules'));await writeFile(join(directory,'sdk.mjs'),'sdk');await writeFile(join(directory,'node_modules','dependency'),'different installation shape');
   expect((await distributionManifest(directory,{excludeNodeModules:true})).files.map(file=>file.path)).toEqual(['sdk.mjs']);
   expect((await distributionManifest(directory)).files).toHaveLength(2);
  }finally{await rm(directory,{recursive:true,force:true});}
 });
});
