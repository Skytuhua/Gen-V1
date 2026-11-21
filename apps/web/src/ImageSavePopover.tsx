import {useId,useRef,useState,type RefObject,type FormEvent} from 'react';
import {Popover} from '../../../packages/ui-shell/Popover';
import {Check} from 'lucide-react';
import {command,ApiError} from './api';

// Slug for the default save path (DESIGN F5): a-z0-9-, at most 40 chars.
export function imageSaveSlug(prompt:string):string{
 const slug=prompt.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40).replace(/-+$/,'');
 return slug||'image';
}
export function defaultImageSavePath(prompt:string,extension:string='png'):string{
 return `assets/generated/${imageSaveSlug(prompt)}.${extension}`;
}

export interface ImageSavePopoverProps{
 /** Anchor element ref for the popover (the "Save to project" button). */
 anchor:RefObject<HTMLElement|null>;
 open:boolean;
 threadId:string;
 /** Attachment grant id of the image being saved. */
 imageId:string;
 /** Prompt used to prefill the suggested path. */
 prompt?:string;
 /** Detected image format extension (png|jpg|webp). */
 extension?:string;
 /** Writable project grant label shown under the field. */
 projectName?:string;
 /** Generated-images card to update (optional until T05 lands). */
 artifactId?:string;
 onSaved?:(result:{path:string;sha256:string})=>void;
 onClose:()=>void;
}
interface SaveReceipt{result?:{path:string;sha256:string}}

export function ImageSavePopover({anchor,open,threadId,imageId,prompt='',extension='png',projectName,artifactId,onSaved,onClose}:ImageSavePopoverProps){
 const id=useId(),content=useRef<HTMLDivElement>(null);
 const [path,setPath]=useState(()=>defaultImageSavePath(prompt,extension));
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState<string|null>(null),[saved,setSaved]=useState<string|null>(null);
 const save=async(extra:{expectedSha256?:string;saveAsCopy?:boolean}={})=>{
  setBusy(true);setError('');
  try{
   const receipt=await command('image.save',{imageId,path:path.trim(),...(artifactId?{artifactId}:{}) ,...extra},threadId) as unknown as SaveReceipt;
   const result=receipt.result;if(!result)throw new Error('No save result');
   setSaved(result.path);setConflict(null);onSaved?.(result);
  }catch(cause){
   if(cause instanceof ApiError&&cause.code==='PATH_CONFLICT'){
    const sha=(cause.details as {sha256?:string}|undefined)?.sha256;setConflict(sha??null);
   }else setError(cause instanceof Error?cause.message:String(cause));
  }finally{setBusy(false);}
 };
 const submit=(event:FormEvent)=>{event.preventDefault();if(!busy&&!saved)void save();};
 const danger={background:'var(--danger,#c33)',color:'#fff',border:'none'} as const;
 return <Popover anchor={anchor} contentRef={content} open={open} width={360} height={conflict?208:150} preferredSide="above" align="end" onDismiss={onClose} className="image-save-popover">
  <form className="image-save-form" onSubmit={submit}>
   <label className="field" htmlFor={id}>Save as
    <input id={id} autoFocus required value={path} onChange={event=>{setPath(event.target.value);setConflict(null);setError('');}} aria-describedby={`${id}-hint${conflict!==null||error?` ${id}-error`:''}`} disabled={busy||saved!==null}/>
   </label>
   {projectName&&<p id={`${id}-hint`} className="muted">Into {projectName}</p>}
   {conflict!==null&&<p id={`${id}-error`} role="alert" className="error-text">A file already exists at this path</p>}
   {conflict===null&&error&&<p id={`${id}-error`} role="alert" className="error-text">{error}</p>}
   <footer className="dialog-actions">
    {conflict===null
     ?<button className="primary" disabled={busy||saved!==null||!path.trim()}>{saved?'Saved':busy?'Saving…':'Save'}</button>
     :<>
       <button type="button" className="quiet" style={danger} disabled={busy} onClick={()=>void save({expectedSha256:conflict})}>Replace</button>
       <button type="button" className="primary" disabled={busy} onClick={()=>void save({saveAsCopy:true})}>Save as copy</button>
      </>}
   </footer>
   {saved&&<p className="muted"><Check size={14} aria-hidden/> Saved to {saved}</p>}
  </form>
 </Popover>;
}
