import assert from 'node:assert/strict';
import {mkdir,rename,readFile,writeFile,symlink,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const source=process.argv[2],root=process.env.HARNESS_COMPANY_DATA_DIR;
const moduleAt=part=>import(pathToFileURL(join(source,part)).href);
const {withPathGuard}=await moduleAt('packages/core/file-access.ts');
if(process.argv[3]==='unprotected'){
 let entered=false;
 await assert.rejects(withPathGuard([{path:source,leaf:false}],new AbortController().signal,async()=>{entered=true;}),{code:'CAPABILITY_DENIED'});
 assert.equal(entered,false);console.log(JSON.stringify({scope:'UNPROTECTED_LINUX',denied:true,actionEntered:false}));process.exit(0);
}
const {HermesClient}=await moduleAt('packages/runtime-hermes/client.ts');
const {withAccountProfile,accountProfileRoot}=await moduleAt('packages/runtime/account-profile.ts');
const {createLiteralCredentialStore}=await moduleAt('packages/runtime-pi/credentials.ts');
const {taskPaths,openTaskSession}=await moduleAt('packages/runtime-pi/session.ts');
const signal=new AbortController().signal;
const directory=join(root,'ordinary');await mkdir(directory,{mode:0o700,recursive:true});
await withPathGuard([{path:directory,leaf:false,allowChildWrites:true,childWriteRoot:root}],signal,async()=>{
 await assert.rejects(rename(directory,directory+'-moved'),{code:'EBUSY'});
 const escape=spawnSync('/usr/bin/unshare',['--user','--map-root-user','--mount','/bin/umount',directory],{encoding:'utf8'});
 assert.notEqual(escape.status,0);
 await assert.rejects(rename(directory,directory+'-moved'),{code:'EBUSY'});
 await withPathGuard([{path:directory,leaf:false}],signal,async()=>{
  await writeFile(join(directory,'save.tmp'),'ordinary');await rename(join(directory,'save.tmp'),join(directory,'save.txt'));
 });
 await assert.rejects(rename(directory,directory+'-moved'),{code:'EBUSY'});
 assert.equal(await readFile(join(directory,'save.txt'),'utf8'),'ordinary');
 await assert.rejects(readFile('/proc/self/fd/4/ordinary/save.txt'),{code:'EACCES'});
});
await rename(directory,directory+'-moved');await rename(directory+'-moved',directory);
let entered=false;
await assert.rejects(withPathGuard([{path:'/etc',leaf:false}],signal,async()=>{entered=true;}),{code:'CAPABILITY_DENIED'});assert.equal(entered,false);
await symlink(directory,join(root,'redirect'));
await assert.rejects(withPathGuard([{path:join(root,'redirect'),leaf:false}],signal,async()=>{entered=true;}),{code:'CAPABILITY_DENIED'});await unlink(join(root,'redirect'));
await assert.rejects(withPathGuard([{path:join(directory,'save.txt'),leaf:true}],signal,async()=>{}),{code:'CAPABILITY_DENIED'});

const parent=join(root,'engine');await mkdir(parent,{mode:0o700,recursive:true});
const client=new HermesClient({home:join(parent,'home'),timeoutMs:10000});
let hello;
try{
 hello=await client.request('hello',{home:join(parent,'home'),acpCommand:process.execPath,acpArgs:[],integrations:{enabled:[],ponytailMode:'off'}});
 assert.equal(hello.engineClass,'run_agent.AIAgent');assert.equal(hello.sourceCommit,'c627ec84664d43e0b18b95d9d86d8963747d56c7');
 await assert.rejects(rename(join(parent,'home'),join(parent,'replaced')),{code:'EBUSY'});
 await assert.rejects(rename(join(parent,'home','workspace'),join(parent,'home','replaced-workspace')),{code:'EBUSY'});
}finally{await client.dispose();}
await rename(join(parent,'home'),join(parent,'reopened-home'));await rename(join(parent,'reopened-home'),join(parent,'home'));

const account={id:'a9314811-0937-4f76-b565-445d57504ccc',providerId:'openai-codex',label:'Synthetic local storage only',enabled:true};
await withAccountProfile(root,account,async profile=>{
 assert.equal(profile,accountProfileRoot(root,account));
 await assert.rejects(rename(profile,profile+'-moved'),{code:'EBUSY'});
 const paths=taskPaths(profile,'synthetic-local-session');
 const credentials=await createLiteralCredentialStore(paths.authPath);
 await credentials.modify('openai-codex',()=>({type:'oauth',access:'SYNTHETIC-NO-NETWORK',refresh:'SYNTHETIC-NO-NETWORK',expires:0}));
 assert.equal((await credentials.read('openai-codex')).access,'SYNTHETIC-NO-NETWORK');
 const session=await openTaskSession(profile,{threadId:'synthetic-local-session',sessionPath:null});
 assert.equal(typeof session.getSessionId(),'string');
},signal,'synthetic-local-session');
// A redirected/multiply-linked Hermes file is rejected before its next worker starts.
const poisonHome=join(parent,'poison');await mkdir(poisonHome,{mode:0o700,recursive:true});
await writeFile(join(poisonHome,'a'),'synthetic');await link(join(poisonHome,'a'),join(poisonHome,'b'));
const poisoned=new HermesClient({home:poisonHome});
await assert.rejects(poisoned.request('hello',{}),{code:'CAPABILITY_DENIED'});await poisoned.dispose().catch(()=>{});
await unlink(join(poisonHome,'a'));await unlink(join(poisonHome,'b'));
console.log(JSON.stringify({scope:'LOCAL_NATIVE_IDMAPPED_DIRECTORY_CUSTODY',guardedRename:'EBUSY',atomicSave:true,nestedRelease:true,outsideBackingAccess:'EACCES',symlinkRejected:true,hardlinkRejected:true,originalGuardedHermesHello:{sourceCommit:hello.sourceCommit,pythonVersion:hello.pythonVersion,engineClass:hello.engineClass},originalPiCredentialLockAndLocalSession:true,modelCalls:0,realCredentials:false}));
