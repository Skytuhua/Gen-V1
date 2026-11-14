import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';

/** Informational shell toast: enters, auto-expires, pauses on hover/focus, exits before unmount. */
export function ShellNotice({message,onDismiss}:{message:string;onDismiss:()=>void}){
 const [leaving,setLeaving]=useState(false);
 const timers=useRef<{expiry?:number;exit?:number}>({}),remaining=useRef(6000),started=useRef(0);
 const dismiss=()=>{if(timers.current.exit!==undefined)return;setLeaving(true);timers.current.exit=window.setTimeout(onDismiss,160);};
 const arm=(ms:number)=>{clearTimeout(timers.current.expiry);started.current=Date.now();timers.current.expiry=window.setTimeout(dismiss,ms);};
 const pause=()=>{if(leaving)return;clearTimeout(timers.current.expiry);remaining.current=Math.max(400,remaining.current-(Date.now()-started.current));};
 useEffect(()=>{
  setLeaving(false);remaining.current=6000;timers.current={};
  if(message)arm(6000);
  return()=>{clearTimeout(timers.current.expiry);clearTimeout(timers.current.exit);};
 },[message]);
 if(!message)return null;
 return <div className="shell-notice" role="status" data-leaving={leaving||undefined} onMouseEnter={pause} onMouseLeave={()=>{if(!leaving)arm(remaining.current);}} onFocusCapture={pause} onBlurCapture={event=>{if(!leaving&&!event.currentTarget.contains(event.relatedTarget as Node))arm(remaining.current);}}><span>{message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={dismiss}><X size={14}/></button></div>;
}
