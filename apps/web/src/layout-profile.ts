import type {SplitWorkspaceLayout,SplitWorkspaceNode} from '../../../packages/contracts/split-workspace';
export interface LayoutProfileSummary {id:string;name:string;updatedAt?:string}
export interface SplitProfileResult {id:string;layout:SplitWorkspaceLayout;updatedAt?:string}
interface ProfilePort {prepare:()=>Promise<void>;save:(name:string,id?:string)=>Promise<SplitProfileResult>;send:(type:string,payload:Record<string,unknown>)=>Promise<SplitWorkspaceLayout>;refresh:()=>Promise<readonly LayoutProfileSummary[]>}
/** Presentation comparison only: ownership stays in the host's immutable view bindings. */
export function splitLayoutArrangement(layout:SplitWorkspaceLayout):string{
 const tree=(node:SplitWorkspaceNode):unknown=>node.kind==='pane'?['pane',node.paneId]:['split',node.id,node.axis,node.ratio,tree(node.first),tree(node.second)];
 return JSON.stringify({root:tree(layout.root),panes:Object.keys(layout.panes).sort().map(id=>{const pane=layout.panes[id];return[id,pane.viewIds,pane.activeViewId,pane.collapsed];}),views:Object.keys(layout.views).sort().map(id=>[id,layout.views[id].kind]),parked:layout.parkedViewIds});
}
export function createSplitLayoutProfileActions(port:ProfilePort){
 let pending:{name:string;id?:string;result:SplitProfileResult}|undefined;
 const finish=async()=>{
  if(!pending)throw Error('There is no saved layout awaiting metadata.');
  const after=await port.refresh(),result=pending.result;pending=undefined;
  if(!after.some(profile=>profile.id===result.id))throw Error('The saved layout is no longer available.');
  return result;
 };
 return{
  async save(name:string,id?:string):Promise<SplitProfileResult>{
   if(pending&&(pending.name!==name||pending.id!==id))await finish();
   if(!pending){await port.prepare();const result=await port.save(name,id);if(id&&result.id!==id)throw Error('The saved layout identity changed.');pending={name,id,result:structuredClone(result)};}
   // A committed save followed by a failed metadata read must never create a duplicate on retry.
   return finish();
  },
  async apply(id:string){await port.prepare();return port.send('profile.apply',{profileId:id});},
  async rename(id:string,name:string){await port.send('profile.rename',{profileId:id,name});await port.refresh().catch(()=>{});},
  async remove(id:string){await port.send('profile.remove',{profileId:id});await port.refresh().catch(()=>{});},
 };
}
