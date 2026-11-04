import {_electron,expect,type ElectronApplication,type Page} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {Store} from '../packages/storage/store.ts';
import {ProjectTools} from '../packages/workspace/tools.ts';
import type {GitStatus} from '../packages/workspace/tools.ts';
import {WorkspaceRepository} from '../packages/core/workspace-layout.ts';
import type {Thread} from '../packages/contracts/index.ts';
import type {WorkspaceEnvelope,PanelPlacement} from '../packages/contracts/workspace.ts';
import {desktopSurfaceKey,type DesktopSurface} from '../packages/desktop-contract/index.ts';
import {processEnvironment} from '../packages/capabilities/process.ts';

// Run only in the nominated combined native checkpoint window, after the candidate is built.
// No model credentials, remote GitHub calls, browser bridge fixtures, or customer databases are used.
if(process.env.HARNESS_WORKSPACE_CHECKPOINT_NATIVE!=='1')throw Error('Native checkpoint is gated. Set HARNESS_WORKSPACE_CHECKPOINT_NATIVE=1 only in the nominated verification window.');
const root=resolve('.'),directory=resolve('.harness-gen-v1-workspace/checkpoint/native-'+Date.now());
await mkdir(directory,{recursive:true});
const executable=process.argv[2]?resolve(process.argv[2]):undefined;
const sourceFiles=['apps/web/src/App.tsx','apps/web/src/WorkspaceSurfaceBody.tsx','packages/core/workspace-layout.ts','packages/workspace/terminal.ts','packages/workspace/tools.ts','scripts/verify-workspace-checkpoint.ts'];
const sources=await Promise.all(sourceFiles.map(async file=>({file,sha256:createHash('sha256').update(await readFile(join(root,file))).digest('hex')})));
const checks:{name:string;passed:boolean;details?:unknown}[]=[],diagnostics:unknown[]=[];
const terminalOpens:{url:string;request:Record<string,unknown>;result:TerminalRead}[]=[];
const blockers=['Live agent/model execution and task run cancellation are not exercised: tasks are prepared, pinned fixture threads with inference=false.','Company mode is verified by its separate owner during the same combined window.'];
let app:ElectronApplication|undefined,ownedProcess:ChildProcess|undefined,startupLog='',failure:string|undefined;
const store=new Store(join(directory,'host')),tools=new ProjectTools(store),workspace=new WorkspaceRepository(store);
type Owner={threadId:string;projectId:string;title:string;source:string;worktree:string;terminalPanelId:string;terminalId:string};
const owners:Owner[]=[];
const git=(path:string,...args:string[])=>execFileSync('git',['-c','core.hooksPath='+join(directory,'empty-hooks'),'-c','commit.gpgsign=false','-C',path,...args],{windowsHide:true,encoding:'utf8',env:processEnvironment()}).trim();
const stamp=new Date().toISOString();
try{
 for(const name of ['Alpha','Beta']){
  const source=join(directory,'projects',name);await mkdir(source,{recursive:true});
  git(source,'init');git(source,'config','user.name','Native checkpoint fixture');git(source,'config','user.email','checkpoint@example.invalid');
  await writeFile(join(source,'checkpoint.txt'),name+' baseline\n');git(source,'add','checkpoint.txt');git(source,'commit','-m','Local checkpoint baseline');
  const threadId='checkpoint-'+name.toLowerCase(),thread:Thread={id:threadId,title:name+' prepared agent',projectName:null,createdAt:stamp,updatedAt:stamp,status:'ready',epoch:0,runId:null,modelId:null,sessionPath:null,kind:'main',presentation:{pinned:true}};
  store.internal('checkpoint.prepared-thread',threadId,()=>store.put('thread',threadId,threadId,thread));
  await tools.connect({id:randomUUID(),type:'workspace.project.connect',payload:{name:name+' checkpoint',path:source,threadId}});
  const enrolled=store.get<Thread>('thread',threadId)!;await tools.prepareWorkspace(enrolled);
  const binding=await tools.binding(enrolled.projectId!,threadId);expect(binding.workspace).toBeTruthy();
  await writeFile(join(binding.path,'checkpoint.txt'),name+' prepared local change\n');
  owners.push({threadId,projectId:enrolled.projectId!,title:thread.title,source,worktree:binding.path,terminalPanelId:'checkpoint-terminal-'+name.toLowerCase(),terminalId:''});
 }
 workspace.command({id:randomUUID(),type:'workspace.canvas.create',payload:{name:'All agents checkpoint',preset:'all-agents'}});
 let envelope=workspace.read(),canvas=envelope.state.canvases.find(value=>value.id===envelope.state.activeCanvasId)!;
 workspace.command({id:randomUUID(),type:'workspace.canvas.viewport',payload:{canvasId:canvas.id,x:0,y:0,zoom:.55}});
 const ordered=[...owners].sort((a,b)=>a.projectId.localeCompare(b.projectId));
 for(const [index,owner]of ordered.entries())workspace.command({id:randomUUID(),type:'workspace.panel.add',payload:{canvasId:canvas.id,panel:{id:owner.terminalPanelId,kind:'terminal',binding:{authority:{kind:'local'},threadId:owner.threadId,projectId:owner.projectId}},bounds:{x:600,y:index*704+56,width:560,height:620}}});
 envelope=workspace.read();canvas=envelope.state.canvases.find(value=>value.id===envelope.state.activeCanvasId)!;
 for(const owner of owners)owner.terminalId=canvas.panels.find(panel=>panel.id===owner.terminalPanelId)!.binding.terminalId!;
 expect(owners[0].terminalId).toBeTruthy();expect(owners[0].terminalId).not.toBe(owners[1].terminalId);
 store.internal('checkpoint.settings',null,()=>store.put('settings','global',null,{theme:'dark',modelId:null,preferences:{composerPredictions:false}}));
 await writeFile(join(directory,'prepared-fixture.json'),JSON.stringify({fixture:true,inference:false,owners,canvasId:canvas.id,sources,blockers},null,2));
}finally{await tools.dispose();store.close();}

const profile=join(directory,'empty-user-profile');await mkdir(profile,{recursive:true});
const systemEnvironment=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|pathext|comspec|systemroot|windir|systemdrive|temp|tmp|processor_architecture|number_of_processors|lang|lc_all)$/i.test(key)));
const env=Object.fromEntries(Object.entries({...systemEnvironment,HOME:profile,USERPROFILE:profile,APPDATA:join(profile,'Roaming'),LOCALAPPDATA:join(profile,'Local'),HARNESS_DESKTOP_TEST_DATA_DIR:directory,HARNESS_DESKTOP_NODE_PATH:process.execPath,HARNESS_DESKTOP_HOST_ROOT:root,HARNESS_DESKTOP_PORT:process.env.HARNESS_CHECKPOINT_PORT??'4357',HARNESS_DESKTOP_WIDGET_PORT:process.env.HARNESS_CHECKPOINT_WIDGET_PORT??'4358'}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
if(executable){delete env.HARNESS_DESKTOP_NODE_PATH;delete env.HARNESS_DESKTOP_HOST_ROOT;}
type TerminalRead={id:string;projectId:string;threadId?:string;output:string;exited:boolean;exitCode:number|null};
async function api<T>(page:Page,url:string,body?:unknown):Promise<T>{return page.evaluate(async({url,body})=>{const bootstrap=await fetch('/api/bootstrap',{credentials:'same-origin'}).then(response=>response.json());const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','x-harness-csrf':bootstrap.csrfToken},body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw Error(value.error?.code+': '+value.error?.message);return value;},{url,body});}
const terminalUrl=(owner:Owner)=>'/api/terminals/'+encodeURIComponent(owner.terminalId)+'?'+new URLSearchParams({projectId:owner.projectId,threadId:owner.threadId});
const terminalCommand=(page:Page,owner:Owner,input:Record<string,unknown>)=>api<TerminalRead>(page,'/api/terminals/'+encodeURIComponent(owner.terminalId)+'/commands',{projectId:owner.projectId,threadId:owner.threadId,...input});
const nativeState=async(page:Page)=>(await app!.browserWindow(page)).evaluate(window=>({id:window.id,bounds:window.getBounds(),visible:window.isVisible(),minimized:window.isMinimized()}));
async function detach(main:Page,panelId:string,surface:DesktopSurface){
 await main.locator(`[data-panel-id="${panelId}"] > header`).getByRole('button',{name:/^Detach /}).click();
 const key=desktopSurfaceKey(surface);
 await expect.poll(()=>main.evaluate(async key=>(await window.harnessDesktop!.list()).some(info=>{
  const value=info.surface;return [value.kind,'threadId'in value?value.threadId:'','artifactId'in value?value.artifactId:'','agentId'in value?value.agentId:'','browserId'in value?value.browserId:'','tab'in value?value.tab:'',...('panelId'in value?[value.panelId]:[])].join('|')===key&&info.ready;
 }),key),{timeout:25000}).toBe(true);
 const info=(await main.evaluate(()=>window.harnessDesktop!.list())).find(value=>desktopSurfaceKey(value.surface)===key)!;
 await expect.poll(()=>app!.windows().some(page=>page.url().includes(info.id)),{timeout:15000}).toBe(true);
 const page=app!.windows().find(page=>page.url().includes(info.id))!;await page.waitForLoadState('domcontentloaded');
 expect((await page.evaluate(()=>window.harnessDesktop!.getContext())).surface).toEqual(surface);
 return{page,info,native:await nativeState(page)};
}
async function dock(page:Page){await page.getByRole('button',{name:'Dock window',exact:true}).click().catch(error=>{if(!page.isClosed())throw error;});await expect.poll(()=>page.isClosed(),{timeout:20000}).toBe(true);}
async function journal(page:Page,key:string){return page.evaluate(key=>new Promise<unknown>((accept,reject)=>{const opened=indexedDB.open('generative-harness-journal',1);opened.onerror=()=>reject(opened.error);opened.onsuccess=()=>{const db=opened.result,read=db.transaction('entries').objectStore('entries').get(key);read.onsuccess=()=>{accept(read.result?.value);db.close();};read.onerror=()=>{reject(read.error);db.close();};};}),key);}
try{
 app=await _electron.launch({...(executable?{executablePath:executable,args:[]}:{args:[resolve('dist/desktop-app/main.mjs')]}),env,timeout:45000});
 ownedProcess=app.process();ownedProcess.stderr?.on('data',bytes=>{startupLog=(startupLog+String(bytes)).slice(-24000);});
 const observe=(page:Page)=>{page.on('pageerror',error=>diagnostics.push({url:page.url(),error:error.message}));page.on('console',message=>{if(message.type()==='error')diagnostics.push({url:page.url(),console:message.text()});});page.on('response',response=>{const path=new URL(response.url()).pathname;if(response.request().method()==='POST'&&path==='/api/terminals')void response.json().then(result=>terminalOpens.push({url:page.url(),request:response.request().postDataJSON(),result})).catch(error=>diagnostics.push({terminalOpenError:String(error)}));if(path==='/api/workspace/commands'&&response.status()>=400)void response.json().then(result=>diagnostics.push({workspaceCommandFailure:{url:page.url(),status:response.status(),request:response.request().postDataJSON(),result}})).catch(error=>diagnostics.push({workspaceCommandDiagnosticError:String(error)}));});};
 app.on('window',observe);for(const page of app.windows())observe(page);
 const main=await app.firstWindow({timeout:75000});await main.waitForURL(url=>url.searchParams.has('desktopWindow'),{timeout:30000});await main.waitForLoadState('domcontentloaded');
 const mainNative=await nativeState(main);await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id)!.setBounds({width:1600,height:1080}),mainNative.id);
 await expect(main.getByRole('region',{name:'All agents checkpoint canvas',exact:true})).toBeVisible({timeout:30000});
 const envelope=await api<WorkspaceEnvelope>(main,'/api/workspace'),canvas=envelope.state.canvases.find(value=>value.id===envelope.state.activeCanvasId)!;
 const threadPanel=(owner:Owner)=>`live-thread:${canvas.id}:${owner.threadId}`;
 const draft=(owner:Owner)=>main.locator(`[data-panel-id="${threadPanel(owner)}"]`).getByRole('textbox',{name:'Message',exact:true});
 await expect(main.locator('.canvas-project-label')).toHaveCount(2);
 for(const owner of owners){await expect(draft(owner)).toBeEnabled();await draft(owner).fill(owner.title+' independent unsent draft');await expect.poll(()=>journal(main,'draft:'+owner.threadId)).toBe(owner.title+' independent unsent draft');}
 checks.push({name:'Real All Agents has two project rows and independently durable prepared-thread drafts',passed:true,details:{main:await nativeState(main),owners}});
 for(const owner of owners){await expect(main.locator(`[data-panel-id="${owner.terminalPanelId}"] .xterm`)).toBeVisible();await expect.poll(()=>api<TerminalRead>(main,terminalUrl(owner))).toMatchObject({id:owner.terminalId,threadId:owner.threadId,projectId:owner.projectId,exited:false});await terminalCommand(main,owner,{type:'input',data:'echo CHECKPOINT_'+owner.threadId+'\r'});await expect.poll(async()=>(await api<TerminalRead>(main,terminalUrl(owner))).output).toContain('CHECKPOINT_'+owner.threadId);}
 const [alpha,beta]=owners;
 const thread=await detach(main,threadPanel(alpha),{kind:'thread',threadId:alpha.threadId});
 await expect(thread.page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue(alpha.title+' independent unsent draft');
 await thread.page.getByRole('textbox',{name:'Message',exact:true}).fill('Alpha draft edited in real detached window');
 await expect.poll(()=>journal(thread.page,'draft:'+alpha.threadId)).toBe('Alpha draft edited in real detached window');
 await dock(thread.page);await expect(draft(alpha)).toHaveValue('Alpha draft edited in real detached window');await expect(draft(beta)).toHaveValue(beta.title+' independent unsent draft');
 checks.push({name:'Native thread detach/dock preserves exact task identity and independent drafts',passed:true,details:{bridgeWindowId:thread.info.id,native:thread.native,surface:thread.info.surface}});
 const terminal=await detach(main,alpha.terminalPanelId,{kind:'workspace',panelId:alpha.terminalPanelId,tab:'terminal',threadId:alpha.threadId});
 await expect(terminal.page.locator('.xterm')).toBeVisible();
 await expect.poll(()=>terminalOpens.find(open=>open.url===terminal.page.url()&&open.request.terminalId===alpha.terminalId)).toMatchObject({request:{projectId:alpha.projectId,threadId:alpha.threadId,terminalId:alpha.terminalId},result:{id:alpha.terminalId,projectId:alpha.projectId,threadId:alpha.threadId}});
 const terminalBefore=await api<TerminalRead>(main,terminalUrl(alpha));expect(terminalBefore.id).toBe(alpha.terminalId);
 const terminalInput=terminal.page.locator('.xterm-helper-textarea');await terminalInput.focus();await terminalInput.pressSequentially('echo DETACHED_SAME_PTY');await terminalInput.press('Enter');await expect.poll(async()=>(await api<TerminalRead>(terminal.page,terminalUrl(alpha))).output).toContain('DETACHED_SAME_PTY');
 await dock(terminal.page);expect((await api<TerminalRead>(main,terminalUrl(alpha))).id).toBe(alpha.terminalId);
 checks.push({name:'Native terminal detach/dock retains the same real host PTY reference and output',passed:true,details:{bridgeWindowId:terminal.info.id,native:terminal.native,surface:terminal.info.surface,terminalId:alpha.terminalId}});
 // Exercise the actual owner toolbar while a different outer conversation is selected.
 await main.locator('.thread-item').filter({hasText:beta.title}).click();
 await main.locator(`[data-panel-id="${threadPanel(alpha)}"]`).getByRole('button',{name:'Inspect changes',exact:true}).click();
 let diffPanel:PanelPlacement|undefined;
 await expect.poll(async()=>{const next=await api<WorkspaceEnvelope>(main,'/api/workspace');diffPanel=next.state.canvases.flatMap(value=>value.panels).find(panel=>panel.kind==='diff'&&panel.binding.threadId===alpha.threadId);return Boolean(diffPanel);}).toBe(true);
 expect(diffPanel!.binding).toMatchObject({projectId:alpha.projectId,threadId:alpha.threadId,liveProject:false});
 const current=await api<WorkspaceEnvelope>(main,'/api/workspace');
 await api(main,'/api/workspace/commands',{id:randomUUID(),type:'workspace.panel.update',payload:{baseRevision:current.state.revision,panelId:diffPanel!.id,patch:{bounds:{x:1176,y:56,width:560,height:620}}}});
 await main.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));
 const status=await api<GitStatus>(main,'/api/projects/'+alpha.projectId+'/git?threadId='+alpha.threadId);
 await expect(main.locator(`[data-panel-id="${diffPanel!.id}"] .review-revision`)).toHaveAttribute('title',status.revision);
 const review=await detach(main,diffPanel!.id,{kind:'workspace',panelId:diffPanel!.id,tab:'diff',threadId:alpha.threadId});
 await expect(review.page.locator('.review-revision')).toHaveAttribute('title',status.revision);
 await expect(review.page.locator('.live-diff')).toContainText('Alpha prepared local change');
 await dock(review.page);await expect(main.locator(`[data-panel-id="${diffPanel!.id}"] .review-revision`)).toHaveAttribute('title',status.revision);
 checks.push({name:'Owner Changes callback and native review preserve exact project/task/review revision',passed:true,details:{bridgeWindowId:review.info.id,native:review.native,surface:review.info.surface,head:status.head,revision:status.revision}});
 // An ordinary edit makes the displayed review stale; the real host must refuse staging it.
 await writeFile(join(alpha.worktree,'checkpoint.txt'),'Alpha newer unreviewed content\n');
 const reviewTile=main.locator(`[data-panel-id="${diffPanel!.id}"]`);await reviewTile.getByRole('button',{name:'Stage',exact:true}).click();
 await expect(reviewTile.getByRole('alert')).toContainText(/changed|revision/i);
 const afterRefusal=await api<GitStatus>(main,'/api/projects/'+alpha.projectId+'/git?threadId='+alpha.threadId);expect(afterRefusal.files.some(file=>file.staged)).toBe(false);
 expect(await readFile(join(alpha.worktree,'checkpoint.txt'),'utf8')).toBe('Alpha newer unreviewed content\n');
 await expect(draft(alpha)).toHaveValue('Alpha draft edited in real detached window');await expect(draft(beta)).toHaveValue(beta.title+' independent unsent draft');
 checks.push({name:'Real stale Git review refusal preserves unreviewed file and both drafts',passed:true,details:{reviewedRevision:status.revision,currentRevision:afterRefusal.revision}});
 // Unsent local PR fields exercise the new journal path without signing in or publishing.
 const prPanelId='checkpoint-pr-alpha',beforePR=await api<WorkspaceEnvelope>(main,'/api/workspace');
 await api(main,'/api/workspace/commands',{id:randomUUID(),type:'workspace.panel.add',payload:{baseRevision:beforePR.state.revision,canvasId:canvas.id,panel:{id:prPanelId,kind:'pull-request',binding:{authority:{kind:'local'},projectId:alpha.projectId,threadId:alpha.threadId}},bounds:{x:1176,y:56,width:560,height:620}}});
 await main.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));
 const prTile=main.locator(`[data-panel-id="${prPanelId}"]`),prKey='pr-panel:'+JSON.stringify(['local',alpha.projectId,alpha.threadId,'pull-request',prPanelId]);
 await expect(prTile.getByRole('button',{name:'New draft PR',exact:true})).toBeEnabled({timeout:30000});await prTile.getByRole('button',{name:'New draft PR',exact:true}).click();
 await prTile.getByRole('textbox',{name:'Title',exact:true}).fill('Native unsent PR title');await prTile.getByRole('textbox',{name:'Description',exact:true}).fill('Native unsent description\nSecond line');await prTile.getByRole('textbox',{name:'Base branch',exact:true}).fill('release');await prTile.getByRole('checkbox',{name:'Push this reviewed branch to GitHub'}).check();
 await expect(prTile.getByRole('button',{name:'Create draft PR',exact:true})).toBeDisabled();
 const unsent={title:'Native unsent PR title',body:'Native unsent description\nSecond line',baseBranch:'release',push:true,basis:{head:afterRefusal.head,revision:afterRefusal.revision,files:afterRefusal.files.length}};
 await expect.poll(()=>journal(main,prKey)).toMatchObject(unsent);
 const prWindow=await detach(main,prPanelId,{kind:'workspace',panelId:prPanelId,tab:'pull-request',threadId:alpha.threadId});
 await expect(prWindow.page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue(unsent.title);await expect(prWindow.page.getByRole('textbox',{name:'Description',exact:true})).toHaveValue(unsent.body);await expect(prWindow.page.getByRole('textbox',{name:'Base branch',exact:true})).toHaveValue(unsent.baseBranch);await expect(prWindow.page.getByRole('checkbox',{name:'Push this reviewed branch to GitHub'})).toBeChecked();
 await prWindow.page.getByRole('textbox',{name:'Description',exact:true}).fill('Native detached unsent description');await dock(prWindow.page);
 await expect(prTile.getByRole('textbox',{name:'Description',exact:true})).toHaveValue('Native detached unsent description');await expect.poll(()=>journal(main,prKey)).toMatchObject({...unsent,body:'Native detached unsent description'});
 await expect(draft(alpha)).toHaveValue('Alpha draft edited in real detached window');await expect(draft(beta)).toHaveValue(beta.title+' independent unsent draft');
 checks.push({name:'Native PR detach/dock preserves unsent fields, original review basis and exact panel identity',passed:true,details:{bridgeWindowId:prWindow.info.id,surface:prWindow.info.surface,projectId:alpha.projectId,threadId:alpha.threadId,journalKey:prKey,published:false}});
 const denied=await main.evaluate(async({terminalId,projectId,threadId})=>{const response=await fetch('/api/terminals/'+terminalId+'?'+new URLSearchParams({projectId,threadId}),{credentials:'same-origin'});return{status:response.status,body:await response.json()};},{terminalId:alpha.terminalId,projectId:beta.projectId,threadId:beta.threadId});
 expect(denied.status).toBe(403);expect((await api<TerminalRead>(main,terminalUrl(alpha))).exited).toBe(false);
 const stopped=await terminalCommand(main,alpha,{type:'stop'});expect(stopped.exited).toBe(true);expect((await api<TerminalRead>(main,terminalUrl(beta))).exited).toBe(false);
 await terminalCommand(main,beta,{type:'input',data:'echo BETA_SURVIVED_ALPHA_STOP\r'});await expect.poll(async()=>(await api<TerminalRead>(main,terminalUrl(beta))).output).toContain('BETA_SURVIVED_ALPHA_STOP');
 checks.push({name:'Cross-project PTY access is denied; confirmed stop stays within its own PTY',passed:true,details:{denied,stopped,betaTerminalId:beta.terminalId}});
 for(const owner of owners)expect(git(owner.source,'status','--porcelain')).toBe('');
 await main.screenshot({path:join(directory,'checkpoint-main.png')});
 // No run/model is manufactured to satisfy the unexercised live-agent gate.
 const prepared=await api<{threads:Thread[]}>(main,'/api/snapshot');for(const owner of owners)expect(prepared.threads.find(value=>value.id===owner.threadId)).toMatchObject({status:'ready',runId:null,epoch:0,sessionPath:null});
 checks.push({name:'Prepared fixture threads retain ready/no-run identity throughout native verification',passed:true});
 const finalWorkspace=await api<WorkspaceEnvelope>(main,'/api/workspace');await writeFile(join(directory,'final-workspace.json'),JSON.stringify(finalWorkspace,null,2));
 let closingTimer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([app.close(),new Promise<never>((_,reject)=>{closingTimer=setTimeout(()=>reject(Error('Native shutdown did not complete within 20 seconds.')),20000);})]);}finally{clearTimeout(closingTimer);}
 await expect.poll(()=>ownedProcess!.exitCode!==null||Boolean(ownedProcess!.signalCode),{timeout:10000}).toBe(true);app=undefined;
 const saved=new Store(join(directory,'host'));try{const sessions=saved.all<{id:string;threadId?:string;exited:boolean}>('terminalSession');for(const owner of owners)expect(sessions.find(value=>value.id===owner.terminalId)).toMatchObject({threadId:owner.threadId,exited:true});checks.push({name:'Native shutdown records terminal exits against their original owners',passed:true,details:sessions});}finally{saved.close();}
}catch(error){failure=error instanceof Error?error.stack:String(error);if(app)for(const [index,page]of app.windows().entries()){await page.screenshot({path:join(directory,'failed-window-'+index+'.png')}).catch(()=>{});await writeFile(join(directory,'failed-window-'+index+'.json'),JSON.stringify(await page.evaluate(async()=>({url:location.href,alerts:[...document.querySelectorAll('[role=alert]')].map(value=>value.textContent),context:await window.harnessDesktop?.getContext()})).catch(()=>({closed:true})),null,2));}throw error;
}finally{
 if(app&&ownedProcess){const owned=app,child=ownedProcess;let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([owned.close().catch(()=>{}),new Promise<void>(accept=>{timer=setTimeout(()=>{const pid=child.pid;if(!pid||child.exitCode!==null||child.signalCode){accept();return;}failure??='Owned Electron process required forced cleanup; native close was not confirmed.';diagnostics.push({forcedOwnedProcessCleanup:pid});if(process.platform==='win32'){const kill=spawn('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.once('exit',()=>accept());kill.once('error',()=>accept());}else{child.kill('SIGKILL');accept();}},8000);})]);}finally{clearTimeout(timer);}}
 await writeFile(join(directory,'startup.log'),startupLog);await writeFile(join(directory,'diagnostics.json'),JSON.stringify(diagnostics,null,2));await writeFile(join(directory,'terminal-opens.json'),JSON.stringify(terminalOpens,null,2));
 await writeFile(join(directory,'verification.json'),JSON.stringify({fixture:true,inference:false,mode:'real-native-host',passed:!failure,executable:executable??'development Electron',sources,checks,blockers,...(failure?{failure}:{})},null,2));
 console.log(JSON.stringify({directory,passed:!failure,checks:checks.map(value=>value.name),blockers}));
}
