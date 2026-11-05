import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FloatingWindow} from '../../apps/web/src/FloatingWindow';
import {FloatingRail} from '../../apps/web/src/FloatingRail';
import {clampFloatingLayout,type FloatingLayout} from '../../apps/web/src/floating-layout';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';

const events:string[]=[];
Object.assign(window,{floatingEvents:events});
const recovered:FloatingLayout={x:430,y:160,width:380,height:320,collapsed:false,floating:true};
const storage=new URLSearchParams(location.search).has('adapter')?{
 read:(_id:string,_initial:FloatingLayout,area:Parameters<typeof clampFloatingLayout>[1],minimum:Parameters<typeof clampFloatingLayout>[2])=>{events.push('read');return clampFloatingLayout(recovered,area,minimum);},
 write:(_id:string,value:FloatingLayout)=>{events.push(`write:${value.x}:${value.y}`);},
}:undefined;
function Fixture(){
 const[open,setOpen]=useState(true);
 return <div className="app-shell" style={{display:'flex',height:'100dvh',width:'100vw'}}>
  <aside style={{width:220,flexShrink:0}}>Navigation</aside>
  <main className="shell-workarea" style={{display:'block',position:'relative',padding:0}}>
   <header className="workspace-header" style={{height:56}}>Conversation</header>
   <button onClick={()=>setOpen(true)}>Open test tool</button>
   <FloatingRail plan={<FloatingWindow id="free-test" title="Test tool" open={open} onClose={()=>setOpen(false)} resetPosition defaultSize={{width:380,height:320}} sizing={new URLSearchParams(location.search).has('content')?'content':'manual'} storage={storage}>
    <label>Tool draft<textarea defaultValue="Keep my draft"/></label>
    {Array.from({length:40},(_,index)=><p key={index}>Readable tool content {index+1}</p>)}
   </FloatingWindow>} usage={null}/>
  </main>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
