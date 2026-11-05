import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {Bot,Check,ChevronDown,Layers,Search} from 'lucide-react';
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
 const id=useId(),trigger=useRef<HTMLButtonElement>(null),popover=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null),reasoning=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false),[present,setPresent]=useState(false),[query,setQuery]=useState(''),[activeId,setActiveId]=useState(modelId),[provider,setProvider]=useState('all');
 const [position,setPosition]=useState<{style:CSSProperties;side:'above'|'below'}>({style:{},side:'above'});
 const selected=models.find(model=>model.id===modelId),locked=disabled||!models.length,combined=Boolean(onThinkingChange);
 const levels=[...new Set(selected?.thinkingLevels?.filter(level=>typeof level==='string'&&level.length>0)??[])];
 const selectedEffort=levels.includes(thinkingLevel)?thinkingLevel:'';
 const providers=useMemo(()=>[...new Set(models.map(model=>model.provider))],[models]);
 const groups=useMemo(()=>{
  const tokens=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean),result=new Map<string,ModelInfo[]>();
  for(const model of models){
   if(provider!=='all'&&model.provider!==provider)continue;
   const source=(model.name+' '+model.id+' '+providerLabel(model.provider)).toLocaleLowerCase();
   if(!tokens.every(token=>source.includes(token)))continue;
   const group=result.get(model.provider)??[];group.push(model);result.set(model.provider,group);
  }
  return [...result.entries()];
 },[models,query,provider]);
 const visible=groups.flatMap(([,group])=>group),active=visible.find(model=>model.id===activeId)??visible[0];
 const optionId=(model:ModelInfo)=>id+'-option-'+models.indexOf(model);
 const name=selected?.name??(modelId||'Select model'),caption=combined&&selectedEffort?effortLabel(selectedEffort):'';
 function close(restoreFocus=false){setOpen(false);if(restoreFocus)trigger.current?.focus();}
 function show(){if(locked)return;setQuery('');setProvider('all');setActiveId(modelId);setPresent(true);setOpen(true);}
 function choose(model:ModelInfo){if(locked)return;onChange(model.id);if(!combined)close(true);}
 function chooseEffort(level:string,dismiss=true){if(locked||!onThinkingChange||(level!==''&&!levels.includes(level)))return;onThinkingChange(level);if(dismiss)close(true);}
 function navigate(event:KeyboardEvent<HTMLInputElement>){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
  if(event.key==='Tab'&&!combined){close(true);return;}
  if(event.key==='ArrowRight'&&combined&&levels.length){event.preventDefault();reasoning.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();return;}
  if(event.key==='Enter'){event.preventDefault();if(active)choose(active);return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const index=visible.findIndex(model=>model.id===active?.id),count=visible.length;if(!count)return;
  const next=event.key==='Home'?0:event.key==='End'?count-1:(index+(event.key==='ArrowDown'?1:-1)+count)%count;setActiveId(visible[next].id);
 }
 function navigateEffort(event:KeyboardEvent<HTMLButtonElement>,index:number){
  if(event.key==='ArrowLeft'){event.preventDefault();search.current?.focus();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const options=['',...levels],next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
  chooseEffort(options[next],false);reasoning.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
 }
 useLayoutEffect(()=>{
  if(!open)return;
  function place(){
   const anchor=trigger.current?.getBoundingClientRect();if(!anchor)return;
   const width=Math.min(combined?720:460,Math.max(0,window.innerWidth-24)),above=Math.max(0,anchor.top-20),below=Math.max(0,window.innerHeight-anchor.bottom-20);
   const side=above>=Math.min(300,below)?'above':'below',height=Math.min(combined?460:400,side==='above'?above:below);
   const left=Math.max(12,Math.min(anchor.right-width,window.innerWidth-width-12)),top=side==='above'?Math.max(12,anchor.top-height-8):Math.min(window.innerHeight-height-12,anchor.bottom+8);
   setPosition({side,style:{width,left,top,height,maxHeight:'calc(100dvh - 24px)'}});
  }
  place();search.current?.focus();
  const onScroll=(event:Event)=>{if(!popover.current?.contains(event.target as Node))place();};
  const observer=new ResizeObserver(place);if(trigger.current)observer.observe(trigger.current);const toolbar=trigger.current?.closest('.composer-toolbar');if(toolbar)observer.observe(toolbar);
  window.addEventListener('resize',place);window.addEventListener('scroll',onScroll,true);
  return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',onScroll,true);};
 },[open,combined]);
 useEffect(()=>{if(open||!present)return;const timeout=window.setTimeout(()=>setPresent(false),110);return()=>window.clearTimeout(timeout);},[open,present]);
 useEffect(()=>{if(locked)setOpen(false);},[locked]);
 useEffect(()=>{if(provider!=='all'&&!providers.includes(provider))setProvider('all');},[provider,providers]);
 useEffect(()=>{
  if(!open)return;
  const outside=(event:Event)=>{const target=event.target as Node;if(!trigger.current?.contains(target)&&!popover.current?.contains(target))close();};
  document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);};
 },[open]);
 useEffect(()=>{if(open&&active)document.getElementById(optionId(active))?.scrollIntoView({block:'nearest'});},[open,active?.id]);
 return <>
  <button ref={trigger} type="button" role="combobox" aria-label="Model" aria-expanded={open} aria-haspopup={combined?'dialog':'listbox'} aria-controls={combined?id+'-picker':id+'-list'} disabled={locked} className="composer-tool model-picker-trigger" title={disabled?'Wait for the active run to finish to change models':name+(caption?' · '+caption:'')} onClick={()=>open?close(true):show()} onKeyDown={event=>{if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();if(open)search.current?.focus();else show();}}}>
   <Bot className="model-picker-trigger-icon" size={16} aria-hidden="true"/><span className="model-picker-trigger-name">{name}</span>{caption&&<span className="model-picker-trigger-effort">{caption}</span>}<ChevronDown size={12} data-open={open}/>
  </button>
  {present&&createPortal(<div ref={popover} id={id+'-picker'} role={combined?'dialog':undefined} aria-label={combined?'Model and reasoning':undefined} className="model-picker-popover" data-combined={combined} data-state={open?'open':'closed'} data-side={position.side} style={position.style} aria-hidden={!open} inert={!open} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();close(true);}}}>
   <nav className="model-picker-providers" aria-label="Model providers">
    <button type="button" aria-label="All providers" title="All providers" aria-pressed={provider==='all'} onClick={()=>setProvider('all')}><Layers size={18}/></button>
    {providers.map(value=><button type="button" key={value} aria-label={'Filter by '+providerLabel(value)} title={providerLabel(value)} aria-pressed={provider===value} onClick={()=>setProvider(value)}><span aria-hidden="true">{value.replace(/-.*/,'').slice(0,2).toUpperCase()}</span></button>)}
   </nav>
   <div className="model-picker-main">
    <div className="model-picker-search"><Search size={16} aria-hidden="true"/><input ref={search} type="search" aria-label="Search models" placeholder="Search models…" value={query} autoComplete="off" spellCheck={false} aria-controls={id+'-list'} aria-activedescendant={active?optionId(active):undefined} onChange={event=>{setQuery(event.target.value);setActiveId(modelId);}} onKeyDown={navigate}/><kbd aria-hidden="true">Esc</kbd></div>
    <div id={id+'-list'} role="listbox" aria-label="Available models" className="model-picker-list">
     {groups.map(([value,group])=><div role="group" aria-label={providerLabel(value)} className="model-picker-group" key={value}><div className="model-picker-provider" aria-hidden="true">{providerLabel(value)}</div>{group.map(model=><div id={optionId(model)} role="option" aria-label={model.name} aria-selected={model.id===modelId} data-active={model.id===active?.id} className="model-picker-option" key={model.id} onPointerMove={()=>setActiveId(model.id)} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(model)}><Bot size={17} aria-hidden="true"/><span>{model.name}</span>{model.id===modelId&&<Check className="model-picker-check" size={16} aria-hidden="true"/>}</div>)}</div>)}
    </div>
    {!visible.length&&<p className="model-picker-empty" role="status">No models found<span>Try another model or provider name.</span></p>}
   </div>
   {combined&&<div ref={reasoning} className="model-picker-reasoning" role="group" aria-label="Reasoning"><header><span>Reasoning</span><small>{selected?.name??'Select a model'}</small></header>{levels.length?<div className="model-picker-efforts" role="radiogroup" aria-label="Reasoning effort">{['',...levels].map((level,index)=><button type="button" role="radio" aria-label={level?effortLabel(level):'Default'} aria-checked={level===selectedEffort} key={level} onClick={()=>chooseEffort(level)} onKeyDown={event=>navigateEffort(event,index)}><span>{level?effortLabel(level):'Default'}</span>{level===selectedEffort&&<Check size={15} aria-hidden="true"/>}</button>)}</div>:<p className="model-picker-no-effort">No reasoning settings</p>}</div>}
  </div>,document.body)}
 </>;
}
