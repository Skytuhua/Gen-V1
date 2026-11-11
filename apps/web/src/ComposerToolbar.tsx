import {useLayoutEffect,useRef,useState,type ReactNode,type Ref} from 'react';
import type {ModelInfo} from '../../../packages/contracts';
import {ModelPicker,type ModelPickerHandle} from './ModelPicker';
import './composer-toolbar.css';
export interface ComposerToolbarProps {
 modelPickerRef?:Ref<ModelPickerHandle>;
 models:ModelInfo[];modelId:string;onModelChange:(id:string)=>void;
 thinkingLevel:string;onThinkingChange:(level:string)=>void;
 projectLabel?:string;changeSummary?:{added:number;removed:number};
 onProject:()=>void|Promise<void>;onChanges:()=>void|Promise<void>;onCreatePR:()=>void|Promise<void>;
 onTranscript:(text:string)=>void;disabled?:boolean;working?:boolean;
 separateActions?:boolean;leading?:ReactNode;runtime?:ReactNode;context?:ReactNode;trailing?:ReactNode;
}
interface VoiceResult {isFinal:boolean;length:number;[index:number]:{transcript:string}}
interface VoiceEvent {resultIndex:number;results:ArrayLike<VoiceResult>}
interface VoiceRecognition {
 continuous:boolean;interimResults:boolean;lang:string;
 onresult:((event:VoiceEvent)=>void)|null;onend:(()=>void)|null;
 onerror:((event:{error?:string})=>void)|null;onstart:(()=>void)|null;
 start:()=>void;stop:()=>void;abort:()=>void;
}
type VoiceConstructor=new()=>VoiceRecognition;
function voiceConstructor():VoiceConstructor|undefined {
 const browser=window as unknown as {SpeechRecognition?:VoiceConstructor;webkitSpeechRecognition?:VoiceConstructor};
 return browser.SpeechRecognition??browser.webkitSpeechRecognition;
}
function Glyph({children}:{children:ReactNode}){return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;}
const folder=<Glyph><path d="M2.5 6.2V4.5h5l1.5 2h8.5v9h-15z"/></Glyph>;
const branch=<Glyph><circle cx="6" cy="4" r="1.7"/><circle cx="14" cy="5" r="1.7"/><circle cx="6" cy="16" r="1.7"/><path d="M6 5.8v8.4M14 6.8v1.6c0 3-8 1.2-8 4.3"/></Glyph>;
const changes=<Glyph><path d="M5 3.5h7l3 3v10H5zM12 3.5v3h3M7.5 10h5M7.5 13h3"/></Glyph>;
const microphone=<Glyph><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9a5.5 5.5 0 0 0 11 0M10 14.5v3M7.5 17.5h5"/></Glyph>;
const close=<Glyph><path d="m5 5 10 10M15 5 5 15"/></Glyph>;
const validCounts=(value:ComposerToolbarProps['changeSummary'])=>value&&Number.isSafeInteger(value.added)&&value.added>=0&&Number.isSafeInteger(value.removed)&&value.removed>=0?value:undefined;

export function ComposerTaskActions({changeSummary,onChanges,onCreatePR,disabled=false,working=false}:Pick<ComposerToolbarProps,'changeSummary'|'onChanges'|'onCreatePR'|'disabled'|'working'>){
 const [error,setError]=useState(''),counts=validCounts(changeSummary);
 async function invoke(action:()=>void|Promise<void>){setError('');try{await action();}catch(reason){setError(reason instanceof Error?reason.message:'The action could not finish. Try again.');}}
 return <div className="composer-secondary-actions" role="group" aria-label="Task actions">
  <button type="button" className="composer-context-chip composer-changes" aria-label="Inspect changes" title="Inspect recorded changes" disabled={disabled} onClick={()=>void invoke(onChanges)}>{changes}{counts?<span className="composer-change-counts"><span>+{counts.added}</span><span>−{counts.removed}</span></span>:<span>Changes</span>}</button>
  <button type="button" className="composer-context-chip composer-pr" aria-label="Create PR" title={working?'Wait for the active run to finish':'Ask the agent to prepare a pull request'} disabled={disabled||working} onClick={()=>void invoke(onCreatePR)}>{branch}<span>Create PR</span></button>
  {error&&<div className="composer-toolbar-error" role="alert">{error}<button type="button" className="composer-dismiss" aria-label="Dismiss task action error" onClick={()=>setError('')}>{close}</button></div>}
 </div>;
}

export function ComposerToolbar({modelPickerRef,models,modelId,onModelChange,thinkingLevel,onThinkingChange,projectLabel,changeSummary,onProject,onChanges,onCreatePR,onTranscript,disabled=false,working=false,separateActions=false,leading,runtime,context,trailing}:ComposerToolbarProps){
 const [listening,setListening]=useState(false),[error,setError]=useState('');
 const session=useRef<{recognition:VoiceRecognition;epoch:number;seen:Set<number>}|null>(null),epoch=useRef(0),transcript=useRef(onTranscript);
 transcript.current=onTranscript;
 const Voice=voiceConstructor(),locked=disabled||working;
 function revoke(){const previous=session.current;session.current=null;epoch.current++;previous?.recognition.abort();}
 useLayoutEffect(()=>()=>{revoke();},[]);
 useLayoutEffect(()=>{if(locked){revoke();setListening(false);}},[locked]);
 function startVoice(){
  if(locked||!Voice)return;
  if(session.current){session.current.recognition.stop();return;}
  setError('');const recognition=new Voice(),current={recognition,epoch:++epoch.current,seen:new Set<number>()};session.current=current;
  const owns=()=>session.current===current&&epoch.current===current.epoch;
  recognition.continuous=false;recognition.interimResults=false;recognition.lang=navigator.language;
  recognition.onstart=()=>{if(owns())setListening(true);};
  recognition.onresult=event=>{
   if(!owns())return;
   for(let index=event.resultIndex;index<event.results.length;index++){
    const result=event.results[index];if(!result?.isFinal||current.seen.has(index))continue;
    current.seen.add(index);const text=result[0]?.transcript.trim();if(text)transcript.current(text);
   }
  };
  recognition.onerror=event=>{if(!owns())return;setError(event.error==='not-allowed'?'Allow microphone access to use voice input.':event.error==='no-speech'?'No speech detected. Try again.':'Voice input stopped. Try again.');};
  recognition.onend=()=>{if(owns()){session.current=null;setListening(false);}};
  try{recognition.start();setListening(true);}catch{revoke();setListening(false);setError('Voice input could not start. Try again.');}
 }
 async function invoke(action:()=>void|Promise<void>){setError('');try{await action();}catch(reason){setError(reason instanceof Error?reason.message:'The action could not finish. Try again.');}}
 return <div className="composer-toolbar" data-separated-actions={separateActions}>
  {!separateActions&&<ComposerTaskActions changeSummary={changeSummary} onChanges={onChanges} onCreatePR={onCreatePR} disabled={disabled} working={working}/>}
  <div className="composer-footer-main">
   <div className="composer-project-controls" role="group" aria-label="Project and runtime">
    {leading}<button type="button" className="composer-tool composer-project" aria-label="Select project" title={projectLabel?'Select project · '+projectLabel:'Select project'} disabled={disabled} onClick={()=>void invoke(onProject)}>{folder}<span>{projectLabel??'Select project'}</span></button>{runtime}
   </div>
   <div className="composer-runtime-controls" role="group" aria-label="Model and voice">
    <ModelPicker ref={modelPickerRef} models={models} modelId={modelId} thinkingLevel={thinkingLevel} onThinkingChange={onThinkingChange} disabled={locked} onChange={onModelChange}/>
    {context}<button type="button" className={`composer-tool composer-voice ${listening?'is-listening':''}`} aria-label={!Voice?'Voice input unavailable':listening?'Stop voice input':'Start voice input'} aria-pressed={listening} title={!Voice?'Voice input is unavailable in this browser':listening?'Stop listening':'Dictate into your draft'} disabled={locked||!Voice} onClick={startVoice}>{microphone}<span className="sr-only">{listening?'Listening':''}</span></button>{trailing}
   </div>
  </div>
  {error&&<div className="composer-toolbar-error" role="alert">{error}<button type="button" className="composer-dismiss" aria-label="Dismiss composer error" onClick={()=>setError('')}>{close}</button></div>}
 </div>;
}
