import {Suspense,useState,type ComponentProps} from 'react';
import {createRoot} from 'react-dom/client';
import {Terminal} from '@xterm/xterm';
import {TerminalBody} from '../../../apps/web/src/TerminalBody';
import {TerminalShellSettings} from '../../../apps/web/src/TerminalShellSettings';
import type {TerminalShellSelection} from '../../../packages/contracts/terminal-shell.ts';
import '@fontsource-variable/inter';
import '../../../apps/web/src/styles.css';
import '../../../apps/web/src/appearance.css';
import '../../../apps/web/src/workspace-tools.css';
import './terminal-read-fixture.css';

const instances:Terminal[]=[];
const originalOpen=Terminal.prototype.open;
Terminal.prototype.open=function(...args){instances.push(this);return originalOpen.apply(this,args);};
let current=true;
const ownerCurrent=()=>current;
let saveResult=true;
const saves:TerminalShellSelection[]=[];
const fixture={instances,saves,saveResult:(value:boolean)=>{saveResult=value;},revoke:()=>{current=false;},text:()=>{const buffer=instances.at(-1)?.buffer.active;return buffer?Array.from({length:buffer.length},(_,index)=>buffer.getLine(index)?.translateToString(true)??'').join('\n'):'';}};
Object.assign(window,{terminalShellFixture:fixture});
type Props=ComponentProps<typeof TerminalBody>;
const initial:Props={projectId:'project-a',threadId:'thread-a',terminalId:'terminal-a',active:true,isCurrent:ownerCurrent};
function Fixture(){
 const [selection,setSelection]=useState<TerminalShellSelection>({kind:'default'});
 const save=async(value:TerminalShellSelection)=>{saves.push(value);if(saveResult){setSelection(value);return true;}return false;};
 return <main><p className="fixture-label">Synthetic API · terminal shell</p><section aria-label="Terminal shell settings"><Suspense fallback={null}><TerminalShellSettings selection={selection} busy={false} save={save}/></Suspense></section><section className="canvas-panel" aria-label="Terminal fixture"><Suspense fallback={null}><TerminalBody {...initial}/></Suspense></section></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

export type TerminalShellFixture=typeof fixture;
