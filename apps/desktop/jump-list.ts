import type * as Electron from 'electron';
import type {JumpListProjectStatus} from '../../packages/desktop-contract/index.ts';

export const JUMP_LIST_PROJECT_LIMIT=5;
const TITLE_LIMIT=60;

/** VD-04: trimmed, control characters stripped, 60 code points plus ellipsis. */
export function jumpListTitle(name:string):string{
 const clean=[...name.trim().replace(/\p{Cc}+/gu,'')];
 return clean.length>TITLE_LIMIT?clean.slice(0,TITLE_LIMIT).join('')+'…':clean.join('');
}

interface JumpListInput {execPath:string;projects:readonly JumpListProjectStatus[];includeProjects:boolean;removedArgs?:readonly (string|undefined)[]}
/** R06: Tasks category plus an optional custom Recent projects category. Args
 * carry only --gen-jump/--gen-project-id; never paths. */
export function buildJumpList(input:JumpListInput):Electron.JumpListCategory[]{
 const removed=new Set((input.removedArgs??[]).filter((args):args is string=>typeof args==='string'));
 const task=(partial:Pick<Electron.JumpListItem,'title'|'description'|'args'>):Electron.JumpListItem=>
  partial.args!==undefined&&removed.has(partial.args)?{type:'separator'}:{type:'task',program:input.execPath,iconPath:input.execPath,iconIndex:0,...partial};
 const categories:Electron.JumpListCategory[]=[{type:'custom',name:'Tasks',items:[task({title:'New thread',description:'Start a new thread in Gen V1',args:'--gen-jump=new-thread'})]}];
 if(!input.includeProjects)return categories;
 const items=input.projects.slice(0,JUMP_LIST_PROJECT_LIMIT)
  .map(project=>({project,args:`--gen-jump=open-project --gen-project-id=${project.id}`}))
  .filter(({args})=>!removed.has(args))
  .map(({project,args})=>task({title:jumpListTitle(project.name),description:`Open ${jumpListTitle(project.name)} in Gen V1`,args}));
 return [...categories,{type:'custom',name:'Recent projects',items}];
}
/** Ordered signature so refreshes can skip identical jump lists (R06). */
export function jumpListKey(categories:readonly Electron.JumpListCategory[]):string{
 return categories.map(category=>`${category.type}|${category.name??''}|${(category.items??[]).map(item=>`${item.type}|${item.title??''}|${item.args??''}|${item.description??''}`).join(';')}`).join('\n');
}
interface JumpListTarget {setJumpList(categories:Electron.JumpListCategory[]):'ok'|string;getJumpListSettings():{removedItems:Electron.JumpListItem[]}}
/** One retry without Recent projects on a non-'ok' result, then silent until
 * the next change (R06). Returns whether the project category was suppressed. */
export function applyJumpList(target:JumpListTarget,input:Omit<JumpListInput,'removedArgs'>):{key:string;suppressed:boolean}{
 let removed:string[]=[];
 try{removed=(target.getJumpListSettings().removedItems??[]).map(item=>item.args??'');}catch{removed=[];}
 const categories=buildJumpList({...input,removedArgs:removed});
 try{
  if(target.setJumpList(categories)==='ok')return {key:jumpListKey(categories),suppressed:false};
 }catch{return {key:'',suppressed:true};}
 if(input.includeProjects){
  const fallback=buildJumpList({...input,includeProjects:false,removedArgs:removed});
  try{if(target.setJumpList(fallback)==='ok')return {key:jumpListKey(fallback),suppressed:true};}catch{}
 }
 return {key:'',suppressed:true};
}
