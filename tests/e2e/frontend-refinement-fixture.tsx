import {useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ChatScrollIndicator} from '../../apps/web/src/ChatScrollIndicator';
import {createConversationScroll} from '../../apps/web/src/conversation-scroll';
import {ProjectContextCard} from '../../apps/web/src/ProjectContextCard';
import type {ProjectContext} from '../../packages/contracts/workspace';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';

const context:ProjectContext={project:{id:'project-a',name:'Fixture project',rootPath:'C:/fixture',authority:{kind:'local'},createdAt:'2026-11-04'},machineName:'Fixture machine',editor:{available:true,label:'Default editor'},branch:'feature/ui',head:'fixture-head',changes:{added:12,removed:3,files:2},lineage:[{id:'child',title:'Review layout',status:'working'}],scripts:[],capabilities:{git:true,terminal:true,pullRequests:true}};
function Fixture(){
 const scrollRef=useRef<HTMLDivElement>(null),controller=useRef<ReturnType<typeof createConversationScroll>|null>(null);
 const [connected,setConnected]=useState(false),[lines,setLines]=useState(60),[message,setMessage]=useState('');
 useLayoutEffect(()=>{if(!scrollRef.current)return;controller.current=createConversationScroll(scrollRef.current);controller.current.update('fixture',{top:0,tail:true});return()=>controller.current?.dispose();},[]);
 useLayoutEffect(()=>controller.current?.update('fixture',{top:0,tail:true}),[lines]);
 return <div className="app-shell" style={{padding:16,gap:24}}><main className="workspace"><header className="workspace-header"><strong>Conversation fixture</strong><button onClick={()=>setLines(value=>value+10)}>Grow transcript</button></header><div className="conversation-frame"><ChatScrollIndicator scrollRef={scrollRef} controllerRef={controller}/><div ref={scrollRef} className="conversation-scroll" aria-label="Fixture conversation" onScroll={()=>controller.current?.remember()}>{Array.from({length:lines},(_,index)=><p key={index} style={{minHeight:36}}>Message {index+1}: retained conversation content.</p>)}</div></div><textarea aria-label="Outside draft" placeholder="Draft stays available"/></main><aside style={{width:320,maxWidth:'45vw'}}><button onClick={()=>setConnected(value=>!value)}>{connected?'Disconnect fixture':'Connect fixture'}</button><ProjectContextCard context={connected?context:undefined} threadTitle="Fixture project" onConnect={()=>setConnected(true)} onShowChanges={()=>setMessage('Changes opened')} onAction={async type=>{setMessage(type);}}/><p role="status">{message}</p></aside></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
