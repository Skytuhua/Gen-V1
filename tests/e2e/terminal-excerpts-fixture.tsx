import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {App} from '../../apps/web/src/App';
import {TerminalBody} from '../../apps/web/src/TerminalBody';
import {ComposerView} from '../../apps/web/src/ComposerView';
import {ComposerToolbar} from '../../apps/web/src/ComposerToolbar';
import {ScopedConversationComposer} from '../../apps/web/src/ScopedConversationComposer';
import {scopedContext} from '../scoped-conversation-fixture';
import {ComposerAttachments} from '../../apps/web/src/ComposerAttachments';
import {createSharedAgentComposers} from '../../apps/web/src/agents-workspace/composer';
import {command} from '../../apps/web/src/api';
import '@fontsource-variable/inter';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/frontend-fidelity.css';
import './terminal-excerpts-fixture.css';
const query=new URLSearchParams(location.search),target={kind:'conversation' as const,threadId:query.get('owner')??'one',projectId:'capture-project',modelId:'test/model',working:false};
const composers=createSharedAgentComposers({sendParent:input=>command('message.send',{content:input.content,modelId:input.modelId},input.threadId,input.commandId).then(()=>{}),stopParent:async()=>{}});
function Composer(){
 const state=useSyncExternalStore(listener=>composers.subscribe(target,listener),()=>composers.getSnapshot(target));const input=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{void composers.prepare(target);},[]);
 return <div className="composer-dock" data-excerpt-composer><ComposerView onSubmit={event=>{event.preventDefault();void composers.submit(target);}}><div className="composer-entry-row"><div className="composer-input"><textarea ref={input} aria-label="Message" placeholder="Ask anything..." value={state.draft} disabled={!state.ready} onChange={event=>void composers.edit(target,event.target.value)}/></div></div><ComposerAttachments resources={[]} excerpts={state.excerpts} onEditExcerpt={(id,text)=>composers.editExcerpt(target,id,text)} onRemoveExcerpt={id=>composers.removeExcerpt(target,id)}/><ComposerToolbar models={[{id:'test/model',provider:'test',name:'Audit model'}]} modelId="test/model" thinkingLevel="" onThinkingChange={()=>{}} onModelChange={()=>{}} onProject={()=>{}} onChanges={()=>{}} onCreatePR={()=>{}} onTranscript={()=>{}} leading={<button type="submit" className="secondary" disabled={state.busy||!state.ready||!state.draft.trim()&&!state.excerpts?.length}>{state.retry?'Retry send':'Send'}</button>} runtime={<span>Local</span>} separateActions/>{state.error&&<p role="alert">{state.error}</p>}</ComposerView></div>;
}
function OwnerComposer(){return query.has('scoped')?<div className="composer-dock" data-excerpt-composer><ScopedConversationComposer context={{...scopedContext,owner:{...scopedContext.owner,threadId:target.threadId,projectId:target.projectId,modelId:target.modelId}}} composers={composers} openConversation={async()=>{}} refreshOwner={async()=>{}}/></div>:<Composer/>;}
function Fixture(){
 const [hosts,setHosts]=useState<{composer:HTMLElement;terminal:HTMLElement}|null>(null);
 useEffect(()=>{const scan=()=>{const main=document.querySelector<HTMLElement>('main.workspace'),workarea=document.querySelector<HTMLElement>('.shell-workarea'),native=main?.querySelector<HTMLElement>('.composer-dock:not([data-excerpt-composer])');if(!main||!workarea||!native?.querySelector('textarea'))return;native.hidden=true;native.inert=true;if(workarea.querySelector('[data-excerpt-tools]'))return;const composer=document.createElement('div');composer.style.display='contents';main.append(composer);const terminal=document.createElement('aside');terminal.className='workspace-tools';terminal.dataset.excerptTools='true';terminal.setAttribute('aria-label','Terminal tool');workarea.append(terminal);setHosts({composer,terminal});};scan();const observer=new MutationObserver(scan);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();},[]);
 return <><App/>{hosts&&createPortal(<OwnerComposer/>,hosts.composer)}{hosts&&createPortal(<TerminalBody projectId="capture-project" threadId={target.threadId} terminalId="capture-terminal" active excerptComposer={query.has('unavailable')?undefined:{projectId:'capture-project',threadId:target.threadId,readOnly:query.has('readonly'),addExcerpt:e=>composers.addExcerpt(target,e)}}/>,hosts.terminal)}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
