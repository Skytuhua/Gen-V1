import {useEffect,useLayoutEffect,useRef,useState,type ReactNode,type PointerEvent} from 'react';
import {ChevronDown,ChevronRight,EyeOff,GripHorizontal,Maximize2,Minus,Pin,Plus,RotateCcw,Scan,LayoutGrid} from 'lucide-react';
import type {Thread} from '../../../packages/contracts/index.ts';
import type {CanvasLayout,PanelBounds,PanelPlacement,ProjectSummary,WorkspacePanelKind} from '../../../packages/contracts/workspace.ts';
import {arrangeCanvasPanels,canvasZoom,canvasZoomAt,fitCanvasViewport,groupCanvasPanels,panelInViewport,snapPanelBounds,threadParent} from './workspace-canvas-layout';
import './workspace-canvas.css';

type Viewport=CanvasLayout['viewport'];
export interface WorkspaceCanvasProps {
 canvas:CanvasLayout;panels:PanelPlacement[];projects:ProjectSummary[];disabledKinds:WorkspacePanelKind[];threads?:Thread[];embedded?:boolean;
 renderBody:(panel:PanelPlacement,visible:boolean)=>ReactNode;
 title:(panel:PanelPlacement)=>string;
 updatePanel:(panel:PanelPlacement,patch:Partial<PanelPlacement>)=>Promise<void>;
 updateViewport:(viewport:Viewport)=>Promise<void>;
 setFilter:(filter:CanvasLayout['filter'])=>Promise<void>;
 /** Ignored compatibility prop; canvas panels remain inside the app. */
 detach?:(panel:PanelPlacement)=>Promise<void>;
}
interface ViewportWrite {canvasId:string;value:Viewport;generation:number;save:WorkspaceCanvasProps['updateViewport']}
export function WorkspaceCanvas({canvas,panels,projects,disabledKinds,threads=[],embedded=false,renderBody,title,updatePanel,updateViewport,setFilter}:WorkspaceCanvasProps){
 const root=useRef<HTMLDivElement>(null),[viewport,setViewport]=useState(canvas.viewport),[drafts,setDrafts]=useState<Record<string,PanelBounds>>({}),[size,setSize]=useState({width:1200,height:800}),[error,setError]=useState(''),[arranging,setArranging]=useState(false);
 const viewportRef=useRef(viewport),canvasId=useRef(canvas.id),interaction=useRef<(()=>void)|null>(null),mounted=useRef(true);
 const confirmed=useRef(new Map<string,Viewport>([[canvas.id,canvas.viewport]])),generation=useRef(new Map<string,number>()),localViewports=useRef(new Map<string,Viewport>()),viewportErrors=useRef(new Map<string,string>());
 const pending=useRef(new Map<string,ViewportWrite>()),saving=useRef<ViewportWrite|null>(null),saveTimers=useRef(new Map<string,ReturnType<typeof setTimeout>>()),pumpRef=useRef<()=>void>(()=>{});
 const publish=(value:Viewport)=>{viewportRef.current=value;if(mounted.current)setViewport(value);window.dispatchEvent(new Event('harness:canvas-layout'));};
 const pump=async()=>{
  if(saving.current)return;
  const write=[...pending.current.values()].find(value=>!saveTimers.current.has(value.canvasId));if(!write)return;
  pending.current.delete(write.canvasId);saving.current=write;
  try{await write.save(write.value);confirmed.current.set(write.canvasId,write.value);if(generation.current.get(write.canvasId)===write.generation)localViewports.current.delete(write.canvasId);}
  catch(cause){if(generation.current.get(write.canvasId)===write.generation){localViewports.current.delete(write.canvasId);const message=cause instanceof Error?cause.message:'The canvas position could not be saved.';viewportErrors.current.set(write.canvasId,message);if(mounted.current&&canvasId.current===write.canvasId){publish(confirmed.current.get(write.canvasId)!);setError(message);}}}
  finally{saving.current=null;pumpRef.current();}
 };
 pumpRef.current=()=>{void pump();};
 const saveViewport=(value:Viewport,delay=0)=>{
  publish(value);setError('');if(!confirmed.current.has(canvas.id))confirmed.current.set(canvas.id,canvas.viewport);viewportErrors.current.delete(canvas.id);localViewports.current.set(canvas.id,value);const next=(generation.current.get(canvas.id)??0)+1;generation.current.set(canvas.id,next);pending.current.set(canvas.id,{canvasId:canvas.id,value,generation:next,save:updateViewport});
  const timer=saveTimers.current.get(canvas.id);if(timer){clearTimeout(timer);saveTimers.current.delete(canvas.id);}
  if(delay)saveTimers.current.set(canvas.id,setTimeout(()=>{saveTimers.current.delete(canvas.id);pumpRef.current();},delay));else pumpRef.current();
 };
 const actionsRef=useRef({saveViewport});actionsRef.current={saveViewport};
 useEffect(()=>{
  if(canvasId.current!==canvas.id){const outgoing=canvasId.current;interaction.current?.();canvasId.current=canvas.id;if(!confirmed.current.has(canvas.id))confirmed.current.set(canvas.id,canvas.viewport);setDrafts({});setArranging(false);setError(viewportErrors.current.get(canvas.id)??'');publish(localViewports.current.get(canvas.id)??canvas.viewport);const timer=saveTimers.current.get(outgoing);if(timer){clearTimeout(timer);saveTimers.current.delete(outgoing);}pumpRef.current();return;}
  if(saving.current?.canvasId!==canvas.id&&!pending.current.has(canvas.id)&&!interaction.current){confirmed.current.set(canvas.id,canvas.viewport);publish(canvas.viewport);}
 },[canvas.id,canvas.viewport.x,canvas.viewport.y,canvas.viewport.zoom]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;interaction.current?.();document.documentElement.classList.remove('workspace-canvas-interaction');for(const timer of saveTimers.current.values())clearTimeout(timer);saveTimers.current.clear();pumpRef.current();};},[]);
 useLayoutEffect(()=>{if(!root.current)return;const observer=new ResizeObserver(entries=>{const rect=entries[0]?.contentRect;if(rect)setSize({width:rect.width,height:rect.height});});observer.observe(root.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{
  const element=root.current;if(!element)return;
  const wheel=(event:WheelEvent)=>{
   if(embedded||event.defaultPrevented||!event.deltaY||(event.target instanceof Element&&event.target.closest('.canvas-panel-body')))return;
   event.preventDefault();interaction.current?.();
   const rect=element.getBoundingClientRect(),delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?element.clientHeight:1),point={x:event.clientX-rect.left,y:event.clientY-rect.top};
   const current=viewportRef.current;actionsRef.current.saveViewport(canvasZoomAt(current,current.zoom*Math.exp(-Math.max(-500,Math.min(500,delta))*.0015),point),140);
  };
  element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
 },[embedded]);
 const run=(action:()=>Promise<void>)=>{setError('');void action().catch(cause=>{if(mounted.current)setError(cause instanceof Error?cause.message:'The canvas could not be updated.');});};
 const zoom=(direction:-1|0|1)=>{const current=viewportRef.current;saveViewport(canvasZoomAt(current,canvasZoom(current.zoom,direction),{x:size.width/2,y:size.height/2}));};
 const visiblePanels=panels.filter(panel=>panel.visible&&panel.placement==='canvas'&&!disabledKinds.includes(panel.kind));
 const displayed=visiblePanels.map(panel=>({...panel,bounds:drafts[panel.id]??panel.bounds}));
 const projectGroups=canvas.preset==='all-agents'?groupCanvasPanels(displayed,threads):[];
 const panelDomId=(id:string)=>`canvas-panel-${canvas.id}-${id}`;
 const fit=(values=displayed)=>saveViewport(fitCanvasViewport(values,size,canvas.preset==='all-agents'?88:24));
 const arrange=()=>{
  if(arranging)return;interaction.current?.();setArranging(true);
  const ownedCanvas=canvas.id,bounds=arrangeCanvasPanels(visiblePanels,canvas.preset,size,threads);setDrafts(Object.fromEntries(bounds));
  run(async()=>{try{for(const panel of visiblePanels){if(canvasId.current!==ownedCanvas)return;const next=bounds.get(panel.id);if(next)await updatePanel(panel,{bounds:next});}if(canvasId.current===ownedCanvas)fit(visiblePanels.map(panel=>({...panel,bounds:bounds.get(panel.id)??panel.bounds})));}finally{if(canvasId.current===ownedCanvas){setDrafts({});setArranging(false);}}});
 };
 const reachableBounds=(value:PanelBounds)=>{
  const next=snapPanelBounds(value);if(!embedded)return next;
  const view=viewportRef.current,width=Math.min(next.width,Math.max(120,(size.width-16)/view.zoom)),height=Math.min(next.height,Math.max(80,(size.height-16)/view.zoom)),left=(8-view.x)/view.zoom,top=(8-view.y)/view.zoom;
  return {...next,width,height,x:Math.max(left,Math.min((size.width-8-view.x)/view.zoom-width,next.x)),y:Math.max(top,Math.min((size.height-8-view.y)/view.zoom-height,next.y))};
 };
 const move=(event:PointerEvent<HTMLButtonElement>,panel:PanelPlacement,resize=false)=>{
  if(event.button!==0||arranging)return;event.preventDefault();event.stopPropagation();interaction.current?.();
  const original=drafts[panel.id]??panel.bounds,startX=event.clientX,startY=event.clientY,scale=viewportRef.current.zoom,element=event.currentTarget,pointerId=event.pointerId;let current=original,finished=false;
  document.documentElement.classList.add('workspace-canvas-interaction');
  element.setPointerCapture?.(pointerId);
  const changed=(value:globalThis.PointerEvent)=>{if(value.pointerId!==pointerId)return;const dx=(value.clientX-startX)/scale,dy=(value.clientY-startY)/scale;current=reachableBounds(resize?{...original,width:original.width+dx,height:original.height+dy}:{...original,x:original.x+dx,y:original.y+dy});setDrafts(previous=>({...previous,[panel.id]:current}));};
  const clearDraft=()=>setDrafts(previous=>{const next={...previous};delete next[panel.id];return next;});
  const cleanup=()=>{finished=true;window.removeEventListener('pointermove',changed);window.removeEventListener('pointerup',done);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);if(element.hasPointerCapture?.(pointerId))element.releasePointerCapture(pointerId);document.documentElement.classList.remove('workspace-canvas-interaction');interaction.current=null;window.dispatchEvent(new Event('harness:canvas-layout'));};
  const cancel=(value?:Event)=>{if(finished||value instanceof globalThis.PointerEvent&&value.pointerId!==pointerId)return;cleanup();if(mounted.current)clearDraft();};
  const done=(value:globalThis.PointerEvent)=>{if(finished||value.pointerId!==pointerId)return;cleanup();run(async()=>{try{await updatePanel(panel,{bounds:current,order:Math.min(100000,Math.max(0,...panels.map(value=>value.order))+1)});}finally{if(mounted.current)clearDraft();}});};
  interaction.current=cancel;window.addEventListener('pointermove',changed);window.addEventListener('pointerup',done);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);
 };
 const pan=(event:PointerEvent<HTMLDivElement>)=>{
  const target=event.target;if(embedded||event.button!==0||arranging||target instanceof Element&&target.closest('.canvas-panel,.canvas-family-heading,.canvas-project-heading'))return;
  event.preventDefault();interaction.current?.();const start={...viewportRef.current},x=event.clientX,y=event.clientY;let next=start;
  document.documentElement.classList.add('workspace-canvas-interaction');
  const changed=(value:globalThis.PointerEvent)=>{next={...start,x:start.x+value.clientX-x,y:start.y+value.clientY-y};publish(next);};
  const cleanup=()=>{window.removeEventListener('pointermove',changed);window.removeEventListener('pointerup',done);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);document.documentElement.classList.remove('workspace-canvas-interaction');interaction.current=null;};
  const done=()=>{cleanup();saveViewport(next);},cancel=()=>{cleanup();publish(start);};
  interaction.current=cancel;window.addEventListener('pointermove',changed);window.addEventListener('pointerup',done,{once:true});window.addEventListener('pointercancel',cancel,{once:true});window.addEventListener('blur',cancel,{once:true});
 };
 return <section className="workspace-canvas-shell" data-embedded={embedded} aria-label={`${canvas.name} canvas`}>
  {!embedded&&<div className="canvas-toolbar"><strong>{canvas.name}</strong>{canvas.preset==='all-agents'&&<div className="canvas-filter" role="group" aria-label="Agent history filter"><button aria-pressed={canvas.filter==='active'} onClick={()=>run(()=>setFilter('active'))}>Active & pinned</button><button aria-pressed={canvas.filter==='all'} onClick={()=>run(()=>setFilter('all'))}>All history</button></div>}<span className="canvas-toolbar-spacer"/>
   <button className="canvas-layout-action" disabled={arranging||!visiblePanels.length} onClick={()=>fit()}><Scan size={14}/>Fit</button><button className="canvas-layout-action" disabled={arranging||!visiblePanels.length} onClick={arrange}><LayoutGrid size={14}/>{arranging?'Arranging…':'Arrange'}</button>
   <div className="canvas-zoom" role="group" aria-label="Canvas zoom"><button className="icon-button" aria-label="Zoom canvas out" onClick={()=>zoom(-1)}><Minus size={14}/></button><button title="Reset canvas zoom" aria-label="Reset canvas zoom" onClick={()=>zoom(0)}>{Math.round(viewport.zoom*100)}%</button><button className="icon-button" aria-label="Zoom canvas in" onClick={()=>zoom(1)}><Plus size={14}/></button><button className="icon-button" aria-label="Reset canvas position" onClick={()=>saveViewport({x:0,y:0,zoom:1})}><RotateCcw size={13}/></button></div>
  </div>}
  {error&&<p className="canvas-error error-text" role="status">{error}</p>}
  <div ref={root} className="workspace-canvas" tabIndex={embedded?-1:0} aria-label="Canvas panels; drag empty space to pan" aria-description={embedded?'Workspace tools. Drag a panel header to move it.':'Scroll empty space or panel headers to zoom. Scroll inside a panel to read its content.'} onKeyDown={event=>{if(embedded||event.target!==event.currentTarget&&event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable=true]'))return;if((event.ctrlKey||event.metaKey)&&!event.altKey&&['-','=','+','0'].includes(event.key)){event.preventDefault();event.stopPropagation();zoom(event.key==='0'?0:event.key==='-'?-1:1);}}} onPointerDown={pan}>
   <div className="canvas-world" style={{transform:`translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})`}}>
    {projectGroups.map((project,index)=>{
     const projectName=projects.find(value=>value.id===project.projectId&&JSON.stringify(value.authority)===JSON.stringify(project.authority))?.name??(project.projectId==='unassigned'?'Conversations':project.authority.kind==='local'?threads.find(value=>value.projectId===project.projectId)?.projectName??'Project':'Project');
     return <section key={project.key} className="canvas-project-group" style={{left:project.bounds.x,top:project.bounds.y,width:project.bounds.width,height:project.bounds.height}} aria-label={projectName} aria-owns={project.families.map((_,familyIndex)=>`canvas-family-${canvas.id}-${index}-${familyIndex}`).join(' ')}><h2 className="canvas-project-heading">{projectName}<small>{project.families.length} {project.families.length===1?'conversation':'conversations'}</small></h2>{project.families.map((family,familyIndex)=>{const parent=project.authority.kind==='local'?threads.find(value=>value.id===family.rootThreadId):undefined,main=displayed.find(panel=>family.panelIds.includes(panel.id)&&panel.binding.threadId===family.rootThreadId);return <section key={family.key} id={`canvas-family-${canvas.id}-${index}-${familyIndex}`} className="canvas-family-group" style={{left:family.bounds.x-project.bounds.x,top:family.bounds.y-project.bounds.y,width:family.bounds.width,height:family.bounds.height}} aria-label={parent?.title??(main?title(main):'Conversation')} aria-owns={family.panelIds.map(panelDomId).join(' ')}><h3 className="canvas-family-heading">{parent?.title??(main?title(main):'Conversation')}<small>{family.panelIds.length>1?`${family.panelIds.length-1} linked ${family.panelIds.length===2?'agent':'agents'}`:'Main chat'}</small></h3></section>;})}</section>;
    })}
    {displayed.map(panel=>{
     const bounds=panel.bounds,visible=panelInViewport({...bounds,height:panel.collapsed?40:bounds.height},viewport,size),keep=panel.kind==='thread'||panel.kind==='artifact'||drafts[panel.id]!==undefined,thread=panel.binding.authority.kind==='local'?threads.find(value=>value.id===panel.binding.threadId):undefined,parent=thread&&threadParent(thread),parentTitle=parent?threads.find(value=>value.id===parent)?.title:undefined;
     return <section key={panel.id} id={panelDomId(panel.id)} className={`canvas-panel canvas-panel-${panel.kind}`} data-panel-id={panel.id} data-parent-thread-id={parent} data-collapsed={panel.collapsed} data-pinned={panel.alwaysOnTop} style={{left:bounds.x,top:bounds.y,width:bounds.width,height:panel.collapsed?40:bounds.height,zIndex:panel.order+1+(panel.alwaysOnTop?100001:0)}} aria-label={title(panel)}>
      <header className="canvas-panel-header"><button className="canvas-panel-move" aria-label={`Move ${title(panel)}`} title="Drag to move. Arrow keys move; Shift + arrows resize." disabled={arranging} onPointerDown={event=>move(event,panel)} onKeyDown={event=>{const delta=event.key==='ArrowLeft'?[-8,0]:event.key==='ArrowRight'?[8,0]:event.key==='ArrowUp'?[0,-8]:event.key==='ArrowDown'?[0,8]:null;if(!delta||arranging)return;event.preventDefault();event.stopPropagation();const next=reachableBounds(event.shiftKey?{...bounds,width:bounds.width+delta[0],height:bounds.height+delta[1]}:{...bounds,x:bounds.x+delta[0],y:bounds.y+delta[1]});run(()=>updatePanel(panel,{bounds:next}));}}><GripHorizontal size={13}/><strong>{title(panel)}</strong></button>
       <button className="icon-button canvas-panel-pin" aria-label={`${panel.alwaysOnTop?'Unpin':'Pin'} ${title(panel)}`} aria-pressed={panel.alwaysOnTop} title={panel.alwaysOnTop?'Allow other panels above this panel':'Keep this panel above other panels'} onClick={()=>run(()=>updatePanel(panel,{alwaysOnTop:!panel.alwaysOnTop}))}><Pin size={13}/></button>
       <button className="icon-button" aria-label={`${panel.collapsed?'Expand':'Collapse'} ${title(panel)}`} onClick={()=>run(()=>updatePanel(panel,{collapsed:!panel.collapsed}))}>{panel.collapsed?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button><button className="icon-button" aria-label={`Hide ${title(panel)}`} title="Hide panel" onClick={()=>run(()=>updatePanel(panel,{visible:false}))}><EyeOff size={13}/></button>
      </header>
      {!panel.collapsed&&parentTitle&&<div className="canvas-parent-label">{thread?.kind==='delegate'?'Subagent':'Side chat'} <span>· {parentTitle}</span></div>}
      {(keep||!panel.collapsed)&&(visible||keep)&&<div className="canvas-panel-body" inert={!visible||panel.collapsed} style={!visible||panel.collapsed?{visibility:'hidden'}:undefined}>{renderBody(panel,visible&&!panel.collapsed)}</div>}
      {!panel.collapsed&&<button className="canvas-panel-resize" aria-label={`Resize ${title(panel)}`} disabled={arranging} title="Drag to resize; Shift + arrow keys on the move handle also resize" onPointerDown={event=>move(event,panel,true)}><Maximize2 size={11}/></button>}
     </section>;
    })}
   </div>
   {!embedded&&!visiblePanels.length&&<div className="canvas-empty"><strong>{canvas.preset==='all-agents'?'No active conversations':'Arrange your workspace'}</strong><p>{canvas.preset==='all-agents'?'Active and pinned chats appear here, grouped by project. Choose All history to see earlier work.':'Add a panel from Panels to begin.'}</p></div>}
  </div>
 </section>;
}

