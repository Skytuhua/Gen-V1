import {useEffect,useMemo,useRef,useState} from 'react';
import type {PanelBinding,WorkspaceCanvas} from '../../../packages/contracts/workspace';
import type {ThreadNavigationRow} from '../../../packages/contracts/shell-read-models';
import type {GitStatus} from '../../../packages/workspace/tools';
import {Select} from '../../../packages/ui-shell/Select';
import {ApiError,authenticated,csrfToken,read} from './api';
import {CodeReviewWorkspace,type ReviewActionContext,type ReviewActionResult,type ReviewOutcomeResult,type ReviewWrites} from './code-review-workspace/CodeReviewWorkspace';
import {sameOwner,type ReviewOwner,type ReviewTarget,type ReviewOperation} from './code-review-workspace/model';
import {ConversationPane} from './conversation-workspace/ConversationPane';
import {useScopedConversation} from './conversation-workspace/useScopedConversation';
import type {ConversationSelection} from './conversation-workspace/reader';
import {ScopedConversationComposer} from './ScopedConversationComposer';
import {useDesktop,useDetachedSurface,usePendingSurface,useDesktopReady} from './desktop-context';
import {PendingStatus} from './LoadingState';
import {TerminalBody} from './WorkspaceSurfaceBody';
import {getShellNavigationItem} from './shell-read-api';
import {useShellNavigation} from './shell-navigation';
import {journalFlush} from './journal';
import {prepareEditorHandoff} from './editor-handoff';
import type {ConversationHost,ConversationIntent} from './WorkspaceHost';
import './code-review-host.css';
import type {ThreadHoverDestination} from './thread-hover/host';

function reviewBinding(canvas:WorkspaceCanvas):{binding?:PanelBinding;error?:string}{
 const explicit=canvas.panels.find(panel=>panel.id==='review-owner-'+canvas.id&&panel.kind==='thread'),panels=explicit?[explicit]:canvas.panels.filter(panel=>panel.kind==='thread');
 if(panels.some(panel=>panel.binding.authority.kind!=='local'))return{error:'Choose a personal conversation for this workspace.'};
 const owners=panels.filter(panel=>panel.binding.threadId);
 if(new Set(owners.map(panel=>JSON.stringify([panel.binding.threadId,panel.binding.projectId??null]))).size>1)return{error:'Choose one conversation for this workspace.'};
 return{binding:owners[0]?.binding};
}
async function get<T>(owner:ReviewOwner,path:string,signal:AbortSignal):Promise<T>{
 const query=new URLSearchParams(owner.threadId?{threadId:owner.threadId}:{}),separator=path.includes('?')?'&':'?';
 return authenticated(()=>fetch('/api/projects/'+encodeURIComponent(owner.projectId)+path+separator+query,{credentials:'same-origin',cache:'no-store',redirect:'error',signal})).then(read<T>);
}
export function CodeReviewHost({canvas,workspace,composers,openConversation,destination,consumeDestination}:{destination?:ThreadHoverDestination;consumeDestination?:(id:number)=>void;canvas:WorkspaceCanvas;workspace:ConversationHost['workspace'];composers:ConversationHost['composers'];openConversation:(id:string,intent?:ConversationIntent)=>Promise<void>}){
 const {binding,error:bindingError}=reviewBinding(canvas),key=JSON.stringify([canvas.id,binding?.threadId,binding?.projectId,bindingError]);
 const [admission,setAdmission]=useState<{key:string;row:ThreadNavigationRow;selection:ConversationSelection}>(),[error,setError]=useState(''),[pending,setPending]=useState(false),[retry,setRetry]=useState(0),[changing,setChanging]=useState(false),[target,setTarget]=useState<ReviewTarget>({kind:'local',scope:'worktree'});
 const navigation=useShellNavigation('');
 useEffect(()=>setTarget({kind:'local',scope:'worktree'}),[key]);
 useEffect(()=>{
  const controller=new AbortController();setError('');setPending(Boolean(binding?.threadId));
  if(binding?.threadId)void getShellNavigationItem(binding.threadId,controller.signal).then(row=>{
   if(controller.signal.aborted)return;if(row.id!==binding.threadId)throw Error('The saved conversation is unavailable.');
   if(row.kind==='side'||row.kind==='delegate')throw Error('Choose a main conversation connected to a project.');
   if(binding.projectId!==undefined&&binding.projectId!==row.projectId)throw Error('The saved project no longer matches this conversation.');
   setAdmission({key,row,selection:{target:{authority:'personal',threadId:row.id,includeArchived:false},navigationKey:key+row.updatedAt}});
  }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'The conversation could not open.');}).finally(()=>{if(!controller.signal.aborted)setPending(false);});
  return()=>controller.abort();
 },[key,retry]);
 const admitted=admission?.key===key?admission:undefined,conversation=useScopedConversation(admitted?.selection??null),currentContext=conversation.state.context;
 const [refresh,setRefresh]=useState(0),[metadata,setMetadata]=useState<{ownerKey:string;scope:string;git?:GitStatus;pullRequests:{repo:string;number:number;title:string}[];pending:boolean;error?:string;pullRequestError?:string}>(),[review,setReview]=useState<{key:string;value:NonNullable<ReviewWrites['review']>}>();
 const [admittedDestination,setAdmittedDestination]=useState<number>();
 const destinationPending=Boolean(destination&&destination.id!==admittedDestination);
 const desktop=useDesktop(),surface=binding?.threadId?{kind:'thread' as const,threadId:binding.threadId}:null,detached=useDetachedSurface(surface),nativePending=usePendingSurface(surface),held=Boolean(detached||nativePending||desktop?.closing);
 const nativeEpoch=desktop?.ownership(surface),fence=useRef({signature:'',version:0,active:true}),signature=JSON.stringify([key,currentContext?.scopeKey,conversation.state.phase,target,held,nativeEpoch,destination?.id,destinationPending,refresh,metadata?.scope,metadata?.pending,metadata?.error,metadata?.pullRequestError]);
 if(fence.current.signature!==signature)fence.current={...fence.current,signature,version:fence.current.version+1};
 useEffect(()=>{fence.current.active=true;return()=>{fence.current.active=false;fence.current.version++;};},[]);
 const choosing=useRef(false),version=fence.current.version,isCurrent=useMemo(()=>()=>fence.current.active&&!held&&!destinationPending&&!choosing.current&&fence.current.version===version&&(!desktop||nativeEpoch!==undefined&&desktop.ownership(surface)===nativeEpoch),[signature,version]);
 const eligible=Boolean(!changing&&!pending&&!error&&!bindingError&&admitted&&currentContext&&conversation.state.phase==='ready'&&!currentContext.readOnly&&!currentContext.archived&&currentContext.owner.threadId===admitted.row.id&&currentContext.owner.projectId&&currentContext.owner.projectId===(binding?.projectId??admitted.row.projectId));
 const previous=useRef<{key:string;context:NonNullable<typeof currentContext>}|undefined>(undefined);
 if(eligible&&currentContext)previous.current={key,context:currentContext};
 const refreshingOwner=!changing&&!pending&&!error&&!bindingError&&admitted&&['loading','resync'].includes(conversation.state.phase);
 const context=eligible?currentContext:refreshingOwner&&previous.current?.key===key?previous.current.context:null;
 const owner:ReviewOwner|undefined=context?{authority:{kind:'local'},projectId:context.owner.projectId!,threadId:context.owner.threadId}:undefined;
 const scope=context?.scopeKey??'',selection=owner?{owner,target}:undefined;
 // Reader scopes rotate on reacquisition; presentation belongs to the validated logical owner.
 const presentationKey=owner?JSON.stringify([key,owner.authority,owner.projectId,owner.threadId]):'';
 const ownerMetadata=metadata?.ownerKey===presentationKey?metadata:undefined;
 const metadataReady=Boolean(ownerMetadata?.git&&ownerMetadata.scope===scope&&!ownerMetadata.pending&&!ownerMetadata.error);
 const pullRequestsReady=metadataReady&&!ownerMetadata?.pullRequestError;
 const reviewHeld=held||destinationPending||!eligible||!metadataReady;
 const reviewCurrent=useMemo(()=>()=>{const state=conversation.reader.getSnapshot();return metadataReady&&isCurrent()&&state.phase==='ready'&&state.context?.scopeKey===scope&&!state.context.readOnly&&!state.context.archived;},[isCurrent,scope,metadataReady]);
 // A sidebar destination can arrive after this mounted owner acquires its first copy.
 // Revalidate canonical identity before refreshing context; hover display facts are not admission.
 useEffect(()=>{
  if(!destination||!binding?.threadId||held)return;
  const controller=new AbortController(),epoch=nativeEpoch;
  const current=()=>!controller.signal.aborted&&(!desktop||epoch!==undefined&&desktop.ownership(surface)===epoch);
  void getShellNavigationItem(binding.threadId,controller.signal).then(row=>{
   if(!current())return;
   if(destination.scope.authority.kind!=='local'||row.kind==='side'||row.kind==='delegate'||row.id!==binding.threadId||destination.scope.threadId!==row.id||destination.scope.projectId!==row.projectId||(binding.projectId!==undefined&&binding.projectId!==row.projectId)||!destination.scope.workingCopyId||destination.scope.workingCopyId!==row.workspaceId)throw Error('The pull request destination changed. Reopen the current thread details.');
   setAdmission({key,row,selection:{target:{authority:'personal',threadId:row.id,includeArchived:false},navigationKey:key+row.updatedAt+':destination:'+destination.id}});
   setTarget({kind:'pull-request',...destination.target});setAdmittedDestination(destination.id);
   consumeDestination?.(destination.id);
  }).catch(cause=>{
   if(!current())return;
   setError(cause instanceof Error?cause.message:'The pull request destination could not open.');setAdmittedDestination(destination.id);consumeDestination?.(destination.id);
  });
  return()=>controller.abort();
 },[destination?.id,key,held,nativeEpoch]);
 useEffect(()=>{
  if(!owner)return;const controller=new AbortController();
  setMetadata(previous=>previous?.ownerKey===presentationKey?{...previous,pending:true}:undefined);
  void Promise.allSettled([get<GitStatus>(owner,'/git',controller.signal),get<{repo:string;items:{number:number;title:string}[]}>(owner,'/pull-requests?linked=1',controller.signal)]).then(([git,links])=>{
   if(controller.signal.aborted)return;
   setMetadata({ownerKey:presentationKey,scope,git:git.status==='fulfilled'?git.value:undefined,pullRequests:links.status==='fulfilled'?links.value.items.map(item=>({repo:links.value.repo,...item})):[],pending:false,...(git.status==='rejected'?{error:'Review access could not load.'}:{}),...(links.status==='rejected'?{pullRequestError:'Linked pull requests could not load.'}:{})});
  });return()=>controller.abort();
 },[presentationKey,scope,refresh]);
 const targetKey=JSON.stringify([scope,target]);
 useEffect(()=>{
  if(!owner||target.kind!=='pull-request')return;const controller=new AbortController();
  void get<NonNullable<ReviewWrites['review']>>(owner,'/pull-requests/'+target.number,controller.signal).then(value=>{if(!controller.signal.aborted&&value.repo===target.repo&&value.item.number===target.number)setReview({key:targetKey,value});}).catch(()=>{});
  return()=>controller.abort();
 },[targetKey,ownerMetadata?.git?.revision,refresh]);
 async function choose(id:string){
  if(!id||choosing.current||!isCurrent()||context&&!reviewCurrent())return;choosing.current=true;const operationVersion=++fence.current.version,epoch=desktop?.ownership(surface),current=()=>fence.current.active&&!held&&fence.current.version===operationVersion&&(!desktop||epoch!==undefined&&desktop.ownership(surface)===epoch);
  setChanging(true);setError('');
  try{
   const check=()=>{if(!current())throw Error('The workspace owner changed. Retry from the current view.');};
   await journalFlush();check();await prepareEditorHandoff();check();const row=await getShellNavigationItem(id);check();if(row.id!==id||!row.projectId||row.kind==='side'||row.kind==='delegate')throw Error('Choose a main conversation connected to a project.');
   const next:PanelBinding={authority:{kind:'local'},threadId:row.id,projectId:row.projectId},threads=canvas.panels.filter(panel=>panel.kind==='thread'),panel=threads.find(panel=>panel.id==='review-owner-'+canvas.id)??(threads.length===1?threads[0]:undefined);
   if(panel)await workspace.send('workspace.panel.update',{panelId:panel.id,patch:{binding:next}},current);else await workspace.send('workspace.panel.add',{canvasId:canvas.id,panel:{id:'review-owner-'+canvas.id,kind:'thread',binding:next}},current);
   if(current())setTarget({kind:'local',scope:'worktree'});
  }catch(cause){setError(cause instanceof Error?cause.message:'The working copy could not open.');}finally{choosing.current=false;if(fence.current.active)setChanging(false);}
 }
 async function post<T>(path:string,body:unknown):Promise<T>{
  const text=JSON.stringify(body);return authenticated(()=>{
   if(!reviewCurrent())throw new ApiError('CAPABILITY_DENIED','The owning workspace changed.');
   return fetch('/api/projects/'+encodeURIComponent(owner!.projectId)+path,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:text});
  }).then(read<T>);
 }
 async function submit(action:ReviewActionContext,payload:ReviewOperation['payload']):Promise<ReviewActionResult>{
  if(!owner||!sameOwner(action.selection.owner,owner)||!reviewCurrent()||action.operation==='review-pr'&&!pullRequestsReady)return{state:'revoked'};
  try{
   const receipt=await post<{commandId:string;result:{state?:string;operation?:string}}>('/actions',{id:action.operationId,type:action.operation,payload,threadId:owner.threadId});
   const confirmed=receipt.commandId===action.operationId&&receipt.result?.state==='confirmed'&&receipt.result.operation===action.operation;
   if(confirmed&&isCurrent())setRefresh(value=>value+1);return{state:confirmed?'confirmed':'uncertain'};
  }catch(cause){return{state:cause instanceof ApiError&&cause.code==='CAPABILITY_DENIED'?'revoked':cause instanceof ApiError&&cause.code==='REVISION_CHANGED'?'stale':'uncertain'};}
 }
 async function inspect(operation:ReviewOperation):Promise<ReviewOutcomeResult>{
  if(!owner||!sameOwner(operation.selection.owner,owner)||!reviewCurrent()||operation.operation==='review-pr'&&!pullRequestsReady)return{state:'revoked'};
  try{const result=await post<ReviewOutcomeResult>('/action-outcomes/inspect',operation);return result&&['confirmed','not-applied','uncertain','revoked'].includes(result.state)?result:{state:'uncertain'};}catch(cause){return{state:cause instanceof ApiError&&cause.code==='CAPABILITY_DENIED'?'revoked':'uncertain'};}
 }
 const rows=[...(admitted?[admitted.row]:[]),...(navigation.page?.items??[])].filter((row,index,all)=>row.projectId&&row.kind!=='delegate'&&row.kind!=='side'&&all.findIndex(other=>other.id===row.id)===index),owners=rows.map(row=>({owner:{authority:{kind:'local' as const},projectId:row.projectId!,threadId:row.id},label:(row.projectName??row.projectId)+' / '+row.title}));
 const moreOwners=navigation.page?.nextCursor?<button disabled={navigation.pending||reviewHeld} onClick={()=>{void navigation.more();}}>More conversations</button>:null;
 const picker=<div className="code-review-owner"><Select aria-label="Project and working copy" value={admitted?.row.id??''} options={[{value:'',label:'Choose a project conversation'},...rows.map(row=>({value:row.id,label:(row.projectName??row.projectId)+' / '+row.title}))]} disabled={held||changing||pending} onValueChange={id=>{void choose(id);}}/>{navigation.page?.nextCursor&&<button disabled={navigation.pending} onClick={()=>{void navigation.more();}}>More conversations</button>}</div>;
 const writes:ReviewWrites|undefined=owner&&ownerMetadata?.git?{owner,git:{...ownerMetadata.git,gitWrite:ownerMetadata.git.gitWrite===true&&!ownerMetadata.pending&&!reviewHeld},review:pullRequestsReady&&review?.key===targetKey?review.value:undefined,onStage:submit,onUnstage:submit,onCommit:submit,onInspectOutcome:inspect,...(pullRequestsReady?{onReview:submit,onCreatePullRequest:()=>{if(reviewCurrent())void openConversation(owner.threadId!,'linked-pull-requests').catch(()=>setError('Pull request tools could not open.'));},onLinkPullRequest:()=>{if(reviewCurrent())void openConversation(owner.threadId!,'linked-pull-requests').catch(()=>setError('Pull request tools could not open.'));}}:{})}:undefined;
 const failure=error||bindingError||conversation.state.error||(currentContext&&(currentContext.readOnly||currentContext.archived)?'Choose a main conversation connected to a project.':'');useDesktopReady(!pending&&(!binding?.threadId||Boolean(currentContext)||Boolean(failure)));
 return <div className="code-review-host">
  {detached&&<p className="code-review-notice">This conversation is open in another window.<button onClick={()=>{void desktop?.bridge.focus(detached.id);}}>Focus existing window</button></p>}
  {failure&&<p className="code-review-notice" role="alert">{failure}<button onClick={()=>{setRetry(value=>value+1);void conversation.reader.retry();}}>Retry conversation</button></p>}
  {!context&&picker}<PendingStatus pending={pending||conversation.state.pending||eligible&&!metadataReady} label="Opening review..."/>
  {ownerMetadata?.error&&<p className="code-review-notice" role="alert">{ownerMetadata.error}<button onClick={()=>setRefresh(value=>value+1)}>Retry access</button></p>}
  {ownerMetadata?.pullRequestError&&<p className="code-review-notice" role="alert">{ownerMetadata.pullRequestError}<button onClick={()=>setRefresh(value=>value+1)}>Retry pull requests</button></p>}
  {selection&&context&&ownerMetadata&&<div className="code-review-bound" inert={reviewHeld}><CodeReviewWorkspace key={presentationKey} selection={selection} ownerControls={moreOwners} owners={owners} pullRequests={ownerMetadata.pullRequests} writes={writes} onRefresh={()=>setRefresh(value=>value+1)} onNavigate={next=>{if(!reviewCurrent())return;if(!sameOwner(next.owner,selection.owner))void choose(next.owner.threadId!);else{fence.current.version++;setTarget(next.target);}}}
   terminal={active=><TerminalBody projectId={selection.owner.projectId} threadId={selection.owner.threadId} active={active&&!reviewHeld} isCurrent={reviewCurrent}/>} chat={<ConversationPane conversation={conversation} renderComposer={()=><ScopedConversationComposer key={presentationKey} context={reviewHeld?{...context,readOnly:true}:context} composers={composers} openConversation={openConversation} refreshOwner={conversation.reader.poll} placeholder="Ask about these changes..."/>}/>}/></div>}
  {!binding?.threadId&&!failure&&<p className="code-review-notice">Choose a project conversation to review its working copy.</p>}
 </div>;
}
