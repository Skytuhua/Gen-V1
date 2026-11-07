import {describe,expect,it} from 'vitest';
import {splitWorkspaceLayoutSchema,type SplitWorkspaceLayout} from '../packages/contracts/split-workspace.ts';
import {applySplitWorkspaceCommand,createSplitWorkspaceLayout,minimumSplitSize,splitDropEdge} from '../packages/core/split-workspace-layout.ts';
import type {SurfaceRef} from '../packages/contracts/workspace.ts';

const view=(id:string,threadId=id):SurfaceRef=>({id,kind:'thread',binding:{authority:{kind:'local'},threadId}});
const apply=(layout:SplitWorkspaceLayout,type:string,payload:Record<string,unknown>)=>applySplitWorkspaceCommand(layout,type,payload);
const open=(layout:SplitWorkspaceLayout,id:string)=>apply(layout,'view.open',{paneId:layout.focusedPaneId,view:view(id)});
const split=(layout:SplitWorkspaceLayout,id:string,extra:Record<string,unknown>={})=>apply(layout,'pane.split',{paneId:layout.focusedPaneId,newPaneId:id,splitId:'split-'+id,axis:'horizontal',...extra});

describe('durable split workspace',()=>{
 it('begins with one empty area and never stores task content',()=>{
  const layout=createSplitWorkspaceLayout('personal');
  expect(layout.version).toBe(2);expect(Object.keys(layout.panes)).toHaveLength(1);expect(layout.views).toEqual({});
  expect(splitWorkspaceLayoutSchema.parse(layout)).toEqual(layout);
  expect(()=>splitWorkspaceLayoutSchema.parse({...layout,draft:'secret'})).toThrow();
 });
 it('splits and moves a stable view without duplicating its identity',()=>{
  let layout=open(createSplitWorkspaceLayout(),'one');const first=layout.focusedPaneId;
  layout=split(layout,'right');layout=apply(layout,'view.move',{viewId:'one',paneId:'right'});
  expect(layout.panes[first]!.viewIds).toEqual([]);expect(layout.panes.right!.viewIds).toEqual(['one']);expect(Object.keys(layout.views)).toEqual(['one']);
  expect(layout.views.one!.binding.threadId).toBe('one');
 });
 it('activates the existing view when an already-open thread is dropped',()=>{
  let layout=open(createSplitWorkspaceLayout(),'one');layout=split(layout,'right');
  layout=apply(layout,'view.open',{paneId:'right',view:view('another-id','one')});
  expect(Object.keys(layout.views)).toEqual(['one']);expect(layout.panes.right!.activeViewId).toBe('one');
 });
 it('does not duplicate a conversation because of a presentation-only live-project flag',()=>{
  let layout=open(createSplitWorkspaceLayout(),'one');layout=split(layout,'right');
  layout=apply(layout,'view.open',{paneId:'right',view:{...view('another-id','one'),binding:{...view('one').binding,liveProject:false}}});
  expect(Object.keys(layout.views)).toEqual(['one']);
 });
 it('parks displaced tabs and protects context and usage when joining',()=>{
  let layout=open(createSplitWorkspaceLayout(),'one');const first=layout.focusedPaneId;
  layout=split(layout,'right',{view:{id:'usage',kind:'usage',binding:{authority:{kind:'local'},threadId:'one'}}});
  layout=apply(layout,'pane.join',{paneId:'right',targetPaneId:first});
  expect(layout.parkedViewIds).toContain('usage');expect(layout.views.usage!.kind).toBe('usage');expect(Object.keys(layout.panes)).toHaveLength(1);
  expect(layout.panes[first]!.activeViewId).toBe('one');
 });
 it('keeps replaced views recoverable and restores parked identity',()=>{
  let layout=open(createSplitWorkspaceLayout(),'one');const pane=layout.focusedPaneId;
  layout=apply(layout,'view.open',{paneId:pane,view:view('two'),placement:'replace'});
  expect(layout.parkedViewIds).toEqual(['one']);
  layout=apply(layout,'view.move',{viewId:'one',paneId:pane});
  expect(layout.parkedViewIds).toEqual([]);expect(layout.panes[pane]!.activeViewId).toBe('one');
 });
 it('rejects duplicate references, cycles, dangling tabs, secret fields and excessive nesting',()=>{
  const layout=open(createSplitWorkspaceLayout(),'one');
  const duplicate=structuredClone(layout);duplicate.parkedViewIds.push('one');expect(()=>splitWorkspaceLayoutSchema.parse(duplicate)).toThrow();
  expect(()=>splitWorkspaceLayoutSchema.parse({...layout,root:{kind:'pane',paneId:'missing'}})).toThrow();
  const cycle:{kind:string;id:string;axis:string;ratio:number;first:unknown;second:unknown}={kind:'split',id:'cycle',axis:'horizontal',ratio:.5,first:null,second:layout.root};cycle.first=cycle;
  expect(()=>splitWorkspaceLayoutSchema.parse({...layout,root:cycle})).toThrow();
  expect(()=>splitWorkspaceLayoutSchema.parse({...layout,views:{one:{...view('one'),password:'hidden'}}})).toThrow();
  let nested=createSplitWorkspaceLayout();
  for(let index=0;index<7;index++)nested=split(nested,'nested-'+index);
  expect(()=>split(nested,'too-deep')).toThrow(/depth|nest|eight/i);
 });
 it('rejects stale revisions and unknown target ids without mutating the original',()=>{
  const layout=open(createSplitWorkspaceLayout(),'one'),before=structuredClone(layout);
  expect(()=>apply(layout,'pane.collapse',{paneId:'missing',collapsed:true})).toThrow();
  expect(()=>apply(layout,'view.open',{paneId:layout.focusedPaneId,view:view('two'),baseRevision:0})).toThrow(/revision|changed/i);
  expect(layout).toEqual(before);
 });
 it('retains independent thread ownership and treats plugin bindings as references only',()=>{
  let layout=open(createSplitWorkspaceLayout(),'one');layout=split(layout,'right',{view:view('two')});
  const original=layout.views.one;
  layout=apply(layout,'pane.focus',{paneId:'right'});
  expect(layout.views.one).toEqual(original);expect(layout.views.two!.binding.threadId).toBe('two');
  layout=apply(layout,'view.open',{paneId:'right',view:{id:'private-view',kind:'workspace',binding:{authority:{kind:'plugin',pluginId:'sample-plugin',scopeId:'company-one'},resourceId:'map'}}});
  expect(layout.views['private-view']!.binding.authority.kind).toBe('plugin');
 });
 it('computes usable minimum sizes and bounded edge previews',()=>{
  let layout=open(createSplitWorkspaceLayout(),'one');expect(minimumSplitSize(layout)).toEqual({width:320,height:220});
  layout=split(layout,'right',{view:{id:'diff',kind:'diff',binding:{authority:{kind:'local'}}}});
  expect(minimumSplitSize(layout).width).toBeGreaterThanOrEqual(680);
  expect(splitDropEdge({x:1,y:100,width:500,height:400})).toBe('left');
  expect(splitDropEdge({x:250,y:399,width:500,height:400})).toBe('bottom');
  expect(splitDropEdge({x:250,y:200,width:500,height:400})).toBe('center');
 });
 it('wraps the entire current tree for outer-edge placement and keeps view bindings',()=>{
  let layout=open(createSplitWorkspaceLayout(),'one');layout=split(layout,'bottom',{axis:'vertical',view:view('two')});
  layout=apply(layout,'pane.split',{paneId:'bottom',newPaneId:'outer-left',splitId:'outer-columns',axis:'horizontal',before:true,outer:true,view:view('three')});
  expect(layout.root.kind).toBe('split');if(layout.root.kind!=='split')throw Error('Missing split');
  expect(layout.root.id).toBe('outer-columns');expect(layout.root.first).toEqual({kind:'pane',paneId:'outer-left'});expect(layout.root.second.kind).toBe('split');
  expect(Object.values(layout.views).map(item=>item.binding.threadId).sort()).toEqual(['one','three','two']);
 });
 it('rejects a seventeenth pane without changing the layout',()=>{
  let layout=createSplitWorkspaceLayout(),counter=0;
  for(let round=0;round<4;round++)for(const paneId of Object.keys(layout.panes)){counter++;layout=apply(layout,'pane.split',{paneId,newPaneId:'pane-'+counter,splitId:'split-'+counter,axis:'horizontal'});}
  expect(Object.keys(layout.panes)).toHaveLength(16);const previous=structuredClone(layout);
  expect(()=>apply(layout,'pane.split',{paneId:layout.focusedPaneId,newPaneId:'overflow',splitId:'overflow-split',axis:'vertical'})).toThrow();expect(layout).toEqual(previous);
 });
 it('rejects rebinding an existing view ID and duplicate empty-pane joins',()=>{
  const layout=open(createSplitWorkspaceLayout(),'one');
  expect(()=>apply(layout,'view.open',{view:view('one','other-thread')})).toThrow(/rebound|owner/i);
  expect(()=>apply(layout,'pane.join',{paneId:layout.focusedPaneId})).toThrow(/one pane/i);
 });
 it('preserves focused conversation for explicitly requested automatic detail opening',()=>{
  let layout=open(createSplitWorkspaceLayout(),'one');const focused=layout.focusedPaneId;
  layout=apply(layout,'pane.split',{paneId:focused,newPaneId:'plan-pane',splitId:'plan-column',axis:'horizontal',view:{id:'plan',kind:'plan',binding:{authority:{kind:'local'},threadId:'one'}},preserveFocus:true});
  expect(layout.focusedPaneId).toBe(focused);expect(layout.panes['plan-pane']!.activeViewId).toBe('plan');
  layout=apply(layout,'view.activate',{paneId:'plan-pane',viewId:'plan',preserveFocus:true});expect(layout.focusedPaneId).toBe(focused);
  layout=apply(layout,'view.open',{paneId:'plan-pane',view:{id:'notes',kind:'notes',binding:{authority:{kind:'local'},threadId:'one'}},preserveFocus:true});expect(layout.focusedPaneId).toBe(focused);
  expect(()=>apply(layout,'view.activate',{paneId:'plan-pane',viewId:'plan',preserveFocus:'yes'})).toThrow();
 });
});
