import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ShellSidebar} from '../../apps/web/src/ShellSidebar';
import {DesktopProvider} from '../../apps/web/src/desktop-context';
import {WorkspaceProvider,type WorkspaceTab} from '../../apps/web/src/workspace-context';
import {DEFAULT_PREFERENCES} from '../../packages/contracts/preferences';
import type {Thread} from '../../packages/contracts';
import type {DesktopBridge,DesktopContext} from '../../packages/desktop-contract';
import type {ShellLayout} from '../../apps/web/src/shell-layout';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';
import '../../apps/web/src/sidebar-context.css';

const calls:string[]=[];
Object.assign(window,{sidebarCompactCalls:calls});
const context:DesktopContext={windowId:'main',surface:new URLSearchParams(location.search).has('navigation')?{kind:'navigation'}:{kind:'main'},windows:[],update:{state:'idle',message:'Up to date'}};
const bridge={onState:()=>()=>{},onCloseRequested:()=>()=>{},update:async(action:string)=>{calls.push(`update:${action}`);return context.update;}} as unknown as DesktopBridge;
const threads=Array.from({length:35},(_,index)=>({id:`thread-${index}`,title:index===0?'A long useful thread title that remains available in full':'Research question '+index,projectId:'project-one',projectName:'Example project',status:index===1?'working':index===2?'awaiting_input':'ready',runId:index===1?'run-one':null,modelId:null,sessionPath:null,epoch:0,createdAt:'2026-11-04T10:00:00Z',updatedAt:'2026-11-04T10:00:00Z'} as Thread));
function Fixture(){
 const elementRef=useRef<HTMLElement>(null),searchRef=useRef<HTMLInputElement>(null),[activeTab,setActiveTab]=useState<WorkspaceTab>('artifact');
 const [layout,setLayout]=useState<ShellLayout>({sidebarCollapsed:false,sidebarWidth:248,rightPanelOpen:false,rightPanelWidth:520,rightPanelMaximized:false,activeTab:'artifact',activeArtifactId:null,folded:{}});
 const fallback=new URLSearchParams(location.search).has('fallback');
 return <DesktopProvider bridge={bridge} context={context}><WorkspaceProvider value={{activeArtifactId:null,requestOpenArtifact:()=>{},closeArtifact:()=>{},rightPanelOpen:false,activeTab,setActiveTab:tab=>{calls.push(`workspace:${tab}`);setActiveTab(tab);}}}><div className="app-shell" data-theme="dark" style={{height:'100vh'}}><ShellSidebar elementRef={elementRef} searchRef={searchRef} mobile={false} open layout={layout} preferences={{...DEFAULT_PREFERENCES,showWorkingSection:false,panelAnimations:false}} matching={threads} selectedId="thread-0" loaded creating={false} search="" setSearch={()=>{}} close={()=>{}} toggleCollapsed={()=>{}} setFolded={(key,folded)=>setLayout(value=>({...value,folded:{...value.folded,[key]:folded}}))} select={id=>calls.push(`select:${id}`)} create={()=>calls.push('create')} settings={()=>calls.push('settings')} detachNavigation={()=>calls.push('detach:navigation')} detachThread={()=>calls.push('detach:thread')} presentation={(_thread,value)=>calls.push(`presentation:${JSON.stringify(value)}`)} rename={()=>calls.push('rename')} archive={()=>calls.push('archive')} details={{'thread-0':{provider:'openai/gpt-6.1-sol',branch:'feature/compact-sidebar'}}} navigation={<nav aria-label="Installed plug-ins"><button onClick={()=>calls.push('plugin')}>Example plug-in</button></nav>} {...(!fallback?{onOpenPullRequests:()=>calls.push('pull-requests'),onOpenUsage:()=>calls.push('usage')}:{})}/><main style={{padding:24}}>Selected view: {activeTab}</main></div></WorkspaceProvider></DesktopProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
