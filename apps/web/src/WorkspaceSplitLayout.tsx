import {useCallback,useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type DragEvent,type KeyboardEvent,type PointerEvent as ReactPointerEvent,type ReactNode} from 'react';
import type {SurfaceRef} from '../../../packages/contracts/workspace.ts';
import type {SplitDropEdge,SplitWorkspaceLayout,SplitWorkspaceNode} from '../../../packages/contracts/split-workspace.ts';
import {minimumSplitSize,minimumViewSize,splitDropEdge,splitPaneIds} from '../../../packages/core/split-workspace-layout.ts';
import {resolveMainPaneId} from './conversation-placement.ts';
import {chatBounds,clampChatRect,type ChatRect,type ChatViewport} from '../../../packages/ui-shell/chat-layout.ts';
import {GripVertical,MoreHorizontal} from 'lucide-react';
import {ActionMenu} from '../../../packages/ui-shell/ActionMenu';
import {Popover} from '../../../packages/ui-shell/Popover';
import {Select} from '../../../packages/ui-shell/Select';
import './workspace-split.css';

export const GEN_THREAD_DRAG_TYPE='application/x-gen-thread';
export const GEN_VIEW_DRAG_TYPE='application/x-gen-workspace-view';
export interface WorkspaceSplitLayoutProps {
 layout:SplitWorkspaceLayout;
 onCommand:(type:string,payload:Record<string,unknown>)=>Promise<unknown>;
 renderView:(view:SurfaceRef,active:boolean)=>ReactNode;
 onActiveViewsChange?:(workspaceId:string,viewIds:string[])=>void;
 title?:(view:SurfaceRef)=>string;
 onDropThread?:(threadId:string,paneId:string,edge:SplitDropEdge,outer?:boolean)=>Promise<void>;
 editorOptions?:{id:string;title:string}[];
 onSelectEditor?:(kind:string,paneId:string)=>Promise<void>;
 prepare?:()=>Promise<void>;
 showHistory?:boolean;
 toolDock?:boolean;
 className?:string;
 floating?:Record<string,ChatRect>;
 onReturnFloat?:(view:SurfaceRef)=>void;
 onDetachView?:(view:SurfaceRef,rect?:ChatRect)=>void;
 onMoveFloat?:(viewId:string,rect:ChatRect)=>void;
 onDockFloat?:(view:SurfaceRef,paneId:string,edge:SplitDropEdge,outer?:boolean)=>void;
 emptyMainPaneId?:string;
}
interface SlotRect {left:number;top:number;width:number;height:number}
interface ResizeGesture {pointerId:number;splitId:string;axis:'horizontal'|'vertical';start:number;span:number;ratio:number;minimum:number;maximum:number;revision:number;element:HTMLElement}
interface CornerGesture {pointerId:number;paneId:string;x:number;y:number;element:HTMLElement;revision:number}
const edgeLabel:Record<SplitDropEdge,string>={left:'Left',right:'Side by side',top:'Above',bottom:'Below',center:'Open as tab'};
const defaultTitle=(view:SurfaceRef)=>view.kind==='thread'?'Conversation':view.kind.replaceAll('-',' ');

function keepFloatVisible(rect:ChatRect,viewport:ChatViewport):ChatRect{
 if(viewport.width<=0||viewport.height<=0)return rect;const bounds=chatBounds(viewport);
 // Keep rects a move drag could admit (64px leftward slack on edge-filling
 // floats, matching clampChatRect); only project placements beyond that.
 const slack=64,availW=bounds.right-bounds.left,availH=bounds.bottom-bounds.top,sx=rect.width>=availW?slack:0;
 const minX=Math.min(bounds.left,bounds.right-rect.width),maxX=Math.max(bounds.left,bounds.right-rect.width),minY=Math.min(bounds.top,bounds.bottom-rect.height),maxY=Math.max(bounds.top,bounds.bottom-rect.height);
 return rect.width<=availW&&rect.height<=availH&&rect.x>=minX-sx&&rect.x<=maxX&&rect.y>=minY&&rect.y<=maxY?rect:clampChatRect(rect,viewport);
}

/** View bodies keep one stable DOM parent; layout changes only reposition their slots. */
export function WorkspaceSplitLayout({layout,onCommand,renderView,onActiveViewsChange,title=defaultTitle,onDropThread,editorOptions=[],onSelectEditor,prepare,toolDock=false,className='',floating,onReturnFloat,onDetachView,onMoveFloat,onDockFloat,emptyMainPaneId}:WorkspaceSplitLayoutProps){
 const root=useRef<HTMLDivElement>(null),slots=useRef(new Map<string,HTMLDivElement>()),resize=useRef<ResizeGesture|null>(null),corner=useRef<CornerGesture|null>(null),pending=useRef(false),draggingView=useRef<SurfaceRef|null>(null);
 const[rects,setRects]=useState<Record<string,SlotRect>>({}),[size,setSize]=useState({width:0,height:0}),[previewRatio,setPreviewRatio]=useState<{id:string;ratio:number}|null>(null),[drop,setDrop]=useState<{paneId:string;edge:SplitDropEdge;outer?:boolean;joinFrom?:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[menuPane,setMenuPane]=useState<string|null>(null);
 const[floatRects,setFloatRects]=useState<Record<string,ChatRect>>({});
 const[floatMenu,setFloatMenu]=useState<string|null>(null),[dockedPreview,setDockedPreview]=useState<string|null>(null);
 const floatDragged=useRef(false);
 const floatGripAnchor=useRef<HTMLElement|null>(null),floatMenuContent=useRef<HTMLDivElement|null>(null),floatMenuItem=useRef<HTMLButtonElement|null>(null);
 const dockedFloatCleanup=useRef<(()=>void)|null>(null);
 const floatGesture=useRef<{viewId:string;mode:'move'|'resize';pointerId:number;startX:number;startY:number;startRect:ChatRect;element:HTMLElement;el:HTMLElement|null;rect:ChatRect;docked?:SurfaceRef;sourceRect?:ChatRect}|null>(null);
 const floatRectOf=(viewId:string)=>{const rect=floatRects[viewId]??floating?.[viewId];return rect?keepFloatVisible(rect,size):undefined;};
 const floatSurfaceEl=(g:NonNullable<typeof floatGesture.current>)=>{if(!g.el){for(const node of root.current?.querySelectorAll<HTMLElement>('.split-surface')??[])if(node.dataset.splitView===g.viewId){g.el=node;break;}}return g.el;};
 const paintFloatRect=(el:HTMLElement,rect:ChatRect)=>{el.style.left=`${rect.x}px`;el.style.top=`${rect.y}px`;el.style.width=`${rect.width}px`;el.style.height=`${rect.height}px`;};
 const releaseFloat=useCallback(()=>{const g=floatGesture.current;floatGesture.current=null;if(g&&g.element.hasPointerCapture?.(g.pointerId))g.element.releasePointerCapture(g.pointerId);dockedFloatCleanup.current?.();dockedFloatCleanup.current=null;},[]);
 const cancelFloat=useCallback(()=>{const g=floatGesture.current;if(!g)return;setDrop(null);releaseFloat();if(g.el){const viewport=root.current?.getBoundingClientRect();paintFloatRect(g.el,!g.docked&&viewport?keepFloatVisible(g.sourceRect??g.startRect,{width:viewport.width,height:viewport.height}):g.startRect);}setDockedPreview(null);if(g.docked)setFloatRects(current=>{const next={...current};delete next[g.viewId];return next;});},[releaseFloat]);
 useLayoutEffect(()=>{cancelFloat();},[layout.id,layout.revision,size.width,size.height,cancelFloat]);
 const beginFloat=(event:ReactPointerEvent<HTMLElement>,viewId:string,mode:'move'|'resize')=>{if(event.button!==0||event.isPrimary===false||busy||pending.current||floatGesture.current||resize.current||corner.current)return;const sourceRect=floatRects[viewId]??floating?.[viewId],rect=floatRectOf(viewId);if(!sourceRect||!rect)return;floatDragged.current=false;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);floatGesture.current={viewId,mode,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,startRect:rect,element:event.currentTarget,el:event.currentTarget.closest('.split-surface'),rect,sourceRect};};
 // Preview a docked drag without writing placement until the owning release.
 const beginDockedFloat=(event:ReactPointerEvent<HTMLElement>,view:SurfaceRef,paneId:string)=>{if(!onDetachView||event.button!==0||event.isPrimary===false||busy||pending.current||floatGesture.current||resize.current||corner.current)return;event.preventDefault();floatDragged.current=false;const slot=rects[paneId],startRect:ChatRect=slot?{x:slot.left,y:slot.top,width:slot.width,height:slot.height}:clampChatRect({x:48,y:48,width:480,height:680},{width:size.width,height:size.height});event.currentTarget.setPointerCapture(event.pointerId);floatGesture.current={viewId:view.id,mode:'move',pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,startRect,element:event.currentTarget,el:null,rect:startRect,docked:view};const asReact=(e:globalThis.PointerEvent)=>e as unknown as ReactPointerEvent<HTMLElement>;const move=(e:globalThis.PointerEvent)=>moveFloat(asReact(e)),up=(e:globalThis.PointerEvent)=>{if(floatGesture.current?.pointerId!==e.pointerId)return;releaseDocked();endFloat(asReact(e));},cancel=(e:globalThis.PointerEvent)=>{if(floatGesture.current?.pointerId!==e.pointerId)return;releaseDocked();cancelFloat();},releaseDocked=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);};dockedFloatCleanup.current=releaseDocked;window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);};
 const moveFloat=(event:ReactPointerEvent<HTMLElement>)=>{const g=floatGesture.current;if(!g||g.pointerId!==event.pointerId)return;const dx=event.clientX-g.startX,dy=event.clientY-g.startY;if(g.mode==='move'&&Math.hypot(dx,dy)<3)return;const firstDockedMove=g.docked&&!floatDragged.current;floatDragged.current=true;if(g.mode==='move'&&onDockFloat){const target=locateDropAt(event.clientX,event.clientY);const dockable=target&&target.edge!=='center'&&fitSplit(target.paneId,target.edge,target.outer,layout.views[g.viewId])?target:null;setDrop(dockable);}const next=g.mode==='move'?{...g.startRect,x:g.startRect.x+dx,y:g.startRect.y+dy}:{...g.startRect,width:g.startRect.width+dx,height:g.startRect.height+dy};g.rect=clampChatRect(next,{width:size.width,height:size.height},g.mode==='move'?64:0);if(firstDockedMove){setFloatRects(current=>({...current,[g.viewId]:g.rect}));setDockedPreview(g.viewId);}const el=floatSurfaceEl(g);if(el)paintFloatRect(el,g.rect);};
 const endFloat=(event:ReactPointerEvent<HTMLElement>)=>{
  const g=floatGesture.current;if(!g||g.pointerId!==event.pointerId)return;const dx=event.clientX-g.startX,dy=event.clientY-g.startY,moved=g.mode==='resize'?(dx!==0||dy!==0):floatDragged.current||Math.hypot(dx,dy)>=3;
  const target=g.mode==='move'&&moved&&onDockFloat?locateDropAt(event.clientX,event.clientY):null,dock=target&&target.edge!=='center'&&fitSplit(target.paneId,target.edge,target.outer,layout.views[g.viewId])?target:null;setDrop(null);
  const next=g.mode==='move'?{...g.startRect,x:g.startRect.x+dx,y:g.startRect.y+dy}:{...g.startRect,width:g.startRect.width+dx,height:g.startRect.height+dy},rect=moved?clampChatRect(next,{width:size.width,height:size.height},g.mode==='move'?64:0):g.startRect;floatDragged.current=moved;if(!g.docked&&!moved){cancelFloat();return;}releaseFloat();
  if(g.docked){if(!moved)return;const view=g.docked;setFloatRects(current=>({...current,[view.id]:rect}));setDockedPreview(view.id);if(g.el)paintFloatRect(g.el,rect);void run(async()=>{try{if(dock&&onDockFloat)await onDockFloat(view,dock.paneId,dock.edge,dock.outer);else await onDetachView?.(view,rect);}finally{setDockedPreview(null);setFloatRects(current=>{const next={...current};delete next[view.id];return next;});}},false);return;}
  if(dock&&onDockFloat){const view=layout.views[g.viewId];if(view)void run(()=>Promise.resolve(onDockFloat(view,dock.paneId,dock.edge,dock.outer)),false);return;}
  if(g.el&&moved)paintFloatRect(g.el,rect);setFloatRects(current=>({...current,[g.viewId]:rect}));onMoveFloat?.(g.viewId,rect);
 };
 const keyFloat=(event:KeyboardEvent<HTMLElement>,viewId:string)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;const rect=floatRectOf(viewId);if(!rect)return;event.preventDefault();const step=event.shiftKey?24:8,dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;const next=clampChatRect({...rect,x:rect.x+dx,y:rect.y+dy},{width:size.width,height:size.height});setFloatRects(current=>({...current,[viewId]:next}));onMoveFloat?.(viewId,next);};
 useEffect(()=>{const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'){if(floatGesture.current){event.preventDefault();cancelFloat();}setFloatMenu(null);}};const blur=()=>{cancelFloat();setFloatMenu(null);};window.addEventListener('keydown',escape);window.addEventListener('blur',blur);return()=>{window.removeEventListener('keydown',escape);window.removeEventListener('blur',blur);cancelFloat();};},[cancelFloat]);
 const minimum=minimumSplitSize(layout),narrow=size.width>0&&(size.width<minimum.width||(toolDock?size.height<minimum.height:size.width<700)),topBar=narrow?30:0;
 const mainPaneId=resolveMainPaneId(layout);
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
 const cancel=useCallback(()=>{for(const gesture of [resize.current,corner.current]){if(gesture&&gesture.element.hasPointerCapture?.(gesture.pointerId))gesture.element.releasePointerCapture(gesture.pointerId);}resize.current=null;corner.current=null;setPreviewRatio(null);setDrop(null);},[]);
 useEffect(()=>{const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'&&(resize.current||corner.current||drop)){event.preventDefault();cancel();}};const blur=()=>{if(resize.current||corner.current)cancel();};window.addEventListener('keydown',escape);window.addEventListener('blur',blur);return()=>{window.removeEventListener('keydown',escape);window.removeEventListener('blur',blur);};},[cancel,drop]);
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
 const locateDropAt=(clientX:number,clientY:number)=>{
  const host=root.current;if(!host)return null;const box=host.getBoundingClientRect(),x=clientX-box.left,y=clientY-box.top;
  const entry=Object.entries(rects).find(([paneId,rect])=>(!narrow||paneId===layout.focusedPaneId)&&rect.width>0&&rect.height>0&&x>=rect.left&&x<=rect.left+rect.width&&y>=rect.top-36&&y<=rect.top+rect.height);
  if(!entry)return null;const[paneId,rect]=entry,outerEdge:SplitDropEdge|undefined=!narrow?(x<16?'left':x>box.width-16?'right':y>box.height-16?'bottom':y<topBar+20?'top':undefined):undefined;return{paneId,edge:outerEdge??splitDropEdge({x:x-rect.left,y:y-rect.top,width:rect.width,height:rect.height}),...(outerEdge?{outer:true}:{})};
 };
 const locateDrop=(event:DragEvent<HTMLDivElement>)=>locateDropAt(event.clientX,event.clientY);
 const recognized=(event:DragEvent)=>Array.from(event.dataTransfer.types).some(type=>type===GEN_THREAD_DRAG_TYPE||type===GEN_VIEW_DRAG_TYPE);
 const dragOver=(event:DragEvent<HTMLDivElement>)=>{if(!recognized(event))return;event.preventDefault();event.dataTransfer.dropEffect='move';const destination=locateDrop(event);
  // The preview must use the same minimum-fit validation as the commit: an impossible
  // edge split shows no hint (center move/join stays usable).
  if(destination&&destination.edge!=='center'){const incoming=Array.from(event.dataTransfer.types).includes(GEN_VIEW_DRAG_TYPE)?(draggingView.current??undefined):'thread';if(!fitSplit(destination.paneId,destination.edge,destination.outer,incoming)){setDrop(null);return;}}
  setDrop(destination);};
 const dropView=(event:DragEvent<HTMLDivElement>)=>{
  if(!recognized(event))return;event.preventDefault();const destination=locateDrop(event);setDrop(null);if(!destination)return;
  const{paneId,edge,outer}=destination;
  try{
   const own=event.dataTransfer.getData(GEN_VIEW_DRAG_TYPE);
   if(own){const value=JSON.parse(own) as {workspaceId?:string;viewId?:string;revision?:number};if(value.workspaceId!==layout.id||value.revision!==layout.revision||!value.viewId||!Object.hasOwn(layout.views,value.viewId))throw Error('The dragged view changed. Pick it up again.');const view=layout.views[value.viewId]!;if(edge==='center')void send('view.move',{viewId:view.id,paneId});else void splitPane(paneId,edge,view,outer);return;}
   const raw=event.dataTransfer.getData(GEN_THREAD_DRAG_TYPE);let threadId:string;try{const value=JSON.parse(raw) as {threadId?:unknown;binding?:{authority?:{kind?:unknown};threadId?:unknown}};if(typeof value.threadId!=='string'||value.binding&&value.binding.authority?.kind!=='local'||value.binding?.threadId!==undefined&&value.binding.threadId!==value.threadId)throw Error();threadId=value.threadId;}catch{if(/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$/.test(raw))threadId=raw;else throw Error('Drag an existing local conversation from the sidebar.');}
   if(!onDropThread)throw Error('Conversation placement is unavailable in this workspace.');
   if(edge!=='center'&&!fitSplit(paneId,edge,outer,'thread'))throw Error('Make this area larger before splitting it.');
   void run(()=>onDropThread(threadId,paneId,edge,outer),false);
  }catch(cause){setError(cause instanceof Error?cause.message:'This view could not be placed.');}
 };
 const beginResize=(event:ReactPointerEvent<HTMLDivElement>,node:Extract<SplitWorkspaceNode,{kind:'split'}>)=>{
  if(event.button!==0||busy||resize.current||corner.current||floatGesture.current)return;const region=event.currentTarget.parentElement?.getBoundingClientRect();if(!region)return;const horizontal=node.axis==='horizontal',span=(horizontal?region.width:region.height)-6,first=minimumSplitSize(layout,node.first),second=minimumSplitSize(layout,node.second),low=(horizontal?first.width:first.height)/span,high=1-(horizontal?second.width:second.height)/span;if(low>high)return;
  event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);resize.current={pointerId:event.pointerId,splitId:node.id,axis:node.axis,start:horizontal?event.clientX:event.clientY,span,ratio:node.ratio,minimum:Math.max(.05,low),maximum:Math.min(.95,high),revision:layout.revision,element:event.currentTarget};setPreviewRatio({id:node.id,ratio:node.ratio});
 };
 const moveResize=(event:ReactPointerEvent<HTMLDivElement>)=>{const gesture=resize.current;if(!gesture||gesture.pointerId!==event.pointerId)return;const delta=((gesture.axis==='horizontal'?event.clientX:event.clientY)-gesture.start)/gesture.span;setPreviewRatio({id:gesture.splitId,ratio:Math.max(gesture.minimum,Math.min(gesture.maximum,gesture.ratio+delta))});};
 const endResize=(event:ReactPointerEvent<HTMLDivElement>)=>{const gesture=resize.current;if(!gesture||gesture.pointerId!==event.pointerId)return;resize.current=null;const ratio=previewRatio?.id===gesture.splitId?previewRatio.ratio:gesture.ratio;setPreviewRatio(null);void run(()=>onCommand('pane.resize',{splitId:gesture.splitId,ratio,baseRevision:gesture.revision}),false);};
 const keyResize=(event:KeyboardEvent<HTMLDivElement>,node:Extract<SplitWorkspaceNode,{kind:'split'}>)=>{
  const direction=node.axis==='horizontal'?event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0:event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0;if(!direction&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();const rect=event.currentTarget.parentElement?.getBoundingClientRect();if(!rect)return;const span=(node.axis==='horizontal'?rect.width:rect.height)-6,first=minimumSplitSize(layout,node.first),second=minimumSplitSize(layout,node.second),low=Math.max(.05,(node.axis==='horizontal'?first.width:first.height)/span),high=Math.min(.95,1-(node.axis==='horizontal'?second.width:second.height)/span);if(low>high)return;const ratio=event.key==='Home'?low:event.key==='End'?high:Math.max(low,Math.min(high,node.ratio+direction*(event.shiftKey?.05:.01)));void send('pane.resize',{splitId:node.id,ratio},false);
 };
 const beginCorner=(event:ReactPointerEvent<HTMLButtonElement>,paneId:string)=>{if(event.button!==0||busy||corner.current||resize.current||floatGesture.current)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);corner.current={pointerId:event.pointerId,paneId,x:event.clientX,y:event.clientY,element:event.currentTarget,revision:layout.revision};};
 const moveCorner=(event:ReactPointerEvent<HTMLButtonElement>)=>{const gesture=corner.current;if(!gesture||gesture.pointerId!==event.pointerId)return;const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;if(Math.hypot(dx,dy)<16)return;const basis=root.current?.getBoundingClientRect(),other=basis&&Object.entries(rects).find(([paneId,rect])=>paneId!==gesture.paneId&&event.clientX>=basis.left+rect.left&&event.clientX<=basis.left+rect.left+rect.width&&event.clientY>=basis.top+rect.top&&event.clientY<=basis.top+rect.top+rect.height);if(other){setDrop({paneId:other[0],edge:'center',joinFrom:gesture.paneId});return;}const edge=Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'bottom':'top';setDrop(fitSplit(gesture.paneId,edge,false,undefined)?{paneId:gesture.paneId,edge}:null);};
 const endCorner=(event:ReactPointerEvent<HTMLButtonElement>)=>{const gesture=corner.current;if(!gesture||gesture.pointerId!==event.pointerId)return;corner.current=null;const target=drop;setDrop(null);if(target&&gesture.revision===layout.revision){if(target.joinFrom)void send('pane.join',{paneId:target.joinFrom,targetPaneId:target.paneId});else void splitPane(gesture.paneId,target.edge);}};
 const renderPane=(paneId:string)=>{
  const pane=layout.panes[paneId]!,current=pane.activeViewId?layout.views[pane.activeViewId]:undefined;
  return <section key={paneId} className={`split-pane${pane.collapsed?' is-collapsed':''}${layout.focusedPaneId===paneId?' is-focused':''}`} data-split-pane={paneId} aria-label={current?title(current):'Empty area'}>
    <header className="split-pane-header" onPointerDown={event=>{if(!(event.target as HTMLElement).closest('button,summary,select')&&!busy&&layout.focusedPaneId!==paneId)void send('pane.focus',{paneId},false);}}>
    <button className="split-corner" aria-label="Split this area" title="Drag to split. Use the area menu for keyboard actions." disabled={busy} onPointerDown={event=>beginCorner(event,paneId)} onPointerMove={moveCorner} onPointerUp={endCorner} onPointerCancel={event=>{if(corner.current?.pointerId===event.pointerId)cancel();}} onLostPointerCapture={event=>{if(corner.current?.pointerId===event.pointerId)cancel();}} onContextMenu={event=>{event.preventDefault();cancel();}}>◩</button>
    <div className="split-tab-strip" role="tablist" aria-label="Area views">{pane.viewIds.map(viewId=><button key={viewId} role="tab" aria-selected={pane.activeViewId===viewId} draggable={!busy} onDragStart={event=>{draggingView.current=layout.views[viewId]??null;event.dataTransfer.setData(GEN_VIEW_DRAG_TYPE,JSON.stringify({workspaceId:layout.id,viewId,revision:layout.revision}));event.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{draggingView.current=null;}} onClick={()=>{void send('view.activate',{paneId,viewId},false);}} title={title(layout.views[viewId]!)}><span className="split-tab-label">{title(layout.views[viewId]!)}</span></button>)}</div>
    <div className="split-area-controls"><ActionMenu label="Area actions" icon={<MoreHorizontal size={16} aria-hidden="true"/>} iconOnly open={menuPane===paneId} onOpenChange={open=>setMenuPane(open?paneId:null)} disabled={busy} items={[
     {id:'split-columns',label:'Split left / right',disabled:busy||narrow,onSelect:()=>{void splitPane(paneId,'right');}},
     {id:'split-rows',label:'Split above / below',disabled:busy||narrow,onSelect:()=>{void splitPane(paneId,'bottom');}},
     {id:'join',label:'Join adjacent area',disabled:busy||Object.keys(layout.panes).length<2,onSelect:()=>{void send('pane.join',{paneId});}},
     ...(current?[{id:'park',label:'Park current view',disabled:busy,onSelect:()=>{void send('view.park',{viewId:current.id});}}]:[]),
     ...(current&&onDetachView&&current.kind==='thread'?[{id:'detach',label:'Detach conversation',disabled:busy,onSelect:()=>{onDetachView(current);}}]:[]),

     ...(onSelectEditor?editorOptions.map(option=>({id:`editor:${option.id}`,label:`Editor: ${option.title}`,disabled:busy,onSelect:()=>{void run(()=>onSelectEditor(option.id,paneId));}})):[]),
     ...layout.parkedViewIds.map(viewId=>({id:`recover:${viewId}`,label:`Recover: ${title(layout.views[viewId]!)}`,disabled:busy,onSelect:()=>{void send('view.move',{viewId,paneId});}})),
    ]}/></div>
    <button className="split-collapse" disabled={busy} aria-label={pane.collapsed?'Restore area':'Minimize area'} title={pane.collapsed&&current?title(current):undefined} aria-expanded={!pane.collapsed} onClick={()=>{void send('pane.collapse',{paneId,collapsed:!pane.collapsed},false);}}>{pane.collapsed?<><span aria-hidden="true">▾</span><span className="split-collapsed-title">{current?title(current):'Empty area'}</span></>:'▴'}</button>
    {current&&onDetachView&&current.kind==='thread'&&<button ref={node=>{if(floatMenu===current.id)floatGripAnchor.current=node;}} type="button" className="split-view-grip" style={dockedPreview===current.id?{visibility:'hidden'}:undefined} aria-hidden={dockedPreview===current.id||undefined} aria-label="Move chat" aria-haspopup="menu" aria-expanded={floatMenu===current.id} title="Move chat — drag to detach, or drag onto an area edge to dock" disabled={busy} onPointerDown={event=>beginDockedFloat(event,current,paneId)} onPointerCancel={event=>{if(floatGesture.current?.pointerId===event.pointerId)cancelFloat();}} onLostPointerCapture={event=>{if(floatGesture.current?.element===event.currentTarget&&floatGesture.current.pointerId===event.pointerId)cancelFloat();}} onClick={event=>{if(event.detail===0||!floatDragged.current)setFloatMenu(value=>value===current.id?null:current.id);}}><GripVertical size={14}/></button>}
   </header>
   {!pane.collapsed&&<div className="split-pane-slot" ref={node=>{if(node)slots.current.set(paneId,node);else slots.current.delete(paneId);}}>{(!current||(paneId===emptyMainPaneId&&current.kind==='thread'))&&<div className="split-empty"><strong>{onDropThread?'Drag a thread here':'Add a tool'}</strong><span>{onDropThread?'Drop at an edge to split, or in the middle to add a tab.':'Choose a tool from Panels or the area menu. Split its area to arrange tools together.'}</span></div>}</div>}
  </section>;
 };
 const renderNode=(node:SplitWorkspaceNode):ReactNode=>{
  if(node.kind==='pane')return renderPane(node.paneId);const ratio=previewRatio?.id===node.id?previewRatio.ratio:node.ratio,firstCollapsed=splitPaneIds(node.first).every(id=>layout.panes[id]!.collapsed),secondCollapsed=splitPaneIds(node.second).every(id=>layout.panes[id]!.collapsed),style={'--split-ratio':ratio,...(firstCollapsed!==secondCollapsed?{[node.axis==='horizontal'?'gridTemplateColumns':'gridTemplateRows']:firstCollapsed?'36px 6px minmax(0,1fr)':'minmax(0,1fr) 6px 36px'}:{})} as CSSProperties;
  return <div key={node.id} className={`split-node split-${node.axis}`} style={style}>{renderNode(node.first)}<div role="separator" tabIndex={0} aria-label={`Resize ${node.axis==='horizontal'?'columns':'rows'}`} aria-orientation={node.axis==='horizontal'?'vertical':'horizontal'} aria-valuenow={Math.round(ratio*100)} aria-valuemin={5} aria-valuemax={95} className={`split-divider${previewRatio?.id===node.id?' is-dragging':''}`} onPointerDown={event=>beginResize(event,node)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={event=>{if(resize.current?.pointerId===event.pointerId)cancel();}} onLostPointerCapture={event=>{if(resize.current?.pointerId===event.pointerId)cancel();}} onContextMenu={event=>{event.preventDefault();cancel();}} onKeyDown={event=>keyResize(event,node)}>{previewRatio?.id===node.id&&<span>{Math.round(ratio*100)}% {node.axis==='horizontal'?'width':'height'}</span>}</div>{renderNode(node.second)}</div>;
 };
 const liveOwner=new Map<string,string>(),visibleOwner=new Map<string,string>();for(const pane of Object.values(layout.panes)){const active=pane.activeViewId?layout.views[pane.activeViewId]:undefined;if(!pane.collapsed&&active&&(pane.id!==emptyMainPaneId||active.kind!=='thread')){liveOwner.set(active.id,pane.id);if(!narrow||pane.id===layout.focusedPaneId)visibleOwner.set(active.id,pane.id);}}
 const viewPlacements=Object.values(layout.views).map(view=>{
  const paneId=dockedPreview===view.id?undefined:visibleOwner.get(view.id),slot=paneId?rects[paneId]:undefined,floatRect=!paneId&&(dockedPreview===view.id||layout.parkedViewIds.includes(view.id))?floatRectOf(view.id):undefined,active=Boolean(slot&&slot.width>0&&slot.height>0)||Boolean(floatRect);
  const live=Boolean(liveOwner.get(view.id))||Boolean(floatRect);
  const style:CSSProperties=floatRect?{left:floatRect.x,top:floatRect.y,width:floatRect.width,height:floatRect.height}:active?{left:slot!.left,top:slot!.top,width:slot!.width,height:slot!.height}:{display:'none'};
  return{view,paneId,floatRect,active,live,style};
 });
 const activeViewKey=JSON.stringify(viewPlacements.filter(placement=>placement.live).map(placement=>placement.view.id).sort());
 useLayoutEffect(()=>{
  if(!onActiveViewsChange)return;
  onActiveViewsChange(layout.id,JSON.parse(activeViewKey));
  return()=>onActiveViewsChange(layout.id,[]);
 },[layout.id,activeViewKey,onActiveViewsChange]);
 const overlay=drop?rects[drop.paneId]:undefined;
 return <div ref={root} className={`split-workspace${narrow?' is-narrow':''} ${className}`} data-workspace-id={layout.id} aria-busy={busy} onPointerDownCapture={event=>{const paneId=(event.target as HTMLElement).closest<HTMLElement>('[data-split-view]')?.dataset.paneId;if(paneId&&paneId!==layout.focusedPaneId&&!busy)void send('pane.focus',{paneId},false);}} onDragOver={dragOver} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDrop(null);}} onDrop={dropView}>
  {narrow&&<div className="split-workspace-tools"><label>Area<Select aria-label="Active workspace area" value={layout.focusedPaneId} disabled={busy} onValueChange={paneId=>{void send('pane.focus',{paneId},false);}} options={splitPaneIds(layout.root).map(paneId=>{const viewId=layout.panes[paneId]!.activeViewId;return{value:paneId,label:viewId?title(layout.views[viewId]!):'Empty area'};})}/></label></div>}
  {error&&<p role="alert" className="split-layout-error">{error}<button onClick={()=>setError('')}>Dismiss</button></p>}
  <div className="split-tree">{narrow?renderPane(layout.focusedPaneId):renderNode(layout.root)}</div>
  <div className="split-surface-plane">{viewPlacements.map(({view,paneId,floatRect,active,style})=><div key={view.id} className={`split-surface${floatRect?' split-surface-float':''}`} data-split-view={view.id} data-pane-id={paneId} data-floating={floatRect?true:undefined} style={style} inert={!active} aria-hidden={!active}>{renderView(view,active)}{floatRect&&<div className="split-float-header"><span className="split-float-title" onPointerDown={event=>beginFloat(event,view.id,'move')} onPointerMove={moveFloat} onPointerUp={endFloat} onPointerCancel={event=>{if(floatGesture.current?.pointerId===event.pointerId)cancelFloat();}} onLostPointerCapture={event=>{if(floatGesture.current?.pointerId===event.pointerId)cancelFloat();}}>{title(view)}</span><button ref={node=>{if(floatMenu===view.id)floatGripAnchor.current=node;}} type="button" className="split-float-grip" aria-label="Move chat" title="Move chat — drag to move, or open for placement" aria-haspopup="menu" aria-expanded={floatMenu===view.id} onPointerDown={event=>beginFloat(event,view.id,'move')} onPointerMove={moveFloat} onPointerUp={endFloat} onPointerCancel={event=>{if(floatGesture.current?.pointerId===event.pointerId)cancelFloat();}} onLostPointerCapture={event=>{if(floatGesture.current?.pointerId===event.pointerId)cancelFloat();}} onClick={()=>{if(floatDragged.current)return;setFloatMenu(current=>current===view.id?null:view.id);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setFloatMenu(current=>current===view.id?null:view.id);}else keyFloat(event,view.id);}}><GripVertical size={14}/></button></div>}{floatRect&&<button type="button" className="split-float-resize" aria-label={`Resize ${title(view)}`} onPointerDown={event=>beginFloat(event,view.id,'resize')} onPointerMove={moveFloat} onPointerUp={endFloat} onPointerCancel={event=>{if(floatGesture.current?.pointerId===event.pointerId)cancelFloat();}} onLostPointerCapture={event=>{if(floatGesture.current?.pointerId===event.pointerId)cancelFloat();}} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;const rect=floatRectOf(view.id);if(!rect)return;event.preventDefault();const step=event.shiftKey?24:8,dw=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dh=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;const next=clampChatRect({...rect,width:Math.max(160,rect.width+dw),height:Math.max(120,rect.height+dh)},{width:size.width,height:size.height});setFloatRects(current=>({...current,[view.id]:next}));onMoveFloat?.(view.id,next);}}/>}</div>)}</div>
  {drop&&overlay&&<div className={`split-drop-preview edge-${drop.edge}`} style={drop.outer?{left:0,top:topBar,width:size.width,height:size.height-topBar}:{left:overlay.left,top:overlay.top,width:overlay.width,height:overlay.height}}><span>{drop.joinFrom?'Join into this area':edgeLabel[drop.edge]}</span></div>}
  {floatMenu&&layout.views[floatMenu]&&(()=>{
   const view=layout.views[floatMenu]!,parked=layout.parkedViewIds.includes(view.id),owningPaneId=Object.values(layout.panes).find(pane=>pane.viewIds.includes(view.id))?.id;
   const items:{id:string;label:string;disabled?:boolean;reason?:string;onSelect:()=>void}[]=[];
   if(parked){
    for(const [edge,label] of [['left','Dock left'],['right','Dock right'],['top','Dock above'],['bottom','Dock below']] as const){
     const fits=Boolean(onDockFloat)&&fitSplit(mainPaneId,edge,false,view);
     items.push({id:`dock-${edge}`,label,disabled:busy||!onDockFloat||!fits,reason:!fits?'Make the main area larger to dock here.':undefined,onSelect:()=>{void run(()=>Promise.resolve(onDockFloat?.(view,mainPaneId,edge)),false);}});
    }
    if(onReturnFloat)items.push({id:'return',label:'Return to main',disabled:busy,onSelect:()=>onReturnFloat(view)});
   }else{
    if(onDetachView)items.push({id:'float',label:'Float',disabled:busy,onSelect:()=>{void run(()=>Promise.resolve(onDetachView(view)),false);}});
    if(onReturnFloat&&owningPaneId&&owningPaneId!==mainPaneId)items.push({id:'return',label:'Return to main',disabled:busy,onSelect:()=>onReturnFloat(view)});
   }
   return items.length?<Popover anchor={floatGripAnchor} contentRef={floatMenuContent} initialFocus={floatMenuItem} open width={220} height={items.length*34+10} preferredSide="below" align="start" role="menu" aria-label={`Placement for ${title(view)}`} className="ui-control-popup" onDismiss={()=>setFloatMenu(null)}>{items.map((item,index)=><button key={item.id} ref={index===0?floatMenuItem:undefined} type="button" role="menuitem" className="ui-control-option" aria-disabled={item.disabled||undefined} title={item.reason} aria-description={item.reason} onClick={()=>{if(item.disabled)return;setFloatMenu(null);item.onSelect();}} onKeyDown={event=>{if(event.key!=='ArrowDown'&&event.key!=='ArrowUp'&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();const items=Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="menuitem"]')??[]),index=items.indexOf(event.currentTarget as HTMLElement);(event.key==='Home'?items[0]:event.key==='End'?items[items.length-1]:items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length])?.focus();}}>{item.label}</button>)}</Popover>:null;
  })()}
 </div>;
}
