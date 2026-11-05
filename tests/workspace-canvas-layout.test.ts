import {describe,expect,it} from 'vitest';
import {canvasPoint,canvasZoom,canvasZoomAt,fitCanvasViewport,findCanvasPanelBounds,arrangeCanvasPanels,groupCanvasPanels,snapPanelBounds,liveProjectRows,liveThreadPanels,panelInViewport} from '../apps/web/src/workspace-canvas-layout.ts';
import type {Thread} from '../packages/contracts/index.ts';
import type {CanvasLayout} from '../packages/contracts/workspace.ts';
const thread=(id:string,extra:Record<string,unknown>={}):Thread=>({id,title:id,projectName:'Same name',projectId:'project-a',status:'ready',runId:null,modelId:null,sessionPath:null,epoch:0,createdAt:'2026-11-02T00:00:00Z',updatedAt:'2026-11-02T00:00:00Z',...extra} as Thread);
const canvas:CanvasLayout={version:1,id:'agents',name:'All Agents',preset:'all-agents',viewport:{x:0,y:0,zoom:1},panels:[],filter:'active',projectIds:[]};
describe('workspace canvas geometry and live ordering',()=>{
 it('keeps newly added panels reachable when the visible area is already full',()=>{
  const panels:ReturnType<typeof liveThreadPanels>=[],base=liveThreadPanels([thread('p',{runId:'r'})],canvas)[0],viewport={x:0,y:0,zoom:1},size={width:1200,height:600};
  for(let index=0;index<8;index++){const bounds=findCanvasPanelBounds(panels,viewport,size,{width:480,height:552});expect(panelInViewport(bounds,viewport,size,0)).toBe(true);expect(bounds.y).toBeLessThan(size.height-40);panels.push({...base,id:'panel-'+index,bounds});}
 });
 it('converts screen deltas through zoom and snaps position/size to an 8px grid',()=>{expect(canvasPoint({x:300,y:220},{x:100,y:100,zoom:.5})).toEqual({x:400,y:240});expect(snapPanelBounds({x:103,y:-19,width:501,height:603})).toEqual({x:104,y:-16,width:504,height:600});expect(snapPanelBounds({x:Infinity,y:NaN,width:-1,height:Infinity})).toEqual({x:0,y:0,width:120,height:80});});
 it('clamps keyboard zoom and restores exactly 100 percent',()=>{expect(canvasZoom(.4,-1)).toBe(.4);expect(canvasZoom(2,1)).toBe(2);expect(canvasZoom(.7,1)).toBe(.8);expect(canvasZoom(.7,0)).toBe(1);});
 it('groups by stable project identity and places side/delegate children beside their parent',()=>{const threads=[thread('child',{kind:'delegate',parentThreadId:'parent'}),thread('other',{projectId:'project-b',runId:'run-b'}),thread('side',{sideParentId:'parent'}),thread('parent',{runId:'run-a'}),thread('old')];const rows=liveProjectRows(threads,canvas);expect(rows.map(row=>row.projectId)).toEqual(['project-a','project-b']);expect(rows[0].threads.map(value=>value.id)).toEqual(['parent','child','side']);expect(liveProjectRows(threads,{...canvas,filter:'all'})[0].threads.map(value=>value.id)).toContain('old');});
 it('honors hidden live instance overrides without duplicating a transcript',()=>{const threads=[thread('parent',{runId:'run'})],generated=liveThreadPanels(threads,canvas);expect(generated).toHaveLength(1);const override={...generated[0],id:'fixed-parent',visible:false,bounds:{x:800,y:40,width:400,height:500}};const result=liveThreadPanels(threads,{...canvas,panels:[override]});expect(result).toHaveLength(1);expect(result[0]).toEqual(override);});
 it('applies family eligibility to persisted live overrides and restores their saved history layout',()=>{
  const threads=[thread('parent',{runId:'run'}),thread('side',{sideParentId:'parent'})],generated=liveThreadPanels(threads,canvas);
  const overrides=generated.map(panel=>({...panel,visible:false,bounds:{...panel.bounds,x:800},placement:'native' as const}));
  const settled=threads.map(value=>({...value,runId:null}));
  expect(liveThreadPanels(settled,{...canvas,panels:overrides})).toEqual([]);
  expect(liveThreadPanels(settled,{...canvas,filter:'all',panels:overrides})).toEqual(overrides);
  expect(liveThreadPanels([{...settled[0],presentation:{pinned:true}},settled[1]],{...canvas,panels:overrides})).toEqual(overrides);
  expect(liveThreadPanels(threads,{...canvas,projectIds:['project-b'],panels:overrides})).toEqual([]);
  const manual={...overrides[0],id:'explicit-thread-panel'};
  expect(liveThreadPanels(settled,{...canvas,panels:[manual]})).toEqual([manual]);
 });
 it('does not mount bodies outside the transformed viewport',()=>{expect(panelInViewport({x:4000,y:0,width:400,height:500},{x:0,y:0,zoom:1},{width:1200,height:800})).toBe(false);expect(panelInViewport({x:1000,y:0,width:400,height:500},{x:-800,y:0,zoom:.5},{width:1200,height:800})).toBe(true);});
 it('keeps the pointed world position fixed while zooming and clamps wheel extremes',()=>{
  const start={x:-80,y:40,zoom:.8},point={x:370,y:230};
  const before=canvasPoint(point,start),after=canvasPoint(point,canvasZoomAt(start,1.4,point));expect(after.x).toBeCloseTo(before.x);expect(after.y).toBeCloseTo(before.y);
  expect(canvasZoomAt(start,20,point).zoom).toBe(2);expect(canvasZoomAt(start,.01,point).zoom).toBe(.4);
 });
 it('fits distant panels inside the viewport without changing their bounds',()=>{
  const panels=liveThreadPanels([thread('parent',{runId:'r'})],canvas);panels[0].bounds={x:2400,y:-600,width:520,height:620};
  const before=structuredClone(panels),viewport=fitCanvasViewport(panels,{width:1100,height:800});
  expect(panelInViewport(panels[0].bounds,viewport,{width:1100,height:800},0)).toBe(true);
  expect(panels).toEqual(before);expect(viewport.zoom).toBeGreaterThanOrEqual(.4);expect(viewport.zoom).toBeLessThanOrEqual(1);
 });
 it('finds visible free space relative to a panned and zoomed viewport',()=>{
  const panels=liveThreadPanels([thread('parent',{runId:'r'})],canvas);panels[0].bounds={x:1016,y:32,width:400,height:400};
  const viewport={x:-800,y:0,zoom:.8},bounds=findCanvasPanelBounds(panels,viewport,{width:1400,height:900},{width:400,height:400});
  const occupied=panels[0].bounds;expect(bounds.x>=occupied.x+occupied.width+16||bounds.x+bounds.width+16<=occupied.x||bounds.y>=occupied.y+occupied.height+16||bounds.y+bounds.height+16<=occupied.y).toBe(true);
  expect(panelInViewport(bounds,viewport,{width:1400,height:900},0)).toBe(true);
 });
 it('keeps cyclic and orphaned conversations visible once without joining different projects',()=>{
  const threads=[thread('a',{parentThreadId:'b',runId:'r'}),thread('b',{parentThreadId:'a'}),thread('orphan',{parentThreadId:'missing',runId:'r'}),thread('other',{parentThreadId:'a',projectId:'project-b',runId:'r'})];
  const rows=liveProjectRows(threads,canvas);expect(rows.flatMap(row=>row.threads.map(value=>value.id)).sort()).toEqual(['a','b','orphan','other']);
  expect(rows.find(row=>row.projectId==='project-b')?.threads.map(value=>value.id)).toEqual(['other']);
 });
 it('creates project and parent containers from stable bindings while preserving saved positions',()=>{
  const threads=[thread('parent',{runId:'r'}),thread('child',{parentThreadId:'parent',kind:'delegate'}),thread('another',{runId:'r'})];
  const panels=liveThreadPanels(threads,canvas);panels[0].bounds.x=900;
  const before=structuredClone(panels),groups=groupCanvasPanels(panels,threads);
  expect(groups).toHaveLength(1);expect(groups[0].families).toHaveLength(2);
  const family=groups[0].families.find(value=>value.rootThreadId==='parent');expect(family?.panelIds).toEqual([panels[0].id,panels[1].id]);
  expect(family!.bounds.x).toBeLessThanOrEqual(Math.min(panels[0].bounds.x,panels[1].bounds.x));expect(panels).toEqual(before);
  const plugin={...panels[0],id:'plugin-panel',binding:{...panels[0].binding,authority:{kind:'plugin' as const,pluginId:'x',scopeId:'s'}}};
  expect(groupCanvasPanels([...panels,plugin],threads)).toHaveLength(2);
 });
 it('arranges code review with a larger diff and preserves native and hidden panels',()=>{
  const base=liveThreadPanels([thread('p',{runId:'r'})],canvas)[0];
  const panels=['files','diff','terminal','linked-pull-requests'].map((kind,index)=>({...base,id:kind,kind:kind as typeof base.kind,order:index}));
  panels.push({...base,id:'native',placement:'native'},{...base,id:'hidden',visible:false});
  const arranged=arrangeCanvasPanels(panels,'code-review',{width:1400,height:900});
  expect(arranged.get('diff')!.width).toBeGreaterThan(arranged.get('files')!.width);
  expect(arranged.get('diff')!.y).toBe(arranged.get('files')!.y);
  expect(arranged.get('terminal')!.y).toBeGreaterThan(arranged.get('diff')!.y);
  expect(arranged.has('native')).toBe(false);expect(arranged.has('hidden')).toBe(false);
 });
 it('places newly discovered child chats beside the saved parent without moving the parent',()=>{
  const threads=[thread('parent',{runId:'r'}),thread('child',{parentThreadId:'parent',kind:'delegate'})],saved=liveThreadPanels(threads.slice(0,1),canvas)[0];saved.bounds={x:800,y:40,width:520,height:560};
  const result=liveThreadPanels(threads,{...canvas,panels:[saved]}),child=result.find(panel=>panel.binding.threadId==='child')!;
  expect(result.find(panel=>panel.id===saved.id)).toEqual(saved);expect(child.bounds.x).toBeGreaterThanOrEqual(saved.bounds.x+saved.bounds.width+16);expect(child.bounds.y).toBe(saved.bounds.y);
 });
});
