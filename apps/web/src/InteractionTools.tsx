import {useContext,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {useStateStore,type ComponentRegistry,type ComponentRenderProps} from '@json-render/react';
import {ArrowRight,Check,ChevronLeft,ChevronRight,Circle,MessageSquare,Pause,RotateCcw} from 'lucide-react';
import {INTERACTION_SCHEMAS,INTERACTION_DATA_SCHEMAS,boundedInteractionData,typedInteractionValue,type InteractionField,type InteractionScalar,type ReviewQueueData,type ParameterControlsData} from '../../../packages/ui-catalog/interactions';
import {ArtifactTitle,inputPath,statePath,useTaskAction} from './task-context';
import {animateTask,MotionRegion,reducedMotion} from './task-motion';
import './interaction-tools.css';

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const own=(value:Record<string,unknown>,key:string,fallback:unknown)=>Object.hasOwn(value,key)?value[key]:fallback;
const show=(value:unknown)=>value===null||value===undefined||value===''?'Not set':typeof value==='boolean'?value?'Yes':'No':String(value);
const showField=(field:InteractionField,value:unknown)=>field.type==='choice'?field.options.find(option=>option.value===value)?.label??show(value):show(value);
function Source({text}:{text?:string}){return text?<details className="interaction-source"><summary>Source</summary><p>{text}</p></details>:null;}
function Heading({title,detail}:{title?:string;detail?:string}){const outer=useContext(ArtifactTitle);return title&&title!==outer||detail?<header className="interaction-heading">{title&&title!==outer?<h3>{title}</h3>:<span/>}{detail&&<span>{detail}</span>}</header>:null;}
type ReviewDecision='approve'|'revise'|'defer'|null;
type Review={decision:ReviewDecision;comment:string};
const decision=(raw:unknown):ReviewDecision=>typeof raw==='string'&&['approve','revise','defer'].includes(raw)?raw as Exclude<ReviewDecision,null>:null;
function reviewValue(raw:unknown):Review{const record=object(raw);return {decision:decision(record.decision),comment:typeof record.comment==='string'?record.comment:''};}
const decisionName=(value:ReviewDecision)=>value==='approve'?'Accepted':value==='revise'?'Changes requested':value==='defer'?'Deferred':'Not reviewed';
function ReviewMaterial({item,index,count}:{item:ReviewQueueData['items'][number];index:number;count:number}){
 const element=useRef<HTMLElement>(null),previous=useRef({id:item.id,index}),motion=useRef<Animation|undefined>(undefined);
 useLayoutEffect(()=>{
  const before=previous.current;previous.current={id:item.id,index};
  if(before.id===item.id)return;
  if(reducedMotion()||document.visibilityState==='hidden'){motion.current?.cancel();return;}
  const material=element.current!,direction=index>=before.index?1:-1;
  const style=getComputedStyle(material),continuing=motion.current?.playState==='running'||motion.current?.playState==='paused';
  const opacity=continuing?Number(style.opacity):.62,transform=continuing?style.transform:`translateX(${direction*8}px)`;motion.current?.cancel();
  const animation=animateTask(material,[{opacity,transform},{opacity:1,transform:`translateX(${-direction*.4}px)`,offset:.86},{opacity:1,transform:'translateX(0)'}],230);motion.current=animation;
  if(animation)void animation.finished.then(()=>{if(motion.current===animation)animation.cancel();}).catch(()=>{});
 },[item.id,index]);
 useLayoutEffect(()=>{
  const material=element.current!,preference=matchMedia('(prefers-reduced-motion: reduce)'),settle=()=>motion.current?.cancel();
  const theme=new MutationObserver(settle);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  material.addEventListener('pointerdown',settle);material.addEventListener('focusin',settle);preference.addEventListener('change',settle);
  return()=>{settle();theme.disconnect();material.removeEventListener('pointerdown',settle);material.removeEventListener('focusin',settle);preference.removeEventListener('change',settle);};
 },[]);
 return <div className="review-material-stage"><article ref={element} className="review-item-material" aria-label={item.label}><p className="review-item-position">Item {index+1} of {count}</p><h4>{item.label}</h4>{item.detail&&<p className="review-item-description">{item.detail}</p>}
  {item.evidence&&item.evidence.length>0&&<dl className="review-material-excerpts">{item.evidence.map((excerpt,excerptIndex)=><div key={excerptIndex}><dt>{excerpt.label}</dt><dd>{excerpt.value}</dd></div>)}</dl>}
 </article></div>;
}
export function ReviewQueue({element:{props}}:ComponentRenderProps){
 const p=INTERACTION_SCHEMAS.ReviewQueue.parse(props),store=useStateStore(),action=useTaskAction(),group=useId(),raw=store.get(inputPath(p.dataBinding));
 const parsed=useMemo(()=>boundedInteractionData('ReviewQueue',raw)?INTERACTION_DATA_SCHEMAS.ReviewQueue.safeParse(raw):null,[raw]);
 const [error,setError]=useState('');
 if(!parsed?.success)return <p className="interaction-unavailable" role="status">Review items are unavailable from the connected source.</p>;
 const data=parsed.data,saved=object(store.get(statePath(p.stateKey))),reviews=object(saved.items),selected=data.items.find(item=>item.id===saved.selectedId)??data.items[0],index=data.items.indexOf(selected),current=reviewValue(reviews[selected.id]),completed=data.items.filter(item=>decision(object(reviews[item.id]).decision)!==null).length;
 const remaining=data.items.length-completed,needsComment=data.items.some(item=>{const value=reviewValue(reviews[item.id]);return value.decision==='revise'&&!value.comment.trim();});
 const update=(patch:Partial<Review>,selectedId=selected.id)=>{const latest=object(store.get(statePath(p.stateKey))),items=object(latest.items);store.set(statePath(p.stateKey),{...latest,selectedId,items:{...items,[selectedId]:{...reviewValue(items[selectedId]),...patch}}});setError('');};
 const select=(id:string)=>{const latest=object(store.get(statePath(p.stateKey)));store.set(statePath(p.stateKey),{...latest,selectedId:id});setError('');};
 const submit=async()=>{const latest=object(object(store.get(statePath(p.stateKey))).items),entries=data.items.map(item=>({itemId:item.id,...reviewValue(latest[item.id])}));if(entries.some(item=>item.decision===null)){setError('Choose a decision for every item before sending the review.');return;}const incomplete=entries.find(item=>item.decision==='revise'&&!item.comment.trim());if(incomplete){select(incomplete.itemId);setError('Add a comment explaining the requested changes.');return;}if(entries.some(item=>item.comment.length>2000)){setError('Keep each comment within 2,000 characters.');return;}setError('');if(p.actionId)await action.run(p.actionId,{reviews:entries});};
 return <section className="interaction-tools interaction-review review-queue" aria-label={data.title??'Review queue'}>
  <Heading title={data.title} detail={`${completed} of ${data.items.length} reviewed`}/>
  <div className="review-queue-layout">
   <div className="review-item-detail"><ReviewMaterial item={selected} index={index} count={data.items.length}/>
    <fieldset className="review-decisions"><legend>Your decision</legend>{([{value:'approve',label:'Accept'},{value:'revise',label:'Request changes'},{value:'defer',label:'Defer'}] as const).map(({value,label})=><label key={value} className={`review-decision-choice decision-${value}`} data-selected={current.decision===value}><input type="radio" name={group} value={value} checked={current.decision===value} onChange={()=>update({decision:value})}/><span>{label}</span></label>)}</fieldset>
    <label className="interaction-field review-comment"><span>Review comment{current.decision==='revise'?<small>Required</small>:<small>Optional</small>}</span><textarea aria-label="Review comment" value={current.comment} maxLength={2000} rows={2} placeholder={current.decision==='revise'?'What should change?':'Add a comment'} onChange={event=>update({comment:event.target.value})}/></label>
    <div className="review-item-pagination"><button type="button" className="quiet" aria-label="Previous item" disabled={index===0} onClick={()=>select(data.items[index-1].id)}><ChevronLeft size={14}/>Previous</button><button type="button" className="quiet" aria-label="Next item" disabled={index===data.items.length-1} onClick={()=>select(data.items[index+1].id)}>Next<ChevronRight size={14}/></button></div>
   </div>
   <nav aria-label="Review items"><ol>{data.items.map((item,itemIndex)=>{const value=reviewValue(reviews[item.id]);return <li key={item.id}><button type="button" className={`review-item-nav decision-${value.decision??'none'}`} aria-current={item.id===selected.id?'step':undefined} onClick={()=>select(item.id)}><span className="review-item-marker" aria-hidden="true">{value.decision==='approve'?<Check size={14}/>:value.decision==='revise'?<MessageSquare size={13}/>:value.decision==='defer'?<Pause size={13}/>:<Circle size={13}/>}</span><span><strong>{item.label}</strong><small>{decisionName(value.decision)}</small></span><span className="sr-only">Item {itemIndex+1}</span></button></li>;})}</ol></nav>
  </div>
  {p.actionId&&<div className="interaction-footer"><span id={`${group}-requirements`} className="interaction-note review-readiness">{remaining?`Decide on ${remaining} more ${remaining===1?'item':'items'}.`:needsComment?'Explain the requested changes before sending.':`Ready to send ${data.items.length} ${data.items.length===1?'decision':'decisions'}.`}</span><button type="button" className="primary" aria-describedby={`${group}-requirements`} disabled={action.busy} onClick={()=>void submit()}>{action.busy?'Sending…':p.actionLabel??'Send review'}</button></div>}
  {(error||action.error)&&<p className="error-text" role="alert">{error||action.error}</p>}<Source text={data.source}/>
 </section>;
}

function FieldControl({field,value,label,onChange,invalid=false,range=false}:{field:InteractionField;value:unknown;label:string;onChange:(value:InteractionScalar)=>void;invalid?:boolean;range?:boolean}){
 const common={'aria-label':label,'aria-invalid':invalid||undefined,disabled:field.readOnly};
 if(field.type==='boolean')return <select {...common} value={value===true?'true':value===false?'false':''} onChange={event=>onChange(event.target.value===''?null:event.target.value==='true')}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>;
 if(field.type==='choice')return <select {...common} value={typeof value==='string'?value:''} onChange={event=>onChange(event.target.value||null)}><option value="">Not set</option>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>;
 if(field.type==='text')return <input {...common} type="text" maxLength={2000} value={typeof value==='string'?value:''} placeholder="Not set" onChange={event=>onChange(event.target.value)}/>;
 const numeric=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
 const input=<input {...common} type="text" role="spinbutton" inputMode="decimal" autoComplete="off" aria-valuemin={field.min} aria-valuemax={field.max} aria-valuenow={Number.isFinite(numeric)?numeric:undefined} aria-valuetext={Number.isFinite(numeric)?undefined:typeof value==='string'&&value?value:'Not set'} value={typeof value==='number'||typeof value==='string'?value:''} placeholder="Not set" onChange={event=>onChange(event.target.value)} onKeyDown={event=>{
  if(event.nativeEvent.isComposing||event.ctrlKey||event.metaKey||event.altKey||!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key))return;
  if(event.key==='Home'&&field.min===undefined||event.key==='End'&&field.max===undefined)return;
  event.preventDefault();const step=field.step??1,origin=field.min??0,current=Number.isFinite(numeric)?numeric:origin,direction=event.key==='ArrowDown'||event.key==='PageDown'?-1:1,multiple=event.key.startsWith('Page')?10:1;
  let next=event.key==='Home'?field.min!:event.key==='End'?field.max!:origin+(direction>0?Math.floor((current-origin)/step+1e-9)+multiple:Math.ceil((current-origin)/step-1e-9)-multiple)*step;
  next=Math.max(field.min??-Infinity,Math.min(field.max??Infinity,next));if(Number.isFinite(next))onChange(Math.abs(next)<1e12?String(Number(next.toFixed(12))):String(next));
 }}/>;
 if(field.type==='range'&&range)return <div className="parameter-range"><input type="range" aria-label={field.label} min={field.min} max={field.max} step={field.step??'any'} value={typeof value==='number'?value:typeof value==='string'&&value!==''&&Number.isFinite(Number(value))?Number(value):field.min} disabled={field.readOnly||value==null||value===''} aria-valuetext={value==null||value===''?'Not set':String(value)} onChange={event=>onChange(event.target.valueAsNumber)}/>{input}</div>;
 return input;
}
export function EditableTable({element:{props}}:ComponentRenderProps){
 const outerTitle=useContext(ArtifactTitle),p=INTERACTION_SCHEMAS.EditableTable.parse(props),store=useStateStore(),action=useTaskAction(),raw=store.get(inputPath(p.dataBinding)),[error,setError]=useState(''),[checked,setChecked]=useState(false);
 const parsed=useMemo(()=>boundedInteractionData('EditableTable',raw)?INTERACTION_DATA_SCHEMAS.EditableTable.safeParse(raw):null,[raw]);
 if(!parsed?.success)return <p className="interaction-unavailable" role="status">Editable records are unavailable from the connected source.</p>;
 const data=parsed.data,edits=object(object(store.get(statePath(p.stateKey))).edits);
 const value=(rowId:string,column:InteractionField,source:unknown)=>column.readOnly?source:own(object(edits[rowId]),column.id,source);
 const changes=data.rows.flatMap(row=>data.columns.filter(column=>!column.readOnly&&Object.hasOwn(object(edits[row.id]),column.id)).flatMap(column=>{const typed=typedInteractionValue(column,object(edits[row.id])[column.id]);return typed.error||!Object.is(typed.value,row.values[column.id]??null)?[{rowId:row.id,columnId:column.id,value:typed.value,error:typed.error}]:[];}));
 const update=(rowId:string,columnId:string,next:InteractionScalar)=>{const latest=object(store.get(statePath(p.stateKey))),rows=object(latest.edits);store.set(statePath(p.stateKey),{...latest,edits:{...rows,[rowId]:{...object(rows[rowId]),[columnId]:next}}});setError('');};
 const submit=async()=>{setChecked(true);const latest=object(object(store.get(statePath(p.stateKey))).edits),result:{rowId:string;columnId:string;value:InteractionScalar}[]=[];for(const row of data.rows)for(const column of data.columns){if(column.readOnly)continue;const edited=object(latest[row.id]),current=own(edited,column.id,row.values[column.id]??null),typed=typedInteractionValue(column,current);if(typed.error){setError(`${row.label??row.id} · ${column.label}: ${typed.error}`);return;}if(Object.hasOwn(edited,column.id)&&!Object.is(typed.value,row.values[column.id]??null))result.push({rowId:row.id,columnId:column.id,value:typed.value});}setError('');if(p.actionId)await action.run(p.actionId,{changes:result});};
 return <section className="interaction-tools interaction-table editable-table" aria-label={data.title??'Editable records'}>{data.title&&data.title!==outerTitle&&<h3 className="editable-table-title">{data.title}</h3>}
  <div className="editable-table-scroll" tabIndex={0} aria-label="Editable records grid"><table><caption className="sr-only">Editable records</caption><thead><tr><th scope="col">Record</th>{data.columns.map(column=><th key={column.id} scope="col" data-field-type={column.type} data-readonly={column.readOnly||undefined}>{column.label}{column.readOnly&&<small>Read only</small>}{column.required&&<span className="sr-only">Required</span>}</th>)}</tr></thead><tbody>{data.rows.map(row=><tr key={row.id}><th scope="row">{row.label??row.id}</th>{data.columns.map(column=>{const source=row.values[column.id]??null,current=value(row.id,column,source),typed=typedInteractionValue(column,current),invalid=checked&&Boolean(typed.error),edited=!column.readOnly&&Object.hasOwn(object(edits[row.id]),column.id)&&(Boolean(typed.error)||!Object.is(typed.value,source));return <td key={column.id} data-label={column.label} data-field-type={column.type} data-readonly={column.readOnly||undefined} className={edited?'is-edited':''}>{column.readOnly?<span className="editable-readonly">{showField(column,current)}</span>:<><FieldControl field={column} label={`${row.label??row.id} · ${column.label}`} value={current} invalid={invalid} onChange={next=>update(row.id,column.id,next)}/>{edited&&<small className="editable-original">Was {showField(column,source)}</small>}</>}</td>;})}</tr>)}</tbody></table></div>
  {!data.rows.length&&<p className="interaction-note">No records supplied.</p>}
  <div className="interaction-footer"><span className="interaction-note">{`${changes.length} ${changes.length===1?'cell':'cells'} changed`}</span>{p.actionId&&<button type="button" className="primary" disabled={action.busy||!changes.length} onClick={()=>void submit()}>{action.busy?'Sending…':p.actionLabel??'Review changes'}</button>}</div>
  {(error||action.error)&&<p className="error-text" role="alert">{error||action.error}</p>}<Source text={data.source}/></section>;
}
export function ParameterControls({element:{props}}:ComponentRenderProps){
 const p=INTERACTION_SCHEMAS.ParameterControls.parse(props),store=useStateStore(),action=useTaskAction(),raw=store.get(inputPath(p.dataBinding)),[error,setError]=useState(''),[checked,setChecked]=useState(false),controls=useRef<HTMLDivElement>(null);
 const parsed=useMemo(()=>boundedInteractionData('ParameterControls',raw)?INTERACTION_DATA_SCHEMAS.ParameterControls.safeParse(raw):null,[raw]);
 if(!parsed?.success)return <p className="interaction-unavailable" role="status">Parameters are unavailable from the connected source.</p>;
 const data=parsed.data,values=object(object(store.get(statePath(p.stateKey))).values),changes=data.controls.filter(control=>!control.readOnly&&Object.hasOwn(values,control.id)).flatMap(control=>{const current=values[control.id],typed=typedInteractionValue(control,current);return typed.error||!Object.is(typed.value,control.value)?[{control,current,typed}]:[];});
 const update=(id:string,next:InteractionScalar)=>{const latest=object(store.get(statePath(p.stateKey)));store.set(statePath(p.stateKey),{...latest,values:{...object(latest.values),[id]:next}});setError('');};
 const reset=(id:string)=>{const latest=object(store.get(statePath(p.stateKey))),next={...object(latest.values)};delete next[id];store.set(statePath(p.stateKey),{...latest,values:next});setError('');const row=[...controls.current!.querySelectorAll<HTMLElement>('[data-parameter-id]')].find(node=>node.dataset.parameterId===id);row?.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled)')?.focus({preventScroll:true});};
 const submit=async()=>{setChecked(true);const latest=object(object(store.get(statePath(p.stateKey))).values),result:Record<string,InteractionScalar>={};for(const control of data.controls){const current=control.readOnly?control.value:own(latest,control.id,control.value),typed=typedInteractionValue(control,current);if(typed.error){setError(`${control.label}: ${typed.error}`);return;}result[control.id]=typed.value;}setError('');if(p.actionId)await action.run(p.actionId,{values:result});};
 return <section className="interaction-tools interaction-parameters parameter-controls" aria-label={data.title??'Parameters'}><Heading title={data.title} detail={changes.length?`${changes.length} ${changes.length===1?'change':'changes'}`:undefined}/>
  <div ref={controls} className="parameter-list">{data.controls.map(control=>{const current=control.readOnly?control.value:own(values,control.id,control.value),invalid=checked&&Boolean(typedInteractionValue(control,current).error),changed=changes.some(change=>change.control.id===control.id);return <div className={`parameter-row parameter-type-${control.type}${changed?' parameter-is-changed':''}`} key={control.id} data-parameter-id={control.id}><div className="parameter-label"><strong>{control.label}</strong>{control.description&&<p>{control.description}</p>}{control.readOnly&&<small>Read only</small>}{'min'in control&&(control.min!==undefined||control.max!==undefined)&&<small className="parameter-bounds">{control.min!==undefined&&control.max!==undefined?`${control.min}–${control.max}`:control.min!==undefined?`Minimum ${control.min}`:`Maximum ${control.max}`}{control.step!==undefined&&control.step!==1?` · step ${control.step}`:''}</small>}</div><FieldControl field={control} label={control.type==='range'?`${control.label} value`:control.label} value={current} invalid={invalid} range onChange={next=>update(control.id,next)}/></div>;})}</div>
  <ParameterProposal changes={changes} busy={action.busy} reset={reset}/>
  {p.actionId&&<div className="interaction-footer"><span/>{<button type="button" className="primary" disabled={action.busy} onClick={()=>void submit()}>{action.busy?'Sending…':p.actionLabel??'Apply settings'}</button>}</div>}
  {(error||action.error)&&<p className="error-text" role="alert">{error||action.error}</p>}<Source text={data.source}/></section>;
}
type ParameterChange={control:ParameterControlsData['controls'][number];current:unknown;typed:ReturnType<typeof typedInteractionValue>};
function ParameterProposal({changes,busy,reset}:{changes:ParameterChange[];busy:boolean;reset:(id:string)=>void}){
 const retained=useRef(changes);if(changes.length)retained.current=changes;
 return <MotionRegion open={changes.length>0} className="parameter-proposal-region"><section className="parameter-proposal" aria-label="Changes to apply"><h4>Changes to apply</h4><ul>{retained.current.map(({control,current,typed})=><li key={control.id}><span className="parameter-proposal-label">{control.label}</span><div className="parameter-proposal-values"><span className="parameter-original"><small>Current</small><span>{showField(control,control.value)}</span></span><ArrowRight size={12} aria-label="to"/><strong className="parameter-proposed"><small>Proposed</small><span>{showField(control,current)}</span></strong></div><button type="button" className="quiet parameter-reset" aria-label={`Reset ${control.label}`} disabled={busy} onClick={()=>reset(control.id)}><RotateCcw size={12}/><span>Reset</span></button>{typed.error&&<span className="parameter-proposal-error">{typed.error}</span>}</li>)}</ul></section></MotionRegion>;
}
export const INTERACTION_REGISTRY:ComponentRegistry={ReviewQueue,EditableTable,ParameterControls};
