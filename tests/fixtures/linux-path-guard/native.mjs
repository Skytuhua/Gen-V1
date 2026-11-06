import assert from 'node:assert/strict';
import {mkdir,rename,readFile,writeFile,symlink,link,unlink,open} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const source=process.argv[2],root=process.env.HARNESS_COMPANY_DATA_DIR;
const moduleAt=part=>import(pathToFileURL(join(source,part)).href);
if(process.argv[3]==='credential-mounts'){
 const qualification=String.raw`
import errno, importlib.util, json, os, pathlib, sys, tempfile, threading
spec=importlib.util.spec_from_file_location('guard',sys.argv[1]+'/packages/core/linux-path-guard.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
base=pathlib.Path(tempfile.mkdtemp(prefix='gen-credential-alias-native-',dir='/var/lib'))
os.chown(base,1000,1000);base.chmod(0o700);uid=62153
backing=guard.private_profile(str(base),uid,uid)
parent=base/'accounts'/('provider-auth-'+'a'*64)/'pi'
current=base
covered=-1
for part in parent.relative_to(base).parts:
 current=current/part;current.mkdir();os.chown(current,uid,uid);current.chmod(0o700)
 if part=='accounts': covered=os.open(current,os.O_PATH|os.O_DIRECTORY)
auth=parent/'auth.json';auth.write_text('{}');os.chown(auth,uid,uid);auth.chmod(0o600)
directory=guard.DirectoryGuard(str(base),uid);directory.pin(str(base))
old=os.open(parent,os.O_PATH|os.O_DIRECTORY)
directory.prepare_credential(str(auth))
owner_r,owner_w=os.pipe();owner=os.fork()
if owner==0:
 os.close(owner_w);os.close(old);os.close(covered);os.setgroups([]);os.setresgid(uid,uid,uid);os.setresuid(uid,uid,uid)
 os.read(owner_r,1);os._exit(0)
os.close(owner_r)
if sys.argv[2]!='covered-only':
 ready_r,ready_w=os.pipe();stop_r,stop_w=os.pipe();child=os.fork()
 if child==0:
  os.close(ready_r);os.close(stop_w);os.setgroups([]);os.setresgid(uid,uid,uid);os.setresuid(uid,uid,uid)
  ready=threading.Event();stop=threading.Event()
  def retain_hidden_alias():
   guard.checked(guard.LIBC.unshare(0x400|0x200))  # Private CLONE_FILES and CLONE_FS.
   os.fchdir(old);ready.set();stop.wait()
  hidden=threading.Thread(target=retain_hidden_alias);hidden.start();assert ready.wait(3)
  os.close(old);os.close(covered)  # Only the hidden thread retains old FD/cwd aliases.
  os.write(ready_w,b'1');os.read(stop_r,1);os._exit(0)
 os.close(ready_w);os.close(stop_r);assert os.read(ready_r,1)==b'1'
 try:
  try:
   admitted,_=directory.acquire_credential(str(auth),1000)
   directory.release_credential(admitted);raise AssertionError('hidden thread descriptor/cwd alias admitted')
  except PermissionError: pass
 finally:
  os.close(stop_w);os.close(ready_r);os.waitpid(child,0)
os.close(old)
ready_r,ready_w=os.pipe();stop_r,stop_w=os.pipe();child=os.fork()
if child==0:
 os.close(ready_r);os.close(stop_w);os.setgroups([]);os.setresgid(uid,uid,uid);os.setresuid(uid,uid,uid)
 os.write(ready_w,b'1');os.read(stop_r,1);os._exit(0)
os.close(ready_w);os.close(stop_r);assert os.read(ready_r,1)==b'1'
try:
 try:
  admitted,_=directory.acquire_credential(str(auth),1000)
  directory.release_credential(admitted);raise AssertionError('covered ancestor descriptor alias admitted')
 except PermissionError: pass
finally:
 os.close(stop_w);os.close(ready_r);os.waitpid(child,0);os.close(covered)
alias=pathlib.Path(tempfile.mkdtemp(prefix='gen-credential-mount-alias-'))
guard.checked(guard.LIBC.mount(os.fsencode(parent),os.fsencode(alias),None,4096,None))
try:
 try: directory.acquire_credential(str(auth),1000);raise AssertionError('writable mount alias admitted')
 except PermissionError as error: assert 'mount alias' in str(error),error
finally: guard.checked(guard.LIBC.umount2(os.fsencode(alias),0))
foreign=parent/'foreign';foreign.mkdir();os.chown(foreign,uid,uid)
guard.checked(guard.LIBC.mount(os.fsencode(foreign),os.fsencode(foreign),None,4096,None))
try:
 try: directory.acquire_credential(str(auth),1000);raise AssertionError('unknown submount admitted')
 except PermissionError as error: assert 'submount' in str(error),error
finally: guard.checked(guard.LIBC.umount2(os.fsencode(foreign),0))
task=parent/'tasks';task.mkdir();os.chown(task,uid,uid);task.chmod(0o700);directory.pin(str(task))
writer=os.open(task/'session',os.O_CREAT|os.O_WRONLY,0o600)
try:
 try: directory.acquire_credential(str(auth),1000);raise AssertionError('descendant writer admitted')
 except OSError as error: assert error.errno==errno.EBUSY,error
finally: os.close(writer)
identifier,mounts=directory.acquire_credential(str(auth),1000)
assert len(mounts)==2
assert directory.credential_mounts(directory.credentials[str(parent)],True)==set(mounts)
directory.release_credential(identifier)
assert directory.credential_mounts(directory.credentials[str(parent)],False)==set(mounts)
os.close(owner_w);os.waitpid(owner,0)
print(json.dumps({'scope':'LOCAL_SYNTHETIC_CREDENTIAL_ALIAS_QUALIFICATION','hiddenThreadDescriptorAndCwdRejected':True,'coveredAncestorDescriptorRejected':True,'writableMountAliasRejected':True,'unknownSubmountRejected':True,'descendantWriterAdmission':'EBUSY','recursiveExistingMountFence':True,'fixture':str(base)}))
`;
 const result=spawnSync(join(source,'hermes-python/bin/python3.14'),['-c',qualification,source,process.argv[4]??'all'],{encoding:'utf8',timeout:30000});
 assert.equal(result.status,0,result.stderr);process.stdout.write(result.stdout);process.exit(0);
}
const {withPathGuard}=await moduleAt('packages/core/file-access.ts');
if(process.argv[3]==='unprotected'){
 let entered=false;
 await assert.rejects(withPathGuard([{path:source,leaf:false}],new AbortController().signal,async()=>{entered=true;}),{code:'CAPABILITY_DENIED'});
 assert.equal(entered,false);console.log(JSON.stringify({scope:'UNPROTECTED_LINUX',denied:true,actionEntered:false}));process.exit(0);
}
const {HermesClient}=await moduleAt('packages/runtime-hermes/client.ts');
const {withAccountProfile,accountProfileRoot}=await moduleAt('packages/runtime/account-profile.ts');
const {createLiteralCredentialStore,acquireLiteralCredentialLease}=await moduleAt('packages/runtime-pi/credentials.ts');
const {taskPaths,openTaskSession}=await moduleAt('packages/runtime-pi/session.ts');
const signal=new AbortController().signal;
if(process.argv[3]==='credential-loss'){
 const keepalive=setInterval(()=>{},1000);
 const account={id:'a9314811-0937-4f76-b565-445d57504ccc',providerId:'openai-codex',label:'Synthetic guardian loss only',enabled:true};
 await withAccountProfile(root,account,async profile=>{
  const {authPath}=taskPaths(profile,'synthetic-loss'),store=await createLiteralCredentialStore(authPath);
  await store.modify('openai-codex',async()=>({type:'oauth',access:'SYNTHETIC-NO-NETWORK',refresh:'SYNTHETIC-NO-NETWORK',expires:0}));
  const lease=await acquireLiteralCredentialLease(authPath,{signal,maxHoldMs:2000});
  process.stdout.write('FENCE_HELD '+process.pid+'\n');
  await new Promise(resolve=>lease.signal.addEventListener('abort',resolve,{once:true}));
  await assert.rejects(lease.release(),{code:'PI_CREDENTIAL_LEASE_RELEASE_UNCERTAIN'});
  await assert.rejects(lease.settled,{code:'PI_CREDENTIAL_LEASE_RELEASE_UNCERTAIN'});
  await assert.rejects(writeFile(authPath,'guardian loss retains fence'),{code:'EROFS'});
  clearInterval(keepalive);console.log(JSON.stringify({scope:'LOCAL_SYNTHETIC_GUARDIAN_LOSS',releaseUncertain:true,settledRejected:true,writeAfterGuardianDeath:'EROFS',realCredentials:false}));process.exit(0);
 },signal,'synthetic-loss');
}
if(process.argv[3]==='credential-barrier'){
 const {acquireLinuxCredentialReadBarrier:acquire}=await moduleAt('packages/core/linux-path-guard.ts');
 const {FileAuthStorageBackend}=await moduleAt('node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js');
 const account={id:'a9314811-0937-4f76-b565-445d57504ccc',providerId:'openai-codex',label:'Synthetic barrier only',enabled:true};
 await assert.rejects(acquire(join(root,'pi/auth.json'),{signal,maxHoldMs:1000}),{code:'CAPABILITY_DENIED'});
 await withAccountProfile(root,account,async profile=>{
  const {authPath,agentDir,taskDir}=taskPaths(profile,'synthetic-barrier'),store=await createLiteralCredentialStore(authPath);
  const value={type:'oauth',access:'SYNTHETIC-NO-NETWORK',refresh:'SYNTHETIC-NO-NETWORK',expires:0};
  await store.modify('openai-codex',async()=>value);
  const writable=await open(authPath,'r+');
  try{await assert.rejects(acquire(authPath,{signal,maxHoldMs:1000}),{code:'CAPABILITY_DENIED'});}finally{await writable.close();}
  await mkdir(authPath+'.lock');
  try{await assert.rejects(acquire(authPath,{signal,maxHoldMs:1000}),{code:'CAPABILITY_DENIED'});}finally{await unlinkDirectory(authPath+'.lock');}
  let resume,entered;const gate=new Promise(resolve=>resume=resolve),locked=new Promise(resolve=>entered=resolve);
  const late=new FileAuthStorageBackend(authPath).withLockAsync(async current=>{entered();await gate;return {result:null,next:current};});
  const lateResult=late.then(()=>null,error=>error);await locked;
  await unlinkDirectory(authPath+'.lock');
  const lease=await acquire(authPath,{signal,maxHoldMs:2000});
  try{
   lease.assertCurrent();await assert.rejects(rename(agentDir,agentDir+'-moved'),{code:'EBUSY'});
   await assert.rejects(writeFile(authPath,'not credentials'),{code:'EROFS'});
   await assert.rejects(writeFile(join(taskDir,'blocked'),'synthetic'),{code:'EROFS'});
   resume();assert.equal((await lateResult)?.code,'EROFS');
   await assert.rejects(acquire(authPath,{signal,maxHoldMs:1000}),{code:'CAPABILITY_DENIED'});
  }finally{resume();await lateResult;await lease.release();}
  await lease.settled;await lease.release();
  await store.modify('openai-codex',async()=>value);
  const expired=await acquire(authPath,{signal,maxHoldMs:30});
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.throws(()=>expired.assertCurrent());assert.equal(expired.signal.aborted,true);
  await assert.rejects(writeFile(authPath,'still fenced'),{code:'EROFS'});
  await expired.release();await expired.settled;
  await store.modify('openai-codex',async()=>value);
  assert.equal((await store.read('openai-codex')).access,value.access);
  const literal=await acquireLiteralCredentialLease(authPath,{signal,maxHoldMs:2000});
  assert.deepEqual(literal.read('openai-codex'),value);
  await assert.rejects(store.modify('openai-codex',async()=>value),{code:'EROFS'});
  let reentrant;literal.signal.addEventListener('abort',()=>{reentrant=literal.release();},{once:true});
  const released=literal.release();assert.equal(reentrant,released);await released;await literal.settled;
  await store.modify('openai-codex',async()=>value);
  const cancelled=new AbortController(),aborted=await acquireLiteralCredentialLease(authPath,{signal:cancelled.signal,maxHoldMs:2000});
  cancelled.abort();assert.throws(()=>aborted.assertCurrent());
  await assert.rejects(writeFile(authPath,'abort retains fence'),{code:'EROFS'});await aborted.release();
  const expiring=await acquireLiteralCredentialLease(authPath,{signal,maxHoldMs:30});let settled=false;
  void expiring.settled.then(()=>{settled=true;});await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(expiring.signal.aborted,true);assert.equal(settled,false);
  await assert.rejects(writeFile(authPath,'expiry retains fence'),{code:'EROFS'});
  await expiring.release();await expiring.settled;await store.modify('openai-codex',async()=>value);
 },signal,'synthetic-barrier');
 console.log(JSON.stringify({scope:'LOCAL_NATIVE_CREDENTIAL_READ_BARRIER',writableFdRejected:true,existingLockRejected:true,staleNativeWrite:'EROFS',descendantWrite:'EROFS',expiredFenceRetained:true,restoredNativeWrite:true,literalSnapshot:true,reentrantRelease:true,abortFenceRetained:true,expirySettlementPending:true,modelCalls:0,realCredentials:false}));process.exit(0);
}
async function unlinkDirectory(path){const {rmdir}=await import('node:fs/promises');await rmdir(path);}
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
