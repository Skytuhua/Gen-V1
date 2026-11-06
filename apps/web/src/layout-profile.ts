import type {SplitWorkspaceLayout,SplitWorkspaceNode} from '../../../packages/contracts/split-workspace';
export interface LayoutProfileSummary {id:string;name:string;updatedAt?:string}
export interface SplitProfileResult {id:string;layout:SplitWorkspaceLayout;updatedAt?:string}
interface ProfilePort {profiles:()=>readonly LayoutProfileSummary[];prepare:()=>Promise<void>;send:(type:string,payload:Record<string,unknown>)=>Promise<SplitWorkspaceLayout>;refresh:()=>Promise<readonly LayoutProfileSummary[]>}
/** Presentation comparison only: ownership stays in the host's immutable view bindings. */
export function splitLayoutArrangement(layout:SplitWorkspaceLayout):string{
 const tree=(node:SplitWorkspaceNode):unknown=>node.kind==='pane'?['pane',node.paneId]:['split',node.id,node.axis,node.ratio,tree(node.first),tree(node.second)];
 return JSON.stringify({root:tree(layout.root),panes:Object.keys(layout.panes).sort().map(id=>{const pane=layout.panes[id];return[id,pane.viewIds,pane.activeViewId,pane.collapsed];}),views:Object.keys(layout.views).sort().map(id=>[id,layout.views[id].kind]),parked:layout.parkedViewIds});
}
export function resolveSavedLayoutId(before:readonly LayoutProfileSummary[],after:readonly LayoutProfileSummary[],existingId?:string):string{
 if(existingId){if(after.some(profile=>profile.id===existingId))return existingId;throw Error('The saved layout is no longer available.');}
 const previous=new Set(before.map(profile=>profile.id)),created=after.filter(profile=>!previous.has(profile.id));
 if(created.length!==1)throw Error('Could not identify the saved layout. Retry loading layouts before saving again.');
 return created[0].id;
}
export function createSplitLayoutProfileActions(port:ProfilePort){
 let pending:{name:string;id?:string;before:readonly LayoutProfileSummary[];layout:SplitWorkspaceLayout}|undefined;
 return{
  async save(name:string,id?:string):Promise<SplitProfileResult>{
   if(pending&&(pending.name!==name||pending.id!==id))throw Error('Finish loading the previously saved layout before saving another.');
   if(!pending){await port.prepare();const before=[...port.profiles()],layout=await port.send('profile.save',{name,...(id?{profileId:id}:{})});pending={name,id,before,layout};}
   // A committed save followed by a failed metadata read must never create a duplicate on retry.
   const after=await port.refresh(),selected=resolveSavedLayoutId(pending.before,after,pending.id),result={id:selected,layout:pending.layout,updatedAt:after.find(profile=>profile.id===selected)?.updatedAt};pending=undefined;return result;
  },
  async apply(id:string){await port.prepare();return port.send('profile.apply',{profileId:id});},
  async rename(id:string,name:string){await port.send('profile.rename',{profileId:id,name});await port.refresh().catch(()=>{});},
  async remove(id:string){await port.send('profile.remove',{profileId:id});await port.refresh().catch(()=>{});},
 };
}
