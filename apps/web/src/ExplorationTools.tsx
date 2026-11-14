import {useContext,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type KeyboardEvent} from 'react';
import {useStateStore,type ComponentRegistry,type ComponentRenderProps} from '@json-render/react';
import {ArrowDown,CalendarDays,Check,ChevronRight,Filter,MapPin,Plus,Search,Trash2} from 'lucide-react';
import {EXPLORATION_SCHEMAS,EXPLORATION_DATA_SCHEMAS,boundedExplorationData,readAnnotationState,type AnnotationState,type ScheduleData} from '../../../packages/ui-catalog/exploration';
import {ArtifactInline,ArtifactTitle,inputPath,statePath,useTaskAction} from './task-context';
import {useDocumentEvidence} from './document-evidence';
import {animateTask} from './task-motion';
import './exploration-tools.css';

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
function Source({text}:{text?:string}){return text?<details className="exploration-source"><summary>Source</summary><p>{text}</p></details>:null;}
function Heading({title,detail}:{title?:string;detail?:string}){const outer=useContext(ArtifactTitle);return title&&title!==outer||detail?<header className="exploration-heading">{title&&title!==outer?<h3>{title}</h3>:<span/>}{detail&&<span>{detail}</span>}</header>:null;}
function useSelectionMotion(identity:string|null|undefined){const ref=useRef<HTMLDivElement>(null),previous=useRef(identity);useEffect(()=>{const changed=previous.current!==identity;previous.current=identity;if(!changed)return;const motion=animateTask(ref.current,[{opacity:.65,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],190);return()=>motion?.cancel();},[identity]);return ref;}

type AnnotatorProps={resourceId:string;alt:string;stateKey:string;title?:string;actionId?:string;actionLabel?:string};
function AnnotationCanvas({p,value,read,change}:{p:AnnotatorProps;value:AnnotationState;read:()=>AnnotationState;change:(value:AnnotationState)=>void}){
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),action=useTaskAction(),stage=useRef<HTMLDivElement>(null),detail=useSelectionMotion(value.selectedId);
 const selected=value.annotations.find(pin=>pin.id===value.selectedId),count=value.annotations.length;
 useEffect(()=>{if(ready||error)return;const timeout=setTimeout(()=>setError('The image is taking too long to load. Check access and retry.'),15000);return()=>clearTimeout(timeout);},[ready,error,retry]);
 const add=(x=.5,y=.5)=>{const current=read();if(!ready||current.annotations.length>=32)return;const id='pin_'+crypto.randomUUID();change({...current,selectedId:id,annotations:[...current.annotations,{id,x:clamp(x),y:clamp(y),text:''}]});requestAnimationFrame(()=>stage.current?.querySelector<HTMLButtonElement>(`[data-pin-id="${id}"]`)?.focus({preventScroll:true}));};
 const patch=(update:Partial<AnnotationState['annotations'][number]>)=>{const current=read();if(current.selectedId)change({...current,annotations:current.annotations.map(pin=>pin.id===current.selectedId?{...pin,...update}:pin)});};
 const move=(event:KeyboardEvent<HTMLButtonElement>)=>{const current=read(),pin=current.annotations.find(item=>item.id===current.selectedId);if(!pin||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const delta=event.shiftKey ? .05 : .01;patch({x:clamp(pin.x+(event.key==='ArrowRight'?delta:event.key==='ArrowLeft'?-delta:0)),y:clamp(pin.y+(event.key==='ArrowDown'?delta:event.key==='ArrowUp'?-delta:0))});};
 const submit=()=>{const current=read();if(!p.actionId||!current.annotations.length)return;if(current.annotations.some(pin=>!pin.text.trim())){setError('Add feedback to every pin before sending.');return;}setError('');void action.run(p.actionId,{resourceId:p.resourceId,annotations:current.annotations});};
 return <><div className="annotation-toolbar"><span>{count} {count===1?'pin':'pins'}</span><button type="button" className="secondary" disabled={!ready||count>=32} onClick={()=>add()}><Plus size={14}/>Add pin</button></div>
  <div className="annotation-layout"><div className="annotation-image-wrap"><div ref={stage} className="annotation-image" data-ready={ready} onClick={event=>{if(event.target!==event.currentTarget&&!(event.target instanceof HTMLImageElement))return;const bounds=event.currentTarget.getBoundingClientRect();if(bounds.width&&bounds.height)add((event.clientX-bounds.left)/bounds.width,(event.clientY-bounds.top)/bounds.height);}}>
   <img key={retry} src={`/api/resources/${encodeURIComponent(p.resourceId)}/content`} alt={p.alt} draggable={false} onLoad={event=>{if(!event.currentTarget.naturalWidth||!event.currentTarget.naturalHeight){setError('This resource is not a readable image.');return;}setError('');setReady(true);}} onError={()=>{setReady(false);setError('The image is unavailable. Check its grant and retry.');}}/>
   {ready&&value.annotations.map((pin,index)=><button type="button" key={pin.id} data-pin-id={pin.id} className="annotation-pin" aria-label={`Pin ${index+1}`} aria-pressed={pin.id===value.selectedId} title={pin.text||`Pin ${index+1}`} style={{left:`${pin.x*100}%`,top:`${pin.y*100}%`}} onClick={event=>{event.stopPropagation();change({...value,selectedId:pin.id});}} onKeyDown={move}>{index+1}</button>)}
  </div>{!ready&&!error&&<p className="exploration-empty" role="status">Loading image…</p>}</div>
  <div className="annotation-detail" ref={detail}>{selected?<><div className="annotation-detail-heading"><strong>Pin {value.annotations.indexOf(selected)+1}</strong><button type="button" className="icon-button" aria-label="Delete selected pin" onClick={()=>{const annotations=value.annotations.filter(pin=>pin.id!==selected.id);change({...value,selectedId:annotations[0]?.id??null,annotations});}}><Trash2 size={14}/></button></div><label className="exploration-field"><span>Feedback</span><textarea aria-label="Pin feedback" value={selected.text} maxLength={800} rows={5} placeholder="What should change here?" onChange={event=>{setError('');patch({text:event.target.value});}}/></label><p className="exploration-hint">Arrow keys move the selected pin.</p></>:<div className="annotation-empty"><MapPin size={22}/><p>Click the image or add a pin.</p></div>}
   {count>0&&<ol className="annotation-list">{value.annotations.map((pin,index)=><li key={pin.id}><button type="button" aria-label={`Select pin ${index+1}`} aria-current={pin.id===value.selectedId?'true':undefined} onClick={()=>change({...value,selectedId:pin.id})}><span>{index+1}</span><span>{pin.text||'Add feedback'}</span><ChevronRight size={12}/></button></li>)}</ol>}
  </div></div>
  {value.previous?.annotations.length? <details className="exploration-source"><summary>Previous image feedback</summary><ol>{value.previous.annotations.map(pin=><li key={pin.id}>{pin.text||'Pin without a note'}</li>)}</ol></details>:null}
  {(error||action.error)&&<p className="error-text" role="status">{error||action.error}{!ready&&<button type="button" className="quiet" onClick={()=>{setError('');setReady(false);setRetry(value=>value+1);}}>Retry image</button>}</p>}
  {p.actionId&&<footer className="exploration-footer"><button type="button" className="primary" disabled={action.busy||!ready||!count} onClick={submit}>{action.busy?'Sending…':p.actionLabel??'Send feedback'}</button></footer>}
 </>;
}
export function ImageAnnotator({element:{props}}:ComponentRenderProps){
 const p=EXPLORATION_SCHEMAS.ImageAnnotator.parse(props),store=useStateStore(),evidence=useDocumentEvidence();
 const grant=evidence?.resources.find(item=>item.id===p.resourceId&&item.threadId===evidence.threadId&&['file','attachment'].includes(item.kind));
 const identity=grant?JSON.stringify([grant.id,grant.path,grant.identity?.dev??null,grant.identity?.ino??null]):null;
 const [source,setSource]=useState<{key:string;hash?:string;error?:boolean}|null>(null);
 useEffect(()=>{let active=true;if(!identity){setSource(null);return;}void crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)).then(bytes=>{if(active)setSource({key:identity,hash:Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')});}).catch(()=>{if(active)setSource({key:identity,error:true});});return()=>{active=false;};},[identity]);
 if(!grant)return <p role="status" className="error-text">This image is not available to this thread. Attach it again to add feedback.</p>;
 if(!source||source.key!==identity)return <p role="status">Opening image feedback…</p>;
 if(!source.hash)return <p role="status" className="error-text">The image source could not be verified. Reload to try again.</p>;
 const value=readAnnotationState(store.get(statePath(p.stateKey)),p.resourceId,source.hash);
 return <section className="exploration-tools image-annotator" aria-label={p.title??'Image feedback'}><Heading title={p.title}/><AnnotationCanvas key={source.hash} p={p} value={value} read={()=>readAnnotationState(store.get(statePath(p.stateKey)),p.resourceId,source.hash)} change={value=>store.set(statePath(p.stateKey),value)}/></section>;
}

function scheduleLayout(data:ScheduleData|null){
 const slots=data?[...data.slots].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)):[],groups=new Map<string,ScheduleData['slots']>(),datesById=new Map<string,string>();
 if(data){const format=new Intl.DateTimeFormat('en',{timeZone:data.timeZone,year:'numeric',month:'2-digit',day:'2-digit'});for(const slot of slots){const parts=format.formatToParts(new Date(slot.start)),part=(name:string)=>parts.find(item=>item.type===name)?.value,date=`${part('year')}-${part('month')}-${part('day')}`;datesById.set(slot.id,date);const group=groups.get(date)??[];group.push(slot);groups.set(date,group);}}
 return {slots,groups,datesById,dates:[...groups.keys()]};
}
function slotTime(slot:ScheduleData['slots'][number],format:Intl.DateTimeFormat,date:Intl.DateTimeFormat){
 const start=new Date(slot.start),end=new Date(slot.end);
 return `${format.format(start)} – ${date.format(start)!==date.format(end)?`${date.format(end)}, `:''}${format.format(end)}`;
}
function slotDuration(slot:ScheduleData['slots'][number]){
 const minutes=(Date.parse(slot.end)-Date.parse(slot.start))/60000;
 if(minutes<60)return `${new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(minutes)} min`;
 const hours=Math.floor(minutes/60),remaining=minutes-hours*60;
 return `${hours} hr${remaining?` ${new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(remaining)} min`:''}`;
}
export function SchedulePicker({element:{props}}:ComponentRenderProps){
 const p=EXPLORATION_SCHEMAS.SchedulePicker.parse(props),store=useStateStore(),action=useTaskAction(),id=useId(),raw=store.get(inputPath(p.dataBinding)),[selectionError,setSelectionError]=useState('');
 const parsed=useMemo(()=>boundedExplorationData('SchedulePicker',raw)?EXPLORATION_DATA_SCHEMAS.SchedulePicker.safeParse(raw):null,[raw]);
 const data=parsed?.success?parsed.data:null,saved=object(store.get(statePath(p.stateKey))),layout=useMemo(()=>scheduleLayout(data),[data]),{slots,dates,datesById,groups}=layout;
 const selected=slots.find(slot=>slot.id===saved.selectedId);
 if(!data)return <p className="exploration-empty" role="status">Time slots are unavailable from the connected source.</p>;
 const save=(patch:Record<string,unknown>)=>{setSelectionError('');store.set(statePath(p.stateKey),{...object(store.get(statePath(p.stateKey))),...patch});};
 const choose=(slot:ScheduleData['slots'][number])=>{if(slot.availability!=='unavailable')save({selectedId:slot.id,visibleDate:datesById.get(slot.id)});};
 const slotKeyboard=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const available=slots.filter(slot=>slot.availability!=='unavailable');if(!available.length)return;const current=available.findIndex(slot=>slot.id===slots[index].id),next=event.key==='Home'?0:event.key==='End'?available.length-1:(current+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+available.length)%available.length;choose(available[next]);event.currentTarget.closest('.schedule-slots')?.querySelector<HTMLButtonElement>(`[data-slot-index="${slots.indexOf(available[next])}"]`)?.focus();};
 const dateFormat=new Intl.DateTimeFormat(undefined,{timeZone:data.timeZone,weekday:'short',month:'short',day:'numeric'}),timeFormat=new Intl.DateTimeFormat(undefined,{timeZone:data.timeZone,hour:'numeric',minute:'2-digit'}),rangeDateFormat=new Intl.DateTimeFormat(undefined,{timeZone:data.timeZone,year:'numeric',month:'short',day:'numeric'});
 const submit=()=>{const raw=store.get(inputPath(p.dataBinding)),latest=boundedExplorationData('SchedulePicker',raw)?EXPLORATION_DATA_SCHEMAS.SchedulePicker.safeParse(raw):null,current=latest?.success?latest.data.slots.find(slot=>slot.id===object(store.get(statePath(p.stateKey))).selectedId):null;if(!latest?.success||!current||current.availability==='unavailable'){setSelectionError('This window changed. Choose an available time before submitting.');return;}if(p.actionId)void action.run(p.actionId,{slotId:current.id,start:current.start,end:current.end,timeZone:latest.data.timeZone});};
 return <section className="exploration-tools schedule-picker" aria-label={data.title??'Choose a time'}><Heading title={data.title} detail={data.timeZone}/>
  {!slots.length?<p className="exploration-empty">No time windows were supplied.</p>:<div className="schedule-slots" role="listbox" aria-label="Time windows">{dates.map((date,dayIndex)=>{
   const group=groups.get(date)!,first=group[0],start=Math.floor(Date.parse(first.start)/3600000)*3600000,end=Math.max(start+3600000,Math.ceil(Math.max(...group.map(slot=>Date.parse(slot.end)))/3600000)*3600000),span=end-start;
   return <section key={date} className="schedule-day" role="group" aria-labelledby={`${id}-day-${dayIndex}`}>
    <h4 id={`${id}-day-${dayIndex}`}><CalendarDays size={14} aria-hidden="true"/>{dateFormat.format(new Date(first.start))}</h4>
    <div className="schedule-time-axis" aria-hidden="true"><span>{timeFormat.format(new Date(start))}</span><span>{timeFormat.format(new Date(start+span/2))}</span><span>{timeFormat.format(new Date(end))}</span></div>
    {group.map(slot=>{const index=slots.indexOf(slot),chosen=selected?.id===slot.id,disabled=slot.availability==='unavailable',firstAvailable=slots.findIndex(item=>item.availability!=='unavailable');return <div key={slot.id} className="schedule-window" data-selected={chosen}>
     <button type="button" role="option" className={`schedule-interval is-${slot.availability}`} aria-label={slot.label??slotTime(slot,timeFormat,rangeDateFormat)} aria-describedby={`${id}-slot-${index} ${id}-availability-${index}`} aria-selected={chosen} aria-disabled={disabled} disabled={disabled} data-slot-index={index} tabIndex={chosen&&!disabled||(!selected||selected.availability==='unavailable')&&firstAvailable===index?0:-1} onClick={()=>choose(slot)} onKeyDown={event=>slotKeyboard(event,index)}>
      <span className="schedule-slot-heading"><span className="schedule-slot-label"><span className="schedule-choice" aria-hidden="true">{chosen&&<Check size={12}/>}</span>{slot.label??'Time window'}</span><span id={`${id}-availability-${index}`} className={`schedule-availability is-${slot.availability}`}>{disabled?'Unavailable':chosen?slot.availability==='tentative'?'Selected · Tentative':'Selected':slot.availability==='tentative'?'Tentative':'Available'}</span></span>
      <span className="schedule-slot-time" id={`${id}-slot-${index}`}><strong>{slotTime(slot,timeFormat,rangeDateFormat)}</strong><small>{slotDuration(slot)}</small></span>
      <span className="schedule-interval-ruler" aria-hidden="true"><span className="schedule-interval-band" style={{left:`${(Date.parse(slot.start)-start)/span*100}%`,width:`${(Date.parse(slot.end)-Date.parse(slot.start))/span*100}%`}}>{chosen&&<Check size={15}/>}</span></span>
     </button>
     {chosen&&slot.detail&&<p className="schedule-slot-detail">{slot.detail}</p>}
    </div>;})}
   </section>;
  })}</div>}
  {Boolean(saved.selectedId)&&!selected&&<p role="status" className="schedule-change-notice">The selected window is no longer supplied. Choose another.</p>}
  {selected?.availability==='unavailable'&&<p role="status" className="schedule-change-notice">This window is no longer available. Choose another.</p>}
  {p.actionId&&<footer className="exploration-footer schedule-proposal"><span className="schedule-proposal-selection">{action.busy?'':selected&&selected.availability!=='unavailable'?`${dateFormat.format(new Date(selected.start))} · ${slotTime(selected,timeFormat,rangeDateFormat)}`:'Select a time above'}</span><button type="button" className="primary" disabled={action.busy||!selected||selected.availability==='unavailable'} onClick={submit}>{action.busy?'Sending…':p.actionLabel??'Propose this time'}</button></footer>}{(selectionError||action.error)&&<p role="status" className="error-text">{selectionError||action.error}</p>}<Source text={data.source}/>
 </section>;
}

const levels=['error','warning','info','debug','unknown'] as const;
const logTimeFormat=new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'});
export function LogExplorer({element:{props}}:ComponentRenderProps){
 const inline=useContext(ArtifactInline);
 const p=EXPLORATION_SCHEMAS.LogExplorer.parse(props),store=useStateStore(),action=useTaskAction(),raw=store.get(inputPath(p.dataBinding)),scroll=useRef<HTMLDivElement>(null),[selectionError,setSelectionError]=useState('');
 const parsed=useMemo(()=>boundedExplorationData('LogExplorer',raw)?EXPLORATION_DATA_SCHEMAS.LogExplorer.safeParse(raw):null,[raw]),data=parsed?.success?parsed.data:null,saved=object(store.get(statePath(p.stateKey)));
 const query=typeof saved.query==='string'?saved.query.slice(0,200):'',follow=!inline&&saved.followTail===true;
 const activeLevels=useMemo(()=>Array.isArray(saved.levels)?levels.filter(level=>saved.levels instanceof Array&&saved.levels.includes(level)):[...levels],[saved.levels]);
 const events=useMemo(()=>data?.events??[],[data]);
 const filtered=useMemo(()=>{const needle=query.toLowerCase();return events.filter(event=>activeLevels.includes(event.level)&&(!needle||[event.message,event.detail,event.stream,event.correlationId].some(value=>value?.toLowerCase().includes(needle))));},[events,activeLevels,query]);
 const correlations=useMemo(()=>{const counts=new Map<string,number>();for(const event of events)if(event.correlationId)counts.set(event.correlationId,(counts.get(event.correlationId)??0)+1);return counts;},[events]);
 const selected=saved.selectedId?filtered.find(event=>event.id===saved.selectedId):filtered[0],detail=useSelectionMotion(selected?.id);
 const save=(patch:Record<string,unknown>)=>{setSelectionError('');store.set(statePath(p.stateKey),{...object(store.get(statePath(p.stateKey))),...patch});};
 useLayoutEffect(()=>{if(follow&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[follow,filtered.length,filtered.at(-1)?.id]);
 if(!data)return <p className="exploration-empty" role="status">Logs are unavailable from the connected source.</p>;
 const select=(index:number,focus=false)=>{const item=filtered[index];if(!item)return;save({selectedId:item.id,...(focus?{followTail:false}:{})});if(focus){const button=scroll.current?.querySelector<HTMLButtonElement>(`[data-event-index="${index}"]`);button?.focus({preventScroll:true});button?.scrollIntoView({block:'nearest'});}};
 const submit=()=>{const raw=store.get(inputPath(p.dataBinding)),latest=boundedExplorationData('LogExplorer',raw)?EXPLORATION_DATA_SCHEMAS.LogExplorer.safeParse(raw):null,target=object(store.get(statePath(p.stateKey))).selectedId??selected?.id,current=latest?.success?latest.data.events.find(event=>event.id===target):null;if(!current){setSelectionError('This event is no longer supplied. Select another event.');return;}if(p.actionId)void action.run(p.actionId,{eventId:current.id,...(current.correlationId?{correlationId:current.correlationId}:{})});};
 const keyboard=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();select(event.key==='Home'?0:event.key==='End'?filtered.length-1:Math.max(0,Math.min(filtered.length-1,index+(event.key==='ArrowDown'?1:-1))),true);};
 return <section className="exploration-tools log-explorer" aria-label={data.title??'Log explorer'}><Heading title={data.title} detail={`${filtered.length} / ${events.length} events`}/>
  <div className="log-toolbar"><label className="log-search"><Search size={14}/><input aria-label="Search logs" type="search" maxLength={200} placeholder="Search messages, streams, details…" value={query} onChange={event=>save({query:event.target.value})}/></label>{!inline&&<button type="button" className="quiet" aria-pressed={follow} onClick={()=>save({followTail:!follow})}><ArrowDown size={13}/>{follow?'Following':'Follow latest'}</button>}</div>
  <fieldset className="log-levels"><legend><Filter size={12}/>Levels</legend>{levels.map(level=><label key={level} className={`log-level is-${level}`}><input type="checkbox" checked={activeLevels.includes(level)} onChange={()=>save({levels:activeLevels.includes(level)?activeLevels.filter(item=>item!==level):[...activeLevels,level]})}/>{level[0].toUpperCase()+level.slice(1)}</label>)}</fieldset>
  <div className="log-content"><div ref={scroll} className="log-events" role="listbox" aria-label="Log events" onScroll={event=>{const node=event.currentTarget;if(follow&&node.scrollHeight-node.scrollTop-node.clientHeight>12)save({followTail:false});}} onWheel={()=>{if(follow)save({followTail:false});}} onTouchStart={()=>{if(follow)save({followTail:false});}}>{!filtered.length?<p className="exploration-empty">{events.length?'No events match these filters.':'No log events were supplied.'}</p>:filtered.map((event,index)=>{
   const chosen=selected?.id===event.id,related=Boolean(selected?.correlationId&&event.correlationId===selected.correlationId),relatedCount=event.correlationId?correlations.get(event.correlationId)??0:0;
   return <div className={`log-entry${related?' is-related':''}`} key={event.id} role="presentation">
    <button type="button" role="option" aria-label={`${event.level}: ${event.message}`} aria-selected={chosen} className={`log-event is-${event.level}`} data-event-index={index} tabIndex={chosen||!selected&&index===0?0:-1} onClick={()=>select(index)} onKeyDown={key=>keyboard(key,index)}><span className="log-event-level">{event.level}</span><span className="log-event-message">{event.message}</span><time dateTime={event.timestamp} title={event.timestamp?`${event.timestamp} (UTC display)`:'Time unavailable'}>{event.timestamp?logTimeFormat.format(new Date(event.timestamp)):'—'}</time><ChevronRight className="log-event-indicator" data-expanded={chosen} size={13} aria-hidden="true"/></button>
    {chosen&&<div className="log-selection" ref={detail}><div className="log-selected-heading">{event.stream&&<strong>{event.stream}</strong>}{relatedCount>1&&<span>{relatedCount} related events</span>}</div><dl><div><dt>Time</dt><dd>{event.timestamp?`${new Date(event.timestamp).toISOString()} (UTC)`:'Unavailable'}</dd></div>{event.correlationId&&<div><dt>Correlation</dt><dd>{event.correlationId}</dd></div>}</dl>{event.detail&&<details className="log-event-details"><summary>Event details</summary><pre>{event.detail}</pre></details>}</div>}
   </div>;
  })}</div></div>
  {p.actionId&&<footer className="exploration-footer"><button type="button" className="primary" disabled={action.busy||!selected} onClick={submit}>{action.busy?'Sending…':p.actionLabel??'Investigate event'}</button></footer>}{(selectionError||action.error)&&<p role="status" className="error-text">{selectionError||action.error}</p>}<Source text={data.source}/>
 </section>;
}
export const EXPLORATION_REGISTRY:ComponentRegistry={ImageAnnotator,SchedulePicker,LogExplorer};
