// Seeds the owned UI-acceptance profile used by the R01-R18 handoff.
// Usage: pnpm exec tsx scripts/seed-ui-acceptance-profile.ts [target-dir]
// The dir is a host profile (same layout verify-desktop builds with mkdtemp):
// threads A-E, five same-project agent threads, a 25+ thread bulk fixture,
// completed/running/waiting/interrupted/failed statuses, a nested artifact,
// a dense plan, and a legacy workspace profile.
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../packages/storage/store.ts';
import {WorkspaceRepository} from '../packages/core/workspace-layout.ts';
import {PLANNING_PROVENANCE,planDataId} from '../packages/contracts/planning.ts';
import type {DesktopSurface} from '../packages/desktop-contract/index.ts';
import {growingQaSpec} from '../tests/e2e/task-interface-fixture.ts';

const now='2026-11-18T20:00:00.000Z';
const target=resolve(process.argv[2]??'.harness-repair-evidence/profiles/ui-acceptance');
mkdirSync(target,{recursive:true});
const store=new Store(join(target,'host'));

const thread=(id:string,title:string,status:string,projectName:string|null,extra:Record<string,unknown>={})=>({id,title,projectName,status,epoch:0,runId:null,modelId:'test/model',sessionPath:'fixture',createdAt:now,updatedAt:now,...extra});
const message=(id:string,threadId:string,role:string,content:string)=>({id,threadId,role,content,runId:null,createdAt:now});

const long=`${'Acceptance paragraph: deterministic fixture text describing detached conversation behaviour across docked and floating panes. '.repeat(12)}`;
const code='```ts\nexport const pinned = { owner: "thread-a", drift: 0 };\nif (pinned.drift > 0) throw new Error("drifted");\n```';
const table='| Column | Value |\n|---|---|\n| alpha | 1 |\n| beta | 2 |\n| gamma | 3 |';

// Threads A-E with unique titles and last messages.
const abcde=['A','B','C','D','E'] as const;
const threads=[...abcde.map(letter=>thread(`thread-${letter.toLowerCase()}`,`Acceptance thread ${letter}`,letter==='C'?'working':'ready',null))];
const messages=abcde.flatMap(letter=>[
  message(`m-${letter}-user`,`thread-${letter.toLowerCase()}`,'user',`Seed question for thread ${letter}`),
  message(`m-${letter}-last`,`thread-${letter.toLowerCase()}`,'assistant',`Last message of thread ${letter}`),
]);
// A carries the long paragraph + code block + table + scrollable history.
for(let i=1;i<=24;i++)messages.push(message(`a-extra-${i}`,'thread-a','assistant',`Scrolled history entry ${i}.`));
messages.push(message('a-rich','thread-a','assistant',`${long}\n\n${code}\n\n${table}`));

// Five agent threads in one shared project with distinct statuses.
const agentStatuses=['completed','working','waiting','interrupted','failed'];
threads.push(...agentStatuses.map((status,index)=>thread(`agent-${index+1}`,`Agent run ${index+1} (${status})`,status,'Shared agent project',{projectId:'project-agents'})));

// Separate 25+ thread bulk fixture.
for(let i=1;i<=28;i++){threads.push(thread(`bulk-${i}`,`Bulk fixture thread ${i.toString().padStart(2,'0')}`,'ready','Bulk fixture'));messages.push(message(`bulk-${i}-last`,`bulk-${i}`,'assistant',`Bulk thread ${i} last message.`));}

// Nested artifact on thread A (outer Disclosure containing a nested Disclosure).
const artifacts=[{id:'artifact-a-nested',threadId:'thread-a',messageId:'a-rich',title:'Nested evidence surface',purpose:'Acceptance fixture for R13 nested collapse.',kind:'structured',revision:1,spec:growingQaSpec,widget:null,bindings:{answer:{mode:'live',id:'input-answer'}},actions:{expand:{kind:'agent'},feedback:{kind:'agent'}},stateId:'state-a-nested',lifecycle:'active',placement:'inline',pinned:false,catalogVersion:'1.0.0',presentation:{width:'standard',frame:'card'},createdAt:now,updatedAt:now}];
const userStates=[{id:'state-a-nested',threadId:'thread-a',revision:0,schemaVersion:1,values:{deliveryNote:'Seeded state value'}}];
const data:{id:string;threadId:string;revision:number;value:unknown;provenance:string;createdAt:string}[]=[{id:'input-answer',threadId:'thread-a',revision:1,value:'Split delivery is possible.',provenance:'Authored synthetic local input',createdAt:now}];

// Dense plan: eight steps with requirements/agents on thread B.
const denseSteps=Array.from({length:8},(_,index)=>({id:`step-${index+1}`,title:`Dense plan step ${index+1}: ${'verify detailed acceptance '.repeat(3).trim()}`,status:index<2?'completed':index===2?'working':'blocked',requirements:[{id:`r-${index+1}`,label:`Requirement ${index+1} has a longer than usual label for dense rendering`,completed:index<2}],dependsOn:index?[ `step-${index}`]:[]}));
data.push({id:planDataId('thread-b'),threadId:'thread-b',revision:1,provenance:PLANNING_PROVENANCE,createdAt:now,value:{version:1,title:'Dense acceptance plan',authority:'proposal',runState:'running',steps:denseSteps,agents:agentStatuses.map((_,index)=>({id:`djob-${index+1}`,commandId:`dc-${index+1}`,taskId:`dt-${index+1}`,name:`Dense agent ${index+1}`,task:'Dense fixture task',status:index===4?'queued':'working',requirements:[],completedRequirementIds:[],reportedPercent:index*20,createdAt:now,updatedAt:now}))}});

store.internal('ui-acceptance.seed',null,()=>{
  for(const t of threads)store.put('thread',t.id,null,t);
  for(const m of messages)store.put('message',m.id,m.threadId,m);
  for(const a of artifacts)store.put('artifact',a.id,a.threadId,a);
  for(const s of userStates)store.put('userState',s.id,s.threadId,s);
  for(const d of data)store.put('data',d.id,d.threadId,d);
  store.put('settings','global',null,{theme:'system',modelId:'test/model'});
});

// Legacy workspace profile: saved surfaces plus a profile referencing a
// workspace kind a restored profile may no longer carry.
const savedSurfaces:DesktopSurface[]=[{kind:'main'},{kind:'plan',threadId:'thread-b'},{kind:'artifact',threadId:'thread-a',artifactId:'artifact-a-nested'}];
const repo=new WorkspaceRepository(store);
repo.command({id:randomUUID(),type:'workspace.native.update',payload:{layout:{version:1,windows:savedSurfaces.map(surface=>({surface,bounds:{x:40,y:40,width:960,height:720},visible:true,alwaysOnTop:false}))}}});
store.close();
console.log(JSON.stringify({profile:target,threads:threads.length,messages:messages.length,artifacts:artifacts.length,draftsSeeded:'renderer-side (IndexedDB); create via composer during exercise'},null,0));
