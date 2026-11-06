import {useContext,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {useStateStore,type ComponentRenderProps,type ComponentRegistry} from '@json-render/react';
import {ArrowRight,ArrowUpRight,Braces,FileCode2,GitBranch,Terminal} from 'lucide-react';
import {SOFTWARE_DATA_SCHEMAS,SOFTWARE_SCHEMAS,type PipelineData,type SoftwareProps} from '../../../packages/ui-catalog/software-development';
import {ArtifactTitle,inputPath,statePath,useTaskAction} from './task-context';
import {StatusIcon,type StatusKind} from './task-status';
import {animateTask} from './task-motion';
import './software-development.css';

type CheckStatus='not-run'|'running'|'passed'|'failed'|'skipped'|'blocked'|'unknown';
const statusKind:Record<CheckStatus,StatusKind>={'not-run':'neutral',running:'running',passed:'success',failed:'error',skipped:'neutral',blocked:'pending',unknown:'pending'};
const statusLabel:Record<CheckStatus,string>={'not-run':'Not run',running:'Running',passed:'Passed',failed:'Failed',skipped:'Skipped',blocked:'Blocked',unknown:'Unknown'};
const duration=(value:number|undefined)=>value===undefined?'':value>=1000?`${(value/1000).toFixed(value>=10000?0:1)}s`:`${Math.round(value)}ms`;
function CheckState({status}:{status:CheckStatus}){const feedback=useDetailMotion<HTMLSpanElement>(status,false);return <span ref={feedback} className={`software-check-state software-state-${status}`}><StatusIcon status={statusKind[status]}/><span>{statusLabel[status]}</span></span>;}
function useSelected<T extends {id:string}>(items:T[],key:string,preferred?:string){
  const store=useStateStore(),saved=store.get(statePath(key));
  const selected=items.find(item=>item.id===saved)??items.find(item=>item.id===preferred)??items[0];
  useEffect(()=>{if(!selected||saved===selected.id)return;queueMicrotask(()=>{if(!items.some(item=>item.id===store.get(statePath(key))))store.set(statePath(key),selected.id);});},[selected?.id,saved,key,store,items]);
  return {selected,select:(id:string)=>store.set(statePath(key),id)};
}
function useDetailMotion<T extends HTMLElement=HTMLDivElement>(selected:string|undefined,travel=true,scope?:string){
  const ref=useRef<T>(null),previous=useRef({selected,scope}),animation=useRef<Animation|undefined>(undefined);
  useLayoutEffect(()=>{
    const node=ref.current,before=previous.current;previous.current={selected,scope};
    if(!node)return;
    // Switching endpoints already moves the parent inspector. Only a local
    // response selection needs its own transition; source snapshots stay quiet.
    if(before.scope!==scope){animation.current?.cancel();return;}
    if(before.selected===selected)return;
    const style=getComputedStyle(node),opacity=Number(style.opacity),continuing=animation.current?.playState==='running';animation.current?.cancel();
    animation.current=animateTask(node,travel?[{opacity:continuing?opacity:Math.min(.7,opacity),transform:style.transform==='none'?'translateY(3px)':style.transform},{opacity:1,transform:'translateY(-.35px)',offset:.8},{opacity:1,transform:'translateY(0)'}]:[{opacity:continuing?opacity:Math.min(.55,opacity)},{opacity:1}],travel?220:180);
  },[selected,travel,scope]);
  useLayoutEffect(()=>{
    const settle=()=>animation.current?.cancel(),preference=matchMedia('(prefers-reduced-motion: reduce)');
    const interact=(event:Event)=>{if(event.target instanceof Node&&ref.current?.contains(event.target))settle();};
    const theme=new MutationObserver(settle);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    document.addEventListener('pointerdown',interact);document.addEventListener('keydown',interact);preference.addEventListener('change',settle);
    return()=>{settle();theme.disconnect();document.removeEventListener('pointerdown',interact);document.removeEventListener('keydown',interact);preference.removeEventListener('change',settle);};
  },[]);return ref;
}
function Title({title,children}:{title?:string;children?:ReactNode}){const outer=useContext(ArtifactTitle);return <header className="software-heading">{title&&title!==outer&&<h4>{title}</h4>}{children}</header>;}
function Source({text}:{text?:string}){return text?<details className="software-source"><summary>Source</summary><p>{text}</p></details>:null;}
function Unavailable({name}:{name:string}){return <p className="task-unavailable">{name} data is unavailable. Ask the agent to refresh its source.</p>;}
type ListItem={id:string;label:string;ariaLabel?:string;meta?:ReactNode;icon?:ReactNode};
function SelectList({items,selected,select,label,panelId,className=''}:{items:ListItem[];selected?:string;select:(id:string)=>void;label:string;panelId:string;className?:string}){
  return <div className={`software-list ${className}`} role="tablist" aria-label={label} aria-orientation="horizontal">{items.map((item,index)=><button key={item.id} type="button" role="tab" aria-label={item.ariaLabel??item.label} aria-selected={item.id===selected} tabIndex={item.id===selected?0:-1} aria-controls={panelId} onClick={()=>select(item.id)} onKeyDown={event=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+items.length)%items.length;select(items[next].id);(event.currentTarget.parentElement?.children[next] as HTMLButtonElement|undefined)?.focus();}}><span className="software-item-copy">{item.icon}<span>{item.label}</span></span>{Boolean(item.meta)&&<span className="software-item-meta">{item.meta}</span>}</button>)}</div>;
}
function Action({props,payload,fallback,unavailable}:{props:SoftwareProps;payload:Record<string,unknown>;fallback:string;unavailable?:string}){
  const action=useTaskAction();
  return <footer className="software-actions">{props.actionId?<button type="button" className="secondary" disabled={action.busy} onClick={()=>void action.run(props.actionId!,payload)}>{action.busy?'Requesting…':props.actionLabel??fallback}<ArrowUpRight size={13}/></button>:unavailable?<><button type="button" className="secondary" disabled title={unavailable}>{fallback}</button><span className="software-unavailable">{unavailable}</span></>:null}{action.error&&<span role="alert" className="error-text">{action.error}</span>}</footer>;
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
  const items=parsed?.success?parsed.data.items:[],{selected,select}=useSelected(items,p.stateKey,items.find(item=>item.status==='failed')?.id),detail=useDetailMotion(selected?.id),panelId=useId();
  if(!parsed?.success)return <Unavailable name="Diagnostic"/>;
  const comparison=selected&&(selected.expected!==undefined||selected.actual!==undefined);
  return <section className="software-surface software-diagnostics" aria-label={parsed.data.title??'Diagnostics'}>
    <Title title={parsed.data.title}><Counts items={items}/></Title>
    {selected?<div className="software-inspector software-investigation">
      <div ref={detail} className="software-detail" role="tabpanel" id={panelId} aria-label={selected.title}>
        <div className="software-detail-heading"><h4>{selected.title}</h4><CheckState status={selected.status}/></div>
        {selected.file&&<p className="software-file-location"><FileCode2 size={13}/><code>{selected.file}{selected.line?`:${selected.line}${selected.column?`:${selected.column}`:''}`:''}</code>{selected.durationMs!==undefined&&<span>{duration(selected.durationMs)}</span>}</p>}
        {comparison&&<section className="software-assertion" data-status={selected.status} aria-label="Assertion comparison"><div><span>Expected</span><pre><code>{selected.expected??'Not supplied'}</code></pre></div><ArrowRight size={16} aria-hidden="true"/><div><span>Received</span><pre><code>{selected.actual??'Not supplied'}</code></pre></div></section>}
        {selected.message&&(comparison?<details className="software-diagnostic-details"><summary>Failure details</summary><p className="software-diagnostic-message">{selected.message}</p></details>:<p className="software-diagnostic-message">{selected.message}</p>)}
        {selected.code&&<CodeBlock text={selected.code} label="Source context"/>}
        <Action props={p} payload={{diagnosticId:selected.id,file:selected.file,line:selected.line,status:selected.status}} fallback="Investigate"/>
      </div>
      <SelectList className="software-check-inventory" items={items.map(item=>({id:item.id,label:item.title,icon:<span className={`software-diagnostic-node software-state-${item.status}`}><StatusIcon status={statusKind[item.status]}/></span>,meta:<><span>{item.file}{item.line?`:${item.line}`:''}</span><span className={`software-state-${item.status}`}>{statusLabel[item.status]}</span></>}))} selected={selected.id} select={select} label="Diagnostics" panelId={panelId}/>
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
export function ChangeSet({element:{props}}:ComponentRenderProps){
  const p=SOFTWARE_SCHEMAS.ChangeSet.parse(props),store=useStateStore(),raw=store.get(inputPath(p.dataBinding));
  const parsed=useMemo(()=>raw&&typeof raw==='object'&&Array.isArray((raw as {files?:unknown}).files)&&(raw as {files:unknown[]}).files.length<=100?SOFTWARE_DATA_SCHEMAS.ChangeSet.safeParse(raw):null,[raw]);
  const files=parsed?.success?parsed.data.files:[],{selected,select}=useSelected(files,p.stateKey),detail=useDetailMotion(selected?.id),panelId=useId();
  if(!parsed?.success)return <Unavailable name="Change"/>;
  const lines=patchLines(selected?.patch??'');
  return <section className="software-surface software-changes" aria-label={parsed.data.title??'Changes'}>
    <Title title={parsed.data.title}><span className="software-counts">{files.length} {files.length===1?'file':'files'}</span></Title>
    {selected?<div className="software-inspector software-file-review">
      <SelectList items={files.map(file=>{const parts=file.path.split(/[\\/]/);return {id:file.id,label:parts.at(-1)!,ariaLabel:file.path,icon:<FileCode2 size={14}/>,meta:<><span>{parts.length>1?parts.slice(0,-1).join('/') : file.status}</span><span className="software-diff-counts">{file.additions!==undefined&&<b>+{file.additions}</b>}{file.deletions!==undefined&&<i>−{file.deletions}</i>}</span></>};})} selected={selected.id} select={select} label="Changed files" panelId={panelId}/>
      <div ref={detail} className="software-detail" role="tabpanel" id={panelId} aria-label={selected.path}>
        <div className="software-detail-heading"><h4><code>{selected.path}</code></h4><span className="software-file-status">{selected.status}</span></div>
        {selected.previousPath&&<p className="software-file-location">From <code>{selected.previousPath}</code></p>}{selected.note&&<p className="software-change-note">{selected.note}</p>}
        <div className="software-patch-heading"><span>Before</span><span>After</span><div className="software-patch-key" aria-label="Patch legend"><span><b aria-hidden="true">−</b>Removed</span><span><b aria-hidden="true">+</b>Added</span></div></div>
        <pre className="software-patch" aria-label="Selected patch" tabIndex={0}><code>{lines.slice(0,600).map((line,index)=><span key={index} className={`patch-${line.kind}`} data-line-kind={line.kind} data-old-line={line.oldLine} data-new-line={line.newLine}><span className="patch-old-line" aria-hidden="true">{line.oldLine??''}</span><span className="patch-new-line" aria-hidden="true">{line.newLine??''}</span><span className="patch-gutter" aria-hidden="true">{line.kind==='added'?'+':line.kind==='removed'?'−':''}</span><span className="patch-code">{line.text||' '}</span></span>)}</code></pre>
        {lines.length>600&&<details><summary>Full patch ({lines.length} lines)</summary><CodeBlock text={selected.patch}/></details>}
        <Action props={p} payload={{fileId:selected.id,path:selected.path,status:selected.status}} fallback="Review change"/>
      </div>
    </div>:<p className="software-empty">No changed files reported.</p>}
    <Source text={parsed.data.source}/>
  </section>;
}

export function ApiExplorer({element:{props}}:ComponentRenderProps){
  const p=SOFTWARE_SCHEMAS.ApiExplorer.parse(props),store=useStateStore(),raw=store.get(inputPath(p.dataBinding));
  const parsed=useMemo(()=>raw&&typeof raw==='object'&&Array.isArray((raw as {endpoints?:unknown}).endpoints)&&(raw as {endpoints:unknown[]}).endpoints.length<=80?SOFTWARE_DATA_SCHEMAS.ApiExplorer.safeParse(raw):null,[raw]);
  const endpoints=parsed?.success?parsed.data.endpoints:[],{selected,select}=useSelected(endpoints,p.stateKey),detail=useDetailMotion(selected?.id),panelId=useId(),responseId=useId();
  const [responseSelections,setResponseSelections]=useState<Record<string,string>>({});
  const responses=selected?.responses??[],responseIndex=Math.max(0,responses.findIndex((response,index)=>`${response.status}:${index}`===responseSelections[selected?.id??''])),response=responses[responseIndex];
  const responseMotion=useDetailMotion(String(responseIndex),true,selected?.id);
  if(!parsed?.success)return <Unavailable name="API contract"/>;
  const selectResponse=(index:number)=>{if(selected&&responses[index])setResponseSelections(current=>({...current,[selected.id]:`${responses[index].status}:${index}`}));};
  return <section className="software-surface software-api" aria-label={parsed.data.title??'API contract'}>
    <Title title={parsed.data.title}><span className="software-counts">{endpoints.length} {endpoints.length===1?'endpoint':'endpoints'}</span></Title>
    {selected?<div className="software-inspector software-contract">
      <SelectList items={endpoints.map(endpoint=>({id:endpoint.id,label:endpoint.path,ariaLabel:`${endpoint.method} ${endpoint.path}`,icon:<span className={`software-method method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>}))} selected={selected.id} select={select} label="API endpoints" panelId={panelId}/>
      <div ref={detail} className="software-detail" role="tabpanel" id={panelId} aria-label={`${selected.method} ${selected.path}`}>
        <div className="software-detail-heading software-endpoint-heading"><h4><span className={`software-method method-${selected.method.toLowerCase()}`}>{selected.method}</span><code>{selected.path}</code></h4><Braces size={16} aria-hidden="true"/></div>
        {selected.summary&&<p className="software-endpoint-summary">{selected.summary}</p>}
        {selected.parameters?.length?<details className="software-parameter-details"><summary>Parameters <span>{selected.parameters.length}</span></summary><div className="software-table-scroll"><table className="software-parameters"><thead><tr><th>Name</th><th>Type</th><th>Location</th></tr></thead><tbody>{selected.parameters.map((parameter,index)=><tr key={parameter.location+parameter.name+index}><td><code>{parameter.name}</code>{parameter.required&&<small>required</small>}{parameter.description&&<p>{parameter.description}</p>}</td><td><code>{parameter.type}</code></td><td>{parameter.location}</td></tr>)}</tbody></table></div></details>:null}
        <div className="software-api-flow">
          <section className="software-request" aria-label="Request example"><header><h5>Request example</h5></header>{selected.request?<CodeBlock text={selected.request}/>:<p className="software-no-body">No request body</p>}</section>
          <ArrowRight className="software-flow-arrow" size={17} aria-hidden="true"/>
          <section className="software-response" aria-label="Response example"><header><h5>Response example</h5>{responses.length>0&&<div className="software-response-tabs" role="tablist" aria-label="Response examples">{responses.map((item,index)=><button key={item.status+':'+index} id={`${responseId}-${index}`} role="tab" type="button" aria-selected={index===responseIndex} aria-controls={responseId} aria-label={`Response ${item.status}`} tabIndex={index===responseIndex?0:-1} onClick={()=>selectResponse(index)} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?responses.length-1:(index+(event.key==='ArrowRight'?1:-1)+responses.length)%responses.length;selectResponse(next);(event.currentTarget.parentElement?.children[next] as HTMLButtonElement|undefined)?.focus();}}><span>{item.status}</span>{responseLabels[item.status]&&<span className="software-response-label">{responseLabels[item.status]}</span>}<span className="sr-only">Response {item.status}</span></button>)}</div>}</header>{responses.length?<><div ref={responseMotion} className="software-response-content" id={responseId} role="tabpanel" aria-labelledby={`${responseId}-${responseIndex}`}>{response?.description&&<p className="software-response-description">{response.description}</p>}{response&&<CodeBlock text={response.body}/>}</div></>:<p className="software-no-body">No response example supplied</p>}</section>
        </div>
        <Action props={p} payload={{endpointId:selected.id,method:selected.method,path:selected.path}} fallback="Review endpoint" unavailable="No API executor connected"/>
      </div>
    </div>:<p className="software-empty">No endpoints in this contract.</p>}
    <Source text={parsed.data.source}/>
  </section>;
}

function StageGraph({stages,selected,select,panelId}:{stages:PipelineData['stages'];selected:string;select:(id:string)=>void;panelId:string}){
  const arrowId=useId();
  const layout=useMemo(()=>{
    const byId=new Map(stages.map(stage=>[stage.id,stage])),depths=new Map<string,number>();
    const depth=(id:string,visiting=new Set<string>()):number=>{const known=depths.get(id);if(known!==undefined)return known;if(visiting.has(id))return 0;const next=new Set(visiting).add(id),value=Math.min(stages.length,Math.max(-1,...(byId.get(id)?.dependsOn??[]).map(parent=>depth(parent,next)))+1);depths.set(id,value);return value;};
    for(const stage of stages)depth(stage.id);
    const maxDepth=Math.max(0,...depths.values()),columns=Math.min(3,maxDepth+1),rows=new Map<number,number>(),bandHeights=new Map<number,number>();
    const positions=new Map(stages.map(stage=>{const level=depths.get(stage.id)??0,row=rows.get(level)??0;rows.set(level,row+1);const band=Math.floor(level/columns);bandHeights.set(band,Math.max(bandHeights.get(band)??0,row+1));return [stage.id,{depth:level,column:level%columns,band,row}];}));
    const offsets=new Map<number,number>();let height=0;for(let band=0;band<=Math.floor(maxDepth/columns);band++){offsets.set(band,height);height+=bandHeights.get(band)??1;}
    for(const position of positions.values())position.row+=(offsets.get(position.band)??0);
    return {positions,columns,rows:Math.max(1,height)};
  },[stages]);
  const rowHeight=80,width=900,height=layout.rows*rowHeight;
  return <div className="software-list software-stage-rail software-stage-graph" role="tablist" aria-label="Pipeline stages" aria-orientation="vertical" style={{'--stage-columns':layout.columns,'--stage-rows':layout.rows} as CSSProperties}>
    <svg className="software-stage-connections" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true"><defs><marker id={arrowId} viewBox="0 0 8 8" refX="4" refY="4" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse"><path className="software-stage-arrow" d="M1 1 L7 4 L1 7 Z"/></marker></defs>{stages.flatMap(stage=>(stage.dependsOn??[]).map(parent=>{const from=layout.positions.get(parent),to=layout.positions.get(stage.id);if(!from||!to)return null;const sx=(from.column+.5)*width/layout.columns,sy=(from.row+.5)*rowHeight,tx=(to.column+.5)*width/layout.columns,ty=(to.row+.5)*rowHeight,mx=(sx+tx)/2,my=(sy+ty)/2;return <path key={`${parent}:${stage.id}`} data-from={parent} data-to={stage.id} markerMid={`url(#${arrowId})`} d={`M${sx} ${sy} C${mx} ${sy} ${mx} ${sy} ${mx} ${my} C${mx} ${ty} ${mx} ${ty} ${tx} ${ty}`}/>;}))}</svg>
    {stages.map((stage,index)=>{const position=layout.positions.get(stage.id)!;return <button key={stage.id} type="button" role="tab" aria-label={stage.name} aria-selected={stage.id===selected} aria-controls={panelId} tabIndex={stage.id===selected?0:-1} data-stage-id={stage.id} data-depth={position.depth} style={{gridColumn:position.column+1,gridRow:position.row+1}} onClick={()=>select(stage.id)} onKeyDown={event=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?stages.length-1:(index+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+stages.length)%stages.length;select(stages[next].id);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(':scope > button')[next]?.focus();}}>
      <span className="software-item-copy"><span className={`software-stage-node software-state-${stage.status}`}><StatusIcon status={statusKind[stage.status]}/></span><span>{stage.name}</span><span className={`software-stage-result software-state-${stage.status}`}>{statusLabel[stage.status]}</span></span>
      <span className="software-item-meta">{stage.dependsOn?.length?<span>After {stage.dependsOn.map(id=>stages.find(item=>item.id===id)?.name).join(', ')}</span>:<span/>}{stage.durationMs!==undefined&&<span>{duration(stage.durationMs)}</span>}</span>
    </button>;})}
  </div>;
}

export function Pipeline({element:{props}}:ComponentRenderProps){
  const p=SOFTWARE_SCHEMAS.Pipeline.parse(props),store=useStateStore(),raw=store.get(inputPath(p.dataBinding));
  const parsed=useMemo(()=>raw&&typeof raw==='object'&&Array.isArray((raw as {stages?:unknown}).stages)&&(raw as {stages:unknown[]}).stages.length<=40?SOFTWARE_DATA_SCHEMAS.Pipeline.safeParse(raw):null,[raw]);
  const stages=parsed?.success?parsed.data.stages:[],attention=stages.find(stage=>stage.status==='failed')??stages.find(stage=>stage.status==='running')??stages.find(stage=>stage.status==='blocked');
  const {selected,select}=useSelected(stages,p.stateKey,attention?.id),detail=useDetailMotion(selected?.id),panelId=useId();
  if(!parsed?.success)return <Unavailable name="Pipeline"/>;
  const waitingOn=(selected?.dependsOn??[]).map(id=>stages.find(stage=>stage.id===id)!).filter(stage=>stage.status!=='passed').map(stage=>stage.name);
  return <section className="software-surface software-pipeline" aria-label={parsed.data.title??'Pipeline'}>
    <Title title={parsed.data.title}><Counts items={stages}/></Title>
    {selected?<div className="software-inspector software-release-gate">
      <StageGraph stages={stages} selected={selected.id} select={select} panelId={panelId}/>
      <div ref={detail} className="software-detail" role="tabpanel" id={panelId} aria-label={selected.name}>
        <div className="software-detail-heading"><h4>{selected.name}</h4><CheckState status={selected.status}/></div>
        {selected.dependsOn?.length?<p className="software-dependencies"><GitBranch size={13}/>Requires {selected.dependsOn.map(id=>stages.find(stage=>stage.id===id)!.name).join(', ')}</p>:null}
        {selected.dependsOn?.some(id=>stages.find(stage=>stage.id===id)?.status==='failed'||stages.find(stage=>stage.id===id)?.status==='blocked')&&<div className="software-blocking-checks" aria-label="Prerequisite checks">{selected.dependsOn.map(id=>stages.find(stage=>stage.id===id)!).filter(stage=>stage.status==='failed'||stage.status==='blocked').map(stage=><button key={stage.id} type="button" className="quiet" aria-label={`Inspect ${stage.name} prerequisite`} onClick={()=>select(stage.id)}><StatusIcon status={statusKind[stage.status]}/><span>{stage.name}</span><span className={`software-state-${stage.status}`}>{statusLabel[stage.status]}</span></button>)}</div>}
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
