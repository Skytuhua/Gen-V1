import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnDuration, armTurnElapsed } from '../apps/web/src/TurnDuration';
import type { TurnTimingV1 } from '../packages/contracts';

const timing=(over:Partial<TurnTimingV1>={}):TurnTimingV1=>({runId:'r1',threadId:'t1',startedAt:'2026-11-21T10:00:00.000',endedAt:'2026-11-21T10:01:12.000',outcome:'completed',...over});

describe('TurnDuration markup',()=>{
 it('renders one line per outcome word with a <time dateTime>',()=>{
  const cases:[Partial<TurnTimingV1>,string,string][]=[
   [{outcome:'completed'},'Worked for','PT1M12S'],
   [{outcome:'stopped'},'Stopped after','PT1M12S'],
   [{outcome:'interrupted'},'Interrupted after','PT1M12S'],
   [{outcome:'failed'},'Interrupted after','PT1M12S'],
  ];
  for(const [over,text,iso] of cases){
   const html=renderToStaticMarkup(createElement(TurnDuration,{timing:timing(over),timeFormat:'24h',arrival:false}));
   expect(html).toContain(`<p class="turn-duration"`);
   expect(html).toContain(text);
   expect(html).toContain(`<time dateTime="${iso}">1m 12s</time>`);
   expect(html).not.toContain('NaN');
  }
 });
 it('marks arrival only when asked and never as raw "0"',()=>{
  const on=renderToStaticMarkup(createElement(TurnDuration,{timing:timing(),timeFormat:'24h',arrival:true}));
  expect(on).toContain('data-arrival="true"');
  const off=renderToStaticMarkup(createElement(TurnDuration,{timing:timing(),timeFormat:'24h',arrival:false}));
  expect(off).not.toContain('data-arrival');
 });
 it('builds a started/ended title honoring the 12h and 24h preference',()=>{
  const h24=renderToStaticMarkup(createElement(TurnDuration,{timing:timing(),timeFormat:'24h',arrival:false}));
  expect(h24).toMatch(/title="Started 10:00 · ended 10:01/);
  const h12=renderToStaticMarkup(createElement(TurnDuration,{timing:timing(),timeFormat:'12h',arrival:false}));
  expect(h12).toMatch(/title="Started 10:00[^"]*(AM|PM) · ended/);
 });
 it('uses date+time in the title when start and end cross midnight',()=>{
  const cross=timing({startedAt:'2026-11-21T23:59:30.000',endedAt:'2026-11-22T00:00:42.000'});
  const html=renderToStaticMarkup(createElement(TurnDuration,{timing:cross,timeFormat:'24h',arrival:false}));
  expect(html).toContain('title="Started ');
  expect(html).toMatch(/title="Started [A-Z][a-z]{2} \d+, \d{4}/);
  expect(html).toMatch(/· ended [A-Z][a-z]{2} \d+, \d{4}/);
 });
 it('renders <1s for malformed or reversed records, never NaN',()=>{
  for(const over of [{endedAt:undefined},{endedAt:'not-a-date'},{startedAt:'2026-11-21T10:02:00.000'}] as Partial<TurnTimingV1>[]){
   const html=renderToStaticMarkup(createElement(TurnDuration,{timing:timing(over),timeFormat:'24h',arrival:false}));
   expect(html).toContain('&lt;1s');
   expect(html).not.toContain('NaN');
  }
 });
});

describe('armTurnElapsed',()=>{
 afterEach(()=>{vi.useRealTimers();});
 const fakeDoc=()=>{
  const listeners=new Map<string,Set<()=>void>>();
  return{visibilityState:'visible'as string,
   addEventListener(type:string,fn:()=>void){(listeners.get(type)??listeners.set(type,new Set()).get(type)!).add(fn);},
   removeEventListener(type:string,fn:()=>void){listeners.get(type)?.delete(fn);},
   fire(type:string){listeners.get(type)?.forEach(fn=>fn());}} as unknown as Document&{visibilityState:string;fire:(t:string)=>void};
 };
 it('ticks once per second with elapsed ms clamped at zero',()=>{
  vi.useFakeTimers();vi.setSystemTime(60_000);
  const ticks:number[]=[];const doc=fakeDoc();
  const disarm=armTurnElapsed(59_000,ms=>ticks.push(ms),doc);
  expect(ticks).toEqual([1000]);
  vi.advanceTimersByTime(3000);
  expect(ticks).toEqual([1000,2000,3000,4000]);
  disarm();
 });
 it('pauses while the document is hidden and recomputes on return',()=>{
  vi.useFakeTimers();vi.setSystemTime(60_000);
  const ticks:number[]=[];const doc=fakeDoc();
  const disarm=armTurnElapsed(59_000,ms=>ticks.push(ms),doc);
  vi.advanceTimersByTime(1000);
  doc.visibilityState='hidden';doc.fire('visibilitychange');
  vi.setSystemTime(70_000);vi.advanceTimersByTime(5000);
  expect(ticks.at(-1)).toBe(2000);
  doc.visibilityState='visible';doc.fire('visibilitychange');
  expect(ticks.at(-1)).toBe(16_000);
  vi.advanceTimersByTime(1000);
  expect(ticks.at(-1)).toBe(17_000);
  disarm();
 });
 it('stops ticking after disarm (unmount)',()=>{
  vi.useFakeTimers();vi.setSystemTime(60_000);
  const ticks:number[]=[];const doc=fakeDoc();
  const disarm=armTurnElapsed(59_000,ms=>ticks.push(ms),doc);
  disarm();vi.advanceTimersByTime(5000);
  expect(ticks).toEqual([1000]);
 });
});
