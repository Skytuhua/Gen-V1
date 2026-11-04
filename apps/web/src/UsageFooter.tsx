import {Activity} from 'lucide-react';
import type {RuntimeUsage} from '../../../packages/contracts';
import {FloatingWindow} from './FloatingWindow';

const valid=(value:number|null|undefined):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const number=(value:number|null|undefined)=>valid(value)?new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(value):'Unavailable';
const money=(value:number|null|undefined)=>valid(value)?new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(value):'Unavailable';
const percentage=(value:number|null|undefined)=>valid(value)&&value<=100?`${Number(value.toFixed(1))}%`:'Unavailable';
export function UsageFooter({usage,visible}:{usage?:RuntimeUsage;visible:boolean;threadId?:string}){
  const context=valid(usage?.contextTokens)&&valid(usage?.contextWindow)&&usage.contextWindow>0?Math.min(100,usage.contextTokens/usage.contextWindow*100):null;
  if(!visible)return null;
  const summary=<><Activity size={12} aria-hidden="true"/><span>{context===null?'Context unavailable':'Context'}</span>{context!==null&&<strong>{Math.round(context)}%</strong>}</>;
  return <FloatingWindow id="usage" title="Live usage" ariaLabel="Live usage" anchor="bottom-right" minimizeOnly defaultSize={{width:320,height:200}} minSize={{width:260,height:140}} sizing="content" defaultCollapsed summary={summary} collapsedLabel="Inspect live usage" minimizeLabel="Minimize live usage" escapeBehavior="collapse" className="floating-usage-window">
      <section className="floating-usage-details" aria-label="Runtime usage details">
        <div className="usage-context-summary"><span>Conversation space</span><strong>{context===null?'Not reported':`${Math.round(context)}% used`}</strong></div>
        {context!==null&&<div className="usage-context-track" role="progressbar" aria-label="Conversation space used" aria-valuenow={context} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${context}%`}}/></div>}
        <details className="usage-secondary-details"><summary>Details</summary><dl><dt>Context tokens</dt><dd>{valid(usage?.contextTokens)&&valid(usage?.contextWindow)?`${number(usage.contextTokens)} / ${number(usage.contextWindow)}`:'Unavailable'}</dd><dt>Input tokens</dt><dd>{number(usage?.inputTokens)}</dd><dt>Output tokens</dt><dd>{number(usage?.outputTokens)}</dd><dt>Reported cost</dt><dd>{money(usage?.cost)}</dd><dt>Session allowance</dt><dd>{percentage(usage?.sessionPercent)}</dd><dt>Weekly allowance</dt><dd>{percentage(usage?.weeklyPercent)}</dd></dl></details>
      </section>
    </FloatingWindow>;
}
