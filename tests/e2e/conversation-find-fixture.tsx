import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {App} from '../../apps/web/src/App';
import {ConversationFind} from '../../apps/web/src/ConversationFind';
import {ConversationPane} from '../../apps/web/src/conversation-workspace/ConversationPane';
import {useScopedConversation} from '../../apps/web/src/conversation-workspace/useScopedConversation';
import '@fontsource-variable/inter';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/frontend-fidelity.css';
function Main(){
 const transcript=useRef<HTMLElement>(null),scope=useRef<HTMLElement>(null),[host,setHost]=useState<HTMLElement|null>(null),[owner,setOwner]=useState('one'),[earlier,setEarlier]=useState(false);
 useEffect(()=>{
  const scan=()=>{const root=document.querySelector<HTMLElement>('.conversation-scroll'),main=root?.closest('main');if(!root||!main)return;transcript.current=root;scope.current=main;
   if(!main.querySelector('[data-find-fixture]')){const mount=document.createElement('div');mount.dataset.findFixture='true';main.insertBefore(mount,main.querySelector('.conversation-frame'));setHost(mount);}
   setEarlier(Boolean(root.querySelector('.load-history')));const selected=document.querySelector('.thread-item[aria-current]')?.textContent;if(selected)setOwner(selected);
  };
  scan();const observer=new MutationObserver(scan);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();
 },[]);
 return <><App/>{host&&createPortal(<ConversationFind ownerKey={owner} transcript={transcript} scope={scope} onLoadEarlier={earlier?()=>transcript.current?.querySelector<HTMLButtonElement>('.load-history')?.click():undefined}/>,host)}</>;
}
function Scoped(){const conversation=useScopedConversation({target:{authority:'personal',threadId:'exact-owner'},navigationKey:'fixture'});return <ConversationPane conversation={conversation} renderComposer={()=><textarea aria-label="Message" defaultValue="Scoped draft"/>}/>;}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('scoped')?<Scoped/>:<Main/>);
