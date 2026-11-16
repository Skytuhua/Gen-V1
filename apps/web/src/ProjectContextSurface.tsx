import {lazy,Suspense,useEffect,useState} from 'react';
import type {ProjectContext} from '../../../packages/contracts/workspace.ts';
import type {Snapshot,Thread} from '../../../packages/contracts/index.ts';
import {ProjectContextCard} from './ProjectContextCard';
import {useProjectContext} from './project-api';
import {PlanStatus} from './PlanStatus';
import {selectPlanRecord} from './plan-visibility';
import './project-memory.css';
const MemoryReview=lazy(()=>import('./ProjectMemoryReview').then(module=>({default:module.ProjectMemoryReview})));

export function ProjectContextSurface({thread,snapshot,planOpen,onTogglePlan,onShowChanges,onSelectThread,onConnect,onContext,onOpenDetailedPlan,defaultPlanOpen=false,composerChangesAvailable=false}:{thread?:Thread;snapshot:Snapshot;planOpen?:boolean;onTogglePlan?:()=>void;onShowChanges?:()=>void;onSelectThread?:(id:string)=>void;onConnect?:()=>void;onContext?:(context:ProjectContext|null)=>void;onOpenDetailedPlan?:()=>void;defaultPlanOpen?:boolean;composerChangesAvailable?:boolean}){
 const project=useProjectContext((thread as Thread&{projectId?:string}|undefined)?.projectId,thread?.id),[open,setOpen]=useState(defaultPlanOpen),[memoryOwner,setMemoryOwner]=useState(''),plan=selectPlanRecord(snapshot,thread?.id);
 const memoryTarget=thread?.projectId&&(!thread.kind||thread.kind==='main')&&!thread.parentThreadId&&!thread.sideParentId&&!thread.jobId?{projectId:thread.projectId,threadId:thread.id,accountId:thread.accountId??null}:undefined;
 const memoryKey=memoryTarget?JSON.stringify(memoryTarget):'',localProject=project.context?.project.authority.kind==='local'&&project.context.project.id===thread?.projectId&&project.context.threadId===thread?.id;
 useEffect(()=>{setMemoryOwner('');},[memoryKey]);
 useEffect(()=>{onContext?.(project.context);},[onContext,project.context]);
 return <><ProjectContextCard key={JSON.stringify([thread?.id,thread?.projectId])} snapshot={snapshot} threadId={thread?.id} composerChangesAvailable={composerChangesAvailable} onOpenDetailedPlan={onOpenDetailedPlan} context={project.context} loading={project.loading} error={project.error} threadTitle={thread?.title} onAction={project.action} onSelectThread={onSelectThread} onShowChanges={onShowChanges} onConnect={onConnect} plan={plan?<PlanStatus snapshot={snapshot} threadId={thread?.id}/>:undefined} planOpen={planOpen??open} onTogglePlan={onTogglePlan??(()=>setOpen(value=>!value))}/>{memoryTarget&&<div className="project-memory-launcher"><button type="button" disabled={!localProject||project.loading||Boolean(project.error)} onClick={()=>setMemoryOwner(memoryKey)}>Project memory</button></div>}{memoryTarget&&memoryOwner===memoryKey&&localProject&&<Suspense fallback={<p role="status">Opening project memory…</p>}><MemoryReview key={memoryKey} owner={memoryTarget} close={()=>setMemoryOwner('')}/></Suspense>}</>;
}
