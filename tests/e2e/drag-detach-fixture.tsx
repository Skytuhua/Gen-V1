import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FloatingWindow} from '../../apps/web/src/FloatingWindow';
import {WorkspaceCanvas} from '../../apps/web/src/WorkspaceCanvas';
import type {CanvasLayout,PanelPlacement} from '../../packages/contracts/workspace';
import '../../apps/web/src/styles.css';

const params=new URLSearchParams(location.search),surface=params.get('surface')??'floating',mode=params.get('mode')??'success';
const events:{detach:number;updates:number;states:unknown[]}={detach:0,updates:0,states:[]};
Object.assign(window,{dragDetachEvents:events});
const initial:CanvasLayout={version:1,id:'detach-test',name:'Detach fixture',preset:'custom',viewport:{x:0,y:0,zoom:1},panels:[],filter:'active',projectIds:[]};
const initialPanel:PanelPlacement={id:'detach-panel',kind:params.get('kind')==='notes'?'notes':'thread',binding:{authority:{kind:'local'},threadId:'thread'},canvasId:initial.id,placement:'canvas',visible:true,collapsed:false,bounds:{x:56,y:100,width:400,height:320},order:0,alwaysOnTop:false};
async function detach(){events.detach++;if(mode==='failure')throw new Error('Opening the window was rejected.');}
function Fixture(){
 const[panel,setPanel]=useState(initialPanel);
 const body=<label>Panel draft<textarea defaultValue="Draft survives detach"/></label>;
 if(surface==='canvas')return <main style={{width:900,height:'100vh',marginLeft:100,display:'flex'}}><WorkspaceCanvas canvas={initial} panels={[panel]} projects={[]} disabledKinds={[]} title={()=>'Movable panel'} renderBody={()=>body} updateViewport={async()=>{}} setFilter={async()=>{}} updatePanel={async(_panel,patch)=>{events.updates++;setPanel(value=>({...value,...patch}));}} detach={mode==='none'?undefined:detach}/></main>;
 return <FloatingWindow id="drag-detach-floating" title="Movable panel" defaultSize={{width:400,height:320}} onDetach={mode==='none'?undefined:detach}>{body}</FloatingWindow>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
