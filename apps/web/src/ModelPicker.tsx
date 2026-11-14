import {useEffect,useId,useMemo,useRef,useState,useImperativeHandle,type Ref,type KeyboardEvent} from 'react';
import {Popover} from '../../../packages/ui-shell/Popover';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import {Bot,Check,ChevronDown,LayoutGrid,Search,Star} from 'lucide-react';
import type {ModelInfo} from '../../../packages/contracts';
import {SUBSCRIPTION_CONNECTIONS} from '../../../packages/contracts/connections';
import './model-picker.css';

export interface ModelPickerHandle {open():void}
export interface ModelPickerProps {
 ref?:Ref<ModelPickerHandle>;
 models:ModelInfo[];modelId:string;onChange:(id:string)=>void;disabled?:boolean;
 thinkingLevel?:string;onThinkingChange?:(level:string)=>void;
}
const providerLabel=(provider:string)=>SUBSCRIPTION_CONNECTIONS.find(connection=>connection.id===provider)?.label??provider;
const effortLabel=(value:string)=>value==='xhigh'?'Extra high':value.replaceAll('_',' ').replaceAll('-',' ').replace(/\b\w/g,letter=>letter.toUpperCase());
const FAVORITES_KEY='harness:model-favorites:v1';
function readFavorites():string[]{
 try{const value:unknown=JSON.parse(localStorage.getItem(FAVORITES_KEY)??'[]');return Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'):[];}catch{return [];}
}
type ModelFilter={kind:'all'|'favorites'}|{kind:'provider';provider:string};

export function ModelPicker({ref,models,modelId,onChange,disabled=false,thinkingLevel='',onThinkingChange}:ModelPickerProps){
 const id=useId(),trigger=useRef<HTMLButtonElement>(null),popover=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null),efforts=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false),[present,setPresent]=useState(false),[query,setQuery]=useState(''),[activeId,setActiveId]=useState(modelId);
 const [keyboard,setKeyboard]=useState(false),[filter,setFilter]=useState<ModelFilter>({kind:'all'}),[favorites,setFavorites]=useState(readFavorites);
 const selected=models.find(model=>model.id===modelId),locked=disabled||!models.length,combined=Boolean(onThinkingChange);
 const levels=[...new Set(selected?.thinkingLevels?.filter(level=>typeof level==='string'&&level.length>0)??[])];
 const selectedEffort=levels.includes(thinkingLevel)?thinkingLevel:'';
 const providers=[...new Set(models.map(model=>model.provider))];
 const favoriteCount=models.filter(model=>favorites.includes(model.id)).length;
 const groups=useMemo(()=>{
  const scoped=filter.kind==='provider'?models.filter(model=>model.provider===filter.provider):filter.kind==='favorites'?models.filter(model=>favorites.includes(model.id)):models;
  const tokens=query.toLowerCase().trim().split(/\s+/).filter(Boolean),result=new Map<string,ModelInfo[]>();
  for(const model of scoped){
   const source=(model.name+' '+model.id+' '+providerLabel(model.provider)).toLowerCase();
   if(!tokens.every(token=>source.includes(token)))continue;
   const group=result.get(model.provider)??[];group.push(model);result.set(model.provider,group);
  }
  return [...result.entries()];
 },[models,query,filter,favorites]);
 const visible=groups.flatMap(([,group])=>group),active=visible.find(model=>model.id===activeId)??visible[0];
 const optionId=(model:ModelInfo)=>id+'-option-'+models.indexOf(model);
 const name=selected?.name??(modelId||'Select model'),caption=combined&&selectedEffort?effortLabel(selectedEffort):'';
 function close(restoreFocus=false){setOpen(false);if(restoreFocus)trigger.current?.focus();}
 function show(){if(locked)return;setQuery('');setActiveId(modelId);setKeyboard(false);setPresent(true);setOpen(true);}
 useImperativeHandle(ref,()=>({open:show}));
 function choose(model:ModelInfo){if(locked)return;onChange(model.id);if(!combined)close(true);}
 function chooseEffort(level:string){if(locked||!onThinkingChange||level===thinkingLevel||(level!==''&&!levels.includes(level)))return;onThinkingChange(level);}
 function applyFilter(next:ModelFilter){setFilter(next);setActiveId(modelId);setKeyboard(false);}
 function toggleFavorite(model:ModelInfo){
  const next=favorites.includes(model.id)?favorites.filter(value=>value!==model.id):[...favorites,model.id];
  setFavorites(next);
  try{localStorage.setItem(FAVORITES_KEY,JSON.stringify(next));}catch{/* Favorites still work for this session without storage. */}
 }
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
 function effortNavigate(event:KeyboardEvent<HTMLDivElement>){
  if(isComposing(event)||event.altKey||event.ctrlKey||event.metaKey)return;
  const options=['',...levels],index=options.indexOf(selectedEffort);let next:string|undefined;
  if(event.key==='ArrowDown')next=options[(index+1)%options.length];
  else if(event.key==='ArrowUp')next=options[(index-1+options.length)%options.length];
  else if(event.key==='Home')next=options[0];
  else if(event.key==='End')next=options[options.length-1];
  else return;
  event.preventDefault();chooseEffort(next);
  efforts.current?.querySelector<HTMLElement>(`[data-effort="${CSS.escape(next)}"]`)?.focus();
 }
 useEffect(()=>{if(open||!present)return;const timeout=window.setTimeout(()=>setPresent(false),110);return()=>window.clearTimeout(timeout);},[open,present]);
 useEffect(()=>{if(locked)setOpen(false);},[locked]);
 const wasOpen=useRef(false);
 useEffect(()=>{const opened=open&&!wasOpen.current;wasOpen.current=open;if(!open||!active)return;
  // Defer past placement/font settle; center on open so the selected row is fully revealed even in short narrow lists.
  const frame=requestAnimationFrame(()=>requestAnimationFrame(()=>{popover.current?.ownerDocument.getElementById(optionId(active))?.scrollIntoView({block:opened?'center':'nearest'});}));
  return()=>cancelAnimationFrame(frame);},[open,active?.id]);
 return <>
  <button ref={trigger} type="button" role="combobox" aria-label="Model" aria-expanded={open&&!locked} aria-haspopup={combined?'dialog':'listbox'} aria-controls={open?(combined?id+'-picker':id+'-list'):undefined} disabled={locked} className="composer-tool model-picker-trigger" title={disabled?'Wait for the active run to finish to change models':name+(caption?' · '+caption:'')} onClick={()=>open?close(true):show()} onKeyDown={event=>{if(isComposing(event)||event.altKey||event.ctrlKey||event.metaKey)return;if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();if(open)search.current?.focus();else show();}}}>
   <Bot className="model-picker-trigger-icon" size={16} aria-hidden="true"/><span className="model-picker-trigger-name">{name}</span>{caption&&<span className="model-picker-trigger-effort">{caption}</span>}<ChevronDown size={12} data-open={open}/>
  </button>
  <Popover anchor={trigger} contentRef={popover} initialFocus={search} open={open&&!locked} present={present}
   onReady={()=>{popover.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});}}
   width={combined?720:560} height={440}
   onDismiss={()=>close()}
   id={id+'-picker'} role={combined?'dialog':undefined} aria-label={combined?'Model and reasoning':undefined}
   className="model-picker-popover" onKeyDown={event=>{
    if(event.key==='Escape'&&isComposing(event)){event.preventDefault();return;}
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&!isComposing(event)&&/^[1-9]$/.test(event.key)){
     const model=visible[Number(event.key)-1];
     if(model){event.preventDefault();choose(model);}
    }
   }}>
   <div className="model-picker-grid" data-combined={combined}>
   <div className="model-picker-rail" role="group" aria-label="Model filters">
    <button type="button" className="model-picker-rail-item" aria-pressed={filter.kind==='all'} onClick={()=>applyFilter({kind:'all'})}><LayoutGrid size={15} aria-hidden="true"/><span className="model-picker-rail-label">All models</span><small>{models.length}</small></button>
    <button type="button" className="model-picker-rail-item" aria-pressed={filter.kind==='favorites'} onClick={()=>applyFilter({kind:'favorites'})}><Star size={15} aria-hidden="true"/><span className="model-picker-rail-label">Favorites</span><small>{favoriteCount}</small></button>
    <div className="model-picker-rail-sep" aria-hidden="true"/>
    {providers.map(provider=><button type="button" key={provider} className="model-picker-rail-item" aria-pressed={filter.kind==='provider'&&filter.provider===provider} onClick={()=>applyFilter({kind:'provider',provider})}><span className="model-picker-rail-mark" aria-hidden="true">{providerLabel(provider).charAt(0)}</span><span className="model-picker-rail-label">{providerLabel(provider)}</span><small>{models.filter(model=>model.provider===provider).length}</small></button>)}
   </div>
   <div className="model-picker-main">
    <div className="model-picker-search"><Search size={16} aria-hidden="true"/><input ref={search} type="search" aria-label="Search models" placeholder="Search models…" value={query} autoComplete="off" spellCheck={false} aria-autocomplete="list" aria-controls={id+'-list'} aria-activedescendant={active?optionId(active):undefined} onChange={event=>{setQuery(event.target.value);setActiveId(modelId);setKeyboard(false);}} onKeyDown={navigate}/><kbd aria-hidden="true">Esc</kbd></div>
    <div id={id+'-list'} role="listbox" aria-label="Available models" tabIndex={-1} className="model-picker-list">
     {groups.map(([value,group])=><div role="group" aria-label={providerLabel(value)} className="model-picker-group" key={value}><div className="model-picker-provider" aria-hidden="true">{providerLabel(value)}</div>{group.map(model=>{
      const shortcut=visible.indexOf(model),favorite=favorites.includes(model.id);
      return <div className="model-picker-row" key={model.id}>
       <div id={optionId(model)} role="option" aria-label={model.name} aria-describedby={optionId(model)+'-identity'} aria-selected={model.id===modelId} data-active={keyboard&&model.id===active?.id} className="model-picker-option" onPointerMove={()=>{setActiveId(model.id);setKeyboard(false);}} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(model)}><Bot size={17} aria-hidden="true"/><span><span>{model.name}</span><small id={optionId(model)+'-identity'}>{model.id}</small></span>{shortcut>=0&&shortcut<9&&<kbd aria-hidden="true">Ctrl {shortcut+1}</kbd>}{model.id===modelId&&<Check className="model-picker-check" size={16} aria-hidden="true"/>}</div>
       <button type="button" className="model-picker-favorite" aria-pressed={favorite} aria-label={(favorite?'Remove ':'Add ')+model.id+(favorite?' from favorites':' to favorites')} tabIndex={model.id===active?.id?0:-1} onClick={event=>{event.stopPropagation();toggleFavorite(model);}}><Star size={14} aria-hidden="true" fill={favorite?'currentColor':'none'}/></button>
      </div>;
     })}</div>)}
    </div>
    {!visible.length&&(filter.kind==='favorites'&&favoriteCount===0
     ?<p className="model-picker-empty" role="status">No favorites yet<span>Star a model to keep it here.</span></p>
     :<p className="model-picker-empty" role="status">No models found<span>Try another model or provider name.</span></p>)}
   </div>
   {combined&&<div className="model-picker-reasoning" role="group" aria-label="Reasoning">
    <div className="model-picker-reasoning-head"><span>Reasoning</span><small>{selected?.name??(modelId||'Select model')}</small></div>
    {levels.length?
     <div ref={efforts} role="radiogroup" aria-label="Reasoning effort" className="model-picker-efforts" onKeyDown={effortNavigate}>
      {['',...levels].map(level=><button type="button" key={level||'default'} role="radio" aria-checked={level===selectedEffort} data-effort={level} tabIndex={level===selectedEffort?0:-1} className="model-picker-effort" onClick={()=>chooseEffort(level)}><span className="model-picker-effort-dot" aria-hidden="true"/>{level?effortLabel(level):'Default'}</button>)}
     </div>
     :<p className="model-picker-no-effort">No reasoning settings</p>}
   </div>}
   </div>
  </Popover>
 </>;
}
