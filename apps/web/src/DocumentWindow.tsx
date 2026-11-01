import {useEffect,useId,useLayoutEffect,useRef,useState,type CSSProperties,type PointerEvent} from 'react';
import {createPortal} from 'react-dom';
import {useStateStore} from '@json-render/react';
import {FileText,GripVertical,PanelRightClose,PanelRightOpen,X} from 'lucide-react';
import {getResourceContent} from './api';
import {useWorkspace} from './workspace-context';
import {useSecureArtifact} from './secure-artifact-context';
import {useDocumentEvidence} from './document-evidence';
import {statePath} from './task-context';
import {Markdown} from './Markdown';
import {DetachButton,useDesktop,useDesktopCloseGuard} from './desktop-context';
import {animateTask} from './task-motion';
import './document-window.css';

const MAX_BYTES=256*1024,MAX_CHARS=100_000;
type Draft={text:string;baseHash?:string;baseText?:string;sourceId:string};
function bounded(text:string){if(text.length>MAX_CHARS||new TextEncoder().encode(text).byteLength>MAX_BYTES)throw new Error('This document exceeds the editable preview limit.');if(text.includes('\0'))throw new Error('This file has no text preview.');return text;}
function draftValue(value:unknown):Draft|null{if(!value||typeof value!=='object'||Array.isArray(value))return null;const draft=value as Partial<Draft>;if(typeof draft.sourceId!=='string'||typeof draft.text!=='string'||!(typeof draft.baseHash==='string'&&/^[a-f0-9]{64}$/.test(draft.baseHash)||typeof draft.baseText==='string'))return null;try{bounded(draft.text);if(draft.baseText!==undefined)bounded(draft.baseText);}catch{return null;}return draft as Draft;}
async function readText(response:Response){
 if(!response.ok)throw new Error(`The document could not be read (${response.status}).`);
 if(!/^(?:text\/|application\/(?:json|xml|x-yaml|yaml)(?:;|$))/i.test(response.headers.get('content-type')??''))throw new Error('This file has no editable text preview. Open its source document instead.');
 if(!response.body)throw new Error('The document response is empty.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new Error('This document exceeds the editable preview limit.');}chunks.push(item.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bounded(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

/** A presentation of the owning artifact's text and draft, never a separate editor session. */
export function WindowDocument({props,text}:{props:Record<string,unknown>;text?:string}){
 const workspace=useWorkspace(),scope=useSecureArtifact(),evidence=useDocumentEvidence(),desktop=useDesktop(),store=useStateStore(),localId=useId();
 const id=`${scope?.artifactId??'document'}:${localId}`,title=typeof props.title==='string'?props.title:'Document';
 const nativeOwner=desktop?.context.surface.kind==='artifact'&&desktop.context.surface.artifactId===scope?.artifactId;
 const [localOpen,setLocalOpen]=useState(Boolean(nativeOwner)),[localPlacement,setLocalPlacement]=useState<'docked'|'floating'>('floating');
 const controlled=Boolean(workspace.requestOpenDocument),open=(controlled?workspace.documentWindow?.id===id:localOpen)&&scope?.active!==false&&scope?.editable!==false;
 const placement=controlled?workspace.documentWindow?.placement??'docked':localPlacement;
 const resourceId=typeof props.resourceId==='string'?props.resourceId:undefined,path=typeof props.resourcePath==='string'?props.resourcePath:'';
 const grant=resourceId?evidence?.resources.find(item=>item.id===resourceId&&item.threadId===scope?.threadId):undefined;
 const allowed=!resourceId||Boolean(grant),sourceId=resourceId?JSON.stringify([resourceId,path,grant?.identity??grant?.createdAt]):`binding:${String(props.dataBinding??'text')}`;
 const [loaded,setLoaded]=useState<{id:string;text:string}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[reading,setReading]=useState(false);
 const draftPath=statePath(props.editableStateKey),value=props.editableStateKey?store.get(draftPath):undefined;
 const retainedDraft=draftValue(value),foreignDraft=Boolean(retainedDraft&&retainedDraft.sourceId!==sourceId),draft=retainedDraft?.sourceId===sourceId?retainedDraft:null,source=text!==undefined?text:loaded?.id===sourceId?loaded.text:undefined;
 let sourceError='';try{if(source!==undefined)bounded(source);}catch(cause){sourceError=cause instanceof Error?cause.message:'Document unavailable.';}
 const visibleSource=allowed&&!sourceError?source:undefined,display=draft?.text??visibleSource??'';
 const [fingerprint,setFingerprint]=useState<{text:string;id:string;hash:string}|null>(null),[editError,setEditError]=useState('');
 const sourceHash=fingerprint?.id===sourceId&&fingerprint.text===visibleSource?fingerprint.hash:undefined,changed=Boolean(draft&&sourceHash&&(draft.baseHash?draft.baseHash!==sourceHash:draft.baseText!==visibleSource));
 useEffect(()=>{if(visibleSource===undefined)return;let current=true;void crypto.subtle.digest('SHA-256',new TextEncoder().encode(visibleSource)).then(bytes=>{if(current)setFingerprint({id:sourceId,text:visibleSource,hash:Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')});}).catch(()=>{if(current)setEditError('The document could not be prepared for editing. Reopen it to try again.');});return()=>{current=false;};},[visibleSource,sourceId]);
 const saveDraft=(nextText:string,adopt=false)=>{if(!sourceHash||foreignDraft)return;try{bounded(nextText);const next={text:nextText,baseHash:adopt?sourceHash:draft?.baseHash??(draft?.baseText!==undefined&&draft.baseText!==visibleSource?undefined:sourceHash),...(draft?.baseText!==undefined&&draft.baseText!==visibleSource&&!adopt?{baseText:draft.baseText}:{}),sourceId};const values={...(store.getSnapshot().values as Record<string,unknown>),[String(props.editableStateKey)]:next};if(JSON.stringify(values).length>131072)throw new Error('This edit exceeds the saved draft limit. Shorten it before continuing.');store.set(draftPath,next);setEditError('');}catch(cause){setEditError(cause instanceof Error?cause.message:'The draft could not be saved.');}};
 const windowRef=useRef<HTMLElement>(null),editor=useRef<HTMLTextAreaElement>(null),opener=useRef<HTMLButtonElement>(null),stopDrag=useRef<()=>void>(()=>{}),focused=useRef(false),[position,setPosition]=useState<{x:number;y:number}|null>(null);
 const [portalRoot,setPortalRoot]=useState<Element|null>(null);
 // The owning artifact is stable across expansion and workspace placement.
 // Keeping its window in that DOM branch preserves modal focus and editor identity.
 useLayoutEffect(()=>{setPortalRoot(opener.current?.closest('.artifact')??document.body);},[]);
 const viewKey=`harness:document-view:${scope?.threadId}:${scope?.artifactId}:${String(props.editableStateKey??props.dataBinding??resourceId??'document')}`,restoredView=useRef('');
 const rememberView=()=>{const node=editor.current??windowRef.current?.querySelector<HTMLElement>('.document-window-prose');if(!node)return;try{localStorage.setItem(viewKey,JSON.stringify({sourceId,top:node.scrollTop}));}catch{/* Text drafts do not depend on optional view preferences. */}};
 useDesktopCloseGuard(`document-view:${id}`,async()=>rememberView());
 useLayoutEffect(()=>{if(!open){restoredView.current='';return;}if(visibleSource===undefined||restoredView.current===sourceId)return;const node=editor.current??windowRef.current?.querySelector<HTMLElement>('.document-window-prose');if(!node)return;restoredView.current=sourceId;try{const saved=JSON.parse(localStorage.getItem(viewKey)??'null');if(saved?.sourceId===sourceId&&Number.isFinite(saved.top)&&saved.top>=0&&saved.top<=10_000_000)node.scrollTop=saved.top;}catch{/* A stale layout preference cannot block the document. */}},[open,sourceId,visibleSource,viewKey,portalRoot]);
 const close=()=>{rememberView();stopDrag.current();controlled?workspace.closeDocument?.(id):setLocalOpen(false);opener.current?.focus({preventScroll:true});};
 const place=(next:'docked'|'floating')=>{controlled?workspace.placeDocument?.(id,next):setLocalPlacement(next);};
 useEffect(()=>{if(!open||!resourceId||!allowed)return;const controller=new AbortController();let current=true;setReading(true);setLoaded(null);setError('');const timer=setTimeout(()=>controller.abort(),15_000);
  void getResourceContent(resourceId,path,controller.signal).then(readText).then(body=>{if(current)setLoaded({id:sourceId,text:body});}).catch(cause=>{if(current)setError(cause instanceof Error?cause.message:'The document could not be read.');}).finally(()=>{clearTimeout(timer);if(current)setReading(false);});return()=>{current=false;clearTimeout(timer);controller.abort();};
 },[open,resourceId,path,allowed,sourceId,retry]);
 useEffect(()=>{setError('');setLoaded(null);},[sourceId]);
 useEffect(()=>{if(scope?.active===false||scope?.editable===false)workspace.closeDocument?.(id);},[scope?.active,scope?.editable,id]);
 useEffect(()=>{if(!open){focused.current=false;return;}if(visibleSource!==undefined&&!focused.current){const target=editor.current??windowRef.current?.querySelector<HTMLElement>('button');if(target){focused.current=true;target.focus({preventScroll:true});}}},[open,visibleSource,portalRoot]);
 useEffect(()=>()=>{stopDrag.current();workspace.closeDocument?.(id);},[id]);
 useLayoutEffect(()=>{if(!open||!portalRoot)return;const animation=animateTask(windowRef.current,[{opacity:.4,transform:'translateX(14px) scale(.99)'},{opacity:1,transform:'translateX(0) scale(1)'}],260);return()=>animation?.cancel();},[open,portalRoot]);
 useEffect(()=>{if(!open)return;const resize=()=>setPosition(before=>before?{x:Math.max(8,Math.min(innerWidth-80,before.x)),y:Math.max(8,Math.min(innerHeight-80,before.y))}:before);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[open]);
 const move=(event:PointerEvent<HTMLButtonElement>)=>{
  if(event.button!==0)return;event.preventDefault();stopDrag.current();const box=windowRef.current!.getBoundingClientRect(),origin={x:event.clientX,y:event.clientY},pointerId=event.pointerId;let started=false;
  const update=(next:globalThis.PointerEvent)=>{if(next.pointerId!==pointerId)return;if(!started&&Math.hypot(next.clientX-origin.x,next.clientY-origin.y)<4)return;started=true;place('floating');setPosition({x:Math.max(8,Math.min(innerWidth-80,box.left+next.clientX-origin.x)),y:Math.max(8,Math.min(innerHeight-80,box.top+next.clientY-origin.y))});};
  const finish=()=>{window.removeEventListener('pointermove',update);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);window.removeEventListener('blur',finish);};stopDrag.current=finish;window.addEventListener('pointermove',update);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);window.addEventListener('blur',finish);
 };
 const style:CSSProperties=placement==='floating'&&position?{left:position.x,top:position.y,right:'auto',bottom:'auto'}:{};
 const unavailable=!allowed?'Access to this document is no longer available.':sourceError||error;
 return <section className="document document-window-launcher"><div className="document-heading"><FileText size={16}/>{title}</div><button ref={opener} className="secondary" type="button" onClick={()=>{setPosition(null);controlled?workspace.requestOpenDocument?.(id):setLocalOpen(true);}}>{typeof props.linkLabel==='string'?props.linkLabel:'Open document'}</button>{open&&portalRoot&&createPortal(<section ref={windowRef} role="region" aria-label={`${title} document window`} className="document-text-window" data-escape-scope data-placement={placement} data-native-owner={nativeOwner} style={style} onScrollCapture={rememberView} onKeyDown={event=>{if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.stopPropagation();close();}}}>
  <header><button className="document-window-move" aria-label={`Move ${title}`} onPointerDown={move} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const box=windowRef.current!.getBoundingClientRect();place('floating');setPosition({x:Math.max(8,Math.min(innerWidth-80,box.left+(event.key==='ArrowRight'?12:event.key==='ArrowLeft'?-12:0))),y:Math.max(8,Math.min(innerHeight-80,box.top+(event.key==='ArrowDown'?12:event.key==='ArrowUp'?-12:0)))});}}><GripVertical size={14}/><strong>{title}</strong></button>
   {desktop&&scope&&!nativeOwner&&<DetachButton surface={{kind:'artifact',threadId:scope.threadId,artifactId:scope.artifactId}} label="document" before={async()=>{await desktop.prepareHandoff();}} after={close} onError={cause=>setError(cause.message)}/>}
   <button className="icon-button" aria-label={placement==='docked'?'Float document':'Dock document'} onClick={()=>{setPosition(null);place(placement==='docked'?'floating':'docked');}}>{placement==='docked'?<PanelRightClose size={15}/>:<PanelRightOpen size={15}/>}</button><button className="icon-button document-window-close" aria-label="Close document" onClick={close}><X size={15}/></button></header>
  {unavailable?<div className="document-window-message" role="alert">{unavailable}{allowed&&resourceId&&<button className="secondary" onClick={()=>setRetry(value=>value+1)}>Retry</button>}</div>:visibleSource===undefined?<p className="document-window-message" role="status">{reading?'Reading document…':'Document content is not available.'}</p>:<>{changed&&<div className="document-source-update" role="status"><span>New source available</span><button className="quiet" onClick={()=>saveDraft(visibleSource,true)}>Use updated source</button></div>}{foreignDraft&&<p className="document-window-message" role="status">A draft for another source is retained. Reopen that document to edit it.</p>}{editError&&<p className="document-window-message error-text" role="alert">{editError}</p>}{props.editableStateKey?<textarea ref={editor} className="document-text-editor" aria-label="Document text" value={display} maxLength={MAX_CHARS} readOnly={!sourceHash||foreignDraft} onChange={event=>saveDraft(event.target.value)}/>:<div className="document-window-prose"><Markdown text={visibleSource}/></div>}<footer>{props.editableStateKey?<span role="status">{scope?.saveStatus??'Draft retained locally'}</span>:<span>Prepared document</span>}<span>Editing this draft does not deliver it.</span></footer></>}
 </section>,portalRoot!)}</section>;
}
