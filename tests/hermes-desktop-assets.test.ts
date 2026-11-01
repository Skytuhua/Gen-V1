import {afterEach,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {collectHermesPayload,stageHermesPayload,verifyHermesPayload,type HermesPython} from '../scripts/hermes-assets.ts';
import {REQUIRED_RUNTIME_FILES,runtimeSourceAllowed} from '../scripts/desktop-assets.ts';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'hermes-payload-'));roots.push(root);
 const file=async(path:string,body='fixture bytes')=>{await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),body);};
 const source='print("original fixture")\n',requirements='fixture-dep==1.0\n',metadata='Name: fixture-dep\nVersion: 1.0\n';
 const third='third-party/hermes-agent';
 await file(third+'/LICENSE','MIT fixture notice');await file(third+'/runtime-requirements.txt',requirements);
 await file(third+'/RUNTIME_DEPENDENCIES.json',JSON.stringify({python:'CPython >=3.14,<3.15',sourceCommit:'c627ec84664d43e0b18b95d9d86d8963747d56c7',requirementsSha256:sha(requirements),distributionCount:1,distributions:[{name:'fixture-dep',version:'1.0'}]}));
 await file(third+'/UPSTREAM_MANIFEST.json',JSON.stringify({commit:'c627ec84664d43e0b18b95d9d86d8963747d56c7',files:[{path:'run_agent.py',bytes:Buffer.byteLength(source),sha256:sha(source),gitBlob:createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0').update(source).digest('hex')}]}));
 await file(third+'/upstream/run_agent.py',source);await file('packages/runtime-hermes/worker.py','print("worker")\n');
 for(const path of ['python.exe','python3.dll','python314.dll','vcruntime140.dll','LICENSE.txt','Lib/os.py','Lib/encodings/__init__.py','DLLs/_ssl.pyd'])await file('python/'+path);
 for(const path of ['Lib/test/test_ssl.py','Lib/unittest/test/test_case.py','Lib/site-packages/private.py','Lib/ensurepip/__init__.py','Lib/__pycache__/os.pyc','DLLs/_testcapi.pyd','Scripts/pip.exe','Doc/manual.html'])await file('python/'+path,'omit');
 await file('.harness-hermes-python-deps/fixture_dep/__init__.py');await file('.harness-hermes-python-deps/fixture_dep-1.0.dist-info/METADATA',metadata);await file('.harness-hermes-python-deps/fixture_dep-1.0.dist-info/licenses/LICENSE','dependency notice');await file('.harness-hermes-python-deps/fixture_dep/__pycache__/cached.pyc','omit');
 const python:HermesPython={directory:join(root,'python'),version:[3,14,3],implementation:'cpython',platform:'win32',bits:64,machine:'AMD64'};
 return{root,file,python,third};
}

it('admits only the exact Hermes Python worker and requires its packaged runtime',()=>{
 expect(runtimeSourceAllowed('packages/runtime-hermes/worker.py')).toBe(true);expect(runtimeSourceAllowed('packages/runtime-hermes/private.py')).toBe(false);
 for(const path of ['host/packages/runtime-hermes/worker.py','host/hermes-python/python.exe','host/hermes-python/python314._pth','host/.harness-hermes-python-deps/openai/__init__.py','host/third-party/hermes-agent/upstream/run_agent.py'])expect(REQUIRED_RUNTIME_FILES).toContain(path);
});
it('selects a bounded relocatable runtime without caches, development installs or unrelated Python data',async()=>{
 const x=await fixture(),payload=await collectHermesPayload(x.root,x.python),targets=payload.files.map(file=>file.path);
 expect(targets).toContain('hermes-python/DLLs/_ssl.pyd');expect(targets).toContain('.harness-hermes-python-deps/fixture_dep-1.0.dist-info/licenses/LICENSE');expect(targets).toContain('third-party/hermes-agent/upstream/run_agent.py');
 expect(targets.some(path=>/pycache|site-packages|\/test\/|_testcapi|ensurepip|Scripts|\/Doc\//.test(path))).toBe(false);
 expect(payload.files.find(file=>file.path==='hermes-python/python314._pth')?.content).toBe('.\nLib\nDLLs\n');
 const host=join(x.root,'host');await stageHermesPayload(host,payload);await verifyHermesPayload(host,payload);expect(await readFile(join(host,'hermes-python/python314._pth'),'utf8')).toBe('.\nLib\nDLLs\n');
 await writeFile(join(host,'hermes-python/python314.dll'),'changed');await expect(verifyHermesPayload(host,payload)).rejects.toThrow(/checksum|changed/i);
});
it.each([{version:[3,13,9]},{bits:32},{implementation:'pypy'},{platform:'linux'},{machine:'ARM64'}])('refuses an unsupported Python runtime before staging: %j',async(change)=>{
 const x=await fixture();await expect(collectHermesPayload(x.root,{...x.python,...change} as HermesPython)).rejects.toThrow(/CPython 3.14|Windows x64/);
});
it('rejects missing runtime files, mismatched source bytes and changed dependencies',async()=>{
 const x=await fixture();await rm(join(x.python.directory,'python314.dll'));await expect(collectHermesPayload(x.root,x.python)).rejects.toThrow(/python314.dll/);await x.file('python/python314.dll');
 await x.file(x.third+'/upstream/run_agent.py','changed');await expect(collectHermesPayload(x.root,x.python)).rejects.toThrow(/checksum|custody/i);await x.file(x.third+'/upstream/run_agent.py','print("original fixture")\n');
 await x.file('.harness-hermes-python-deps/fixture_dep-1.0.dist-info/METADATA','Name: fixture-dep\nVersion: 2.0\n');await expect(collectHermesPayload(x.root,x.python)).rejects.toThrow(/dependency.*lock|locked.*dependenc/i);
});
it('refuses redirected input trees and refuses source drift after the payload was planned',async()=>{
 const x=await fixture(),payload=await collectHermesPayload(x.root,x.python);await x.file('python/Lib/os.py','changed after preflight');await expect(stageHermesPayload(join(x.root,'stage'),payload)).rejects.toThrow(/changed|checksum/i);
 await mkdir(join(x.root,'outside'));await symlink(join(x.root,'outside'),join(x.root,'.harness-hermes-python-deps/redirect'),process.platform==='win32'?'junction':'dir');await expect(collectHermesPayload(x.root,x.python)).rejects.toThrow(/link|ordinary/i);
});
