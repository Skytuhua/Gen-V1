import {describe,expect,it} from 'vitest';
import {createSplitWorkspaceLayout,applySplitWorkspaceCommand} from '../packages/core/split-workspace-layout.ts';
import {threadPlacementCommand,threadReconciliationCommand} from '../apps/web/src/split-thread-placement.ts';
import type {Thread} from '../packages/contracts/index.ts';
const thread={id:'thread-a',projectId:'project-a',title:'First',projectName:'One'} as Thread;
describe('existing conversation placement',()=>{
 it('uses the canonical thread owner rather than dragged authority or sidebar labels',()=>{
  const layout=createSplitWorkspaceLayout();const command=threadPlacementCommand(layout,[thread],thread.id,'pane-main','right',false,{paneId:'right',splitId:'split'});
  expect(command.type).toBe('pane.split');expect(command.payload.view).toEqual({id:'thread:thread-a',kind:'thread',binding:{authority:{kind:'local'},threadId:'thread-a',projectId:'project-a'}});
  expect(()=>threadPlacementCommand(layout,[],thread.id,'pane-main','center')).toThrow('unavailable');
 });
 it('moves the same persistent view when a thread is already open',()=>{
  const layout=createSplitWorkspaceLayout();const command=threadPlacementCommand(layout,[thread],thread.id,'pane-main','center');const next=applySplitWorkspaceCommand(layout,command.type,command.payload);
  const move=threadPlacementCommand(next,[thread],thread.id,'pane-main','bottom',true,{paneId:'below',splitId:'split'});const result=applySplitWorkspaceCommand(next,move.type,move.payload);
  expect(Object.keys(result.views)).toEqual(['thread:thread-a']);expect(result.panes.below?.activeViewId).toBe('thread:thread-a');expect(result.panes['pane-main']?.viewIds).toEqual([]);
 });
 it('captures the old exact owner for host reconciliation after a canonical project change',()=>{
  const initial=createSplitWorkspaceLayout(),command=threadPlacementCommand(initial,[thread],thread.id,'pane-main','center'),layout=applySplitWorkspaceCommand(initial,command.type,command.payload),changed={...thread,projectId:'project-b'};
  const reconciliation=threadReconciliationCommand(layout,[changed],thread.id);expect(reconciliation).toEqual({type:'thread.reconcile',payload:{workspaceId:layout.id,baseRevision:layout.revision,viewId:'thread:thread-a',expectedBinding:layout.views['thread:thread-a']!.binding,projectId:'project-b'}});
  expect(()=>threadPlacementCommand(layout,[changed],thread.id,'pane-main','center')).toThrow(/reconcil|project changed/i);
  expect(threadReconciliationCommand(layout,[thread],thread.id)).toBeNull();
 });
});
