import {useState} from 'react';
import {Terminal,X} from 'lucide-react';
import {Modal} from '../../../packages/ui-shell/Modal';
import {TERMINAL_EXCERPT_MAX_BYTES,editTerminalExcerpt,type TerminalExcerpt as Excerpt} from './terminal-excerpts';
import './terminal-excerpts.css';
export function TerminalExcerpt({excerpt,disabled=false,onEdit,onRemove}:{excerpt:Excerpt;disabled?:boolean;onEdit:(text:string)=>Promise<void>;onRemove:()=>Promise<void>}){
 const [open,setOpen]=useState(false),[text,setText]=useState(excerpt.text),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function save(){try{editTerminalExcerpt(excerpt,text);setBusy(true);await onEdit(text);setOpen(false);}catch(cause){setError(cause instanceof Error?cause.message:'Excerpt could not be saved. Retry.');}finally{setBusy(false);}}
 return <span className="terminal-excerpt-chip"><button type="button" disabled={disabled} className="quiet" onClick={()=>{setText(excerpt.text);setError('');setOpen(true);}} title={`Project ${excerpt.projectId} · Terminal ${excerpt.terminalId}`}><Terminal size={12}/><span>Terminal selection · {excerpt.terminalId}{excerpt.truncated?' · Truncated':''}</span></button><button type="button" className="quiet" aria-label={`Remove terminal excerpt ${excerpt.terminalId}`} disabled={disabled} onClick={()=>{void onRemove().catch(cause=>setError(cause instanceof Error?cause.message:'Could not remove excerpt.'));}}><X size={12}/></button>
  {error&&!open&&<span role="status">{error}</span>}
  <Modal open={open} title="Review terminal excerpt" onClose={()=>{if(!busy)setOpen(false);}} className="terminal-excerpt-dialog">
   <p className="muted terminal-excerpt-provenance">Project {excerpt.projectId} · Terminal {excerpt.terminalId}<br/>Captured {new Date(excerpt.capturedAt).toLocaleString()}</p>
   {excerpt.truncated&&<p role="status">Truncated to {TERMINAL_EXCERPT_MAX_BYTES} bytes from {excerpt.originalBytes} bytes at capture.</p>}
   <label>Excerpt text<textarea aria-label="Excerpt text" value={text} disabled={busy||disabled} onChange={event=>setText(event.target.value)} rows={10}/></label>
   <details><summary>Original captured output</summary><pre>{excerpt.originalText}</pre></details>
   <p className="muted">Review sensitive output before sending. Nothing is sent until Send.</p>
   {error&&<p role="status">{error}</p>}<div className="terminal-excerpt-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button><button type="button" className="primary" disabled={busy||disabled||!text} onClick={()=>void save()}>Save excerpt</button></div>
  </Modal>
 </span>;
}
