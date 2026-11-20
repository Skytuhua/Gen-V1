import {useContext,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode,type RefObject} from 'react';
import {useStateStore,type ComponentRenderProps,type ComponentRegistry} from '@json-render/react';
import {ArrowRight,ArrowUpRight,Braces,FileCode2,GitBranch,Terminal} from 'lucide-react';
import {SOFTWARE_DATA_SCHEMAS,SOFTWARE_SCHEMAS,type PipelineData,type SoftwareProps} from '../../../packages/ui-catalog/software-development';
import {ArtifactTitle,inputPath,statePath,useTaskAction} from './task-context';
import {StatusIcon,type StatusKind} from './task-status';
import {animateTask} from './task-motion';
import {readMotionPolicy,observeMotionPolicy} from './motion-policy';
import './software-development.css';

type CheckStatus='not-run'|'running'|'passed'|'failed'|'skipped'|'blocked'|'unknown';
const statusKind:Record<CheckStatus,StatusKind>={'not-run':'neutral',running:'running',passed:'success',failed:'error',skipped:'neutral',blocked:'pending',unknown:'pending'};
const statusLabel:Record<CheckStatus,string>={'not-run':'Not run',running:'Running',passed:'Passed',failed:'Failed',skipped:'Skipped',blocked:'Blocked',unknown:'Unknown'};
const duration=(value:number|undefined)=>value===undefined?'':value>=1000?`${(value/1000).toFixed(value>=10000?0:1)}s`:`${Math.round(value)}ms`;
export type SoftwareSelectionCause='pointer'|'keyboard';

function CheckState({status,entityId,statusDurationMs=120}:{status:CheckStatus;entityId?:string;statusDurationMs?:number}){
  const ref=useRef<HTMLSpanElement>(null),previous=useRef({entityId,status}),handles=useRef<Animation[]>([]),color=useRef<string|undefined>(undefined);
  useLayoutEffect(()=>{
    const before=previous.current;previous.current={entityId,status};
    const node=ref.current;if(!node)return;
    if(before.entityId!==entityId){handles.current.forEach(handle=>handle.cancel());handles.current=[];color.current=undefined;return;}
    if(entityId===undefined||before.status===status)return;
    const style=getComputedStyle(node),start=handles.current.length?Number(style.opacity):.8,to=style.color,from=color.current??to;
    color.current=to;handles.current.forEach(handle=>handle.cancel());handles.current=[];
    node.style.setProperty('--software-status-duration',`${statusDurationMs}ms`);
    const frames:Keyframe[]=from!==to?[{opacity:start,color:from},{opacity:1,color:to}]:[{opacity:start},{opacity:1}];
    const slot=animateTask(node,frames,statusDurationMs,{duration:'--software-status-duration',easing:'--ui-ease-enter'});
    if(slot)handles.current.push(slot);
    if(status==='passed'&&readMotionPolicy()==='full'){
      const stroke=node.querySelector<SVGGeometryElement>('svg polyline,svg path');
      if(stroke){stroke.setAttribute('pathLength','1');stroke.style.strokeDasharray='1';
        const dash=stroke.animate([{strokeDashoffset:'1'},{strokeDashoffset:'0'}],{duration:90,easing:'cubic-bezier(.16,1,.3,1)'});
        handles.current.push(dash);}
    }
  },[status,entityId,statusDurationMs]);
  useLayoutEffect(()=>()=>{handles.current.forEach(handle=>handle.cancel());handles.current=[];},[]);
  return <span ref={ref} className={`software-check-state software-state-${status}`}><StatusIcon status={statusKind[status]}/><span>{statusLabel[status]}</span></span>;
}
function useSelected<T extends {id:string}>(items:T[],key:string,preferred?:string){
  const store=useStateStore(),saved=store.get(statePath(key));
  const selected=items.find(item=>item.id===saved)??items.find(item=>item.id===preferred)??items[0];
  useEffect(()=>{if(!selected||saved===selected.id)return;queueMicrotask(()=>{if(!items.some(item=>item.id===store.get(statePath(key))))store.set(statePath(key),selected.id);});},[selected?.id,saved,key,store,items]);
  return {selected,select:(id:string)=>store.set(statePath(key),id)};
}
/**
 * Committed-selection opacity handoff: the handler marks {scope,next,cause}
 * before writing selection state; the layout effect runs exactly one opacity
 * transition for a pointer-caused change inside the same scope. Source updates,
 * restores, keyboard and same-identity writes settle with no motion.
 */
function useSoftwarePanelMotion<T extends HTMLElement>(identity:string|undefined,scope:string|undefined,durationMs:number,startOpacity:number){
  const ref=useRef<T>(null),committed=useRef({identity,scope}),pending=useRef<{scope:string|undefined;identity:string;cause:SoftwareSelectionCause}|undefined>(undefined),animation=useRef<Animation|undefined>(undefined);
  const mark=(nextIdentity:string,cause:SoftwareSelectionCause)=>{if(nextIdentity===identity){pending.current=undefined;return;}pending.current={scope,identity:nextIdentity,cause};};
  useLayoutEffect(()=>{
    const before=committed.current;committed.current={identity,scope};
    if(before.identity===identity&&before.scope===scope)return;
    const marked=pending.current;pending.current=undefined;
    const node=ref.current;
    if(!node){animation.current?.cancel();animation.current=undefined;return;}
    if(before.scope!==scope){animation.current?.cancel();animation.current=undefined;return;}
    if(!marked||marked.cause!=='pointer'||marked.scope!==before.scope||marked.identity!==identity||!node.getClientRects().length){animation.current?.cancel();animation.current=undefined;return;}
    const start=animation.current?Number(getComputedStyle(node).opacity):startOpacity;
    animation.current?.cancel();
    node.style.setProperty('--software-panel-duration',`${durationMs}ms`);
    animation.current=animateTask(node,[{opacity:start},{opacity:1}],durationMs,{duration:'--software-panel-duration',easing:'--ui-ease-enter'});
  },[identity,scope,durationMs,startOpacity]);
  useLayoutEffect(()=>{
    const node=ref.current;
    const settle=()=>{const handle=animation.current;if(!handle)return;handle.cancel();if(animation.current===handle)animation.current=undefined;};
    const interact=(event:Event)=>{if(event.target instanceof Node&&node?.contains(event.target))settle();};
    const hidden=()=>{if(document.visibilityState==='hidden')settle();};
    node?.addEventListener('pointerdown',interact);node?.addEventListener('focusin',interact);
    document.addEventListener('visibilitychange',hidden);
    const stopObserving=observeMotionPolicy(()=>settle());
    return()=>{stopObserving();node?.removeEventListener('pointerdown',interact);node?.removeEventListener('focusin',interact);document.removeEventListener('visibilitychange',hidden);settle();};
  },[]);
  return {ref,mark};
}
const clickCause=(event:{detail:number}):SoftwareSelectionCause=>event.detail>0?'pointer':'keyboard';
/** One decorative entrance treatment per surface, gated on the host's own
 * first-publication marker and the full effective motion policy. */
export function usePublicationEntrance(run:(node:HTMLElement)=>Animation[]){
  const ref=useRef<HTMLElement|null>(null);
  useLayoutEffect(()=>{
    const node=ref.current;if(!node)return;
    let handles:Animation[]=[],artifact:Element|null=null,stopObserving:()=>void=()=>{},disposed=false;
    const dispose=()=>{if(disposed)return;disposed=true;stopObserving();stopObserving=()=>{};artifact?.removeEventListener('pointerdown',stop,true);artifact?.removeEventListener('focusin',stop);artifact=null;handles.forEach(handle=>handle.cancel());handles=[];};
    const stop=()=>dispose();
    queueMicrotask(()=>{
      if(disposed||!node.isConnected||readMotionPolicy()!=='full'||!node.closest('[data-entry-phase="entering"]'))return;
      handles=run(node);
      if(!handles.length)return;
      artifact=node.closest('[data-entry-phase]');
      artifact?.addEventListener('pointerdown',stop,{capture:true});
      artifact?.addEventListener('focusin',stop);
      stopObserving=observeMotionPolicy(stop);
      handles[0]?.addEventListener('finish',stop,{once:true});
    });
    return()=>dispose();
  },[]);
  return ref;
}
export function ornament(parent:HTMLElement|SVGSVGElement,className:string,frames:Keyframe[],ms:number){
  parent.insertAdjacentHTML('beforeend',`<span class="${className}" aria-hidden="true"></span>`);
  const node=parent.lastElementChild as HTMLElement;
  const animation=node.animate(frames,{duration:ms,easing:'cubic-bezier(.16,1,.3,1)'});
  animation.addEventListener('finish',()=>node.remove());
  animation.addEventListener('cancel',()=>node.remove());
  return animation;
}
function Title({title,children}:{title?:string;children?:ReactNode}){const outer=useContext(ArtifactTitle);return <header className="software-heading">{title&&title!==outer&&<h4>{title}</h4>}{children}</header>;}
function Source({text}:{text?:string}){return text?<details className="software-source"><summary>Source</summary><p>{text}</p></details>:null;}
function Unavailable({name}:{name:string}){return <p className="task-unavailable">{name} data is unavailable. Ask the agent to refresh its source.</p>;}
type ListItem={id:string;label:string;ariaLabel?:string;meta?:ReactNode;icon?:ReactNode};
function SelectList({items,selected,select,label,panelId,className='',orientation='horizontal'}:{items:ListItem[];selected?:string;select:(id:string,cause:SoftwareSelectionCause)=>void;label:string;panelId:string;className?:string;orientation?:'horizontal'|'vertical'}){
  return <div className={`software-list ${className}`} role="tablist" aria-label={label} aria-orientation={orientation}>{items.map((item,index)=><button key={item.id} type="button" role="tab" aria-label={item.ariaLabel??item.label} aria-selected={item.id===selected} tabIndex={item.id===selected?0:-1} aria-controls={panelId} onClick={event=>select(item.id,clickCause(event))} onKeyDown={event=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+items.length)%items.length;select(items[next].id,'keyboard');(event.currentTarget.parentElement?.children[next] as HTMLButtonElement|undefined)?.focus({preventScroll:true});}}><span className="software-item-copy">{item.icon}<span>{item.label}</span></span>{Boolean(item.meta)&&<span className="software-item-meta">{item.meta}</span>}</button>)}</div>;
}
function Action({props,payload,fallback,unavailable}:{props:SoftwareProps;payload:Record<string,unknown>;fallback:string;unavailable?:string}){
  const action=useTaskAction();
  return <footer className="software-actions">{props.actionId?<button type="button" className="secondary" disabled={action.busy} onClick={()=>void action.run(props.actionId!,payload)}>{action.busy?'Requesting…':props.actionLabel??fallback}<ArrowUpRight size={13}/></button>:unavailable?<><button type="button" className="secondary" disabled title={unavailable}>{fallback}</button><span className="software-unavailable">{unavailable}</span></>:null}{action.error&&<span role="status" className="error-text">{action.error}</span>}</footer>;
}
function CodeBlock({text,label}:{text:string;label?:string}){return <figure className="software-code">{label&&<figcaption>{label}</figcaption>}<pre tabIndex={0} aria-label={label??'Code'}><code>{text}</code></pre></figure>;}
const responseLabels:Record<number,string>={200:'OK',201:'Created',202:'Accepted',204:'No content',400:'Bad request',401:'Unauthorized',403:'Forbidden',404:'Not found',409:'Conflict',422:'Unprocessable content',429:'Too many requests',500:'Server error',502:'Bad gateway',503:'Unavailable'};
function Counts({items}:{items:{status:CheckStatus}[]}){
  const order:CheckStatus[]=['failed','running','blocked','passed','not-run','skipped','unknown'];
  return <div className="software-counts" aria-label="Recorded results">{items.length?order.map(status=>{const count=items.filter(item=>item.status===status).length;return count?<span key={status} className={`software-state-${status}`}><i aria-hidden="true"/>{count} {statusLabel[status].toLowerCase()}</span>:null;}):<span>No checks</span>}</div>;
}

export function Diagnostics({element:{props}}:ComponentRenderProps){
  const p=SOFTWARE_SCHEMAS.Diagnostics.parse(props),store=useStateStore(),raw=store.get(inputPath(p.dataBinding));
  const parsed=useMemo(()=>raw&&typeof raw==='object'&&Array.isArray((raw as {items?:unknown}).items)&&(raw as {items:unknown[]}).items.length<=100?SOFTWARE_DATA_SCHEMAS.Diagnostics.safeParse(raw):null,[raw]);
  const items=parsed?.success?parsed.data.items:[],{selected,select}=useSelected(items,p.stateKey,items.find(item=>item.status==='failed')?.id),panel=useSoftwarePanelMotion<HTMLDivElement>(selected?.id,undefined,140,.8),panelId=useId();
  const entrance=usePublicationEntrance(node=>{
    const selectedButton=node.querySelector<HTMLElement>('.software-check-inventory [role="tab"][aria-selected="true"]');
    if(!selectedButton)return[];
    return [ornament(selectedButton,'software-entry-accent',[{transform:'scaleY(0)'},{transform:'scaleY(1)'}],140)];
  });
  if(!parsed?.success)return <Unavailable name="Diagnostic"/>;
  const comparison=selected&&(selected.expected!==undefined||selected.actual!==undefined);
  const choose=(id:string,cause:SoftwareSelectionCause)=>{panel.mark(id,cause);if(id!==selected?.id)select(id);};
  return <section ref={entrance} className="software-surface software-diagnostics" aria-label={parsed.data.title??'Diagnostics'}>
    <Title title={parsed.data.title}><Counts items={items}/></Title>
    {selected?<div className="software-inspector software-investigation">
      <SelectList className="software-check-inventory" orientation="vertical" items={items.map(item=>({id:item.id,label:item.title,icon:<span className={`software-diagnostic-node software-state-${item.status}`}><StatusIcon status={statusKind[item.status]}/></span>,meta:<><span>{item.file}{item.line?`:${item.line}`:''}</span><span className={`software-state-${item.status}`}>{statusLabel[item.status]}</span></>}))} selected={selected.id} select={choose} label="Diagnostics" panelId={panelId}/>
      <div ref={panel.ref} className="software-detail" role="tabpanel" id={panelId} aria-label={selected.title}>
        <div className="software-detail-heading"><h4>{selected.title}</h4><span className="software-detail-status">{selected.durationMs!==undefined&&<span className="software-duration">Duration<strong>{duration(selected.durationMs)}</strong></span>}<CheckState status={selected.status} entityId={selected.id}/></span></div>
        {selected.file&&<p className="software-file-location"><FileCode2 size={13}/><code>{selected.file}{selected.line?`:${selected.line}${selected.column?`:${selected.column}`:''}`:''}</code></p>}
        {comparison&&<section className="software-assertion" data-status={selected.status} aria-label="Assertion comparison"><div><span>Expected</span><pre><code>{selected.expected??'Not supplied'}</code></pre></div><ArrowRight size={16} aria-hidden="true"/><div><span>Received</span><pre><code>{selected.actual??'Not supplied'}</code></pre></div></section>}
        {selected.message&&(comparison?<details className="software-diagnostic-details"><summary>Failure details</summary><p className="software-diagnostic-message">{selected.message}</p></details>:<p className="software-diagnostic-message">{selected.message}</p>)}
        {selected.code&&<CodeBlock text={selected.code} label="Source context"/>}
        <Action props={p} payload={{diagnosticId:selected.id,file:selected.file,line:selected.line,status:selected.status}} fallback="Investigate"/>
      </div>
    </div>:<p className="software-empty">No diagnostics reported.</p>}
    <Source text={parsed.data.source}/>
  </section>;
}

type PatchLine={text:string;kind:'hunk'|'added'|'removed'|'context'|'metadata';oldLine?:number;newLine?:number};
function patchLines(patch:string):PatchLine[]{
  let oldLine:number|undefined,newLine:number|undefined;
  return patch.split('\n').map(text=>{
    const hunk=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if(hunk){oldLine=Number(hunk[1]);newLine=Number(hunk[2]);return {text,kind:'hunk'};}
    if(/^(?:diff |index |--- |\+\+\+ |\\)/.test(text))return {text,kind:'metadata'};
    if(text.startsWith('-'))return {text:text.slice(1),kind:'removed',oldLine:oldLine===undefined?undefined:oldLine++};
    if(text.startsWith('+'))return {text:text.slice(1),kind:'added',newLine:newLine===undefined?undefined:newLine++};
    if(text.startsWith(' '))return {text:text.slice(1),kind:'context',oldLine:oldLine===undefined?undefined:oldLine++,newLine:newLine===undefined?undefined:newLine++};
    return {text,kind:'metadata'};
  });
}
const patchGutter=(lines:PatchLine[],side:'oldLine'|'newLine')=>{const digits=String(Math.max(1,...lines.map(line=>line[side]??0))).length;return digits<=3?'28px':`calc(28px + ${digits-3}ch)`;};
export function ChangeSet({element:{props}}:ComponentRenderProps){
  const p=SOFTWARE_SCHEMAS.ChangeSet.parse(props),store=useStateStore(),raw=store.get(inputPath(p.dataBinding));
  const parsed=useMemo(()=>raw&&typeof raw==='object'&&Array.isArray((raw as {files?:unknown}).files)&&(raw as {files:unknown[]}).files.length<=100?SOFTWARE_DATA_SCHEMAS.ChangeSet.safeParse(raw):null,[raw]);
  const files=parsed?.success?parsed.data.files:[],{selected,select}=useSelected(files,p.stateKey),panel=useSoftwarePanelMotion<HTMLDivElement>(selected?.id,undefined,120,.85),panelId=useId();
  const surface=useRef<HTMLElement>(null),patchRef=useRef<HTMLPreElement>(null),scrolls=useRef(new Map<string,{top:number;left:number}>()),listCause=useRef<SoftwareSelectionCause|undefined>(undefined),previousSelection=useRef(selected?.id);
  const seen=useRef(new Map<string,string>()),[revised,setRevised]=useState<ReadonlySet<string>>(new Set());
  const entrance=usePublicationEntrance(node=>{
    const rail=node.querySelector<HTMLElement>('.software-patch [data-line-kind="added"],.software-patch [data-line-kind="removed"]');
    if(!rail)return[];
    return [rail.animate([{opacity:.55},{opacity:1}],{duration:120,easing:'cubic-bezier(.16,1,.3,1)'})];
  });
  useLayoutEffect(()=>{
    const next=new Set(revised);
    for(const file of files){const previous=seen.current.get(file.id);seen.current.set(file.id,file.patch);if(previous!==undefined&&previous!==file.patch)next.add(file.id);}
    for(const id of [...seen.current.keys()])if(!files.some(file=>file.id===id))seen.current.delete(id);
    if(next.size!==revised.size)setRevised(next);
  },[files,revised]);
  useLayoutEffect(()=>{
    const previous=previousSelection.current;previousSelection.current=selected?.id;
    if(previous!==selected?.id){
      const node=patchRef.current,saved=selected&&scrolls.current.get(selected.id);
      if(node){node.scrollTop=Math.min(saved?.top??0,Math.max(0,node.scrollHeight-node.clientHeight));node.scrollLeft=Math.min(saved?.left??0,Math.max(0,node.scrollWidth-node.clientWidth));}
      const cause=listCause.current;listCause.current=undefined;
      if(cause==='pointer'&&selected){
        const root=surface.current,next=root?.querySelector<HTMLElement>('.software-file-review .software-list [role="tab"][aria-selected="true"]'),unselected=root?.querySelector<HTMLElement>('.software-file-review .software-list [role="tab"][aria-selected="false"]');
        if(root&&next&&unselected){
          const to=getComputedStyle(next),from=getComputedStyle(unselected);
          next.style.setProperty('--software-panel-duration','120ms');
          animateTask(next,[{borderColor:from.borderColor,backgroundColor:from.backgroundColor},{borderColor:to.borderColor,backgroundColor:to.backgroundColor}],120,{duration:'--software-panel-duration',easing:'--ui-ease-enter'});
        }
      }
    }else listCause.current=undefined;
  },[selected?.id]);
  if(!parsed?.success)return <Unavailable name="Change"/>;
  const lines=patchLines(selected?.patch??'');
  const choose=(id:string,cause:SoftwareSelectionCause)=>{listCause.current=cause;panel.mark(id,cause);if(id!==selected?.id)select(id);};
  const patchVars={'--patch-old':patchGutter(lines,'oldLine'),'--patch-new':patchGutter(lines,'newLine')} as CSSProperties;
  return <section ref={surface} className="software-surface software-changes" aria-label={parsed.data.title??'Changes'}>
    <div ref={entrance as RefObject<HTMLDivElement>} className="software-changes-entry">
    <Title title={parsed.data.title}><span className="software-counts">{files.length} {files.length===1?'file':'files'}</span></Title>
    {selected?<div className="software-inspector software-file-review">
      <SelectList items={files.map(file=>{const parts=file.path.split(/[\\/]/);return {id:file.id,label:parts.at(-1)!,ariaLabel:file.path,icon:<FileCode2 size={14}/>,meta:<><span>{parts.length>1?parts.slice(0,-1).join('/') : file.status}</span><span className="software-diff-counts">{file.additions!==undefined&&<b>+{file.additions}</b>}{file.deletions!==undefined&&<i>−{file.deletions}</i>}</span></>};})} selected={selected.id} select={choose} label="Changed files" panelId={panelId}/>
      <div ref={panel.ref} className="software-detail" role="tabpanel" id={panelId} aria-label={selected.path}>
        <div className="software-detail-heading"><h4><code>{selected.path}</code></h4><span className="software-file-status">{selected.status}{revised.has(selected.id)&&<PatchUpdatedMark/>}</span></div>
        {selected.previousPath&&<p className="software-file-location">From <code>{selected.previousPath}</code></p>}{selected.note&&<details className="software-change-note"><summary>Rationale</summary><p>{selected.note}</p></details>}
        <div className="software-patch-heading" style={patchVars}><span><span aria-hidden="true">Old</span><span className="sr-only">Before</span></span><span><span aria-hidden="true">New</span><span className="sr-only">After</span></span><div className="software-patch-key" aria-label="Patch legend"><span><b aria-hidden="true">−</b>Removed</span><span><b aria-hidden="true">+</b>Added</span></div></div>
        <pre ref={patchRef} className="software-patch" style={patchVars} aria-label="Selected patch" tabIndex={0} onScroll={()=>{const node=patchRef.current;if(node&&selected)scrolls.current.set(selected.id,{top:node.scrollTop,left:node.scrollLeft});}}><code>{lines.slice(0,600).map((line,index)=><span key={index} className={`patch-${line.kind}`} data-line-kind={line.kind} data-old-line={line.oldLine} data-new-line={line.newLine}><span className="patch-old-line" aria-hidden="true">{line.oldLine??''}</span><span className="patch-new-line" aria-hidden="true">{line.newLine??''}</span><span className="patch-gutter" aria-hidden="true">{line.kind==='added'?'+':line.kind==='removed'?'−':''}</span><span className="patch-code">{line.text||' '}</span></span>)}</code></pre>
        {lines.length>600&&<details><summary>Full patch ({lines.length} lines)</summary><CodeBlock text={selected.patch}/></details>}
        <Action props={p} payload={{fileId:selected.id,path:selected.path,status:selected.status}} fallback="Review change"/>
      </div>
    </div>:<p className="software-empty">No changed files reported.</p>}
    <Source text={parsed.data.source}/>
    </div>
  </section>;
}
function PatchUpdatedMark(){
  const ref=useRef<HTMLSpanElement>(null);
  useLayoutEffect(()=>{const node=ref.current;if(node)animateTask(node,[{opacity:.5},{opacity:1}],180);},[]);
  return <span ref={ref} className="software-patch-updated">Patch updated</span>;
}

export function ApiExplorer({element:{props}}:ComponentRenderProps){
  const p=SOFTWARE_SCHEMAS.ApiExplorer.parse(props),store=useStateStore(),raw=store.get(inputPath(p.dataBinding));
  const parsed=useMemo(()=>raw&&typeof raw==='object'&&Array.isArray((raw as {endpoints?:unknown}).endpoints)&&(raw as {endpoints:unknown[]}).endpoints.length<=80?SOFTWARE_DATA_SCHEMAS.ApiExplorer.safeParse(raw):null,[raw]);
  const endpoints=parsed?.success?parsed.data.endpoints:[],{selected,select}=useSelected(endpoints,p.stateKey),panelId=useId(),responseId=useId();
  const [responseSelections,setResponseSelections]=useState<Record<string,string>>({});
  const responses=selected?.responses??[],responseIndex=Math.max(0,responses.findIndex((response,index)=>`${response.status}:${index}`===responseSelections[selected?.id??''])),response=responses[responseIndex];
  const flow=useSoftwarePanelMotion<HTMLDivElement>(selected?.id,undefined,140,.8),responseMotion=useSoftwarePanelMotion<HTMLDivElement>(response?`${response.status}:${responseIndex}`:undefined,selected?.id,120,.8);
  const entrance=usePublicationEntrance(node=>{
    const badge=node.querySelector<HTMLElement>('.software-endpoint-heading .software-method');
    if(!badge)return[];
    return [ornament(badge,'software-entry-underline',[{transform:'scaleX(0)'},{transform:'scaleX(1)'}],120)];
  });
  if(!parsed?.success)return <Unavailable name="API contract"/>;
  const choose=(id:string,cause:SoftwareSelectionCause)=>{flow.mark(id,cause);if(id!==selected?.id)select(id);};
  const selectResponse=(index:number,cause:SoftwareSelectionCause)=>{if(!selected||!responses[index])return;responseMotion.mark(`${responses[index].status}:${index}`,cause);setResponseSelections(current=>({...current,[selected.id]:`${responses[index].status}:${index}`}));};
  const hasRequestExample=typeof selected?.request==='string'&&selected.request.trim().length>0;
  return <section ref={entrance} className="software-surface software-api" aria-label={parsed.data.title??'API contract'}>
    <Title title={parsed.data.title}><span className="software-counts">{endpoints.length} {endpoints.length===1?'endpoint':'endpoints'}</span></Title>
    {selected?<div className="software-inspector software-contract">
      <SelectList items={endpoints.map(endpoint=>({id:endpoint.id,label:endpoint.path,ariaLabel:`${endpoint.method} ${endpoint.path}`,icon:<span className={`software-method method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>}))} selected={selected.id} select={choose} label="API endpoints" panelId={panelId}/>
      <div className="software-detail" role="tabpanel" id={panelId} aria-label={`${selected.method} ${selected.path}`}>
        <div className="software-detail-heading software-endpoint-heading"><h4><span className={`software-method method-${selected.method.toLowerCase()}`}>{selected.method}</span><code>{selected.path}</code></h4><Braces size={16} aria-hidden="true"/></div>
        {selected.summary&&<p className="software-endpoint-summary">{selected.summary}</p>}
        {selected.parameters?.length?<details className="software-parameter-details"><summary>Parameters <span>{selected.parameters.length}</span></summary><div className="software-table-scroll"><table className="software-parameters"><thead><tr><th>Name</th><th>Type</th><th>Location</th></tr></thead><tbody>{selected.parameters.map((parameter,index)=><tr key={parameter.location+parameter.name+index}><td><code>{parameter.name}</code>{parameter.required&&<small>required</small>}{parameter.description&&<p>{parameter.description}</p>}</td><td><code>{parameter.type}</code></td><td>{parameter.location}</td></tr>)}</tbody></table></div></details>:null}
        <div ref={flow.ref} className="software-api-flow" data-has-request={hasRequestExample}>
          {hasRequestExample&&<><section className="software-request" aria-label="Request example"><header><h5>Request example</h5></header><CodeBlock text={selected.request!}/></section><ArrowRight className="software-flow-arrow" size={17} aria-hidden="true"/></>}
          {!hasRequestExample&&<p className="software-request-note">No request example supplied</p>}
          <section className="software-response" aria-label="Response example"><header><h5>Response example</h5>{responses.length>0&&<div className="software-response-tabs" role="tablist" aria-label="Response examples">{responses.map((item,index)=><button key={item.status+':'+index} id={`${responseId}-${index}`} role="tab" type="button" aria-selected={index===responseIndex} aria-controls={responseId} aria-label={`Response ${item.status}`} tabIndex={index===responseIndex?0:-1} onClick={event=>selectResponse(index,clickCause(event))} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?responses.length-1:(index+(event.key==='ArrowRight'?1:-1)+responses.length)%responses.length;selectResponse(next,'keyboard');(event.currentTarget.parentElement?.children[next] as HTMLButtonElement|undefined)?.focus({preventScroll:true});}}><span>{item.status}</span>{responseLabels[item.status]&&<span className="software-response-label">{responseLabels[item.status]}</span>}<span className="sr-only">Response {item.status}</span></button>)}</div>}</header>{responses.length?<div ref={responseMotion.ref} className="software-response-content" id={responseId} role="tabpanel" aria-labelledby={`${responseId}-${responseIndex}`}>{response?.description&&<p className="software-response-description">{response.description}</p>}{response&&<CodeBlock text={response.body}/>}</div>:<p className="software-no-body">No response example supplied</p>}</section>
        </div>
        <Action props={p} payload={{endpointId:selected.id,method:selected.method,path:selected.path}} fallback="Review endpoint" unavailable="No API executor connected"/>
      </div>
    </div>:<p className="software-empty">No endpoints in this contract.</p>}
    <Source text={parsed.data.source}/>
  </section>;
}

function linearChain(stages:PipelineData['stages']):string[]|null{
  if(stages.length<1||stages.length>4)return null;
  const roots=stages.filter(stage=>!(stage.dependsOn??[]).length);
  if(roots.length!==1)return null;
  const byId=new Map(stages.map(stage=>[stage.id,stage])),children=new Map<string,string>();
  for(const stage of stages){
    if(stage===roots[0])continue;
    if((stage.dependsOn??[]).length!==1)return null;
    const parent=stage.dependsOn![0];
    if(children.has(parent)||!byId.has(parent))return null;
    children.set(parent,stage.id);
  }
  const chain=[roots[0].id];
  while(chain.length<stages.length){
    const next=children.get(chain.at(-1)!);
    if(!next||chain.includes(next))return null;
    chain.push(next);
  }
  return chain;
}
const easeMove=(()=>{const x1=.4,y1=0,x2=.2,y2=1;
  const sample=(t:number)=>{let lo=0,hi=1,x=t;for(let i=0;i<8;i++){x=(lo+hi)/2;const cx=3*x1*x*(1-x)*(1-x)+3*x2*x*x*(1-x)+x*x*x;if(cx<t)lo=x;else hi=x;}return 3*y1*x*(1-x)*(1-x)+3*y2*x*x*(1-x)+x*x*x;};
  return sample;})();
function StageGraph({stages,selected,select,panelId,cause}:{stages:PipelineData['stages'];selected:string;select:(id:string,cause:SoftwareSelectionCause)=>void;panelId:string;cause:RefObject<SoftwareSelectionCause|undefined>}){
  const graph=useRef<HTMLDivElement>(null),arrowId=useId();
  const chain=useMemo(()=>linearChain(stages),[stages]);
  const order=useMemo(()=>chain?chain.map(id=>stages.find(stage=>stage.id===id)!):stages,[chain,stages]);
  const topologyKey=useMemo(()=>stages.map(stage=>stage.id+'<'+(stage.dependsOn??[]).join('+')).join('|'),[stages]);
  const [row,setRow]=useState(false);
  const mode=chain?(row?'row':'column'):'dag';
  const committed=useRef(''),clock=useRef<number|undefined>(undefined),displayed=useRef(new Map<string,{x:number;y:number}>());
  const [finals,setFinals]=useState<ReadonlyMap<string,{x:number;y:number}>>(new Map());
  const [offsets,setOffsets]=useState<ReadonlyMap<string,{x:number;y:number}>>(new Map());
  const [box,setBox]=useState({w:0,h:0});
  const layout=useMemo(()=>{
    const byId=new Map(stages.map(stage=>[stage.id,stage])),depths=new Map<string,number>();
    const depth=(id:string,visiting=new Set<string>()):number=>{const known=depths.get(id);if(known!==undefined)return known;if(visiting.has(id))return 0;const next=new Set(visiting).add(id),value=Math.min(stages.length,Math.max(-1,...(byId.get(id)?.dependsOn??[]).map(parent=>depth(parent,next)))+1);depths.set(id,value);return value;};
    for(const stage of stages)depth(stage.id);
    const maxDepth=Math.max(0,...depths.values()),columns=Math.min(3,maxDepth+1),rows=new Map<number,number>(),bandHeights=new Map<number,number>();
    const positions=new Map(stages.map(stage=>{const level=depths.get(stage.id)??0,row=rows.get(level)??0;rows.set(level,row+1);const band=Math.floor(level/columns);bandHeights.set(band,Math.max(bandHeights.get(band)??0,row+1));return [stage.id,{depth:level,column:level%columns,band,row}];}));
    const offsetsMap=new Map<number,number>();let height=0;for(let band=0;band<=Math.floor(maxDepth/columns);band++){offsetsMap.set(band,height);height+=bandHeights.get(band)??1;}
    for(const position of positions.values())position.row+=(offsetsMap.get(position.band)??0);
    return {positions,columns,rows:Math.max(1,height)};
  },[stages]);
  const stop=()=>{if(clock.current!==undefined){cancelAnimationFrame(clock.current);clock.current=undefined;}};
  useLayoutEffect(()=>{
    const node=graph.current;
    const settle=()=>{stop();const map=new Map<string,{x:number;y:number}>();node?.querySelectorAll<HTMLElement>('[data-stage-id]').forEach(element=>map.set(element.dataset.stageId!,{x:element.offsetLeft+element.offsetWidth/2,y:element.offsetTop+element.offsetHeight/2}));displayed.current=map;setFinals(map);setOffsets(new Map());};
    const hidden=()=>{if(document.visibilityState==='hidden')settle();};
    const stopObserving=observeMotionPolicy(policy=>{if(policy!=='full')settle();});
    document.addEventListener('visibilitychange',hidden);
    return()=>{stopObserving();document.removeEventListener('visibilitychange',hidden);stop();};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useLayoutEffect(()=>{
    const node=graph.current;if(!node)return;
    const observer=new ResizeObserver(entries=>{const rect=entries[0].contentRect;setBox({w:rect.width,h:rect.height});});
    observer.observe(node);
    return()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{
    const node=graph.current;if(!node)return;
    if(chain)setRow(node.getBoundingClientRect().width>=chain.length*148+(chain.length-1)*8);
  },[chain,box]);
  useLayoutEffect(()=>{
    const node=graph.current;if(!node)return;
    const key=mode+':'+topologyKey+':'+order.map(stage=>stage.id).join(',');
    const final=new Map<string,{x:number;y:number}>();
    node.querySelectorAll<HTMLElement>('[data-stage-id]').forEach(element=>final.set(element.dataset.stageId!,{x:element.offsetLeft+element.offsetWidth/2,y:element.offsetTop+element.offsetHeight/2}));
    if(committed.current===key){stop();displayed.current=final;setFinals(final);setOffsets(new Map());return;}
    const initial=committed.current==='';committed.current=key;
    setFinals(final);
    if(initial||readMotionPolicy()!=='full'||document.visibilityState==='hidden'){displayed.current=final;setOffsets(new Map());return;}
    stop();
    const startOffsets=new Map<string,{x:number;y:number}>();
    for(const [id,end] of final){const start=displayed.current.get(id)??end;startOffsets.set(id,{x:start.x-end.x,y:start.y-end.y});}
    displayed.current=final;setOffsets(startOffsets);
    const t0=performance.now();
    const step=(now:number)=>{
      const p=Math.min(1,(now-t0)/220),e=easeMove(p);
      const next=new Map<string,{x:number;y:number}>(),sample=new Map<string,{x:number;y:number}>();
      for(const [id,end] of final){const start=startOffsets.get(id)!,offset={x:start.x*(1-e),y:start.y*(1-e)};if(offset.x||offset.y)next.set(id,offset);sample.set(id,{x:end.x+offset.x,y:end.y+offset.y});}
      displayed.current=sample;setOffsets(next);
      if(p<1)clock.current=requestAnimationFrame(step);else clock.current=undefined;
    };
    clock.current=requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[mode,topologyKey,order,box]);
  const previousSelected=useRef(selected);
  useLayoutEffect(()=>{
    const previous=previousSelected.current;previousSelected.current=selected;
    const why=cause.current;cause.current=undefined;
    if(previous===selected||why!=='pointer'||!matchMedia('(pointer:fine)').matches)return;
    const node=graph.current?.querySelector<HTMLElement>(`[data-stage-id="${CSS.escape(selected)}"]`),unselected=graph.current?.querySelector<HTMLElement>(`.software-stage-rail button[aria-selected="false"]`);
    if(!node||!unselected)return;
    const to=getComputedStyle(node),from=getComputedStyle(unselected);
    node.style.setProperty('--software-panel-duration','120ms');
    animateTask(node,[{borderColor:from.borderColor},{borderColor:to.borderColor}],120,{duration:'--software-panel-duration',easing:'--ui-ease-enter'});
    graph.current?.querySelectorAll<SVGPathElement>(`.software-stage-connections path[data-from="${CSS.escape(selected)}"],.software-stage-connections path[data-to="${CSS.escape(selected)}"]`).forEach(path=>{path.style.setProperty('--software-panel-duration','120ms');animateTask(path,[{opacity:.3},{opacity:getComputedStyle(path).opacity}],120,{duration:'--software-panel-duration',easing:'--ui-ease-enter'});});
  },[selected,cause]);
  const entrance=usePublicationEntrance(node=>{
    const first=stages.find(stage=>(stage.dependsOn??[]).length>0);
    if(!first)return[];
    const path=node.querySelector<SVGPathElement>(`.software-stage-connections path[data-to="${CSS.escape(first.id)}"]`);
    if(!path)return[];
    path.setAttribute('pathLength','1');
    return [path.animate([{strokeDasharray:'1',strokeDashoffset:'1'},{strokeDasharray:'1',strokeDashoffset:'0'}],{duration:150,easing:'cubic-bezier(.16,1,.3,1)'})];
  });
  const point=(id:string)=>{const f=finals.get(id),o=offsets.get(id);return f?{x:f.x+(o?.x??0),y:f.y+(o?.y??0)}:undefined;};
  const orientation=mode==='row'?'horizontal':'vertical';
  const edges=stages.flatMap(stage=>(stage.dependsOn??[]).map(parent=>({from:parent,to:stage.id})));
  return <div ref={node=>{(graph as React.MutableRefObject<HTMLDivElement|null>).current=node;(entrance as RefObject<HTMLDivElement|null>).current=node;}} className="software-list software-stage-rail software-stage-graph" data-chain={chain?mode:undefined} role="tablist" aria-label="Pipeline stages" aria-orientation={orientation} style={{'--stage-columns':layout.columns,'--stage-rows':layout.rows,'--chain':chain?.length??0} as CSSProperties}>
    <svg className="software-stage-connections" viewBox={`0 0 ${Math.max(1,box.w)} ${Math.max(1,box.h)}`} preserveAspectRatio="none" aria-hidden="true"><defs><marker id={arrowId} viewBox="0 0 8 8" refX="4" refY="4" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse"><path className="software-stage-arrow" d="M1 1 L7 4 L1 7 Z"/></marker></defs>{edges.map(edge=>{const from=point(edge.from),to=point(edge.to);if(!from||!to)return null;const mx=(from.x+to.x)/2,my=(from.y+to.y)/2;return <path key={`${edge.from}:${edge.to}`} data-from={edge.from} data-to={edge.to} markerMid={`url(#${arrowId})`} d={`M${from.x} ${from.y} C${mx} ${from.y} ${mx} ${from.y} ${mx} ${my} C${mx} ${to.y} ${mx} ${to.y} ${to.x} ${to.y}`}/>;})}</svg>
    {order.map((stage,index)=>{const position=layout.positions.get(stage.id)!,offset=offsets.get(stage.id);return <button key={stage.id} type="button" role="tab" aria-label={stage.name} aria-selected={stage.id===selected} aria-controls={panelId} tabIndex={stage.id===selected?0:-1} data-stage-id={stage.id} data-depth={position.depth} style={{...(mode!=='column'?{gridColumn:mode==='row'?index+1:position.column+1,gridRow:mode==='row'?1:position.row+1}:{}),...(offset?{transform:`translate(${offset.x}px,${offset.y}px)`}:{})}} onClick={event=>{cause.current=clickCause(event);select(stage.id,cause.current);}} onKeyDown={event=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?order.length-1:(index+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+order.length)%order.length;cause.current='keyboard';select(order[next].id,'keyboard');event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(':scope > button')[next]?.focus({preventScroll:true});}}>
      <span className="software-item-copy"><span className={`software-stage-node software-state-${stage.status}`}><StatusIcon status={statusKind[stage.status]}/></span><span>{stage.name}</span><span className={`software-stage-result software-state-${stage.status}`}>{statusLabel[stage.status]}</span></span>
      <span className="software-item-meta">{stage.dependsOn?.length?<span>After {stage.dependsOn.map(id=>stages.find(item=>item.id===id)?.name).join(', ')}</span>:<span/>}{stage.durationMs!==undefined&&<span>{duration(stage.durationMs)}</span>}</span>
    </button>;})}
  </div>;
}

export function Pipeline({element:{props}}:ComponentRenderProps){
  const p=SOFTWARE_SCHEMAS.Pipeline.parse(props),store=useStateStore(),raw=store.get(inputPath(p.dataBinding));
  const parsed=useMemo(()=>raw&&typeof raw==='object'&&Array.isArray((raw as {stages?:unknown}).stages)&&(raw as {stages:unknown[]}).stages.length<=40?SOFTWARE_DATA_SCHEMAS.Pipeline.safeParse(raw):null,[raw]);
  const stages=parsed?.success?parsed.data.stages:[],attention=stages.find(stage=>stage.status==='failed')??stages.find(stage=>stage.status==='running')??stages.find(stage=>stage.status==='blocked');
  const {selected,select}=useSelected(stages,p.stateKey,attention?.id),panel=useSoftwarePanelMotion<HTMLDivElement>(selected?.id,undefined,140,.8),panelId=useId(),graphCause=useRef<SoftwareSelectionCause|undefined>(undefined);
  if(!parsed?.success)return <Unavailable name="Pipeline"/>;
  const waitingOn=(selected?.dependsOn??[]).map(id=>stages.find(stage=>stage.id===id)!).filter(stage=>stage.status!=='passed').map(stage=>stage.name);
  const choose=(id:string,cause:SoftwareSelectionCause)=>{panel.mark(id,cause);graphCause.current=cause;if(id!==selected?.id)select(id);};
  return <section className="software-surface software-pipeline" aria-label={parsed.data.title??'Pipeline'}>
    <Title title={parsed.data.title}><Counts items={stages}/></Title>
    {selected?<div className="software-inspector software-release-gate">
      <StageGraph stages={stages} selected={selected.id} select={choose} panelId={panelId} cause={graphCause}/>
      <div ref={panel.ref} className="software-detail" role="tabpanel" id={panelId} aria-label={selected.name}>
        <div className="software-detail-heading"><h4>{selected.name}</h4><CheckState status={selected.status} entityId={selected.id} statusDurationMs={160}/></div>
        {selected.dependsOn?.length?<p className="software-dependencies"><GitBranch size={13}/>Requires {selected.dependsOn.map(id=>stages.find(stage=>stage.id===id)!.name).join(', ')}</p>:null}
        {selected.dependsOn?.some(id=>stages.find(stage=>stage.id===id)?.status==='failed'||stages.find(stage=>stage.id===id)?.status==='blocked')&&<div className="software-blocking-checks" aria-label="Prerequisite checks">{selected.dependsOn.map(id=>stages.find(stage=>stage.id===id)!).filter(stage=>stage.status==='failed'||stage.status==='blocked').map(stage=><button key={stage.id} type="button" className="quiet" aria-label={`Inspect ${stage.name} prerequisite`} onClick={event=>choose(stage.id,clickCause(event))}><StatusIcon status={statusKind[stage.status]}/><span>{stage.name}</span><span className={`software-state-${stage.status}`}>{statusLabel[stage.status]}</span></button>)}</div>}
        {selected.detail&&<p className="software-stage-description">{selected.detail}</p>}
        {selected.command&&<div className="software-command"><Terminal size={13}/><span className="software-command-label">Command</span><code>{selected.command}</code></div>}
        {selected.log?<details key={selected.id} className="software-log" open={selected.status==='failed'}><summary><span>Stage output</span><span className="software-log-name"> · {selected.name}</span></summary><CodeBlock text={selected.log}/></details>:<p className="software-empty">{selected.status==='not-run'?'This stage has not run.':selected.status==='blocked'?`Waiting for ${waitingOn.length?waitingOn.join(', '):'required checks'}.`:'No stage output supplied.'}</p>}
        <Action props={p} payload={{stageId:selected.id,name:selected.name,command:selected.command,status:selected.status}} fallback="Inspect stage" unavailable="No build or release executor connected"/>
      </div>
    </div>:<p className="software-empty">No stages reported.</p>}
    <Source text={parsed.data.source}/>
  </section>;
}

export const SOFTWARE_REGISTRY={Diagnostics,ChangeSet,ApiExplorer,Pipeline} satisfies ComponentRegistry;
