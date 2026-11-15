import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';

/** Informational shell toast: enters, auto-expires, pauses on hover/focus, exits before unmount. */
export function ShellNotice({message,onDismiss}:{message:string;onDismiss:()=>void}){
 const [leaving,setLeaving]=useState(false);
 const timers=useRef<{expiry?:number;exit?:number}>({}),remaining=useRef(6000),started=useRef(0);
 const held=useRef({hover:false,focus:false});
 const dismiss=()=>{if(timers.current.exit!==undefined)return;clearTimeout(timers.current.expiry);timers.current.expiry=undefined;setLeaving(true);timers.current.exit=window.setTimeout(onDismiss,160);};
 const arm=(ms:number)=>{clearTimeout(timers.current.expiry);started.current=Date.now();timers.current.expiry=window.setTimeout(dismiss,ms);};
 const hold=(kind:'hover'|'focus',value:boolean)=>{
  if(held.current[kind]===value)return;
  held.current[kind]=value;
  if(timers.current.exit!==undefined)return;
  if(held.current.hover||held.current.focus){
   if(timers.current.expiry===undefined)return;
   clearTimeout(timers.current.expiry);timers.current.expiry=undefined;
   remaining.current=Math.max(400,remaining.current-(Date.now()-started.current));
  }else arm(remaining.current);
 };
 useEffect(()=>{
  setLeaving(false);remaining.current=6000;timers.current={};
  if(message){if(!held.current.hover&&!held.current.focus)arm(6000);}
  else held.current={hover:false,focus:false};
  return()=>{clearTimeout(timers.current.expiry);clearTimeout(timers.current.exit);};
 },[message]);
 if(!message)return null;
 return <div className="shell-notice" role="status" data-leaving={leaving||undefined} onMouseEnter={()=>hold('hover',true)} onMouseLeave={()=>hold('hover',false)} onFocusCapture={()=>hold('focus',true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))hold('focus',false);}}><span>{message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={dismiss}><X size={14}/></button></div>;
}
