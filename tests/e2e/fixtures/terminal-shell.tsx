import {useCallback,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SettingsView} from '../../../apps/web/src/Settings';
import {TerminalBody} from '../../../apps/web/src/TerminalBody';
import {getShellSettings} from '../../../apps/web/src/api';
import type {SettingsData} from '../../../apps/web/src/settings-data';
import type {DraftTransferReferences} from '../../../packages/contracts/shell-read-models';
import '../../../apps/web/src/styles.css';
import '../../../apps/web/src/settings.css';
import './terminal-shell.css';

const draftReferences=async():Promise<DraftTransferReferences>=>({threads:[],skills:[],userStates:[],requests:[]});

function Fixture(){
 const [preferences,setPreferences]=useState<Record<string,unknown>|null>(null);
 const [settingsVisible,setSettingsVisible]=useState(true);
 const [settingsEpoch,setSettingsEpoch]=useState(0);
 const [secondTerminal,setSecondTerminal]=useState(false);
 const currentRef=useRef(true);
 const refresh=useCallback(async()=>{
  const settings=await getShellSettings();
  setPreferences(settings.preferences??{});
 },[]);
 useEffect(()=>{void refresh().catch(()=>setPreferences({}));},[refresh]);
 useEffect(()=>{
  (window as {terminalShellFixture?:Record<string,unknown>}).terminalShellFixture={
   setSettingsVisible,
   remountSettings:()=>setSettingsEpoch(epoch=>epoch+1),
   setSecondTerminal,
   setTerminalCurrent:(value:boolean)=>{currentRef.current=value;},
  };
 },[]);
 if(!preferences)return null;
 const data:SettingsData={
  sequence:1,
  settings:{theme:'dark',modelId:null,selectedAccounts:{},preferences},
  accounts:[],skills:[],skillProposals:[],
  projects:[{id:'project-a',name:'Synthetic project'}],
  resources:[],archivedThreads:[],
  counts:{threads:1,archivedThreads:0,artifacts:0,resources:0,uncertainOperations:0},
 };
 const isCurrent=()=>currentRef.current;
 return <div className="terminal-shell-fixture">
  {settingsVisible?<div className="fixture-settings" key={settingsEpoch}>
   <SettingsView data={data} draftReferences={draftReferences} modelError="" refresh={refresh}
    loadModels={async()=>{}} close={()=>{}} addResource={()=>{}} initialSection="projects" environmentSettings={null}/>
  </div>:null}
  <div className="fixture-terminal" data-terminal="a">
   <TerminalBody projectId="project-a" threadId="thread-a" terminalId="terminal-a" active isCurrent={isCurrent}/>
  </div>
  {secondTerminal?<div className="fixture-terminal" data-terminal="b">
   <TerminalBody projectId="project-a" threadId="thread-a" active isCurrent={isCurrent}/>
  </div>:null}
 </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
