import {useEffect,useState} from 'react';
import type {ProjectContext} from '../../../packages/contracts/workspace.ts';
import type {Snapshot,Thread} from '../../../packages/contracts/index.ts';
import {ProjectContextCard} from './ProjectContextCard';
import {useProjectContext} from './project-api';
import {PlanStatus} from './PlanStatus';
import {selectPlanRecord} from './plan-visibility';

export function ProjectContextSurface({thread,snapshot,planOpen,onTogglePlan,onShowChanges,onSelectThread,onConnect,onContext,onOpenDetailedPlan,defaultPlanOpen=false,composerChangesAvailable=false}:{thread?:Thread;snapshot:Snapshot;planOpen?:boolean;onTogglePlan?:()=>void;onShowChanges?:()=>void;onSelectThread?:(id:string)=>void;onConnect?:()=>void;onContext?:(context:ProjectContext|null)=>void;onOpenDetailedPlan?:()=>void;defaultPlanOpen?:boolean;composerChangesAvailable?:boolean}){
 const project=useProjectContext((thread as Thread&{projectId?:string}|undefined)?.projectId,thread?.id),[open,setOpen]=useState(defaultPlanOpen),plan=selectPlanRecord(snapshot,thread?.id);
 useEffect(()=>{onContext?.(project.context);},[onContext,project.context]);
 return <ProjectContextCard snapshot={snapshot} threadId={thread?.id} composerChangesAvailable={composerChangesAvailable} onOpenDetailedPlan={onOpenDetailedPlan} context={project.context} loading={project.loading} error={project.error} threadTitle={thread?.title} onAction={project.action} onSelectThread={onSelectThread} onShowChanges={onShowChanges} onConnect={onConnect} plan={plan?<PlanStatus snapshot={snapshot} threadId={thread?.id}/>:undefined} planOpen={planOpen??open} onTogglePlan={onTogglePlan??(()=>setOpen(value=>!value))}/>;
}
