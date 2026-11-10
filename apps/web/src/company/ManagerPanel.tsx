import {useEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowUp, MessageSquare} from 'lucide-react';
import {journalRead, journalWrite} from '../journal';
import {ApiError} from '../api';
import type {CompanyManagerDraft} from '../../../../packages/company-manager/contracts';
import type {CompanyManagerInteraction} from '../../../../packages/company-manager/journal';
import {cancelManagerRequest, getManagerAvailability, getManagerRequest, proposeManagerDraft, validateManagerInteraction, type ManagerAvailability} from './manager-api';
import {companyManagerAccess} from './presentation';
import './manager.css';

type SavedRequest = {id: string; instruction: string};
interface LocalPlan {
  instruction: string;
  notes: string;
  request?: SavedRequest;
  interaction?: CompanyManagerInteraction;
}
const emptyPlan = (): LocalPlan => ({instruction: '', notes: ''});
const terminal = (status: CompanyManagerInteraction['status'] | undefined) => status === 'draft_ready' || status === 'failed' || status === 'cancelled';
const failure = (error: unknown) => error instanceof Error ? error.message : 'The local E01 request could not be read.';
const statusText: Record<CompanyManagerInteraction['status'], string> = {
  pending: 'E01 planning is pending.',
  stop_requested: 'Stop requested for E01 planning. Completion is unconfirmed.',
  draft_ready: 'Local draft ready for owner review.',
  failed: 'E01 did not produce a verified local draft.',
  cancelled: 'E01 planning was cancelled.',
  uncertain: 'E01 cleanup is unconfirmed. This request remains unresolved.',
};

function recoverLocal(value: unknown, projectId: string): LocalPlan {
  if (!value || typeof value !== 'object') return emptyPlan();
  const saved = value as Partial<LocalPlan>;
  const result: LocalPlan = {instruction: typeof saved.instruction === 'string' ? saved.instruction.slice(0, 16000) : '', notes: typeof saved.notes === 'string' ? saved.notes.slice(0, 32000) : ''};
  if (typeof saved.request?.id === 'string' && saved.request.id.length > 0 && saved.request.id.length <= 128 && typeof saved.request.instruction === 'string') {
    result.request = {id: saved.request.id, instruction: saved.request.instruction};
    try {
      const record = validateManagerInteraction(saved.interaction, {projectId, requestId: saved.request.id});
      if (record.input.instruction === saved.request.instruction) result.interaction = record;
    } catch { /* Keep the saved identity for host recovery if the cached response is incompatible. */ }
  }
  return result;
}

function TextList({values, empty = 'None returned.'}: {values: readonly string[]; empty?: string}) {
  return values.length ? <ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul> : <p className="company-manager-muted">{empty}</p>;
}
function DraftReview({draft}: {draft: CompanyManagerDraft}) {
  const [copyStatus, setCopyStatus] = useState(''), [fallback, setFallback] = useState(false);
  const json = JSON.stringify(draft, null, 2);
  const copy = async () => {
    try {await navigator.clipboard.writeText(json); setCopyStatus('Draft JSON copied.'); setFallback(false);}
    catch {setCopyStatus('Clipboard unavailable. Select and copy the JSON below.'); setFallback(true);}
  };
  return <section className="company-manager-review" aria-label="Local draft review">
    <div className="company-manager-review-heading"><h3>Draft for review</h3><span className="company-manager-badge">Local draft · Unsubmitted · No dispatch</span></div>
    <section><h4>Summary</h4><p>{draft.content.summary}</p></section>
    <section><h4>Interpretation</h4><p>{draft.content.interpretation}</p></section>
    <section><h4>Assumptions</h4><TextList values={draft.content.assumptions}/></section>
    <section><h4>Blockers</h4>{draft.content.blockers.length ? <ul>{draft.content.blockers.map((blocker, index) => <li key={index}><span>{blocker.kind.replaceAll('_', ' ')}: </span>{blocker.detail}</li>)}</ul> : <p className="company-manager-muted">None returned.</p>}</section>
    <section><h4>Proposed tasks</h4><ol className="company-manager-tasks">{draft.content.tasks.map(task => <li key={task.id}>
      <h5>{task.title}</h5><p>{task.instructions}</p>
      <dl><div><dt>Task ID</dt><dd>{task.id}</dd></div><div><dt>Proposed employee</dt><dd>{task.proposedEmployeeId ?? 'Unassigned'}</dd></div><div><dt>Deliverable</dt><dd>{task.deliverable}</dd></div></dl>
      <h6>Dependencies</h6><TextList values={task.dependsOn} empty="No dependencies proposed."/>
      <h6>Required evidence</h6><TextList values={task.requiredEvidence}/>
      <h6>Source references</h6><TextList values={task.sourceRefs}/>
    </li>)}</ol></section>
    <section><h4>Draft source references</h4><TextList values={draft.sourceRefs}/></section>
    <div className="company-manager-copy"><button type="button" onClick={() => void copy()}>Copy draft JSON</button><span role="status">{copyStatus}</span></div>
    {fallback && <label className="company-manager-field">Draft JSON to copy<textarea readOnly value={json} rows={10} onFocus={event => event.currentTarget.select()}/></label>}
  </section>;
}

interface ManagerPanelProps {
  projectId: string | null;
  experience?: 'planning' | 'conversation';
  planningAllowed?: boolean;
  onRecovered?: () => void;
  onAccessDenied?: (cause: Error) => void;
}
function ProjectManager({projectId, experience = 'planning', planningAllowed = false, onRecovered, onAccessDenied}: Omit<ManagerPanelProps, 'projectId'> & {projectId: string}) {
  const key = `company:leo-company:manager:${projectId}:v1`;
  const [plan, setPlan] = useState<LocalPlan>(emptyPlan), current = useRef(plan);
  const [ready, setReady] = useState(false), [availability, setAvailability] = useState<ManagerAvailability>();
  const [availabilityError, setAvailabilityError] = useState(''), [error, setError] = useState('');
  const [verifiedAbsent, setVerifiedAbsent] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Recovering local planning notes…'), [storageFailed, setStorageFailed] = useState(false);
  const [sending, setSending] = useState(false), [persistingRequest, setPersistingRequest] = useState(false), [recovering, setRecovering] = useState(false), [stopping, setStopping] = useState(false);
  const [online, setOnline] = useState(navigator.onLine), [accessDenied, setAccessDenied] = useState(false);
  const availabilityRead = useRef<AbortController | undefined>(undefined);
  const conversation = experience === 'conversation';
  const alive = useRef(true), saveVersion = useRef(0), sendLock = useRef(false), recoverLock = useRef(false), stopLock = useRef(false);
  const checkAccess = (cause: unknown) => {
    if (cause instanceof ApiError && ['COMPANY_AUTH', 'COMPANY_FORBIDDEN', 'AUTH_REQUIRED'].includes(cause.code)) {
      setAccessDenied(true); setAvailability(undefined); onAccessDenied?.(cause);
    }
  };
  const persist = async (patch: Partial<LocalPlan>) => {
    const next = {...current.current, ...patch}; current.current = next;
    const version = ++saveVersion.current;
    if (alive.current) {setPlan(next); setSaveStatus('Saving locally…');}
    try {
      await journalWrite(key, next);
      if (alive.current && version === saveVersion.current) {setSaveStatus('Saved on this device'); setStorageFailed(false);}
    } catch (cause) {
      if (alive.current && version === saveVersion.current) {setSaveStatus('Local save failed. Keep this window open.'); setStorageFailed(true);}
      throw cause;
    }
  };
  const accept = async (record: CompanyManagerInteraction) => {
    // A remounted project owns its newer edits and can recover the host result.
    if (!alive.current) return;
    setVerifiedAbsent(false);
    const saved = current.current.request;
    if (!saved || record.id !== saved.id || record.input.instruction !== saved.instruction) throw new Error('The recovered request does not match the saved planning instruction.');
    const previous = current.current.interaction;
    if (previous && (previous.updatedAt > record.updatedAt || terminal(previous.status) && ['pending', 'stop_requested'].includes(record.status))) return;
    await persist({interaction: record});
  };
  const recover = async () => {
    const saved = current.current.request;
    if (!saved || recoverLock.current || !planningAllowed || !online) return;
    recoverLock.current = true;
    if (alive.current) {setRecovering(true); setError('');}
    try {await accept(await getManagerRequest({projectId, requestId: saved.id}));}
    catch (cause) {if (alive.current) {checkAccess(cause); setVerifiedAbsent(cause instanceof ApiError && cause.code === 'NOT_FOUND'); setError(`Existing request could not be recovered. ${failure(cause)} Keep its saved identity and try recovery again.`);}}
    finally {recoverLock.current = false; if (alive.current) setRecovering(false);}
  };
  const checkAvailability = async () => {
    availabilityRead.current?.abort();
    const controller = new AbortController(); availabilityRead.current = controller;
    if (alive.current) {setAvailability(undefined); setAvailabilityError('');}
    try {const value = await getManagerAvailability(controller.signal); if (alive.current && !controller.signal.aborted) {setAvailability(value); setAccessDenied(false);}}
    catch (cause) {if (alive.current && !controller.signal.aborted) {checkAccess(cause); setAvailabilityError(failure(cause));}}
  };
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void checkAvailability();
    void journalRead<unknown>(key).then(value => {
      if (!alive.current || controller.signal.aborted) return;
      const saved = recoverLocal(value, projectId); current.current = saved; setPlan(saved); setReady(true); setSaveStatus('Saved on this device');
      if (saved.request && !conversation) void recover();
    }).catch(() => {if (alive.current && !controller.signal.aborted) {setStorageFailed(true); setSaveStatus('Draft recovery unavailable. Reload to retry; saved work has not been overwritten.');}})
      .finally(() => {if (alive.current && !controller.signal.aborted) onRecovered?.();});
    const disconnect = () => {setOnline(false); setAvailability(undefined); availabilityRead.current?.abort();};
    const reconnect = () => {setOnline(true); void checkAvailability();};
    window.addEventListener('offline', disconnect); window.addEventListener('online', reconnect);
    // Leaving this view only stops its availability read. It does not cancel E01.
    return () => {alive.current = false; controller.abort(); availabilityRead.current?.abort(); window.removeEventListener('offline', disconnect); window.removeEventListener('online', reconnect);};
  }, [key, projectId]);
  const edit = (patch: Pick<LocalPlan, 'instruction'> | Pick<LocalPlan, 'notes'>) => {void persist(patch).catch(() => {});};
  const create = async () => {
    const previous = current.current;
    if (conversation || !planningAllowed || !online || accessDenied || sendLock.current || !ready || !availability?.configured || storageFailed || previous.request && !terminal(previous.interaction?.status) || !previous.instruction.trim()) return;
    const saved = {id: crypto.randomUUID(), instruction: previous.instruction};
    sendLock.current = true; setSending(true); setPersistingRequest(true); setError('');
    setVerifiedAbsent(false);
    try {
      // Commit request identity before inference; later typing changes only the
      // next instruction and cannot change this request's original body.
      await persist({request: saved, interaction: undefined});
      if (alive.current) setPersistingRequest(false);
      await accept(await proposeManagerDraft({projectId, requestId: saved.id, instruction: saved.instruction}));
    } catch (cause) {if (alive.current) {checkAccess(cause); setError(`The draft response is unavailable. ${failure(cause)} Recover the existing request before creating another draft.`);}}
    finally {sendLock.current = false; if (alive.current) {setSending(false); setPersistingRequest(false);}}
  };
  const retrySaved = async () => {
    const saved = current.current.request;
    if (conversation || !planningAllowed || !online || accessDenied || !saved || !verifiedAbsent || sendLock.current || !availability?.configured || storageFailed) return;
    sendLock.current = true; setSending(true); setVerifiedAbsent(false); setError('');
    try {await accept(await proposeManagerDraft({projectId, requestId: saved.id, instruction: saved.instruction}));}
    catch (cause) {if (alive.current) {checkAccess(cause); setError(`The saved request response is unavailable. ${failure(cause)} Recover this same request again.`);}}
    finally {sendLock.current = false; if (alive.current) setSending(false);}
  };
  const stop = async () => {
    const saved = current.current.request;
    if (!saved || stopLock.current || !planningAllowed || !online || accessDenied) return;
    stopLock.current = true; setStopping(true); setError('');
    try {await accept(await cancelManagerRequest({projectId, requestId: saved.id}));}
    catch (cause) {if (alive.current) {checkAccess(cause); setError(`E01 planning stop is unconfirmed. ${failure(cause)} Recover the existing request to check its state.`);}}
    finally {stopLock.current = false; if (alive.current) setStopping(false);}
  };
  const status = plan.interaction?.status;
  const unresolved = Boolean(plan.request && !terminal(status));
  const canDraft = planningAllowed && online && !accessDenied && ready && availability?.configured && !storageFailed && !sending && !unresolved && Boolean(plan.instruction.trim());
  const canStop = planningAllowed && online && !accessDenied && plan.request && !persistingRequest && !terminal(status) && status !== 'uncertain' && status !== 'stop_requested';
  if (conversation) {
    const access = companyManagerAccess(availability);
    const connectionReason = accessDenied ? 'Your company access could not be verified. Refresh company records, then check the manager connection. Your draft is kept.' : availabilityError ? 'The manager connection could not be checked. Try again; your draft is kept on this device.' : access.reason;
    return <section className="company-manager company-manager-conversation" aria-label="Company manager conversation">
      <div className="company-conversation-intro"><MessageSquare size={25} aria-hidden="true"/><h1>Message your company manager</h1><p>Discuss a project, review a plan, or decide what happens next.</p></div>
      <div className="company-manager-notice" role="status"><h2>{online ? access.title : 'You’re offline'}</h2><p>{online ? connectionReason : 'Your draft stays on this device. Reconnect, then check the manager connection.'}</p><button type="button" disabled={!online} onClick={() => void checkAvailability()}>Check manager connection</button></div>
      <div className="composer-dock company-conversation-composer">
        <form className="composer" onSubmit={event => event.preventDefault()}>
          <label className="company-composer-label" htmlFor="company-manager-message">Message to company manager</label>
          <div className="composer-input"><textarea id="company-manager-message" rows={3} maxLength={16000} value={plan.instruction} disabled={!ready || !projectId} placeholder={projectId ? 'Write a message for your manager…' : 'Choose a project above to start a draft…'} aria-describedby="company-send-explanation company-draft-status" onChange={event => edit({instruction: event.target.value})}/></div>
          <div className="company-composer-footer"><span>Company manager</span><button className="send-button" type="submit" disabled={!access.canSend} aria-label="Send message" title="Company messaging is not connected"><ArrowUp size={17}/>Send</button></div>
        </form>
        <div className="company-composer-caption"><span id="company-draft-status" role="status">{saveStatus === 'Saved on this device' ? 'Draft saved on this device' : saveStatus}</span><span id="company-send-explanation">{projectId ? 'Not sent · sending is unavailable' : 'Choose a project to save a draft'}</span></div>
      </div>
      {(availabilityError || availability?.blockers.length) ? <details className="company-manager-connection-details"><summary>Connection details</summary>{availabilityError && <p>{availabilityError}</p>}<TextList values={availability?.blockers ?? []}/></details> : null}
    </section>;
  }
  return <div className="company-manager" aria-label="E01 local planning">
    <p className="company-description">Ask E01 for a project draft to review here. Instructions and notes are saved on this device; drafts are unsubmitted and do not dispatch employees.</p>
    <div className="company-manager-availability"><span role="status">{availability ? availability.configured ? 'E01 planning configured · admission checked for each request' : 'E01 planning unavailable' : availabilityError || 'Checking E01 planning availability…'}</span><button type="button" onClick={() => void checkAvailability()}>Check E01 availability</button></div>
    {availability?.blockers.length ? <ul className="company-manager-reasons">{availability.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul> : null}
    <label className="company-manager-field">E01 planning instruction<textarea value={plan.instruction} disabled={!ready} maxLength={16000} rows={5} placeholder="Describe the outcome and constraints for this project." onChange={event => edit({instruction: event.target.value})}/></label>
    <div className="company-manager-actions"><button type="button" className="company-manager-primary" disabled={!canDraft} onClick={() => void create()}>{plan.request ? 'Create new local draft' : 'Create local draft'}</button>{plan.request && <><button type="button" disabled={recovering || !planningAllowed || !online} onClick={() => void recover()}>{recovering ? 'Recovering request…' : 'Recover existing request'}</button>{verifiedAbsent && <button type="button" disabled={sending || storageFailed || !availability?.configured || !planningAllowed || !online || accessDenied} onClick={() => void retrySaved()}>Retry saved request</button>}<button type="button" disabled={!canStop || stopping || verifiedAbsent} onClick={() => void stop()}>{stopping ? 'Stopping E01 planning…' : 'Stop E01 planning'}</button></>}</div>
    {!planningAllowed && <p className="company-manager-muted">Refresh company records to confirm access before requesting a local draft.</p>}
    {verifiedAbsent && <p className="company-manager-muted">The host returned no record. Retry uses the same saved request and original instruction.</p>}
    <p className="company-manager-muted">Stop applies only to this E01 planning request. Closing or disconnecting this browser does not cancel it.</p>
    {plan.request && <section className="company-manager-request" aria-label="Saved E01 request"><p role="status">{status ? statusText[status] : sending ? 'E01 planning is pending.' : 'Request outcome is unconfirmed. Recover the existing request.'}</p><small>Local request: {plan.request.id}</small><details><summary>Original request instruction</summary><p>{plan.request.instruction}</p></details>{plan.instruction !== plan.request.instruction && <p className="company-manager-muted">Your edited instruction is saved for a new draft. Recovery reads the existing request.</p>}</section>}
    {error && <p className="company-local-error" role="alert">{error}</p>}
    {!accessDenied && planningAllowed && status === 'draft_ready' && plan.interaction?.draft && <DraftReview key={plan.interaction.draft.id} draft={plan.interaction.draft}/>}
    <section className="company-manager-local-notes"><label className="company-manager-field">Local draft notes<textarea value={plan.notes} disabled={!ready} maxLength={32000} rows={4} placeholder="Keep review questions and proposed edits here." onChange={event => edit({notes: event.target.value})}/></label><p role="status">{saveStatus}</p><p className="company-manager-muted">Notes stay on this device. They do not submit a plan, authorize work or change company records.</p></section>
  </div>;
}

export function ManagerPanel(props: ManagerPanelProps): ReactNode {
  return props.projectId || props.experience === 'conversation' ? <ProjectManager key={`${props.experience}:${props.projectId ?? ''}`} {...props} projectId={props.projectId ?? ''}/> : <div className="company-empty"><h3>Select a project</h3><p>Choose a project to prepare a local draft.</p></div>;
}
