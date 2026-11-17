import {useEffect,useMemo,useState} from 'react';
import type {Message} from '../../../packages/contracts';
import {useSourceWorkbench} from './SourceWorkbench';
import {WorkbenchOutput} from './WorkbenchOutput';
import {textDigest} from './workbench-api';
import type {WorkbenchOutputIdentity} from './workbench-window';
import {activityOutputRows} from './activity-output';

/** The snapshot remains canonical. Only the expanded activity presentation is
 * windowed; full-result actions re-read the owning host at the exact revision. */
export function WorkbenchActivity({updates}:{updates:Message[]}) {
 const context=useSourceWorkbench()!,owner=context.owner!;
 const serialized=useMemo(()=>JSON.stringify(updates.map(({id,content})=>({id,content}))),[updates]),ownerKey=JSON.stringify(owner);
 const rows=useMemo(()=>activityOutputRows(updates),[serialized]);
 const ids=useMemo(()=>updates.map(update=>update.id),[serialized]);
 const [revision,setRevision]=useState<{text:string;digest:string}>();
 useEffect(()=>{let current=true;void textDigest(serialized).then(digest=>{if(current)setRevision({text:serialized,digest});});return()=>{current=false;};},[serialized,ownerKey]);
 const ready=revision?.text===serialized,sourceId=updates[0]?.id??'empty';
 const identity=useMemo<WorkbenchOutputIdentity>(()=>({logicalOwner:owner,sourceId,sourceRevision:ready?revision!.digest:'pending'}),[ownerKey,sourceId,ready,revision?.digest]);
 const readFull=useMemo(()=>ready?async(signal:AbortSignal)=>{
  const result=await context.api.output(owner,ids,identity.sourceRevision,signal);
  return {identity:{logicalOwner:result.logicalOwner,sourceId:result.sourceId,sourceRevision:result.sourceRevision},rows:result.rows,complete:result.complete,trailingNewline:result.trailingNewline};
 }:undefined,[context.api,ownerKey,ids,identity,ready]);
 return <details className="activity"><summary>Work activity · {updates.length} updates</summary>{context.viewReady?<WorkbenchOutput identity={identity} rows={rows} state={ready?'ready':'partial'} readFull={readFull} initialAnchor={context.view?.viewType==='RUN'&&context.view.selectedItem===sourceId?context.view.scrollAnchor:null} onAnchorChange={anchor=>context.persistView('RUN',sourceId,anchor)} label="Retained work activity"/>:<p role="status">Restoring the local output view.</p>}</details>;
}
