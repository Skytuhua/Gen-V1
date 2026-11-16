import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {DesktopBridge,DesktopContext,DesktopLayout} from '../../packages/desktop-contract';
import type {PanelPlacement,WorkspaceEnvelope} from '../../packages/contracts/workspace';
import {workspaceEnvelopeSchema} from '../../packages/contracts/workspace';
import {DesktopProvider} from '../../apps/web/src/desktop-context';
import {WorkspaceCanvas} from '../../apps/web/src/WorkspaceCanvas';
import {WorkspaceControls} from '../../apps/web/src/WorkspaceControls';
import {ProjectContextCard} from '../../apps/web/src/ProjectContextCard';
import {PlanStatus} from '../../apps/web/src/PlanStatus';
import {timelinePlan,timelineSnapshot} from './plan-timeline-fixture';
import '../../apps/web/src/styles.css';

const fixtureWindow=window as typeof window&{
 __workspaceCalls:[string,unknown][];__failApply?:boolean;__failPrepare?:boolean;__planOpen:()=>void;
};
fixtureWindow.__workspaceCalls=[];
const record=(type:string,payload:unknown)=>fixtureWindow.__workspaceCalls.push([type,structuredClone(payload)]);
const nativeLayout:DesktopLayout={version:1,windows:[{surface:{kind:'main'},bounds:{x:0,y:0,width:1200,height:800},visible:true,alwaysOnTop:false}]};
const desktopContext:DesktopContext={windowId:'main',surface:{kind:'main'},windows:[{id:'main',surface:{kind:'main'},ready:true,minimized:false,visible:true}]};
const unsupported=async()=>{throw Error('This fixture does not support native window mutation.');};
const bridge:DesktopBridge={getContext:async()=>desktopContext,ready:async()=>desktopContext,
 detach:unsupported,reattach:unsupported,minimize:unsupported,signIn:unsupported,resetBounds:unsupported,focus:unsupported,browser:unsupported,
 list:async()=>desktopContext.windows,onState:()=>()=>{},onCloseRequested:()=>()=>{},
 control:async value=>{record('native.control',value);throw Error('Canvas controls must not change native windows.');},
 captureLayout:async()=>structuredClone(nativeLayout),
 applyLayout:async value=>{record('native.applyLayout',value);if(fixtureWindow.__failApply){fixtureWindow.__failApply=false;throw Error('Synthetic native readiness failure');}},
};
const sourcePanel:PanelPlacement={id:'source-panel',kind:'files',canvasId:'canvas',binding:{authority:{kind:'local'},projectId:'project'},placement:'canvas',visible:true,collapsed:false,bounds:{x:24,y:56,width:480,height:500},order:0,alwaysOnTop:false};
const canvas={version:1 as const,id:'canvas',name:'Fixture canvas',preset:'custom' as const,viewport:{x:0,y:0,zoom:1},filter:'all' as const,projectIds:[],panels:[sourcePanel]};
const initial:WorkspaceEnvelope={projects:[],state:{version:1,revision:0,activeCanvasId:'canvas',canvases:[canvas],disabledKinds:[],integrations:{},profiles:[{version:1,id:'profile',name:'Fixture recovery',activeCanvasId:'canvas',canvases:[{...structuredClone(canvas),name:'Recovered canvas',panels:[]}],disabledKinds:[],integrations:{},nativeLayout,createdAt:'2026-11-02T00:00:00Z',updatedAt:'2026-11-02T00:00:00Z'}]}};
const plan=timelinePlan();plan.title='Validated fixture plan';plan.steps=[];
plan.agents=plan.agents.filter(job=>job.id==='ui'||job.id==='available').map(({stepId,...job})=>job);
const snapshot=timelineSnapshot('fixture-task');snapshot.data[0].value=plan;

function Fixture(){
 const [envelope,setEnvelope]=useState(()=>workspaceEnvelopeSchema.parse(structuredClone(initial))),latest=useRef(envelope);latest.current=envelope;
 const [planOpen,setPlanOpen]=useState(false);fixtureWindow.__planOpen=()=>setPlanOpen(true);
 const publish=(next:WorkspaceEnvelope)=>{const value=workspaceEnvelopeSchema.parse(next);latest.current=value;setEnvelope(value);return value;};
 const send=async(type:string,payload:Record<string,unknown>={})=>{
  record(type,payload);const next=structuredClone(latest.current);
  if(type==='workspace.profile.apply'){
   const profile=next.state.profiles.find(value=>value.id===payload.profileId);if(!profile)throw Error('Missing fixture profile');
   Object.assign(next.state,{activeCanvasId:profile.activeCanvasId,canvases:profile.canvases,disabledKinds:profile.disabledKinds,integrations:profile.integrations,nativeLayout:profile.nativeLayout});
  }else if(type==='workspace.profile.restore')next.state=structuredClone(payload.state as WorkspaceEnvelope['state']);
  else if(type==='workspace.panel.update'){
   const panel=next.state.canvases.flatMap(value=>value.panels).find(value=>value.id===payload.panelId);if(!panel)throw Error('Missing fixture panel');Object.assign(panel,payload.patch);
  }else throw Error('Unsupported fixture workspace command');
  next.state.revision++;return publish(next);
 };
 const prepare=async()=>{if(fixtureWindow.__failPrepare)throw Error('Synthetic draft flush refused');};
 const updatePanel=async(panel:PanelPlacement,patch:Partial<PanelPlacement>)=>{await send('workspace.panel.update',{panelId:panel.id,patch});};
 const active=envelope.state.canvases.find(value=>value.id===envelope.state.activeCanvasId)!;
 return <DesktopProvider bridge={bridge} context={desktopContext}><main style={{height:'100vh',display:'flex',flexDirection:'column'}}>
  <label>Outside composer<input aria-label="Outside composer"/></label>
  <WorkspaceControls envelope={envelope} send={send} prepare={prepare} panels={active.panels} title={()=>'Granted files'} addPanel={unsupported} updatePanel={updatePanel} workspaceMode="retained-canvas"/>
  <div style={{display:'grid',gridTemplateColumns:'minmax(600px,1fr) 420px',flex:1,minHeight:0}}>
   <WorkspaceCanvas canvas={active} panels={active.panels} projects={[]} disabledKinds={[]} title={()=>'Granted files'} updatePanel={updatePanel} updateViewport={async viewport=>{const next=structuredClone(latest.current);next.state.canvases[0].viewport=viewport;publish(next);}} setFilter={unsupported} renderBody={()=><p>Granted file contents</p>}/>
   <ProjectContextCard threadTitle="Fixture project" plan={<PlanStatus snapshot={snapshot} threadId="fixture-task"/>} planOpen={planOpen} onTogglePlan={()=>setPlanOpen(value=>!value)}/>
  </div>
 </main></DesktopProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
