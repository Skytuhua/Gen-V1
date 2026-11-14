import {useId,useState,type ReactNode} from 'react';
import {Bot,CalendarClock,ChevronDown,ChevronRight,Code2,FileDiff,Folder,GitBranch,GitCommitHorizontal,ListChecks,MessageSquare,Plus,Server,Terminal} from 'lucide-react';
import type {Snapshot} from '../../../packages/contracts/index.ts';
import type {ProjectContext} from '../../../packages/contracts/workspace.ts';
import {contextCompanions} from './project-context-summary';
import {LoadingState,PendingStatus} from './LoadingState';
import './project-context.css';

export interface ProjectContextCardProps {
 context?:ProjectContext|null;loading?:boolean;error?:string;threadTitle?:string;plan?:ReactNode;planOpen?:boolean;onTogglePlan?:()=>void;
 onAction?:(type:string,payload?:Record<string,unknown>)=>Promise<void>;
 onSelectThread?:(threadId:string)=>void;onShowChanges?:()=>void;onConnect?:()=>void;
 /** True only when this owner has a reachable equivalent composer Changes action. */
 composerChangesAvailable?:boolean;
 snapshot?:Snapshot;threadId?:string;onOpenDetailedPlan?:()=>void;
 automationItems?:{id:string;title:string;status:string;nextRunAt?:string}[];automationsAvailable?:boolean;
}
/** Data and callbacks only: this card is safe to consume from either authority's shell. */
export function ProjectContextCard({context,loading,error,threadTitle,plan,planOpen=false,onTogglePlan,onAction,onSelectThread,onShowChanges,onConnect,snapshot,threadId,onOpenDetailedPlan,automationItems=[],automationsAvailable=false,composerChangesAvailable=false}:ProjectContextCardProps){
 const planId=useId(),[expanded,setExpanded]=useState<'scripts'|'branch'|'commit'|'lineage'|null>(null),[busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[scriptName,setScriptName]=useState(''),[scriptCommand,setScriptCommand]=useState(''),[branch,setBranch]=useState(''),[commit,setCommit]=useState('');
 const run=(type:string,payload:Record<string,unknown>={})=>{if(!onAction||busy)return;setBusy(true);setActionError('');void onAction(type,payload).then(()=>{setExpanded(null);setCommit('');}).catch(cause=>setActionError(cause instanceof Error?cause.message:'The project action could not finish.')).finally(()=>setBusy(false));};
 const toggle=(name:NonNullable<typeof expanded>)=>setExpanded(value=>value===name?null:name);
 const connected=Boolean(context&&(context.project.rootPath||context.capabilities.git||context.capabilities.terminal||context.editor.available));
 const total=(value:number)=>new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(value);
 const lineage=context?.lineage.toSorted((a,b)=>Number(b.status==='working')-Number(a.status==='working'))??[];
 const companions=snapshot?contextCompanions(snapshot,threadId):null,agents=companions?.agents??[],sideConversations=companions?.sideConversations??[],summary=companions?.plan;
 const history=lineage.filter(item=>!agents.some(agent=>agent.id===item.id)&&!sideConversations.some(side=>side.id===item.id));
 return <div className="project-context-card" aria-label="Project context">
  <LoadingState pending={Boolean(loading)&&!error} hasContent={Boolean(context)||Boolean(error)} label="Loading project…">
   <section className="project-context-section project-context-overview">
    <div className="project-context-machine"><Folder size={16}/><strong title={context?.project.rootPath}>{context?.project.name??threadTitle??'Project context'}</strong></div>
    {!connected?<>{onConnect?<button className="project-context-row" onClick={onConnect}><Plus size={15}/><span>Connect project</span></button>:<p className="project-context-note">No project connected.</p>}</>:context&&<>
     {context.branch&&<><button className="project-context-row" aria-busy={busy} disabled={busy||!context.capabilities.git||!onAction} aria-expanded={expanded==='branch'} onClick={()=>toggle('branch')}><GitBranch size={16}/><span title={context.branch}>{context.branch}</span><ChevronDown size={13}/></button>
      {expanded==='branch'&&<form className="project-context-detail" onSubmit={event=>{event.preventDefault();run('branch',{name:branch,expectedHead:context.head,revision:context.revision});}}><label>New branch<input value={branch} onChange={event=>setBranch(event.target.value)} required maxLength={200}/></label><button className="secondary" aria-busy={busy} disabled={busy||!branch.trim()}>Create branch</button></form>}</>}
     {!composerChangesAvailable&&<button className="project-context-row" disabled={!onShowChanges} onClick={onShowChanges} title={context.changes.files===null?'Changes unavailable':context.changes.files+' changed files'}><FileDiff size={16}/><span>Changes</span>
      {context.changes.added===null&&context.changes.removed===null?<small>Unavailable</small>:<>{context.changes.added!==null&&<small className="project-added">+{total(context.changes.added)}</small>}{context.changes.removed!==null&&<small className="project-removed">−{total(context.changes.removed)}</small>}</>}
     </button>}
    </>}
   </section>
   {context&&connected&&<details className="project-context-tools"><summary>Project tools<ChevronDown size={13}/></summary><div className="project-context-detail">
    <div className="project-context-machine"><Server size={15}/><strong title={context.machineName}>{context.machineName}</strong></div>
    {context.editor.available&&<button className="project-context-row" aria-busy={busy} disabled={busy||!onAction} onClick={()=>run('open-editor')}><Code2 size={16}/><span>Open in {context.editor.label}</span><ChevronRight size={13}/></button>}
    {context.capabilities.terminal&&<><button className="project-context-row" aria-busy={busy} disabled={busy||!onAction} aria-expanded={expanded==='scripts'} onClick={()=>toggle('scripts')}><Plus size={15}/><span>Add script</span><ChevronDown size={13}/></button>
     {expanded==='scripts'&&<form onSubmit={event=>{event.preventDefault();run('add-script',{name:scriptName,command:scriptCommand});}}><label>Script name<input value={scriptName} onChange={event=>setScriptName(event.target.value)} required maxLength={100}/></label><label>Command<input value={scriptCommand} onChange={event=>setScriptCommand(event.target.value)} required maxLength={4000}/></label><button className="secondary" aria-busy={busy} disabled={busy||!scriptName.trim()||!scriptCommand.trim()}>Add script</button></form>}
     {context.scripts.map(script=><button key={script.id} className="project-context-row project-script-row" title={script.command} aria-busy={busy} disabled={busy||!onAction} onClick={()=>run('run-script',{scriptId:script.id})}><Terminal size={14}/><span>{script.name}</span><ChevronRight size={13}/></button>)}
    </>}
    {context.capabilities.git&&<><button className="project-context-row" aria-busy={busy} disabled={busy||!onAction} title={context.head??undefined} aria-expanded={expanded==='commit'} onClick={()=>toggle('commit')}><GitCommitHorizontal size={16}/><span>Commit</span><ChevronDown size={13}/></button>
     {expanded==='commit'&&<form onSubmit={event=>{event.preventDefault();run('commit',{message:commit,expectedHead:context.head,revision:context.revision});}}><label>Commit message<input value={commit} onChange={event=>setCommit(event.target.value)} required maxLength={4000}/></label><button className="secondary" aria-busy={busy} disabled={busy||!commit.trim()}>Commit changes</button></form>}
    </>}
   </div></details>}
   {(agents.length>0||history.length>0)&&<details className="project-context-group"><summary><Bot size={15}/><span>Agents and history</span><small>{agents.length+history.length}</small><ChevronDown size={13}/></summary><div className="project-context-lineage">{agents.map(item=><button key={item.id} disabled={!onSelectThread} onClick={()=>onSelectThread?.(item.id)}><span>{item.title}</span><small data-agent-status={item.status}>{item.status==='working'?'Working':item.status==='awaiting_input'?'Needs input':item.status==='ready'?'Idle':item.status}</small></button>)}{history.map(item=><button key={item.id} disabled={!onSelectThread} onClick={()=>onSelectThread?.(item.id)} title={item.title+' · '+item.status}><span>{item.title}</span><small>{item.status==='working'?'Working':item.status==='awaiting_input'?'Needs input':item.status}</small></button>)}</div></details>}
   {snapshot&&<details className="project-context-group"><summary><MessageSquare size={15}/><span>Side conversations</span><small>{sideConversations.length}</small><ChevronDown size={13}/></summary>{sideConversations.length?<div className="project-context-lineage">{sideConversations.map(item=><button key={item.id} disabled={!onSelectThread} onClick={()=>onSelectThread?.(item.id)}><span>{item.title}</span><small>{item.status==='working'?'Working':item.status==='awaiting_input'?'Needs input':''}</small></button>)}</div>:<p className="project-context-note">Use /side or /btw.</p>}</details>}
   {snapshot&&<details className="project-context-group"><summary><CalendarClock size={15}/><span>Automations</span><small>{automationsAvailable?automationItems.length:'—'}</small><ChevronDown size={13}/></summary>{automationsAvailable?(automationItems.length?<ul className="project-context-automations">{automationItems.map(item=><li key={item.id}><span>{item.title}</span><small>{item.status}{item.nextRunAt&&<> · <time dateTime={item.nextRunAt}>{new Date(item.nextRunAt).toLocaleString()}</time></>}</small></li>)}</ul>:<p className="project-context-note">No scheduled work.</p>):<p className="project-context-note">No automation service connected.</p>}</details>}
  </LoadingState>
  <PendingStatus pending={busy} label="Updating project…"/>
  {(error||context?.error||actionError)&&<p role="status" className="project-context-note error-text">{actionError||error||context?.error}</p>}
  {summary?<section className="project-context-plan-summary" aria-label="Plan summary" data-plan-revision={summary.revision}><div className="project-context-summary-title"><ListChecks size={15}/><strong>{summary.title}</strong></div>{summary.total>0&&<><div className="project-context-summary-progress" role="progressbar" aria-label="Plan tasks completed" aria-valuemin={0} aria-valuemax={summary.total} aria-valuenow={summary.completed}><span style={{width:`${summary.completed/summary.total*100}%`}}/></div><p>{summary.completed} of {summary.total} tasks complete</p></>}{summary.currentStep&&<p className={summary.blocked?'project-context-summary-blocked':''}>{summary.blocked?'Blocked: ':''}{summary.currentStep}</p>}{onOpenDetailedPlan&&<button type="button" className="quiet" onClick={onOpenDetailedPlan}>Open full plan<ChevronRight size={13}/></button>}</section>:Boolean(plan)&&<section className="project-context-plan"><button className="project-context-row" aria-expanded={planOpen} aria-controls={planId} onClick={onTogglePlan}><ListChecks size={16}/><span>Task plan</span>{planOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button><div id={planId} className="project-plan-expansion" data-open={planOpen} inert={!planOpen}><div>{plan}</div></div></section>}
 </div>;
}
