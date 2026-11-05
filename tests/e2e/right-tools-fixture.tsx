import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FloatingWindow} from '../../apps/web/src/FloatingWindow';
import {FloatingRail} from '../../apps/web/src/FloatingRail';
import {UsageFooter} from '../../apps/web/src/UsageFooter';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';

const params=new URLSearchParams(location.search),mode=params.get('mode')??'context';
const events={detached:0,closed:0};Object.assign(window,{rightToolEvents:events});
function Fixture(){
 const[visible,setVisible]=useState(true);
 const usage=params.has('unknown')?undefined:{activity:'idle' as const,inputTokens:12640,outputTokens:820,contextTokens:35000,contextWindow:200000,cost:.0123,sessionPercent:25,weeklyPercent:55};
 const tool=<FloatingWindow id="right-context" title="Project context" minimizeOnly={mode!=='generic'} resetPosition onClose={()=>events.closed++} onDetach={()=>{events.detached++;}} defaultSize={{width:340,height:260}}><label>Context draft<textarea defaultValue="Keep context edits"/></label></FloatingWindow>;
 return <div className="app-shell" style={{display:'flex',height:'100dvh',width:'100vw'}}><aside style={{width:220,flexShrink:0}}>Navigation</aside><main className="shell-workarea" style={{position:'relative',display:'block',padding:0}}><header className="workspace-header" style={{height:56}}>Conversation</header><button onClick={()=>setVisible(value=>!value)}>Toggle usage preference</button>{mode==='generic'?tool:<FloatingRail plan={mode==='context'?tool:null} usage={mode==='usage'?<UsageFooter usage={usage} visible={visible} threadId="usage-thread"/>:null}/>}</main></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
