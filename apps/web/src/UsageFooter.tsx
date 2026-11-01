import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import{createPortal}from'react-dom';
import {Activity} from 'lucide-react';
import type {RuntimeUsage} from '../../../packages/contracts';
import {FloatingWindow} from './FloatingWindow';
import {useDesktop,useDetachedSurface} from './desktop-context';

const valid=(value:number|null|undefined):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const number=(value:number|null|undefined)=>valid(value)?new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(value):'Unavailable';
const money=(value:number|null|undefined)=>valid(value)?new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(value):'Unavailable';
const percentage=(value:number|null|undefined)=>valid(value)&&value<=100?`${Number(value.toFixed(1))}%`:'Unavailable';
export function UsageFooter({usage,visible,threadId}:{usage?:RuntimeUsage;visible:boolean;threadId?:string}){
  const desktop=useDesktop(),detached=useDetachedSurface(threadId?{kind:"usage",threadId}:null),[error,setError]=useState('');
  const [dismissed,setDismissed]=useState(()=>{try{return localStorage.getItem('harness:usage-floating-open')!=='true';}catch{return true;}}),reopen=useRef<HTMLButtonElement>(null);
  const[launcher,setLauncher]=useState<HTMLElement|null>(null);
  useLayoutEffect(()=>{setLauncher(document.querySelector<HTMLElement>('.header-actions'));},[]);
  useEffect(()=>{try{localStorage.setItem('harness:usage-floating-open',String(!dismissed));}catch{/* The explicit choice still works without preference storage. */}},[dismissed]);
  const context=valid(usage?.contextTokens)&&valid(usage?.contextWindow)&&usage.contextWindow>0?Math.min(100,usage.contextTokens/usage.contextWindow*100):null;
  if(!visible)return null;
  const tokens=valid(usage?.inputTokens)||valid(usage?.outputTokens);
  const summary=<><Activity size={12} aria-hidden="true"/>{tokens?<><span className="usage-value"><strong>{number(usage?.inputTokens)}</strong> in</span><span className="usage-value"><strong>{number(usage?.outputTokens)}</strong> out</span></>:<span>Usage unavailable</span>}{context!==null&&<span className="usage-context-inline">{Math.round(context)}% context</span>}{valid(usage?.cost)&&<span className="usage-cost">{money(usage.cost)}</span>}</>;
  return <>
    <FloatingWindow id="usage" title="Live usage" ariaLabel="Live usage" anchor="bottom-right" open={!dismissed&&!detached} onDetach={desktop&&threadId?()=>{void desktop.detachSurface({kind:"usage",threadId}).catch(cause=>setError(cause instanceof Error?cause.message:"Usage could not detach."));}:undefined} onClose={()=>{setDismissed(true);requestAnimationFrame(()=>reopen.current?.focus({preventScroll:true}));}} defaultSize={{width:356,height:314}} minSize={{width:280,height:248}} defaultCollapsed summary={summary} collapsedLabel="Inspect live usage" minimizeLabel="Close live usage details" escapeBehavior="collapse" className="floating-usage-window">
      <section className="floating-usage-details" aria-label="Runtime usage details">
        <dl><dt>Input tokens</dt><dd>{number(usage?.inputTokens)}</dd><dt>Output tokens</dt><dd>{number(usage?.outputTokens)}</dd><dt>Context</dt><dd>{valid(usage?.contextTokens)&&valid(usage?.contextWindow)?`${number(usage.contextTokens)} / ${number(usage.contextWindow)}`:'Unavailable'}</dd></dl>
        {context!==null&&<div className="usage-context-track" aria-hidden="true"><span style={{width:`${context}%`}}/></div>}
        <dl><dt>Reported cost</dt><dd>{money(usage?.cost)}</dd><dt>Session allowance</dt><dd>{percentage(usage?.sessionPercent)}</dd><dt>Weekly allowance</dt><dd>{percentage(usage?.weeklyPercent)}</dd></dl>
      </section>
    </FloatingWindow>
    {error&&<p role="alert" className="error-text">{error}</p>}
    {dismissed&&(launcher?createPortal(<button ref={reopen} className="usage-window-reopen usage-window-reopen-inline" type="button" aria-label="Show live usage" onClick={()=>setDismissed(false)}><Activity size={12} aria-hidden="true"/></button>,launcher):<button ref={reopen} className="usage-window-reopen" type="button" aria-label="Show live usage" onClick={()=>setDismissed(false)}><Activity size={12} aria-hidden="true"/>Show live usage</button>)}
  </>;
}
