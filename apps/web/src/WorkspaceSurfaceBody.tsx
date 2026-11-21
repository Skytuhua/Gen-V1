import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import type {Snapshot} from '../../../packages/contracts/index.ts';
import type {PanelBinding,WorkspacePanelKind} from '../../../packages/contracts/workspace.ts';
import {workspaceActionEnvelopeSchema,workspaceActionPayloadSchemas,createdPullRequestResultSchema} from '../../../packages/contracts/workspace-action-outcomes';
import type {GitStatus} from '../../../packages/workspace/tools.ts';
import {ApiError,authenticated,csrfToken,read} from './api.ts';
import {UsageSummary,WorkspaceLauncher,GrantedFiles,RecordedDiffPanel,OutputPanel} from './WorkspacePanelBodies.tsx';
import {getPreferences,type UiPreferences} from '../../../packages/contracts/preferences.ts';
import type {TimeFormat} from './time-format';
import {Artifact} from './Artifact.tsx';
import {PlanStatus} from './PlanStatus.tsx';
import {TaskMemory} from './TaskMemory.tsx';
import {z} from 'zod';
import {journalRead,journalWrite,journalSubscribe,journalFlush,journalGeneration,journalCompareAndSwap} from './journal.ts';
import {useDesktopCloseGuard} from './desktop-context.tsx';
import {GitHubSignIn} from './GitHubSignIn.tsx';
import {FileCheckpoints} from './FileCheckpoints';
import {createHttpCheckpointAdapter,disabledCheckpointAdapter,type CheckpointOwner} from './file-checkpoint-api';
import type {TerminalExcerptComposer} from './TerminalBody';
import {TerminalBody} from './TerminalBody.tsx';
export {TerminalBody} from './TerminalBody.tsx';
import './workspace-tools.css';
import {ProjectFiles} from './files/ProjectFiles';
import {ConnectFolderNotice} from './ConnectFolderNotice';
import {panelLabels} from './WorkspaceControls';

const get=<T,>(url:string,signal?:AbortSignal)=>authenticated(()=>fetch(url,{credentials:'same-origin',cache:'no-store',signal})).then(read<T>);
const post=<T,>(url:string,body:unknown,isCurrent?:()=>boolean)=>authenticated(()=>{if(isCurrent&&!isCurrent())throw new ApiError('CAPABILITY_DENIED','The owning workspace changed.');return fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify(body)});}).then(read<T>);
const message=(error:unknown)=>error instanceof Error?error.message:'The project tool could not complete this request.';
function useProjectRequest<T>(url:string,active:boolean){
 const[value,setValue]=useState<T|null>(null),[error,setError]=useState(''),[errorCode,setErrorCode]=useState(''),generation=useRef(0),pending=useRef<AbortController|null>(null),activeLoad=useRef<(()=>Promise<void>)|null>(null);
 const load=useCallback(async():Promise<void>=>{if(activeLoad.current!==load)return;const captured=++generation.current;pending.current?.abort();const controller=new AbortController();pending.current=controller;setError('');setErrorCode('');try{const next=await get<T>(url,controller.signal);if(captured===generation.current)setValue(next);}catch(error){if(captured===generation.current&&!controller.signal.aborted){setError(message(error));setErrorCode(error instanceof ApiError?error.code:'');}}finally{if(pending.current===controller)pending.current=null;}},[url]);
 activeLoad.current=load;
 useEffect(()=>{activeLoad.current=load;setValue(null);if(active)void load();return()=>{activeLoad.current=null;generation.current++;pending.current?.abort();pending.current=null;};},[load,active]);return{value,error,errorCode,load,setError};
}
function FilesBody({base,query,active,fallback}:{base:string;query:URLSearchParams;active:boolean;fallback:ReactNode}){
 const owner=base+'?'+query.toString();
 return <ProjectFiles key={owner} base={base} query={query.toString()} active={active} fallback={fallback}/>;
}
function DiffBody({base,query,active,fallback}:{base:string;query:URLSearchParams;active:boolean;fallback:ReactNode}){
 const{value,error,errorCode,load,setError}=useProjectRequest<GitStatus>(base+'/git?'+query,active),[staged,setStaged]=useState(false),[pending,setPending]=useState(false);
 const apply=async(type:string,path:string)=>{if(!value||value.gitWrite!==true||pending)return;setPending(true);try{await post(base+'/actions',{id:crypto.randomUUID(),type,payload:{paths:[path],revision:value.revision,expectedHead:value.head},...(query.get('threadId')?{threadId:query.get('threadId')}:{})});await load();}catch(error){setError(message(error));}finally{setPending(false);}};
 if(errorCode==='PROJECT_NOT_CONNECTED')return fallback;
 const legacy=(value as (GitStatus&{mode?:string})|null)?.mode==='legacy';
 return <div className="live-review"><div className="panel-toolbar"><strong>Changes</strong><span>{value?.branch}</span><button onClick={()=>void load()}>Refresh</button><label><input type="checkbox" checked={staged} onChange={event=>setStaged(event.target.checked)}/>Staged</label></div>{error&&<p role="status" className="error-text">{error}</p>}{legacy&&<p className="panel-note">Original working copy · tracked changes only. Git actions are available in an agent’s isolated working copy.</p>}{value&&<><small className="review-revision" title={value.revision}>Reviewing {value.head.slice(0,10)} · {value.files.length} changed files</small><ul className="live-change-list">{value.files.map(file=><li key={file.path}><span>{file.oldPath?file.oldPath+' → ':''}{file.path}</span><small>{file.binary?'Binary':file.untracked?'Untracked':`${file.index}${file.worktree} +${file.added??'?'} −${file.removed??'?'}`}</small><button disabled={pending||value.gitWrite!==true} onClick={()=>void apply(file.staged?'unstage':'stage',file.path)}>{file.staged?'Unstage':'Stage'}</button></li>)}</ul><pre className="live-diff" aria-label={staged?'Staged diff':'Unstaged diff'}>{(staged?value.stagedDiff:value.diff)||'No tracked changes in this view.'}</pre></>}</div>;
}
function ChangesBody({base,query,active,recorded,fallback,preferences}:{base:string;query:URLSearchParams;active:boolean;recorded:ReactNode;fallback:ReactNode;preferences:UiPreferences}){
 // Enable History only with a host adapter and the context's exact workingCopy.id.
 const threadId=query.get('threadId')??undefined;
 const{value}=useProjectRequest<{available:boolean;restore:boolean;owner?:CheckpointOwner}>(base+'/checkpoints/capability?'+query,active);
 const adapter=useMemo(()=>value?.available?createHttpCheckpointAdapter(base,threadId,value.restore===true):disabledCheckpointAdapter,[value?.available,value?.restore,base,threadId]);
 return <FileCheckpoints preferences={preferences} owner={value?.available?value.owner:undefined} adapter={adapter} current={<DiffBody base={base} query={query} active={active} fallback={fallback}/>} recorded={recorded}/>;
}
export type ReviewRequest = {id:number;repo:string;number:number;threadId:string;projectId:string;panelId:string};
export function WorkspaceSurfaceBody({kind,binding,snapshot,refresh,active=true,preferences,onSelectThread,onOpenTool,onConnect,panelId,excerptComposer,reviewRequest,onReviewHandled}:{reviewRequest?:ReviewRequest;onReviewHandled?:(id:number)=>void;excerptComposer?:TerminalExcerptComposer;kind:WorkspacePanelKind;binding:PanelBinding;snapshot:Snapshot;refresh:()=>Promise<void>;active?:boolean;preferences?:UiPreferences;panelId?:string;onSelectThread?:(id:string)=>void|Promise<void>;onOpenTool?:(kind:WorkspacePanelKind)=>void|Promise<void>;onConnect?:()=>void}){
 const threadId=binding.threadId??snapshot.activeThreadId??undefined,thread=snapshot.threads.find(item=>item.id===threadId),projectId=binding.projectId??thread?.projectId;
 if(binding.authority.kind!=='local')return <p className="panel-note">This panel requires its owning plug-in adapter.</p>;
 const prefs=preferences??getPreferences(snapshot.settings);
 if(kind==='plan')return <PlanStatus snapshot={snapshot} threadId={threadId}/>;
 if(kind==='notes')return binding.threadId&&snapshot.threads.some(item=>item.id===binding.threadId)?<TaskMemory key={binding.threadId} snapshot={snapshot} threadId={binding.threadId}/>:<p className="panel-note">Choose the owning conversation to use these notes.</p>;
 if(kind==='usage')return <UsageSummary usage={threadId?snapshot.usage[threadId]:undefined}/>;
 if(kind==='artifact')return <ArtifactSurface binding={binding} snapshot={snapshot} refresh={refresh} active={active}/>;
 if(kind==='output')return <OutputPanel snapshot={snapshot} threadId={threadId} preferences={prefs}/>;
 if(kind==='workspace')return <WorkspaceLauncher onOpenTool={onOpenTool}/>;
 if(kind==='navigation')return <NavigationSurface snapshot={snapshot} selectedId={threadId} select={onSelectThread}/>;
 const files=<GrantedFiles snapshot={snapshot} threadId={threadId} preferredResourceId={binding.resourceId}/>,recordedDiff=<RecordedDiffPanel snapshot={snapshot} threadId={threadId} preferences={prefs}/>,prerequisite=<div className="surface-prerequisite"><ConnectFolderNotice onConnect={onConnect}/></div>;
 if(!projectId&&kind==='files')return files;
 if(!projectId&&kind==='diff')return recordedDiff;
 if(!projectId&&(kind==='pull-request'||kind==='linked-pull-requests'))return <><GitHubSignIn active={active} timeFormat={prefs.timeFormat}/><p className="panel-note">Connect a project to use {panelLabels[kind].toLowerCase()}.</p></>;
 if(!projectId)return <p className="panel-note">Connect a project to use {panelLabels[kind].toLowerCase()}.</p>;
 const base='/api/projects/'+encodeURIComponent(projectId),query=new URLSearchParams(threadId?{threadId}:{});
 if(kind==='files')return <FilesBody base={base} query={query} active={active} fallback={prerequisite}/>;
 if(kind==='diff')return <ChangesBody key={base+'?'+query} base={base} query={query} active={active} recorded={recordedDiff} fallback={prerequisite} preferences={prefs}/>;
 if(kind==='terminal')return <TerminalBody key={projectId+':'+threadId+':'+binding.terminalId} projectId={projectId} threadId={threadId} terminalId={binding.terminalId} active={active} excerptComposer={excerptComposer} openAnother={onOpenTool?()=>onOpenTool('terminal'):undefined} onConnect={onConnect}/>;
 if(kind==='pull-request'||kind==='linked-pull-requests'){const journalKey='pr-panel:'+JSON.stringify(['local',projectId,threadId??null,kind,panelId??'sidebar']);return <PullRequestsBody key={journalKey} journalKey={journalKey} base={base} query={query} active={active} threadId={threadId} linked={kind==='linked-pull-requests'} reviewRequest={kind==='linked-pull-requests'&&reviewRequest&&reviewRequest.threadId===threadId&&reviewRequest.projectId===projectId&&reviewRequest.panelId===(panelId??'sidebar')?reviewRequest:undefined} onReviewHandled={onReviewHandled} onConnect={onConnect} timeFormat={prefs.timeFormat}/>;}
 return <p className="panel-note">Select this surface from the workspace.</p>;
}
function ArtifactSurface({binding,snapshot,refresh,active}:{binding:PanelBinding;snapshot:Snapshot;refresh:()=>Promise<void>;active:boolean}){
 const[systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme: dark)').matches);
 useEffect(()=>{const query=matchMedia('(prefers-color-scheme: dark)'),change=()=>setSystemDark(query.matches);query.addEventListener('change',change);return()=>query.removeEventListener('change',change);},[]);
 const artifact=snapshot.artifacts.find(item=>item.id===binding.artifactId&&item.threadId===binding.threadId&&item.lifecycle==='active');
 if(!artifact)return <p className="panel-note">This artifact is no longer available in its owning conversation.</p>;
 const theme=snapshot.settings.theme==='system'?(systemDark?'dark':'light'):snapshot.settings.theme;
 return <Artifact embedded artifact={artifact} snapshot={snapshot} theme={theme} refresh={refresh} active={active}/>;
}
function NavigationSurface({snapshot,selectedId,select}:{snapshot:Snapshot;selectedId?:string;select?: (id:string)=>void|Promise<void>}){
 const[error,setError]=useState('');return <nav className="live-navigation" aria-label="Conversation navigation">{error&&<p role="status" className="error-text">{error}</p>}{snapshot.threads.filter(thread=>thread.kind!=='delegate').toSorted((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(thread=><button key={thread.id} disabled={!select} aria-current={thread.id===selectedId?'page':undefined} onClick={()=>{if(select)void Promise.resolve(select(thread.id)).catch(reason=>setError(message(reason)));}}><small>{thread.projectName||'Personal'} · {thread.status}</small><strong>{thread.title}</strong></button>)}</nav>;
}
const gitHead=z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i),gitRevision=z.string().regex(/^[a-f0-9]{64}$/i);
const prActionSchema=workspaceActionEnvelopeSchema.extend({type:z.enum(['create-pr','review-pr'])});
const prPendingSchema=z.object({owner:z.string().max(2048),command:prActionSchema}).refine(value=>workspaceActionPayloadSchemas[value.command.type].safeParse(value.command.payload).success);
const prJournalSchema=z.object({version:z.literal(1),draft:z.boolean(),title:z.string().max(200),body:z.string().max(64000),baseBranch:z.string().max(151),push:z.boolean(),link:z.string().max(32),basis:z.object({head:gitHead,revision:gitRevision,branch:z.string().max(200),files:z.number().int().nonnegative()}).nullable(),selected:z.number().int().positive().nullable(),comments:z.record(z.string().regex(/^[1-9]\d*$/),z.object({head:gitHead,revision:gitRevision,body:z.string().max(64000)})),pending:prPendingSchema.optional()});
type PRJournal=z.infer<typeof prJournalSchema>;
const emptyPRJournal:PRJournal={version:1,draft:false,title:'',body:'',baseBranch:'main',push:false,link:'',basis:null,selected:null,comments:{}};
interface PRDetails {item:{number:number;title:string;headRefOid:string;state:string;files:{path:string;additions:number;deletions:number}[];statusCheckRollup:unknown[]};head:string;revision:string;canReview:boolean}
const checkLabel:Record<string,string>={SUCCESS:'Passed',FAILURE:'Failed',TIMED_OUT:'Timed out',CANCELLED:'Cancelled',SKIPPED:'Skipped',NEUTRAL:'Neutral',ACTION_REQUIRED:'Needs action',IN_PROGRESS:'Running',QUEUED:'Queued',WAITING:'Waiting',PENDING:'Pending'};
const titleCase=(value:string)=>value?value.charAt(0)+value.slice(1).toLowerCase().replace(/_/g,' '):value;
type CheckRow={name:string;state:'pass'|'fail'|'pending'|'skipped';label:string};
const checkRows=(rollup:unknown):CheckRow[]=>Array.isArray(rollup)?rollup.map(check=>{const entry=check as {name?:string;workflowName?:string;status?:string;conclusion?:string};const state:CheckRow['state']=entry.status==='COMPLETED'?(entry.conclusion==='SUCCESS'?'pass':entry.conclusion==='NEUTRAL'||entry.conclusion==='SKIPPED'?'skipped':'fail'):'pending';return {name:entry.name??entry.workflowName??'Check',state,label:entry.status==='COMPLETED'?checkLabel[entry.conclusion??'']??entry.conclusion??'Completed':checkLabel[entry.status??'']??entry.status??'Pending'};}):[];
const checkSummary=(checks:CheckRow[])=>([['fail','failed'],['pending','running'],['pass','passed'],['skipped','skipped']] as const).flatMap(([state,word])=>{const count=checks.filter(check=>check.state===state).length;return count?[`${count} ${word}`]:[];}).join(' · ');
function PullRequestsBody({base,query,active,threadId,journalKey,linked,reviewRequest,onReviewHandled,onConnect,timeFormat}:{base:string;query:URLSearchParams;active:boolean;threadId?:string;journalKey:string;linked:boolean;reviewRequest?:ReviewRequest;onReviewHandled?:(id:number)=>void;onConnect?:()=>void;timeFormat:TimeFormat}){
 const listQuery=new URLSearchParams(query);if(linked)listQuery.set('linked','1');
 const{value,error,errorCode,load,setError}=useProjectRequest<{repo:string;items:{number:number;title:string;url:string;state:string}[]}>(base+'/pull-requests?'+listQuery,active),git=useProjectRequest<GitStatus>(base+'/git?'+query,active);
 const[saved,setSaved]=useState<PRJournal>(emptyPRJournal),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[details,setDetails]=useState<PRDetails|null>(null),[detailReload,setDetailReload]=useState(0),[recovery,setRecovery]=useState(0);
 const latest=useRef(saved),hydrated=useRef(false),mounted=useRef(true),pendingAction=useRef(false);
 const owner=JSON.stringify([base,threadId??null]);
 const accept=useCallback((raw:unknown)=>{const result=prJournalSchema.safeParse(raw);if(!result.success||result.data.pending&&(result.data.pending.owner!==owner||result.data.pending.command.threadId!==threadId)){hydrated.current=false;setReady(false);setError('The saved pull request draft could not be read in this workspace. Keep this panel open and retry before editing.');return false;}latest.current=result.data;setSaved(result.data);return true;},[setError,owner,threadId]);
 useEffect(()=>{let current=true;mounted.current=true;const unsubscribe=journalSubscribe(journalKey,accept);void journalRead(journalKey).then(raw=>{if(!current)return;const valid=accept(raw??emptyPRJournal);hydrated.current=valid;setReady(valid);}).catch(reason=>{if(current)setError('Pull request draft recovery failed: '+message(reason));});return()=>{current=false;mounted.current=false;hydrated.current=false;unsubscribe();};},[journalKey,accept,setError,recovery]);
 const update=(patch:Partial<PRJournal>)=>{if(!hydrated.current)return;const parsed=prJournalSchema.safeParse({...latest.current,...patch});if(!parsed.success){setError('The draft contains an unsupported value or text that is too long.');return;}const next=parsed.data;latest.current=next;setSaved(next);void journalWrite(journalKey,next).catch(reason=>{if(mounted.current)setError(message(reason));});};
 useDesktopCloseGuard('pr-editor:'+journalKey,async()=>{if(!hydrated.current)throw Error('Recover the pull request draft before moving this panel.');if(pendingAction.current)throw Error('Wait for the pull request action to finish before moving this panel.');await journalFlush();if(pendingAction.current)throw Error('Wait for the pull request action to finish before moving this panel.');});
 useEffect(()=>{if(!active||!ready||!reviewRequest||!value||value.repo.toLowerCase()!==reviewRequest.repo.toLowerCase())return;update({selected:reviewRequest.number});onReviewHandled?.(reviewRequest.id);},[active,ready,reviewRequest,value,onReviewHandled]);
 const queryKey=query.toString();
 useEffect(()=>{setDetails(null);if(!active||!ready||reviewRequest||saved.selected===null)return;const controller=new AbortController();void get<PRDetails>(base+'/pull-requests/'+saved.selected+'?'+queryKey,controller.signal).then(next=>{if(!controller.signal.aborted)setDetails(next);}).catch(reason=>{if(!controller.signal.aborted)setError(message(reason));});return()=>controller.abort();},[base,queryKey,active,ready,saved.selected,detailReload,setError,reviewRequest]);
 const finishPending=async(intent:z.infer<typeof prPendingSchema>,accepted:boolean)=>{
  const current=latest.current;if(!mounted.current||current.pending?.command.id!==intent.command.id)return;
  const generation=journalGeneration(journalKey),next={...current,pending:undefined},{type,payload}=intent.command;
  if(accepted&&type==='create-pr'&&current.basis?.head===payload.head&&current.basis.revision===payload.revision&&current.title===payload.title&&current.body===(payload.body??'')&&current.baseBranch===(payload.base??'main')&&current.push===(payload.push===true))next.draft=false;
  if(accepted&&type==='review-pr'){const key=String(payload.number),comment=current.comments[key];if(comment&&comment.head===payload.head&&comment.revision===payload.revision&&comment.body===payload.body)next.comments={...current.comments,[key]:{...comment,body:''}};}
  if(!await journalCompareAndSwap(journalKey,generation,next))throw Error('The draft changed while its result was being recovered. Retry the original request.');
 };
 const sendPending=async(intent:z.infer<typeof prPendingSchema>)=>{
  if(intent.owner!==owner||intent.command.threadId!==threadId)throw Error('This request belongs to another workspace. Reopen its original panel to recover it.');
  const current=()=>mounted.current&&hydrated.current&&latest.current.pending?.owner===owner&&latest.current.pending.command.id===intent.command.id;
  try{
   await journalFlush();const receipt=await post<{commandId:string;result:unknown}>(base+'/actions',intent.command,current);
   if(receipt?.commandId!==intent.command.id)throw Error('The original request was not acknowledged. Retry it before sending another.');
   if(intent.command.type==='create-pr'){const result=createdPullRequestResultSchema.parse(receipt.result),payload=intent.command.payload;if(result.head!==payload.head||result.revision!==payload.revision||payload.repo!==undefined&&result.repo!==payload.repo)throw Error('The created pull request did not match the original request.');}
   else z.object({operationId:z.literal(intent.command.id),operation:z.literal('review-pr'),state:z.literal('confirmed')}).parse(receipt.result);
   if(current())await finishPending(intent,true);
  }catch(reason){
   if(!current())return;
   const details=reason instanceof ApiError?reason.details as {state?:unknown;operationId?:unknown}|undefined:undefined;
   if(details?.state==='not-applied'&&details.operationId===intent.command.id)await finishPending(intent,false);
   throw reason;
  }
 };
 const action=async(type:string,payload:Record<string,unknown>={})=>{
  if(latest.current.pending)throw Error('Recover the previous pull request action before starting another.');
  if(type!=='create-pr'&&type!=='review-pr')return post<unknown>(base+'/actions',{id:crypto.randomUUID(),type,payload,...(threadId?{threadId}:{})});
  const command=prActionSchema.parse({id:crypto.randomUUID(),type,payload:{...payload,repo:value?.repo},...(threadId?{threadId}:{})});workspaceActionPayloadSchemas[type].parse(command.payload);
  const intent={owner,command};if(!await journalCompareAndSwap(journalKey,journalGeneration(journalKey),{...latest.current,pending:intent}))throw Error('The saved draft changed before this request started. Review it and try again.');
  await sendPending(intent);
 };
 const perform=async(work:()=>Promise<void>)=>{if(pendingAction.current)return;pendingAction.current=true;setBusy(true);setError('');try{await work();}catch(reason){if(mounted.current)setError(message(reason));}finally{pendingAction.current=false;if(mounted.current)setBusy(false);}};
 const refresh=async()=>{await Promise.all([load(),git.load()]);if(mounted.current)setDetailReload(value=>value+1);};
 const verify=async(expected:{head:string;revision:string})=>{const current=await get<GitStatus>(base+'/git?'+query);if(!mounted.current)throw Error('This panel moved before the action started. Review it in its current window.');if(current.gitWrite!==true)throw Error('GitHub writes require an application-managed writable working copy.');if(current.head!==expected.head||current.revision!==expected.revision)throw Error('The reviewed working copy changed. Refresh and review the current revision.');return current;};
 const currentDetails=!reviewRequest&&details?.item.number===saved.selected?details:null,canWrite=git.value?.gitWrite===true;
 const review=currentDetails?(saved.comments[String(currentDetails.item.number)]??{head:currentDetails.item.headRefOid,revision:currentDetails.revision,body:''}):null;
 const reviewMatches=!!currentDetails&&!!review&&review.head===currentDetails.item.headRefOid&&review.head===currentDetails.head&&review.revision===currentDetails.revision;
 const prStale=!!currentDetails&&currentDetails.head!==currentDetails.item.headRefOid,checks=currentDetails?checkRows(currentDetails.item.statusCheckRollup):[];
 const createMatches=!!saved.basis&&!!git.value&&saved.basis.head===git.value.head&&saved.basis.revision===git.value.revision&&saved.basis.files===0&&git.value.files.length===0;
 const select=(number:number)=>{if(!hydrated.current)return;if(reviewRequest)onReviewHandled?.(reviewRequest.id);const same=latest.current.selected===number;update({selected:number});if(same)setDetailReload(value=>value+1);};
 if(errorCode==='PROJECT_NOT_CONNECTED'||git.errorCode==='PROJECT_NOT_CONNECTED')return <div className="surface-prerequisite"><ConnectFolderNotice onConnect={onConnect}/></div>;
 return <div className="live-pull-requests"><div className="panel-toolbar"><strong>{linked?'Linked pull requests':'Pull requests'}</strong><button disabled={busy} onClick={()=>void refresh()}>Refresh</button><button disabled={busy||!ready||!canWrite||Boolean(saved.pending)} onClick={()=>void perform(async()=>{const status=await get<GitStatus>(base+'/git?'+query);if(!mounted.current)return;if(status.gitWrite!==true)throw Error('GitHub writes require an application-managed writable working copy.');update({draft:true,basis:{head:status.head,revision:status.revision,branch:status.branch,files:status.files.length}});})}>New draft PR</button></div>
  {reviewRequest&&value&&value.repo.toLowerCase()!==reviewRequest.repo.toLowerCase()&&<p role="status" className="error-text">The requested pull request belongs to a different repository.</p>}{(error||git.error)&&<p className="error-text" role="status">{error||git.error}</p>}{!ready&&<p className="panel-note">Recovering the saved pull request draft. Editing is disabled until recovery succeeds. <button onClick={()=>setRecovery(value=>value+1)}>Retry draft recovery</button></p>}{value&&<p className="panel-note">{value.repo}</p>}{git.value&&!canWrite&&<p className="panel-note">This copy is read-only. You can view and link pull requests here, but not create or review them.</p>}
  {saved.pending&&<p className="panel-note" role="status">The previous request has not been confirmed. Recover its result before sending another. <button disabled={busy||!ready} onClick={()=>void perform(async()=>{await sendPending(saved.pending!);await refresh();})}>Retry original PR action</button></p>}
  <GitHubSignIn active={active} onAuthenticated={refresh} timeFormat={timeFormat}/>
  <form className="pr-link-form" onSubmit={event=>{event.preventDefault();if(!hydrated.current||!latest.current.link)return;const captured=latest.current,generation=journalGeneration(journalKey);void perform(async()=>{await action('link-pr',{number:Number(captured.link)});await journalCompareAndSwap(journalKey,generation,{...captured,link:''});await load();});}}><label>Link a pull request by number<input type="number" min="1" required placeholder="e.g. 12" disabled={!ready} value={saved.link} onChange={event=>update({link:event.target.value})}/></label><button disabled={busy||!ready||!saved.link||Boolean(saved.pending)}>Link</button></form>
  <ul className="live-change-list">{value?.items.map(item=><li key={item.number}><button disabled={!ready} onClick={()=>select(item.number)}>#{item.number} {item.title}</button><small className="pr-state" data-state={linked?'saved':item.state.toLowerCase()}>{linked?'Saved link':titleCase(item.state)}</small><a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open #${item.number} on GitHub`}>View on GitHub</a></li>)}</ul>
  {saved.draft&&saved.basis&&<form className="pr-draft-form" onSubmit={event=>{event.preventDefault();if(!ready||!canWrite||!createMatches)return;const captured=latest.current;void perform(async()=>{const status=await verify(captured.basis!);if(status.files.length)throw Error('Commit the reviewed changes before creating the pull request.');await action('create-pr',{title:captured.title,body:captured.body,base:captured.baseBranch,push:captured.push,head:captured.basis!.head,revision:captured.basis!.revision});await refresh();});}}><strong>Create draft pull request</strong><p className="panel-note">{saved.basis.branch} · {saved.basis.head.slice(0,10)}{saved.basis.files?' · Commit current changes first':''}</p>{!createMatches&&<p className="panel-note">This draft keeps its reviewed revision. Open New draft PR to review the current working copy before submitting.</p>}<label>Title<input required maxLength={200} disabled={!ready} value={saved.title} onChange={event=>update({title:event.target.value})}/></label><label>Base branch<input required maxLength={151} disabled={!ready} value={saved.baseBranch} onChange={event=>update({baseBranch:event.target.value})}/></label><label>Description<textarea maxLength={64000} disabled={!ready} value={saved.body} onChange={event=>update({body:event.target.value})}/></label><label><input type="checkbox" checked={saved.push} disabled={!ready||!canWrite} onChange={event=>update({push:event.target.checked})}/>Push this reviewed branch to GitHub</label><div><button disabled={busy||!ready||!canWrite||!createMatches||Boolean(saved.pending)}>Create draft PR</button><button type="button" onClick={()=>update({draft:false})}>Cancel</button></div></form>}
  {currentDetails&&review&&<section className="pr-review"><header className="pr-review-head"><strong>#{currentDetails.item.number} {currentDetails.item.title}</strong><small title={`Latest commit ${currentDetails.item.headRefOid}`}><span className="pr-state" data-state={currentDetails.item.state.toLowerCase()}>{titleCase(currentDetails.item.state)}</span>{currentDetails.item.files.length>0&&` · ${currentDetails.item.files.length} file${currentDetails.item.files.length===1?'':'s'} changed`}</small></header>{currentDetails.item.files.length>0&&<ul className="pr-review-files">{currentDetails.item.files.map(file=><li key={file.path}><span>{file.path}</span><small><span className="pr-add">+{file.additions}</span> <span className="pr-del">−{file.deletions}</span></small></li>)}</ul>}<div className="pr-checks" aria-label="Checks">
   <div className="pr-checks-head"><strong>Checks</strong>{checks.length>0&&<small>{checkSummary(checks)}</small>}</div>{prStale&&<p className="pr-checks-stale" title={`Pull request: ${currentDetails.item.headRefOid}
Your copy: ${currentDetails.head}`}>{checks.length>0?'These checks ran on the pull request’s latest version. Your local copy is on a different version, so your files may not match what was checked.':'Your local copy is on a different version of this pull request.'}</p>}
   {checks.length>0?<ul className="pr-check-list">{checks.map((check,index)=><li key={index} data-state={check.state}><span>{check.name}</span><small>{check.label}</small></li>)}</ul>:<p className="panel-note">No checks have reported for this pull request’s latest version yet.</p>}
  </div><div className="pr-compose"><strong>Your review</strong>{prStale?<p className="pr-compose-note">To send a review, switch your local copy to this pull request’s latest version, then press Refresh.</p>:!currentDetails.canReview?<p className="pr-compose-note">To send a review, open an editable local copy at this pull request’s latest version.</p>:!reviewMatches?<p className="pr-compose-note">This comment was started on an earlier version of the pull request. <button disabled={!canWrite||busy} onClick={()=>update({comments:{...saved.comments,[currentDetails.item.number]:{...review,head:currentDetails.item.headRefOid,revision:currentDetails.revision}}})}>Move it to the latest version</button></p>:!canWrite&&<p className="pr-compose-note">This copy is read-only, so reviews can’t be sent from here.</p>}<label>Review comment<textarea maxLength={64000} disabled={!ready} value={review.body} onChange={event=>update({comments:{...latest.current.comments,[currentDetails.item.number]:{...review,body:event.target.value}}})}/></label><div className="panel-toolbar">{(['COMMENT','APPROVE','REQUEST_CHANGES'] as const).map(event=><button key={event} disabled={busy||!ready||!canWrite||!currentDetails.canReview||!reviewMatches||Boolean(saved.pending)} onClick={()=>{if(!ready||!canWrite||!currentDetails.canReview||!reviewMatches)return;const comment={...review};void perform(async()=>{await verify(comment);await action('review-pr',{number:currentDetails.item.number,event,body:comment.body,head:comment.head,revision:comment.revision});await refresh();});}}>{event==='COMMENT'?'Comment':event==='APPROVE'?'Approve':'Request changes'}</button>)}</div></div></section>}
 </div>;
}
