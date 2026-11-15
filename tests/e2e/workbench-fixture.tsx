import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SourceSelectionActions} from '../../apps/web/src/SourceSelectionActions';
import {Markdown} from '../../apps/web/src/Markdown';
import {WorkbenchOutput} from '../../apps/web/src/WorkbenchOutput';
import {composeDraftContext,loadWorkbenchViews,prepareWorkbenchHandoff,readSourceDraft,saveWorkbenchView,updateSourceDraft} from '../../apps/web/src/workbench-recovery';
import {journalFlush,journalReadRecord,journalWrite} from '../../apps/web/src/journal';
import {sameLogicalOwner,type LogicalOwnerV1,type SourceRefV1} from '../../packages/contracts/source-selection';
import type {OutputScrollAnchor,WorkbenchOutputRow} from '../../apps/web/src/workbench-window';
const transformedMessage='| Column |\n| --- |\n| left\\|right |\n\nPlain later left|right';
function Fixture(){const [action,setAction]=useState('');return <main style={{padding:24}}><SourceSelectionActions text="Visible selected text from an assistant." enabled onAction={(kind,selection)=>setAction(kind+':'+selection.text)}><p id="source-text">Visible selected text from an assistant.</p></SourceSelectionActions><button id="background">Other pane</button><output>{action}</output><div data-source-id="forged">Forged selected text</div><section id="transformed-source"><SourceSelectionActions text={transformedMessage} enabled onAction={(kind,selection)=>setAction(kind+':'+selection.start)}><Markdown text={transformedMessage}/></SourceSelectionActions></section></main>;}

function createReadModels() {
  return Object.freeze({
    messages:Object.freeze(Array.from({length:10_000},(_,index)=>Object.freeze({id:`message:${index}`,revision:index}))),
    tasks:Object.freeze(Array.from({length:500},(_,index)=>Object.freeze({id:`task:${index}`,state:'unknown'}))),
    output:Object.freeze(Array.from({length:100_000},(_,index)=>Object.freeze({id:`line:${index}`,text:index===95_001?'retained needle beyond the mounted window':`Output line ${index}`}))),
  });
}
const secondOwnerRows = Object.freeze([{id:'line:0',text:'Other owner output'}]);
const deviceId = 'workbench-fixture-device';

function OutputFixture() {
  const [models] = useState(createReadModels);
  (window as unknown as {__m15ReadModels:typeof models}).__m15ReadModels=models;
  const [owner,setOwner] = useState<LogicalOwnerV1>({threadId:'thread-a',projectId:null,workspaceId:null});
  const [loadedOwner,setLoadedOwner] = useState(''),[loadState,setLoadState] = useState('Loading');
  const [draft,setDraft] = useState(''),[draftSave,setDraftSave] = useState('Saved'),[sourceCount,setSourceCount] = useState(0);
  const [anchor,setAnchor] = useState<OutputScrollAnchor|null>(null),[anchorSave,setAnchorSave] = useState('Saved');
  const [retainedRows,setRetainedRows] = useState<readonly WorkbenchOutputRow[]>(models.output),[revision,setRevision] = useState(0);
  const [fullReads,setFullReads] = useState(0),[holdReads,setHoldReads] = useState(false),[offline,setOffline] = useState(false);
  const [uncertain,setUncertain] = useState(false),[failFlush,setFailFlush] = useState(false),[handoff,setHandoff] = useState('Not requested');
  const [interaction,setInteraction] = useState(0);
  const [burstResult,setBurstResult] = useState('Not requested');
  const ownerIdentity=JSON.stringify(owner),currentOwner=useRef(ownerIdentity),hold=useRef(holdReads),disconnected=useRef(offline),releases=useRef<(()=>void)[]>([]);
  currentOwner.current=ownerIdentity;hold.current=holdReads;disconnected.current=offline;
  const rows=owner.threadId==='thread-a'?retainedRows:secondOwnerRows;
  const identity=useMemo(()=>({logicalOwner:owner,sourceId:'retained-output',sourceRevision:`revision-${revision}`}),[owner,revision]);
  const unwindowed=new URLSearchParams(location.search).get('mode')==='unwindowed';
  const ready=loadState==='Ready'&&loadedOwner===ownerIdentity;

  useEffect(()=>{
    let active=true;setLoadState('Loading');
    void Promise.all([journalReadRecord<string>(`draft:${owner.threadId}`),readSourceDraft(owner),loadWorkbenchViews(deviceId)]).then(([text,source,views])=>{
      if(!active)return;
      setDraft(text?.value??'');setSourceCount(source.sourceRefs.length);
      setAnchor(views.find(view=>sameLogicalOwner(view.logicalOwner,owner)&&view.viewType==='RUN')?.scrollAnchor??null);
      setLoadedOwner(ownerIdentity);setLoadState('Ready');setDraftSave('Saved');setAnchorSave('Saved');
    }).catch(cause=>{if(active)setLoadState(cause instanceof Error?cause.message:'Load failed');});
    return()=>{active=false;};
  },[owner,ownerIdentity]);

  const saveAnchor=useCallback((next:OutputScrollAnchor|null)=>{
    const capturedOwner=JSON.stringify(owner);setAnchor(next);setAnchorSave('Saving');
    void saveWorkbenchView({logicalOwner:owner,revision,viewType:'RUN',selectedItem:null,scrollAnchor:next,deviceId,updatedAt:new Date().toISOString()}).then(()=>{if(currentOwner.current===capturedOwner)setAnchorSave('Saved');}).catch(()=>{if(currentOwner.current===capturedOwner)setAnchorSave('Failed');});
  },[owner,revision]);
  const readFull=useCallback(async(signal:AbortSignal)=>{
    setFullReads(count=>count+1);
    if(hold.current)await new Promise<void>(resolve=>{releases.current.push(resolve);signal.addEventListener('abort',()=>resolve(),{once:true});});
    signal.throwIfAborted();
    if(disconnected.current)throw Error('Fixture host disconnected.');
    return {identity,rows,complete:true,trailingNewline:true};
  },[identity,rows]);
  const editDraft=(value:string)=>{
    const capturedOwner=ownerIdentity;setDraft(value);setDraftSave('Saving');
    void journalWrite(`draft:${owner.threadId}`,value).then(()=>{if(currentOwner.current===capturedOwner)setDraftSave('Saved');}).catch(()=>{if(currentOwner.current===capturedOwner)setDraftSave('Failed');});
  };
  const attach=async()=>{
    const capturedOwner=ownerIdentity;
    const ref:SourceRefV1={captureId:'fixture-capture',keepCaptured:false,source:{kind:'MESSAGE',sourceId:'message-a',sourceRevision:'a'.repeat(64),logicalOwner:owner,contentDigest:'a'.repeat(64),capturedAt:'2026-11-15T10:00:00.000Z',range:{encoding:'UTF16',start:1,end:3,selectedTextDigest:'b'.repeat(64)}}};
    const saved=await updateSourceDraft(owner,value=>({...value,sourceRefs:[ref]}));
    if(currentOwner.current===capturedOwner)setSourceCount(saved.sourceRefs.length);
  };
  const switchOwner=async()=>{
    const capturedOwner=ownerIdentity;
    const result=await prepareWorkbenchHandoff({draft:await composeDraftContext(owner),flush:async()=>{if(failFlush)throw Error('Simulated flush failure');await journalFlush();},acknowledge:async()=>uncertain?'UNCERTAIN':'ACKNOWLEDGED'});
    if(currentOwner.current!==capturedOwner)return;
    setHandoff(result.status==='CONFLICT'?`${result.status}:${result.reason}:${result.retained}`:'READY');
    if(result.status==='READY')setOwner({threadId:owner.threadId==='thread-a'?'thread-b':'thread-a',projectId:null,workspaceId:null});
  };
  const burstViews=async()=>{
    setBurstResult('Saving');
    try {
      const started=Date.now();
      await Promise.all(Array.from({length:32},(_,index)=>saveWorkbenchView({logicalOwner:owner,revision:1000+index,viewType:'RUN',selectedItem:null,scrollAnchor:{itemId:`line:${index}`,offset:0},deviceId,updatedAt:new Date(started+index).toISOString()})));
      const restored=(await loadWorkbenchViews(deviceId)).find(view=>sameLogicalOwner(view.logicalOwner,owner)&&view.viewType==='RUN');
      setBurstResult(`Saved:32:${restored?.scrollAnchor?.itemId}`);
    } catch(cause) {setBurstResult(cause instanceof Error?cause.message:'Failed');}
  };

  return <main style={{padding:16,maxWidth:1150,margin:'0 auto'}}>
    <style>{`:root{--text:#17202a;--muted:#53616e;--surface:#fff;--canvas:#f6f7f8;--border:#b8c0c8}body{margin:0;font:14px system-ui;background:var(--canvas);color:var(--text)}button,input,textarea{font:inherit}button{min-height:30px;max-width:100%}.fixture-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}.fixture-controls label{display:flex;gap:4px;align-items:center}.fixture-draft{display:block;box-sizing:border-box;width:100%;min-height:54px}.fixture-status{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0}.fixture-unwindowed{height:360px;overflow:auto;border:1px solid var(--border);background:var(--surface)}`}</style>
    <h1 style={{fontSize:18,margin:'0 0 8px'}}>M15 controlled renderer fixture</h1>
    <p>Reader: explicit fixture stub, not host authorization.</p>
    <div className="fixture-status"><span>Fixture <output data-fixture-ready>{ready?'Ready':loadState}</output></span><span>Owner <output data-fixture-owner>{owner.threadId}</output></span><span>Metadata 10,000; tasks 500; retained source lines 100,000</span></div>
    <div className="fixture-controls">
      <button type="button" data-benchmark-interaction onClick={()=>setInteraction(value=>(value+1)%models.messages.length)}>Select next message locally</button>
      <output data-interaction-result>{interaction}</output>
      <button type="button" onClick={()=>{setRetainedRows(current=>Object.freeze([...current,...Array.from({length:100},(_,index)=>Object.freeze({id:`line:${current.length+index}`,text:`Streamed output line ${current.length+index}`}))]));setRevision(value=>value+1);}}>Append 100 retained lines</button>
      <button type="button" disabled={!ready} onClick={()=>void switchOwner()}>Switch owner</button>
      <button type="button" disabled={!ready} onClick={()=>void attach()}>Attach fixture source</button>
      <button type="button" onClick={()=>{for(const release of releases.current.splice(0))release();}}>Release full reads</button>
      <button type="button" disabled={!ready} onClick={()=>void burstViews()}>Burst presentation writes</button>
    </div>
    <div className="fixture-controls">
      <label><input type="checkbox" checked={holdReads} onChange={event=>setHoldReads(event.target.checked)}/>Hold full reads</label>
      <label><input type="checkbox" checked={offline} onChange={event=>setOffline(event.target.checked)}/>Host disconnected</label>
      <label><input type="checkbox" checked={uncertain} onChange={event=>setUncertain(event.target.checked)}/>Uncertain handoff acknowledgment</label>
      <label><input type="checkbox" checked={failFlush} onChange={event=>setFailFlush(event.target.checked)}/>Fail journal flush</label>
    </div>
    <label>Fixture canonical draft<textarea className="fixture-draft" aria-label="Fixture canonical draft" value={draft} disabled={!ready} onChange={event=>editDraft(event.target.value)}/></label>
    <div className="fixture-status">
      <span>Draft <output data-draft-save>{draftSave}</output></span><span>Sources <output data-source-count>{sourceCount}</output></span><span>Anchor <output data-output-anchor>{anchor?`${anchor.itemId}:${anchor.offset}`:'none'}</output></span>
      <span>View <output data-anchor-save>{anchorSave}</output></span><span>Full reads <output data-full-read-count>{fullReads}</output></span><span>Handoff <output data-handoff-result>{handoff}</output></span>
      <span>Burst <output data-burst-result>{burstResult}</output></span>
    </div>
    {ready&&(unwindowed?<section aria-label="Controlled unwindowed output reference" className="fixture-unwindowed">{rows.map(row=><div key={row.id} data-output-row-id={row.id} className="workbench-output-row">{row.text}</div>)}</section>:<WorkbenchOutput identity={identity} rows={rows} state={offline?'offline':'ready'} readFull={readFull} initialAnchor={anchor} onAnchorChange={saveAnchor}/>)}
  </main>;
}

createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('fixture')==='output'?<OutputFixture/>:<Fixture/>);
