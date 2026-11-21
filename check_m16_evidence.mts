import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {implementationEvidenceV3Schema,sourceLockV3Schema,validateImplementationEvidence} from './packages/contracts/implementation-evidence.ts';

const read=(p:string)=>readFileSync(p,'utf8');
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
// Command identities are stored redacted (%USERPROFILE%/%LOCALAPPDATA%/%TEMP%/
// $HOME). Historical logs on main still carry the raw profile paths, so headers
// compare equal modulo this normalization only — structure stays verbatim.
const redact=(s:string)=>s
 .replace(/C:[/\\]Users[/\\][^/\\\s]+[/\\]AppData[/\\]Local[/\\]Temp[/\\]/g,'%TEMP%/')
 .replace(/C:[/\\]Users[/\\][^/\\\s]+[/\\]AppData[/\\]Local[/\\]/g,'%LOCALAPPDATA%/')
 .replace(/C:[/\\]Users[/\\][^/\\\s]+[/\\]/g,'%USERPROFILE%/')
 .replace(/\/home\/[^/\s]+\//g,'$HOME/');
const issues:string[]=[];
const check=(c:boolean,m:string)=>{if(!c)issues.push(m);};

const evidence=implementationEvidenceV3Schema.parse(JSON.parse(read('docs/implementation/v3/M16-verification.json')));
const lock=sourceLockV3Schema.parse(JSON.parse(read('docs/implementation/v3/M16-source-lock.json')));
check(hash('docs/implementation/v3/M16-source-lock.json')===evidence.sourceLockDigest,'sourceLockDigest differs');
check(evidence.reviewerApproval===false,'reviewerApproval must stay false');
check(evidence.flags.every(f=>f.enabled===false),'production flags must stay false');
check(evidence.baseSha==='f20b92c636f9ba749a2a2ac027a9e1f053574198','baseSha drifted');
check(lock.executionBaseSha===evidence.baseSha,'lock base differs');

for(const issue of validateImplementationEvidence(evidence))issues.push(`${issue.code}: ${issue.description}`);
for(const phase of evidence.phases){
 for(const command of phase.commands){
  check(existsSync(command.boundedLogRef),`missing log ${command.boundedLogRef}`);
  if(!existsSync(command.boundedLogRef))continue;
  check(hash(command.boundedLogRef)===command.logDigest,`logDigest differs ${command.boundedLogRef}`);
  const log=read(command.boundedLogRef);
  check(redact(log).startsWith(redact(`argv: ${JSON.stringify(command.argv)}\ncwd: ${command.cwdIdentity}\nexitCode: ${command.exitCode}\ntermination: ${command.termination}\n`)),`log header differs ${command.boundedLogRef}`);
  check(Date.parse(command.endedAt)>=Date.parse(command.startedAt),`bad timing ${command.boundedLogRef}`);
 }
}
console.log(issues.length?issues.join('\n'):'M16 evidence validates: 0 issues');
process.exit(issues.length?1:0);
