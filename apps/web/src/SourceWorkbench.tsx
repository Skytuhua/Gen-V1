import {createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {Snapshot} from '../../../packages/contracts';
import {WorkbenchRequestPanel,WorkbenchRunPanel} from './WorkbenchPanels';
import {WorkbenchInputsPanel} from './WorkbenchInputsPanel';
import {pendingInputRecoveries,recoverWorkbenchInput} from './workbench-input-recovery';
import {registerEditorHandoff} from './editor-handoff';
import {
 selectedSourceV1Schema, type CapturedSourceV1, type LogicalOwnerV1, type SelectedSourceV1,
 type SourceCandidateV1, type SourceCapabilityV1, type SourceDescriptorV1, type SourceOpenV1, type SourceRefV1, type WorkbenchEvidenceItemV1, type WorkbenchModuleV1, type WorkbenchViewV1,type WorkbenchInputV1,type WorkbenchInputRecoveryRequestV1,
} from '../../../packages/contracts/source-selection';
import {SourceSelectionActions, type SourceSelectionAction, type VisibleSourceSelection} from './SourceSelectionActions';
import {WorkbenchOutput} from './WorkbenchOutput';
import {useModalRegion} from './focus';
import {journalCompareAndSwap, journalReadRecord, journalSubscribe} from './journal';
import {composeDraftContext, loadWorkbenchViews, prepareWorkbenchHandoff, readSourceDraft, saveWorkbenchView, sourceDraftKey, updateSourceDraft, type SourceDraftSnapshot} from './workbench-recovery';
import {messageSelection, workbenchApi, type WorkbenchApi} from './workbench-api';
import './source-workbench.css';

const ownerKey=(owner?:LogicalOwnerV1)=>owner?JSON.stringify([owner.threadId,owner.projectId,owner.workspaceId]):'';
const messageOf=(cause:unknown)=>cause instanceof Error?cause.message:'The source could not be read. The draft was retained.';
function sourceRange(ref:SourceRefV1){const source=ref.source;switch(source.kind){case 'MESSAGE':return `UTF-16 [${source.range.start}, ${source.range.end})`;case 'FILE_RANGE':return `Lines ${source.range.startLine} to ${source.range.endLine}`;case 'DIFF_HUNK':return `Hunk lines ${source.range.startLine} to ${source.range.endLine}`;case 'ARTIFACT_REGION':return `Binding ${source.binding}, pointer ${source.range.pointer||'(root)'}`;}}
function localDevice(){try{const key='harness:workbench-device',existing=localStorage.getItem(key);if(existing)return existing;const id=crypto.randomUUID();localStorage.setItem(key,id);return id;}catch{return 'local-window';}}
type PanelTab='sources'|'evidence'|'request'|'tools'|'run';
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
  if(owner&&(await readSourceDraft(owner)).sourceRefs.length){
   const result=await prepareWorkbenchHandoff({draft:await composeDraftContext(owner),acknowledge:async()=> (await journalReadRecord(`agents-pending:${owner.threadId}`))?.value?'UNCERTAIN':'ACKNOWLEDGED'});
   if(result.status!=='READY')throw Error(result.message);
  }
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
  const value=await updateSourceDraft(owner,fn);if(isCurrent())setDraft({scope,value});
 };
 const show=(tab?:PanelTab)=>{setInitialTab(tab??(view?.viewType==='EVIDENCE'?'evidence':'sources'));setPanelScope(scope);setSelected(undefined);setError(undefined);void reloadInputs();if(owner)void api.evidence(owner,controller.current?.signal).then(value=>{if(isCurrent())setEvidence({scope,...value});}).catch(report);};
 const open=async(ref:SourceRefV1)=>{
  if(!owner)return;const value=await api.open(owner,ref,controller.current?.signal);
  if(!isCurrent())return;remember(value);setSelected(value);setInitialTab('sources');setPanelScope(scope);persistView('SOURCES',ref.captureId,view?.selectedItem===ref.captureId?view.scrollAnchor:null);
 };
 const attach=async(source:SelectedSourceV1,action:SourceSelectionAction)=>{
  if(!owner||!enabled||!isCurrent())throw Error('Source selection is unavailable for this conversation.');
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
  async refresh(ref){if(!owner||!enabled)return;const value=await api.refresh(owner,ref,controller.current?.signal);if(!isCurrent())return;remember(value);await change(state=>({...state,sourceRefs:state.sourceRefs.map(item=>item.captureId===ref.captureId?value.ref:item)}));},
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
   <label>Delivery <select aria-label="Source delivery mode" disabled={disabled} value={context.draft?.sendMode??'NOW'} onChange={event=>run(()=>context.setMode(event.target.value as 'NOW'|'AFTER_CURRENT'))}><option value="NOW">Now</option><option value="AFTER_CURRENT" disabled={!context.enabled}>After current run</option></select></label>
   {working&&<span>After current run queues this prompt without interrupting the active run.</span>}
  </div>
  {!context.enabled&&<p role="status">New source actions are disabled. Retained sources remain available to inspect or remove.</p>}
  {(context.inputs.length>0||context.pendingRecoveries.length>0)&&<p><button type="button" onClick={()=>context.show('run')}>Inspect queued source inputs</button> {context.inputs.length} accepted input{context.inputs.length===1?'':'s'} with retained sources. {context.pendingRecoveries.length>0&&'A recovery acknowledgment is unconfirmed.'}</p>}
  {(context.error||localError)&&<p role="alert">{localError||context.error}</p>}
  <div className="workbench-source-chips">{context.draft?.sourceRefs.map(ref=>{const source=context.sources[ref.captureId],state=source?.state;return <article key={ref.captureId} className="workbench-source-chip" aria-label={`Selected source ${source?.label??ref.source.sourceId}`}>
   <header><span>{source?.label??ref.source.sourceId} · {ref.source.kind}</span><button type="button" disabled={disabled} onClick={()=>run(()=>context.open(ref))}>Open source</button><button type="button" disabled={disabled} onClick={()=>run(()=>context.remove(ref))}>Remove source</button></header>
   <small>Revision {ref.source.sourceRevision} · {sourceRange(ref)} · Captured {ref.source.capturedAt}</small>
   {source&&<pre>{source.preview}{source.previewTruncated?'\nPreview truncated. Open source for the complete capture.':''}</pre>}
   {state&&state!=='CURRENT'&&<div role="status">{state==='STALE'?'The source has changed.':'The original source is unavailable.'} {ref.keepCaptured?'Using the retained capture.':'Refresh or explicitly keep the retained capture before sending.'}<div className="workbench-source-actions"><button type="button" disabled={disabled||!context.enabled} onClick={()=>run(()=>context.refresh(ref))}>Refresh source</button><button type="button" disabled={disabled||ref.keepCaptured} onClick={()=>run(()=>context.keep(ref))}>Keep captured source</button></div></div>}
  </article>;})}</div>
 </section>;
}

function WorkbenchDialog({initialTab,snapshot,owner,enabled,candidates,capabilities,selected,evidence,error,api,view,persistView,close,onSelect,attach,open,report}:{initialTab:PanelTab;snapshot?:Snapshot;owner:LogicalOwnerV1;enabled:boolean;candidates:SourceCandidateV1[];capabilities:SourceCapabilityV1[];selected?:SourceDescriptorV1|SourceOpenV1;evidence?:{items:WorkbenchEvidenceItemV1[];modules:WorkbenchModuleV1[]};error:string;api:WorkbenchApi;view?:WorkbenchViewV1;persistView:(type:'SOURCES'|'EVIDENCE',selectedItem?:string|null,anchor?:WorkbenchViewV1['scrollAnchor'])=>void;close:()=>void;onSelect:(candidate:SourceCandidateV1)=>Promise<void>;attach:(source:SelectedSourceV1,action:SourceSelectionAction)=>Promise<void>;open:(ref:SourceRefV1)=>Promise<void>;report:(cause:unknown)=>void}) {
 const region=useRef<HTMLElement>(null);useModalRegion(region,true,close,'[data-workbench-close]');
 const [tab,setTab]=useState<PanelTab>(initialTab);
 const [evidenceKind,setEvidenceKind]=useState('ALL');
 return createPortal(<div className="workbench-backdrop"><section ref={region} className="workbench-panel" role="dialog" aria-modal="true" aria-label="Sources and evidence" tabIndex={-1}>
  <header><h2>Sources and evidence</h2><button type="button" data-workbench-close onClick={close}>Close</button></header><p>Task {owner.threadId} · Workspace {owner.workspaceId??'none'}</p>
  <nav aria-label="Workbench views"><button type="button" aria-pressed={tab==='request'} onClick={()=>setTab('request')}>Last request</button><button type="button" aria-pressed={tab==='tools'} onClick={()=>setTab('tools')}>Tools</button><button type="button" aria-pressed={tab==='run'} onClick={()=>setTab('run')}>Run</button><button type="button" aria-pressed={tab==='sources'} onClick={()=>{setTab('sources');persistView('SOURCES');}}>Sources</button><button type="button" aria-pressed={tab==='evidence'} onClick={()=>{setTab('evidence');persistView('EVIDENCE');}}>Evidence</button></nav>
  {error&&<p role="alert">{error}</p>}
  {tab==='evidence'&&!evidence&&!error&&<p role="status">Loading task evidence.</p>}
  {(tab==='request'||tab==='tools')&&<WorkbenchRequestPanel key={tab} owner={owner} tools={tab==='tools'}/>}
  {tab==='run'&&<><WorkbenchRunPanel owner={owner} snapshot={snapshot}/><WorkbenchInputsPanel onInspect={async ref=>{await open(ref);setTab('sources');}}/></>}
  {tab==='sources'?<><p>Captured context is quoted input. It does not grant file, tool, or write permission.</p>{!enabled&&<p>New captures are disabled.</p>}
   {capabilities.filter(capability=>capability.state==='UNSUPPORTED').map(capability=><p key={capability.kind} role="status">{capability.kind}: Unsupported. {capability.reason}</p>)}
   {enabled&&<div className="workbench-source-actions" aria-label="Available sources">{candidates.map((candidate,index)=><button type="button" key={index} onClick={()=>{void onSelect(candidate);}}>{candidate.locator.kind}: {candidate.label}</button>)}{candidates.length===0&&<p>No supported sources are available for this owner.</p>}</div>}
   {selected&&('ref' in selected?<RetainedSourceOutput owner={owner} source={selected} api={api} view={view} persistView={persistView}/>:<DescriptorSelection key={JSON.stringify(selected.locator)+selected.sourceRevision} descriptor={selected} attach={attach} report={report}/>)}
  </>:tab==='evidence'?<><p>Reported is a claim. Observed is a recorded event or result. Verified requires linked verification evidence.</p><p role="status">Historical log and screenshot opening is unsupported here: the owning verification service has no authorized retained-artifact read contract. References below identify recorded evidence; captured source links open exact retained bytes.</p>
   <nav aria-label="Evidence categories">{[['ALL','All'],['REQUIREMENT','Requirements'],['CHECK','Checks'],['ARTIFACT','Artifacts'],['SOURCE','Sources']].map(([kind,label])=><button type="button" key={kind} aria-pressed={evidenceKind===kind} onClick={()=>setEvidenceKind(kind)}>{label}</button>)}</nav>
   {evidence?.items.filter(item=>evidenceKind==='ALL'||item.kind===evidenceKind).map(item=><article className="workbench-evidence-item" key={item.id}><h3>{item.label}</h3><dl><dt>Evidence</dt><dd>{item.grade}</dd><dt>Freshness</dt><dd>{item.freshness}</dd><dt>Outcome</dt><dd>{item.outcome??'Not recorded'}</dd><dt>Revision</dt><dd>{item.sourceRevision??'Not recorded'}</dd>{item.parentId&&<><dt>Parent</dt><dd>{item.parentId}</dd></>}{item.command&&<><dt>Command</dt><dd><code>{JSON.stringify(item.command)}</code></dd></>}<dt>Logs</dt><dd>{item.logRefs.join(', ')||'Not recorded'}</dd><dt>Screenshots</dt><dd>{item.screenshotRefs.join(', ')||'Not recorded'}</dd></dl>{item.sourceRef&&<button type="button" onClick={()=>{void open(item.sourceRef!).then(()=>setTab('sources')).catch(report);}}>Open evidence source</button>}</article>)}
   {evidence?.items.length===0&&<p>No evidence is recorded for this task.</p>}
   <h3>Module panels</h3>{evidence?.modules.map(module=><article key={module.id}><h4>{module.id}: {module.title}</h4><p>{module.state}{module.reason?`: ${module.reason}`:''}</p>{module.state==='AVAILABLE'&&module.href?.startsWith('/api/')&&<a href={module.href} target="_blank" rel="noreferrer">Open module record</a>}</article>)}
  </>:null}
 </section></div>,document.body);
}
function RetainedSourceOutput({owner,source,api,view,persistView}:{owner:LogicalOwnerV1;source:SourceOpenV1;api:WorkbenchApi;view?:WorkbenchViewV1;persistView:(type:'SOURCES',selectedItem:string,anchor:WorkbenchViewV1['scrollAnchor'])=>void}) {
 const identity=useMemo(()=>({logicalOwner:owner,sourceId:source.ref.captureId,sourceRevision:source.ref.source.sourceRevision}),[ownerKey(owner),source.ref.captureId,source.ref.source.sourceRevision]);
 const rows=useMemo(()=>source.text.split('\n').map((text,index)=>({id:`line:${index+1}`,text})),[source.text]);
 const readFull=useMemo(()=>(signal:AbortSignal)=>api.open(owner,source.ref,signal).then(value=>({identity,rows:value.text.split('\n').map((text,index)=>({id:`line:${index+1}`,text})),complete:true})),[api,identity,source.ref]);
 return <><h3>{source.label}</h3><p>{source.state==='CURRENT'?'Captured source':source.state==='STALE'?'Source changed; showing the exact retained capture.':'Original unavailable; showing the exact retained capture.'} Revision {source.ref.source.sourceRevision}</p><WorkbenchOutput identity={identity} rows={rows} readFull={readFull} initialAnchor={view?.selectedItem===source.ref.captureId?view.scrollAnchor:null} onAnchorChange={anchor=>persistView('SOURCES',source.ref.captureId,anchor)} state={source.state==='CURRENT'?'ready':'stale'} label="Captured source output"/></>;
}
function DescriptorSelection({descriptor,attach,report}:{descriptor:SourceDescriptorV1;attach:(source:SelectedSourceV1,action:SourceSelectionAction)=>Promise<void>;report:(cause:unknown)=>void}) {
 const [start,setStart]=useState(1),[end,setEnd]=useState(1),[pointer,setPointer]=useState(''),[busy,setBusy]=useState(false);
 const lines=useMemo(()=>descriptor.text.split('\n'),[descriptor.text]),locator=descriptor.locator;
 const hunks=useMemo(()=>{const starts=lines.flatMap((line,index)=>/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line)?[index+1]:[]);return starts.map((start,index)=>({start,end:(starts[index+1]??lines.length+1)-1}));},[lines]);
 const rows=useMemo(()=>lines.map((text,index)=>({id:`line:${index+1}`,text})),[lines]);
 const run=async(action:SourceSelectionAction,range?:{start:number;end:number})=>{
  setBusy(true);try{
   const common={...locator,logicalOwner:descriptor.logicalOwner,sourceRevision:descriptor.sourceRevision,contentDigest:descriptor.contentDigest,capturedAt:new Date().toISOString()};
   const source=locator.kind==='MESSAGE'?await messageSelection(descriptor,range?.start??0,range?.end??descriptor.text.length):selectedSourceV1Schema.parse({...common,range:locator.kind==='FILE_RANGE'?{encoding:'LINES_1_BASED',startLine:start,endLine:end}:locator.kind==='DIFF_HUNK'?{encoding:'DIFF_LINES_1_BASED',startLine:start,endLine:end}:{encoding:'JSON_POINTER',pointer}});
   await attach(source,action);
  }catch(cause){report(cause);}finally{setBusy(false);}
 };
 return <section><h3>{descriptor.label}</h3><p>Revision {descriptor.sourceRevision}</p>
  {locator.kind==='MESSAGE'?<SourceSelectionActions text={descriptor.text} enabled={!busy} onAction={(action,selection)=>run(action,selection)}><pre>{descriptor.text}</pre></SourceSelectionActions>:<WorkbenchOutput identity={{logicalOwner:descriptor.logicalOwner,sourceId:locator.sourceId,sourceRevision:descriptor.sourceRevision}} rows={rows} label="Source preview"/>}
  {locator.kind==='FILE_RANGE'&&<div className="workbench-source-actions"><label>First line <input type="number" min={1} max={lines.length} value={start} onChange={event=>setStart(event.target.valueAsNumber)}/></label><label>Last line <input type="number" min={start} max={lines.length} value={end} onChange={event=>setEnd(event.target.valueAsNumber)}/></label><span>Complete lines are captured.</span></div>}
  {locator.kind==='DIFF_HUNK'&&<label>Diff hunk <select aria-label="Diff hunk" value={hunks.some(h=>h.start===start)?String(start):''} onChange={event=>{const hunk=hunks.find(h=>h.start===Number(event.target.value));if(hunk){setStart(hunk.start);setEnd(hunk.end);}}}><option value="" disabled>Select a complete hunk</option>{hunks.map(hunk=><option key={hunk.start} value={hunk.start}>{lines[hunk.start-1]}</option>)}</select></label>}
  {locator.kind==='ARTIFACT_REGION'&&<label>JSON pointer within declared binding <input aria-label="Artifact JSON pointer" value={pointer} onChange={event=>setPointer(event.target.value)}/></label>}
  <div className="workbench-source-actions">{(['ask','attach','open'] as const).map((action,index)=><button key={action} type="button" disabled={busy||locator.kind==='DIFF_HUNK'&&!hunks.some(h=>h.start===start)} onClick={()=>{void run(action);}}>{['Ask about this','Attach to prompt','Open source'][index]}</button>)}</div>
 </section>;
}
