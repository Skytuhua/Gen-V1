// Exercise the actual evidence controller against disposable copies. Original
// evidence entries are moved aside and restored byte-for-byte in finally.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cpSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const root='docs/implementation/v3',prefix=`${root}/M15-`;
// Keep rename-based custody on the repository's filesystem, outside its tree.
const backup=mkdtempSync(join(process.cwd(),'..','m15-evidence-probe-'));
const entries=readdirSync(root).filter(name=>name.startsWith('M15-')||name==='m15-logs'||name==='m15-artifacts');
const moved=[];
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const write=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const reset=()=>{for(const name of entries){const path=join(root,name);rmSync(path,{recursive:true,force:true});cpSync(join(backup,name),path,{recursive:true});}};
const run=(assemble=false)=>{
 const child=spawnSync(process.execPath,['--import','tsx','scripts/m15-evidence.mts',...(assemble?['--assemble']:[])],{encoding:'utf8',maxBuffer:2*1024*1024});
 return {exitCode:child.status,termination:child.signal,output:(child.stdout+child.stderr).slice(-6000)};
};
const cases=[];
try{
 for(const name of entries){renameSync(join(root,name),join(backup,name));moved.push(name);}
 reset();
 const control=run();
 if(control.exitCode!==0)throw Error('The unchanged bundle must validate before probing: '+control.output);
 cases.push({id:'unchanged-bundle',accepted:true,...control});
 const mutations=[
  ['omit-failed-and-blocked-phases',()=>{
   const path=prefix+'verification.json',value=read(path),removed=value.phases.filter(phase=>phase.status!=='PASS');
   value.phases=value.phases.filter(phase=>phase.status==='PASS');
   value.phases.find(phase=>phase.id==='ATTEMPT_HISTORY').commands.push(...removed.flatMap(phase=>phase.commands));
   value.remainingGates=[];write(path,value);
  },false],
  ['alter-command-index',()=>{
   const path=prefix+'command-index.json',value=read(path);value[0].phase='FORGED_PHASE';value[0].status=value[0].status==='PASS'?'FAIL':'PASS';write(path,value);
  },false],
  ['malformed-command-receipt',()=>{
   const plan=read(prefix+'evidence-plan.json'),used=new Set(plan.phases.flatMap(phase=>phase.commandIds));
   const file=readdirSync(root+'/m15-logs').find(name=>name.endsWith('.json')&&name!=='renderer-performance-04.json'&&!used.has(name.slice(0,-5)));
   if(!file)throw Error('A retained historical command is required for this probe.');
   const path=root+'/m15-logs/'+file,value=read(path);delete value.argv;write(path,value);
  },true],
  ['alter-legacy-renderer-exception',()=>{
   const path=root+'/m15-logs/renderer-performance-04.json',value=read(path);value.scope='forged legacy report';write(path,value);
  },true],
  ['alter-source-cut-metadata',()=>{
   const path=prefix+'source-cut.json',value=read(path);value.executionBaseSha='a'.repeat(40);value.files[0].bytes+=1;write(path,value);
  },false],
  ['alter-dependency-contract',()=>{
   const lockPath=prefix+'source-lock.json',evidencePath=prefix+'verification.json',lock=read(lockPath),value=read(evidencePath);
   lock.publicContracts[0].version='a'.repeat(40);value.dependencyContracts[0].version='a'.repeat(40);
   write(lockPath,lock);value.sourceLockDigest=digest(lockPath);write(evidencePath,value);
  },false],
 ];
 for(const [id,mutate,assemble] of mutations){reset();mutate();const result=run(assemble);cases.push({id,rejected:result.exitCode!==null&&result.exitCode!==0,...result});}
 console.log(JSON.stringify({scope:'Actual controller with disposable copies of this bundle; originals restored in finally.',cases},null,2));
 if(cases.some(item=>item.rejected===false))process.exitCode=1;
}finally{
 for(const name of moved){const path=join(root,name);rmSync(path,{recursive:true,force:true});renameSync(join(backup,name),path);}
 rmSync(backup,{recursive:true,force:true});
}
