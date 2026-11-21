import {useContext,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type KeyboardEvent,type ReactNode} from 'react';
import {useStateStore,type ComponentRegistry,type ComponentRenderProps} from '@json-render/react';
import {ArrowUpRight,Check,Minus} from 'lucide-react';
import {EVERYDAY_SCHEMAS,EVERYDAY_DATA_SCHEMAS,boundedEverydayData,type StatsData,type CredentialEntryProps} from '../../../packages/ui-catalog/everyday';
import {ArtifactTitle,inputPath,statePath,useTaskAction} from './task-context';
import {animateTask} from './task-motion';
import {readMotionPolicy} from './motion-policy';
import {ornament,usePublicationEntrance,type SoftwareSelectionCause} from './SoftwareDevelopment';
import {CredentialEntry} from './CredentialEntry';
import './everyday-data.css';
import {useTableOverflow} from './use-table-overflow';

function TableScroll({label, children}: {label:string; children:ReactNode}) {
  const ref=useRef<HTMLDivElement>(null), overflowing=useTableOverflow(ref);
  return <div ref={ref} className="everyday-comparison-scroll" role={overflowing?'region':undefined} tabIndex={overflowing?0:undefined} aria-label={overflowing?label:undefined}>{children}</div>;
}
const numberFormat=new Intl.NumberFormat(undefined,{maximumFractionDigits:2}),currencyFormats=new Map<string,Intl.NumberFormat>();
const number=(value:number)=>numberFormat.format(value);
function metricValue(metric:StatsData['metrics'][number],value=metric.value){
  if(value===null)return 'Unavailable';
  if(metric.format==='currency'){const code=metric.currency!;let format=currencyFormats.get(code);if(!format){format=new Intl.NumberFormat(undefined,{style:'currency',currency:code,maximumFractionDigits:2});currencyFormats.set(code,format);}return format.format(value);}
  return number(value)+(metric.format==='percent'?'%':'');
}
function Source({text}:{text?:string}){return text?<details className="everyday-source"><summary>Source</summary><p>{text}</p></details>:null;}
function Trend({metric}:{metric:StatsData['metrics'][number]}){
  const series=metric.series??[],known=series.filter((point):point is typeof point&{value:number}=>point.value!==null);
  const low=Math.min(...known.map(point=>point.value)),high=Math.max(...known.map(point=>point.value)),spread=high-low;let drawing=false;
  const x=(index:number)=>18+(series.length>1?index/(series.length-1):.5)*684,y=(value:number)=>spread?118-(value-low)/spread*96:72;
  const path=series.map((point,index)=>{if(point.value===null){drawing=false;return '';}const command=drawing?'L':'M';drawing=true;return `${command}${x(index).toFixed(2)} ${y(point.value).toFixed(2)}`;}).join(' ');
  if(!series.length)return <p className="everyday-empty">No trend values supplied.</p>;
  const scaleValue=(value:number)=>metricValue(metric,value)+(metric.unit&&metric.format!=='percent'?` ${metric.unit}`:'');
  const sourceValues=<details className="everyday-source-values"><summary>View source values</summary><TableScroll label={`${metric.label} source values`}><table><caption>{metric.label} source values</caption><thead><tr><th scope="col">Period</th><th scope="col" className="number">Value{metric.unit?` (${metric.unit})`:''}</th></tr></thead><tbody>{series.map((point,index)=><tr key={index}><th scope="row">{point.label}</th><td className="number">{metricValue(metric,point.value)}</td></tr>)}</tbody></table></TableScroll></details>;
  if(!known.length)return <><div className="everyday-trend everyday-trend-empty" data-scaled="false"><span className="everyday-trend-missing">Trend unavailable</span></div><div className="everyday-trend-labels" aria-hidden="true"><span>{series[0].label}</span><span>{series.at(-1)?.label}</span></div>{sourceValues}</>;
  return <><div className="everyday-trend" data-scaled={known.length>0}><div className={`everyday-trend-scale${spread?'':' is-flat'}`} role="group" aria-label="Trend scale"><span className="is-upper">{scaleValue(high)}</span>{spread>0&&<span className="is-lower">{scaleValue(low)}</span>}</div><svg viewBox="0 0 720 140" role="img" aria-label={`${metric.label} trend`}><title>{metric.label} trend</title><path className="everyday-trend-baseline" d="M18 126H702"/><path className="everyday-trend-line" d={path}/> {series.map((point,index)=>point.value===null?null:<circle className="everyday-trend-point" key={index} cx={x(index)} cy={y(point.value)} r={3}><title>{point.label}: {scaleValue(point.value)}</title></circle>)}</svg></div>
    <div className="everyday-trend-labels" aria-hidden="true"><span>{series[0].label}</span><span>{series.at(-1)?.label}</span></div>
    {sourceValues}</>;
}
export function Stats({element:{props}}:ComponentRenderProps){
  const p=EVERYDAY_SCHEMAS.Stats.parse(props),store=useStateStore(),outer=useContext(ArtifactTitle),raw=store.get(inputPath(p.dataBinding));
  const parsed=useMemo(()=>boundedEverydayData('Stats',raw)?EVERYDAY_DATA_SCHEMAS.Stats.safeParse(raw):null,[raw]);
  const metrics=parsed?.success?parsed.data.metrics:[],saved=store.get(statePath(p.stateKey)),selected=metrics.find(metric=>metric.id===saved)??metrics[0],id=useId();
  const nav=useRef<HTMLDivElement>(null),indicator=useRef<HTMLSpanElement>(null),region=useRef<HTMLDivElement>(null);
  const pending=useRef<{id:string;cause:SoftwareSelectionCause}|undefined>(undefined),prevRect=useRef<{x:number;y:number;w:number}|undefined>(undefined),underline=useRef<Animation|undefined>(undefined),chart=useRef<Animation|undefined>(undefined);
  const entrance=usePublicationEntrance(node=>{
    const result=node.querySelector<HTMLElement>('.everyday-stat-result');if(!result)return[];
    return [ornament(result,'everyday-entry-tick',[{transform:'scaleX(0)'},{transform:'scaleX(1)'}],120)];
  });
  useEffect(()=>{if(selected&&saved!==selected.id)queueMicrotask(()=>{if(!metrics.some(metric=>metric.id===store.get(statePath(p.stateKey))))store.set(statePath(p.stateKey),selected.id);});},[selected?.id,saved,store,p.stateKey,metrics]);
  useLayoutEffect(()=>{
    const track=nav.current,ind=indicator.current;
    const button=track?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    const mark=pending.current;pending.current=undefined;
    if(track&&ind&&button){
      const target={x:button.offsetLeft,y:button.offsetTop+button.offsetHeight-2,w:button.offsetWidth-14},from=prevRect.current;prevRect.current=target;
      ind.style.width=`${target.w}px`;ind.style.transform=`translate(${target.x}px,${target.y}px)`;
      if(mark?.cause==='pointer'&&mark.id===selected?.id&&from&&(from.x!==target.x||from.y!==target.y||from.w!==target.w)){
        underline.current?.cancel();
        ind.style.setProperty('--everyday-indicator-duration','140ms');
        underline.current=animateTask(ind,[{transform:`translate(${from.x}px,${from.y}px) scaleX(${from.w/Math.max(1,target.w)})`},{transform:`translate(${target.x}px,${target.y}px) scaleX(1)`}],140,{duration:'--everyday-indicator-duration',easing:'--ui-ease-enter'});
      }else{underline.current?.cancel();underline.current=undefined;}
    }
    const trend=region.current?.querySelector<HTMLElement>('.everyday-trend');
    if(mark?.cause==='pointer'&&mark.id===selected?.id&&trend){trend.style.setProperty('--everyday-chart-duration','120ms');chart.current=animateTask(trend,[{opacity:.85},{opacity:1}],120,{duration:'--everyday-chart-duration',easing:'--ui-ease-enter'});}
    else{chart.current?.cancel();chart.current=undefined;}
  },[selected?.id]);
  useLayoutEffect(()=>{
    const track=nav.current;if(!track)return;
    const settle=()=>{
      const ind=indicator.current,button=track.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if(!ind||!button)return;
      underline.current?.cancel();underline.current=undefined;
      const target={x:button.offsetLeft,y:button.offsetTop+button.offsetHeight-2,w:button.offsetWidth-14};
      prevRect.current=target;ind.style.width=`${target.w}px`;ind.style.transform=`translate(${target.x}px,${target.y}px)`;
    };
    track.addEventListener('scroll',settle,{passive:true});
    const observer=new ResizeObserver(settle);observer.observe(track);
    return()=>{track.removeEventListener('scroll',settle);observer.disconnect();};
  },[]);
  if(!parsed?.success||!selected)return <p className="everyday-unavailable" role="status">Statistics are unavailable from the connected source.</p>;
  const select=(value:string,cause:SoftwareSelectionCause)=>{pending.current={id:value,cause};if(value!==selected.id)store.set(statePath(p.stateKey),value);};
  const keyboard=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')??[]);const next=event.key==='Home'?0:event.key==='End'?metrics.length-1:(index+(event.key==='ArrowRight'?1:-1)+metrics.length)%metrics.length;if(!tabs[next]||!metrics[next])return;select(metrics[next].id,'keyboard');tabs[next].focus({preventScroll:true});};const delta=selected.comparison;
  return <section ref={entrance as React.RefObject<HTMLElement>} className="everyday-stats" aria-label={parsed.data.title??'Statistics'}>
    {(parsed.data.title&&parsed.data.title!==outer||parsed.data.period)&&<header className="everyday-heading">{parsed.data.title&&parsed.data.title!==outer?<h3>{parsed.data.title}</h3>:<span/>}{parsed.data.period&&<span>{parsed.data.period}</span>}</header>}
    {metrics.length>1&&<div ref={nav} className="everyday-metric-nav" role="tablist" aria-label="Statistics">{metrics.map((metric,index)=><button key={metric.id} type="button" role="tab" aria-label={metric.label} id={`${id}-${metric.id}`} aria-controls={`${id}-selected`} aria-selected={metric.id===selected.id} tabIndex={metric.id===selected.id?0:-1} onClick={event=>select(metric.id,event.detail>0?'pointer':'keyboard')} onKeyDown={event=>keyboard(event,index)}><span>{metric.label}</span></button>)}<span ref={indicator} className="everyday-metric-indicator" aria-hidden="true"/></div>}
    <div className="everyday-selected-stat" ref={region} role="region" aria-label="Selected statistic" id={`${id}-selected`}>
      <div className="everyday-metric-detail"><p className="everyday-stat-label">{selected.label}</p><div className="everyday-stat-result"><strong className="everyday-stat-value">{metricValue(selected)}</strong>{selected.value!==null&&selected.unit&&selected.format!=='percent'&&<span>{selected.unit}</span>}</div>
      {delta&&<p className={`everyday-stat-comparison${delta.favorable===true?' is-favorable':delta.favorable===false?' is-unfavorable':''}`}><span>{delta.value===null?'Change unavailable':`${delta.value>0?'+':''}${number(delta.value)}${delta.unit==='percent'?'%':delta.unit==='percentage-points'?' pp':''}`}</span>{delta.label}</p>}</div><Trend metric={selected}/>
    </div><Source text={parsed.data.source}/></section>;
}
type ComparisonState={selectedId:string;differencesOnly:boolean};
const comparisonValue=(value:string|number|boolean|null|undefined)=>value==null?'Unavailable':typeof value==='boolean'?(value?'Yes':'No'):typeof value==='number'?number(value):value;
const clickCause=(event:{detail:number}):SoftwareSelectionCause=>event.detail>0?'pointer':'keyboard';
export function Comparison({element:{props}}:ComponentRenderProps){
  const p=EVERYDAY_SCHEMAS.Comparison.parse(props),store=useStateStore(),outer=useContext(ArtifactTitle),action=useTaskAction(),raw=store.get(inputPath(p.dataBinding));
  const parsed=useMemo(()=>boundedEverydayData('Comparison',raw)?EVERYDAY_DATA_SCHEMAS.Comparison.safeParse(raw):null,[raw]),options=parsed?.success?parsed.data.options:[];
  const saved=store.get(statePath(p.stateKey)),record=saved&&typeof saved==='object'?saved as Partial<ComparisonState>:{selectedId:typeof saved==='string'?saved:undefined};
  const selected=options.find(option=>option.id===record.selectedId)??options[0],differencesOnly=record.differencesOnly===true;
  const section=useRef<HTMLElement>(null),prevSelected=useRef(selected?.id),selectCause=useRef<SoftwareSelectionCause|undefined>(undefined),accent=useRef<string|undefined>(undefined),cellAnimations=useRef<Animation[]>([]);
  const previousValues=useRef(new Map<string,unknown>()),initializedValues=useRef(false);
  const [receipt,setReceipt]=useState<{optionId:string;generation:number}|undefined>(undefined),intent=useRef(0),selectedRef=useRef(selected?.id);
  const labelRef=useRef<HTMLSpanElement>(null);
  const entrance=usePublicationEntrance(node=>{
    const th=node.querySelector<HTMLElement>('.everyday-comparison-table thead th.is-selected');if(!th)return[];
    return [ornament(th,'everyday-entry-column-edge',[{transform:'scaleX(0)'},{transform:'scaleX(1)'}],150)];
  });
  useLayoutEffect(()=>{
    const root=section.current;if(!root||!parsed?.success)return;
    const next=new Map<string,unknown>(),changed:{optionId:string;criterionId:string}[]=[];
    for(const option of options)for(const criterion of parsed.data.criteria){
      const key=option.id+' '+criterion.id,value=option.values[criterion.id]??null;
      next.set(key,value);
      if(initializedValues.current&&!Object.is(previousValues.current.get(key),value)&&previousValues.current.has(key))changed.push({optionId:option.id,criterionId:criterion.id});
    }
    previousValues.current=next;initializedValues.current=true;
    if(!changed.length)return;
    const probe=document.createElement('span');probe.style.backgroundColor='color-mix(in srgb,var(--accent-fg) 18%,transparent)';root.appendChild(probe);const strong=getComputedStyle(probe).backgroundColor;probe.remove();
    for(const target of changed){
      const cell=root.querySelector<HTMLElement>(`td[data-column="${CSS.escape(target.optionId)}"][data-criterion="${CSS.escape(target.criterionId)}"]`);
      if(!cell)continue;
      cell.style.setProperty('--everyday-cell-duration','120ms');
      const animation=animateTask(cell,[{backgroundColor:getComputedStyle(cell).backgroundColor},{backgroundColor:strong,offset:.5},{backgroundColor:getComputedStyle(cell).backgroundColor}],120,{duration:'--everyday-cell-duration',easing:'--ui-ease-enter'});
      if(animation){cellAnimations.current.push(animation);const drop=()=>{const index=cellAnimations.current.indexOf(animation);if(index>=0)cellAnimations.current.splice(index,1);};animation.addEventListener('finish',drop,{once:true});animation.addEventListener('cancel',drop,{once:true});}
    }
  });
  useLayoutEffect(()=>()=>{for(const animation of cellAnimations.current)animation.cancel();cellAnimations.current=[];},[]);
  useLayoutEffect(()=>{
    const previous=prevSelected.current,next=selected?.id;prevSelected.current=next;
    const cause=selectCause.current;selectCause.current=undefined;
    intent.current++;selectedRef.current=next;setReceipt(undefined);
    const root=section.current;if(!root)return;
    const newCells=Array.from(root.querySelectorAll<HTMLElement>(`.everyday-comparison-table [data-column].is-selected`)),selectedBg=newCells.length?getComputedStyle(newCells[0]).backgroundColor:undefined;
    if(selectedBg&&selectedBg!=='rgba(0, 0, 0, 0)'&&selectedBg!=='transparent')accent.current=selectedBg;
    if(previous===next||cause!=='pointer'||!next)return;
    const oldCells=Array.from(root.querySelectorAll<HTMLElement>(`[data-column="${CSS.escape(previous)}"]`));
    for(const cell of oldCells){cell.style.setProperty('--everyday-cell-duration','120ms');animateTask(cell,[{backgroundColor:accent.current??'rgba(0, 0, 0, 0)'},{backgroundColor:getComputedStyle(cell).backgroundColor}],120,{duration:'--everyday-cell-duration',easing:'--ui-ease-enter'});}
    for(const cell of newCells){cell.style.setProperty('--everyday-cell-duration','120ms');animateTask(cell,[{backgroundColor:'rgba(0, 0, 0, 0)'},{backgroundColor:selectedBg}],120,{duration:'--everyday-cell-duration',easing:'--ui-ease-enter'});}
    const check=root.querySelector<SVGGeometryElement>(`.everyday-comparison-table th.is-selected .everyday-option-selector svg polyline`);
    if(check&&readMotionPolicy()==='full'){check.setAttribute('pathLength','1');check.style.strokeDasharray='1';check.animate([{strokeDashoffset:'1'},{strokeDashoffset:'0'}],{duration:90,easing:'cubic-bezier(.16,1,.3,1)'});}
  },[selected?.id]);
  useLayoutEffect(()=>{const node=labelRef.current;if(node&&receipt)animateTask(node,[{opacity:.8},{opacity:1}],120);},[receipt]);
  if(!parsed?.success||!selected)return <p className="everyday-unavailable" role="status">Comparison data is unavailable from the connected source.</p>;
  const criteria=parsed.data.criteria.filter(criterion=>!differencesOnly||options.some(option=>!Object.is(option.values[criterion.id]??null,options[0].values[criterion.id]??null)));
  const save=(patch:Partial<ComparisonState>)=>store.set(statePath(p.stateKey),{selectedId:selected.id,differencesOnly,...patch});
  const choose=(id:string,cause:SoftwareSelectionCause)=>{selectCause.current=cause;if(id!==selected.id)save({selectedId:id});};
  const submit=async()=>{
    const generation=++intent.current,optionId=selected.id;
    setReceipt(undefined);
    const ok=await action.run(p.actionId!,{optionId,label:selected.label});
    if(ok&&intent.current===generation&&selectedRef.current===optionId)setReceipt({optionId,generation});
  };
  const busyLabel=action.busy?'Submitting…':receipt?'Preference submitted':p.actionLabel??`Continue with ${selected.label}`;
  return <section ref={node=>{(section as React.MutableRefObject<HTMLElement|null>).current=node;(entrance as React.RefObject<HTMLElement|null>).current=node;}} className="everyday-comparison" aria-label={parsed.data.title??'Comparison'}>
    {parsed.data.title&&parsed.data.title!==outer&&<header className="everyday-heading"><h3>{parsed.data.title}</h3></header>}
    <div className="everyday-comparison-controls"><div className="everyday-comparison-current"><strong>{selected.label}</strong>{selected.summary&&<p className="everyday-selected-summary">{selected.summary}</p>}</div><label className="everyday-difference-toggle"><input type="checkbox" checked={differencesOnly} onChange={event=>save({differencesOnly:event.target.checked})}/>Differences only</label></div>
    <TableScroll label="Compare options"><table className="everyday-comparison-table"><caption className="sr-only">Compare options</caption><thead><tr><th scope="col"><span className="sr-only">Criteria</span></th>{options.map(option=><th key={option.id} scope="col" data-column={option.id} className={option.id===selected.id?'is-selected':''}><button type="button" aria-label={`Select ${option.label}`} aria-pressed={option.id===selected.id} onClick={event=>choose(option.id,clickCause(event))}><span className="everyday-option-selector" aria-hidden="true">{option.id===selected.id&&<Check size={12}/>}</span><strong>{option.label}</strong></button>{option.summary&&<details className="everyday-column-details"><summary aria-label={`Details for ${option.label}`}>Details</summary><p>{option.summary}</p></details>}</th>)}</tr></thead><tbody>{criteria.map(criterion=><tr key={criterion.id}><th scope="row">{criterion.label}{criterion.unit&&<small>{criterion.unit}</small>}</th>{options.map(option=><td key={option.id} data-column={option.id} data-criterion={criterion.id} className={`${option.id===selected.id?'is-selected ':''}${option.values[criterion.id]==null?'is-unavailable':''} ${typeof option.values[criterion.id]==='number'?'number':''}`}>{comparisonValue(option.values[criterion.id])}</td>)}</tr>)}</tbody></table></TableScroll>
    {!criteria.length&&<p className="everyday-empty"><Minus size={13}/>The supplied values are the same for every option.</p>}
    {p.actionId&&<footer className="everyday-comparison-footer"><button type="button" className="primary" disabled={action.busy} onClick={()=>void submit()}><span className="everyday-action-labels"><span aria-hidden="true">{p.actionLabel??`Continue with ${selected.label}`}</span><span aria-hidden="true">Submitting…</span><span aria-hidden="true">Preference submitted</span><span ref={labelRef} className="everyday-action-current">{busyLabel}</span></span><ArrowUpRight size={13}/></button>{receipt&&<span role="status" className="sr-only">Preference submitted</span>}</footer>}
    {action.error&&<p className="error-text" role="status">{action.error}</p>}<Source text={parsed.data.source}/></section>;
}
export const EVERYDAY_REGISTRY:ComponentRegistry={Stats,Comparison,CredentialEntry:({element:{props}})=><CredentialEntry {...props as CredentialEntryProps}/>};
