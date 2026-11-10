import {useEffect,useId,useState} from 'react';
import {ChevronDown,ChevronRight,ListChecks} from 'lucide-react';
import type {ProjectContext} from '../../../packages/contracts/workspace.ts';
import type {Snapshot,Thread} from '../../../packages/contracts/index.ts';
import {ProjectContextCard} from './ProjectContextCard';
import {useProjectContext} from './project-api';
import {PlanStatus} from './PlanStatus';
import {selectPlanRecord} from './plan-visibility';

export function ProjectContextSurface({thread,snapshot,planOpen,onTogglePlan,onShowChanges,onSelectThread,onConnect,onContext,defaultPlanOpen=false}:{thread?:Thread;snapshot:Snapshot;planOpen?:boolean;onTogglePlan?:()=>void;onShowChanges?:()=>void;onSelectThread?:(id:string)=>void;onConnect?:()=>void;onContext?:(context:ProjectContext|null)=>void;defaultPlanOpen?:boolean}){
 const project=useProjectContext((thread as Thread&{projectId?:string}|undefined)?.projectId,thread?.id),[open,setOpen]=useState(defaultPlanOpen),plan=selectPlanRecord(snapshot,thread?.id),planId=useId(),expanded=planOpen??open;
 useEffect(()=>{onContext?.(project.context);},[onContext,project.context]);
 return <div className="project-context-surface">{plan&&<section className="project-context-plan"><button className="project-context-row" aria-expanded={expanded} aria-controls={planId} onClick={onTogglePlan??(()=>setOpen(value=>!value))}><ListChecks size={16}/><span>Task plan</span>{expanded?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button><div id={planId} className="project-plan-expansion" data-open={expanded} inert={!expanded}><div><PlanStatus snapshot={snapshot} threadId={thread?.id}/></div></div></section>}<ProjectContextCard context={project.context} loading={project.loading} error={project.error} threadTitle={thread?.title} onAction={project.action} onSelectThread={onSelectThread} onShowChanges={onShowChanges} onConnect={onConnect}/></div>;
}
