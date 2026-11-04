import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ContextInspector} from '../../apps/web/src/ContextInspector';
import {EMPTY_USAGE,type Thread} from '../../packages/contracts';
import '../../apps/web/src/styles.css';

function Fixture(){
 const [open,setOpen]=useState(false),anchor=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const unsupported=new URLSearchParams(location.search).has('unavailable');
 const thread={id:'owning-thread',title:'Context fixture',status:'ready',modelId:unsupported?'gemini-cli/pro':'openai/gpt-6.1-sol',sessionPath:unsupported?'/fixture/official/gemini-cli/tasks/owning-thread/session.json':'/fixture/pi/tasks/owning-thread/sessions/session.jsonl',runId:null} as Thread;
 const usage={...EMPTY_USAGE,contextTokens:8000,contextWindow:272000,inputTokens:7900,outputTokens:100,sessionPercent:null,weeklyPercent:62,cost:null};
 useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!anchor.current?.contains(event.target as Node))setOpen(false);};const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};},[open]);
 return <main style={{height:'100vh',padding:20}}><button>Outside action</button><div ref={anchor} className="context-anchor" style={{position:'absolute',right:20,bottom:30}}><button ref={trigger} aria-label="Inspect context usage" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>Context</button>{open&&<ContextInspector usage={usage} thread={thread} close={()=>setOpen(false)} refresh={async()=>{}}/>}</div></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
