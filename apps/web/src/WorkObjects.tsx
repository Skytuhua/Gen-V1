import {useContext,useId,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type KeyboardEvent,type RefObject} from 'react';
import {useStateStore,type ComponentRegistry,type ComponentRenderProps} from '@json-render/react';
import {ArrowRight,Check,ChevronDown,ChevronRight,Database,Focus,GripVertical,Layers,Monitor,Search,Server,Workflow} from 'lucide-react';
import {WORK_OBJECT_SCHEMAS,WORK_OBJECT_DATA_SCHEMAS,boundedWorkObjectData,readBoardDraft,boardDraftMatchesSource,boardProposal,type WorkflowData,type ArchitectureData,type TraceData} from '../../../packages/ui-catalog/work-objects';
import {ArtifactInline,ArtifactTitle,inputPath,statePath,useTaskAction} from './task-context';
import {MotionRegion,reducedMotion} from './task-motion';
import {createSpringValue} from './motion-spring';
import {readMotionPolicy,observeMotionPolicy} from './motion-policy';
import {Select} from '../../../packages/ui-shell/Select';
import './work-objects.css';

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
function Heading({title,caption}:{title?:string;caption:string}){
 const outer=useContext(ArtifactTitle);
 return <header className="work-object-heading">{title&&title!==outer?<h3>{title}</h3>:<span/>}<span>{caption}</span></header>;
}
function Source({text}:{text?:string}){return text?<details className="work-object-source"><summary>Source</summary><p>{text}</p></details>:null;}
function ActionError({error}:{error:string}){return error?<p className="error-text" role="alert">{error}</p>:null;}

/** Only a deliberate local move animates; restored artifacts start settled. */
function useBoardMotion(ref:RefObject<HTMLDivElement|null>,layout:string){
 const positions=useRef(new Map<string,DOMRect>()),springs=useRef<ReturnType<typeof createSpringValue>[]>([]);
 useLayoutEffect(()=>{
  const cards=Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-work-card]')??[]),next=new Map<string,DOMRect>();
  const before=positions.current;
  for(const card of cards)next.set(card.dataset.workCard!,card.getBoundingClientRect());
  springs.current.forEach(spring=>spring.dispose());springs.current=[];
  for(const card of cards){
   const previous=before.get(card.dataset.workCard!),current=next.get(card.dataset.workCard!);card.style.transform='';
   if(!previous||!current||reducedMotion()||current.bottom<0||current.top>innerHeight)continue;
   const x=previous.left-current.left,y=previous.top-current.top,distance=Math.hypot(x,y);
   if(distance<1)continue;
   const spring=createSpringValue(distance,value=>{card.style.transform=`translate(${x*value/distance}px,${y*value/distance}px)`;},()=>{card.style.transform='';});
   springs.current.push(spring);spring.to(0);
  }
  positions.current=next;
 },[layout,ref]);
 useLayoutEffect(()=>{
  const settle=()=>{springs.current.forEach(spring=>spring.dispose());springs.current=[];ref.current?.querySelectorAll<HTMLElement>('[data-work-card]').forEach(card=>{card.style.transform='';});};
  const stopObservingMotion=observeMotionPolicy(policy=>{if(policy!=='full')settle();});
  return()=>{stopObservingMotion();settle();};
 },[ref]);
}

export function WorkflowBoard({element:{props}}:ComponentRenderProps){
 const inline=useContext(ArtifactInline);
 const p=WORK_OBJECT_SCHEMAS.WorkflowBoard.parse(props),store=useStateStore(),action=useTaskAction(),raw=store.get(inputPath(p.dataBinding)),stage=useRef<HTMLDivElement>(null),dragged=useRef<string|null>(null),[dropLane,setDropLane]=useState<string|null>(null),[selectionError,setSelectionError]=useState('');
 const parsed=useMemo(()=>boundedWorkObjectData('WorkflowBoard',raw)?WORK_OBJECT_DATA_SCHEMAS.WorkflowBoard.safeParse(raw):null,[raw]);
 const data=parsed?.success?parsed.data:null,saved=data?readBoardDraft(store.get(statePath(p.stateKey)),data):null;
 const stale=Boolean(data&&saved&&!boardDraftMatchesSource(saved,data)),placements=new Map(stale?data?.cards.map(card=>[card.id,card.laneId]):saved?.placements.map(row=>[row.cardId,row.laneId])),selected=data?.cards.find(card=>card.id===saved?.selectedId),proposal=data?boardProposal(saved,data):null;
 useBoardMotion(stage,JSON.stringify([data?.revision,saved?.placements]));
 if(!data||!saved)return <p role="status" className="work-object-empty">Workflow data is unavailable from the connected source.</p>;
 const current=()=>readBoardDraft(store.get(statePath(p.stateKey)),data);
 const save=(value:ReturnType<typeof current>)=>{setSelectionError('');store.set(statePath(p.stateKey),value);};
 const select=(cardId:string)=>save({...current(),selectedId:cardId});
 const move=(cardId:string,laneId:string)=>{
  const latest=current();if(!boardDraftMatchesSource(latest,data)||!data.cards.some(card=>card.id===cardId)||!data.lanes.some(lane=>lane.id===laneId))return;
  save({...latest,selectedId:cardId,placements:latest.placements.map(row=>row.cardId===cardId?{...row,laneId}:row)});
  requestAnimationFrame(()=>stage.current?.querySelector<HTMLButtonElement>(`[data-card-select="${cardId}"]`)?.focus({preventScroll:true}));
 };
 const keyboard=(event:KeyboardEvent<HTMLButtonElement>,card:WorkflowData['cards'][number])=>{
  if(!event.altKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const index=data.lanes.findIndex(lane=>lane.id===placements.get(card.id)),next=index+(event.key==='ArrowRight'?1:-1);if(data.lanes[next])move(card.id,data.lanes[next].id);
 };
 const submit=()=>{
  const latest=store.get(inputPath(p.dataBinding)),source=boundedWorkObjectData('WorkflowBoard',latest)?WORK_OBJECT_DATA_SCHEMAS.WorkflowBoard.safeParse(latest):null,payload=source?.success?boardProposal(readBoardDraft(store.get(statePath(p.stateKey)),source.data),source.data):null;
  if(!payload){setSelectionError('The source or local draft changed. Review the current cards before sending.');return;}
  if(p.actionId)void action.run(p.actionId,payload);
 };
 return <section className="work-object workflow-board" aria-label={data.title??'Workflow board'}>
  <Heading title={data.title} caption={`${data.cards.length} cards \u00b7 local draft`}/>
  <div className="workflow-lanes-scroll"><div className="workflow-lanes" ref={stage} style={{gridTemplateColumns:inline?'repeat(auto-fit,minmax(min(100%,170px),1fr))':`repeat(${data.lanes.length},minmax(170px,1fr))`}}>
   {data.lanes.map((lane,index)=>{
    const cards=data.cards.filter(card=>placements.get(card.id)===lane.id);
    return <section key={lane.id} role="region" aria-label={lane.label} className="workflow-lane" data-drop-target={dropLane===lane.id} onDragOver={event=>{if(!dragged.current||stale)return;event.preventDefault();event.dataTransfer.dropEffect='move';setDropLane(lane.id);}} onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setDropLane(null);}} onDrop={event=>{event.preventDefault();const cardId=dragged.current;dragged.current=null;setDropLane(null);if(cardId)move(cardId,lane.id);}}>
     <header><span className={`workflow-lane-mark mark-${index%3}`} aria-hidden="true"/><h4>{lane.label}</h4><span>{cards.length}</span></header>{lane.detail&&<p className="workflow-lane-description">{lane.detail}</p>}
     <div className="workflow-lane-cards">{cards.map(card=><article key={card.id} className="workflow-card" data-work-card={card.id} data-selected={selected?.id===card.id} draggable={!stale} onDragStart={event=>{if(stale){event.preventDefault();return;}dragged.current=card.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',card.id);select(card.id);}} onDragEnd={()=>{dragged.current=null;setDropLane(null);}}>
      <button type="button" className="workflow-card-select" data-card-select={card.id} aria-label={card.title} aria-pressed={selected?.id===card.id} onClick={()=>select(card.id)} onKeyDown={event=>keyboard(event,card)}><span className="workflow-card-tag">{card.tag??'Work item'}<GripVertical size={12} aria-hidden="true"/></span><strong>{card.title}</strong><span className="workflow-card-owner">{card.owner?<><span className="workflow-avatar" aria-hidden="true">{card.owner.slice(0,1).toUpperCase()}</span>{card.owner}</>:<span>Unassigned</span>}{placements.get(card.id)!==card.laneId&&<span className="workflow-local">Moved locally</span>}</span></button>
     </article>)}{!cards.length&&<p className="workflow-lane-empty">Drop a card here</p>}</div>
    </section>;
   })}
  </div></div>
  <MotionRegion open={Boolean(selected)}><div className="workflow-selected">{selected&&<><div><strong>{selected.title}</strong>{selected.detail&&<p>{selected.detail}</p>}</div><label><span>Move to</span><Select aria-label="Move selected card" value={placements.get(selected.id)??''} disabled={stale} onValueChange={laneId=>move(selected.id,laneId)} options={data.lanes.map(lane=>({value:lane.id,label:lane.label}))}/></label></>}</div></MotionRegion>
  {stale&&<div className="workflow-stale"><p>The source changed. Reset the local draft before proposing moves.</p><button type="button" className="secondary" onClick={()=>{const {previous,...checkpoint}=current();save({sourceRevision:data.revision,selectedId:null,placements:data.cards.map(card=>({cardId:card.id,laneId:card.laneId})),previous:checkpoint});}}>Reset to source</button></div>}
  <footer className="work-object-footer"><span>{proposal?`${proposal.moves.length} local ${proposal.moves.length===1?'move':'moves'}`:'Drag cards or use Alt + Left / Right'}</span>{p.actionId&&<button type="button" className="primary" disabled={action.busy||!proposal||stale} onClick={submit}>{action.busy?'Sending\u2026':p.actionLabel??'Send move proposal'}</button>}</footer>
  <ActionError error={selectionError||action.error}/><Source text={data.source}/>
 </section>;
}

// Selection decoration is event-driven: restored state never replays it.
function useSelectionHalo(){
 const cleanup=useRef<(()=>void)|undefined>(undefined);
 useLayoutEffect(()=>()=>cleanup.current?.(),[]);
 return (target:HTMLElement|null)=>{
  cleanup.current?.();cleanup.current=undefined;
  if(!target||readMotionPolicy()!=='full')return;
  const halo=document.createElement('span');halo.className='work-selection-halo';halo.setAttribute('aria-hidden','true');target.append(halo);
  const animation=halo.animate([{opacity:0,borderColor:'color-mix(in srgb,var(--accent) 40%,transparent)'},{opacity:.8,borderColor:'color-mix(in srgb,#8471bc 55%,transparent)',offset:.35},{opacity:0,borderColor:'color-mix(in srgb,var(--accent) 30%,transparent)'}],{duration:360,easing:'cubic-bezier(.16,1,.3,1)'});
  let disposed=false;
  const settle=()=>{if(disposed)return;disposed=true;observer.disconnect();stopObservingMotion();animation.removeEventListener('finish',settle);animation.removeEventListener('cancel',settle);animation.cancel();halo.remove();};
  const observer=new MutationObserver(settle);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  const stopObservingMotion=observeMotionPolicy(policy=>{if(policy!=='full')settle();});
  animation.addEventListener('finish',settle);animation.addEventListener('cancel',settle);cleanup.current=settle;
 };
}
const nodeIcons={client:Monitor,service:Server,store:Database,queue:Layers};
function architectureLayout(data:ArchitectureData,availableWidth?:number){
 if(availableWidth!==undefined){
  const width=Math.max(174,availableWidth),columns=Math.max(1,Math.floor(width/190)),columnWidth=width/columns,positions=new Map<string,{x:number;y:number}>(),labels=new Map<string,{x:number;y:number}>();let top=0;
  for(let offset=0;offset<data.layers.length;offset+=columns){
   const layers=data.layers.slice(offset,offset+columns),groups=layers.map(layer=>data.nodes.filter(node=>node.layerId===layer.id));
   layers.forEach((layer,index)=>{const x=index*columnWidth+(columnWidth-144)/2;labels.set(layer.id,{x,y:top+19});groups[index].forEach((node,row)=>positions.set(node.id,{x,y:top+60+row*100}));});
   top+=Math.max(1,...groups.map(group=>group.length))*100+65;
  }
  return {width,height:Math.max(210,top),positions,labels};
 }
 const width=Math.max(360,data.layers.length*190+30),groups=data.layers.map(layer=>data.nodes.filter(node=>node.layerId===layer.id)),height=Math.max(210,...groups.map(group=>group.length*100+65));
 const positions=new Map<string,{x:number;y:number}>();groups.forEach((nodes,index)=>nodes.forEach((node,row)=>positions.set(node.id,{x:30+index*190,y:60+row*100})));
 return {width,height,positions,labels:new Map(data.layers.map((layer,index)=>[layer.id,{x:30+index*190,y:19}]))};
}
export function ArchitectureCanvas({element:{props}}:ComponentRenderProps){
 const selectionHalo=useSelectionHalo();
 const inline=useContext(ArtifactInline),viewport=useRef<HTMLDivElement>(null),[availableWidth,setAvailableWidth]=useState(360);
 const p=WORK_OBJECT_SCHEMAS.ArchitectureCanvas.parse(props),store=useStateStore(),action=useTaskAction(),raw=store.get(inputPath(p.dataBinding)),markerId=useId().replace(/[^a-zA-Z0-9_-]/g,''),stage=useRef<HTMLDivElement>(null),[selectionError,setSelectionError]=useState('');
 const parsed=useMemo(()=>boundedWorkObjectData('ArchitectureCanvas',raw)?WORK_OBJECT_DATA_SCHEMAS.ArchitectureCanvas.safeParse(raw):null,[raw]),data=parsed?.success?parsed.data:null,saved=object(store.get(statePath(p.stateKey)));
 const selected=data?.nodes.find(node=>node.id===saved.selectedId),focus=saved.neighborsOnly===true,neighbors=new Set(selected?[selected.id,...data!.edges.flatMap(edge=>edge.from===selected.id?[edge.to]:edge.to===selected.id?[edge.from]:[])]:[]),layout=useMemo(()=>data?architectureLayout(data,inline?availableWidth:undefined):null,[data,inline,availableWidth]);
 useLayoutEffect(()=>{const area=viewport.current;if(!inline||!area)return;const measure=()=>{if(area.clientWidth)setAvailableWidth(area.clientWidth);};measure();const observer=new ResizeObserver(measure);observer.observe(area);return()=>observer.disconnect();},[inline,Boolean(data)]);
 if(!data||!layout)return <p role="status" className="work-object-empty">Architecture data is unavailable from the connected source.</p>;
 const save=(patch:Record<string,unknown>)=>{setSelectionError('');const current=object(store.get(statePath(p.stateKey)));store.set(statePath(p.stateKey),{...current,sourceRevision:patch.selectedId!==undefined?data.revision:current.sourceRevision??data.revision,...patch});};
 const keyboard=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?data.nodes.length-1:Math.max(0,Math.min(data.nodes.length-1,index+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)));const node=data.nodes[next];save({selectedId:node.id});const target=stage.current?.querySelector<HTMLButtonElement>(`[data-architecture-node="${node.id}"]`);selectionHalo(target??null);target?.focus({preventScroll:true});
 };
 const submit=()=>{
  const raw=store.get(inputPath(p.dataBinding)),latest=boundedWorkObjectData('ArchitectureCanvas',raw)?WORK_OBJECT_DATA_SCHEMAS.ArchitectureCanvas.safeParse(raw):null,current=object(store.get(statePath(p.stateKey)));
  if(!latest?.success||current.sourceRevision!==latest.data.revision||!latest.data.nodes.some(node=>node.id===current.selectedId)){setSelectionError('This graph changed. Select a current node before sending.');return;}
  if(p.actionId)void action.run(p.actionId,{sourceRevision:latest.data.revision,nodeId:current.selectedId});
 };
 return <section className="work-object architecture-canvas" aria-label={data.title??'Architecture schematic'}>
  <Heading title={data.title} caption={`${data.nodes.length} nodes \u00b7 ${data.edges.length} connections`}/>
  <div className="architecture-toolbar"><span><Workflow size={14}/>Supplied architecture</span><button type="button" className="secondary" aria-pressed={focus} disabled={!selected} onClick={()=>save({neighborsOnly:!focus})}><Focus size={13}/>Focus neighbors</button></div>
  <div className="architecture-scroll" ref={viewport}><div className="architecture-stage" ref={stage} style={{width:layout.width,height:layout.height}}>
   {data.layers.map(layer=>{const point=layout.labels.get(layer.id)!;return <span className="architecture-layer-label" key={layer.id} style={{left:point.x,top:point.y}}>{layer.label}</span>;})}
   <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-label="Supplied directed connections" role="img"><defs><marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6"/></marker></defs>{data.edges.map(edge=>{
    const from=layout.positions.get(edge.from)!,to=layout.positions.get(edge.to)!,forward=to.x>from.x,start=forward?from.x+144:from.x,end=forward?to.x:to.x+144,curve=Math.max(30,Math.abs(end-start)/2),connected=Boolean(selected&&(edge.from===selected.id||edge.to===selected.id));
    const vertical=inline&&Math.abs(to.x-from.x)<1,down=to.y>from.y,fromY=from.y+(down?66:0),toY=to.y+(down?0:66),middle=(fromY+toY)/2;
    const route=vertical?`M${from.x+72} ${fromY} C${from.x+72} ${middle},${to.x+72} ${middle},${to.x+72} ${toY}`:`M${start} ${from.y+33} C${start+(forward?curve:-curve)} ${from.y+33},${end-(forward?curve:-curve)} ${to.y+33},${end} ${to.y+33}`;
    return <g key={JSON.stringify([edge.from,edge.to])} data-focused={connected} data-dimmed={focus&&selected&&!connected?'true':'false'}><title>{data.nodes.find(node=>node.id===edge.from)!.label} to {data.nodes.find(node=>node.id===edge.to)!.label}{edge.label?`: ${edge.label}`:''}</title><path className="architecture-edge" d={route} markerEnd={`url(#${markerId})`}/></g>;
   })}</svg>
   {data.nodes.map((node,index)=>{const position=layout.positions.get(node.id)!,Icon=nodeIcons[node.kind];return <button type="button" className={`architecture-node is-${node.kind}`} data-architecture-node={node.id} data-dimmed={focus&&selected&&!neighbors.has(node.id)?'true':'false'} key={node.id} style={{left:position.x,top:position.y}} aria-label={node.label} aria-pressed={selected?.id===node.id} onClick={event=>{save({selectedId:node.id});selectionHalo(event.currentTarget);}} onKeyDown={event=>keyboard(event,index)}><Icon size={17} aria-hidden="true"/><span><small>{node.kind}</small><strong>{node.label}</strong></span></button>;})}
  </div></div>
  <MotionRegion open={Boolean(selected)}>{selected&&<div className="architecture-detail"><div className="architecture-detail-copy"><h4>{selected.label}</h4>{selected.detail&&<p>{selected.detail}</p>}{selected.facts&&<dl>{selected.facts.map((fact,index)=><div key={index}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}</div><div className="architecture-connections"><h5 className="architecture-connections-label">Connected nodes</h5>{data.edges.filter(edge=>edge.from===selected.id||edge.to===selected.id).map(edge=>{const outgoing=edge.from===selected.id,node=data.nodes.find(node=>node.id===(outgoing?edge.to:edge.from))!;return <button type="button" key={JSON.stringify([edge.from,edge.to])} onClick={()=>{save({selectedId:node.id});selectionHalo(stage.current?.querySelector<HTMLElement>(`[data-architecture-node="${node.id}"]`)??null);}}><span>{node.label}<small>{edge.label??(outgoing?'Outgoing connection':'Incoming connection')}</small></span><ArrowRight size={13}/></button>;})}{!data.edges.some(edge=>edge.from===selected.id||edge.to===selected.id)&&<p>No supplied connections.</p>}</div></div>}</MotionRegion>
  {!data.nodes.length&&<p className="work-object-empty">No architecture nodes were supplied.</p>}
  {p.actionId&&<footer className="work-object-footer"><span>{selected&&saved.sourceRevision!==data.revision?'Select a node again after the source changed.':'Select a node to inspect its connections.'}</span><button type="button" className="primary" disabled={action.busy||!selected||saved.sourceRevision!==data.revision} onClick={submit}>{action.busy?'Sending\u2026':p.actionLabel??'Ask about node'}</button></footer>}
  <ActionError error={selectionError||action.error}/><Source text={data.source}/>
 </section>;
}

type Span=TraceData['spans'][number];
function traceLayout(spans:Span[],query:string,status:string,collapsed:Set<string>){
 const byId=new Map(spans.map(span=>[span.id,span])),children=new Map<string|undefined,Span[]>();
 for(const span of spans){const group=children.get(span.parentId)??[];group.push(span);children.set(span.parentId,group);}
 const matching=new Set<string>(),filtering=Boolean(query||status!=='all');
 for(const span of spans){if((status==='all'||span.status===status)&&(!query||`${span.name} ${span.service??''} ${span.detail??''}`.toLowerCase().includes(query.toLowerCase()))){matching.add(span.id);let parent=span.parentId;while(parent){matching.add(parent);parent=byId.get(parent)?.parentId;}}}
 const rows:{span:Span;depth:number;hasChildren:boolean;expanded:boolean}[]=[];
 const visit=(parent:string|undefined,depth:number)=>{for(const span of children.get(parent)??[]){if(filtering&&!matching.has(span.id))continue;const expanded=Boolean(children.get(span.id)?.some(child=>!filtering||matching.has(child.id)))&&(filtering||!collapsed.has(span.id));rows.push({span,depth,hasChildren:children.has(span.id),expanded});if(expanded)visit(span.id,depth+1);}};visit(undefined,0);
 const timed=spans.filter((span):span is Span&{startMs:number;durationMs:number}=>span.startMs!==undefined&&span.durationMs!==undefined),start=timed.length?Math.min(...timed.map(span=>span.startMs)):0,end=timed.length?Math.max(...timed.map(span=>span.startMs+span.durationMs)):0;
 return {rows,start,end,timed:timed.length>0,filtering};
}
const milliseconds=(value:number)=>`${new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value)} ms`;
export function TraceWaterfall({element:{props}}:ComponentRenderProps){
 const selectionHalo=useSelectionHalo();
 const inline=useContext(ArtifactInline);
 const p=WORK_OBJECT_SCHEMAS.TraceWaterfall.parse(props),store=useStateStore(),action=useTaskAction(),raw=store.get(inputPath(p.dataBinding)),tree=useRef<HTMLDivElement>(null),scroll=useRef<HTMLDivElement>(null),[selectionError,setSelectionError]=useState(''),[viewportWidth,setViewportWidth]=useState(0);
 const parsed=useMemo(()=>boundedWorkObjectData('TraceWaterfall',raw)?WORK_OBJECT_DATA_SCHEMAS.TraceWaterfall.safeParse(raw):null,[raw]),data=parsed?.success?parsed.data:null,saved=object(store.get(statePath(p.stateKey))),query=typeof saved.query==='string'?saved.query.slice(0,200):'',status=['ok','error','unknown'].includes(String(saved.status))?String(saved.status):'all',zoom=[1,2,4].includes(Number(saved.zoom))?Number(saved.zoom):1;
 const collapsed=useMemo(()=>new Set(Array.isArray(saved.collapsedIds)&&saved.collapsedIds.length<=200?saved.collapsedIds.filter((value):value is string=>typeof value==='string'&&value.length<=160):[]),[saved.collapsedIds]),layout=useMemo(()=>data?traceLayout(data.spans,query,status,collapsed):null,[data,query,status,collapsed]),selected=data?.spans.find(span=>span.id===saved.selectedId);
 useLayoutEffect(()=>{const node=scroll.current;if(!node)return;const measure=()=>setViewportWidth(node.clientWidth);measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[Boolean(data)]);
 if(!data||!layout)return <p role="status" className="work-object-empty">Trace data is unavailable from the connected source.</p>;
 const save=(patch:Record<string,unknown>)=>{setSelectionError('');const current=object(store.get(statePath(p.stateKey)));store.set(statePath(p.stateKey),{...current,sourceRevision:patch.selectedId!==undefined?data.revision:current.sourceRevision??data.revision,...patch});};
 const toggle=(spanId:string)=>{
  const next=new Set(collapsed);if(next.has(spanId))next.delete(spanId);else next.add(spanId);
  const rows=traceLayout(data.spans,query,status,next).rows,active=tree.current?.querySelector<HTMLButtonElement>('.trace-span:focus'),activeId=active?.dataset.traceSpan??selected?.id;
  // Keep the saved selection and its source authority when pointer collapse hides it.
  if(tree.current?.contains(document.activeElement)&&activeId&&!rows.some(row=>row.span.id===activeId)){
   const entry=rows.find(row=>row.span.id===selected?.id)??rows[0];
   if(entry)tree.current.querySelector<HTMLButtonElement>(`[data-trace-span="${entry.span.id}"]`)?.focus();
  }
  save({collapsedIds:[...next]});
 };
 const select=(span:Span)=>{save({selectedId:span.id});const target=tree.current?.querySelector<HTMLButtonElement>(`[data-trace-span="${span.id}"]`);selectionHalo(target?.querySelector('.trace-bar')??null);target?.focus();};
 const keyboard=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
  const row=layout.rows[index];
  if(event.key==='ArrowRight'){
   if(row.hasChildren&&!row.expanded&&!layout.filtering){toggle(row.span.id);return;}
   const child=layout.rows[index+1];if(child?.span.parentId===row.span.id)select(child.span);return;
  }
  if(event.key==='ArrowLeft'){
   if(row.expanded&&!layout.filtering){toggle(row.span.id);return;}
   const parent=layout.rows.find(candidate=>candidate.span.id===row.span.parentId);if(parent)select(parent.span);return;
  }
  const next=event.key==='Home'?0:event.key==='End'?layout.rows.length-1:Math.max(0,Math.min(layout.rows.length-1,index+(event.key==='ArrowDown'?1:-1)));select(layout.rows[next].span);
 };
 const submit=()=>{
  const raw=store.get(inputPath(p.dataBinding)),latest=boundedWorkObjectData('TraceWaterfall',raw)?WORK_OBJECT_DATA_SCHEMAS.TraceWaterfall.safeParse(raw):null,current=object(store.get(statePath(p.stateKey)));
  if(!latest?.success||current.sourceRevision!==latest.data.revision||!latest.data.spans.some(span=>span.id===current.selectedId)){setSelectionError('This trace changed. Select a current span before sending.');return;}
  if(p.actionId)void action.run(p.actionId,{sourceRevision:latest.data.revision,spanId:current.selectedId});
 };
 const labelWidth=inline?Math.min(220,Math.max(120,viewportWidth*.45)):220;
 const range=layout.end>layout.start?layout.end-layout.start:1,tabEntry=layout.rows.some(row=>row.span.id===selected?.id)?selected?.id:layout.rows[0]?.span.id,trackWidth=inline?Math.max(1,viewportWidth-labelWidth):Math.max(360,viewportWidth-220)*zoom;
 return <section className="work-object trace-waterfall" aria-label={data.title??'Trace waterfall'} style={{'--trace-label-width':`${labelWidth}px`} as CSSProperties}>
  <Heading title={data.title} caption={`${data.spans.length} supplied spans`}/>
  <div className="trace-toolbar"><label className="trace-filter"><Search size={14}/><input type="search" aria-label="Filter spans" placeholder="Filter spans..." value={query} maxLength={200} onChange={event=>save({query:event.target.value})}/></label><Select aria-label="Span status" value={status} onValueChange={status=>save({status})} options={[{value:'all',label:'All statuses'},{value:'ok',label:'OK'},{value:'error',label:'Error'},{value:'unknown',label:'Unknown'}]}/>{!inline&&<Select aria-label="Timeline zoom" value={String(zoom)} onValueChange={zoom=>save({zoom:Number(zoom)})} options={[{value:'1',label:'1x zoom'},{value:'2',label:'2x zoom'},{value:'4',label:'4x zoom'}]}/>}</div>
  <div className="trace-scroll" ref={scroll}><div className="trace-timeline" style={{minWidth:labelWidth+trackWidth}}>
   <div className="trace-ruler"><span>Span / service</span><div style={{width:trackWidth}}>{layout.timed?[0,.25,.5,.75,1].map(tick=><span key={tick} style={{left:`${tick*100}%`}}>{milliseconds(layout.start+(layout.end-layout.start)*tick)}</span>):<span className="trace-no-time">Timing unavailable</span>}</div></div>
   <div className="trace-tree" role="tree" aria-label="Supplied spans" ref={tree}>{layout.rows.map(({span,depth,hasChildren,expanded},index)=>{
    const timed=span.startMs!==undefined&&span.durationMs!==undefined;
    return <div className="trace-row" key={span.id} data-selected={selected?.id===span.id}><button type="button" className="trace-collapse" tabIndex={-1} style={{left:Math.min(depth,8)*12+3}} disabled={!hasChildren} aria-label={`${expanded?'Collapse':'Expand'} ${span.name}`} onClick={()=>toggle(span.id)}>{hasChildren?(expanded?<ChevronDown size={12}/>:<ChevronRight size={12}/>):<span/>}</button><button type="button" className="trace-span" role="treeitem" data-trace-span={span.id} aria-label={span.name} aria-selected={selected?.id===span.id} aria-level={depth+1} aria-expanded={hasChildren?expanded:undefined} tabIndex={tabEntry===span.id?0:-1} onClick={event=>{save({selectedId:span.id});selectionHalo(event.currentTarget.querySelector('.trace-bar'));}} onKeyDown={event=>keyboard(event,index)}><span className="trace-span-label" style={{paddingLeft:Math.min(depth,8)*12+22}}><span className={`trace-status is-${span.status}`} aria-label={span.status}>{span.status==='ok'&&<Check size={8}/>}</span><span><strong>{span.name}</strong>{span.service&&<small>{span.service}</small>}</span></span><span className="trace-track" style={{width:trackWidth}}>{timed?<><span className={`trace-bar is-${span.status}`} style={{left:`${(span.startMs!-layout.start)/range*100}%`,width:Math.max(2,span.durationMs!/range*trackWidth)}} title={`${milliseconds(span.startMs!)} start 路 ${milliseconds(span.durationMs!)} duration`}/><span className="trace-duration">{milliseconds(span.durationMs!)}</span></>:<span className="trace-unknown">Timing unavailable</span>}</span></button></div>;
   })}</div>
   {!layout.rows.length&&<p className="work-object-empty">{data.spans.length?'No supplied spans match these filters.':'No trace spans were supplied.'}</p>}
  </div></div>
  <MotionRegion open={Boolean(selected)}>{selected&&<div className="trace-detail"><div><h4>{selected.name}</h4>{selected.service&&<span className="trace-detail-service">{selected.service}</span>}{selected.detail&&<p>{selected.detail}</p>}</div><dl><div><dt>Status</dt><dd className={`trace-detail-status is-${selected.status}`}>{selected.status}</dd></div><div><dt>Relative start</dt><dd>{selected.startMs===undefined?'Timing unavailable':milliseconds(selected.startMs)}</dd></div><div><dt>Duration</dt><dd>{selected.durationMs===undefined?'Timing unavailable':milliseconds(selected.durationMs)}</dd></div></dl></div>}</MotionRegion>
  {p.actionId&&<footer className="work-object-footer"><span>{selected&&saved.sourceRevision!==data.revision?'Select a span again after the source changed.':'Times come from the supplied trace.'}</span><button type="button" className="primary" disabled={action.busy||!selected||saved.sourceRevision!==data.revision} onClick={submit}>{action.busy?'Sending\u2026':p.actionLabel??'Ask about span'}</button></footer>}
  <ActionError error={selectionError||action.error}/><Source text={data.source}/>
 </section>;
}
export const WORK_OBJECT_REGISTRY:ComponentRegistry={WorkflowBoard,ArchitectureCanvas,TraceWaterfall};
