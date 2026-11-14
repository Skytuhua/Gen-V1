import {useEffect,useId,useRef,useState} from 'react';
import {ArrowUp,Check,ChevronDown,Image,LoaderCircle,MessageSquareMore,Plus,X} from 'lucide-react';
import type {ResourceGrant} from '../../../packages/contracts';
import {PlanningQuestionSchema,type PlanningQuestionDefinition} from '../../../packages/contracts/planning-question';
import {Markdown} from './Markdown';
import {MotionRegion} from './task-motion';
import './planning-question.css';
export type PlanningDetailKind='explain'|'examples';
export type PlanningPending={optionId?:string;kind:PlanningDetailKind|'more-options'};
export type PlanningQuestionProps=PlanningQuestionDefinition&{id:string;revision:number;title:string;prompt?:string;value:string;onChange:(value:string)=>void;resources:ResourceGrant[];onExplain?:(optionId:string,kind:PlanningDetailKind)=>Promise<void>;onMoreOptions?:()=>Promise<void>;onSubmit:()=>Promise<void>;busy?:boolean;error?:string;pending?:PlanningPending};
export function PlanningQuestion({id,revision,title,prompt,options,allowCustom,value,onChange,resources,onExplain,onMoreOptions,onSubmit,busy=false,error,pending}:PlanningQuestionProps){
  const group=useId(),customInput=useRef<HTMLInputElement>(null),composing=useRef(false),operation=useRef(false),submitting=useRef(false);
  const [expanded,setExpanded]=useState<Record<string,PlanningDetailKind|undefined>>({}),[custom,setCustom]=useState(false),[localPending,setLocalPending]=useState<PlanningPending|undefined>(undefined),[localError,setLocalError]=useState('');
  const priorRevision=useRef(revision),priorRequest=useRef(id);
  useEffect(()=>{
    if(priorRequest.current!==id){setExpanded({});setCustom(false);setLocalPending(undefined);setLocalError('');priorRequest.current=id;}
    if(priorRevision.current!==revision){setLocalPending(undefined);operation.current=false;priorRevision.current=revision;}
  },[id,revision]);
  const activePending=pending??localPending;
  useEffect(()=>{if(activePending?.optionId&&activePending.kind!=='more-options')setExpanded(current=>({...current,[activePending.optionId!]:activePending.kind as PlanningDetailKind}));},[activePending?.optionId,activePending?.kind]);
  const parsed=options.length<=12?PlanningQuestionSchema.safeParse({options,allowCustom}):null;
  if(!parsed?.success)return <section className="planning-question" aria-label={title}><p role="status" className="error-text">This question could not be displayed. Ask the agent to refresh its options.</p></section>;
  const customSelected=Boolean(allowCustom&&(custom||value&&!options.some(option=>option.id===value)));
  const select=(selected:string)=>{setCustom(false);onChange(selected);};
  const request=async(kind:PlanningPending['kind'],optionId?:string)=>{
    if(operation.current||activePending||busy)return;
    operation.current=true;setLocalError('');setLocalPending({kind,...(optionId?{optionId}:{})});
    try{if(kind==='more-options')await onMoreOptions?.();else if(optionId)await onExplain?.(optionId,kind);}
    catch(cause){setLocalPending(undefined);operation.current=false;setLocalError(cause instanceof Error?cause.message:'The request failed. Try again.');}
    // Acknowledging the command is not the answer. Keep its pending state until
    // the host publishes a revised question rather than permitting duplicate work.
  };
  const reveal=(optionId:string,kind:PlanningDetailKind)=>{
    const option=options.find(item=>item.id===optionId)!;
    const local=kind==='explain'?Boolean(option.explanation?.trim()):Boolean(option.examples?.length);
    setExpanded(current=>({...current,[optionId]:local&&current[optionId]===kind?undefined:kind}));
    if(!local)void request(kind,optionId);
  };
  const submit=async()=>{if(submitting.current||busy||composing.current)return;submitting.current=true;setLocalError('');try{await onSubmit();}catch(cause){setLocalError(cause instanceof Error?cause.message:'The choice could not be submitted. Try again.');}finally{submitting.current=false;}};
  return <section className="planning-question" aria-label={title}>
    <header className="planning-question-header"><h3>{title}</h3>{prompt&&<Markdown text={prompt}/>}</header>
    <form onSubmit={event=>{event.preventDefault();void submit();}} onKeyDown={event=>{if(event.key==='Enter'&&(composing.current||event.nativeEvent.isComposing)){event.preventDefault();event.stopPropagation();}}}>
      <fieldset className="planning-options" disabled={busy}><legend className="sr-only">{title}</legend>
        {options.map(option=>{
          const detail=expanded[option.id],isPending=activePending?.optionId===option.id&&activePending.kind===detail,detailId=`${group}-${option.id}`;
          return <div className={`planning-option${value===option.id&&!customSelected?' is-selected':''}`} key={option.id}>
            <label className="planning-option-choice"><input type="radio" name={group} value={option.id} aria-label={option.label} checked={!customSelected&&value===option.id} required={!customSelected} onChange={()=>select(option.id)}/><span><strong>{option.label}</strong>{option.description&&<small>{option.description}</small>}</span><Check className="planning-choice-check" size={15} aria-hidden="true"/></label>
            <div className="planning-option-tools"><button type="button" aria-label={`Explain ${option.label}`} aria-expanded={detail==='explain'} aria-controls={detailId} disabled={busy||!option.explanation?.trim()&&(!onExplain||Boolean(activePending))} onClick={()=>reveal(option.id,'explain')}><MessageSquareMore size={12}/><span>Explain more</span><ChevronDown size={11}/></button><button type="button" aria-label={`Examples for ${option.label}`} aria-expanded={detail==='examples'} aria-controls={detailId} disabled={busy||!option.examples?.length&&(!onExplain||Boolean(activePending))} onClick={()=>reveal(option.id,'examples')}><Image size={12}/><span>Examples</span><ChevronDown size={11}/></button></div>
            <MotionRegion open={Boolean(detail)} id={detailId} className="planning-option-detail">
              {detail==='explain'&&option.explanation?<Markdown text={option.explanation}/>:detail==='examples'&&option.examples?.length?<div className="planning-examples">{option.examples.map((example,index)=><PlanningExample key={index} example={example} resources={resources} optionLabel={option.label}/>)}</div>:isPending?<p className="planning-question-pending" role="status"><LoaderCircle size={13} aria-hidden="true"/>{detail==='examples'?'Finding examples…':'Preparing an explanation…'}</p>:null}
            </MotionRegion>
          </div>;
        })}
        {allowCustom&&(customSelected?<div className="planning-custom-option"><label htmlFor={`${group}-custom`}>Your option</label><div><input ref={customInput} id={`${group}-custom`} type="text" value={value} maxLength={4000} required onChange={event=>onChange(event.target.value)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}/><button type="button" className="icon-button" aria-label="Cancel custom option" onClick={()=>{setCustom(false);onChange('');}}><X size={14}/></button></div></div>:<button type="button" className="planning-add-custom" onClick={()=>{setCustom(true);onChange('');requestAnimationFrame(()=>customInput.current?.focus());}}><Plus size={13}/>Add my own option</button>)}
      </fieldset>
      {(error||localError)&&<p role="status" className="error-text planning-question-error">{error||localError}</p>}
      <footer className="planning-question-actions">{onMoreOptions&&<button className="quiet" type="button" disabled={busy||Boolean(activePending)} onClick={()=>void request('more-options')}>{activePending?.kind==='more-options'?<LoaderCircle size={13} className="planning-pending-icon"/>:<Plus size={13}/>}<span>{activePending?.kind==='more-options'?'Finding more options…':'More options'}</span></button>}<button className="primary" disabled={busy||!value.trim()} type="submit">{busy?'Submitting…':'Continue'}<ArrowUp size={14}/></button></footer>
    </form>
  </section>;
}

function PlanningExample({example,resources,optionLabel}:{example:NonNullable<PlanningQuestionDefinition['options'][number]['examples']>[number];resources:ResourceGrant[];optionLabel:string}){
  const [failed,setFailed]=useState(false),resource=example.resourceId?resources.find(grant=>grant.id===example.resourceId):undefined;
  const identity=resource?JSON.stringify([resource.id,resource.threadId,resource.path,resource.identity]):'';
  useEffect(()=>setFailed(false),[identity]);
  return <figure className="planning-example">{example.resourceId&&(resource&&!failed?<img key={identity} src={`/api/resources/${encodeURIComponent(resource.id)}/content`} alt={example.alt||`Example for ${optionLabel}`} loading="lazy" onError={()=>setFailed(true)}/>:<p className="planning-example-unavailable" role="status">{resource?'The example image could not be loaded.':'This example image is not available to this thread.'}</p>)}{example.text&&<figcaption><Markdown text={example.text}/></figcaption>}</figure>;
}
