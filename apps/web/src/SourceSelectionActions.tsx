import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {Popover} from '../../../packages/ui-shell/Popover';
import '../../../packages/ui-shell/controls.css';
import './source-workbench.css';
export interface VisibleSourceSelection {start:number;end:number;text:string}
export type SourceSelectionAction = 'ask'|'attach'|'open';
/** Offsets are JavaScript UTF-16 code units in canonical source, not DOM offsets.
 * Ambiguous or transformed text is refused instead of inventing a citation. */
export function mapSelectedText(content:string,selected:string):VisibleSourceSelection|null {
  if(!selected.trim())return null;
  const start=content.indexOf(selected);
  if(start<0||content.indexOf(selected,start+1)!==-1)return null;
  return {start,end:start+selected.length,text:selected};
}
function elementOf(node:Node):Element|null{return node instanceof Element?node:node.parentElement;}
function visible(range:Range,root:HTMLElement):boolean {
  const rects=[...range.getClientRects()].filter(rect=>rect.width>0&&rect.height>0);
  if(!rects.length)return false;
  for(const rect of rects) {
    if(rect.top<0||rect.left<0||rect.bottom>innerHeight||rect.right>innerWidth)return false;
    for(const endpoint of [range.startContainer,range.endContainer]) {
      for(let element=elementOf(endpoint);element;element=element.parentElement) {
        const style=getComputedStyle(element),bounds=element.getBoundingClientRect();
        if(element.matches('[hidden],[inert],[aria-hidden="true"],iframe,input,textarea,button,a,[contenteditable="true"]')||style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0||style.contentVisibility==='hidden')return false;
        if(/hidden|clip|auto|scroll/.test(style.overflowX)&& (rect.left<bounds.left-1||rect.right>bounds.right+1))return false;
        if(/hidden|clip|auto|scroll/.test(style.overflowY)&& (rect.top<bounds.top-1||rect.bottom>bounds.bottom+1))return false;
      }
    }
  }
  // A range crossing a hidden descendant must not acquire its unpainted bytes.
  for(const node of root.querySelectorAll('*'))if(range.intersectsNode(node)) {
    const style=getComputedStyle(node);
    if(node.matches('[hidden],[inert],[aria-hidden="true"],iframe,input,textarea,button,a,[contenteditable="true"]')||style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0||style.contentVisibility==='hidden')return false;
    // A selected interior descendant can clip bytes even though neither range
    // endpoint is inside it. Check only this descendant's selected portion.
    const inside=range.cloneRange(),bounds=node.getBoundingClientRect();
    if(!node.contains(range.startContainer))inside.setStart(node,0);
    if(!node.contains(range.endContainer))inside.setEnd(node,node.childNodes.length);
    for(const rect of inside.getClientRects()){
      if(/hidden|clip|auto|scroll/.test(style.overflowX)&&(rect.left<bounds.left-1||rect.right>bounds.right+1))return false;
      if(/hidden|clip|auto|scroll/.test(style.overflowY)&&(rect.top<bounds.top-1||rect.bottom>bounds.bottom+1))return false;
    }
  }
  return true;
}
interface Candidate extends VisibleSourceSelection {range:Range;rendered:string}
export function SourceSelectionActions({children,text,enabled,onAction,onOpenCanonical}:{text:string;enabled:boolean;onAction:(action:SourceSelectionAction,selection:VisibleSourceSelection)=>void|Promise<void>;onOpenCanonical?:()=>void|Promise<void>;children:ReactNode}) {
  const root=useRef<HTMLDivElement>(null),toolbar=useRef<HTMLDivElement>(null),authored=useRef(''),latest=useRef({text,enabled,onAction,onOpenCanonical});
  latest.current={text,enabled,onAction,onOpenCanonical};
  const [candidate,setCandidate]=useState<Candidate|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [exactRendering,setExactRendering]=useState(true);
  const candidateRef=useRef(candidate);candidateRef.current=candidate;
  const revision=useRef(0),composing=useRef(false);
  useLayoutEffect(()=>{authored.current=root.current?.textContent??'';setExactRendering(authored.current===text);revision.current++;setCandidate(null);setError('');setBusy(false);},[text,enabled]);
  useEffect(()=>{
    if(!enabled)return;
    const read=()=>{
      if(composing.current||toolbar.current?.contains(document.activeElement))return;
      const selection=getSelection(),element=root.current;
      if(!element||!selection||selection.rangeCount!==1||selection.isCollapsed){setCandidate(null);return;}
      const range=selection.getRangeAt(0);
      if(authored.current!==latest.current.text||!element.contains(range.startContainer)||!element.contains(range.endContainer)||element.textContent!==authored.current||!visible(range,element)){setCandidate(null);return;}
      const focused=document.activeElement;
      if(focused&&focused!==document.body&&!element.contains(focused)&&!element.parentElement?.contains(focused)){setCandidate(null);return;}
      const mapped=mapSelectedText(latest.current.text,selection.toString());
      if(!mapped){setCandidate(null);return;}
      setCandidate({...mapped,range:range.cloneRange(),rendered:authored.current});setError('');
    };
    const key=(event:KeyboardEvent)=>{
      if(event.isComposing||event.keyCode===229||composing.current)return;
      if(candidateRef.current&&document.activeElement!==document.body&&!root.current?.contains(document.activeElement)&&!toolbar.current?.contains(document.activeElement)){setCandidate(null);return;}
      if(event.key==='Escape'&&candidateRef.current){event.preventDefault();event.stopPropagation();setCandidate(null);getSelection()?.removeAllRanges();root.current?.focus({preventScroll:true});}
      if(event.key==='F10'&&event.shiftKey&&candidateRef.current){event.preventDefault();toolbar.current?.querySelector<HTMLButtonElement>('button')?.focus();}
    };
    const start=()=>{composing.current=true;setCandidate(null);},end=()=>{composing.current=false;};
    const dismiss=()=>setCandidate(null);
    const scroll=(event:Event)=>{if(!(event.target instanceof Node)||!toolbar.current?.contains(event.target))dismiss();};
    const focus=(event:FocusEvent)=>{if(!root.current?.contains(event.target as Node)&&!toolbar.current?.contains(event.target as Node))dismiss();};
    document.addEventListener('selectionchange',read);document.addEventListener('pointerup',read);document.addEventListener('keyup',read);
    document.addEventListener('keydown',key,true);document.addEventListener('compositionstart',start);document.addEventListener('compositionend',end);
    document.addEventListener('focusin',focus);
    window.addEventListener('resize',dismiss);window.addEventListener('scroll',scroll,true);
    return()=>{revision.current++;document.removeEventListener('selectionchange',read);document.removeEventListener('pointerup',read);document.removeEventListener('keyup',read);document.removeEventListener('keydown',key,true);document.removeEventListener('compositionstart',start);document.removeEventListener('compositionend',end);document.removeEventListener('focusin',focus);window.removeEventListener('resize',dismiss);window.removeEventListener('scroll',scroll,true);};
  },[enabled]);
  async function act(action:SourceSelectionAction){
    const value=candidateRef.current,element=root.current,version=revision.current;
    if(!value||!element||busy||!latest.current.enabled||authored.current!==latest.current.text||element.textContent!==value.rendered||!visible(value.range,element))return;
    const {startContainer,startOffset,endContainer,endOffset}=value.range;
    const sameRange=(range:Range)=>range.startContainer===startContainer&&range.startOffset===startOffset&&range.endContainer===endContainer&&range.endOffset===endOffset;
    setBusy(true);setError('');
    try{
      await latest.current.onAction(action,{start:value.start,end:value.end,text:value.text});
      if(version===revision.current){
        const selection=getSelection();
        if(selection?.rangeCount===1&&sameRange(selection.getRangeAt(0)))selection.removeAllRanges();
        setCandidate(current=>current&&sameRange(current.range)?null:current);
      }
    }
    catch(cause){if(version===revision.current)setError(cause instanceof Error?cause.message:'Source could not be captured.');}
    finally{if(version===revision.current)setBusy(false);}
  }
  return <div className="source-selection" data-escape-scope={candidate?'source-selection':undefined}><div ref={root} tabIndex={enabled?0:undefined} className="source-selection-text">{children}</div>
    {enabled&&!exactRendering&&<p className="muted" role="status">Inline selection is unavailable for this formatted message. {onOpenCanonical?<button type="button" disabled={busy} onClick={()=>{const version=revision.current;setBusy(true);void Promise.resolve().then(()=>latest.current.onOpenCanonical?.()).catch(cause=>{if(version===revision.current)setError(cause instanceof Error?cause.message:'Canonical source is unavailable.');}).finally(()=>{if(version===revision.current)setBusy(false);});}}>Select canonical source</button>:'Open Sources to select the canonical message text.'}{error&&<span role="alert">{error}</span>}</p>}
    {candidate&&enabled&&<Popover anchor={root} getAnchorRect={()=>candidate.range.getBoundingClientRect()} contentRef={toolbar} open width={430} height={error?96:52} preferredSide="above" align="start" onDismiss={()=>setCandidate(null)} role="toolbar" aria-label="Selected source" tabIndex={-1} className="ui-control-popup source-selection-toolbar" onPointerDown={event=>event.preventDefault()}>
      <button type="button" disabled={busy} onClick={()=>void act('ask')}>Ask about this</button><button type="button" disabled={busy} onClick={()=>void act('attach')}>Attach to prompt</button><button type="button" disabled={busy} onClick={()=>void act('open')}>Open source</button>
      {error&&<span role="alert">{error}</span>}
    </Popover>}
  </div>;
}
