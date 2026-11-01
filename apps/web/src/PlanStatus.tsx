import {useId,useMemo,useState,type CSSProperties} from 'react';
import {Bot,Check,ChevronDown,ChevronRight,Circle,Flag,GitBranch,TriangleAlert} from 'lucide-react';
import type {Snapshot} from '../../../packages/contracts';
import {agentProgress,type AgentJob,type PlanStep} from '../../../packages/contracts/planning';
import {selectPlanRecord} from './plan-visibility';
import {MotionRegion} from './task-motion';
import './plan-status.css';
import {DetachButton} from './desktop-context';

const agentLabels:Record<AgentJob['status'],string>={queued:'Queued',working:'Working',completed:'Completed',needs_review:'Needs review',failed:'Failed',cancelled:'Cancelled',interrupted:'Interrupted'};
const stepLabels:Record<PlanStep['status'],string>={pending:'Pending',working:'In progress',completed:'Completed',blocked:'Blocked'};
const number=(value:number)=>new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(value);

function Requirement({label,completed}:{label:string;completed:boolean}){
  return <li className={completed?'is-complete':''}>{completed?<Check size={13} aria-hidden="true"/>:<Circle size={11} aria-hidden="true"/>}<span>{label}</span><span className="sr-only">{completed?'Complete':'Not complete'}</span></li>;
}
function AgentRow({job,threadId}:{job:AgentJob;threadId?:string}){
  const [desktopError,setDesktopError]=useState('');
  const [open,setOpen]=useState(false),id=useId(),progress=agentProgress(job),radius=17,circumference=2*Math.PI*radius;
  const usage=job.usage;
  return <li className={`plan-agent agent-${job.status}`} data-agent-id={job.id}>
    <button type="button" className="plan-agent-summary" aria-label={`Inspect ${job.name}`} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}>
      <span className={`plan-agent-ring${progress===null?' is-indeterminate':''}`} role="progressbar" aria-label={`${job.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress??undefined} aria-valuetext={progress===null?'Progress not reported':`${progress}%${job.requirements.length?' of requirements completed':' reported by agent'}`}>
        <svg viewBox="0 0 42 42" aria-hidden="true"><circle className="plan-ring-track" cx="21" cy="21" r={radius}/><circle className="plan-ring-value" cx="21" cy="21" r={radius} style={{strokeDasharray:progress===null?'7 5':circumference,strokeDashoffset:progress===null?0:circumference*(1-progress/100)} as CSSProperties}/></svg>
        <Bot size={17} aria-hidden="true"/>
      </span>
      <span className="plan-agent-copy"><strong>{job.name}</strong><span>{job.task}</span></span>
      <span className="plan-agent-state"><span>{agentLabels[job.status]}</span>{progress!==null&&<strong aria-hidden="true">{progress}%</strong>}<ChevronDown size={12} aria-hidden="true"/></span>
    </button>
    {threadId&&<div className="desktop-agent-window"><DetachButton label={job.name} surface={{kind:'agent',threadId,agentId:job.id}} onError={cause=>setDesktopError(cause.message)}/></div>}{desktopError&&<p className="error-text" role="alert">{desktopError}</p>}
    <MotionRegion open={open} id={id} className="plan-agent-details">
      {job.summary&&<p>{job.summary}</p>}{job.error&&<p className="error-text" role="status">{job.error}</p>}
      {job.requirements.length>0?<><p className="plan-progress-basis">{job.completedRequirementIds.length} of {job.requirements.length} requirements complete</p><ul className="plan-requirements">{job.requirements.map(requirement=><Requirement key={requirement.id} label={requirement.label} completed={job.completedRequirementIds.includes(requirement.id)}/>)}</ul></>:<p className="plan-progress-basis">{progress===null?'Progress has not been reported.':'Progress reported by this agent.'}</p>}
      {usage&&(usage.inputTokens!=null||usage.outputTokens!=null||usage.cost!=null)&&<dl className="plan-agent-usage">{usage.inputTokens!=null&&<><dt>Input tokens</dt><dd>{number(usage.inputTokens)}</dd></>}{usage.outputTokens!=null&&<><dt>Output tokens</dt><dd>{number(usage.outputTokens)}</dd></>}{usage.cost!=null&&<><dt>Reported cost</dt><dd>{new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:4}).format(usage.cost)}</dd></>}</dl>}
    </MotionRegion>
  </li>;
}
function StepRow({step,agents,threadId}:{step:PlanStep;agents:AgentJob[];threadId?:string}){
  const [open,setOpen]=useState(step.status==='working'||step.status==='blocked'),id=useId();
  return <li className={`plan-step step-${step.status}`} data-step-id={step.id}>
    <button className="plan-step-summary" type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}><span className="plan-step-node" aria-hidden="true">{step.status==='completed'?<Check size={13}/>:step.status==='blocked'?<TriangleAlert size={12}/>:<span/>}</span><span><strong>{step.title}</strong><small>{stepLabels[step.status]}</small></span><ChevronRight size={14} aria-hidden="true"/></button>
    <MotionRegion open={open} id={id} className="plan-step-details"><ul className="plan-requirements">{step.requirements.map(requirement=><Requirement key={requirement.id} label={requirement.label} completed={requirement.completed}/>)}</ul>{agents.length>0&&<ul className="plan-agents">{agents.map(job=><AgentRow key={job.id} job={job} threadId={threadId}/>)}</ul>}</MotionRegion>
  </li>;
}
export function PlanStatus({snapshot,threadId}:{snapshot:Snapshot;threadId?:string}){
  const record=useMemo(()=>selectPlanRecord(snapshot,threadId),[snapshot.data,threadId]);
  if(!record)return <section className="plan-status plan-empty" aria-label="Task plan"><GitBranch size={23} aria-hidden="true"/><h3>No plan yet</h3><p>The task’s steps and delegated work will appear here when the agent publishes a plan.</p></section>;
  if(!record.plan)return <section className="plan-status plan-empty" aria-label="Task plan"><TriangleAlert size={22} aria-hidden="true"/><h3>Plan unavailable</h3><p>The recorded plan is invalid. Ask the agent to refresh it.</p></section>;
  const plan=record.plan,assigned=new Set(plan.steps.flatMap(step=>step.agentIds??[])),unassigned=plan.agents.filter(job=>!assigned.has(job.id)),complete=plan.steps.filter(step=>step.status==='completed').length;
  return <section className="plan-status" aria-label="Task plan"><header className="plan-status-header"><Flag size={16} aria-hidden="true"/><div><h3>{plan.title}</h3>{plan.steps.length>0&&<p>{complete} of {plan.steps.length} tasks complete</p>}</div></header>{plan.steps.length>0?<ol className="plan-steps">{plan.steps.map(step=><StepRow key={step.id} threadId={threadId} step={step} agents={plan.agents.filter(job=>step.agentIds?.includes(job.id))}/>)}</ol>:<p className="plan-status-note">No task steps have been published.</p>}{unassigned.length>0&&<section className="plan-unassigned" aria-label="Delegated work"><h4>Delegated work</h4><ul className="plan-agents">{unassigned.map(job=><AgentRow key={job.id} job={job} threadId={threadId}/>)}</ul></section>}</section>;
}
