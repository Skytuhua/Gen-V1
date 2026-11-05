import {z} from 'zod';
import {surfaceRefSchema,type SurfaceRef} from './workspace.ts';

export const SPLIT_WORKSPACE_LIMITS={panes:16,depth:8,views:256,tabs:100,history:20} as const;
export const splitWorkspaceIdSchema=z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9:_.-]*$/).refine(id=>!['constructor','prototype','__proto__'].includes(id));
export type SplitAxis='horizontal'|'vertical';
export type SplitDropEdge='left'|'right'|'top'|'bottom'|'center';
export type SplitWorkspaceNode={kind:'pane';paneId:string}|{kind:'split';id:string;axis:SplitAxis;ratio:number;first:SplitWorkspaceNode;second:SplitWorkspaceNode};
export interface SplitWorkspacePane {id:string;viewIds:string[];activeViewId?:string;collapsed:boolean}
export interface SplitWorkspaceLayout {version:2;id:string;revision:number;root:SplitWorkspaceNode;panes:Record<string,SplitWorkspacePane>;views:Record<string,SurfaceRef>;parkedViewIds:string[];focusedPaneId:string;undoDepth:number;redoDepth:number}

const paneSchema=z.strictObject({id:splitWorkspaceIdSchema,viewIds:z.array(splitWorkspaceIdSchema).max(SPLIT_WORKSPACE_LIMITS.tabs),activeViewId:splitWorkspaceIdSchema.optional(),collapsed:z.boolean()});
const nodeSchema:z.ZodType<SplitWorkspaceNode>=z.lazy(()=>z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('pane'),paneId:splitWorkspaceIdSchema}),
 z.strictObject({kind:z.literal('split'),id:splitWorkspaceIdSchema,axis:z.enum(['horizontal','vertical']),ratio:z.number().finite().min(.05).max(.95),first:nodeSchema,second:nodeSchema}),
]));
const recordSchema=z.strictObject({version:z.literal(2),id:splitWorkspaceIdSchema,revision:z.number().int().nonnegative(),root:nodeSchema,panes:z.record(splitWorkspaceIdSchema,paneSchema),views:z.record(splitWorkspaceIdSchema,surfaceRefSchema),parkedViewIds:z.array(splitWorkspaceIdSchema).max(SPLIT_WORKSPACE_LIMITS.views),focusedPaneId:splitWorkspaceIdSchema,undoDepth:z.number().int().min(0).max(SPLIT_WORKSPACE_LIMITS.history),redoDepth:z.number().int().min(0).max(SPLIT_WORKSPACE_LIMITS.history)});

/** Check bounds before recursive schema parsing, including hostile cyclic objects. */
function boundedTree(value:unknown,context:z.RefinementCtx){
 if(!value||typeof value!=='object')return;
 const root=(value as {root?:unknown}).root,seen=new WeakSet<object>();let count=0;
 const walk=(node:unknown,depth:number):boolean=>{
  if(!node||typeof node!=='object')return true;
  if(depth>SPLIT_WORKSPACE_LIMITS.depth||++count>2*SPLIT_WORKSPACE_LIMITS.panes-1||seen.has(node))return false;
  seen.add(node);const current=node as {kind?:unknown;first?:unknown;second?:unknown};
  return current.kind!=='split'||walk(current.first,depth+1)&&walk(current.second,depth+1);
 };
 if(!walk(root,1))context.addIssue({code:'custom',message:'Keep the split tree within eight levels and sixteen panes, without cycles.'});
}
export const splitWorkspaceLayoutSchema=z.unknown().superRefine(boundedTree).transform((value,context):SplitWorkspaceLayout=>{
 const parsed=recordSchema.safeParse(value);if(!parsed.success){for(const issue of parsed.error.issues)context.addIssue({code:'custom',path:issue.path,message:issue.message});return z.NEVER;}
 const layout=parsed.data,leaves=new Set<string>(),splits=new Set<string>(),assigned=new Set<string>();
 const issue=(message:string)=>context.addIssue({code:'custom',message});
 const walk=(node:SplitWorkspaceNode)=>{if(node.kind==='pane'){if(leaves.has(node.paneId)||!Object.hasOwn(layout.panes,node.paneId))issue('Each pane must occur once and resolve to its registry.');leaves.add(node.paneId);}else{if(splits.has(node.id))issue('Split IDs must be unique.');splits.add(node.id);walk(node.first);walk(node.second);}};walk(layout.root);
 if(Object.keys(layout.panes).length!==leaves.size||leaves.size>SPLIT_WORKSPACE_LIMITS.panes||!leaves.has(layout.focusedPaneId))issue('Pane references and focus must resolve exactly.');
 for(const[id,pane]of Object.entries(layout.panes)){
  if(id!==pane.id||!leaves.has(id)||pane.activeViewId!==undefined&&!pane.viewIds.includes(pane.activeViewId)||pane.viewIds.length>0&&!pane.activeViewId)issue('Pane tabs need a valid active view.');
  for(const viewId of pane.viewIds){if(assigned.has(viewId)||!Object.hasOwn(layout.views,viewId))issue('A view may belong to only one pane or parked entry.');assigned.add(viewId);}
 }
 for(const id of layout.parkedViewIds){if(assigned.has(id)||!Object.hasOwn(layout.views,id))issue('Parked views must be unique and resolve.');assigned.add(id);}
 for(const[id,view]of Object.entries(layout.views))if(id!==view.id||!assigned.has(id))issue('Every view needs one recoverable location and matching identity.');
 if(Object.keys(layout.views).length>SPLIT_WORKSPACE_LIMITS.views)issue('Too many workspace views.');
 return layout;
});
