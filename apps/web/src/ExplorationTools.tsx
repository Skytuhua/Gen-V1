import {useContext,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type KeyboardEvent,type RefObject} from 'react';
import {useStateStore,type ComponentRegistry,type ComponentRenderProps} from '@json-render/react';
import {ArrowDown,CalendarDays,Check,ChevronRight,Filter,Plus,Search,Trash2} from 'lucide-react';
import {EXPLORATION_SCHEMAS,EXPLORATION_DATA_SCHEMAS,boundedExplorationData,readAnnotationState,type AnnotationState,type ScheduleData} from '../../../packages/ui-catalog/exploration';
import {ArtifactInline,ArtifactTitle,inputPath,statePath,useTaskAction} from './task-context';
import {useDocumentEvidence} from './document-evidence';
import {animateTask} from './task-motion';
import {readMotionPolicy,observeMotionPolicy} from './motion-policy';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import './exploration-tools.css';

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
function Source({text}:{text?:string}){return text?<details className="exploration-source"><summary>Source</summary><p>{text}</p></details>:null;}
function Heading({title,detail}:{title?:string;detail?:string}){const outer=useContext(ArtifactTitle);return title&&title!==outer||detail?<header className="exploration-heading">{title&&title!==outer?<h3>{title}</h3>:<span/>}{detail&&<span>{detail}</span>}</header>:null;}

type Activation='pointer'|'keyboard';
/** Pointer clicks carry a positive detail; keyboard/assistive activation is immediate. */
const activationOf=(detail:number|undefined):Activation=>typeof detail==='number'&&detail>0?'pointer':'keyboard';
/** Exact duration, repository enter curve; animateTask owns policy/speed handling. */
const accent=(element:Element|null|undefined,frames:Keyframe[],ms:number)=>animateTask(element??null,frames,ms,{duration:'--ui-motion-none',easing:'--ui-ease-enter'});

/** One first-publication ornament per surface. Runs only while the owning artifact
 * is in its host "entering" phase under full effective motion, cancels on first
 * pointer input, policy downgrade, source swap or unmount. */
function useEntryOrnament(ref:RefObject<HTMLElement|null>,enabled:boolean,decorate:(root:HTMLElement)=>Animation[]){
 const done=useRef(false),decorateRef=useRef(decorate);decorateRef.current=decorate;
 useLayoutEffect(()=>{
  if(!enabled||done.current)return;
  let animations:Animation[]=[],stopObserving=()=>{};
  const frame=requestAnimationFrame(()=>{
   const element=ref.current;
   if(!element||done.current)return;
   const artifact=element.closest('.artifact');
   if(artifact?.getAttribute('data-entry-phase')!=='entering'||readMotionPolicy()!=='full')return;
   done.current=true;
   animations=decorateRef.current(element);
   const stop=()=>animations.forEach(item=>item.cancel());
   const stopAll=()=>{artifact.removeEventListener('pointerdown',stop);artifact.removeEventListener('focusin',stop);stopObserving();};
   stopObserving=observeMotionPolicy(policy=>{if(policy!=='full')stop();});
   artifact.addEventListener('pointerdown',stop,{once:true});
   artifact.addEventListener('focusin',stop,{once:true});
   Promise.allSettled(animations.map(item=>item.finished)).then(stopAll);
  });
  return()=>{cancelAnimationFrame(frame);stopObserving();animations.forEach(item=>item.cancel());};
 },[enabled,ref]);
}

type AnnotatorProps={resourceId:string;alt:string;stateKey:string;title?:string;actionId?:string;actionLabel?:string};
function AnnotationCanvas({p,value,read,change}:{p:AnnotatorProps;value:AnnotationState;read:()=>AnnotationState;change:(value:AnnotationState)=>void}){
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),action=useTaskAction(),stage=useRef<HTMLDivElement>(null),note=useRef<HTMLDivElement>(null),pendingPin=useRef<{id:string;cause:Activation}|null>(null),selectCause=useRef<Activation|null>(null),previousSelected=useRef(value.selectedId);
 const selected=value.annotations.find(pin=>pin.id===value.selectedId),count=value.annotations.length;
 useEffect(()=>{if(ready||error)return;const timeout=setTimeout(()=>setError('The image is taking too long to load. Check access and retry.'),15000);return()=>clearTimeout(timeout);},[ready,error,retry]);
 // Consume the one-shot marker claim on the first render holding that pin; a
 // pointer selection accent fires once per deliberate click on a different pin.
 useLayoutEffect(()=>{
  const claim=pendingPin.current;
  if(claim){pendingPin.current=null;if(claim.cause==='pointer')accent(stage.current?.querySelector(`[data-pin-id="${claim.id}"] .annotation-pin-face`),[{transform:'scale(.92)'},{transform:'scale(1)'}],160);}
  const previous=previousSelected.current;previousSelected.current=value.selectedId;
  const cause=selectCause.current;selectCause.current=null;
  if(previous!==value.selectedId&&value.selectedId&&cause==='pointer'){accent(stage.current?.querySelector(`[data-pin-id="${value.selectedId}"] .annotation-pin-face`),[{borderColor:'var(--ui-focus-ring,#808080)'},{borderColor:'#fff'}],120);accent(note.current,[{opacity:.85},{opacity:1}],120);}
 },[value]);
 useEntryOrnament(stage,ready,element=>{const mark=document.createElement('span');mark.className='annotation-entry-mark';mark.setAttribute('aria-hidden','true');mark.innerHTML='<i class="i-top"></i><i class="i-side"></i>';element.append(mark);return [animateTask(mark.querySelector('.i-top'),[{transform:'scaleX(0)'},{transform:'scaleX(1)'}],140),animateTask(mark.querySelector('.i-side'),[{transform:'scaleY(0)'},{transform:'scaleY(1)'}],140)].filter((item):item is Animation=>Boolean(item));});
 const add=(x=.5,y=.5,cause:Activation='keyboard')=>{const current=read();if(!ready||current.annotations.length>=32)return;const id='pin_'+crypto.randomUUID();pendingPin.current={id,cause};change({...current,selectedId:id,annotations:[...current.annotations,{id,x:clamp(x),y:clamp(y),text:''}]});requestAnimationFrame(()=>stage.current?.querySelector<HTMLButtonElement>(`[data-pin-id="${id}"]`)?.focus({preventScroll:true}));};
 const patch=(update:Partial<AnnotationState['annotations'][number]>)=>{const current=read();if(current.selectedId)change({...current,annotations:current.annotations.map(pin=>pin.id===current.selectedId?{...pin,...update}:pin)});};
 const move=(event:KeyboardEvent<HTMLButtonElement>)=>{const current=read(),pin=current.annotations.find(item=>item.id===current.selectedId);if(!pin||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const delta=event.shiftKey ? .05 : .01;patch({x:clamp(pin.x+(event.key==='ArrowRight'?delta:event.key==='ArrowLeft'?-delta:0)),y:clamp(pin.y+(event.key==='ArrowDown'?delta:event.key==='ArrowUp'?-delta:0))});};
 const choose=(id:string,cause:Activation)=>{selectCause.current=cause;change({...value,selectedId:id});};
 const remove=(id:string)=>{const current=read(),annotations=current.annotations.filter(pin=>pin.id!==id);change({...current,selectedId:annotations[0]?.id??null,annotations});requestAnimationFrame(()=>{const target=annotations[0]?stage.current?.querySelector<HTMLButtonElement>(`[data-pin-id="${annotations[0].id}"]`):stage.current?.closest('.exploration-tools')?.querySelector<HTMLButtonElement>('.annotation-toolbar button');target?.focus({preventScroll:true});});};
 const submit=()=>{const current=read();if(!p.actionId||!current.annotations.length)return;if(current.annotations.some(pin=>!pin.text.trim())){setError('Add feedback to every pin before sending.');return;}setError('');void action.run(p.actionId,{resourceId:p.resourceId,annotations:current.annotations});};
 return <><div className="annotation-toolbar"><span>{count} {count===1?'pin':'pins'}</span><button type="button" className="secondary" disabled={!ready||count>=32} onClick={event=>add(.5,.5,activationOf(event.detail))}><Plus size={14}/>Add pin</button></div>
  <div className="annotation-layout"><div className="annotation-image-wrap"><div ref={stage} className="annotation-image" data-ready={ready}>
   <button type="button" className="annotation-image-button" aria-label="Add pin to image" disabled={!ready||count>=32} onClick={event=>{if(event.detail===0){add(.5,.5,'keyboard');return;}const bounds=event.currentTarget.getBoundingClientRect();if(bounds.width&&bounds.height)add((event.clientX-bounds.left)/bounds.width,(event.clientY-bounds.top)/bounds.height,'pointer');}}>
   <img key={retry} src={`/api/resources/${encodeURIComponent(p.resourceId)}/content`} alt={p.alt} draggable={false} onLoad={event=>{if(!event.currentTarget.naturalWidth||!event.currentTarget.naturalHeight){setError('This resource is not a readable image.');return;}setError('');setReady(true);}} onError={()=>{setReady(false);setError('The image is unavailable. Check its grant and retry.');}}/>
   </button>
   {ready&&value.annotations.map((pin,index)=><button type="button" key={pin.id} data-pin-id={pin.id} className="annotation-pin" aria-label={`Pin ${index+1}`} aria-pressed={pin.id===value.selectedId} title={pin.text||`Pin ${index+1}`} style={{left:`${pin.x*100}%`,top:`${pin.y*100}%`}} onClick={event=>{event.stopPropagation();choose(pin.id,activationOf(event.detail));}} onKeyDown={move}><span className="annotation-pin-face" aria-hidden="true">{index+1}</span></button>)}
  </div>{!ready&&!error&&<p className="exploration-empty" role="status">Loading image…</p>}</div>
  <div className="annotation-detail">{selected?<div ref={note}><div className="annotation-detail-heading"><strong>Pin {value.annotations.indexOf(selected)+1}</strong><button type="button" className="icon-button" aria-label="Delete selected pin" onClick={()=>remove(selected.id)}><Trash2 size={14}/></button></div><label className="exploration-field"><span>Feedback</span><textarea aria-label="Pin feedback" value={selected.text} maxLength={800} rows={3} placeholder="What should change here?" onChange={event=>{setError('');patch({text:event.target.value});}}/></label><p className="exploration-hint">Arrow keys move the selected pin.</p></div>:<div className="annotation-empty"><p>Click the image or add a pin.</p></div>}
   {count>0&&<ol className="annotation-list">{value.annotations.map((pin,index)=><li key={pin.id}><button type="button" aria-label={`Select pin ${index+1}`} aria-current={pin.id===value.selectedId?'true':undefined} onClick={event=>choose(pin.id,activationOf(event.detail))}><span>{index+1}</span><span>{pin.text||'Add feedback'}</span><ChevronRight size={12}/></button></li>)}</ol>}
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

type ScheduleFormats={day:Intl.DateTimeFormat;date:Intl.DateTimeFormat;time:Intl.DateTimeFormat;range:Intl.DateTimeFormat};
const scheduleFormats=new Map<string,ScheduleFormats>();
function formatsFor(timeZone:string){let formats=scheduleFormats.get(timeZone);if(!formats){formats={day:new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}),date:new Intl.DateTimeFormat(undefined,{timeZone,weekday:'short',month:'short',day:'numeric'}),time:new Intl.DateTimeFormat(undefined,{timeZone,hour:'numeric',minute:'2-digit'}),range:new Intl.DateTimeFormat(undefined,{timeZone,year:'numeric',month:'short',day:'numeric'})};scheduleFormats.set(timeZone,formats);}return formats;}
function scheduleLayout(data:ScheduleData|null){
 const slots=data?[...data.slots].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)):[],groups=new Map<string,ScheduleData['slots']>(),datesById=new Map<string,string>();
 if(data){const format=formatsFor(data.timeZone).day;for(const slot of slots){const parts=format.formatToParts(new Date(slot.start)),field=(name:string)=>parts.find(item=>item.type===name)?.value,date=`${field('year')}-${field('month')}-${field('day')}`;datesById.set(slot.id,date);const group=groups.get(date)??[];group.push(slot);groups.set(date,group);}}
 return {slots,groups,datesById,dates:[...groups.keys()]};
}
function slotTime(slot:ScheduleData['slots'][number],format:Intl.DateTimeFormat,date:Intl.DateTimeFormat){
 const start=new Date(slot.start),end=new Date(slot.end);
 return `${format.format(start)} – ${date.format(start)!==date.format(end)?`${date.format(end)}, `:''}${format.format(end)}`;
}
const durationFormat=new Intl.NumberFormat(undefined,{maximumFractionDigits:1});
const logTimeFormat=new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'});
function slotDuration(slot:ScheduleData['slots'][number]){
 const minutes=(Date.parse(slot.end)-Date.parse(slot.start))/60000;
 if(minutes<60)return `${durationFormat.format(minutes)} min`;
 const hours=Math.floor(minutes/60),remaining=minutes-hours*60;
 return `${hours} hr${remaining?` ${durationFormat.format(remaining)} min`:''}`;
}
export function SchedulePicker({element:{props}}:ComponentRenderProps){
 const p=EXPLORATION_SCHEMAS.SchedulePicker.parse(props),store=useStateStore(),action=useTaskAction(),id=useId(),raw=store.get(inputPath(p.dataBinding)),[selectionError,setSelectionError]=useState(''),list=useRef<HTMLElement>(null),chooseCause=useRef<Activation|null>(null),previousSelected=useRef<string|null|undefined>(undefined);
 const parsed=useMemo(()=>boundedExplorationData('SchedulePicker',raw)?EXPLORATION_DATA_SCHEMAS.SchedulePicker.safeParse(raw):null,[raw]);
 const data=parsed?.success?parsed.data:null,saved=object(store.get(statePath(p.stateKey))),layout=useMemo(()=>scheduleLayout(data),[data]),{slots,dates,datesById,groups}=layout;
 const selected=slots.find(slot=>slot.id===saved.selectedId);
 useLayoutEffect(()=>{
  const previous=previousSelected.current;previousSelected.current=typeof saved.selectedId==='string'?saved.selectedId:null;
  const cause=chooseCause.current;chooseCause.current=null;
  if(!data||previous===saved.selectedId||typeof saved.selectedId!=='string'||cause!=='pointer')return;
  const option=list.current?.querySelector<HTMLElement>('.schedule-interval[aria-selected="true"]');
  accent(option,[{backgroundColor:'transparent',borderColor:'transparent'},{backgroundColor:'var(--selection-bg,var(--subtle))',borderColor:'var(--selection-border,var(--muted))'}],120);
  accent(option?.querySelector('.schedule-choice'),[{opacity:0},{opacity:1}],100);
 },[saved.selectedId,data]);
 useEntryOrnament(list,Boolean(data),element=>{const mark=element.querySelector<HTMLElement>('.schedule-interval:not(.is-unavailable) .schedule-interval-band');return mark?[animateTask(mark,[{opacity:.55},{opacity:1}],120)!].filter(Boolean):[];});
 if(!data)return <p className="exploration-empty" role="status">Time slots are unavailable from the connected source.</p>;
 const save=(patch:Record<string,unknown>)=>{setSelectionError('');store.set(statePath(p.stateKey),{...object(store.get(statePath(p.stateKey))),...patch});};
 const choose=(slot:ScheduleData['slots'][number],cause:Activation)=>{if(slot.availability==='unavailable')return;chooseCause.current=cause;save({selectedId:slot.id,visibleDate:datesById.get(slot.id)});};
 const slotKeyboard=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{if(isComposing(event)||!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const available=slots.filter(slot=>slot.availability!=='unavailable');if(!available.length)return;const current=available.findIndex(slot=>slot.id===slots[index].id),next=event.key==='Home'?0:event.key==='End'?available.length-1:(current+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+available.length)%available.length;choose(available[next],'keyboard');event.currentTarget.closest('.schedule-slots')?.querySelector<HTMLButtonElement>(`[data-slot-index="${slots.indexOf(available[next])}"]`)?.focus();};
 const {date:dateFormat,time:timeFormat,range:rangeDateFormat}=formatsFor(data.timeZone);
 const submit=()=>{const raw=store.get(inputPath(p.dataBinding)),latest=boundedExplorationData('SchedulePicker',raw)?EXPLORATION_DATA_SCHEMAS.SchedulePicker.safeParse(raw):null,current=latest?.success?latest.data.slots.find(slot=>slot.id===object(store.get(statePath(p.stateKey))).selectedId):null;if(!latest?.success||!current||current.availability==='unavailable'){setSelectionError('This window changed. Choose an available time before submitting.');return;}if(p.actionId)void action.run(p.actionId,{slotId:current.id,start:current.start,end:current.end,timeZone:latest.data.timeZone});};
 return <section className="exploration-tools schedule-picker" aria-label={data.title??'Choose a time'} ref={list}><Heading title={data.title} detail={data.timeZone}/>
  {!slots.length?<p className="exploration-empty">No time windows were supplied.</p>:<div className="schedule-slots" role="listbox" aria-label="Time windows">{dates.map((date,dayIndex)=>{
   const group=groups.get(date)!,first=group[0],start=Math.floor(Date.parse(first.start)/3600000)*3600000,end=Math.max(start+3600000,Math.ceil(Math.max(...group.map(slot=>Date.parse(slot.end)))/3600000)*3600000),span=end-start;
   return <section key={date} className="schedule-day" role="group" aria-labelledby={`${id}-day-${dayIndex}`}>
    <h4 id={`${id}-day-${dayIndex}`}><CalendarDays size={14} aria-hidden="true"/>{dateFormat.format(new Date(first.start))}</h4>
    <div className="schedule-time-axis" aria-hidden="true"><span>{timeFormat.format(new Date(start))}</span><span>{timeFormat.format(new Date(start+span/2))}</span><span>{timeFormat.format(new Date(end))}</span></div>
    {group.map(slot=>{const index=slots.indexOf(slot),chosen=selected?.id===slot.id,disabled=slot.availability==='unavailable',firstAvailable=slots.findIndex(item=>item.availability!=='unavailable');return <div key={slot.id} className="schedule-window" data-selected={chosen} data-slot-id={slot.id}>
     <button type="button" role="option" className={`schedule-interval is-${slot.availability}`} aria-label={slot.label??slotTime(slot,timeFormat,rangeDateFormat)} aria-describedby={`${id}-slot-${index} ${id}-availability-${index}`} aria-selected={chosen} aria-disabled={disabled} disabled={disabled} data-slot-index={index} tabIndex={chosen&&!disabled||(!selected||selected.availability==='unavailable')&&firstAvailable===index?0:-1} onClick={event=>choose(slot,activationOf(event.detail))} onKeyDown={event=>slotKeyboard(event,index)}>
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
export function LogExplorer({element:{props}}:ComponentRenderProps){
 const inline=useContext(ArtifactInline);
 const p=EXPLORATION_SCHEMAS.LogExplorer.parse(props),store=useStateStore(),action=useTaskAction(),raw=store.get(inputPath(p.dataBinding)),scroll=useRef<HTMLDivElement>(null),[selectionError,setSelectionError]=useState(''),anchor=useRef<{id:string;top:number}|null>(null),selectCause=useRef<Activation|null>(null),previousSelected=useRef<string|null|undefined>(undefined);
 const parsed=useMemo(()=>boundedExplorationData('LogExplorer',raw)?EXPLORATION_DATA_SCHEMAS.LogExplorer.safeParse(raw):null,[raw]),data=parsed?.success?parsed.data:null,saved=object(store.get(statePath(p.stateKey)));

 const query=typeof saved.query==='string'?saved.query.slice(0,200):'',follow=!inline&&saved.followTail===true;
 const activeLevels=useMemo(()=>Array.isArray(saved.levels)?levels.filter(level=>saved.levels instanceof Array&&saved.levels.includes(level)):[...levels],[saved.levels]);
 const events=useMemo(()=>data?.events??[],[data]);
 const filtered=useMemo(()=>{const needle=query.toLowerCase();return events.filter(event=>activeLevels.includes(event.level)&&(!needle||[event.message,event.detail,event.stream,event.correlationId].some(value=>value?.toLowerCase().includes(needle))));},[events,activeLevels,query]);
 const correlations=useMemo(()=>{const counts=new Map<string,number>();for(const event of events)if(event.correlationId)counts.set(event.correlationId,(counts.get(event.correlationId)??0)+1);return counts;},[events]);
 const selected=saved.selectedId?filtered.find(event=>event.id===saved.selectedId):filtered[0];
 const hiddenId=typeof saved.selectedId==='string'&&saved.selectedId&&!selected?saved.selectedId:null;
 const hiddenInSource=hiddenId?events.some(event=>event.id===hiddenId):false;
 useLayoutEffect(()=>{if(follow&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[follow,filtered.length,filtered.at(-1)?.id]);
 // Selection response only for a deliberate pointer pick of a different event;
 // appends keep the reader anchored on the previously visible row.
 useLayoutEffect(()=>{
  const previous=previousSelected.current;previousSelected.current=selected?.id??null;
  const cause=selectCause.current;selectCause.current=null;
  const node=scroll.current;
  if(node&&!follow&&anchor.current){
   const row=node.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(anchor.current.id)}"] .log-event`);
   if(row)node.scrollTop+=row.getBoundingClientRect().top-anchor.current.top;
  }
  if(node&&!follow){const visible=[...node.querySelectorAll<HTMLElement>('[data-event-id]')].map(entry=>({id:entry.dataset.eventId!,top:entry.getBoundingClientRect().top})).find(entry=>entry.top>=node.getBoundingClientRect().top-1);anchor.current=visible??null;}
  if(previous!==selected?.id&&selected&&cause==='pointer')accent(node?.querySelector(`[data-event-id="${CSS.escape(selected.id)}"] .log-event`),[{backgroundColor:'transparent',boxShadow:'inset 0 0 0 1px transparent'},{backgroundColor:'var(--selection-bg,var(--subtle))',boxShadow:'inset 0 0 0 1px var(--selection-border,var(--muted))'}],120);
 },[filtered,selected?.id,follow]);
 useLayoutEffect(()=>{const node=scroll.current;if(!node)return;const refresh=()=>{const top=node.getBoundingClientRect().top,visible=[...node.querySelectorAll<HTMLElement>('[data-event-id]')].find(entry=>entry.getBoundingClientRect().bottom>=top-1);anchor.current=visible?{id:visible.dataset.eventId!,top:visible.getBoundingClientRect().top}:anchor.current;};node.addEventListener('scroll',refresh,{passive:true});return()=>node.removeEventListener('scroll',refresh);},[Boolean(data)]);
 useEntryOrnament(scroll,Boolean(data?.events.length),element=>{const mark=document.createElement('span');mark.className='log-entry-mark';mark.setAttribute('aria-hidden','true');element.querySelector('.log-entry')?.append(mark);return [animateTask(mark,[{transform:'scaleY(0)'},{transform:'scaleY(1)'}],100)!].filter(Boolean);});
 if(!data)return <p className="exploration-empty" role="status">Logs are unavailable from the connected source.</p>;
 const save=(patch:Record<string,unknown>)=>{setSelectionError('');store.set(statePath(p.stateKey),{...object(store.get(statePath(p.stateKey))),...patch});};
 const select=(index:number,focus=false,cause:Activation='keyboard')=>{const item=filtered[index];if(!item)return;selectCause.current=cause;save({selectedId:item.id,...(focus?{followTail:false}:{})});const button=scroll.current?.querySelector<HTMLButtonElement>(`[data-event-index="${index}"]`);if(button)anchor.current={id:item.id,top:button.getBoundingClientRect().top};if(focus){button?.focus({preventScroll:true});button?.scrollIntoView({block:'nearest'});}};
 const submit=()=>{const raw=store.get(inputPath(p.dataBinding)),latest=boundedExplorationData('LogExplorer',raw)?EXPLORATION_DATA_SCHEMAS.LogExplorer.safeParse(raw):null,current=object(store.get(statePath(p.stateKey)));const needle=(typeof current.query==='string'?current.query.slice(0,200):'').toLowerCase(),currentLevels=Array.isArray(current.levels)?levels.filter(level=>(current.levels as unknown[]).includes(level)):[...levels],target=current.selectedId;const visible=latest?.success?latest.data.events.filter(item=>currentLevels.includes(item.level)&&(!needle||[item.message,item.detail,item.stream,item.correlationId].some(value=>value?.toLowerCase().includes(needle)))):[];const event=(typeof target==='string'&&target?visible.find(item=>item.id===target):visible[0])??null;if(!latest?.success||!event){setSelectionError(hiddenInSource||!latest?.success?'This event is hidden by the current filters.':'This event is no longer supplied. Select another event.');return;}if(p.actionId)void action.run(p.actionId,{eventId:event.id,...(event.correlationId?{correlationId:event.correlationId}:{})});};
 const keyboard=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();select(event.key==='Home'?0:event.key==='End'?filtered.length-1:Math.max(0,Math.min(filtered.length-1,index+(event.key==='ArrowDown'?1:-1))),true,'keyboard');};
 return <section className="exploration-tools log-explorer" aria-label={data.title??'Log explorer'}><Heading title={data.title} detail={`${filtered.length} / ${events.length} events`}/>
  <div className="log-toolbar"><label className="log-search"><Search size={14}/><input aria-label="Search logs" type="search" maxLength={200} placeholder="Search messages, streams, details…" value={query} onChange={event=>save({query:event.target.value})}/></label><fieldset className="log-levels"><legend className="sr-only">Levels</legend><span className="log-levels-label"><Filter size={12}/>Levels</span>{levels.map(level=><label key={level} className={`log-level is-${level}`}><input type="checkbox" checked={activeLevels.includes(level)} onChange={()=>save({levels:activeLevels.includes(level)?activeLevels.filter(item=>item!==level):[...activeLevels,level]})}/>{level[0].toUpperCase()+level.slice(1)}</label>)}</fieldset>{!inline&&<button type="button" className="quiet" aria-pressed={follow} onClick={()=>save({followTail:!follow})}><ArrowDown size={13}/>{follow?'Following':'Follow latest'}</button>}</div>
  <div className="log-content"><div ref={scroll} className="log-events" role="listbox" aria-label="Log events" onScroll={event=>{const node=event.currentTarget;if(follow&&node.scrollHeight-node.scrollTop-node.clientHeight>12)save({followTail:false});}} onWheel={()=>{if(follow)save({followTail:false});}} onTouchStart={()=>{if(follow)save({followTail:false});}}>{!filtered.length?<p className="exploration-empty">{events.length?'No events match these filters.':'No log events were supplied.'}</p>:filtered.map((event,index)=>{
   const chosen=selected?.id===event.id,related=Boolean(selected?.correlationId&&event.correlationId===selected.correlationId),relatedCount=event.correlationId?correlations.get(event.correlationId)??0:0;
   return <div className={`log-entry${related?' is-related':''}`} key={event.id} role="presentation" data-event-id={event.id}>
    <button type="button" role="option" aria-label={`${event.level}: ${event.message}`} aria-selected={chosen} className={`log-event is-${event.level}`} data-event-index={index} tabIndex={chosen||!selected&&index===0?0:-1} onClick={event=>select(index,false,activationOf(event.detail))} onKeyDown={key=>keyboard(key,index)}><span className="log-event-level">{event.level}</span><span className="log-event-message">{event.message}</span><time dateTime={event.timestamp} title={event.timestamp?`${event.timestamp} (UTC display)`:'Time unavailable'}>{event.timestamp?logTimeFormat.format(new Date(event.timestamp)):'—'}</time><ChevronRight className="log-event-indicator" data-expanded={chosen} size={13} aria-hidden="true"/></button>
    {chosen&&<div className="log-selection"><div className="log-selected-heading">{event.stream&&<strong>{event.stream}</strong>}{relatedCount>1&&<span>{relatedCount} related events</span>}</div><dl><div><dt>Time</dt><dd>{event.timestamp?`${new Date(event.timestamp).toISOString()} (UTC)`:'Unavailable'}</dd></div>{event.correlationId&&<div><dt>Correlation</dt><dd><button type="button" className="quiet log-correlation" aria-label={`Filter by correlation ${event.correlationId}`} onClick={()=>save({query:event.correlationId})}>{event.correlationId}</button></dd></div>}</dl>{event.detail&&<details className="log-event-details"><summary>Event details</summary><pre>{event.detail}</pre></details>}</div>}
   </div>;
  })}</div></div>
  {hiddenId&&<p role="status" className="schedule-change-notice">{hiddenInSource?'Selected event is hidden by the current filters.':'This event is no longer supplied. Select another event.'}</p>}
  {p.actionId&&<footer className="exploration-footer"><button type="button" className="primary" disabled={action.busy||!selected} onClick={submit}>{action.busy?'Sending…':p.actionLabel??'Investigate event'}</button></footer>}{(selectionError||action.error)&&<p role="status" className="error-text">{selectionError||action.error}</p>}<Source text={data.source}/>
 </section>;
}
export const EXPLORATION_REGISTRY:ComponentRegistry={ImageAnnotator,SchedulePicker,LogExplorer};
