import {createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode} from 'react';
import {Modal} from '../../../packages/ui-shell/Modal';
import {Select} from '../../../packages/ui-shell/Select';
import type {Snapshot} from '../../../packages/contracts';
import type {MemoryOwner} from './project-memory-api';
import type {ProjectMemoryReviewProps} from './ProjectMemoryReview';
import type {WorkbenchPanelContentProps,WorkbenchPanelTab} from './WorkbenchPanelContent';
import {pendingInputRecoveries,recoverWorkbenchInput} from './workbench-input-recovery';
import {registerEditorHandoff} from './editor-handoff';
import {
 type CapturedSourceV1, type LogicalOwnerV1, type SelectedSourceV1,
 type SourceCandidateV1, type SourceCapabilityV1, type SourceDescriptorV1, type SourceOpenV1, type SourceRefV1, type WorkbenchEvidenceItemV1, type WorkbenchModuleV1, type WorkbenchViewV1,type WorkbenchInputV1,type WorkbenchInputRecoveryRequestV1,
} from '../../../packages/contracts/source-selection';
import {SourceSelectionActions, type SourceSelectionAction, type VisibleSourceSelection} from './SourceSelectionActions';
import {journalCompareAndSwap, journalReadRecord, journalSubscribe} from './journal';
import {loadWorkbenchViews, noteSourceDraftWork, prepareSourceOwnerHandoff, readSourceDraft, saveWorkbenchView, sourceDraftKey, updateSourceDraft, type SourceDraftSnapshot} from './workbench-recovery';
import {messageSelection, workbenchApi, type WorkbenchApi} from './workbench-api';
import './source-workbench.css';

const ownerKey=(owner?:LogicalOwnerV1)=>owner?JSON.stringify([owner.threadId,owner.projectId,owner.workspaceId]):'';
const WB_TABS:[PanelTab,string][]=[['request','Last request'],['tools','Tools'],['run','Run'],['sources','Sources'],['evidence','Evidence']];
const messageOf=(cause:unknown)=>cause instanceof Error?cause.message:'The source could not be read. The draft was retained.';
const shortRevision=(value:string)=>value.length>16?`${value.slice(0,12)}\u2026`:value;
const formatCaptured=(iso:string)=>{const time=Date.parse(iso);return Number.isNaN(time)?iso:new Date(time).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});};
function sourceRange(ref:SourceRefV1){const source=ref.source;switch(source.kind){case 'MESSAGE':return `UTF-16 [${source.range.start}, ${source.range.end})`;case 'FILE_RANGE':return `Lines ${source.range.startLine} to ${source.range.endLine}`;case 'DIFF_HUNK':return `Hunk lines ${source.range.startLine} to ${source.range.endLine}`;case 'ARTIFACT_REGION':return `Binding ${source.binding}, pointer ${source.range.pointer||'(root)'}`;}}
function localDevice(){try{const key='harness:workbench-device',existing=localStorage.getItem(key);if(existing)return existing;const id=crypto.randomUUID();localStorage.setItem(key,id);return id;}catch{return 'local-window';}}
type PanelTab=WorkbenchPanelTab;
interface WorkbenchContext {
 owner?:LogicalOwnerV1; enabled:boolean; draft?:SourceDraftSnapshot; error:string;
 api:WorkbenchApi;
 inputs:WorkbenchInputV1[]; inputsReady:boolean; inputsError:string;
 pendingRecoveries:WorkbenchInputRecoveryRequestV1[];canRecoverInputs:boolean;
 reloadInputs():Promise<void>;
 recoverInput(inputId:string,action:WorkbenchInputRecoveryRequestV1['action']):ReturnType<typeof recoverWorkbenchInput>;
 view?:WorkbenchViewV1; viewReady:boolean;
 persistView:(type:'SOURCES'|'EVIDENCE'|'RUN',selectedItem?:string|null,anchor?:WorkbenchViewV1['scrollAnchor'])=>void;
 show(tab?:PanelTab):void;
 openMessage(id:string):Promise<void>;
 selectMessage(id:string,text:string,action:SourceSelectionAction,selection:VisibleSourceSelection):Promise<void>;
 remove(ref:SourceRefV1):Promise<void>;
 keep(ref:SourceRefV1):Promise<void>;
 refresh(ref:SourceRefV1):Promise<void>;
 open(ref:SourceRefV1):Promise<void>;
 setMode(mode:'NOW'|'AFTER_CURRENT'):Promise<void>;
 sources:Record<string,SourceOpenV1|CapturedSourceV1>;
}
const Context=createContext<WorkbenchContext|undefined>(undefined);
export const useSourceWorkbench=()=>useContext(Context);

/** No DOM wrapper: the existing chat, its scroll owner and floating geometry stay mounted. */
export function SourceWorkbenchProvider({owner,ownerEpoch='',active=true,snapshot,children,api=workbenchApi}:{owner?:LogicalOwnerV1;ownerEpoch?:string;active?:boolean;snapshot?:Snapshot;children:ReactNode;api?:WorkbenchApi}) {
 const key=ownerKey(owner), requestedScope=key+':'+ownerEpoch, fence=useRef({scope:requestedScope,generation:0});
 if(fence.current.scope!==requestedScope)fence.current={scope:requestedScope,generation:fence.current.generation+1};
 const scope=requestedScope+':'+fence.current.generation,current=useRef(scope);current.current=scope;
 const [loaded,setLoaded]=useState<{scope:string;enabled:boolean;candidates:SourceCandidateV1[];capabilities:SourceCapabilityV1[]}>();
 const [draftState,setDraft]=useState<{scope:string;value:SourceDraftSnapshot}>();
 const [sourceState,setSources]=useState<{scope:string;values:Record<string,SourceOpenV1|CapturedSourceV1>}>({scope:'',values:{}});
 const [errorState,setError]=useState<{scope:string;message:string}>();
 const [initialTab,setInitialTab]=useState<PanelTab>('sources');
 const [panelScope,setPanelScope]=useState<string|null>(null), [selected,setSelected]=useState<SourceDescriptorV1|SourceOpenV1>();
 const [evidence,setEvidence]=useState<{scope:string;items:WorkbenchEvidenceItemV1[];modules:WorkbenchModuleV1[]}>();
 const [inputState,setInputState]=useState<{scope:string;inputs:WorkbenchInputV1[];pending:WorkbenchInputRecoveryRequestV1[];ready:boolean;error:string}>();
 const inputRead=useRef(0),runState=snapshot?.threads.find(thread=>thread.id===owner?.threadId);
 const deviceId=useMemo(localDevice,[]),[view,setView]=useState<WorkbenchViewV1>();
 const [viewReady,setViewReady]=useState('');
 const viewTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),viewLatest=useRef<WorkbenchViewV1|undefined>(undefined);
 const controller=useRef<AbortController|null>(null);
 const enabled=active&&loaded?.scope===scope&&loaded.enabled, draft=draftState?.scope===scope?draftState.value:undefined;
 const sources=sourceState.scope===scope?sourceState.values:{}, error=errorState?.scope===scope?errorState.message:'';
 const isCurrent=()=>current.current===scope;
 const report=(cause:unknown)=>{if(isCurrent())setError({scope,message:messageOf(cause)});};
 const remember=(value:SourceOpenV1|CapturedSourceV1)=>{if(isCurrent())setSources(previous=>({scope,values:{...(previous.scope===scope?previous.values:{}),[value.ref.captureId]:value}}));};
 const reloadInputs=async()=>{
  if(!owner||!isCurrent())return;
  const generation=++inputRead.current;
  const pending=await pendingInputRecoveries(owner).catch(cause=>{report(cause);return [];});
  try{const result=await api.inputs(owner,controller.current?.signal);if(isCurrent()&&generation===inputRead.current)setInputState({scope,inputs:result.inputs,pending,ready:true,error:''});}
  catch(cause){if(isCurrent()&&generation===inputRead.current&&!controller.current?.signal.aborted)setInputState(previous=>({scope,inputs:previous?.scope===scope?previous.inputs:[],pending,ready:true,error:messageOf(cause)}));}
 };
 const persistView=(viewType:'SOURCES'|'EVIDENCE'|'RUN',selectedItem:string|null=null,scrollAnchor:WorkbenchViewV1['scrollAnchor']=null)=>{
  if(!owner||!isCurrent())return;
  const next:WorkbenchViewV1={logicalOwner:owner,revision:Date.now(),viewType,selectedItem,scrollAnchor,deviceId,updatedAt:new Date().toISOString()};
  setView(next);viewLatest.current=next;clearTimeout(viewTimer.current);viewTimer.current=setTimeout(()=>{void saveWorkbenchView(next).catch(report);},150);
 };
 useEffect(()=>()=>{clearTimeout(viewTimer.current);if(viewLatest.current)void saveWorkbenchView(viewLatest.current).catch(()=>{});},[]);
 useEffect(()=>registerEditorHandoff('source-workbench:'+scope,async()=>{
  clearTimeout(viewTimer.current);if(viewLatest.current)await saveWorkbenchView(viewLatest.current);
  if(owner)await prepareSourceOwnerHandoff(owner);
 }),[scope]);
 useLayoutEffect(()=>{
  controller.current?.abort(); const pending=new AbortController();controller.current=pending;
  setPanelScope(null);setSelected(undefined);setError(undefined);
  if(!owner)return ()=>pending.abort();
  void loadWorkbenchViews(deviceId).then(entries=>{if(!pending.signal.aborted&&current.current===scope){setView(entries.find(entry=>ownerKey(entry.logicalOwner)===key));setViewReady(scope);}}).catch(cause=>{if(!pending.signal.aborted){report(cause);setViewReady(scope);}});
  const recover=()=>readSourceDraft(owner).then(value=>{if(!pending.signal.aborted&&current.current===scope)setDraft({scope,value});}).catch(cause=>{if(!pending.signal.aborted)report(cause);});
  void recover(); const unsubscribe=journalSubscribe(sourceDraftKey(owner),()=>{void recover();});
  void api.catalogue(owner,pending.signal).then(value=>{if(!pending.signal.aborted&&current.current===scope)setLoaded({scope,enabled:value.enabled,candidates:value.sources,capabilities:value.sourceCapabilities});}).catch(cause=>{if(!pending.signal.aborted)report(cause);});
  return ()=>{pending.abort();unsubscribe();};
 },[scope,api]);
 useEffect(()=>{
  if(owner)void reloadInputs();
 },[scope,draft?.generation,runState?.status,runState?.runId,runState?.error,api]);
 useEffect(()=>{
  if(!owner||!draft)return;
  const pending=new AbortController();
  for(const ref of draft.sourceRefs)void api.open(owner,ref,pending.signal).then(value=>{if(!pending.signal.aborted)remember(value);}).catch(cause=>{if(!pending.signal.aborted)report(cause);});
  return ()=>pending.abort();
 },[scope,draft?.generation,api]);
 const change=async(fn:Parameters<typeof updateSourceDraft>[1])=>{
  if(!owner||!isCurrent())throw Error('Choose the current conversation before editing source context.');
  noteSourceDraftWork(owner);
  const value=await updateSourceDraft(owner,fn);if(isCurrent())setDraft({scope,value});
 };
 const show=(tab?:PanelTab)=>{setInitialTab(tab??(view?.viewType==='EVIDENCE'?'evidence':'sources'));setPanelScope(scope);setSelected(undefined);setError(undefined);void reloadInputs();if(owner)void api.evidence(owner,controller.current?.signal).then(value=>{if(isCurrent())setEvidence({scope,...value});}).catch(report);};
 const open=async(ref:SourceRefV1)=>{
  if(!owner)return;const value=await api.open(owner,ref,controller.current?.signal);
  if(!isCurrent())return;remember(value);setSelected(value);setInitialTab('sources');setPanelScope(scope);persistView('SOURCES',ref.captureId,view?.selectedItem===ref.captureId?view.scrollAnchor:null);
 };
 const attach=async(source:SelectedSourceV1,action:SourceSelectionAction)=>{
  if(!owner||!enabled||!isCurrent())throw Error('Source selection is unavailable for this conversation.');
  if(action!=='open')noteSourceDraftWork(owner);
  const captured=await api.capture(source,controller.current?.signal);
  if(!isCurrent())return;remember(captured);
  if(action==='open'){await open(captured.ref);return;}
  await change(state=>({...state,sourceRefs:[...state.sourceRefs.filter(ref=>ref.captureId!==captured.ref.captureId),captured.ref]}));
  if(!isCurrent())return;
  if(action==='ask'){
   const existing=await journalReadRecord<string>(`draft:${owner.threadId}`);
   // A source action never submits a message or replaces authored prompt text.
   if(isCurrent()&&!existing?.value)await journalCompareAndSwap(`draft:${owner.threadId}`,existing?.generation,'Explain this selected source.');
  }
  if(isCurrent())setPanelScope(null);
 };
 const context:WorkbenchContext={owner,enabled,draft,error,api,sources,show,open,view:view&&ownerKey(view.logicalOwner)===key?view:undefined,viewReady:viewReady===scope,persistView,
  inputs:inputState?.scope===scope?inputState.inputs:[],inputsReady:inputState?.scope===scope&&inputState.ready,inputsError:inputState?.scope===scope?inputState.error:'',reloadInputs,
  pendingRecoveries:inputState?.scope===scope?inputState.pending:[],canRecoverInputs:active,
  async openMessage(id){if(!owner||!enabled||!isCurrent())return;const value=await api.describe(owner,{kind:'MESSAGE',sourceId:id},controller.current?.signal);if(!isCurrent())return;setSelected(value);setInitialTab('sources');setPanelScope(scope);persistView('SOURCES',id);},
  async recoverInput(inputId,action){if(!owner||!active||!isCurrent())throw Error('Choose the current task before recovering its input.');try{return await recoverWorkbenchInput(owner,inputId,action,request=>{if(!isCurrent()||!active)throw Error('The current task changed before recovery.');return api.recoverInput(request,controller.current?.signal);});}finally{if(isCurrent())await reloadInputs();}},
  async selectMessage(id,text,action,selection){
   if(!owner||!enabled)return;
   const descriptor=await api.describe(owner,{kind:'MESSAGE',sourceId:id},controller.current?.signal);
   if(!isCurrent())return;if(descriptor.text!==text||text.slice(selection.start,selection.end)!==selection.text)throw Error('The message changed. Select the current text again.');
   const source=await messageSelection(descriptor,selection.start,selection.end);if(isCurrent())await attach(source,action);
  },
  remove:ref=>change(state=>({...state,sourceRefs:state.sourceRefs.filter(item=>item.captureId!==ref.captureId)})),
  keep:ref=>change(state=>({...state,sourceRefs:state.sourceRefs.map(item=>item.captureId===ref.captureId?{...item,keepCaptured:true}:item)})),
  async refresh(ref){if(!owner||!enabled)return;if(isCurrent())noteSourceDraftWork(owner);const value=await api.refresh(owner,ref,controller.current?.signal);if(!isCurrent())return;remember(value);await change(state=>({...state,sourceRefs:state.sourceRefs.map(item=>item.captureId===ref.captureId?value.ref:item)}));},
  setMode:sendMode=>change(state=>({...state,sendMode})),
 };
 return <Context.Provider value={context}>{children}{panelScope===scope&&owner&&<WorkbenchDialog initialTab={initialTab} snapshot={snapshot} owner={owner} enabled={enabled} candidates={loaded?.scope===scope?loaded.candidates:[]} capabilities={loaded?.scope===scope?loaded.capabilities:[]} selected={selected} evidence={evidence?.scope===scope?evidence:undefined} error={error} api={api} view={view&&ownerKey(view.logicalOwner)===key?view:undefined} persistView={persistView} close={()=>setPanelScope(null)} onSelect={async(candidate)=>{try{const value=await api.describe(owner,candidate.locator,controller.current?.signal);if(isCurrent()){setSelected(value);persistView('SOURCES',value.locator.sourceId);}}catch(cause){report(cause);}}} attach={attach} open={open} report={report}/>}</Context.Provider>;
}

export function SourceMessage({id,threadId,text,children}:{id:string;threadId:string;text:string;children:ReactNode}) {
 const context=useSourceWorkbench();
 if(!context?.enabled||context.owner?.threadId!==threadId)return <>{children}</>;
 return <SourceSelectionActions text={text} enabled={Boolean(context?.enabled&&context.owner?.threadId===threadId)} onAction={(action,selection)=>context?.selectMessage(id,text,action,selection)} onOpenCanonical={()=>context.openMessage(id)}>{children}</SourceSelectionActions>;
}
export function WorkbenchComposer({title,working=false,disabled=false}:{title:string;working?:boolean;disabled?:boolean}) {
 const context=useSourceWorkbench(),[localError,setLocalError]=useState('');
 if(!context||!context.enabled&&!context.draft?.sourceRefs.length&&context.draft?.sendMode!=='AFTER_CURRENT'&&!context.inputs.length&&!context.pendingRecoveries.length)return null;
 const run=(action:()=>Promise<void>)=>{setLocalError('');void action().catch(cause=>setLocalError(messageOf(cause)));};
 return <section aria-label="Prompt source context">
  <div className="workbench-destination"><strong>Destination: {title}</strong><span>Current task</span><button type="button" disabled={disabled} onClick={()=>context.show()}>Sources and evidence</button>
   <label>Delivery <Select aria-label="Source delivery mode" disabled={disabled} value={context.draft?.sendMode??'NOW'} onValueChange={value=>run(()=>context.setMode(value as 'NOW'|'AFTER_CURRENT'))} options={[{value:'NOW',label:'Now'},{value:'AFTER_CURRENT',label:'After current run',disabled:!context.enabled}]}/></label>
   {working&&<span>After current run queues this prompt without interrupting the active run.</span>}
  </div>
  {!context.enabled&&<p role="status">New source actions are disabled. Retained sources remain available to inspect or remove.</p>}
  {(context.inputs.length>0||context.pendingRecoveries.length>0)&&<p><button type="button" onClick={()=>context.show('run')}>Inspect queued source inputs</button> {context.inputs.length} accepted input{context.inputs.length===1?'':'s'} with retained sources. {context.pendingRecoveries.length>0&&'A recovery acknowledgment is unconfirmed.'}</p>}
  {(context.error||localError)&&<p role="alert">{localError||context.error}</p>}
  <div className="workbench-source-chips">{context.draft?.sourceRefs.map(ref=>{const source=context.sources[ref.captureId],state=source?.state,label=source?.label??ref.source.sourceId;return <article key={ref.captureId} className="workbench-source-chip" aria-label={`Selected source ${label}`}>
   <header><span>{label} · {ref.source.kind}</span><button type="button" aria-label={`Open source ${label}`} disabled={disabled} onClick={()=>run(()=>context.open(ref))}>Open source</button><button type="button" aria-label={`Remove source ${label}`} disabled={disabled} onClick={()=>run(()=>context.remove(ref))}>Remove source</button></header>
   <small title={`Revision ${ref.source.sourceRevision} · Captured ${ref.source.capturedAt}`}>Revision {shortRevision(ref.source.sourceRevision)} · {sourceRange(ref)} · Captured {formatCaptured(ref.source.capturedAt)}</small>
   {source&&<pre>{source.preview}{source.previewTruncated?'\nPreview truncated. Open source for the complete capture.':''}</pre>}
   {state&&state!=='CURRENT'&&<div role="status">{state==='STALE'?'The source has changed.':'The original source is unavailable.'} {ref.keepCaptured?'Using the retained capture.':'Refresh or explicitly keep the retained capture before sending.'}<div className="workbench-source-actions"><button type="button" aria-label={`Refresh source ${label}`} disabled={disabled||!context.enabled} onClick={()=>run(()=>context.refresh(ref))}>Refresh source</button><button type="button" aria-label={`Keep captured source ${label}`} disabled={disabled||ref.keepCaptured} onClick={()=>run(()=>context.keep(ref))}>Keep captured source</button></div></div>}
  </article>;})}</div>
 </section>;
}

function WorkbenchDialog({initialTab,snapshot,owner,enabled,candidates,capabilities,selected,evidence,error,api,view,persistView,close,onSelect,attach,open,report}:{initialTab:PanelTab;snapshot?:Snapshot;owner:LogicalOwnerV1;enabled:boolean;candidates:SourceCandidateV1[];capabilities:SourceCapabilityV1[];selected?:SourceDescriptorV1|SourceOpenV1;evidence?:{items:WorkbenchEvidenceItemV1[];modules:WorkbenchModuleV1[]};error:string;api:WorkbenchApi;view?:WorkbenchViewV1;persistView:(type:'SOURCES'|'EVIDENCE',selectedItem?:string|null,anchor?:WorkbenchViewV1['scrollAnchor'])=>void;close:()=>void;onSelect:(candidate:SourceCandidateV1)=>Promise<void>;attach:(source:SelectedSourceV1,action:SourceSelectionAction)=>Promise<void>;open:(ref:SourceRefV1)=>Promise<void>;report:(cause:unknown)=>void}) {
 const [tab,setTab]=useState<PanelTab>(initialTab);
 const [Content,setContent]=useState<ComponentType<WorkbenchPanelContentProps>>(),[loadError,setLoadError]=useState('');
 const thread=snapshot?.threads.find(value=>value.id===owner.threadId&&value.projectId===owner.projectId&&(value.workspaceId??null)===owner.workspaceId&&(!value.kind||value.kind==='main')&&!value.parentThreadId&&!value.sideParentId&&!value.jobId);
 const memoryOwner:MemoryOwner|undefined=owner.projectId&&thread?{projectId:owner.projectId,threadId:owner.threadId,accountId:thread.accountId??null}:undefined;
 const memoryKey=memoryOwner?JSON.stringify([memoryOwner.projectId,memoryOwner.threadId,memoryOwner.accountId]):'',memoryScope=useRef(memoryKey);memoryScope.current=memoryKey;
 const [memoryRequest,setMemoryRequest]=useState<{key:string}>(),[memoryError,setMemoryError]=useState('');
 const [memoryReview,setMemoryReview]=useState<{key:string;Component:ComponentType<ProjectMemoryReviewProps>}>();
 useEffect(()=>{
  let current=true;
  void import('./WorkbenchPanelContent').then(module=>{if(current)setContent(()=>module.WorkbenchPanelContent);}).catch(()=>{if(current)setLoadError('The source views could not be loaded. Close this panel to continue editing. Reload the window to retry. The draft was retained.');});
  return()=>{current=false;};
 },[]);
 useEffect(()=>{
  if(!memoryRequest)return;
  let current=true;
  void import('./ProjectMemoryReview').then(module=>{if(current&&memoryScope.current===memoryRequest.key)setMemoryReview({key:memoryRequest.key,Component:module.ProjectMemoryReview});}).catch(()=>{if(current&&memoryScope.current===memoryRequest.key)setMemoryError('The memory review could not be loaded. Close this panel to continue editing. Reload the window to retry. The draft was retained.');});
  return()=>{current=false;};
 },[memoryRequest]);
 const memoryOpen=Boolean(memoryOwner&&memoryRequest?.key===memoryKey),MemoryReview=memoryReview?.key===memoryKey?memoryReview.Component:undefined;
 const openMemoryReview=memoryOwner?()=>{setMemoryReview(undefined);setMemoryError('');setMemoryRequest({key:memoryKey});}:undefined;
 const activate=(next:PanelTab)=>{setTab(next);if(next==='sources')persistView('SOURCES');else if(next==='evidence')persistView('EVIDENCE');};
 return <><Modal open title="Sources and evidence" onClose={close} className="workbench-panel">
  <p>Task {owner.threadId} · Workspace {owner.workspaceId??'none'}</p>
  <div role="tablist" aria-label="Workbench views">{WB_TABS.map(([id,label],index)=><button key={id} type="button" role="tab" id={`wb-tab-${id}`} aria-selected={tab===id} aria-controls={`wb-panel-${id}`} tabIndex={tab===id?0:-1} autoFocus={tab===id} onClick={()=>activate(id)} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?WB_TABS.length-1:(index+(event.key==='ArrowRight'?1:-1)+WB_TABS.length)%WB_TABS.length;activate(WB_TABS[next][0]);(event.currentTarget.parentElement?.children[next] as HTMLButtonElement|undefined)?.focus();}}>{label}</button>)}</div>
  <div role="tabpanel" id={`wb-panel-${tab}`} aria-labelledby={`wb-tab-${tab}`} tabIndex={0}>
   {error&&<p role="alert">{error}</p>}
   {memoryOpen&&memoryError?<p role="alert">{memoryError}</p>:memoryOpen&&!MemoryReview&&<p role="status">Loading memory review.</p>}
   {loadError?<p role="alert">{loadError}</p>:Content?<Content tab={tab} setTab={setTab} snapshot={snapshot} owner={owner} enabled={enabled} candidates={candidates} capabilities={capabilities} selected={selected} evidence={evidence} error={error} api={api} view={view} persistView={persistView} onSelect={onSelect} attach={attach} open={open} openMemoryReview={openMemoryReview} report={report}/>:<p role="status">Loading source views.</p>}
  </div>
 </Modal>{memoryOpen&&MemoryReview&&memoryOwner&&<MemoryReview owner={memoryOwner} readOnly close={()=>setMemoryRequest(undefined)}/>}</>;
}
