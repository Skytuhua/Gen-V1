import type {ProjectContext} from '../../../../packages/contracts/workspace';
import {threadNavigationRevision} from '../../../../packages/contracts/shell-read-models';
import {authenticated,read} from '../api';
import {getShellNavigationItem} from '../shell-read-api';
import {factsFromProjectContext,type ThreadHoverScope,type ThreadHoverFacts} from './facts';
export interface ThreadHoverPRTarget {repo:string;number:number}
export interface ThreadHoverDestination {id:number;scope:ThreadHoverScope;target:ThreadHoverPRTarget}
export async function loadPersonalThreadHover(scope:ThreadHoverScope,signal:AbortSignal):Promise<ThreadHoverFacts<ThreadHoverPRTarget>>{
 if(scope.authority.kind!=='local'||!scope.projectId||!scope.workingCopyId)throw Error('Thread details are unavailable.');
 const base='/api/projects/'+encodeURIComponent(scope.projectId),query='threadId='+encodeURIComponent(scope.threadId);
 const get=<T,>(path:string)=>authenticated(()=>fetch(base+path,{credentials:'same-origin',cache:'no-store',redirect:'error',signal})).then(read<T>);
 const [context,links]=await Promise.allSettled([get<ProjectContext>('/context?'+query),get<{repo:string;items:{number:number;title:string;state?:string}[]}>('/pull-requests?linked=1&'+query)]);
 if(context.status!=='fulfilled')throw Error('Thread details are unavailable.');
 const facts=factsFromProjectContext(scope,'',context.value),current=await getShellNavigationItem(scope.threadId,signal);
 if(!facts||current.projectId!==scope.projectId||current.workspaceId!==scope.workingCopyId||(current.threadRevision??threadNavigationRevision(current))!==scope.revision)throw Error('Thread metadata changed.');
 const saved=links.status==='fulfilled'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(links.value.repo)?links.value:undefined;
 return {...facts,pullRequests:saved?.items.filter(item=>Number.isSafeInteger(item.number)&&item.number>0).map(item=>({id:saved.repo+'#'+item.number,label:'#'+item.number+' '+item.title,state:item.state,target:{repo:saved.repo,number:item.number}}))};
}
