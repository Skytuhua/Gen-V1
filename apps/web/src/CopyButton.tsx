import {Check,Copy} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {toast} from '../../../packages/ui-shell/Toast';

export function CopyButton({text,label='Copy'}:{text:string;label?:string}) {
  const [copied,setCopied]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  const copy=async()=>{
    try{
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if(timer.current)clearTimeout(timer.current);
      timer.current=setTimeout(()=>setCopied(false),1600);
    }catch{
      toast('Copy failed. Select the text and copy manually.',{tone:'error'});
    }
  };
  return <button type="button" className="icon-button copy-button" aria-label={copied?'Copied':label} title={copied?'Copied':label} onClick={()=>void copy()}>{copied?<Check size={14}/>:<Copy size={14}/>}</button>;
}
