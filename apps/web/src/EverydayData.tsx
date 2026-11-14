import {useContext,useEffect,useId,useMemo,useRef,type KeyboardEvent} from 'react';
import {useStateStore,type ComponentRegistry,type ComponentRenderProps} from '@json-render/react';
import {ArrowUpRight,Check,Minus} from 'lucide-react';
import {EVERYDAY_SCHEMAS,EVERYDAY_DATA_SCHEMAS,boundedEverydayData,type StatsData,type CredentialEntryProps} from '../../../packages/ui-catalog/everyday';
import {ArtifactTitle,inputPath,statePath,useTaskAction} from './task-context';
import {animateTask} from './task-motion';
import {CredentialEntry} from './CredentialEntry';
import './everyday-data.css';
import {useTableOverflow} from './use-table-overflow';

function TableScroll({label, children}: {label:string; children:import('react').ReactNode}) {
  const ref=useRef<HTMLDivElement>(null), overflowing=useTableOverflow(ref);
  return <div ref={ref} className="everyday-comparison-scroll" role={overflowing?'region':undefined} tabIndex={overflowing?0:undefined} aria-label={overflowing?label:undefined}>{children}</div>;
}
const number=(value:number)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value);
function metricValue(metric:StatsData['metrics'][number],value=metric.value){
  if(value===null)return 'Unavailable';
  if(metric.format==='currency')return new Intl.NumberFormat(undefined,{style:'currency',currency:metric.currency!,maximumFractionDigits:2}).format(value);
  return number(value)+(metric.format==='percent'?'%':'');
}
function Source({text}:{text?:string}){return text?<details className="everyday-source"><summary>Source</summary><p>{text}</p></details>:null;}
function useSelectionMotion(identity:string|undefined){
  const ref=useRef<HTMLDivElement>(null),previous=useRef(identity);
  useEffect(()=>{const changed=previous.current!==identity;previous.current=identity;if(!changed)return;const animation=animateTask(ref.current,[{opacity:.7,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],200);return()=>animation?.cancel();},[identity]);return ref;
}
function Trend({metric}:{metric:StatsData['metrics'][number]}){
  const series=metric.series??[],known=series.filter((point):point is typeof point&{value:number}=>point.value!==null);
  const low=Math.min(...known.map(point=>point.value)),high=Math.max(...known.map(point=>point.value)),spread=high-low;let drawing=false;
  const x=(index:number)=>18+(series.length>1?index/(series.length-1):.5)*684,y=(value:number)=>spread?160-(value-low)/spread*132:94;
  const path=series.map((point,index)=>{if(point.value===null){drawing=false;return '';}const command=drawing?'L':'M';drawing=true;return `${command}${x(index).toFixed(2)} ${y(point.value).toFixed(2)}`;}).join(' ');
  if(!series.length)return <p className="everyday-empty">No trend values supplied.</p>;
  const scaleValue=(value:number)=>metricValue(metric,value)+(metric.unit&&metric.format!=='percent'?` ${metric.unit}`:'');
  return <><div className="everyday-trend" data-scaled={known.length>0}>{known.length>0&&<div className={`everyday-trend-scale${spread?'':' is-flat'}`} role="group" aria-label="Trend scale"><span className="is-upper">{scaleValue(high)}</span>{spread>0&&<span className="is-lower">{scaleValue(low)}</span>}</div>}<svg viewBox="0 0 720 192" role="img" aria-label={`${metric.label} trend`}><title>{metric.label} trend</title><path className="everyday-trend-baseline" d="M18 169H702"/>{known.length>0&&<path className="everyday-trend-line" d={path}/>} {series.map((point,index)=>point.value===null?null:<circle className="everyday-trend-point" key={index} cx={x(index)} cy={y(point.value)} r={3}><title>{point.label}: {scaleValue(point.value)}</title></circle>)}</svg>{!known.length&&<span className="everyday-trend-missing">Trend unavailable</span>}</div>
    <div className="everyday-trend-labels" aria-hidden="true"><span>{series[0].label}</span><span>{series.at(-1)?.label}</span></div>
    <details className="everyday-source-values"><summary>View source values</summary><TableScroll label={`${metric.label} source values`}><table><caption>{metric.label} source values</caption><thead><tr><th scope="col">Period</th><th scope="col" className="number">Value{metric.unit?` (${metric.unit})`:''}</th></tr></thead><tbody>{series.map((point,index)=><tr key={index}><th scope="row">{point.label}</th><td className="number">{metricValue(metric,point.value)}</td></tr>)}</tbody></table></TableScroll></details></>;
}
export function Stats({element:{props}}:ComponentRenderProps){
  const p=EVERYDAY_SCHEMAS.Stats.parse(props),store=useStateStore(),outer=useContext(ArtifactTitle),raw=store.get(inputPath(p.dataBinding));
  const parsed=useMemo(()=>boundedEverydayData('Stats',raw)?EVERYDAY_DATA_SCHEMAS.Stats.safeParse(raw):null,[raw]);
  const metrics=parsed?.success?parsed.data.metrics:[],saved=store.get(statePath(p.stateKey)),selected=metrics.find(metric=>metric.id===saved)??metrics[0],id=useId(),detail=useSelectionMotion(selected?.id);
  useEffect(()=>{if(selected&&saved!==selected.id)queueMicrotask(()=>{if(!metrics.some(metric=>metric.id===store.get(statePath(p.stateKey))))store.set(statePath(p.stateKey),selected.id);});},[selected?.id,saved,store,p.stateKey,metrics]);
  if(!parsed?.success||!selected)return <p className="everyday-unavailable" role="status">Statistics are unavailable from the connected source.</p>;
  const select=(value:string)=>store.set(statePath(p.stateKey),value);
  const keyboard=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?metrics.length-1:(index+(event.key==='ArrowRight'?1:-1)+metrics.length)%metrics.length;select(metrics[next].id);(event.currentTarget.parentElement?.children[next] as HTMLButtonElement|undefined)?.focus();};const delta=selected.comparison;
  return <section className="everyday-stats" aria-label={parsed.data.title??'Statistics'}>
    {(parsed.data.title&&parsed.data.title!==outer||parsed.data.period)&&<header className="everyday-heading">{parsed.data.title&&parsed.data.title!==outer?<h3>{parsed.data.title}</h3>:<span/>}{parsed.data.period&&<span>{parsed.data.period}</span>}</header>}
    {metrics.length>1&&<div className="everyday-metric-nav" role="tablist" aria-label="Statistics">{metrics.map((metric,index)=><button key={metric.id} type="button" role="tab" aria-label={metric.label} id={`${id}-${metric.id}`} aria-controls={`${id}-selected`} aria-selected={metric.id===selected.id} tabIndex={metric.id===selected.id?0:-1} onClick={()=>select(metric.id)} onKeyDown={event=>keyboard(event,index)}><span>{metric.label}</span></button>)}</div>}
    <div className="everyday-selected-stat" ref={detail} role="region" aria-label="Selected statistic" id={`${id}-selected`}>
      <p className="everyday-stat-label">{selected.label}</p><div className="everyday-stat-result"><strong className="everyday-stat-value">{metricValue(selected)}</strong>{selected.value!==null&&selected.unit&&selected.format!=='percent'&&<span>{selected.unit}</span>}</div>
      {delta&&<p className={`everyday-stat-comparison${delta.favorable===true?' is-favorable':delta.favorable===false?' is-unfavorable':''}`}><span>{delta.value===null?'Change unavailable':`${delta.value>0?'+':''}${number(delta.value)}${delta.unit==='percent'?'%':delta.unit==='percentage-points'?' pp':''}`}</span>{delta.label}</p>}<Trend metric={selected}/>
    </div><Source text={parsed.data.source}/></section>;
}
type ComparisonState={selectedId:string;differencesOnly:boolean};
const comparisonValue=(value:string|number|boolean|null|undefined)=>value==null?'Unavailable':typeof value==='boolean'?(value?'Yes':'No'):typeof value==='number'?number(value):value;
export function Comparison({element:{props}}:ComponentRenderProps){
  const p=EVERYDAY_SCHEMAS.Comparison.parse(props),store=useStateStore(),outer=useContext(ArtifactTitle),action=useTaskAction(),raw=store.get(inputPath(p.dataBinding));
  const parsed=useMemo(()=>boundedEverydayData('Comparison',raw)?EVERYDAY_DATA_SCHEMAS.Comparison.safeParse(raw):null,[raw]),options=parsed?.success?parsed.data.options:[];
  const saved=store.get(statePath(p.stateKey)),record=saved&&typeof saved==='object'?saved as Partial<ComparisonState>:{selectedId:typeof saved==='string'?saved:undefined};
  const selected=options.find(option=>option.id===record.selectedId)??options[0],differencesOnly=record.differencesOnly===true;
  if(!parsed?.success||!selected)return <p className="everyday-unavailable" role="status">Comparison data is unavailable from the connected source.</p>;
  const criteria=parsed.data.criteria.filter(criterion=>!differencesOnly||options.some(option=>!Object.is(option.values[criterion.id]??null,options[0].values[criterion.id]??null)));
  const save=(patch:Partial<ComparisonState>)=>store.set(statePath(p.stateKey),{selectedId:selected.id,differencesOnly,...patch});
  return <section className="everyday-comparison" aria-label={parsed.data.title??'Comparison'}>
    <header className="everyday-heading">{parsed.data.title&&parsed.data.title!==outer?<h3>{parsed.data.title}</h3>:<span/>}<label className="everyday-difference-toggle"><input type="checkbox" checked={differencesOnly} onChange={event=>save({differencesOnly:event.target.checked})}/>Differences only</label></header>
    <TableScroll label="Compare options"><table className="everyday-comparison-table"><caption className="sr-only">Compare options</caption><thead><tr><th scope="col"><span className="sr-only">Criteria</span></th>{options.map(option=><th key={option.id} scope="col" className={option.id===selected.id?'is-selected':''}><button type="button" aria-label={`Select ${option.label}`} aria-pressed={option.id===selected.id} onClick={()=>save({selectedId:option.id})}><span className="everyday-option-selector" aria-hidden="true">{option.id===selected.id&&<Check size={12}/>}</span><strong>{option.label}</strong></button>{option.summary&&<p>{option.summary}</p>}</th>)}</tr></thead><tbody>{criteria.map(criterion=><tr key={criterion.id}><th scope="row">{criterion.label}{criterion.unit&&<small>{criterion.unit}</small>}</th>{options.map(option=><td key={option.id} className={`${option.id===selected.id?'is-selected ':''}${option.values[criterion.id]==null?'is-unavailable':''} ${typeof option.values[criterion.id]==='number'?'number':''}`}>{comparisonValue(option.values[criterion.id])}</td>)}</tr>)}</tbody></table></TableScroll>
    {!criteria.length&&<p className="everyday-empty"><Minus size={13}/>The supplied values are the same for every option.</p>}
    {p.actionId&&<footer className="everyday-comparison-footer"><button type="button" className="primary" disabled={action.busy} onClick={()=>void action.run(p.actionId!,{optionId:selected.id,label:selected.label})}>{action.busy?'Submitting…':p.actionLabel??`Continue with ${selected.label}`}<ArrowUpRight size={13}/></button></footer>}
    {action.error&&<p className="error-text" role="alert">{action.error}</p>}<Source text={parsed.data.source}/></section>;
}
export const EVERYDAY_REGISTRY:ComponentRegistry={Stats,Comparison,CredentialEntry:({element:{props}})=><CredentialEntry {...props as CredentialEntryProps}/>};
