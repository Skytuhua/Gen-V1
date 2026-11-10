import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ComposerToolbar} from '../../apps/web/src/ComposerToolbar';
import {ModelPicker} from '../../apps/web/src/ModelPicker';
import type {ModelInfo} from '../../packages/contracts';
import '../../apps/web/src/styles.css';
const models:ModelInfo[]=[{id:'openai/sol',provider:'openai',name:'GPT-6.1 Sol',thinkingLevels:['low','high','ultra']},{id:'openai/terra',provider:'openai',name:'GPT-6.1 Terra',thinkingLevels:['medium','max']},{id:'claude-code/sonnet',provider:'claude-code',name:'Claude Sonnet'}];
const calls:unknown[]=[];Object.assign(window,{modelComposerCalls:calls});
function Fixture(){
 const [model,setModel]=useState('openai/sol'),[effort,setEffort]=useState('ultra'),[locked,setLocked]=useState(false);
 if(new URLSearchParams(location.search).has('standalone'))return <main style={{height:'100dvh',display:'flex',alignItems:'flex-end',justifyContent:'center',padding:24}}><ModelPicker models={models} modelId={model} onChange={id=>{calls.push(['model',id]);setModel(id);}}/></main>;
 return <main style={{height:'100dvh',display:'flex',alignItems:'flex-end',justifyContent:'center',padding:'20px 12px'}}><button style={{position:'absolute',top:20}} onClick={()=>setLocked(value=>!value)}>Toggle working</button><section className="composer" style={{width:'min(100%,760px)',padding:12}}><textarea aria-label="Fixture draft" defaultValue="Retain my draft" style={{width:'100%'}}/><ComposerToolbar models={models} modelId={model} thinkingLevel={effort} onModelChange={id=>{calls.push(['model',id]);setModel(id);}} onThinkingChange={level=>{calls.push(['effort',level]);setEffort(level);}} onProject={()=>{calls.push(['project']);}} onChanges={()=>{}} onCreatePR={()=>{}} onTranscript={()=>{}} working={locked} separateActions leading={<button type="button" aria-label="Attach files">+</button>} runtime={<span>Local</span>}/></section></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
