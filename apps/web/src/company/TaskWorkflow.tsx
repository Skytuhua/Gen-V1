import {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {z} from 'zod';
import {OwnerPlanInputSchema} from '../../../../packages/company-contracts';
import {journalRead, journalWrite} from '../journal';
import {captureCompanyInstruction, getCompanyWorkflow, recordCompanyInstruction, InstructionReceiptSchema, type WorkflowAvailability, type InstructionReceipt} from './workflow-api';

const key = 'company:leo-company:owner-task:v1';
const SavedSchema = z.object({projectId: z.string().max(63), instruction: z.string().max(16000), request: OwnerPlanInputSchema.optional(), receipt: InstructionReceiptSchema.optional()});
type Saved = z.infer<typeof SavedSchema>;
const empty: Saved = {projectId: '', instruction: ''};
const WorkPlanReview = lazy(() => import('./WorkPlanReview').then(module => ({default: module.WorkPlanReview})));

/** Local draft/request projection only. Company Control owns acceptance and work. */
export function TaskWorkflow({onRecovered}: {onRecovered?: () => void}) {
  const [saved, setSaved] = useState<Saved>(empty), current = useRef<Saved>(empty);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [local, setLocal] = useState('Recovering task draft…');
  const [recoveryDone, setRecoveryDone] = useState(false);
  const [availability, setAvailability] = useState<WorkflowAvailability>(), [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine), [blocked, setBlocked] = useState(false);
  const [cached, setCached] = useState(true), alive = useRef(true), locked = useRef(false), editVersion = useRef(0);
  const reading = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    void journalRead(key).then(value => {
      const recovered = value === undefined ? empty : SavedSchema.parse(value);
      if (alive.current) {current.current = recovered; setSaved(recovered); setReady(true); setLocal('Saved on this device · not submitted');}
    }).catch(() => {if (alive.current) setLocal('Draft recovery unavailable. Keep this window open; saved work has not been overwritten.');})
      .finally(() => {if (alive.current) setRecoveryDone(true);});
    const connected = () => setOnline(true), disconnected = () => {setOnline(false); reading.current?.abort();};
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected);
    return () => {alive.current = false; reading.current?.abort(); window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected);};
  }, []);
  async function check() {
    reading.current?.abort(); const controller = new AbortController(); reading.current = controller;
    try {const next = await getCompanyWorkflow(controller.signal); if (!controller.signal.aborted && alive.current) setAvailability(next);}
    catch {if (!controller.signal.aborted && alive.current) setAvailability(undefined);}
  }
  useEffect(() => {void check(); return () => reading.current?.abort();}, []);
  useEffect(() => {if (recoveryDone) onRecovered?.();}, [recoveryDone, onRecovered]);
  function edit(patch: Partial<Saved>) {
    if (!ready || locked.current) return;
    const next = {...current.current, ...patch}, version = ++editVersion.current;
    current.current = next; setSaved(next); setLocal('Saving on this device…');
    void journalWrite(key, next).then(() => {if (alive.current && version === editVersion.current) setLocal('Saved on this device · not submitted');})
      .catch(() => {if (alive.current && version === editVersion.current) setLocal('Save failed. Keep this window open.');});
  }
  async function submit(recover = false) {
    if (!ready || locked.current || !online || !availability?.recordInstruction) return;
    locked.current = true; setBusy(true); setError('');
    let attempted = false;
    try {
      const request = recover ? current.current.request : OwnerPlanInputSchema.parse({project_id: current.current.projectId, instruction: current.current.instruction, message_id: crypto.randomUUID()});
      if (!request) return;
      captureCompanyInstruction(request);
      const pending: Saved = {...current.current, request, receipt: undefined};
      // Await the existing journal before any network effect. Reopen/reconnect
      // never submits it. An uncertain request prevents replacement identities.
      await journalWrite(key, pending); current.current = pending;
      if (alive.current) {setSaved(pending); setLocal('Saved request · awaiting service confirmation');}
      attempted = true;
      const receipt = await recordCompanyInstruction(request);
      const next = {...current.current, receipt};
      await journalWrite(key, next); current.current = next;
      if (alive.current) {setSaved(next); setCached(false); setBlocked(false); setLocal('Service receipt saved on this device');}
    } catch (cause) {
      if (!alive.current) return;
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : '';
      if (['COMPANY_AUTH', 'COMPANY_FORBIDDEN', 'AUTH_REQUIRED'].includes(String(code))) {setBlocked(true); setAvailability(undefined); setError('Current company access was denied. Your draft remains saved.');}
      else setError(attempted ? 'Service confirmation was not received. Check the saved request before creating another.' : 'The task request could not be saved. No request was sent.');
    } finally {locked.current = false; if (alive.current) setBusy(false);}
  }
  const pending = saved.request && !saved.receipt;
  let valid = false;
  try {captureCompanyInstruction({project_id: saved.projectId, instruction: saved.instruction, message_id: '0'.repeat(36)}); valid = true;} catch { /* Invalid or oversized drafts stay editable and unsent. */ }
  const receipt: InstructionReceipt | undefined = blocked ? undefined : saved.receipt;
  return <section className="company-section company-task-workflow" role="region" aria-label="Owner task" aria-busy={busy}>
    <h2>Give the team a task</h2>
    <p>Describe the outcome, review the permitted plan, then authorize only the exact work you intend.</p>
    {availability?.approvedJob && <Suspense fallback={<p>Opening approved job…</p>}><WorkPlanReview key={'approved:' + availability.approvedJob.instructionId} projectId={availability.approvedJob.projectId} instructionId={availability.approvedJob.instructionId} readOnly={availability.approvedJob}/></Suspense>}
    <div className="company-task-fields"><label>Project ID<input value={saved.projectId} disabled={!ready || busy || Boolean(pending)} maxLength={63} placeholder="Choose your enrolled project" onChange={event => edit({projectId: event.target.value})}/></label>
    <label>Task outcome<textarea value={saved.instruction} disabled={!ready || busy || Boolean(pending)} maxLength={16000} rows={3} placeholder="What should be done, and what must remain unchanged?" onChange={event => edit({instruction: event.target.value})}/></label></div>
    <p role="status">{local}</p>
    {saved.instruction && saved.projectId && !valid && <p>Use an enrolled project ID and a bounded task instruction. Shorten large instructions before submitting.</p>}
    {pending ? <><p>Submission is unconfirmed. Reopening this screen does not send it again.</p><button disabled={busy || !online || !availability?.recordInstruction} onClick={() => void submit(true)}>Check saved request</button></> : <button disabled={!ready || busy || !online || !valid || !availability?.recordInstruction} onClick={() => void submit()}>Request plan</button>}
    <button disabled={busy || !online} onClick={() => void check()}>Check company connection</button>
    {!online && <p>Disconnected. Your task draft stays on this device.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="company-task-stages">
      <section><h3>Plan and authorization</h3>{receipt ? <><strong>{availability?.workPlans?.configured ? 'Instruction recorded · proposed work plan review available' : 'Instruction recorded · executable plan unavailable'}</strong><p>{cached ? 'Saved service receipt · current authorization has not been rechecked.' : 'Company service confirmed the instruction.'} This instruction receipt alone does not authorize employee work.</p><p>Recorded instruction for project {receipt.proposal.project_id}</p><blockquote>{receipt.proposal.instruction}</blockquote><ul>{receipt.proposal.blockers.map((value, index) => <li key={index}>{value}</li>)}</ul></> : <p>{availability?.recordInstruction ? 'The current service can record this instruction, but cannot yet return an executable plan.' : 'Task submission is not connected. Your draft can be saved here.'}</p>}<button disabled>Authorize task unavailable</button></section>
      <section><h3>Progress</h3><p>Real employee progress unavailable</p><p>No task has been admitted or started through this request.</p></section>
      <section><h3>Returned result</h3><p>A result will appear only after the company service supplies its task and evidence references.</p><button disabled>Open result unavailable</button></section>
    </div>
    {receipt && availability?.workPlans?.configured && !availability.workPlans.readOnly && <Suspense fallback={<p>Opening exact plan review…</p>}><WorkPlanReview key={receipt.proposal.id} projectId={receipt.proposal.project_id} instructionId={receipt.proposal.id}/></Suspense>}
  </section>;
}
