import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {App} from '../../apps/web/src/App';
import {ComposerView} from '../../apps/web/src/ComposerView';
import {ComposerToolbar} from '../../apps/web/src/ComposerToolbar';
import {ComposerAttachments} from '../../apps/web/src/ComposerAttachments';
import {SavedDrafts} from '../../apps/web/src/SavedDrafts';
import {createSharedAgentComposers} from '../../apps/web/src/agents-workspace/composer';
import type {SavedDraftOwner} from '../../apps/web/src/saved-drafts';
import '@fontsource-variable/inter';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/frontend-fidelity.css';
import './saved-drafts-fixture.css';
const query=new URLSearchParams(location.search),owner:SavedDraftOwner={profileId:query.get('profile')??'fixture-profile',accountId:query.get('account')??'fixture-account',threadId:query.get('thread')??'one',projectId:query.get('project')??'capture-project',workingCopyId:query.get('copy')??'fixture-copy'};
const target={kind:'conversation' as const,threadId:owner.threadId,projectId:owner.projectId!,modelId:'test/model',working:false};
const composers=createSharedAgentComposers({sendParent:async()=>{throw Error('No message is sent by draft actions.');},stopParent:async()=>{}});
function Composer(){const state=useSyncExternalStore(listener=>composers.subscribe(target,listener),()=>composers.getSnapshot(target)),input=useRef<HTMLTextAreaElement>(null);useEffect(()=>{void composers.prepare(target);},[]);
 return <div className="composer-dock" data-saved-composer><ComposerView onSubmit={event=>{event.preventDefault();void composers.submit(target);}}><div className="composer-entry-row"><div className="composer-input"><textarea ref={input} aria-label="Message" placeholder="Ask anything..." value={state.draft} disabled={!state.ready} onChange={event=>void composers.edit(target,event.target.value)}/></div></div><ComposerAttachments resources={[]} excerpts={state.excerpts} onEditExcerpt={(id,text)=>composers.editExcerpt(target,id,text)} onRemoveExcerpt={id=>composers.removeExcerpt(target,id)}/><ComposerToolbar models={[{id:'test/model',provider:'test',name:'Audit model'}]} modelId="test/model" thinkingLevel="" onThinkingChange={()=>{}} onModelChange={()=>{}} onProject={()=>{}} onChanges={()=>{}} onCreatePR={()=>{}} onTranscript={()=>{}} leading={<SavedDrafts owner={owner} input={input} disabled={!state.ready||state.busy||state.retry}/>} runtime={<span>Local</span>} separateActions/>{state.error&&<p role="alert">{state.error}</p>}</ComposerView></div>;
}
function Fixture(){const [host,setHost]=useState<HTMLElement|null>(null);useEffect(()=>{const scan=()=>{const main=document.querySelector<HTMLElement>('main.workspace'),native=main?.querySelector<HTMLElement>('.composer-dock:not([data-saved-composer])');if(!main||!native?.querySelector('textarea'))return;native.hidden=true;native.inert=true;if(main.querySelector('[data-saved-host]'))return;const mount=document.createElement('div');mount.style.display='contents';mount.dataset.savedHost='true';main.append(mount);setHost(mount);};scan();const observer=new MutationObserver(scan);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();},[]);return <><App/>{host&&createPortal(<Composer/>,host)}</>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
