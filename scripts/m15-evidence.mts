import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {commandEvidenceSchema,implementationEvidenceV3Schema,sourceLockV3Schema,validateImplementationEvidence,bundleStatus,type PhaseEvidence} from '../packages/contracts/implementation-evidence';
import {capabilityEnabled} from '../packages/core/capability-flags';

const root='docs/implementation/v3', prefix=`${root}/M15-`;
const read=(path:string)=>readFileSync(path,'utf8');
const json=(path:string)=>JSON.parse(read(path));
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const write=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const plan=json(prefix+'evidence-plan.json') as {executionBaseSha:string;auditAncestorSha:string;acceptedDependencyCommits:string[];dependencyContracts:{name:string;testIds:string[]}[];inspectedPaths:string[];remainingGates:string[];phases:{id:string;status:PhaseEvidence['status'];cases:PhaseEvidence['requiredCases'];commandIds:string[];artifactRefs:string[]}[]};
const paths=(base:string)=>[...new Set([...git('diff','--name-only',base).split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')].filter(Boolean).filter(path=>existsSync(path)))].sort();
const walk=(path:string):string[]=>readdirSync(path).sort().flatMap(name=>{const file=join(path,name);return statSync(file).isDirectory()?walk(file):[file];});
const records=()=>readdirSync(`${root}/m15-logs`).filter(name=>name.endsWith('.json')).sort().flatMap(name=>{
 const file=`${root}/m15-logs/${name}`,value=json(file);
 // Only these exact historical bytes are a non-command artifact in this folder.
 // A malformed command must never disappear from receipt coverage.
 if(name==='renderer-performance-04.json'){
  if(hash(file)!=='1b5485bbddc560dc0467411d8257005052e2701ba33e662547fa42cc99149a86')throw Error('Legacy renderer artifact differs from its immutable bytes.');
  return [];
 }
 return [{id:name.slice(0,-5),file,command:commandEvidenceSchema.parse(value)}];
});
const generated=['source-lock.json','source-cut.json','artifacts.json','command-index.json','verification.json','validation-summary.json'].map(name=>prefix+name);

const deriveSourceLock=()=>{
 const dependencies=plan.dependencyContracts.map(contract=>({...contract,version:git('rev-parse',`${plan.executionBaseSha}:${contract.name}`)}));
 const inspectedPaths=[...new Set(plan.inspectedPaths)].sort().map(path=>({path,blobSha:git('rev-parse',`${plan.executionBaseSha}:${path}`)}));
 const drift=inspectedPaths.flatMap(entry=>{
  let fromBlob:string;try{fromBlob=git('rev-parse',`${plan.auditAncestorSha}:${entry.path}`);}catch{return [];}
  return fromBlob===entry.blobSha?[]:[{path:entry.path,fromBlob,toBlob:entry.blobSha,note:'Inspected execution-base changes and current caller contracts; see M15-dependency-review.md and M15-handoff.md. This records reviewed source drift, not release permission.'}];
 });
 return sourceLockV3Schema.parse({schemaVersion:3,auditAncestorSha:plan.auditAncestorSha,executionBaseSha:plan.executionBaseSha,inspectedPaths,publicContracts:dependencies,acceptedDependencyCommits:plan.acceptedDependencyCommits,approvedDrift:drift});
};
const derivePhases=(commands:ReturnType<typeof records>):PhaseEvidence[]=>{
 const used=new Set<string>(),phaseIds=new Set(['ATTEMPT_HISTORY']),caseIds=new Set(['all-other-executed-attempts-retained']);
 const phases:PhaseEvidence[]=plan.phases.map(phase=>{
  if(!phase.id||phaseIds.has(phase.id))throw Error(`Missing or duplicate phase: ${phase.id}`);phaseIds.add(phase.id);
  for(const item of phase.cases){if(!item.id||caseIds.has(item.id))throw Error(`Missing or duplicate required case: ${item.id}`);caseIds.add(item.id);}
  return {id:phase.id,status:phase.status,requiredCases:phase.cases,artifactRefs:phase.artifactRefs,commands:phase.commandIds.map(id=>{if(used.has(id))throw Error(`Duplicate command assignment: ${id}`);used.add(id);const record=commands.find(record=>record.id===id);if(!record)throw Error(`Missing actual command: ${id}`);return record.command;})};
 });
 const history=commands.filter(record=>!used.has(record.id));
 phases.push({id:'ATTEMPT_HISTORY',status:'PASS',requiredCases:[{id:'all-other-executed-attempts-retained',status:'PASS',evidence:'M15-command-index.json; failed setup, red fixtures and superseded runs keep their actual nonzero status.'}],artifactRefs:[prefix+'command-index.json'],commands:history.map(record=>record.command)});
 return phases;
};
const commandRecords=records(),expectedLock=deriveSourceLock(),expectedPhases=derivePhases(commandRecords);
const expectedCommandIndex=commandRecords.map(record=>({id:record.id,receipt:record.file,phase:plan.phases.find(phase=>phase.commandIds.includes(record.id))?.id??'ATTEMPT_HISTORY',status:record.command.status,exitCode:record.command.exitCode,startedAt:record.command.startedAt,endedAt:record.command.endedAt}));

if(process.argv.includes('--assemble')){
 for(const path of generated)if(!existsSync(path))write(path,{});
 write(prefix+'source-lock.json',expectedLock);
 const changedFiles=paths(plan.executionBaseSha);
 write(prefix+'command-index.json',expectedCommandIndex);
 write(prefix+'source-cut.json',{executionBaseSha:plan.executionBaseSha,files:changedFiles.filter(path=>!path.startsWith('docs/')).map(path=>({path,bytes:statSync(path).size,sha256:hash(path),gitBlob:git('hash-object','--',path)}))});
 const artifactFiles=[...walk(`${root}/m15-logs`),...walk(`${root}/m15-artifacts`),...changedFiles.filter(path=>path.startsWith(prefix)&&path.endsWith('.md')),prefix+'evidence-plan.json'].sort();
 write(prefix+'artifacts.json',{files:artifactFiles.map(path=>({path,bytes:statSync(path).size,sha256:hash(path)}))});
 write(prefix+'verification.json',implementationEvidenceV3Schema.parse({schemaVersion:3,bundleId:'M15-source-aware-workbench',baseSha:plan.executionBaseSha,sourceLockDigest:hash(prefix+'source-lock.json'),platform:`${process.platform}-${process.arch}`,nodeVersion:process.version,packageManagerVersion:'10.30.3',phases:expectedPhases,changedFiles,dependencyContracts:expectedLock.publicContracts,flags:[{key:'ui.sourceWorkbenchV1',enabled:false}],remainingGates:plan.remainingGates,reviewerApproval:false}));
}

const evidence=implementationEvidenceV3Schema.parse(json(prefix+'verification.json'));
const lock=sourceLockV3Schema.parse(json(prefix+'source-lock.json'));
const issues:string[]=[];
const check=(condition:boolean,description:string)=>{if(!condition)issues.push(description);};
check(evidence.baseSha===plan.executionBaseSha&&lock.executionBaseSha===plan.executionBaseSha,'Execution base differs from reviewed plan.');
check(evidence.bundleId==='M15-source-aware-workbench','Bundle identity differs.');
check(isDeepStrictEqual(lock,expectedLock),'Source lock differs from the reviewed plan and actual base blobs.');
check(isDeepStrictEqual(evidence.dependencyContracts,expectedLock.publicContracts),'Dependency contracts differ from the reviewed source lock.');
check(isDeepStrictEqual(evidence.phases,expectedPhases),'Phases, required cases or command assignments differ from the reviewed plan.');
check(isDeepStrictEqual(evidence.remainingGates,plan.remainingGates),'Remaining gates differ from the reviewed plan.');
check(isDeepStrictEqual(json(prefix+'command-index.json'),expectedCommandIndex),'Command index differs from actual receipts and reviewed phase membership.');
check(hash(prefix+'source-lock.json')===evidence.sourceLockDigest,'Source-lock digest differs.');
for(const commit of [plan.auditAncestorSha,...lock.acceptedDependencyCommits]){try{git('merge-base','--is-ancestor',commit,plan.executionBaseSha);}catch{issues.push(`Dependency is not an accepted ancestor: ${commit}`);}}
for(const entry of lock.inspectedPaths)check(git('rev-parse',`${plan.executionBaseSha}:${entry.path}`)===entry.blobSha,`Base blob mismatch: ${entry.path}`);
const byLog=new Map(commandRecords.map(record=>[record.command.boundedLogRef,record]));
const embedded=evidence.phases.flatMap(phase=>phase.commands);
check(embedded.length===commandRecords.length,'A command receipt is omitted or duplicated.');
check(new Set(embedded.map(command=>command.boundedLogRef)).size===embedded.length,'Repeated embedded command log.');
for(const command of embedded){
 const record=byLog.get(command.boundedLogRef);
 check(Boolean(record)&&JSON.stringify(record!.command)===JSON.stringify(command),`Embedded command differs from immutable receipt: ${command.boundedLogRef}`);
 check(existsSync(command.boundedLogRef)&&hash(command.boundedLogRef)===command.logDigest,`Missing or mismatched command log: ${command.boundedLogRef}`);
 const log=read(command.boundedLogRef);
 check(log.startsWith(`argv: ${JSON.stringify(command.argv)}\ncwd: ${command.cwdIdentity}\nexitCode: ${command.exitCode}\ntermination: ${command.termination}\n`),`Log observation header differs: ${command.boundedLogRef}`);
 check(Date.parse(command.endedAt)>=Date.parse(command.startedAt),`Invalid command timing: ${command.boundedLogRef}`);
}
const artifacts=json(prefix+'artifacts.json').files as {path:string;bytes:number;sha256:string}[];
const expectedArtifacts=[...walk(`${root}/m15-logs`),...walk(`${root}/m15-artifacts`),...evidence.changedFiles.filter(path=>path.startsWith(prefix)&&path.endsWith('.md')),prefix+'evidence-plan.json'].sort();
check(JSON.stringify(artifacts.map(artifact=>artifact.path))===JSON.stringify(expectedArtifacts),'Artifact manifest is incomplete or duplicated.');
for(const artifact of artifacts)check(existsSync(artifact.path)&&statSync(artifact.path).size===artifact.bytes&&hash(artifact.path)===artifact.sha256,`Artifact mismatch: ${artifact.path}`);
const sourceCut=json(prefix+'source-cut.json') as {executionBaseSha:string;files:{path:string;bytes:number;sha256:string;gitBlob:string}[]};
check(sourceCut.executionBaseSha===plan.executionBaseSha,'Implementation source cut has a different base.');
for(const file of sourceCut.files)check(existsSync(file.path)&&statSync(file.path).size===file.bytes&&hash(file.path)===file.sha256&&git('hash-object','--',file.path)===file.gitBlob,`Implementation source changed: ${file.path}`);
check(JSON.stringify(paths(evidence.baseSha))===JSON.stringify(evidence.changedFiles),'Complete changed-file list differs.');
check(JSON.stringify(evidence.changedFiles.filter(path=>!path.startsWith('docs/')))===JSON.stringify(sourceCut.files.map(file=>file.path)),'Implementation source-cut list differs.');
for(const phase of evidence.phases)for(const ref of phase.artifactRefs)check(existsSync(ref),`Missing phase artifact: ${ref}`);
check(evidence.flags.length===1&&evidence.flags[0].key==='ui.sourceWorkbenchV1'&&!evidence.flags[0].enabled,'Workbench activation flag must stay off.');
check(!capabilityEnabled('ui.sourceWorkbenchV1'),'Actual host-owned registry default is not off.');
check(json('package.json').packageManager==='pnpm@'+evidence.packageManagerVersion,'Package-manager evidence differs from declaration.');
issues.push(...validateImplementationEvidence(evidence,{expectedBaseSha:plan.executionBaseSha,requiredContracts:lock.publicContracts}).map(issue=>`${issue.phase??'bundle'}: ${issue.code}: ${issue.message}`));
const summary={validatedAt:new Date().toISOString(),integrityStatus:issues.length?'FAIL':'PASS',bundleStatus:bundleStatus(evidence.phases),commandRecords:commandRecords.length,artifactHashes:json(prefix+'artifacts.json').files.length,implementationFiles:sourceCut.files.length,changedFiles:evidence.changedFiles.length,sourceLockDigest:evidence.sourceLockDigest,reviewerApproval:false,issues};
write(prefix+'validation-summary.json',summary);console.log(JSON.stringify(summary,null,2));if(issues.length)process.exitCode=1;
