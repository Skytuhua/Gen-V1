import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ArrowUp, CircleStop, MessageSquare} from 'lucide-react';
import type {ModelInfo} from '../../../packages/contracts';
import type {ConversationContext} from '../../../packages/contracts/conversation-read-models';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import {ComposerView} from './ComposerView';
import {ComposerCommands, ComposerSkillBindings, type ComposerCommandsHandle} from './ComposerCommands';
import {ModelPicker, type ModelPickerHandle} from './ModelPicker';
import {command, getModels} from './api';
import {journalWrite} from './journal';
import {useDesktop, useDetachedSurface, usePendingSurface} from './desktop-context';
import type {ConversationComposerTarget, SharedAgentComposers} from './agents-workspace/composer';

/** Uses the ordinary owner's durable drafts, pending command identity, Send and Stop controller. */
export function ScopedConversationComposer({context,composers,openConversation,refreshOwner}:{context:ConversationContext;composers:SharedAgentComposers;openConversation:(threadId:string)=>Promise<void>;refreshOwner:()=>Promise<void>}){
 const working=Boolean(context.owner.runId)||context.owner.status==='working';
 const [models,setModels]=useState<ModelInfo[]>([]),[modelId,setModelId]=useState(context.owner.modelId??''),[error,setError]=useState('');
 const target=useMemo<ConversationComposerTarget>(()=>({kind:'conversation',threadId:context.owner.threadId,modelId,working}),[context.owner.threadId,modelId,working]);
 const state=useSyncExternalStore(listener=>composers.subscribe(target,listener),()=>composers.getSnapshot(target));
 const desktop=useDesktop(),surface={kind:'thread' as const,threadId:context.owner.threadId},detached=useDetachedSurface(surface),pending=usePendingSurface(surface);
 const held=Boolean(context.readOnly||context.archived||detached||pending||desktop?.closing),input=useRef<HTMLTextAreaElement>(null),commands=useRef<ComposerCommandsHandle>(null),picker=useRef<ModelPickerHandle>(null);
 const fence=useRef({signature:'',version:0,active:true}),signature=JSON.stringify([context.scopeKey,context.owner.epoch,context.owner.runId,context.owner.status,held]);
 if(fence.current.signature!==signature)fence.current={...fence.current,signature,version:fence.current.version+1};
 useEffect(()=>{fence.current.active=true;return()=>{fence.current.active=false;fence.current.version++;};},[]);
 useEffect(()=>{void composers.prepare(target);},[composers,target]);
 useEffect(()=>{
  const controller=new AbortController();setModels([]);setError('');
  void getModels(false,context.owner.threadId,controller.signal).then(result=>{
   if(controller.signal.aborted)return;setModels(result.models);setError(result.error??'');setModelId(current=>result.models.some(model=>model.id===current)?current:result.models.some(model=>model.id===context.owner.modelId)?context.owner.modelId!:'');
  }).catch(()=>{if(!controller.signal.aborted)setError('Models could not load. Open the conversation to retry.');});
  return()=>controller.abort();
 },[context.scopeKey,context.owner.threadId]);
 const send=()=>{if(!held&&models.some(model=>model.id===modelId))void composers.submit(target);};
 async function mode(value:'plan'|'build'){
  if(working||held)throw Error('Wait for this conversation to become available.');
  const version=fence.current.version, ownership=desktop?desktop.ownership(surface):0;
  await command('thread.mode',{mode:value},context.owner.threadId,undefined,()=>fence.current.active&&fence.current.version===version&&ownership!==undefined&&(desktop?desktop.ownership(surface):0)===ownership);
  await refreshOwner();
 }
 return <div className="scoped-owner-composer-wrap">
  <div inert={held}><ComposerView className="scoped-owner-composer" onSubmit={event=>{event.preventDefault();send();}}>
   <textarea ref={input} aria-label="Message" placeholder="Ask about these sources..." rows={2} value={state.draft} disabled={held||!state.ready} onChange={event=>{void composers.edit(target,event.target.value);}} onKeyDown={event=>{if(commands.current?.keyDown(event)||isComposing(event)||event.shiftKey||event.altKey||event.ctrlKey||event.metaKey)return;if(event.key==='Enter'){event.preventDefault();send();}}}/>
   <ComposerSkillBindings bindings={state.skills??[]} disabled={held} onRemove={id=>{void composers.removeSkill(target,id).catch(()=>{});}}/>
   <ComposerCommands ref={commands} input={input} draft={state.draft} threadId={context.owner.threadId} projectId={context.owner.projectId??undefined} disabled={held||!state.ready||state.busy||state.stopping} onDraft={text=>{void composers.edit(target,text);}} onSkill={binding=>composers.addSkill(target,binding)} onModel={()=>picker.current?.open()} onMode={mode}/>
   <div className="scoped-owner-composer-actions">
    <button type="button" className="quiet" aria-label="Open conversation" disabled={held||state.busy||state.stopping} onClick={()=>{void openConversation(context.owner.threadId).catch(()=>setError('The conversation could not open. Keep this draft and retry.'));}}><MessageSquare size={14}/></button>
    <ModelPicker ref={picker} models={models} modelId={modelId} thinkingLevel={state.thinkingLevel??''} onChange={id=>{setModelId(id);if(state.thinkingLevel&&!models.find(model=>model.id===id)?.thinkingLevels?.includes(state.thinkingLevel))void journalWrite('thinking:'+context.owner.threadId,'').catch(()=>setError('The reasoning choice could not be saved.'));}} onThinkingChange={level=>{void journalWrite('thinking:'+context.owner.threadId,level).catch(()=>setError('The reasoning choice could not be saved.'));}} disabled={held||state.busy||state.stopping||working}/>
    {working?<button type="button" className="send-button stop-button" aria-label="Stop agent" disabled={held||state.stopping} onClick={()=>{if(!held)void composers.stop(target);}}><CircleStop size={18}/></button>:<button className="send-button" aria-label={state.retry?'Retry send':'Send message'} disabled={held||!models.some(model=>model.id===modelId)||!composers.canSend(target)||!state.retry&&!state.draft.trim()}><ArrowUp size={18}/></button>}
   </div>
   {(error||state.error)&&<p role="alert" className="error-text">{error||state.error}</p>}
  </ComposerView></div>
  {detached&&<button className="quiet" onClick={()=>{void desktop?.bridge.focus(detached.id).catch(()=>setError('The owning window could not be focused.'));}}>Focus existing window</button>}
 </div>;
}
