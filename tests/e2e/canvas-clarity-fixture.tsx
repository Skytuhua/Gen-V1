import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import type {Thread} from '../../packages/contracts/index.ts';
import type {CanvasLayout,PanelPlacement} from '../../packages/contracts/workspace.ts';
import {WorkspaceCanvas} from '../../apps/web/src/WorkspaceCanvas';
import {liveThreadPanels} from '../../apps/web/src/workspace-canvas-layout';
import '../../apps/web/src/styles.css';

const embedded=new URLSearchParams(location.search).has('embedded');

declare global {
  interface Window {
    __canvasMounts: Record<string, number>;
    __switchCanvas: (id: string) => void;
    __canvasFixture: { canvas: CanvasLayout; panels: PanelPlacement[]; saved: Record<string, CanvasLayout> };
    __canvasDetachCalls?: number;
    __canvasPanelWrites?: { canvasId: string; panelId: string; patch: unknown }[];
    __canvasViewportWrites?: ({ canvasId: string } & Record<string, unknown>)[];
    __delayFirstCanvasWrite?: boolean;
    __resolveCanvasWrite: () => void;
    __rejectCanvasWrite: () => void;
  }
}

const threads=[{id:'parent',title:'Main investigation',projectId:'project',projectName:'Example project',status:'working',runId:'run'},{id:'child',title:'Independent reader',projectId:'project',projectName:'Example project',parentThreadId:'parent',kind:'delegate',status:'ready',runId:null}] as Thread[];
const initial:CanvasLayout={version:1,id:'clarity',name:'Agent workspace',preset:'all-agents',viewport:{x:0,y:0,zoom:1},panels:[],filter:'active',projectIds:[]};
function Body({panel}:{panel:PanelPlacement}){
 useEffect(()=>{window.__canvasMounts=window.__canvasMounts??{};window.__canvasMounts[panel.id]=(window.__canvasMounts[panel.id]??0)+1;},[]);
 return <div style={{padding:16}}><textarea aria-label={`Draft ${panel.binding.threadId}`} defaultValue=""/><div style={{height:1500}}>Long transcript</div></div>;
}
function Fixture(){
 const [active,setActive]=useState('clarity'),[canvases,setCanvases]=useState<Record<string,CanvasLayout>>({clarity:initial,other:{...initial,id:'other',name:'Second workspace'}}),[panelSets,setPanelSets]=useState<Record<string,PanelPlacement[]>>(()=>({clarity:liveThreadPanels(threads,initial),other:liveThreadPanels(threads,{...initial,id:'other'})}));
 const canvas=canvases[active],panels=panelSets[active],owner=canvas.id;
 window.__switchCanvas=(id:string)=>flushSync(()=>setActive(id));window.__canvasFixture={canvas,panels,saved:canvases};
 return <div style={{height:'100vh',display:'flex'}}><WorkspaceCanvas embedded={embedded} canvas={canvas} panels={panels} threads={threads} projects={[{id:'project',name:'Example project',authority:{kind:'local'},createdAt:'2026-11-04'}]} disabledKinds={[]} title={panel=>threads.find(thread=>thread.id===panel.binding.threadId)?.title??panel.id} renderBody={panel=><Body panel={panel}/>} detach={async()=>{window.__canvasDetachCalls=(window.__canvasDetachCalls??0)+1;}} setFilter={async filter=>setCanvases(current=>({...current,[owner]:{...current[owner],filter}}))} updatePanel={async(panel,patch)=>{window.__canvasPanelWrites??=[];window.__canvasPanelWrites.push({canvasId:owner,panelId:panel.id,patch});setPanelSets(current=>({...current,[owner]:current[owner].map(value=>value.id===panel.id?{...value,...patch}:value)}));}} updateViewport={async value=>{window.__canvasViewportWrites??=[];window.__canvasViewportWrites.push({canvasId:owner,...value});if(window.__delayFirstCanvasWrite&&window.__canvasViewportWrites.length===1)await new Promise<void>((resolve,reject)=>{window.__resolveCanvasWrite=resolve;window.__rejectCanvasWrite=()=>reject(new Error('Delayed viewport failure'));});setCanvases(current=>({...current,[owner]:{...current[owner],viewport:value}}));}}/></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
