import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceCanvas} from '../../apps/web/src/WorkspaceCanvas';
import type {CanvasLayout} from '../../packages/contracts/workspace';
import '../../apps/web/src/styles.css';

function ArtifactBody({active}:{active:boolean}){
 const [draft,setDraft]=useState('');useEffect(()=>{(window as any).__artifactMounts=((window as any).__artifactMounts??0)+1;},[]);
 return <div data-artifact-active={active}><label>Artifact edit<input aria-label="Artifact edit" value={draft} onChange={event=>setDraft(event.target.value)}/></label></div>;
}
function Fixture(){
 const [canvas,setCanvas]=useState<CanvasLayout>({version:1,id:'artifact-canvas',name:'Artifact custody',preset:'custom',viewport:{x:0,y:0,zoom:1},filter:'all',projectIds:[],panels:[{id:'artifact-panel',kind:'artifact',canvasId:'artifact-canvas',binding:{authority:{kind:'local'},threadId:'task',artifactId:'artifact'},placement:'canvas',visible:true,collapsed:false,bounds:{x:24,y:56,width:480,height:500},order:0,alwaysOnTop:false}]});
 (window as any).__moveArtifactOffscreen=(offscreen:boolean)=>setCanvas(value=>({...value,panels:value.panels.map(panel=>({...panel,bounds:{...panel.bounds,x:offscreen?9000:24}}))}));
 return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}><WorkspaceCanvas canvas={canvas} panels={canvas.panels} projects={[]} disabledKinds={[]} title={()=>'Artifact fixture'} updatePanel={async(panel,patch)=>setCanvas(value=>({...value,panels:value.panels.map(item=>item.id===panel.id?{...item,...patch}:item)}))} updateViewport={async viewport=>setCanvas(value=>({...value,viewport}))} setFilter={async()=>{}} renderBody={(_panel,active)=><ArtifactBody active={active}/>}/></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
