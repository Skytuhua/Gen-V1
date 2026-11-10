import {useCallback,useId,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {ArrowDown,ArrowUp,Search,X} from 'lucide-react';
import {conversationRanges,highlightConversation,nextFindIndex,retainFindIndex,type ConversationMatch} from './conversation-find';
import './conversation-find.css';
export interface ConversationFindProps {
 ownerKey:string;
 transcript:RefObject<HTMLElement|null>;
 /** Includes the owner's composer so Ctrl+F never changes another conversation. */
 scope:RefObject<HTMLElement|null>;
 active?:boolean;
 onNavigate?:()=>void;
 onLoadEarlier?:()=>void;
 historyPending?:boolean;
 historyLimited?:boolean;
 historyError?:string|null;
}
/** Reusable by ordinary, canvas and scoped transcript owners. No command/draft authority. */
export function ConversationFind({ownerKey,transcript,scope,active=true,onNavigate,onLoadEarlier,historyPending,historyLimited,historyError}:ConversationFindProps){
 const id=useId(),input=useRef<HTMLInputElement>(null),opener=useRef<HTMLElement|null>(null);
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[count,setCount]=useState(0),[index,setIndex]=useState(-1);
 const matches=useRef<ConversationMatch[]>([]),selected=useRef<string|null>(null),lastQuery=useRef('');
 const navigateRef=useRef(onNavigate);navigateRef.current=onNavigate;
 const jump=useCallback((value:number)=>{
  const match=matches.current[value],root=transcript.current;if(!match||!root)return;
  const rect=match.range.getBoundingClientRect(),bounds=root.getBoundingClientRect();
  root.scrollTop+=rect.top-bounds.top-root.clientHeight/2+rect.height/2;
  selected.current=match.key;setIndex(value);highlightConversation(root.ownerDocument,id,matches.current,value);navigateRef.current?.();
 },[transcript,id]);
 const close=useCallback(()=>{setOpen(false);opener.current?.focus({preventScroll:true});},[]);
 useLayoutEffect(()=>{setOpen(false);setQuery('');selected.current=null;matches.current=[];setCount(0);setIndex(-1);},[ownerKey]);
 useLayoutEffect(()=>{
  const root=scope.current;if(!root||!active)return;
  const key=(event:KeyboardEvent)=>{
   if(event.isComposing||event.keyCode===229)return;
   if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='f'&&root.contains(root.ownerDocument.activeElement)){
    event.preventDefault();if(!open)opener.current=root.ownerDocument.activeElement as HTMLElement;setOpen(true);input.current?.focus();input.current?.select();
   }
  };
  root.ownerDocument.addEventListener('keydown',key);return()=>root.ownerDocument.removeEventListener('keydown',key);
 },[active,open,scope]);
 useLayoutEffect(()=>{if(open)input.current?.focus();},[open]);
 useLayoutEffect(()=>{
  const root=transcript.current;if(!root)return;
  if(!open||!active){highlightConversation(root.ownerDocument,id,[],-1);return;}
  const scan=()=>{
   const found=conversationRanges(root,query),changed=query!==lastQuery.current;
   const next=retainFindIndex(found.map(m=>m.key),changed?null:selected.current);
   matches.current=found;lastQuery.current=query;selected.current=found[next]?.key??null;
   setCount(found.length);setIndex(next);highlightConversation(root.ownerDocument,id,found,next);
   if(changed&&next>=0)jump(next);
  };
  scan();const observer=new MutationObserver(scan);observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-hidden']});
  return()=>{observer.disconnect();highlightConversation(root.ownerDocument,id,[],-1);};
 },[open,active,query,ownerKey,transcript,id,jump]);
 if(!active)return null;
 return <div className="conversation-find-owner">
  {!open?<button type="button" className="quiet conversation-find-trigger" aria-label="Find in conversation" title="Find in conversation (Ctrl+F)" onClick={event=>{opener.current=event.currentTarget;setOpen(true);}}><Search size={14}/></button>:
   <div className="conversation-find" role="search" aria-label="Find in conversation" onKeyDown={event=>{
    if(event.nativeEvent.isComposing||event.keyCode===229)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    if(event.key==='Enter'){event.preventDefault();jump(nextFindIndex(index,event.shiftKey?-1:1,count));}
   }}>
    <div className="conversation-find-row"><Search size={14}/><input ref={input} aria-label="Find phrase" value={query} onChange={event=>setQuery(event.target.value)} autoComplete="off" spellCheck={false}/>
     <span className="conversation-find-count" role="status" aria-live="polite">{query?count?`${index+1} of ${count}`:'0 results':'Find a phrase'}</span>
     <button type="button" className="quiet" aria-label="Previous match" disabled={!count} onClick={()=>jump(nextFindIndex(index,-1,count))}><ArrowUp size={14}/></button>
     <button type="button" className="quiet" aria-label="Next match" disabled={!count} onClick={()=>jump(nextFindIndex(index,1,count))}><ArrowDown size={14}/></button>
     <button type="button" className="quiet" aria-label="Close find" onClick={close}><X size={14}/></button>
    </div>
    <div className="conversation-find-scope"><span>Loaded messages</span>{onLoadEarlier&&<button className="quiet" type="button" disabled={historyPending||historyLimited} onClick={onLoadEarlier}>{historyLimited?'History limit reached':historyPending?'Loading older messages…':'Load older messages'}</button>}</div>
    {historyError&&<p role="alert">{historyError}</p>}
   </div>}
 </div>;
}
