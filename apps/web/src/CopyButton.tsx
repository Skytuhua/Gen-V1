import {Check,Copy} from 'lucide-react';
import {useLayoutEffect,useRef,useState} from 'react';
import {toast} from '../../../packages/ui-shell/Toast';

export function CopyButton({text,label='Copy'}:{text:string;label?:string}) {
  const [copiedText,setCopiedText]=useState<string|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null), generation=useRef(0);
  const copied=copiedText===text;
  useLayoutEffect(()=>{
    setCopiedText(null);
    return()=>{generation.current++; if(timer.current)clearTimeout(timer.current); timer.current=null;};
  },[text]);
  const copy=async()=>{
    const current=++generation.current;
    setCopiedText(null);
    if(timer.current)clearTimeout(timer.current);
    try{
      await navigator.clipboard.writeText(text);
      if(generation.current!==current)return;
      setCopiedText(text);
      timer.current=setTimeout(()=>{timer.current=null;setCopiedText(null);},1600);
    }catch{
      if(generation.current===current)toast('Copy failed. Select the text and copy manually.',{tone:'error'});
    }
  };
  return <><button type="button" className="icon-button copy-button" aria-label={label} title={copied?'Copied':label} onClick={()=>void copy()}>{copied?<Check size={14} aria-hidden="true"/>:<Copy size={14} aria-hidden="true"/>}</button><span className="sr-only" role="status">{copied?'Copied':''}</span></>;
}
