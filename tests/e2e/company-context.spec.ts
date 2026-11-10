import {expect, test, type Page, type Route} from '@playwright/test';
import samples from '../../packages/company-contracts/company-manager.v1.samples.json' with {type:'json'};
import type {ContextDependency, ProjectContextResponse, TaskContextResponse} from '../../packages/company-contracts/manager';

// Synthetic DTO/UI proof only. No backend authorization, inference, cursor
// custody, company acceptance or live artifact verification is exercised.
const pin = {contractId:'maritime-company-manager', contractVersion:'1.0.0-candidate.1',backendCheckpoint:'aca8ec09de5cda73b014a348a05a8f05b43f465b',manifestSHA256:'fb4e7d2eba19275c5d4013576a01d90984c9f716ce9f0d6e1d1b31a15d46a033'};
const envelope = (data: unknown) => ({...pin,data,receivedAt:'2026-11-02T19:00:00.000Z',source:'company_service'});
const projectSample = () => structuredClone(samples.examples[0].response) as unknown as ProjectContextResponse;
const taskSample = () => structuredClone(samples.examples[1].response) as unknown as TaskContextResponse;
async function fixture(page: Page, configured = true) {
  const calls: {path:string;body:any}[] = [];
  let projectRead: ((route:Route,body:any)=>Promise<void>) | undefined, taskRead: ((route:Route,body:any)=>Promise<void>) | undefined, statusRead: ((route:Route,body:any)=>Promise<void>) | undefined;
  const projects=['alpha','beta'].map(id=>({id,name:id==='alpha'?'Alpha fixture':'Beta fixture',state:'draft',scheduler_paused:false,task_counts:{},occupied_synthetic_slots:0}));
  const observation={status:'unavailable',observed_at:null,expires_at:null,evidence_scope:'unavailable'};
  const status={evidence_scope:'synthetic_only',live_ready:false,company_accepted:false,planning_mode:'planning_only',native_chat_planner:'capability_missing',targets:{employees:32,departments:16,hermes:18,codex:14},actual_live:{employees:0,hermes:0,codex:0},projects,employees:[],blockers:[],auth:observation,budget:observation,runtime_requirements:{source:'synthetic-fixture',hermes:{mode:'native',repository:null,commit:null,compatibility_evidence:null,image_digest:null},codex:{mode:'native',package:null,version:null,external_auth_candidate_status:null,image_digest:null}},configured_requirements_digest:'b'.repeat(64),configured_company_digest:'c'.repeat(64),native_limits:{task_timeout_seconds:600,hermes_iteration_cap:100,codex_turn_cap:null,max_child_processes_per_attempt:1,effective_limits:null}};
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname, body=route.request().method()==='POST'?route.request().postDataJSON():undefined;
    calls.push({path,body});
    if(path==='/api/bootstrap')return route.fulfill({json:{csrfToken:'synthetic-context-csrf'}});
    if(path==='/api/company/connection')return route.fulfill({json:{configured:true,protocol:'company-service.v1-draft1',serviceBaseline:'synthetic-fixture',mode:'read_only',ownerAuthenticated:true,capabilities:{status:true,artifactPreview:false,reviewPackage:false,planning:false,dispatch:false,publication:false,events:false,emergencyStop:false},blockers:[]}});
    if(path==='/api/company/status'){
      if(statusRead)return statusRead(route,body);
      const project=projects.find(value=>value.id===body?.scope?.id);
      return route.fulfill({json:{data:{...status,...(project?{project,projects:[project]}:{})},receivedAt:'2026-11-02T19:00:00.000Z',source:'company_service',protocol:'company-service.v1-draft1'}});
    }
    if(path==='/api/company/context/availability')return route.fulfill({json:{...pin,configured,ownerHostOnly:true,engineAccess:false,blockers:configured?[]:['Backend ingress proof is unavailable.']}});
    if(path==='/api/company/context/project')return projectRead?projectRead(route,body):route.fulfill({json:envelope(projectSample())});
    if(path==='/api/company/context/task'){
      if(taskRead)return taskRead(route,body);
      const value=taskSample(); value.section=body.section; return route.fulfill({json:envelope(value)});
    }
    return route.fulfill({status:403,json:{error:{code:'UNEXPECTED_API',message:'Unexpected synthetic UI API'}}});
  });
  return {calls,onProject:(handler:typeof projectRead)=>{projectRead=handler;},onTask:(handler:typeof taskRead)=>{taskRead=handler;},onStatus:(handler:typeof statusRead)=>{statusRead=handler;}};
}
async function open(page:Page){await page.goto('/company');await page.getByRole('combobox',{name:'Project scope'}).selectOption('alpha');await expect(page.getByRole('region',{name:'Project context dossier'})).toBeVisible();}
const loadProject=(page:Page)=>page.getByRole('button',{name:'Load project context',exact:true});

test('owner context remains unavailable until a trusted host enables it',async({page})=>{
  const api=await fixture(page,false);await open(page);
  await expect(page.getByText('Backend ingress proof is unavailable.',{exact:true})).toBeVisible();
  await expect(loadProject(page)).toBeDisabled();
  expect(api.calls.filter(call=>call.path.endsWith('/context/project')||call.path.endsWith('/context/task'))).toHaveLength(0);
});

test('project and task pagination send exact scopes and replace pages without accepting reviews',async({page})=>{
  const api=await fixture(page);
  api.onProject(async(route,body)=>{
    const value=projectSample();value.project.entity.observation.observed_at=Number.MAX_SAFE_INTEGER;if(!body.cursor){value.page.next_cursor='project-next';value.page.truncated=true;value.page.boundary='continuation';}
    else{value.tasks[0].entity.id='task-next';}
    await route.fulfill({json:envelope(value)});
  });
  api.onTask(async(route,body)=>{
    const value=taskSample();value.task_id='task-next';value.task.entity.id='task-next';value.section='reviews';
    if(!body.cursor){value.page.next_cursor='reviews-next';value.page.truncated=true;value.page.boundary='continuation';}
    await route.fulfill({json:envelope(value)});
  });
  await open(page);await loadProject(page).click();
  await expect(page.getByText('Synthetic checklist fixture',{exact:true})).toBeVisible();
  await page.getByText('project: alpha',{exact:true}).click();
  await expect(page.getByText('9007199254740991 seconds (outside calendar range)',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Next task page',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Context task'})).toHaveValue('task-next');
  await page.getByRole('combobox',{name:'Task context section'}).selectOption('reviews');
  await page.getByRole('button',{name:'Load task context',exact:true}).click();
  await expect(page.getByRole('region',{name:'Task context page'})).toContainText('Completion or acceptance is not inferred.');
  await page.getByRole('button',{name:'Next section page',exact:true}).click();
  await expect(page.getByRole('button',{name:'Next section page',exact:true})).toHaveCount(0);
  expect(api.calls.filter(call=>call.path.endsWith('/context/project')).map(call=>call.body)).toEqual([{project_id:'alpha',limit:20,cursor:null},{project_id:'alpha',limit:20,cursor:'project-next'}]);
  expect(api.calls.filter(call=>call.path.endsWith('/context/task')).map(call=>call.body)).toEqual([{project_id:'alpha',task_id:'task-next',section:'reviews',limit:20,cursor:null},{project_id:'alpha',task_id:'task-next',section:'reviews',limit:20,cursor:'reviews-next'}]);
  expect(api.calls.every(call=>call.path==='/api/bootstrap'||call.path.startsWith('/api/company/'))).toBe(true);
});

test('a changed snapshot discards the page and requires an explicit first-page reload',async({page})=>{
  const api=await fixture(page);let firstReads=0;
  api.onProject(async(route,body)=>{
    if(body.cursor)return route.fulfill({status:409,json:{error:{code:'COMPANY_SNAPSHOT_CHANGED',message:'Snapshot changed',restartRequired:true}}});
    firstReads++;const value=projectSample();value.page.next_cursor='stale-next';value.page.truncated=true;value.page.boundary='continuation';await route.fulfill({json:envelope(value)});
  });
  await open(page);await loadProject(page).click();await page.getByRole('button',{name:'Next task page',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Reload from the first page');
  await expect(page.getByText('Synthetic checklist fixture',{exact:true})).toHaveCount(0);
  expect(firstReads).toBe(1);
  await page.getByRole('button',{name:'Reload project from first page',exact:true}).click();
  await expect(page.getByText('Synthetic checklist fixture',{exact:true})).toBeVisible();expect(firstReads).toBe(2);
});

test('late project and section responses cannot overwrite a newer selection',async({page})=>{
  const api=await fixture(page);let release:(()=>Promise<void>)|undefined;
  api.onProject(async(route)=>new Promise<void>(resolve=>{release=async()=>{await route.fulfill({json:envelope(projectSample())}).catch(()=>{});resolve();};}));
  await open(page);await loadProject(page).click();await expect.poll(()=>Boolean(release)).toBe(true);
  await page.getByRole('combobox',{name:'Project scope'}).selectOption('beta');await release!();
  await expect(page.getByText('Synthetic checklist fixture',{exact:true})).toHaveCount(0);
  api.onProject(async route=>{await route.fulfill({json:envelope(projectSample())});});
  await page.getByRole('combobox',{name:'Project scope'}).selectOption('alpha');await loadProject(page).click();
  release=undefined;api.onTask(async route=>new Promise<void>(resolve=>{release=async()=>{const value=taskSample();value.section='dependencies';await route.fulfill({json:envelope(value)}).catch(()=>{});resolve();};}));
  await page.getByRole('button',{name:'Load task context',exact:true}).click();await expect.poll(()=>Boolean(release)).toBe(true);
  await page.getByRole('combobox',{name:'Task context section'}).selectOption('reviews');await release!();
  await expect(page.getByRole('region',{name:'Task context page'})).toHaveCount(0);
});

test('control service artifact metadata keeps its producer origin without employee attribution',async({page})=>{
  const api=await fixture(page);api.onTask(async route=>{
    const value=taskSample();value.section='artifacts';value.items=[structuredClone(samples.standalone_artifact_metadata.dto) as any];value.page.returned_count=1;
    await route.fulfill({json:envelope(value)});
  });
  await open(page);await loadProject(page).click();await page.getByRole('combobox',{name:'Task context section'}).selectOption('artifacts');await page.getByRole('button',{name:'Load task context',exact:true}).click();
  const context=page.getByRole('region',{name:'Task context page'});
  await expect(context).toContainText('Producer origin: Company control service');await expect(context).toContainText('Employee, task and attempt attribution: none');
  await expect(context).toContainText('Media verification and download: unavailable');
  await expect(context.getByRole('link')).toHaveCount(0);await expect(context.getByRole('button')).toHaveCount(0);
  await context.getByText(/^artifact:/).click();await expect(context).toContainText('synthetic_contract');
});

function dependencies(taskId='task-demo', prerequisite='task-source'): TaskContextResponse {
  const value=taskSample();value.task_id=taskId;value.task.entity.id=taskId;value.section='dependencies';
  const entity=structuredClone(value.task.entity);entity.id=prerequisite;
  value.items=[{entity,state:'waiting_for_evidence',expected_target_digest:{status:'unavailable',value:null}} satisfies ContextDependency];
  value.page.returned_count=1;return value;
}

for(const code of ['COMPANY_AUTH','COMPANY_FORBIDDEN','AUTH_REQUIRED']) {
  test(`context ${code} withdraws cached records and cursors while keeping local notes`,async({page})=>{
    const api=await fixture(page);
    api.onTask(async route=>{
      const value=dependencies();value.page.next_cursor='private-deps-next';value.page.truncated=true;value.page.boundary='continuation';
      await route.fulfill({json:envelope(value)});
    });
    await open(page);await loadProject(page).click();
    await page.getByRole('button',{name:'Load task context',exact:true}).click();
    await expect(page.getByRole('button',{name:'Next section page',exact:true})).toBeVisible();
    await page.getByRole('textbox',{name:'Owner notes',exact:true}).fill('Keep my unsent local notes.');
    api.onTask(async route=>{await route.fulfill({status:503,json:{error:{code,message:'Synthetic access withdrawn'}}});});
    await page.getByRole('button',{name:'Next section page',exact:true}).click();
    await expect(page.getByRole('region',{name:'Task context page'})).toHaveCount(0);
    await expect(page.getByText('Synthetic checklist fixture',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Next section page',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Inspect prerequisite task-source',exact:true})).toHaveCount(0);
    await expect(page.getByRole('row',{name:'Hermes 18 0'})).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('Synthetic access withdrawn');
    await expect(page.getByText('Disconnected',{exact:true})).toBeVisible();
    await expect(page.getByRole('textbox',{name:'Owner notes',exact:true})).toHaveValue('Keep my unsent local notes.');
    await page.getByRole('button',{name:'Refresh status',exact:true}).click();
    await expect(page.getByRole('row',{name:'Hermes 18 0'})).toBeVisible();
    await expect(page.getByText('Synthetic checklist fixture',{exact:true})).toHaveCount(0);
    expect(api.calls.every(call=>['/api/bootstrap','/api/company/connection','/api/company/status','/api/company/context/availability','/api/company/context/project','/api/company/context/task'].includes(call.path))).toBe(true);
  });
}

test('status access denial fences a late task response without removing local drafts',async({page})=>{
  const api=await fixture(page);let release:(()=>Promise<void>)|undefined;
  api.onTask(async route=>new Promise<void>(resolve=>{release=async()=>{await route.fulfill({json:envelope(dependencies('task-demo','late-denied-prerequisite'))}).catch(()=>{});resolve();};}));
  await open(page);await loadProject(page).click();
  await page.getByRole('textbox',{name:'Owner notes',exact:true}).fill('Unsent during delayed read');
  await page.getByRole('button',{name:'Load task context',exact:true}).click();await expect.poll(()=>Boolean(release)).toBe(true);
  api.onStatus(async route=>{await route.fulfill({status:503,json:{error:{code:'COMPANY_FORBIDDEN',message:'Synthetic status scope withdrawn'}}});});
  await page.getByRole('button',{name:'Refresh status',exact:true}).click();
  await expect(page.getByRole('row',{name:'Hermes 18 0'})).toHaveCount(0);
  await release!();
  await expect(page.getByRole('region',{name:'Task context page'})).toHaveCount(0);
  await expect(page.getByText('late-denied-prerequisite',{exact:false})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'Owner notes',exact:true})).toHaveValue('Unsent during delayed read');
});

test('context access denial fences an already pending company refresh',async({page})=>{
  const api=await fixture(page);let release:(()=>Promise<void>)|undefined;
  const initialStatus=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/company/status');
  await open(page);const snapshot=await(await initialStatus).json();await loadProject(page).click();
  api.onStatus(async route=>new Promise<void>(resolve=>{release=async()=>{await route.fulfill({json:snapshot}).catch(()=>{});resolve();};}));
  await page.getByRole('button',{name:'Refresh status',exact:true}).click();await expect.poll(()=>Boolean(release)).toBe(true);
  api.onTask(async route=>{await route.fulfill({status:503,json:{error:{code:'COMPANY_AUTH',message:'Synthetic credential revoked'}}});});
  await page.getByRole('button',{name:'Load task context',exact:true}).click();
  await expect(page.getByRole('row',{name:'Hermes 18 0'})).toHaveCount(0);
  await release!();
  await expect(page.getByRole('row',{name:'Hermes 18 0'})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Project context dossier'})).toHaveCount(0);
  await expect(page.getByText('Disconnected',{exact:true})).toBeVisible();
});

test('ordinary context outages retain labeled cached observations and local notes',async({page})=>{
  const api=await fixture(page);api.onTask(async route=>{await route.fulfill({json:envelope(dependencies())});});
  await open(page);await loadProject(page).click();await page.getByRole('button',{name:'Load task context',exact:true}).click();
  await page.getByRole('textbox',{name:'Owner notes',exact:true}).fill('Keep this offline note');
  api.onTask(async route=>{await route.fulfill({status:503,json:{error:{code:'COMPANY_UNAVAILABLE',message:'Synthetic network outage'}}});});
  await page.getByRole('button',{name:'Load task context',exact:true}).click();
  await expect(page.getByRole('region',{name:'Task context page'})).toContainText('task-source');
  await expect(page.getByRole('alert')).toContainText('Synthetic network outage');
  await expect(page.getByText('Previously received context remains visible; freshness is unconfirmed.',{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Owner notes',exact:true})).toHaveValue('Keep this offline note');
});

test('direct prerequisite navigation uses its exact scoped reference without inventing a summary record',async({page})=>{
  const api=await fixture(page);api.onTask(async(route,body)=>{
    const value=dependencies(body.task_id,body.task_id==='task-demo'?'task-source':'task-leaf');
    value.task.state=body.task_id==='task-source'?'source_observed':'queued';
    await route.fulfill({json:envelope(value)});
  });
  await open(page);await loadProject(page).click();await page.getByRole('button',{name:'Load task context',exact:true}).click();
  const graph=page.getByRole('region',{name:'Direct task dependencies'});
  await expect(graph).toContainText('task-demo depends on');
  await expect(graph).toContainText('State: waiting_for_evidence');
  await expect(graph).toContainText('Expected target digest: Unavailable');
  await graph.getByRole('button',{name:'Inspect prerequisite task-source',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Context task'})).toHaveValue('task-source');
  await expect(page.getByRole('option',{name:'task-source · prerequisite reference',exact:true})).toHaveCount(1);
  await expect(page.getByRole('region',{name:'Task context page'})).toContainText('Task state: source_observed');
  expect(api.calls.filter(call=>call.path.endsWith('/context/task')).at(-1)?.body).toEqual({project_id:'alpha',task_id:'task-source',section:'dependencies',limit:20,cursor:null});
  await page.getByRole('button',{name:'Return to task-demo',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Context task'})).toHaveValue('task-demo');
  await expect(graph).toContainText('task-demo depends on');
});

test('returning from a prerequisite fences its late result',async({page})=>{
  const api=await fixture(page);let release:(()=>Promise<void>)|undefined;
  api.onTask(async(route,body)=>{
    if(body.task_id==='task-source')return new Promise<void>(resolve=>{release=async()=>{await route.fulfill({json:envelope(dependencies('task-source','late-prerequisite'))}).catch(()=>{});resolve();};});
    await route.fulfill({json:envelope(dependencies())});
  });
  await open(page);await loadProject(page).click();await page.getByRole('button',{name:'Load task context',exact:true}).click();
  await page.getByRole('button',{name:'Inspect prerequisite task-source',exact:true}).click();await expect.poll(()=>Boolean(release)).toBe(true);
  await expect(page.getByRole('region',{name:'Task context page'})).toHaveCount(0);
  await page.getByRole('button',{name:'Return to task-demo',exact:true}).click();
  await expect(page.getByRole('region',{name:'Direct task dependencies'})).toContainText('task-demo depends on');
  await release!();await expect(page.getByRole('combobox',{name:'Context task'})).toHaveValue('task-demo');
  await expect(page.getByText('late-prerequisite',{exact:false})).toHaveCount(0);
});

test('dependency pagination remains one partial page without inferred critical path or timing',async({page})=>{
  const api=await fixture(page);api.onTask(async(route,body)=>{
    const value=dependencies('task-demo',body.cursor?'second-prerequisite':'first-prerequisite');
    if(!body.cursor){value.page.next_cursor='deps-next';value.page.truncated=true;value.page.boundary='continuation';}
    await route.fulfill({json:envelope(value)});
  });
  await open(page);await loadProject(page).click();await page.getByRole('button',{name:'Load task context',exact:true}).click();
  const context=page.getByRole('region',{name:'Task context page'});
  await expect(context).toContainText('Incomplete result');await expect(context).toContainText('Direct prerequisites on this page only. Critical path unavailable.');
  await expect(context.getByRole('button',{name:'Inspect prerequisite first-prerequisite',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Next section page',exact:true}).click();
  await expect(context.getByRole('button',{name:'Inspect prerequisite second-prerequisite',exact:true})).toBeVisible();
  await expect(context.getByRole('button',{name:'Inspect prerequisite first-prerequisite',exact:true})).toHaveCount(0);
  expect(api.calls.filter(call=>call.path.endsWith('/context/task')).at(-1)?.body).toEqual({project_id:'alpha',task_id:'task-demo',section:'dependencies',limit:20,cursor:'deps-next'});
});
