import {useContext,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {useStateStore,type ComponentRegistry,type ComponentRenderProps} from '@json-render/react';
import {ArrowRight,Check,ChevronLeft,ChevronRight,Circle,MessageSquare,Pause,RotateCcw} from 'lucide-react';
import {INTERACTION_SCHEMAS,INTERACTION_DATA_SCHEMAS,boundedInteractionData,typedInteractionValue,type InteractionField,type InteractionScalar,type ReviewQueueData,type ParameterControlsData} from '../../../packages/ui-catalog/interactions';
import {ArtifactTitle,inputPath,statePath,useTaskAction} from './task-context';
import {animateTask,MotionRegion,useTaskEffectCause,type TaskEffectCause} from './task-motion';
import {readMotionPolicy} from './motion-policy';
import {Select} from '../../../packages/ui-shell/Select';
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
function ReviewMaterial({item,index,count,intent}:{item:ReviewQueueData['items'][number];index:number;count:number;intent:ReturnType<typeof useTaskEffectCause>}){
 const element=useRef<HTMLElement>(null),previous=useRef({id:item.id,index}),motion=useRef<Animation|undefined>(undefined);
 useLayoutEffect(()=>{
  const before=previous.current;previous.current={id:item.id,index};
  if(before.id===item.id)return;
  const cause=intent.take(),material=element.current!;
  if(cause!=='pointer'||readMotionPolicy()!=='full'||document.visibilityState==='hidden'){motion.current?.cancel();motion.current=undefined;return;}
  const style=getComputedStyle(material),continuing=motion.current?.playState==='running'||motion.current?.playState==='paused';
  const parts=/matrix\(([^)]+)\)/.exec(style.transform)?.[1].split(',').map(Number),offset=parts&&parts.length>=6?parts[4]:0;
  const direction=index>=before.index?1:-1,startX=Math.abs(offset)>.5?offset:direction*8,startOpacity=continuing?Number(style.opacity):.62;
  motion.current?.cancel();
  const animation=animateTask(material,[{opacity:startOpacity,transform:`translateX(${startX}px)`},{opacity:1,transform:'translateX(0px)'}],220,{duration:'--ui-motion-panel-enter',easing:'--ui-ease-enter'});motion.current=animation;
  if(animation)void animation.finished.then(()=>{if(motion.current===animation){animation.cancel();motion.current=undefined;}}).catch(()=>{});
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
 const [error,setError]=useState(''),[ack,setAck]=useState<string|null>(null),intent=useTaskEffectCause(),evidenceKey=useMemo(()=>JSON.stringify(raw),[raw]);
 useLayoutEffect(()=>{setAck(null)},[evidenceKey]);
 if(!parsed?.success)return <p className="interaction-unavailable" role="status">Review items are unavailable from the connected source.</p>;
 const data=parsed.data,saved=object(store.get(statePath(p.stateKey))),reviews=object(saved.items),selected=data.items.find(item=>item.id===saved.selectedId)??data.items[0],index=data.items.indexOf(selected),current=reviewValue(reviews[selected.id]),completed=data.items.filter(item=>decision(object(reviews[item.id]).decision)!==null).length;
 const remaining=data.items.length-completed,needsComment=data.items.some(item=>{const value=reviewValue(reviews[item.id]);return value.decision==='revise'&&!value.comment.trim();});
 const entriesKey=JSON.stringify(data.items.map(item=>{const value=reviewValue(reviews[item.id]);return[item.id,value.decision,value.comment];})),acknowledged=ack!==null&&ack===entriesKey;
 const update=(patch:Partial<Review>,selectedId=selected.id)=>{const latest=object(store.get(statePath(p.stateKey))),items=object(latest.items);store.set(statePath(p.stateKey),{...latest,selectedId,items:{...items,[selectedId]:{...reviewValue(items[selectedId]),...patch}}});setError('');};
 const select=(id:string,cause:TaskEffectCause='restore')=>{const latest=object(store.get(statePath(p.stateKey)));if(latest.selectedId!==id)intent.mark(cause);store.set(statePath(p.stateKey),{...latest,selectedId:id});setError('');};
 const submit=async()=>{const latest=object(object(store.get(statePath(p.stateKey))).items),entries=data.items.map(item=>({itemId:item.id,...reviewValue(latest[item.id])}));if(entries.some(item=>item.decision===null)){setError('Choose a decision for every item before sending the review.');return;}const incomplete=entries.find(item=>item.decision==='revise'&&!item.comment.trim());if(incomplete){select(incomplete.itemId);setError('Add a comment explaining the requested changes.');return;}if(entries.some(item=>item.comment.length>2000)){setError('Keep each comment within 2,000 characters.');return;}setError('');if(p.actionId){const accepted=await action.run(p.actionId,{reviews:entries});if(accepted)setAck(JSON.stringify(entries.map(entry=>[entry.itemId,entry.decision,entry.comment])));}};
 return <section className="interaction-tools interaction-review review-queue" aria-label={data.title??'Review queue'}>
  <Heading title={data.title} detail={`${completed} of ${data.items.length} reviewed`}/>
  <div className="review-queue-layout">
   <div className="review-item-detail"><div className="review-item-pagination"><button type="button" className="quiet" aria-label="Previous item" disabled={index===0} onClick={event=>select(data.items[index-1].id,event.detail>0?'pointer':'keyboard')}><ChevronLeft size={14}/>Previous</button><button type="button" className="quiet" aria-label="Next item" disabled={index===data.items.length-1} onClick={event=>select(data.items[index+1].id,event.detail>0?'pointer':'keyboard')}>Next<ChevronRight size={14}/></button></div><ReviewMaterial item={selected} index={index} count={data.items.length} intent={intent}/>
    <fieldset className="review-decisions"><legend>Your decision</legend>{([{value:'approve',label:'Accept'},{value:'revise',label:'Request changes'},{value:'defer',label:'Defer'}] as const).map(({value,label})=><label key={value} className={`review-decision-choice decision-${value}`} data-selected={current.decision===value}><input type="radio" name={group} value={value} checked={current.decision===value} onChange={()=>update({decision:value})}/><span>{label}</span></label>)}</fieldset>
    <label className="interaction-field review-comment"><span>Review comment{current.decision==='revise'?<small>Required</small>:<small>Optional</small>}</span><textarea aria-label="Review comment" value={current.comment} maxLength={2000} rows={2} placeholder={current.decision==='revise'?'What should change?':'Add a comment'} onChange={event=>update({comment:event.target.value})}/></label>
   </div>
   <nav aria-label="Review items"><ol>{data.items.map((item,itemIndex)=>{const value=reviewValue(reviews[item.id]);return <li key={item.id}><button type="button" className={`review-item-nav decision-${value.decision??'none'}`} aria-current={item.id===selected.id?'step':undefined} onClick={event=>select(item.id,event.detail>0?'pointer':'keyboard')}><span className="review-item-marker" aria-hidden="true">{value.decision==='approve'?<Check size={14}/>:value.decision==='revise'?<MessageSquare size={13}/>:value.decision==='defer'?<Pause size={13}/>:<Circle size={13}/>}</span><span><strong>{item.label}</strong><small>{decisionName(value.decision)}</small></span><span className="sr-only">Item {itemIndex+1}</span></button></li>;})}</ol></nav>
  </div>
  {p.actionId&&<div className="interaction-footer"><span id={`${group}-requirements`} className="interaction-note review-readiness" role="status" aria-live="polite">{acknowledged?'Review submitted':remaining?`Decide on ${remaining} more ${remaining===1?'item':'items'}.`:needsComment?'Explain the requested changes before sending.':`Ready to send ${data.items.length} ${data.items.length===1?'decision':'decisions'}.`}</span><button type="button" className="primary btn-swap" aria-describedby={`${group}-requirements`} disabled={action.busy||acknowledged} onClick={()=>void submit()}><span className="action-label-size" aria-hidden="true">{p.actionLabel??'Send review'}</span><span className="action-label-size" aria-hidden="true">Sending…</span><span className="action-label-live">{action.busy?'Sending…':p.actionLabel??'Send review'}</span></button></div>}
  {(error||action.error)&&<p className="error-text" role="status">{error||action.error}</p>}<Source text={data.source}/>
 </section>;
}

function FieldControl({field,value,label,onChange,invalid=false,range=false}:{field:InteractionField;value:unknown;label:string;onChange:(value:InteractionScalar)=>void;invalid?:boolean;range?:boolean}){
 const common={'aria-label':label,'aria-invalid':invalid||undefined,disabled:field.readOnly};
 if(field.type==='boolean')return <Select {...common} value={value==null?'':value===true?'true':value===false?'false':'-1'} onValueChange={next=>onChange(next===''?null:next==='true')} options={[{value:'',label:'Not set'},{value:'true',label:'Yes'},{value:'false',label:'No'}]}/>;
 if(field.type==='choice'){const selected=typeof value==='string'?field.options.findIndex(option=>option.value===value):-1;return <Select {...common} value={value==null?'':String(selected)} onValueChange={next=>onChange(next===''?null:field.options[Number(next)]?.value??null)} options={[{value:'',label:'Not set'},...field.options.map((option,index)=>({value:String(index),label:option.label}))]}/>;}
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
 const outerTitle=useContext(ArtifactTitle),p=INTERACTION_SCHEMAS.EditableTable.parse(props),store=useStateStore(),action=useTaskAction(),raw=store.get(inputPath(p.dataBinding)),[error,setError]=useState(''),[checked,setChecked]=useState(false),[ack,setAck]=useState<string|null>(null);
 const section=useRef<HTMLElement>(null),seenWas=useRef(new Set<string>()),justEdited=useRef(false),evidenceKey=useMemo(()=>JSON.stringify(raw),[raw]);
 useLayoutEffect(()=>{setAck(null);seenWas.current=new Set();},[evidenceKey]);
 useLayoutEffect(()=>{
  const local=justEdited.current;justEdited.current=false;
  const root=section.current;if(!root)return;
  root.querySelectorAll<HTMLElement>('.editable-original').forEach(node=>{
   const key=node.closest('td')?.getAttribute('data-edit-key')??'';
   if(seenWas.current.has(key))return;seenWas.current.add(key);
   if(local)animateTask(node,[{opacity:.65},{opacity:1}],80,{duration:'--ui-motion-press',easing:'--ui-ease-enter'});
  });
 });
 const parsed=useMemo(()=>boundedInteractionData('EditableTable',raw)?INTERACTION_DATA_SCHEMAS.EditableTable.safeParse(raw):null,[raw]);
 if(!parsed?.success)return <p className="interaction-unavailable" role="status">Editable records are unavailable from the connected source.</p>;
 const data=parsed.data,edits=object(object(store.get(statePath(p.stateKey))).edits);
 const value=(rowId:string,column:InteractionField,source:unknown)=>column.readOnly?source:own(object(edits[rowId]),column.id,source);
 const changes=data.rows.flatMap(row=>data.columns.filter(column=>!column.readOnly&&Object.hasOwn(object(edits[row.id]),column.id)).flatMap(column=>{const typed=typedInteractionValue(column,object(edits[row.id])[column.id]);return typed.error||!Object.is(typed.value,row.values[column.id]??null)?[{rowId:row.id,columnId:column.id,value:typed.value,error:typed.error}]:[];}));
 const keyOf=(e:unknown)=>{const ed=object(e);return JSON.stringify(data.rows.flatMap(row=>data.columns.filter(col=>!col.readOnly&&Object.hasOwn(object(ed[row.id]),col.id)).flatMap(col=>{const t=typedInteractionValue(col,object(ed[row.id])[col.id]);return t.error||!Object.is(t.value,row.values[col.id]??null)?[[row.id,col.id,String(t.value)]]:[]})));};
 const changeKey=keyOf(edits),acknowledged=ack!==null&&ack===changeKey,sentCount=changes.filter(c=>!c.error).length,receipt=`${sentCount} ${sentCount===1?'change':'changes'} sent for review`,maxCells=data.rows.length*data.columns.filter(c=>!c.readOnly).length;
 const update=(rowId:string,columnId:string,next:InteractionScalar)=>{justEdited.current=true;const latest=object(store.get(statePath(p.stateKey))),rows=object(latest.edits);store.set(statePath(p.stateKey),{...latest,edits:{...rows,[rowId]:{...object(rows[rowId]),[columnId]:next}}});setError('');};
 const submit=async()=>{setChecked(true);const latest=object(object(store.get(statePath(p.stateKey))).edits),result:{rowId:string;columnId:string;value:InteractionScalar}[]=[];for(const row of data.rows)for(const column of data.columns){if(column.readOnly)continue;const edited=object(latest[row.id]),current=own(edited,column.id,row.values[column.id]??null),typed=typedInteractionValue(column,current);if(typed.error){setError(`${row.label??row.id} · ${column.label}: ${typed.error}`);return;}if(Object.hasOwn(edited,column.id)&&!Object.is(typed.value,row.values[column.id]??null))result.push({rowId:row.id,columnId:column.id,value:typed.value});}setError('');if(p.actionId){const key=keyOf(latest),ok=await action.run(p.actionId,{changes:result});if(ok&&keyOf(object(store.get(statePath(p.stateKey))).edits)===key)setAck(key);}};
 return <section ref={section} className="interaction-tools interaction-table editable-table" aria-label={data.title??'Editable records'}>{data.title&&data.title!==outerTitle&&<h3 className="editable-table-title">{data.title}</h3>}
  <div className="editable-table-scroll" tabIndex={0} aria-label="Editable records grid"><table><caption className="sr-only">Editable records</caption><thead><tr><th scope="col">Record</th>{data.columns.map(column=><th key={column.id} scope="col" data-field-type={column.type} data-readonly={column.readOnly||undefined}>{column.label}{column.readOnly&&<small>Read only</small>}{column.required&&<span className="sr-only">Required</span>}</th>)}</tr></thead><tbody>{data.rows.map(row=><tr key={row.id}><th scope="row">{row.label??row.id}</th>{data.columns.map(column=>{const source=row.values[column.id]??null,current=value(row.id,column,source),typed=typedInteractionValue(column,current),invalid=checked&&Boolean(typed.error),edited=!column.readOnly&&Object.hasOwn(object(edits[row.id]),column.id)&&(Boolean(typed.error)||!Object.is(typed.value,source));return <td key={column.id} data-label={column.label} data-field-type={column.type} data-readonly={column.readOnly||undefined} data-edited={edited||undefined} data-edit-key={row.id+'.'+column.id} className={edited?'is-edited':''}>{column.readOnly?<span className="editable-readonly">{showField(column,current)}</span>:<><FieldControl field={column} label={`${row.label??row.id} · ${column.label}`} value={current} invalid={invalid} onChange={next=>update(row.id,column.id,next)}/>{edited&&<small className="editable-original">Was {showField(column,source)}</small>}</>}</td>;})}</tr>)}</tbody></table></div>
  {!data.rows.length&&<p className="interaction-note">No records supplied.</p>}
  <div className="interaction-footer"><span className="interaction-note" role="status" aria-live="polite">{acknowledged?receipt:`${changes.length} ${changes.length===1?'cell':'cells'} changed`}</span>{p.actionId&&<button type="button" className="primary btn-swap" disabled={action.busy||!changes.length||acknowledged} onClick={()=>void submit()}><span className="action-label-size" aria-hidden="true">{p.actionLabel??'Review changes'}</span><span className="action-label-size" aria-hidden="true">Sending…</span><span className="action-label-size" aria-hidden="true">{`${maxCells} changes sent for review`}<Check size={12} style={{marginLeft:5,verticalAlign:'-2px'}}/></span><span className="action-label-live" data-receipt={acknowledged||undefined}>{action.busy?'Sending…':acknowledged?receipt:(p.actionLabel??'Review changes')}{acknowledged&&<Check size={12} style={{marginLeft:5,verticalAlign:'-2px'}}/>}</span></button>}</div>
  {(error||action.error)&&<p className="error-text" role="status">{error||action.error}</p>}<Source text={data.source}/></section>;
}
export function ParameterControls({element:{props}}:ComponentRenderProps){
 const p=INTERACTION_SCHEMAS.ParameterControls.parse(props),store=useStateStore(),action=useTaskAction(),raw=store.get(inputPath(p.dataBinding)),[error,setError]=useState(''),[checked,setChecked]=useState(false),controls=useRef<HTMLDivElement>(null);
 const parsed=useMemo(()=>boundedInteractionData('ParameterControls',raw)?INTERACTION_DATA_SCHEMAS.ParameterControls.safeParse(raw):null,[raw]);
 if(!parsed?.success)return <p className="interaction-unavailable" role="status">Parameters are unavailable from the connected source.</p>;
 const data=parsed.data,values=object(object(store.get(statePath(p.stateKey))).values),changes=data.controls.filter(control=>!control.readOnly&&Object.hasOwn(values,control.id)).flatMap(control=>{const current=values[control.id],typed=typedInteractionValue(control,current);return typed.error||!Object.is(typed.value,control.value)?[{control,current,typed}]:[];});
 const update=(id:string,next:InteractionScalar)=>{const latest=object(store.get(statePath(p.stateKey)));store.set(statePath(p.stateKey),{...latest,values:{...object(latest.values),[id]:next}});setError('');};
 const reset=(id:string)=>{const latest=object(store.get(statePath(p.stateKey))),next={...object(latest.values)};delete next[id];store.set(statePath(p.stateKey),{...latest,values:next});setError('');const row=[...controls.current!.querySelectorAll<HTMLElement>('[data-parameter-id]')].find(node=>node.dataset.parameterId===id);row?.querySelector<HTMLElement>('input:not(:disabled),button[role="combobox"]:not(:disabled)')?.focus({preventScroll:true});};
 const submit=async()=>{setChecked(true);const latest=object(object(store.get(statePath(p.stateKey))).values),result:Record<string,InteractionScalar>={};for(const control of data.controls){const current=control.readOnly?control.value:own(latest,control.id,control.value),typed=typedInteractionValue(control,current);if(typed.error){setError(`${control.label}: ${typed.error}`);return;}result[control.id]=typed.value;}setError('');if(p.actionId)await action.run(p.actionId,{values:result});};
 return <section className="interaction-tools interaction-parameters parameter-controls" aria-label={data.title??'Parameters'}><Heading title={data.title} detail={changes.length?`${changes.length} ${changes.length===1?'change':'changes'}`:undefined}/>
  <div ref={controls} className="parameter-list">{data.controls.map(control=>{const current=control.readOnly?control.value:own(values,control.id,control.value),invalid=checked&&Boolean(typedInteractionValue(control,current).error),changed=changes.some(change=>change.control.id===control.id);return <div className={`parameter-row parameter-type-${control.type}${changed?' parameter-is-changed':''}`} key={control.id} data-parameter-id={control.id}><div className="parameter-label"><strong>{control.label}</strong>{control.description&&<p>{control.description}</p>}{control.readOnly&&<small>Read only</small>}{'min'in control&&(control.min!==undefined||control.max!==undefined)&&<small className="parameter-bounds">{control.min!==undefined&&control.max!==undefined?`${control.min}–${control.max}`:control.min!==undefined?`Minimum ${control.min}`:`Maximum ${control.max}`}{control.step!==undefined&&control.step!==1?` · step ${control.step}`:''}</small>}</div><FieldControl field={control} label={control.type==='range'?`${control.label} value`:control.label} value={current} invalid={invalid} range onChange={next=>update(control.id,next)}/></div>;})}</div>
  <ParameterProposal changes={changes} busy={action.busy} reset={reset}/>
  {p.actionId&&<div className="interaction-footer"><span/>{<button type="button" className="primary" disabled={action.busy} onClick={()=>void submit()}>{action.busy?'Sending…':p.actionLabel??'Apply settings'}</button>}</div>}
  {(error||action.error)&&<p className="error-text" role="status">{error||action.error}</p>}<Source text={data.source}/></section>;
}
type ParameterChange={control:ParameterControlsData['controls'][number];current:unknown;typed:ReturnType<typeof typedInteractionValue>};
function ParameterProposal({changes,busy,reset}:{changes:ParameterChange[];busy:boolean;reset:(id:string)=>void}){
 const retained=useRef(changes);if(changes.length)retained.current=changes;
 return <MotionRegion open={changes.length>0} className="parameter-proposal-region"><section className="parameter-proposal" aria-label="Changes to apply"><h4>Changes to apply</h4><ul>{retained.current.map(({control,current,typed})=><li key={control.id}><span className="parameter-proposal-label">{control.label}</span><div className="parameter-proposal-values"><span className="parameter-original"><small>Current</small><span>{showField(control,control.value)}</span></span><ArrowRight size={12} aria-label="to"/><strong className="parameter-proposed"><small>Proposed</small><span>{showField(control,current)}</span></strong></div><button type="button" className="quiet parameter-reset" aria-label={`Reset ${control.label}`} disabled={busy} onClick={()=>reset(control.id)}><RotateCcw size={12}/><span>Reset</span></button>{typed.error&&<span className="parameter-proposal-error">{typed.error}</span>}</li>)}</ul></section></MotionRegion>;
}
export const INTERACTION_REGISTRY:ComponentRegistry={ReviewQueue,EditableTable,ParameterControls};
