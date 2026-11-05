import {HarnessError,type Thread} from '../../../packages/contracts/index.ts';
import type {SplitWorkspaceLayout,SplitDropEdge} from '../../../packages/contracts/split-workspace.ts';
/** Explicit post-connect repair request; the host alone derives the canonical replacement binding. */
export function threadReconciliationCommand(layout:SplitWorkspaceLayout,threads:Thread[],threadId:string):{type:'thread.reconcile';payload:Record<string,unknown>}|null{
 const thread=threads.find(value=>value.id===threadId);if(!thread)throw Error('The owning conversation is unavailable.');
 const existing=Object.values(layout.views).find(view=>view.kind==='thread'&&view.binding.authority.kind==='local'&&view.binding.threadId===thread.id&&(view.binding.projectId??null)!==(thread.projectId??null));
 return existing?{type:'thread.reconcile',payload:{workspaceId:layout.id,baseRevision:layout.revision,viewId:existing.id,expectedBinding:existing.binding,projectId:thread.projectId??null}}:null;
}
export function threadPlacementCommand(layout:SplitWorkspaceLayout,threads:Thread[],threadId:string,paneId:string,edge:SplitDropEdge,outer=false,ids?:{paneId:string;splitId:string}):{type:string;payload:Record<string,unknown>}{
 const thread=threads.find(value=>value.id===threadId);if(!thread)throw Error('The owning conversation is unavailable.');
 if(!Object.hasOwn(layout.panes,paneId))throw Error('The target area is unavailable.');
 const existing=Object.values(layout.views).find(view=>view.kind==='thread'&&view.binding.authority.kind==='local'&&view.binding.threadId===thread.id);
 if(existing&&(existing.binding.projectId??null)!==(thread.projectId??null))throw new HarnessError('WORKSPACE_CHANGED','The conversation project changed. Reconcile its existing view before placing it.');
 const view=existing??{id:'thread:'+thread.id,kind:'thread' as const,binding:{authority:{kind:'local' as const},threadId:thread.id,...(thread.projectId?{projectId:thread.projectId}:{})}};
 const basis={workspaceId:layout.id,baseRevision:layout.revision};
 if(edge==='center')return{type:'view.open',payload:{...basis,paneId,view}};
 return{type:'pane.split',payload:{...basis,paneId,newPaneId:ids?.paneId??crypto.randomUUID(),splitId:ids?.splitId??crypto.randomUUID(),axis:edge==='left'||edge==='right'?'horizontal':'vertical',before:edge==='left'||edge==='top',outer,view}};
}
