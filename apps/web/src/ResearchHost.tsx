import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {PanelBinding, WorkspaceCanvas} from '../../../packages/contracts/workspace';
import type {ShellResourceRow, ThreadNavigationRow} from '../../../packages/contracts/shell-read-models';
import {Select} from '../../../packages/ui-shell/Select';
import {ConversationPane} from './conversation-workspace/ConversationPane';
import {ScopedConversationComposer} from './ScopedConversationComposer';
import {useScopedConversation} from './conversation-workspace/useScopedConversation';
import type {ConversationSelection} from './conversation-workspace/reader';
import {useDesktop, useDetachedSurface, usePendingSurface, useDesktopReady} from './desktop-context';
import {PendingStatus} from './LoadingState';
import type {ResearchImportDraft} from './research-workspace/SourceImport';
import {ResearchWorkspace, type ResearchResource} from './research-workspace/ResearchWorkspace';
import {getShellResources, getShellNavigationItem} from './shell-read-api';
import {useShellNavigation} from './shell-navigation';
import type {ConversationHost} from './WorkspaceHost';
import {journalFlush} from './journal';
import {prepareEditorHandoff} from './editor-handoff';
import './research-host.css';
import {ErrorState} from '../../../packages/ui-shell/Feedback';

function researchBinding(canvas: WorkspaceCanvas): {binding?: PanelBinding; error?: string} {
 const explicit=canvas.panels.find(panel=>panel.id==='research-owner-'+canvas.id&&panel.kind==='thread');
 const panels=explicit?[explicit]:canvas.panels.filter(panel=>panel.kind==='thread');
 if(panels.some(panel=>panel.binding.authority.kind!=='local'))return {error:'Choose a personal conversation for this workspace.'};
 const owners=panels.filter(panel=>panel.binding.threadId);
 const unique=new Set(owners.map(panel=>JSON.stringify([panel.binding.threadId,panel.binding.projectId??null])));
 if(unique.size>1)return {error:'Choose one conversation for this workspace.'};
 return {binding:owners[0]?.binding};
}
export function ResearchHost({canvas,workspace,composers,openConversation}:{canvas:WorkspaceCanvas;workspace:ConversationHost['workspace'];composers:ConversationHost['composers'];openConversation:(threadId:string)=>Promise<void>}) {
 const {binding,error:bindingError}=researchBinding(canvas), key=JSON.stringify([canvas.id,binding?.threadId,binding?.projectId,bindingError]);
 const [admission,setAdmission]=useState<{key:string;row:ThreadNavigationRow;selection:ConversationSelection}>(),[error,setError]=useState(''),[pending,setPending]=useState(false),[retry,setRetry]=useState(0),[changing,setChanging]=useState(false);
 const navigation=useShellNavigation('');
 useEffect(()=>{
  const controller=new AbortController();setError('');setPending(Boolean(binding?.threadId));
  if(binding?.threadId)void getShellNavigationItem(binding.threadId,controller.signal).then(row=>{
   if(controller.signal.aborted)return;
   if(row.id!==binding.threadId)throw Error('The saved conversation is unavailable.');
   if(binding.projectId!==undefined&&binding.projectId!==row.projectId)throw Error('The saved project no longer matches this conversation.');
   setAdmission({key,row,selection:{target:{authority:'personal',threadId:row.id,includeArchived:false},navigationKey:JSON.stringify([canvas.id,row.id,row.projectId??null,row.updatedAt])}});
  }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'The conversation could not open.');}).finally(()=>{if(!controller.signal.aborted)setPending(false);});
  return()=>controller.abort();
 },[key,retry]);
 const admitted=admission?.key===key?admission:undefined;
 const conversation=useScopedConversation(admitted?.selection??null), context=conversation.state.context;
 const desktop=useDesktop(), surface=binding?.threadId?{kind:'thread' as const,threadId:binding.threadId}:null, detached=useDetachedSurface(surface), nativePending=usePendingSurface(surface);

 const held=Boolean(detached||nativePending||desktop?.closing), fence=useRef({signature:'',version:0,active:true});
 const signature=JSON.stringify([key,context?.scopeKey,held]);if(fence.current.signature!==signature)fence.current={...fence.current,signature,version:fence.current.version+1};
 useEffect(()=>{fence.current.active=true;return()=>{fence.current.active=false;fence.current.version++;};},[]);
 // The native token records transitions even when React batches away an owner round trip.
 const choosing=useRef(false), version=fence.current.version, ownership=desktop?desktop.ownership(surface):0;
 const ownerGuard=useMemo(()=>()=>fence.current.active&&!held&&!choosing.current&&fence.current.version===version&&ownership!==undefined&&(desktop?desktop.ownership(surface):0)===ownership,[signature,version,ownership]);
 const eligible=Boolean(!changing&&!pending&&!error&&!bindingError&&admitted&&context&&conversation.state.phase==='ready'&&context.owner.threadId===admitted.row.id&&context.researchEligible&&context.owner.projectId===(binding?.projectId??admitted.row.projectId??null));
 const [files,setFiles]=useState<{key:string;items:ShellResourceRow[];cursor:string|null;pending:boolean;loaded:boolean;error?:string}>(),filesRead=useRef<AbortController | undefined>(undefined),currentScope=useRef(context?.scopeKey);currentScope.current=context?.scopeKey;
 useLayoutEffect(()=>()=>{filesRead.current?.abort();filesRead.current=undefined;},[context?.scopeKey]);
 async function loadFiles(reset=false){
  if(!context||!eligible||filesRead.current)return;
  const key=context.scopeKey, before=!reset&&files?.key===key?files:undefined, controller=new AbortController();filesRead.current=controller;
  setFiles({key,items:before?.items??[],cursor:before?.cursor??null,pending:true,loaded:before?.loaded??false});
  try{
   const page=await getShellResources({limit:100,...(before?.cursor?{cursor:before.cursor}:{})},controller.signal);
   if(controller.signal.aborted||currentScope.current!==key)return;
   const permitted=page.items.filter(row=>row.threadId===context.owner.threadId&&['project','file','attachment'].includes(row.kind));
   setFiles({key,items:[...(before?.items??[]),...permitted].filter((row,index,all)=>all.findIndex(other=>other.id===row.id)===index),cursor:page.nextCursor,pending:false,loaded:true});
  }catch{if(!controller.signal.aborted&&currentScope.current===key)setFiles({key,items:before?.items??[],cursor:before?.cursor??null,pending:false,loaded:before?.loaded??false,error:'Granted files could not load.'});}
  finally{if(filesRead.current===controller)filesRead.current=undefined;}
 }
 const ownerFiles=files?.key===context?.scopeKey?files:undefined;
 const importMemory=useRef<{key:string;draft:ResearchImportDraft}|undefined>(undefined);
 if(context&&importMemory.current?.key!==context.scopeKey)importMemory.current={key:context.scopeKey,draft:{}};
 const [chatOpen,setChatOpen]=useState(false);
 const [resource,setResource]=useState<{scopeKey:string;resource:ResearchResource|null}>();
 const options=useMemo(()=>{
  const rows=[...(admitted?[admitted.row]:[]),...(navigation.page?.items??[])];
  return [{value:'',label:'Choose a conversation'},...rows.filter((row,index)=>rows.findIndex(other=>other.id===row.id)===index).map(row=>({value:row.id,label:row.title}))];
 },[admitted,navigation.page]);
 async function choose(id:string){
  if(!id||choosing.current||!ownerGuard())return;
  choosing.current=true;const operationVersion=++fence.current.version, operationOwnership=desktop?desktop.ownership(surface):0, operationCurrent=()=>fence.current.active&&!held&&fence.current.version===operationVersion&&operationOwnership!==undefined&&(desktop?desktop.ownership(surface):0)===operationOwnership;
  setChanging(true);setError('');
  try{
   const check=()=>{if(!operationCurrent())throw Error('The workspace owner changed. Retry from the current view.');};
   await journalFlush();check();await prepareEditorHandoff();check();
   const row=await getShellNavigationItem(id), next:PanelBinding={authority:{kind:'local'},threadId:row.id,...(row.projectId?{projectId:row.projectId}:{})};
   check();if(row.id!==id)throw Error('The selected conversation is unavailable.');
   const threads=canvas.panels.filter(panel=>panel.kind==='thread'), panel=threads.find(panel=>panel.id==='research-owner-'+canvas.id)??(threads.length===1?threads[0]:undefined);
   if(panel)await workspace.send('workspace.panel.update',{panelId:panel.id,patch:{binding:next}},operationCurrent);
   else await workspace.send('workspace.panel.add',{canvasId:canvas.id,panel:{id:'research-owner-'+canvas.id,kind:'thread',binding:next}},operationCurrent);
  }catch(cause){setError(cause instanceof Error?cause.message:'The conversation could not open.');}finally{choosing.current=false;if(fence.current.active)setChanging(false);}
 }
 const picker=<div className="research-owner-control"><Select aria-label="Research conversation" value={admitted?.row.id??''} options={options} disabled={held||changing||pending} onValueChange={id=>{void choose(id);}}/>{navigation.page?.nextCursor&&<button disabled={navigation.pending} onClick={()=>{void navigation.more();}}>More conversations</button>}</div>;
 const failure=error||bindingError||conversation.state.error;
 useDesktopReady(!pending&&(!binding?.threadId||Boolean(context)||Boolean(failure)));
 return <div className="research-host">
  {detached&&<p className="research-host-notice">This conversation is open in another window.<button onClick={()=>{void desktop?.bridge.focus(detached.id);}}>Focus existing window</button></p>}
  {!eligible&&picker}
  {failure&&<ErrorState className="research-host-notice" message={failure} retryLabel="Retry conversation" onRetry={()=>{setRetry(value=>value+1);void conversation.reader.retry();}}/>}
  <PendingStatus pending={pending||conversation.state.pending} label="Opening research..."/>
  {eligible&&context?<ResearchWorkspace key={context.scopeKey} selection={{authority:{kind:'personal'},threadId:context.owner.threadId,projectId:context.owner.projectId,epoch:context.owner.epoch,isCurrent:ownerGuard,resource:resource?.scopeKey===context.scopeKey?resource.resource:null}} importDraft={importMemory.current?.draft} disabled={held} topic={context.owner.title} ownerControl={picker} browserCapture={{available:false}} onImportOpen={()=>{void loadFiles(true);}} grantedFiles={ownerFiles?.items.map(row=>({resourceId:row.id,label:row.label}))} filePage={{pending:ownerFiles?.pending??false,hasMore:Boolean(ownerFiles?.cursor),error:ownerFiles?.error,more:()=>{void loadFiles();}}} chatOpen={chatOpen} onChatOpenChange={setChatOpen} chat={<ConversationPane conversation={conversation} hidden={!chatOpen} renderComposer={read=>read.context&&read.phase==='ready'?<ScopedConversationComposer key={read.context.scopeKey} context={read.context} composers={composers} openConversation={openConversation} refreshOwner={conversation.reader.poll}/>:null}/>} onNavigate={selection=>setResource({scopeKey:context.scopeKey,resource:selection.resource})}/>:!pending&&!failure&&!binding?.threadId&&<p className="research-host-notice">Choose a conversation to open its sources and findings.</p>}
 </div>;
}
