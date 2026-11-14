import {useCallback,useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type DragEvent,type KeyboardEvent,type PointerEvent as ReactPointerEvent,type ReactNode} from 'react';
import type {SurfaceRef} from '../../../packages/contracts/workspace.ts';
import type {SplitDropEdge,SplitWorkspaceLayout,SplitWorkspaceNode} from '../../../packages/contracts/split-workspace.ts';
import {minimumSplitSize,minimumViewSize,splitDropEdge,splitPaneIds} from '../../../packages/core/split-workspace-layout.ts';
import {MoreHorizontal} from 'lucide-react';
import {ActionMenu} from '../../../packages/ui-shell/ActionMenu';
import {Select} from '../../../packages/ui-shell/Select';
import './workspace-split.css';

export const GEN_THREAD_DRAG_TYPE='application/x-gen-thread';
export const GEN_VIEW_DRAG_TYPE='application/x-gen-workspace-view';
export interface WorkspaceSplitLayoutProps {
 layout:SplitWorkspaceLayout;
 onCommand:(type:string,payload:Record<string,unknown>)=>Promise<unknown>;
 renderView:(view:SurfaceRef,active:boolean)=>ReactNode;
 title?:(view:SurfaceRef)=>string;
 onDropThread?:(threadId:string,paneId:string,edge:SplitDropEdge,outer?:boolean)=>Promise<void>;
 editorOptions?:{id:string;title:string}[];
 onSelectEditor?:(kind:string,paneId:string)=>Promise<void>;
 prepare?:()=>Promise<void>;
 showHistory?:boolean;
 toolDock?:boolean;
 className?:string;
}
interface SlotRect {left:number;top:number;width:number;height:number}
interface ResizeGesture {pointerId:number;splitId:string;axis:'horizontal'|'vertical';start:number;span:number;ratio:number;minimum:number;maximum:number;revision:number;element:HTMLElement}
interface CornerGesture {pointerId:number;paneId:string;x:number;y:number;element:HTMLElement;revision:number}
const edgeLabel:Record<SplitDropEdge,string>={left:'Left',right:'Side by side',top:'Above',bottom:'Below',center:'Open as tab'};
const defaultTitle=(view:SurfaceRef)=>view.kind==='thread'?'Conversation':view.kind.replaceAll('-',' ');

/** View bodies keep one stable DOM parent; layout changes only reposition their slots. */
export function WorkspaceSplitLayout({layout,onCommand,renderView,title=defaultTitle,onDropThread,editorOptions=[],onSelectEditor,prepare,toolDock=false,className=''}:WorkspaceSplitLayoutProps){
 const root=useRef<HTMLDivElement>(null),slots=useRef(new Map<string,HTMLDivElement>()),resize=useRef<ResizeGesture|null>(null),corner=useRef<CornerGesture|null>(null),pending=useRef(false);
 const[rects,setRects]=useState<Record<string,SlotRect>>({}),[size,setSize]=useState({width:0,height:0}),[previewRatio,setPreviewRatio]=useState<{id:string;ratio:number}|null>(null),[drop,setDrop]=useState<{paneId:string;edge:SplitDropEdge;outer?:boolean;joinFrom?:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[menuPane,setMenuPane]=useState<string|null>(null);
 const minimum=minimumSplitSize(layout),narrow=size.width>0&&(size.width<minimum.width||(toolDock?size.height<minimum.height:size.width<700)),topBar=narrow?30:0;
 useEffect(()=>{if(menuPane&&(!layout.panes[menuPane]||layout.panes[menuPane].collapsed||narrow&&layout.focusedPaneId!==menuPane))setMenuPane(null);},[menuPane,layout.panes,layout.focusedPaneId,narrow]);
 const measure=useCallback(()=>{
  const host=root.current;if(!host)return;const basis=host.getBoundingClientRect(),next:Record<string,SlotRect>={};
  for(const[id,slot]of slots.current){const rect=slot.getBoundingClientRect();next[id]={left:rect.left-basis.left,top:rect.top-basis.top,width:rect.width,height:rect.height};}
  setSize(current=>current.width===basis.width&&current.height===basis.height?current:{width:basis.width,height:basis.height});
  setRects(current=>JSON.stringify(current)===JSON.stringify(next)?current:next);
 },[]);
 useLayoutEffect(()=>{measure();const observer=new ResizeObserver(measure);if(root.current)observer.observe(root.current);for(const slot of slots.current.values())observer.observe(slot);return()=>observer.disconnect();},[layout.root,layout.panes,narrow,previewRatio,measure]);
 const run=useCallback(async(action:()=>Promise<unknown>,flush=true)=>{
  if(pending.current)return;pending.current=true;
  // Busy controls go :disabled, which drops their focus to <body>; restore it
  // to the element that was focused when the action began once busy clears.
  const focusHost=document.activeElement instanceof HTMLElement?document.activeElement:null;
  setBusy(true);setError('');
  try{if(flush)await prepare?.();await action();}catch(cause){setError(cause instanceof Error?cause.message:'The layout could not be saved. Your views are retained.');}
  finally{pending.current=false;setBusy(false);setDrop(null);if(focusHost)requestAnimationFrame(()=>{if(document.activeElement===document.body&&focusHost.isConnected)focusHost.focus({preventScroll:true});});}
 },[prepare]);
 const send=(type:string,payload:Record<string,unknown>,flush=true)=>run(()=>onCommand(type,{...payload,baseRevision:layout.revision}),flush);
 const cancel=useCallback(()=>{resize.current=null;corner.current=null;setPreviewRatio(null);setDrop(null);},[]);
 useEffect(()=>{const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'&&(resize.current||corner.current||drop)){event.preventDefault();cancel();}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[cancel,drop]);
 useEffect(()=>{cancel();},[layout.id,cancel]);
 const fitSplit=(paneId:string,edge:SplitDropEdge,outer=false,incoming?:SurfaceRef|'thread')=>{
  const slot=outer?{width:size.width,height:size.height-topBar}:rects[paneId];if(!slot)return false;const pane=layout.panes[paneId],view=pane?.activeViewId?layout.views[pane.activeViewId]:undefined,minimum=outer?minimumSplitSize(layout):minimumViewSize(view),horizontal=edge==='left'||edge==='right';
  const added=incoming==='thread'?{width:320,height:220}:minimumViewSize(incoming);
  return horizontal?slot.width>=minimum.width+added.width+6:slot.height>=minimum.height+added.height+6;
 };
 const splitPane=(paneId:string,edge:SplitDropEdge='right',view?:SurfaceRef,outer=false)=>{
  if(!fitSplit(paneId,edge,outer,view)){setError('Make this area larger before splitting it.');return Promise.resolve();}
  return send('pane.split',{paneId,newPaneId:'pane-'+crypto.randomUUID(),splitId:'split-'+crypto.randomUUID(),axis:edge==='left'||edge==='right'?'horizontal':'vertical',before:edge==='left'||edge==='top',...(view?{view}:{}),...(outer?{outer:true}:{})});
 };
 const locateDrop=(event:DragEvent<HTMLDivElement>)=>{
  const host=root.current;if(!host)return null;const box=host.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
  const entry=Object.entries(rects).find(([paneId,rect])=>(!narrow||paneId===layout.focusedPaneId)&&rect.width>0&&rect.height>0&&x>=rect.left&&x<=rect.left+rect.width&&y>=rect.top-36&&y<=rect.top+rect.height);
  if(!entry)return null;const[paneId,rect]=entry,outerEdge:SplitDropEdge|undefined=!narrow?(x<16?'left':x>box.width-16?'right':y>box.height-16?'bottom':y<topBar+20?'top':undefined):undefined;return{paneId,edge:outerEdge??splitDropEdge({x:x-rect.left,y:y-rect.top,width:rect.width,height:rect.height}),...(outerEdge?{outer:true}:{})};
 };
 const recognized=(event:DragEvent)=>Array.from(event.dataTransfer.types).some(type=>type===GEN_THREAD_DRAG_TYPE||type===GEN_VIEW_DRAG_TYPE);
 const dragOver=(event:DragEvent<HTMLDivElement>)=>{if(!recognized(event))return;event.preventDefault();event.dataTransfer.dropEffect='move';setDrop(locateDrop(event));};
 const dropView=(event:DragEvent<HTMLDivElement>)=>{
  if(!recognized(event))return;event.preventDefault();const destination=locateDrop(event);setDrop(null);if(!destination)return;
  const{paneId,edge,outer}=destination;
  try{
   const own=event.dataTransfer.getData(GEN_VIEW_DRAG_TYPE);
   if(own){const value=JSON.parse(own) as {workspaceId?:string;viewId?:string;revision?:number};if(value.workspaceId!==layout.id||value.revision!==layout.revision||!value.viewId||!Object.hasOwn(layout.views,value.viewId))throw Error('The dragged view changed. Pick it up again.');const view=layout.views[value.viewId]!;if(edge==='center')void send('view.move',{viewId:view.id,paneId});else void splitPane(paneId,edge,view,outer);return;}
   const raw=event.dataTransfer.getData(GEN_THREAD_DRAG_TYPE);let threadId:string;try{const value=JSON.parse(raw) as {threadId?:unknown;binding?:{authority?:{kind?:unknown};threadId?:unknown}};if(typeof value.threadId!=='string'||value.binding&&value.binding.authority?.kind!=='local'||value.binding?.threadId!==undefined&&value.binding.threadId!==value.threadId)throw Error();threadId=value.threadId;}catch{if(/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$/.test(raw))threadId=raw;else throw Error('Drag an existing local conversation from the sidebar.');}
   if(!onDropThread)throw Error('Conversation placement is unavailable in this workspace.');
   if(edge!=='center'&&!fitSplit(paneId,edge,outer,'thread'))throw Error('Make this area larger before splitting it.');
   void run(()=>onDropThread(threadId,paneId,edge,outer));
  }catch(cause){setError(cause instanceof Error?cause.message:'This view could not be placed.');}
 };
 const beginResize=(event:ReactPointerEvent<HTMLDivElement>,node:Extract<SplitWorkspaceNode,{kind:'split'}>)=>{
  if(event.button!==0||busy)return;const region=event.currentTarget.parentElement?.getBoundingClientRect();if(!region)return;const horizontal=node.axis==='horizontal',span=(horizontal?region.width:region.height)-6,first=minimumSplitSize(layout,node.first),second=minimumSplitSize(layout,node.second),low=(horizontal?first.width:first.height)/span,high=1-(horizontal?second.width:second.height)/span;if(low>high)return;
  event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);resize.current={pointerId:event.pointerId,splitId:node.id,axis:node.axis,start:horizontal?event.clientX:event.clientY,span,ratio:node.ratio,minimum:Math.max(.05,low),maximum:Math.min(.95,high),revision:layout.revision,element:event.currentTarget};setPreviewRatio({id:node.id,ratio:node.ratio});
 };
 const moveResize=(event:ReactPointerEvent<HTMLDivElement>)=>{const gesture=resize.current;if(!gesture||gesture.pointerId!==event.pointerId)return;const delta=((gesture.axis==='horizontal'?event.clientX:event.clientY)-gesture.start)/gesture.span;setPreviewRatio({id:gesture.splitId,ratio:Math.max(gesture.minimum,Math.min(gesture.maximum,gesture.ratio+delta))});};
 const endResize=(event:ReactPointerEvent<HTMLDivElement>)=>{const gesture=resize.current;if(!gesture||gesture.pointerId!==event.pointerId)return;resize.current=null;const ratio=previewRatio?.id===gesture.splitId?previewRatio.ratio:gesture.ratio;setPreviewRatio(null);void run(()=>onCommand('pane.resize',{splitId:gesture.splitId,ratio,baseRevision:gesture.revision}),false);};
 const keyResize=(event:KeyboardEvent<HTMLDivElement>,node:Extract<SplitWorkspaceNode,{kind:'split'}>)=>{
  const direction=node.axis==='horizontal'?event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0:event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0;if(!direction&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();const rect=event.currentTarget.parentElement?.getBoundingClientRect();if(!rect)return;const span=(node.axis==='horizontal'?rect.width:rect.height)-6,first=minimumSplitSize(layout,node.first),second=minimumSplitSize(layout,node.second),low=Math.max(.05,(node.axis==='horizontal'?first.width:first.height)/span),high=Math.min(.95,1-(node.axis==='horizontal'?second.width:second.height)/span);if(low>high)return;const ratio=event.key==='Home'?low:event.key==='End'?high:Math.max(low,Math.min(high,node.ratio+direction*(event.shiftKey?.05:.01)));void send('pane.resize',{splitId:node.id,ratio},false);
 };
 const beginCorner=(event:ReactPointerEvent<HTMLButtonElement>,paneId:string)=>{if(event.button!==0||busy)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);corner.current={pointerId:event.pointerId,paneId,x:event.clientX,y:event.clientY,element:event.currentTarget,revision:layout.revision};};
 const moveCorner=(event:ReactPointerEvent<HTMLButtonElement>)=>{const gesture=corner.current;if(!gesture||gesture.pointerId!==event.pointerId)return;const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;if(Math.hypot(dx,dy)<16)return;const basis=root.current?.getBoundingClientRect(),other=basis&&Object.entries(rects).find(([paneId,rect])=>paneId!==gesture.paneId&&event.clientX>=basis.left+rect.left&&event.clientX<=basis.left+rect.left+rect.width&&event.clientY>=basis.top+rect.top&&event.clientY<=basis.top+rect.top+rect.height);setDrop(other?{paneId:other[0],edge:'center',joinFrom:gesture.paneId}:{paneId:gesture.paneId,edge:Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'bottom':'top'});};
 const endCorner=(event:ReactPointerEvent<HTMLButtonElement>)=>{const gesture=corner.current;if(!gesture||gesture.pointerId!==event.pointerId)return;corner.current=null;const target=drop;setDrop(null);if(target&&gesture.revision===layout.revision){if(target.joinFrom)void send('pane.join',{paneId:target.joinFrom,targetPaneId:target.paneId});else void splitPane(gesture.paneId,target.edge);}};
 const renderPane=(paneId:string)=>{
  const pane=layout.panes[paneId]!,current=pane.activeViewId?layout.views[pane.activeViewId]:undefined;
  return <section key={paneId} className={`split-pane${pane.collapsed?' is-collapsed':''}${layout.focusedPaneId===paneId?' is-focused':''}`} data-split-pane={paneId} aria-label={current?title(current):'Empty area'}>
    <header className="split-pane-header" onPointerDown={event=>{if(!(event.target as HTMLElement).closest('button,summary,select')&&!busy&&layout.focusedPaneId!==paneId)void send('pane.focus',{paneId},false);}}>
    <button className="split-corner" aria-label="Split this area" title="Drag to split. Use the area menu for keyboard actions." disabled={busy} onPointerDown={event=>beginCorner(event,paneId)} onPointerMove={moveCorner} onPointerUp={endCorner} onPointerCancel={cancel} onLostPointerCapture={()=>{if(corner.current)cancel();}} onContextMenu={event=>{event.preventDefault();cancel();}}>◩</button>
    <div className="split-tab-strip" role="tablist" aria-label="Area views">{pane.viewIds.map(viewId=><button key={viewId} role="tab" aria-selected={pane.activeViewId===viewId} draggable={!busy} onDragStart={event=>{event.dataTransfer.setData(GEN_VIEW_DRAG_TYPE,JSON.stringify({workspaceId:layout.id,viewId,revision:layout.revision}));event.dataTransfer.effectAllowed='move';}} onClick={()=>{void send('view.activate',{paneId,viewId});}}>{title(layout.views[viewId]!)}</button>)}</div>
    <div className="split-area-controls"><ActionMenu label="Area actions" icon={<MoreHorizontal size={16} aria-hidden="true"/>} iconOnly open={menuPane===paneId} onOpenChange={open=>setMenuPane(open?paneId:null)} disabled={busy} items={[
     {id:'split-columns',label:'Split left / right',disabled:busy||narrow,onSelect:()=>{void splitPane(paneId,'right');}},
     {id:'split-rows',label:'Split above / below',disabled:busy||narrow,onSelect:()=>{void splitPane(paneId,'bottom');}},
     {id:'join',label:'Join adjacent area',disabled:busy||Object.keys(layout.panes).length<2,onSelect:()=>{void send('pane.join',{paneId});}},
     ...(current?[{id:'park',label:'Park current view',disabled:busy,onSelect:()=>{void send('view.park',{viewId:current.id});}}]:[]),
     ...(onSelectEditor?editorOptions.map(option=>({id:`editor:${option.id}`,label:`Editor: ${option.title}`,disabled:busy,onSelect:()=>{void run(()=>onSelectEditor(option.id,paneId));}})):[]),
     ...layout.parkedViewIds.map(viewId=>({id:`recover:${viewId}`,label:`Recover: ${title(layout.views[viewId]!)}`,disabled:busy,onSelect:()=>{void send('view.move',{viewId,paneId});}})),
    ]}/></div>
    <button className="split-collapse" disabled={busy} aria-label={pane.collapsed?'Restore area':'Minimize area'} title={pane.collapsed&&current?title(current):undefined} aria-expanded={!pane.collapsed} onClick={()=>{void send('pane.collapse',{paneId,collapsed:!pane.collapsed},false);}}>{pane.collapsed?<><span aria-hidden="true">▾</span><span className="split-collapsed-title">{current?title(current):'Empty area'}</span></>:'▴'}</button>
   </header>
   {!pane.collapsed&&<div className="split-pane-slot" ref={node=>{if(node)slots.current.set(paneId,node);else slots.current.delete(paneId);}}>{!current&&<div className="split-empty"><strong>{onDropThread?'Drag a thread here':'Add a tool'}</strong><span>{onDropThread?'Drop at an edge to split, or in the middle to add a tab.':'Choose a tool from Panels or the area menu. Split its area to arrange tools together.'}</span></div>}</div>}
  </section>;
 };
 const renderNode=(node:SplitWorkspaceNode):ReactNode=>{
  if(node.kind==='pane')return renderPane(node.paneId);const ratio=previewRatio?.id===node.id?previewRatio.ratio:node.ratio,firstCollapsed=splitPaneIds(node.first).every(id=>layout.panes[id]!.collapsed),secondCollapsed=splitPaneIds(node.second).every(id=>layout.panes[id]!.collapsed),style={'--split-ratio':ratio,...(firstCollapsed!==secondCollapsed?{[node.axis==='horizontal'?'gridTemplateColumns':'gridTemplateRows']:firstCollapsed?'36px 6px minmax(0,1fr)':'minmax(0,1fr) 6px 36px'}:{})} as CSSProperties;
  return <div key={node.id} className={`split-node split-${node.axis}`} style={style}>{renderNode(node.first)}<div role="separator" tabIndex={0} aria-label={`Resize ${node.axis==='horizontal'?'columns':'rows'}`} aria-orientation={node.axis==='horizontal'?'vertical':'horizontal'} aria-valuenow={Math.round(ratio*100)} aria-valuemin={5} aria-valuemax={95} className={`split-divider${previewRatio?.id===node.id?' is-dragging':''}`} onPointerDown={event=>beginResize(event,node)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={cancel} onLostPointerCapture={()=>{if(resize.current)cancel();}} onContextMenu={event=>{event.preventDefault();cancel();}} onKeyDown={event=>keyResize(event,node)}>{previewRatio?.id===node.id&&<span>{Math.round(ratio*100)}% {node.axis==='horizontal'?'width':'height'}</span>}</div>{renderNode(node.second)}</div>;
 };
 const visibleOwner=new Map<string,string>();for(const pane of Object.values(layout.panes))if(!pane.collapsed&&pane.activeViewId&&(!narrow||pane.id===layout.focusedPaneId))visibleOwner.set(pane.activeViewId,pane.id);
 const overlay=drop?rects[drop.paneId]:undefined;
 return <div ref={root} className={`split-workspace${narrow?' is-narrow':''} ${className}`} data-workspace-id={layout.id} aria-busy={busy} onPointerDownCapture={event=>{const paneId=(event.target as HTMLElement).closest<HTMLElement>('[data-split-view]')?.dataset.paneId;if(paneId&&paneId!==layout.focusedPaneId&&!busy)void send('pane.focus',{paneId},false);}} onDragOver={dragOver} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDrop(null);}} onDrop={dropView}>
  {narrow&&<div className="split-workspace-tools"><label>Area<Select aria-label="Active workspace area" value={layout.focusedPaneId} disabled={busy} onValueChange={paneId=>{void send('pane.focus',{paneId},false);}} options={splitPaneIds(layout.root).map(paneId=>{const viewId=layout.panes[paneId]!.activeViewId;return{value:paneId,label:viewId?title(layout.views[viewId]!):'Empty area'};})}/></label></div>}
  {error&&<p role="alert" className="split-layout-error">{error}<button onClick={()=>setError('')}>Dismiss</button></p>}
  <div className="split-tree">{narrow?renderPane(layout.focusedPaneId):renderNode(layout.root)}</div>
  <div className="split-surface-plane">{Object.values(layout.views).map(view=>{const paneId=visibleOwner.get(view.id),slot=paneId?rects[paneId]:undefined,active=Boolean(slot&&slot.width>0&&slot.height>0);return <div key={view.id} className="split-surface" data-split-view={view.id} data-pane-id={paneId} style={active?{left:slot!.left,top:slot!.top,width:slot!.width,height:slot!.height}:{display:'none'}} inert={!active} aria-hidden={!active}>{renderView(view,active)}</div>;})}</div>
  {drop&&overlay&&<div className={`split-drop-preview edge-${drop.edge}`} style={drop.outer?{left:0,top:topBar,width:size.width,height:size.height-topBar}:{left:overlay.left,top:overlay.top,width:overlay.width,height:overlay.height}}><span>{drop.joinFrom?'Join into this area':edgeLabel[drop.edge]}</span></div>}
 </div>;
}
