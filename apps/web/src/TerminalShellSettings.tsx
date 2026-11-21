import {useCallback,useEffect,useRef,useState} from 'react';
import {Select} from '../../../packages/ui-shell/Select';
import type {TerminalShellCatalog,TerminalShellSelection} from '../../../packages/contracts/terminal-shell';
import {getTerminalShellCatalog} from './terminal-shell-api';

const KIND_LABELS:Record<TerminalShellSelection['kind'],string>={default:'System default (Command Prompt)',cmd:'Command Prompt',pwsh:'PowerShell 7',powershell:'Windows PowerShell','git-bash':'Git Bash',wsl:'WSL'};

/** The select carries one flat list: WSL expands into one entry per installed
 * distribution plus the host's current default, encoded in the option value. */
export function encodeSelection(selection:TerminalShellSelection):string{
 return selection.kind==='wsl'&&selection.distro?`wsl:${selection.distro}`:selection.kind;
}
export function decodeSelection(value:string):TerminalShellSelection|null{
 if(value==='wsl')return{kind:'wsl'};
 if(value.startsWith('wsl:')){const distro=value.slice(4);return distro?{kind:'wsl',distro}:null;}
 if(['default','cmd','pwsh','powershell','git-bash'].includes(value))return{kind:value as TerminalShellSelection['kind']};
 return null;
}
export function selectionLabel(selection:TerminalShellSelection):string{
 if(selection.kind!=='wsl')return KIND_LABELS[selection.kind];
 return selection.distro?`WSL · ${selection.distro}`:'WSL · Default distribution';
}
const suffix={missing:' (not installed)',unsupported:' (unavailable on this host)',error:' (check failed)'} as const;
/** Flat select options: every catalog entry stays visible with an explanation;
 * unavailable entries are disabled. A saved choice that vanished keeps a
 * disabled entry so the effective value is never silently replaced. */
export function catalogOptions(catalog:TerminalShellCatalog,selection:TerminalShellSelection):{value:string;label:string;disabled?:boolean}[]{
 const options:{value:string;label:string;disabled?:boolean}[]=[];
 for(const option of catalog.options){
  if(option.kind==='wsl')continue;
  const reason=option.availability==='available'?'':(suffix[option.availability]??'')+(option.reason?` — ${option.reason}`:'');
  options.push({value:option.kind,label:`${option.label}${reason}`,...(option.availability==='available'?{}:{disabled:true})});
 }
 if(catalog.wsl.availability==='available'){
  options.push({value:'wsl',label:'WSL · Default distribution'});
  for(const distro of catalog.wsl.distributions)options.push({value:`wsl:${distro}`,label:`WSL · ${distro}`});
 }else options.push({value:'wsl',label:`WSL${suffix[catalog.wsl.availability]??''}${catalog.wsl.reason?` — ${catalog.wsl.reason}`:''}`,disabled:true});
 const value=encodeSelection(selection);
 if(!options.some(option=>option.value===value))options.push({value,label:`${selectionLabel(selection)} (no longer available)`,disabled:true});
 return options;
}
export function TerminalShellSettings({saved,busy,save}:{saved:TerminalShellSelection;busy:boolean;save:(selection:TerminalShellSelection)=>Promise<boolean>}){
 const generation=useRef(0),reader=useRef<AbortController|null>(null),alive=useRef(true);
 const [catalog,setCatalog]=useState<TerminalShellCatalog|null>(null);
 const [catalogFailed,setCatalogFailed]=useState(false),[checking,setChecking]=useState(true);
 const [draft,setDraft]=useState<TerminalShellSelection|null>(null),[saveFailed,setSaveFailed]=useState(false);
 const load=useCallback(async(refresh=false)=>{
  const request=++generation.current;
  reader.current?.abort();const controller=new AbortController();reader.current=controller;
  setChecking(true);setCatalogFailed(false);
  try{const next=await getTerminalShellCatalog(refresh,controller.signal);if(generation.current===request)setCatalog(next);}
  catch{if(!controller.signal.aborted&&generation.current===request)setCatalogFailed(true);}
  finally{if(generation.current===request)setChecking(false);}
 },[]);
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;generation.current++;reader.current?.abort();reader.current=null;};},[load]);
 // A confirmed save updates the parent snapshot; the optimistic draft clears only then.
 const savedKey=JSON.stringify(saved);
 useEffect(()=>{setDraft(null);setSaveFailed(false);},[savedKey]);
 const effective=draft??saved;
 const persist=async(selection:TerminalShellSelection)=>{const ok=await save(selection);if(!ok&&alive.current)setSaveFailed(true);};
 const choose=(value:string)=>{const selection=decodeSelection(value);if(!selection)return;setDraft(selection);setSaveFailed(false);void persist(selection);};
 const copy=<div className="settings-row-copy"><h2>Default terminal shell</h2><p>Applies to new project terminals. Running terminals are unchanged.</p></div>;
 if(catalogFailed)return <section className="settings-row">{copy}<div className="settings-row-control"><p role="status">Could not check available shells. <button type="button" className="secondary" disabled={checking} onClick={()=>void load(true)}>Retry</button></p></div></section>;
 if(!catalog)return <section className="settings-row">{copy}<div className="settings-row-control"><span className="settings-value" role="status">Checking available shells…</span></div></section>;
 // The front-end team's accepted spec hides the row entirely on non-Windows hosts.
 if(catalog.platform!=='win32')return null;
 const options=catalogOptions(catalog,effective),value=encodeSelection(effective);
 const effectiveUnavailable=options.every(option=>option.value!==value||option.disabled);
 return <section className="settings-row">{copy}<div className="settings-row-control">
  {/* The trigger stays enabled during a write: disabling it would drop keyboard
   * focus mid-save; a second choice is already serialized by the caller. */}
  <Select aria-label="Default terminal shell" value={value} options={options} onValueChange={choose}/>
  {effectiveUnavailable&&<p role="status">This shell is no longer available. Choose another shell.</p>}
  {saveFailed&&<p role="alert">The shell choice could not be saved. <button type="button" className="secondary" disabled={busy} onClick={()=>{if(draft){setSaveFailed(false);void persist(draft);}}}>Retry</button></p>}
 </div></section>;
}
