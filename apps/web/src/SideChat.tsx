import {useEffect,useImperativeHandle,useLayoutEffect,useRef,useState,type Ref} from 'react';
import {ArrowUp,CircleStop,LoaderCircle,Plus} from 'lucide-react';
import type {Snapshot,Thread} from '../../../packages/contracts';
import {command} from './api';
import {FloatingWindow} from './FloatingWindow';
import {Markdown} from './Markdown';
import {journalCompareAndSwap,journalGeneration,journalRead,journalReadRecord,journalSubscribe,journalWrite} from './journal';
import {useThreadMessages} from './thread-messages';
import {Select} from '../../../packages/ui-shell/Select';
import './side-chat.css';

export interface SideChatHandle {ask(content:string):Promise<void>}
const errorMessage=(cause:unknown)=>cause instanceof Error?cause.message:'The side question could not be sent.';
export function SideChat({parent,snapshot,modelId,open,onClose,refresh,ref}:{parent:Thread;snapshot:Snapshot;modelId:string;open:boolean;onClose:()=>void;refresh:()=>Promise<void>;ref?:Ref<SideChatHandle>}){
 const storageKey='harness:side-selected:'+parent.id;
 const [selectedId,setSelectedId]=useState<string|null>(()=>{try{return localStorage.getItem(storageKey);}catch{return null;}});
 const side=snapshot.threads.find(thread=>thread.id===selectedId&&thread.sideParentId===parent.id);
 const histories=snapshot.threads.filter(thread=>thread.sideParentId===parent.id).toSorted((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const draftKey=`side-draft:${parent.id}:${selectedId??'new'}`;
 const draftTarget=useRef(draftKey);
 const [draft,setDraft]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const sending=useRef(false),input=useRef<HTMLTextAreaElement>(null),scroll=useRef<HTMLDivElement>(null),tail=useRef(true);
 const working=Boolean(side?.runId)||side?.status==='working';
 const threadMessages=useThreadMessages(snapshot,side?.id,true),messages=threadMessages.messages.filter(message=>message.role!=='activity');
 useLayoutEffect(()=>{draftTarget.current=draftKey;},[draftKey]);
 useEffect(()=>{try{if(selectedId)localStorage.setItem(storageKey,selectedId);else localStorage.removeItem(storageKey);}catch{/* Drafts remain in the journal. */}},[storageKey,selectedId]);
 useEffect(()=>{let active=true;setReady(false);void journalRead<string>(draftKey).then(value=>{if(active){setDraft(value??'');setReady(true);}}).catch(()=>{if(active){setReady(true);setError('Draft recovery is unavailable. Keep this window open.');}});return()=>{active=false;};},[draftKey]);
 useEffect(()=>journalSubscribe(draftKey,value=>{if(draftTarget.current===draftKey)setDraft(typeof value==='string'?value:'');}),[draftKey]);
 useEffect(()=>{if(open&&ready)input.current?.focus({preventScroll:true});},[open,ready]);
 useLayoutEffect(()=>{if(tail.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[messages.map(message=>message.id+message.content).join('\n'),open]);
 const updateDraft=(value:string)=>{setDraft(value);void journalWrite(draftTarget.current,value).catch(cause=>setError(errorMessage(cause)));};
 const select=(id:string|null)=>{if(sending.current)return;setSelectedId(id);setError('');tail.current=true;};
 const send=async(content=draft)=>{
  if(sending.current||working)throw new Error('Wait for this side response, or stop it before asking another question.');
  if(!ready)throw new Error('Your saved side draft is still opening.');
  if(!content.trim())return;
  if(!modelId)throw new Error('Choose an available model before sending a side question.');
  sending.current=true;setBusy(true);setError('');const generation=journalGeneration(draftKey);
  try{
   let id=side?.id,newGeneration:string|undefined,copiedGeneration:string|undefined;
   if(!id){
    const receipt=await command('thread.create',{sideParentId:parent.id,title:content.trim().slice(0,65)});id=(receipt.result as Thread).id;
    const latest=await journalReadRecord<string>(draftKey);copiedGeneration=latest?.generation;
    // Keystrokes after creation follow the destination immediately, including
    // while its journal transaction and snapshot refresh are still pending.
    draftTarget.current=`side-draft:${parent.id}:${id}`;
    newGeneration=await journalWrite(draftTarget.current,latest?.value??content);
    if(latest)await journalCompareAndSwap(draftKey,latest.generation,'');
    setSelectedId(id);
   }
   await command('message.send',{content:content.trim(),modelId},id);
   await journalCompareAndSwap(draftKey,generation,'');
   if(newGeneration&&copiedGeneration===generation)await journalCompareAndSwap(`side-draft:${parent.id}:${id}`,newGeneration,'');
   await refresh();tail.current=true;
  }catch(cause){setError(errorMessage(cause));throw cause;}
  finally{sending.current=false;setBusy(false);}
 };
 useImperativeHandle(ref,()=>({async ask(content){if(!content.trim())return;if(draft.trim()&&draft!==content)throw new Error('Finish or clear the saved side draft before sending another question.');updateDraft(content);await send(content);}}));
 const execute=async(type:string)=>{if(!side)return;setError('');setBusy(true);try{await command(type,type==='run.resume'?{modelId}:{},side.id);await refresh();}catch(cause){setError(errorMessage(cause));}finally{setBusy(false);}};
 return <FloatingWindow id={'side-chat-'+parent.id} title="Side conversation" open={open} onClose={onClose} defaultSize={{width:440,height:540}} minSize={{width:300,height:280}} resetPosition className="side-chat-window">
  <div className="side-chat">
   <header className="side-chat-context"><span>Read-only · Main task keeps working</span><button className="icon-button" title="New side conversation" aria-label="New side conversation" disabled={busy} onClick={()=>select(null)}><Plus size={15}/></button></header>
   {histories.length>0&&<label className="side-chat-history"><span className="sr-only">Side conversation history</span><Select aria-label="Side conversation history" disabled={busy} value={side?.id??''} onValueChange={value=>select(value||null)} options={[{value:'',label:'New question'},...histories.map(thread=>({value:thread.id,label:thread.title+(thread.runId?' · Working':'')}))]}/></label>}
   <div ref={scroll} className="side-chat-messages" role="log" aria-label="Side conversation messages" onScroll={()=>{const element=scroll.current;if(element)tail.current=element.scrollHeight-element.scrollTop-element.clientHeight<48;}}>
    {!messages.length&&<p className="side-chat-empty">Ask about this conversation without interrupting the main task.</p>}
    {messages.map(message=><div key={message.id} className={'side-message side-message-'+message.role}><span className="sr-only">{message.role==='user'?'You':'Agent'}</span><Markdown text={message.content} animate={message.role==='assistant'&&working}/></div>)}
    {working&&<div className="side-chat-working" role="status"><LoaderCircle size={13} className="spinning"/>Thinking…</div>}
    {side?.error&&<p className="error-text" role="alert">{side.error}</p>}
   </div>
   {error&&<p className="side-chat-error error-text" role="alert">{error}</p>}
   {side&&['stopped','interrupted','failed'].includes(side.status)?<div className="side-chat-resume"><span>{side.status==='stopped'?'Side response stopped.':'Side response interrupted.'}</span><button className="secondary" disabled={busy||!modelId} onClick={()=>void execute('run.resume')}>Resume side response</button></div>:<form className="side-chat-composer" onSubmit={event=>{event.preventDefault();void send().catch(()=>{});}}>
    <textarea ref={input} aria-label="Side question" placeholder="Ask a side question…" rows={2} value={draft} disabled={!ready} onChange={event=>updateDraft(event.target.value)} onKeyDown={event=>{if(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send().catch(()=>{});}}}/>
    {working?<button type="button" className="icon-button" aria-label="Stop side response" disabled={busy} onClick={()=>void execute('run.stop')}><CircleStop size={19}/></button>:<button className="send-button" aria-label="Send side question" disabled={busy||!ready||!draft.trim()||!modelId}>{busy?<LoaderCircle size={16} className="spinning"/>:<ArrowUp size={17}/>}</button>}
   </form>}
  </div>
 </FloatingWindow>;
}
