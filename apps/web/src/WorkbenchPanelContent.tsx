import {useMemo,useState} from 'react';
import type {Snapshot} from '../../../packages/contracts';
import {Select} from '../../../packages/ui-shell/Select';
import {selectedSourceV1Schema,type LogicalOwnerV1,type SelectedSourceV1,type SourceCandidateV1,type SourceCapabilityV1,type SourceDescriptorV1,type SourceOpenV1,type SourceRefV1,type WorkbenchEvidenceItemV1,type WorkbenchModuleV1,type WorkbenchViewV1} from '../../../packages/contracts/source-selection';
import {SourceSelectionActions,type SourceSelectionAction} from './SourceSelectionActions';
import {WorkbenchRequestPanel,WorkbenchRunPanel} from './WorkbenchPanels';
import {WorkbenchInputsPanel} from './WorkbenchInputsPanel';
import {WorkbenchOutput} from './WorkbenchOutput';
import {messageSelection,type WorkbenchApi} from './workbench-api';

const ownerKey=(owner:LogicalOwnerV1)=>JSON.stringify([owner.threadId,owner.projectId,owner.workspaceId]);
export type WorkbenchPanelTab='sources'|'evidence'|'request'|'tools'|'run';
export interface WorkbenchPanelContentProps {
 tab:WorkbenchPanelTab; setTab:(tab:WorkbenchPanelTab)=>void; snapshot?:Snapshot; owner:LogicalOwnerV1; enabled:boolean;
 candidates:SourceCandidateV1[]; capabilities:SourceCapabilityV1[]; selected?:SourceDescriptorV1|SourceOpenV1;
 evidence?:{items:WorkbenchEvidenceItemV1[];modules:WorkbenchModuleV1[]}; error:string; api:WorkbenchApi; view?:WorkbenchViewV1;
 persistView:(type:'SOURCES'|'EVIDENCE',selectedItem?:string|null,anchor?:WorkbenchViewV1['scrollAnchor'])=>void;
 onSelect:(candidate:SourceCandidateV1)=>Promise<void>;
 attach:(source:SelectedSourceV1,action:SourceSelectionAction)=>Promise<void>;
 open:(ref:SourceRefV1)=>Promise<void>; report:(cause:unknown)=>void;
}

/** Optional views load only after the stable dialog shell opens. */
export function WorkbenchPanelContent({tab,setTab,snapshot,owner,enabled,candidates,capabilities,selected,evidence,error,api,view,persistView,onSelect,attach,open,report}:WorkbenchPanelContentProps) {
 const [evidenceKind,setEvidenceKind]=useState('ALL');
 return <>
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
 </>;
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
  {locator.kind==='DIFF_HUNK'&&<label>Diff hunk <Select aria-label="Diff hunk" value={hunks.some(h=>h.start===start)?String(start):''} onValueChange={value=>{const hunk=hunks.find(h=>h.start===Number(value));if(hunk){setStart(hunk.start);setEnd(hunk.end);}}} options={[{value:'',label:'Select a complete hunk',disabled:true},...hunks.map(hunk=>({value:String(hunk.start),label:lines[hunk.start-1]!}))]}/></label>}
  {locator.kind==='ARTIFACT_REGION'&&<label>JSON pointer within declared binding <input aria-label="Artifact JSON pointer" value={pointer} onChange={event=>setPointer(event.target.value)}/></label>}
  <div className="workbench-source-actions">{(['ask','attach','open'] as const).map((action,index)=><button key={action} type="button" disabled={busy||locator.kind==='DIFF_HUNK'&&!hunks.some(h=>h.start===start)} onClick={()=>{void run(action);}}>{['Ask about this','Attach to prompt','Open source'][index]}</button>)}</div>
 </section>;
}
