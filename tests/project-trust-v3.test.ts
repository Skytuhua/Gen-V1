import {cleanTempDirs,tempDir} from './fixtures/temp-dir.ts';
import {it,expect,afterEach} from 'vitest';
import {mkdirSync,writeFileSync,renameSync,symlinkSync,readFileSync} from 'node:fs';

import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {
 canonicalRootIdentity,approvedFileDigests,createProjectTrust,verifyProjectTrust,
 assertProjectTrustCurrent,ProjectTrustLedger,trustScopeCovers,
} from '../packages/core/project-trust';
import {
 projectTrustV1Schema,executionProfileV1Schema,secretRefV1Schema,packageScreeningV1Schema,
 WORKSPACE_EXECUTE_NO_NETWORK,TRUSTED_HOST,isTrustedHostProfile,
} from '../packages/contracts/execution-profile';
import {withBoundFileRead} from '../packages/core/file-access';

afterEach(()=>{cleanTempDirs();});
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const digestOf=(path:string)=>sha(readFileSync(path));

function projectFixture(){
 const root=tempDir('trust-root-');
 writeFileSync(join(root,'tool.exe'),'#!/bin/sh\necho approved-v1\n');
 writeFileSync(join(root,'app.json'),'{"name":"fixture","version":1}\n');
 writeFileSync(join(root,'notes.txt'),'ordinary granted text\n');
 return root;
}
const approvedFiles=[{path:'tool.exe',kind:'executable' as const},{path:'app.json',kind:'configuration' as const}];
const scope={read:true,write:false,network:'none' as const};

it('binds canonical physical root identity, approved digests, scope, decision and revision',async()=>{
 const root=projectFixture();
 const trust=await createProjectTrust({trustId:'trust-1',rootPath:root,approvedFiles,scope,decision:'trusted'});
 expect(projectTrustV1Schema.parse(trust)).toEqual(trust);
 expect(trust.root.canonicalPath).toBe(await canonicalRootIdentity(root).then(r=>r.canonicalPath));
 expect(trust.root.identity.dev).toMatch(/^\d+$/);expect(trust.root.identity.ino).toMatch(/^\d+$/);
 expect(trust.approvedDigests).toHaveLength(2);
 expect(trust.scope).toEqual(scope);expect(trust.decision).toBe('trusted');expect(trust.revision).toBe(1);
 expect((await verifyProjectTrust(trust,root)).status).toBe('CURRENT');
 await expect(assertProjectTrustCurrent(trust,root)).resolves.toBeUndefined();
});

it('rejects records that smuggle values or miss required bindings',()=>{
 const base={version:1,trustId:'t',root:{canonicalPath:'/x',identity:{dev:'1',ino:'2'}},approvedDigests:[],scope,decision:'trusted',decidedAt:new Date().toISOString(),revision:1};
 expect(()=>projectTrustV1Schema.parse({...base,root:{...base.root,identity:{dev:'1'}}})).toThrow();
 expect(()=>projectTrustV1Schema.parse({...base,decision:'maybe'})).toThrow();
 expect(()=>projectTrustV1Schema.parse({...base,approvedDigests:[{path:'../escape',sha256:'a'.repeat(64),kind:'executable'}]})).toThrow();
 expect(()=>projectTrustV1Schema.parse({...base,approvedDigests:[{path:'/abs',sha256:'a'.repeat(64),kind:'executable'}]})).toThrow();
});

it('changed executable or configuration bytes invalidate the decision before dispatch',async()=>{
 const root=projectFixture();
 const trust=await createProjectTrust({trustId:'trust-bytes',rootPath:root,approvedFiles,scope,decision:'trusted'});
 expect((await verifyProjectTrust(trust,root)).status).toBe('CURRENT');
 writeFileSync(join(root,'tool.exe'),'#!/bin/sh\necho approved-v2-CHANGED\n');
 const after=await verifyProjectTrust(trust,root);
 expect(after.status).toBe('INVALIDATED');
 expect(after.reasons.join(' ')).toMatch(/digest|executable|changed/i);
 await expect(assertProjectTrustCurrent(trust,root)).rejects.toThrow(/trust|invalidat|changed/i);
});

it('root retarget or recreation invalidates; a stable alias to the same physical root does not',async()=>{
 const parent=tempDir('trust-parent-');
 const root=join(parent,'project');mkdirSync(root);
 writeFileSync(join(root,'tool.exe'),'bytes-v1');
 const files=[{path:'tool.exe',kind:'executable' as const}];
 const trust=await createProjectTrust({trustId:'trust-root',rootPath:root,approvedFiles:files,scope,decision:'trusted'});
 // Junction/symlink alias resolving to the same physical root keeps identity.
 const alias=join(parent,'alias');
 let aliased=false;
 try{symlinkSync(root,alias,process.platform==='win32'?'junction':'dir');aliased=true;}catch{/* no link privilege */}
 if(aliased){
  expect((await verifyProjectTrust(trust,alias)).status).toBe('CURRENT');
 }
 // Recreate the directory at the same path: new physical identity must invalidate.
 const moved=join(parent,'moved');renameSync(root,moved);mkdirSync(root);
 writeFileSync(join(root,'tool.exe'),'bytes-v1');
 const retargeted=await verifyProjectTrust(trust,root);
 expect(retargeted.status).toBe('INVALIDATED');
 expect(retargeted.reasons.join(' ')).toMatch(/root|identity|retarget/i);
});

it('declined decisions and out-of-scope requests never authorize',async()=>{
 const root=projectFixture();
 const declined=await createProjectTrust({trustId:'trust-no',rootPath:root,approvedFiles,scope:{...scope,read:false},decision:'declined'});
 const verification=await verifyProjectTrust(declined,root);
 expect(verification.status).toBe('INVALIDATED');
 const trusted=await createProjectTrust({trustId:'trust-scope',rootPath:root,approvedFiles,scope,decision:'trusted'});
 expect(trustScopeCovers(trusted.scope,{read:true,write:false,network:'none'})).toBe(true);
 expect(trustScopeCovers(trusted.scope,{read:true,write:true,network:'none'})).toBe(false);
 expect(trustScopeCovers(trusted.scope,{read:true,write:false,network:'allowlist'})).toBe(false);
});

it('approved digest computation rejects escapes and missing files',async()=>{
 const root=projectFixture();
 const identity=await canonicalRootIdentity(root);
 await expect(approvedFileDigests(identity.canonicalPath,[{path:'../outside',kind:'executable'}])).rejects.toThrow();
 await expect(approvedFileDigests(identity.canonicalPath,[{path:'missing.exe',kind:'executable'}])).rejects.toThrow();
 const entries=await approvedFileDigests(identity.canonicalPath,approvedFiles);
 expect(entries.map(e=>e.sha256)).toEqual([digestOf(join(root,'tool.exe')),digestOf(join(root,'app.json'))]);
});

it('ledger revisions, revocation and audit preservation',async()=>{
 const root=projectFixture();
 const ledger=new ProjectTrustLedger();
 const first=await ledger.decide({trustId:'ledger-1',rootPath:root,approvedFiles,scope,decision:'trusted'});
 expect(first.revision).toBe(1);
 const second=await ledger.decide({trustId:'ledger-1',rootPath:root,approvedFiles,scope:{...scope,write:true},decision:'trusted'});
 expect(second.revision).toBe(2);
 expect(ledger.get('ledger-1')?.record.revision).toBe(2);
 ledger.revoke('ledger-1');
 expect((await ledger.verify('ledger-1',root)).status).toBe('INVALIDATED');
 expect(ledger.list()).toHaveLength(1); // history retained
});

it('reading an ordinary granted text file still works while execution approval stays distinct',async()=>{
 const root=projectFixture();
 const trust=await createProjectTrust({trustId:'trust-read',rootPath:root,approvedFiles,scope,decision:'trusted'});
 expect((await verifyProjectTrust(trust,root)).status).toBe('CURRENT');
 const text=await withBoundFileRead(join(root,'notes.txt'),new AbortController().signal,async descriptorPath=>{
  const {readBoundFile}=await import('../packages/core/file-access');
  return (await readBoundFile(descriptorPath,4096)).toString('utf8');
 });
 expect(text).toContain('ordinary granted text');
});

it('contract schemas for profile, secret reference and screening enforce their fixed shapes',()=>{
 const profile={profileId:WORKSPACE_EXECUTE_NO_NETWORK,version:1,backendId:'backend-x',capabilities:['process.execute','fs.read'],readRoots:['/tmp/x'],writeRoots:[],networkPolicy:{mode:'none'},secretRefs:[],executableAllowlist:[{executableSha256:'a'.repeat(64),argv:['run']}],platformProofRef:'proof-1'};
 expect(executionProfileV1Schema.parse(profile).profileId).toBe(WORKSPACE_EXECUTE_NO_NETWORK);
 expect(()=>executionProfileV1Schema.parse({...profile,networkPolicy:{mode:'open'}})).toThrow();
 expect(()=>executionProfileV1Schema.parse({...profile,executableAllowlist:[{executableSha256:'nothex',argv:[]}]})).toThrow();
 const trusted=executionProfileV1Schema.parse({...profile,profileId:TRUSTED_HOST});
 expect(isTrustedHostProfile(trusted)).toBe(true);
 expect(isTrustedHostProfile(profile)).toBe(false);
 const ref={version:1,refId:'api-token',purpose:'call example api',owner:'account-1',destination:{kind:'process-env',executableSha256:'b'.repeat(64),envName:'API_TOKEN'}};
 expect(secretRefV1Schema.parse(ref).refId).toBe('api-token');
 expect(()=>secretRefV1Schema.parse({...ref,value:'sk-live-secret'})).toThrow(); // strict: no value field
 expect(()=>secretRefV1Schema.parse({...ref,destination:{kind:'process-env',executableSha256:'b'.repeat(64),envName:'lowercase'}})).toThrow();
 const screening={version:1,screeningId:'s1',pkg:{name:'left-pad',version:'1.0.0',digest:'c'.repeat(64)},source:{kind:'registry',locator:'npm'},advisory:{database:'osv',asOf:new Date().toISOString()},status:'NO_KNOWN_MATCH',decision:'ALLOW',reason:'no exact advisory match',checkedAt:new Date().toISOString(),cacheAgeMs:0};
 expect(packageScreeningV1Schema.parse(screening).status).toBe('NO_KNOWN_MATCH');
 expect(()=>packageScreeningV1Schema.parse({...screening,status:'CLEAN'})).toThrow();
});
