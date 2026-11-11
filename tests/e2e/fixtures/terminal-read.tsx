import {Suspense,startTransition,useState,type ComponentProps} from 'react';
import {createRoot} from 'react-dom/client';
import {Terminal} from '@xterm/xterm';
import {TerminalBody} from '../../../apps/web/src/TerminalBody';
import '@fontsource-variable/inter';
import '../../../apps/web/src/styles.css';
import '../../../apps/web/src/appearance.css';
import '../../../apps/web/src/workspace-tools.css';
import './terminal-read-fixture.css';

const query=new URLSearchParams(location.search);
type Props=ComponentProps<typeof TerminalBody>;
const instances:Terminal[]=[];
const originalOpen=Terminal.prototype.open;
Terminal.prototype.open=function(...args){instances.push(this);return originalOpen.apply(this,args);};
let current=true;
const ownerCurrent=()=>current;
const initial:Props={projectId:'project-a',threadId:'thread-a',terminalId:query.has('unbound')?undefined:'terminal-a',active:true,isCurrent:ownerCurrent};
let update:(patch:Partial<Props>)=>void=()=>{};
let show:(value:boolean)=>void=()=>{};
let replaceGuard:()=>void=()=>{},handoffRenders=0;
const pendingHandoff=new Promise<never>(()=>{});
function Handoff({held}:{held:boolean}){if(held){handoffRenders++;throw pendingHandoff;}return null;}
let anotherCount=0;
const fixture={instances,update:(patch:Partial<Props>)=>update(patch),show:(value:boolean)=>show(value),revoke:()=>{current=false;},replaceGuard:()=>{current=false;replaceGuard();},handoffRenders:()=>handoffRenders,allowAnother:()=>update({openAnother:()=>{anotherCount++;}}),anotherCount:()=>anotherCount,text:()=>{const buffer=instances.at(-1)?.buffer.active;return buffer?Array.from({length:buffer.length},(_,index)=>buffer.getLine(index)?.translateToString(true)??'').join('\n'):'';}};
Object.assign(window,{terminalFixture:fixture});
function Fixture(){const[props,setProps]=useState(initial),[mounted,setMounted]=useState(true),[held,setHeld]=useState(false);update=patch=>setProps(previous=>({...previous,...patch}));show=setMounted;replaceGuard=()=>startTransition(()=>{setProps(previous=>({...previous,isCurrent:()=>true}));setHeld(true);});return <main><p className="fixture-label">Synthetic API · real xterm · production Terminal</p><section className="canvas-panel" aria-label="Terminal fixture"><Suspense fallback={null}>{mounted&&<><TerminalBody {...props}/><Handoff held={held}/></>}</Suspense></section><button onClick={()=>setMounted(value=>!value)}>Toggle view</button></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);

export type TerminalFixture=typeof fixture;
