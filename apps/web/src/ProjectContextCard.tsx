import {useState} from 'react';
import {Bot,ChevronDown,ChevronRight,Code2,FileDiff,Folder,GitBranch,GitCommitHorizontal,LoaderCircle,Plus,Server,Terminal} from 'lucide-react';
import type {ProjectContext} from '../../../packages/contracts/workspace.ts';
import './project-context.css';

export interface ProjectContextCardProps {
 context?:ProjectContext|null;loading?:boolean;error?:string;threadTitle?:string;
 onAction?:(type:string,payload?:Record<string,unknown>)=>Promise<void>;
 onSelectThread?:(threadId:string)=>void;onShowChanges?:()=>void;onConnect?:()=>void;
}
/** Data and callbacks only: this card is safe to consume from either authority's shell. */
export function ProjectContextCard({context,loading,error,threadTitle,onAction,onSelectThread,onShowChanges,onConnect}:ProjectContextCardProps){
 const [expanded,setExpanded]=useState<'scripts'|'branch'|'commit'|'lineage'|null>(null),[busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[scriptName,setScriptName]=useState(''),[scriptCommand,setScriptCommand]=useState(''),[branch,setBranch]=useState(''),[commit,setCommit]=useState('');
 const run=(type:string,payload:Record<string,unknown>={})=>{if(!onAction||busy)return;setBusy(true);setActionError('');void onAction(type,payload).then(()=>{setExpanded(null);setCommit('');}).catch(cause=>setActionError(cause instanceof Error?cause.message:'The project action could not finish.')).finally(()=>setBusy(false));};
 const toggle=(name:NonNullable<typeof expanded>)=>setExpanded(value=>value===name?null:name);
 const connected=Boolean(context);
 const total=(value:number)=>new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(value);
 const lineage=context?.lineage.toSorted((a,b)=>Number(b.status==='working')-Number(a.status==='working'))??[];
 return <div className="project-context-card" aria-label="Project context">
  {loading&&!context?<p className="project-context-note" role="status"><LoaderCircle size={14} className="spinning"/>Reading project…</p>:<>
   <section className="project-context-section project-context-overview">
    <div className="project-context-machine"><Folder size={16}/><strong title={context?.project.rootPath}>{context?.project.name??threadTitle??'Project context'}</strong></div>
    {!connected?<>{onConnect?<button className="project-context-row" onClick={onConnect}><Plus size={15}/><span>Connect project</span></button>:<p className="project-context-note">No project connected.</p>}</>:context&&<>
     {context.branch&&<><button className="project-context-row" disabled={busy||!context.capabilities.git||!onAction} aria-expanded={expanded==='branch'} onClick={()=>toggle('branch')}><GitBranch size={16}/><span title={context.branch}>{context.branch}</span><ChevronDown size={13}/></button>
      {expanded==='branch'&&<form className="project-context-detail" onSubmit={event=>{event.preventDefault();run('branch',{name:branch,expectedHead:context.head,revision:context.revision});}}><label>New branch<input value={branch} onChange={event=>setBranch(event.target.value)} required maxLength={200}/></label><button className="secondary" disabled={busy||!branch.trim()}>Create branch</button></form>}</>}
     <button className="project-context-row" disabled={!onShowChanges} onClick={onShowChanges} title={context.changes.files===null?'Changes unavailable':context.changes.files+' changed files'}><FileDiff size={16}/><span>Changes</span>
      {context.changes.added===null&&context.changes.removed===null?<small>Unavailable</small>:<>{context.changes.added!==null&&<small className="project-added">+{total(context.changes.added)}</small>}{context.changes.removed!==null&&<small className="project-removed">−{total(context.changes.removed)}</small>}</>}
     </button>
    </>}
   </section>
   {context&&connected&&<details className="project-context-tools"><summary>Project tools<ChevronDown size={13}/></summary><div className="project-context-detail">
    <div className="project-context-machine"><Server size={15}/><strong title={context.machineName}>{context.machineName}</strong></div>
    {context.editor.available&&<button className="project-context-row" disabled={busy||!onAction} onClick={()=>run('open-editor')}><Code2 size={16}/><span>Open in {context.editor.label}</span><ChevronRight size={13}/></button>}
    {context.capabilities.terminal&&<><button className="project-context-row" disabled={busy||!onAction} aria-expanded={expanded==='scripts'} onClick={()=>toggle('scripts')}><Plus size={15}/><span>Add project script</span><ChevronDown size={13}/></button>
     {expanded==='scripts'&&<form onSubmit={event=>{event.preventDefault();run('add-script',{name:scriptName,command:scriptCommand});}}><label>Script name<input value={scriptName} onChange={event=>setScriptName(event.target.value)} required maxLength={100}/></label><label>Command<input value={scriptCommand} onChange={event=>setScriptCommand(event.target.value)} required maxLength={4000}/></label><button className="secondary" disabled={busy||!scriptName.trim()||!scriptCommand.trim()}>Add script</button></form>}
     {context.scripts.map(script=><button key={script.id} className="project-context-row project-script-row" title={script.command} disabled={busy||!onAction} onClick={()=>run('run-script',{scriptId:script.id})}><Terminal size={14}/><span>{script.name}</span><ChevronRight size={13}/></button>)}
    </>}
    {context.capabilities.git&&<><button className="project-context-row" disabled={busy||!onAction} title={context.head??undefined} aria-expanded={expanded==='commit'} onClick={()=>toggle('commit')}><GitCommitHorizontal size={16}/><span>Commit</span><ChevronDown size={13}/></button>
     {expanded==='commit'&&<form onSubmit={event=>{event.preventDefault();run('commit',{message:commit,expectedHead:context.head,revision:context.revision});}}><label>Commit message<input value={commit} onChange={event=>setCommit(event.target.value)} required maxLength={4000}/></label><button className="secondary" disabled={busy||!commit.trim()}>Commit changes</button></form>}
    </>}
   </div></details>}
   {lineage.length>0&&<section className="project-context-section"><button className="project-context-row" aria-expanded={expanded==='lineage'} onClick={()=>toggle('lineage')}><Bot size={16}/><span>Previous agents</span><small>{lineage.length}</small><ChevronRight size={13}/></button>{expanded==='lineage'&&<div className="project-context-lineage">{lineage.map(item=><button key={item.id} disabled={!onSelectThread} onClick={()=>onSelectThread?.(item.id)} title={item.title+' · '+item.status}><span>{item.title}</span><small>{item.status==='working'?'Working':item.status==='awaiting_input'?'Your input':item.status}</small></button>)}</div>}</section>}
  </>}
  {(error||context?.error||actionError)&&<p role="alert" className="project-context-note error-text">{actionError||error||context?.error}</p>}
 </div>;
}
