import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,MoreHorizontal,Save} from 'lucide-react';
import {Popover} from '../../../packages/ui-shell/Popover';
import {ActionMenu} from '../../../packages/ui-shell/ActionMenu';
import {Modal} from '../../../packages/ui-shell/Modal';
import {isComposing,useListNavigation} from '../../../packages/ui-shell/list-navigation';
import './saved-layout-chooser.css';

export interface SavedLayoutRow {id:string;name:string;source:'split'|'recovery'|'canvas';updatedAt?:string;canRename?:boolean;canUpdate?:boolean;canDelete?:boolean}
export interface SavedLayoutSelection {key:string;arrangement:string;version?:string}
export interface SavedLayoutChooserProps {
 rows:SavedLayoutRow[];arrangement:string|null;loading?:boolean;error?:string;disabled?:boolean;
 onRetry?:()=>Promise<unknown>;onOpen?:()=>void;onOpenChange?:(open:boolean)=>void;onBusyChange?:(busy:boolean)=>void;
 onSave?: (name:string)=>Promise<SavedLayoutSelection|void>;
 onApply:(row:SavedLayoutRow)=>Promise<SavedLayoutSelection|void>;
 onUpdate?: (row:SavedLayoutRow)=>Promise<SavedLayoutSelection|void>;
 onRename?: (row:SavedLayoutRow,name:string)=>Promise<void>;
 onDelete:(row:SavedLayoutRow)=>Promise<void>;
}
const keyOf=(row:SavedLayoutRow)=>row.source+':'+row.id;
type Entry={type:'save'}|{type:'rename'|'delete';row:SavedLayoutRow};

export function SavedLayoutChooser({rows,arrangement,loading=false,error='',disabled,onRetry,onOpen,onOpenChange,onBusyChange,onSave,onApply,onUpdate,onRename,onDelete}:SavedLayoutChooserProps){
 const [open,setOpen]=useState(false),[overflow,setOverflow]=useState<string|null>(null),[entry,setEntry]=useState<Entry|null>(null),[name,setName]=useState(''),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[selection,setSelection]=useState<SavedLayoutSelection|null>(null);
 const anchor=useRef<HTMLButtonElement>(null),content=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),pending=useRef(false),alive=useRef(true),id=useId();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{onOpenChange?.(open&&!disabled);return()=>onOpenChange?.(false);},[open,disabled,onOpenChange]);
 useEffect(()=>{if(entry&&entry.type!=='delete'){input.current?.focus();input.current?.select();}},[entry]);
 const observed=(row:SavedLayoutRow)=>selection?.key===keyOf(row)&&selection.version===row.updatedAt;
 const current=(row:SavedLayoutRow)=>observed(row)&&arrangement!==null&&selection?.arrangement===arrangement;
 const close=()=>{setOpen(false);setOverflow(null);anchor.current?.focus();};
 const run=async(action:()=>Promise<unknown>,done?:()=>void)=>{
  if(pending.current)return;pending.current=true;onBusyChange?.(true);setBusy(true);setFailure('');
  try{await action();if(alive.current)done?.();}catch(cause){if(alive.current)setFailure(cause instanceof Error?cause.message:'The layout could not be updated.');}
  finally{pending.current=false;onBusyChange?.(false);if(alive.current)setBusy(false);}
 };
 const apply=(row:SavedLayoutRow)=>{if(current(row))return;void run(async()=>{const accepted=await onApply(row);if(alive.current)setSelection(accepted??null);},close);};
 const blocked=busy||loading||disabled;
 const items=[...rows.map(row=>({label:row.name,disabled:blocked})),{label:'Save current layout',disabled:blocked||!onSave}];
 const showEntry=(value:Entry)=>{setFailure('');setOverflow(null);setName(value.type==='rename'?value.row.name:'');setEntry(value);};
 const navigation=useListNavigation(items,index=>index<rows.length?apply(rows[index]):showEntry({type:'save'}),close);
 const row=(item:SavedLayoutRow,index:number):ReactNode=><div key={keyOf(item)} className="saved-layout-row" data-layout-key={keyOf(item)} data-selected={selection?.key===keyOf(item)}>
  <button type="button" className="saved-layout-apply" ref={node=>{navigation.rows.current[index]=node;}} disabled={blocked} aria-label={`${item.source!=='split'?'Recover':'Apply'} ${item.name}`} aria-current={current(item)?'true':undefined} onFocus={()=>navigation.onFocus(index)} onClick={()=>apply(item)}>
   <span>{item.name}</span>{observed(item)&&arrangement!==null&&<small>{current(item)?'Current':'Modified'}</small>}
  </button>
  {(item.canUpdate!==false||item.canRename!==false||item.canDelete!==false)&&<ActionMenu label={`Actions for ${item.name}`} icon={<MoreHorizontal size={15} aria-hidden="true"/>} disabled={blocked} open={overflow===keyOf(item)} onOpenChange={value=>setOverflow(value?keyOf(item):null)} items={[
   {id:'update',label:'Update',disabled:!onUpdate||item.canUpdate===false,onSelect:()=>{void run(async()=>{const accepted=await onUpdate?.(item);if(accepted&&alive.current)setSelection(accepted);});}},
   {id:'rename',label:'Rename',disabled:!onRename||item.canRename===false,onSelect:()=>showEntry({type:'rename',row:item})},
   {id:'delete',label:'Delete',disabled:item.canDelete===false,onSelect:()=>showEntry({type:'delete',row:item})},
  ]}/>}
 </div>;
 const modern=rows.filter(item=>item.source==='split'),recovery=rows.filter(item=>item.source!=='split');
 return <>
  <button ref={anchor} type="button" className="ui-action-trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open&&!disabled} aria-controls={open?id:undefined} onClick={()=>{setFailure('');setOpen(value=>!value);setOverflow(null);onOpen?.();}} onKeyDown={event=>{if(isComposing(event)||event.altKey||event.ctrlKey||event.metaKey)return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);onOpen?.();if(open)navigation.focus(navigation.edge(event.key==='ArrowUp'));}}}><Save size={12} aria-hidden="true"/>Layouts<ChevronDown size={11} aria-hidden="true"/></button>
  <Popover anchor={anchor} contentRef={content} open={open&&!disabled} width={320} height={Math.min(420,108+rows.length*40+(recovery.length?32:0))} preferredSide="below" id={id} role="dialog" aria-label="Saved layouts" tabIndex={-1} className="saved-layout-popup" onDismiss={()=>{if(!entry&&!overflow)setOpen(false);}} onReady={()=>{content.current?.focus();navigation.focus(rows.findIndex(row=>selection?.key===keyOf(row))>=0?rows.findIndex(row=>selection?.key===keyOf(row)):navigation.edge());}} onKeyDown={event=>{if(isComposing(event)){if(event.key==='Enter'||event.key==='Escape')event.preventDefault();return;}if(entry||overflow||event.key==='Tab')return;if(event.target instanceof HTMLElement&&event.target.closest('.ui-action-trigger'))return;navigation.onKeyDown(event);}}>
   <h2>Saved layouts</h2>
   {loading&&<p role="status" aria-label="Layout status">Loading layouts…</p>}
   {(error||failure)&&!entry&&<div className="saved-layout-error"><p role="alert">{failure||error}</p>{error&&onRetry&&<button type="button" disabled={busy} onClick={()=>void run(onRetry)}>Retry</button>}</div>}
   <div className="saved-layout-list" aria-busy={busy||loading}>
    {!loading&&!rows.length&&!error&&<p>No saved layouts yet.</p>}
    {modern.map(item=>row(item,rows.indexOf(item)))}
    {recovery.length>0&&<h3>Recovery layouts</h3>}{recovery.map(item=>row(item,rows.indexOf(item)))}
   </div>
   <button type="button" ref={node=>{navigation.rows.current[rows.length]=node;}} className="saved-layout-save" disabled={blocked||!onSave} onFocus={()=>navigation.onFocus(rows.length)} onClick={()=>showEntry({type:'save'})}>Save current layout…</button>
   {busy&&<p role="status" aria-label="Layout status">Updating layout…</p>}
  </Popover>
  <Modal open={entry!==null} title={entry?.type==='save'?'Save current layout':entry?.type==='rename'?'Rename layout':'Delete layout'} className="saved-layout-dialog" onClose={()=>{if(!pending.current){setEntry(null);setFailure('');}}}>
   {entry&&<form onSubmit={event=>{event.preventDefault();if(pending.current)return;void run(async()=>{if(entry.type==='save'){const accepted=await onSave?.(name.trim());if(accepted&&alive.current)setSelection(accepted);}else if(entry.type==='rename')await onRename?.(entry.row,name.trim());else{await onDelete(entry.row);if(selection?.key===keyOf(entry.row)&&alive.current)setSelection(null);}},()=>{setEntry(null);});}} onKeyDown={event=>{if(isComposing(event)&&(event.key==='Enter'||event.key==='Escape'))event.preventDefault();}}>
    {entry.type==='delete'?<p>Delete “{entry.row.name}”? Your current arrangement stays open.</p>:<label>Layout name<input ref={input} aria-label="Layout name" name="layoutName" value={name} required maxLength={100} pattern={'[^\\x00-\\x1f\\x7f]+'} disabled={busy} onChange={event=>setName(event.target.value)}/></label>}
    {failure&&<p className="saved-layout-error" role="alert">{failure}</p>}
    <div className="saved-layout-dialog-actions"><button type="button" disabled={busy} onClick={()=>{setEntry(null);setFailure('');}}>Cancel</button><button type="submit" disabled={busy||entry.type!=='delete'&&(!name.trim()||/[\u0000-\u001f\u007f]/.test(name))}>{busy?'Saving…':entry.type==='save'?'Save':entry.type==='rename'?'Rename':'Delete'}</button></div>
   </form>}
  </Modal>
 </>;
}
