import {useEffect,useId,useMemo,useRef,useState,type KeyboardEvent} from 'react';
import {Popover} from '../../../packages/ui-shell/Popover';
import {ActionMenu} from '../../../packages/ui-shell/ActionMenu';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import {Bot,Check,ChevronDown,Search} from 'lucide-react';
import type {ModelInfo} from '../../../packages/contracts';
import {SUBSCRIPTION_CONNECTIONS} from '../../../packages/contracts/connections';
import './model-picker.css';

export interface ModelPickerProps {
 models:ModelInfo[];modelId:string;onChange:(id:string)=>void;disabled?:boolean;
 thinkingLevel?:string;onThinkingChange?:(level:string)=>void;
}
const providerLabel=(provider:string)=>SUBSCRIPTION_CONNECTIONS.find(connection=>connection.id===provider)?.label??provider;
const effortLabel=(value:string)=>value==='xhigh'?'Extra high':value.replaceAll('_',' ').replaceAll('-',' ').replace(/\b\w/g,letter=>letter.toUpperCase());

export function ModelPicker({models,modelId,onChange,disabled=false,thinkingLevel='',onThinkingChange}:ModelPickerProps){
 const id=useId(),trigger=useRef<HTMLButtonElement>(null),popover=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);
 const [open,setOpen]=useState(false),[present,setPresent]=useState(false),[query,setQuery]=useState(''),[activeId,setActiveId]=useState(modelId);
 const [effortOpen,setEffortOpen]=useState(false),[keyboard,setKeyboard]=useState(false);
 const selected=models.find(model=>model.id===modelId),locked=disabled||!models.length,combined=Boolean(onThinkingChange);
 const levels=[...new Set(selected?.thinkingLevels?.filter(level=>typeof level==='string'&&level.length>0)??[])];
 const selectedEffort=levels.includes(thinkingLevel)?thinkingLevel:'';
 const groups=useMemo(()=>{
  const tokens=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean),result=new Map<string,ModelInfo[]>();
  for(const model of models){
   const source=(model.name+' '+model.id+' '+providerLabel(model.provider)).toLocaleLowerCase();
   if(!tokens.every(token=>source.includes(token)))continue;
   const group=result.get(model.provider)??[];group.push(model);result.set(model.provider,group);
  }
  return [...result.entries()];
 },[models,query]);
 const visible=groups.flatMap(([,group])=>group),active=visible.find(model=>model.id===activeId)??visible[0];
 const optionId=(model:ModelInfo)=>id+'-option-'+models.indexOf(model);
 const name=selected?.name??(modelId||'Select model'),caption=combined&&selectedEffort?effortLabel(selectedEffort):'';
 function close(restoreFocus=false){setEffortOpen(false);setOpen(false);if(restoreFocus)trigger.current?.focus();}
 function show(){if(locked)return;setQuery('');setActiveId(modelId);setKeyboard(false);setPresent(true);setOpen(true);}
 function choose(model:ModelInfo){if(locked)return;onChange(model.id);if(!combined)close(true);}
 function chooseEffort(level:string){if(locked||!onThinkingChange||(level!==''&&!levels.includes(level)))return;onThinkingChange(level);close(true);}
 function navigate(event:KeyboardEvent<HTMLInputElement>){
  if(isComposing(event)){if(event.key==='Escape')event.preventDefault();return;}
  if(event.altKey||event.ctrlKey||event.metaKey)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
  if(event.key==='Tab'&&!combined){close(true);return;}
  if(event.key==='Enter'){event.preventDefault();if(active)choose(active);return;}
  if(!['ArrowDown','ArrowUp'].includes(event.key))return;
  event.preventDefault();const index=visible.findIndex(model=>model.id===active?.id),count=visible.length;if(!count)return;
  const next=(index+(event.key==='ArrowDown'?1:-1)+count)%count;setActiveId(visible[next].id);setKeyboard(true);
 }
 useEffect(()=>{if(open||!present)return;const timeout=window.setTimeout(()=>setPresent(false),110);return()=>window.clearTimeout(timeout);},[open,present]);
 useEffect(()=>{if(locked){setOpen(false);setEffortOpen(false);}},[locked]);
 useEffect(()=>{setEffortOpen(false);},[modelId,thinkingLevel,models]);
 useEffect(()=>{if(open&&active)popover.current?.ownerDocument.getElementById(optionId(active))?.scrollIntoView({block:'nearest'});},[open,active?.id]);
 return <>
  <button ref={trigger} type="button" role="combobox" aria-label="Model" aria-expanded={open&&!locked} aria-haspopup={combined?'dialog':'listbox'} aria-controls={open?(combined?id+'-picker':id+'-list'):undefined} disabled={locked} className="composer-tool model-picker-trigger" title={disabled?'Wait for the active run to finish to change models':name+(caption?' · '+caption:'')} onClick={()=>open?close(true):show()} onKeyDown={event=>{if(isComposing(event)||event.altKey||event.ctrlKey||event.metaKey)return;if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();if(open)search.current?.focus();else show();}}}>
   <Bot className="model-picker-trigger-icon" size={16} aria-hidden="true"/><span className="model-picker-trigger-name">{name}</span>{caption&&<span className="model-picker-trigger-effort">{caption}</span>}<ChevronDown size={12} data-open={open}/>
  </button>
  <Popover anchor={trigger} contentRef={popover} initialFocus={search} open={open&&!locked} present={present}
   onReady={()=>{popover.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});}}
   width={400} height={Math.min(390,44+24+new Set(models.map(model=>model.provider)).size*24+models.length*58+(combined?52:0))}
   onDismiss={()=>{if(!effortOpen)close();}}
   id={id+'-picker'} role={combined?'dialog':undefined} aria-label={combined?'Model and reasoning':undefined}
   className="model-picker-popover" data-combined={combined} onKeyDown={event=>{if(event.key==='Escape'&&isComposing(event))event.preventDefault();}}>
   <div className="model-picker-main">
    <div className="model-picker-search"><Search size={16} aria-hidden="true"/><input ref={search} type="search" aria-label="Search models" placeholder="Search models…" value={query} autoComplete="off" spellCheck={false} aria-autocomplete="list" aria-controls={id+'-list'} aria-activedescendant={active?optionId(active):undefined} onChange={event=>{setQuery(event.target.value);setActiveId(modelId);setKeyboard(false);}} onKeyDown={navigate}/><kbd aria-hidden="true">Esc</kbd></div>
    <div id={id+'-list'} role="listbox" aria-label="Available models" tabIndex={-1} className="model-picker-list">
     {groups.map(([value,group])=><div role="group" aria-label={providerLabel(value)} className="model-picker-group" key={value}><div className="model-picker-provider" aria-hidden="true">{providerLabel(value)}</div>{group.map(model=><div id={optionId(model)} role="option" aria-label={model.name} aria-describedby={optionId(model)+'-identity'} aria-selected={model.id===modelId} data-active={keyboard&&model.id===active?.id} className="model-picker-option" key={model.id} onPointerMove={()=>{setActiveId(model.id);setKeyboard(false);}} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(model)}><Bot size={17} aria-hidden="true"/><span><span>{model.name}</span><small id={optionId(model)+'-identity'}>{model.id}</small></span>{model.id===modelId&&<Check className="model-picker-check" size={16} aria-hidden="true"/>}</div>)}</div>)}
    </div>
    {!visible.length&&<p className="model-picker-empty" role="status">No models found<span>Try another model or provider name.</span></p>}
   </div>
   {combined&&<div className="model-picker-reasoning" role="group" aria-label="Reasoning">{levels.length?
    <ActionMenu label={'Reasoning: '+(selectedEffort?effortLabel(selectedEffort):'Default')} open={open&&!locked&&effortOpen} onOpenChange={setEffortOpen}
     items={['',...levels].map(level=>({id:level,label:level?effortLabel(level):'Default',checked:level===selectedEffort,onSelect:()=>chooseEffort(level)}))}/>
    :<p className="model-picker-no-effort">No reasoning settings</p>}</div>}
  </Popover>
 </>;
}
