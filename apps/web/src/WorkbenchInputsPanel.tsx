import {useState} from 'react';
import type {SourceRefV1,WorkbenchInputRecoveryRequestV1} from '../../../packages/contracts/source-selection';
import {useSourceWorkbench} from './SourceWorkbench';
import {errorMessage} from '../../../packages/ui-shell/format-utils';

/** Controls act on proven undispatched host inputs. They do not reconstruct
 * accepted input text in the composer or start/resume a runtime implicitly. */
export function WorkbenchInputsPanel({onInspect}:{onInspect:(ref:SourceRefV1)=>Promise<void>}) {
 const context=useSourceWorkbench(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 if(!context)return null;
 const run=async(inputId:string,action:WorkbenchInputRecoveryRequestV1['action'])=>{
  setBusy(true);setError('');setNotice('');
  try{const receipt=await context.recoverInput(inputId,action);setNotice(receipt.result.resumeRequired?'Captured sources are retained. Resume the run explicitly with its existing Resume control.':'Cancelled the undispatched input. Its accepted message remains in history.');}
  catch(cause){setError(errorMessage(cause,'The result is uncertain. Retry the same action.'));}
  finally{setBusy(false);}
 };
 return <section aria-label="Accepted source inputs"><h3>Accepted source inputs</h3><p>These inputs already left the composer. Recovery changes only an undispatched input after the host rechecks its owner and delivery state.</p>
  <button type="button" disabled={busy} onClick={()=>{void context.reloadInputs();}}>Refresh accepted inputs</button>
  {(error||context.inputsError)&&<p role="alert">{error||context.inputsError}</p>}{notice&&<p role="status">{notice}</p>}
  {!context.inputsReady&&<p role="status">Loading accepted inputs.</p>}{context.inputsReady&&!context.inputsError&&!context.inputs.length&&<p>No retained source inputs are waiting.</p>}
  {context.pendingRecoveries.filter(pending=>!context.inputs.some(input=>input.inputId===pending.inputId)).map(pending=><article key={pending.inputId}><p>Unconfirmed recovery for {pending.inputId}. Retry the exact recorded action to obtain its receipt.</p><button type="button" disabled={busy||!context.canRecoverInputs} onClick={()=>{void run(pending.inputId,pending.action);}}>Retry {pending.action}</button></article>)}
  {context.inputs.map(input=>{const pending=context.pendingRecoveries.find(value=>value.inputId===input.inputId);return <article key={input.inputId} aria-label={`Accepted input ${input.inputId}`}><h4>{input.inputId}</h4><p>{input.state} · {input.sourceCount} retained source{input.sourceCount===1?'':'s'}</p>{input.reason&&<p>{input.reason}</p>}
   {input.sourceRefs?.map((ref,index)=><button type="button" key={ref.captureId} disabled={busy} onClick={()=>{void onInspect(ref).catch(cause=>setError(errorMessage(cause,'The retained source is unavailable.')));}}>Inspect retained source {index+1}</button>)}
   {!input.sourceRefs&&<p>Source details are unavailable under the current authorization.</p>}
   {pending&&<p>The {pending.action} acknowledgment is unconfirmed. Retry that action before choosing another.</p>}
   <div className="workbench-source-actions"><button type="button" disabled={busy||!context.canRecoverInputs||(pending?pending.action!=='KEEP_CAPTURED':!input.canKeepCaptured)} onClick={()=>{void run(input.inputId,'KEEP_CAPTURED');}}>Keep captured sources</button><button type="button" disabled={busy||!context.canRecoverInputs||(pending?pending.action!=='CANCEL':!input.canCancel)} onClick={()=>{void run(input.inputId,'CANCEL');}}>Cancel undispatched input</button></div>
  </article>;})}
 </section>;
}
