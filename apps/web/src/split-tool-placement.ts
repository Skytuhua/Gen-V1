import type {SurfaceRef} from '../../../packages/contracts/workspace.ts';
import type {SplitWorkspaceLayout} from '../../../packages/contracts/split-workspace.ts';
import {minimumSplitSize,minimumViewSize} from '../../../packages/core/split-workspace-layout.ts';

/** Placement takes the caller's frozen owner; focus never supplies another one. */
export function toolPlacementCommand(layout:SplitWorkspaceLayout,view:SurfaceRef,paneId:string,beside:boolean,viewport:{width:number;height:number}):{type:string;payload:Record<string,unknown>}{
 const basis={workspaceId:layout.id,baseRevision:layout.revision},existing=Object.values(layout.panes).find(pane=>pane.viewIds.includes(view.id));
 if(existing)return{type:'view.open',payload:{...basis,paneId:existing.id,view}};
 const empty=beside?Object.values(layout.panes).find(pane=>pane.viewIds.length===0):undefined;
 if(empty)return{type:'view.open',payload:{...basis,paneId:empty.id,view}};
 if(beside&&Object.keys(layout.panes).length<16){
  const retained=minimumSplitSize(layout),incoming=minimumViewSize(view),horizontal=viewport.width>=retained.width+incoming.width+6,vertical=viewport.height>=retained.height+incoming.height+6;
  if(horizontal||vertical){const span=(horizontal?viewport.width:viewport.height)-6,minimum=horizontal?retained.width:retained.height,added=horizontal?incoming.width:incoming.height,ratio=Math.max(.05,minimum/span,Math.min(.72,1-added/span,.95));return{type:'pane.split',payload:{...basis,paneId,newPaneId:crypto.randomUUID(),splitId:crypto.randomUUID(),axis:horizontal?'horizontal':'vertical',outer:true,ratio,view}};}
 }
 return{type:'view.open',payload:{...basis,paneId,view,placement:beside?'tab':'replace'}};
}
