import {useEffect,useState} from 'react';
import {z} from 'zod';
import type {Snapshot} from '../../../packages/contracts';
import {logicalOwnerV1Schema,sameLogicalOwner,type LogicalOwnerV1} from '../../../packages/contracts/source-selection';
import {authenticated,read} from './api';
import {errorMessage} from '../../../packages/ui-shell/format-utils';

// Validate the exact observed fields this read-only projection uses. Additional
// custody metadata stays with M04 and is never accepted as command authority.
const receipt=z.object({requestId:z.string(),owner:z.object({threadId:z.string(),workspaceId:z.string()}),contextGeneration:z.number().int(),sourceCut:z.object({revisionDigest:z.string(),sequence:z.number().nullable()}),modelBinding:z.object({modelId:z.string(),accountId:z.string().nullable()}),instructionDigest:z.string(),toolRegistryDigest:z.string(),segments:z.array(z.object({category:z.enum(['SYSTEM','INSTRUCTION','MEMORY','USER','TOOL','REFERENCE']),sourceId:z.string(),sourceRevision:z.number(),utf8Bytes:z.number().nonnegative(),tokens:z.number().nonnegative().nullable(),measurement:z.enum(['PROVIDER','TOKENIZER','BYTE_ONLY']),inclusionReason:z.string(),contentRef:z.string().nullable()})).max(64),budget:z.object({utf8Bytes:z.number().nonnegative(),tokens:z.number().nonnegative().nullable(),measurement:z.enum(['PROVIDER','TOKENIZER','BYTE_ONLY'])})});
const model=z.strictObject({logicalOwner:logicalOwnerV1Schema,state:z.enum(['EMPTY','AVAILABLE']),requestContext:z.object({status:z.literal('HOST_PREPARED'),runId:z.string(),epoch:z.number().int(),receipt}).nullable()});
export function WorkbenchRequestPanel({owner,tools=false}:{owner:LogicalOwnerV1;tools?:boolean}) {
 const key=JSON.stringify(owner),[result,setResult]=useState<{key:string;value:z.infer<typeof model>}>(),[error,setError]=useState('');
 useEffect(()=>{const pending=new AbortController();setError('');void authenticated(()=>fetch(`/api/workbench/threads/${encodeURIComponent(owner.threadId)}/context`,{credentials:'same-origin',cache:'no-store',signal:pending.signal})).then(read<unknown>).then(value=>{const parsed=model.parse(value);if(!sameLogicalOwner(parsed.logicalOwner,owner)||parsed.requestContext&&parsed.requestContext.receipt.owner.threadId!==owner.threadId)throw Error('The request context owner changed.');if(!pending.signal.aborted)setResult({key,value:parsed});}).catch(cause=>{if(!pending.signal.aborted)setError(errorMessage(cause,'Request context is unavailable.'));});return()=>pending.abort();},[key]);
 if(error)return <p role="alert">{error}</p>;
 if(result?.key!==key)return <p role="status">Loading recorded request context.</p>;
 const record=result.value.requestContext;if(!record)return <p role="status">No prepared request has been recorded. Tokens, tool use, and cache outcomes are not reported.</p>;
 const data=record.receipt;
 return <section aria-label={tools?'Recorded tools':'Last request'}><h3>{tools?'Tools in the last prepared request':'Last recorded request'}</h3><p>Host-prepared metadata for run {record.runId}, epoch {record.epoch}. This record does not establish provider execution or current context contents.</p>
  <dl><dt>Recorded workspace</dt><dd>{data.owner.workspaceId}</dd><dt>Request</dt><dd>{data.requestId}</dd><dt>Source revision</dt><dd>{data.sourceCut.revisionDigest}</dd><dt>Model</dt><dd>{data.modelBinding.modelId}</dd><dt>Account</dt><dd>{data.modelBinding.accountId??'No account binding recorded'}</dd><dt>Bytes</dt><dd>{data.budget.utf8Bytes} ({data.budget.measurement})</dd><dt>Tokens</dt><dd>{data.budget.tokens??'Not reported'}</dd><dt>Tool registry</dt><dd>{data.toolRegistryDigest}</dd><dt>Cache outcome</dt><dd>Not reported by this context contract</dd></dl>
  {tools&&<p>The owning context contract exposes a registry digest and observed tool segments. Tool schemas and approval controls remain in their owning panels.</p>}
  <table><thead><tr><th>Source</th><th>Category</th><th>Revision</th><th>Bytes</th><th>Tokens</th><th>Reason</th></tr></thead><tbody>{data.segments.filter(segment=>!tools||segment.category==='TOOL').map((segment,index)=><tr key={`${segment.sourceId}:${index}`}><td>{segment.sourceId}</td><td>{segment.category}</td><td>{segment.sourceRevision}</td><td>{segment.utf8Bytes}</td><td>{segment.tokens??'Not reported'}</td><td>{segment.inclusionReason}</td></tr>)}</tbody></table>
 </section>;
}
export function WorkbenchRunPanel({owner,snapshot}:{owner:LogicalOwnerV1;snapshot?:Snapshot}) {
 const thread=snapshot?.threads.find(thread=>thread.id===owner.threadId&&(thread.projectId??null)===owner.projectId&&(thread.workspaceId??null)===owner.workspaceId);
 if(!thread||!snapshot)return <p role="status">The current run read model is unavailable.</p>;
 const usage=snapshot.usage[thread.id],operations=snapshot.operations.filter(operation=>operation.threadId===thread.id),requests=snapshot.requests.filter(request=>request.threadId===thread.id&&request.status==='pending');
 return <section aria-label="Current run"><h3>Current run</h3><dl><dt>Owner</dt><dd>{thread.title} ({thread.id})</dd><dt>Working copy</dt><dd>{thread.workspaceId??'None'}</dd><dt>Status</dt><dd>{thread.status}</dd><dt>Run</dt><dd>{thread.runId??'No active run'}</dd><dt>Activity</dt><dd>{usage?.activity??'Not reported'}</dd><dt>Queue</dt><dd>{usage?.activity==='queued'?'Queued by the owning runtime':'No queue position reported'}</dd><dt>Cost</dt><dd>{usage?.cost===null||usage?.cost===undefined?'Not reported':String(usage.cost)}</dd></dl>
  {thread.error&&<p role="status">Blocker: {thread.error}</p>}{requests.map(request=><p key={request.id}>Awaiting input: {request.title}</p>)}
  <h4>Tool activity</h4>{operations.length?operations.slice(-100).map(operation=><article key={operation.id}><strong>{operation.description}</strong><p>{operation.status} · revision {operation.revision}</p>{operation.error&&<p>{operation.error}</p>}<small>Read-only inspection. Approval and execution remain in the operation's owning panel.</small></article>):<p>No operation records are present in the current snapshot.</p>}
  <h4>Background jobs</h4><p>Unsupported: this workbench has no tested background-job read contract.</p>
 </section>;
}
