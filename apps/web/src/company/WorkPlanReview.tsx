import './validation-policy';
import {useEffect, useRef, useState} from 'react';
import {z} from 'zod';
import {journalRead, journalWrite, journalSubscribe} from '../journal';
import {registerEditorHandoff} from '../editor-handoff';
import {companyWorkPlan} from './workflow-api';
import {validateApprovedJobRead, type ApprovedJobRead} from '../../../../packages/company-contracts/approved-job-read';
import {captureWorkPlanRequest, validateWorkPlanBody, validateWorkPlanResponse, workPlanCanonicalBytes, workPlanRef, WorkPlanError,
  type WorkPlanBody, type WorkPlanEmployee, type WorkPlanRef, type WorkPlanRecord, type WorkPlanProposeRequest, type WorkPlanAuthorizeRequest, type WorkPlanAuthorizeResponse, type WorkPlanReadResponse} from '../../../../packages/company-contracts/work-plan';

const employees = ['E01', 'E10', 'E11'] as const;
const artifactTypes = ['code', 'report', 'test_evidence'] as const;
const DraftSchema = z.object({summary: z.string().max(2048), employee_ids: z.array(z.enum(employees)).max(3), budget_cents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  steps: z.array(z.object({key: z.string().max(32), employee_id: z.enum(employees), instruction: z.string().max(2048), depends_on: z.array(z.string().max(32)).max(12), expected_artifact_types: z.array(z.enum(artifactTypes)).max(3), acceptance_checks: z.array(z.string().max(8192)).max(128)})).min(1).max(12),
  repository_inputs: z.array(z.object({repository: z.string().max(128), revision: z.string().max(64), paths: z.array(z.string().max(8192)).max(128)})).max(8)});
const blank = (): WorkPlanBody => ({summary: '', employee_ids: ['E01'], budget_cents: 0, steps: [{key: 'step-1', employee_id: 'E01', instruction: '', depends_on: [], expected_artifact_types: ['report'], acceptance_checks: ['']}], repository_inputs: []});
type Saved = {draft: WorkPlanBody; planRef?: WorkPlanRef; proposalRequest?: WorkPlanProposeRequest; proposalConfirmed?: boolean; proposalRejected?: string; authorizationRequest?: WorkPlanAuthorizeRequest; authorizationRejected?: string; authorizationResponse?: WorkPlanAuthorizeResponse; read?: WorkPlanReadResponse;
  rejectedProposal?: {request: WorkPlanProposeRequest; code: string}; rejectedAuthorization?: {request: WorkPlanAuthorizeRequest; code: string}; accessDenied?: boolean};
const same = (a: unknown, b: unknown) => new TextDecoder().decode(workPlanCanonicalBytes(a)) === new TextDecoder().decode(workPlanCanonicalBytes(b));
const displayTime = (seconds: number) => new Date(seconds * 1000).toLocaleString();
const localTime = (seconds: number) => {const date = new Date(seconds * 1000); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);};
const problem = (cause: unknown) => cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
const denied = (cause: unknown) => ['authentication_required', 'scope_denied', 'AUTH_REQUIRED', 'COMPANY_AUTH', 'COMPANY_FORBIDDEN'].includes(problem(cause));
const closedRejections = new Set(['invalid_request', 'authentication_required', 'scope_denied', 'not_found', 'stale_plan', 'stale_basis', 'command_conflict', 'already_authorized', 'authorization_expired', 'scoped_replanning_unavailable', 'prerequisite_unavailable', 'request_too_large', 'unsupported_media_type']);
const reason = (code: string) => ({stale_plan: 'The current plan revision changed.', stale_basis: 'The governing project or staffing changed.', authorization_expired: 'The authorization period is no longer valid.', already_authorized: 'This revision already has an authorization.', authorization_permission_missing: 'The owner connection lacks WorkOrder authorization permission.', authentication_required: 'Current owner authentication is required.', scope_denied: 'Current project access was denied.', prerequisite_unavailable: 'A required company prerequisite is unavailable.', scoped_replanning_unavailable: 'Existing tasks require a separate scoped replanning process.', command_conflict: 'The saved request identity has different accepted arguments.', invalid_request: 'The request did not meet the bounded contract.', request_too_large: 'The complete request is too large.'} as Record<string, string>)[code] ?? 'The current company policy does not permit this operation.';
function localDraft(value: unknown) {const draft = DraftSchema.parse(value); if (new TextEncoder().encode(JSON.stringify(draft)).length > 262144) throw new Error('DRAFT_BOUND'); return draft;}
export async function bindReviewedWorkOrder(value: WorkPlanAuthorizeResponse, request: WorkPlanAuthorizeRequest, plan: WorkPlanRecord) {
  const response = await validateWorkPlanResponse('authorize', workPlanCanonicalBytes(value), request), auth = response.authorization;
  if (!same(auth.plan_ref, workPlanRef(plan)) || auth.instruction_id !== plan.instruction_id || auth.owner_principal !== plan.owner_principal ||
    !same(auth.work_order.record.employee_ids, plan.plan.employee_ids) || auth.work_order.record.budget_cents !== plan.plan.budget_cents ||
    auth.recorded_at_epoch_seconds < plan.recorded_at_epoch_seconds || auth.policy_version !== plan.basis.policy_version ||
    plan.basis.staffing.some(grant => auth.expires_at_epoch_seconds > grant.expires_at_epoch_seconds)) throw new WorkPlanError('RESPONSE');
  return response;
}

/** Drafts and projections only; the trusted service owns every approval/WorkOrder. */
export function WorkPlanReview({projectId, instructionId, readOnly, onRecovered}: {projectId: string; instructionId: string; readOnly?: ApprovedJobRead; onRecovered?: (available: boolean) => void}) {
  const key = `company:leo-company:${readOnly ? 'approved-read' : 'work-plan'}:${instructionId}:v1`;
  const [saved, setSaved] = useState<Saved>(() => ({draft: blank()})), current = useRef(saved);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('Recovering plan draft…');
  const [fresh, setFresh] = useState(false), [online, setOnline] = useState(navigator.onLine), [accessDenied, setAccessDenied] = useState(false);
  const [expiry, setExpiry] = useState(() => localTime(Math.floor(Date.now() / 1000) + 900));
  const alive = useRef(true), locked = useRef(false), version = useRef(0), readAbort = useRef<AbortController | undefined>(undefined);
  const writing = useRef(0), recovering = useRef(true), recoveredCallback = useRef(onRecovered); recoveredCallback.current = onRecovered;
  const [remoteRevision, setRemoteRevision] = useState(0);
  useEffect(() => readOnly ? registerEditorHandoff(`company-read:${projectId}:${instructionId}`, async () => {
    if (locked.current || recovering.current) throw Error('Wait for the task read or recovery to finish before moving this view.');
  }) : undefined, [readOnly, projectId, instructionId]);
  useEffect(() => readOnly ? journalSubscribe(key, () => {
    if (!writing.current && !locked.current) {setReady(false); setFresh(false); setRemoteRevision(value => value + 1);}
  }) : undefined, [key, readOnly]);
  useEffect(() => {
    let active = true, restored = false; alive.current = true;
    recovering.current = true; setReady(false); setFresh(false);
    void (async () => {
      const raw = await journalRead<Saved>(key), value: Saved = {draft: raw ? localDraft(raw.draft) : blank()};
      if (raw?.proposalRequest) {const request = captureWorkPlanRequest('propose', raw.proposalRequest).request; if (request.project_id !== projectId || request.instruction_id !== instructionId) throw new Error('SCOPE'); value.proposalRequest = request; value.proposalConfirmed = raw.proposalConfirmed === true;}
      if (raw?.authorizationRequest) {const request = captureWorkPlanRequest('authorize', raw.authorizationRequest).request; if (request.project_id !== projectId) throw new Error('SCOPE'); value.authorizationRequest = request;}
      if (raw?.rejectedProposal && closedRejections.has(raw.rejectedProposal.code)) {const request = captureWorkPlanRequest('propose', raw.rejectedProposal.request).request; if (request.project_id !== projectId || request.instruction_id !== instructionId) throw new Error('SCOPE'); value.rejectedProposal = {request, code: raw.rejectedProposal.code};}
      if (raw?.rejectedAuthorization && closedRejections.has(raw.rejectedAuthorization.code)) {const request = captureWorkPlanRequest('authorize', raw.rejectedAuthorization.request).request; if (request.project_id !== projectId) throw new Error('SCOPE'); value.rejectedAuthorization = {request, code: raw.rejectedAuthorization.code};}
      if (raw?.proposalRejected && closedRejections.has(raw.proposalRejected) && value.proposalRequest) {value.proposalRejected = raw.proposalRejected; value.rejectedProposal = {request: value.proposalRequest, code: raw.proposalRejected};}
      if (raw?.authorizationRejected && closedRejections.has(raw.authorizationRejected) && value.authorizationRequest) {value.authorizationRejected = raw.authorizationRejected; value.rejectedAuthorization = {request: value.authorizationRequest, code: raw.authorizationRejected};}
      if (raw?.read) {value.read = readOnly ? await validateApprovedJobRead(raw.read, readOnly) : await validateWorkPlanResponse('read', workPlanCanonicalBytes(raw.read), {project_id: projectId, instruction_id: instructionId, plan_ref: workPlanRef(raw.read.plan)}); value.planRef = workPlanRef(value.read.plan);}
      else if (raw?.planRef) value.planRef = captureWorkPlanRequest('read', {project_id: projectId, instruction_id: instructionId, plan_ref: raw.planRef}).request.plan_ref ?? undefined;
      if (raw?.authorizationResponse && value.authorizationRequest) {if (!value.read) throw new Error('REVIEW_MISSING'); value.authorizationResponse = await bindReviewedWorkOrder(raw.authorizationResponse, value.authorizationRequest, value.read.plan);}
      value.accessDenied = raw?.accessDenied === true;
      if (active && alive.current) {restored = true; current.current = value; setSaved(value); setAccessDenied(value.accessDenied); setReady(true); setNotice(readOnly ? 'Read-only approved job selected. Load its current service record.' : 'Plan draft saved on this device. Read the service before authorizing.');}
    })().catch(() => {if (active && alive.current) setNotice('Plan recovery unavailable. Saved work has not been overwritten; keep this window open.');}).finally(() => {if (active && alive.current) {recovering.current = false; recoveredCallback.current?.(restored);}});
    const connect = () => setOnline(true), disconnect = () => {setOnline(false); setFresh(false); readAbort.current?.abort();};
    window.addEventListener('online', connect); window.addEventListener('offline', disconnect);
    return () => {active = false; alive.current = false; readAbort.current?.abort(); window.removeEventListener('online', connect); window.removeEventListener('offline', disconnect);};
  }, [key, projectId, instructionId, readOnly, remoteRevision]);
  async function persist(next: Saved) {writing.current++; try {await journalWrite(key, next); current.current = next; if (alive.current) setSaved(next);} finally {writing.current--;}}
  async function withdrawAccess() {setAccessDenied(true); setFresh(false); try {await persist({...current.current, accessDenied: true});} catch { /* UI remains hidden and native flush retains failed writes. */ }}
  function edit(patch: Partial<WorkPlanBody>) {
    if (!ready || locked.current) return;
    let draft: WorkPlanBody;
    try {draft = localDraft({...current.current.draft, ...patch});}
    catch {setNotice('This edit exceeds the local draft bound. Shorten it before saving; the previous saved draft is retained.'); return;}
    const next = {...current.current, draft}, edit = ++version.current;
    current.current = next; setSaved(next); setFresh(false); setNotice('Saving plan draft…');
    void journalWrite(key, next).then(() => {if (alive.current && edit === version.current) setNotice('Plan draft saved on this device · not submitted');}).catch(() => {if (alive.current && edit === version.current) setNotice('Plan save failed. Keep this window open.');});
  }
  function step(index: number, patch: Partial<WorkPlanBody['steps'][number]>) {
    const steps = current.current.draft.steps.map((item, at) => at === index ? {...item, ...patch} : item);
    edit({steps, employee_ids: [...new Set(steps.map(item => item.employee_id))]});
  }
  async function readPlan(currentHead = false) {
    if (!ready || locked.current || !online) return;
    locked.current = true; setBusy(true); setError(''); setFresh(false);
    const controller = new AbortController(); readAbort.current = controller;
    try {
      const old = current.current, ref = readOnly?.planRef ?? (currentHead ? null : old.authorizationRequest?.plan_ref ?? old.planRef ?? null);
      let view = await companyWorkPlan('read', {project_id: projectId, instruction_id: instructionId, plan_ref: ref}, controller.signal);
      if (readOnly) view = await validateApprovedJobRead(view, readOnly);
      let authorizationResponse = old.authorizationResponse;
      if (old.authorizationRequest && view.authorization) authorizationResponse = await bindReviewedWorkOrder(view.authorization, old.authorizationRequest, view.plan);
      const untouched = !old.draft.summary && !old.draft.steps.some(item => item.instruction);
      await persist({...old, draft: untouched ? view.plan.plan : old.draft, read: view, planRef: workPlanRef(view.plan), authorizationResponse, accessDenied: false});
      if (alive.current) {setAccessDenied(false); setFresh(true); setNotice('Exact plan and current eligibility read from the company service.');}
    } catch (cause) {if (alive.current && !controller.signal.aborted) {if (denied(cause)) await withdrawAccess(); setError(denied(cause) ? 'Current company access was denied. Protected plan records are hidden; local drafts remain saved.' : 'Exact plan read unavailable. No authorization was sent.');}}
    finally {locked.current = false; if (alive.current) setBusy(false);}
  }
  async function propose(recover = false) {
    if (readOnly || !ready || locked.current || !online) return;
    locked.current = true; setBusy(true); setError(''); setFresh(false);
    let sent = false;
    try {
      const old = current.current;
      const request = recover ? old.proposalRequest : captureWorkPlanRequest('propose', {project_id: projectId, instruction_id: instructionId, message_id: crypto.randomUUID(), expected_head_ref: old.planRef ?? null, plan: validateWorkPlanBody(old.draft)}).request;
      if (!request) return;
      await persist({...old, proposalRequest: request, proposalConfirmed: false, proposalRejected: undefined});
      sent = true;
      const result = await companyWorkPlan('propose', request);
      await persist({...current.current, planRef: workPlanRef(result.plan), proposalConfirmed: true});
      if (alive.current) setNotice('Proposed plan stored. Read its exact basis and eligibility before authorization.');
    } catch (cause) {
      if (sent && closedRejections.has(problem(cause)) && current.current.proposalRequest) {
        const rejected = {request: current.current.proposalRequest, code: problem(cause)};
        try {await persist({...current.current, proposalRejected: rejected.code, rejectedProposal: rejected});} catch { /* The original command stays retained if the outcome cannot be saved. */ }
        if (alive.current) {if (denied(cause)) await withdrawAccess(); setError(`Proposed plan was rejected. ${reason(rejected.code)} Read the current plan before choosing an explicit correction. The original request is retained.`);}
      } else if (alive.current) {if (denied(cause)) await withdrawAccess(); setError(sent ? 'Proposal outcome is unconfirmed. Check the saved proposal with its original identity.' : 'The proposed plan could not be saved or validated. Nothing was submitted.');}
    }
    finally {locked.current = false; if (alive.current) setBusy(false);}
  }
  async function authorize() {
    if (!canAuthorize || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    let sent = false;
    try {
      const old = current.current, request = captureWorkPlanRequest('authorize', {project_id: projectId, message_id: crypto.randomUUID(), plan_ref: workPlanRef(old.read!.plan), expires_at_epoch_seconds: expires}).request;
      await persist({...old, authorizationRequest: request, authorizationRejected: undefined}); // Exact envelope before network.
      setFresh(false); sent = true;
      const authorizationResponse = await bindReviewedWorkOrder(await companyWorkPlan('authorize', request), request, old.read!.plan);
      await persist({...current.current, authorizationResponse});
      if (alive.current) setNotice('Exact authorization receipt saved. The WorkOrder creates no tasks.');
    } catch (cause) {
      if (sent && closedRejections.has(problem(cause)) && current.current.authorizationRequest) {
        const rejected = {request: current.current.authorizationRequest, code: problem(cause)};
        try {await persist({...current.current, authorizationRejected: rejected.code, rejectedAuthorization: rejected});} catch { /* Preserve the original journal envelope. */ }
        if (alive.current) {if (denied(cause)) await withdrawAccess(); setFresh(false); setError(`Authorization was rejected. ${reason(rejected.code)} Read the exact plan and current eligibility before a new explicit decision. The original command and expiry are retained.`);}
      } else if (alive.current) {if (denied(cause)) await withdrawAccess(); setFresh(false); setError(sent ? 'Authorization outcome is unconfirmed. Recover the receipt by reading this exact plan; a new command will not be sent.' : 'Authorization could not be saved. No authorization was sent.');}
    }
    finally {locked.current = false; if (alive.current) setBusy(false);}
  }
  const view = !ready || accessDenied ? undefined : saved.read, authorization = !ready || accessDenied ? undefined : saved.authorizationResponse ?? view?.authorization ?? undefined;
  const pendingProposal = Boolean(saved.proposalRequest && !saved.proposalConfirmed && !saved.proposalRejected), pendingAuthorization = Boolean(saved.authorizationRequest && !saved.authorizationResponse && !saved.authorizationRejected);
  const draftMatches = Boolean(view && same(saved.draft, view.plan.plan));
  const expires = Date.parse(expiry) / 1000;
  const canAuthorize = !readOnly && ready && !busy && online && fresh && !accessDenied && !pendingProposal && !pendingAuthorization && !authorization && Boolean(view?.eligibility.can_authorize) && draftMatches && Number.isSafeInteger(expires) && expires > Date.now() / 1000;
  let validDraft = false; try {validateWorkPlanBody(saved.draft); validDraft = true;} catch { /* Keep partial drafts editable. */ }
  const editBlocked = !ready || busy || pendingProposal || pendingAuthorization;
  return <section className="company-work-plan" role="region" aria-label="Work plan review" aria-busy={busy}>
    <h3>{readOnly ? 'Approved job · read-only' : 'Review and authorize a work plan'}</h3><p>Owner-forwarded plan · no model provenance</p>
    <p>Storing a WorkOrder does not create tasks, reserve spend or start employees.</p>
    {readOnly && <p>Planned steps and staffing are not queued tasks or admitted employees. Current execution remains unavailable.</p>}
    <p role="status">{notice}</p>{error && <p role="alert">{error}</p>}
    <button disabled={!ready || busy || !online} onClick={() => void readPlan()}>{readOnly ? 'Load approved job' : pendingAuthorization ? 'Recover authorization receipt' : 'Read saved plan'}</button>
    {!readOnly && view && !view.eligibility.is_current && !saved.authorizationRequest && <button disabled={busy || !online || pendingProposal} onClick={() => void readPlan(true)}>Read current revision</button>}
    {!readOnly && !accessDenied && <details><summary>Prepare a proposed plan</summary>
      <label>Plan summary<textarea rows={2} value={saved.draft.summary} disabled={editBlocked} maxLength={2048} onChange={event => edit({summary: event.target.value})}/></label>
      <label>Budget ceiling (cents)<input type="number" min="0" step="1" value={saved.draft.budget_cents} disabled={editBlocked} onChange={event => {const value = Number(event.target.value); if (Number.isSafeInteger(value) && value >= 0) edit({budget_cents: value});}}/></label>
      {saved.draft.steps.map((item, index) => <fieldset key={item.key} disabled={editBlocked}><legend>Proposed step {index + 1}</legend>
        <label>Proposed employee<select value={item.employee_id} onChange={event => step(index, {employee_id: event.target.value as WorkPlanEmployee})}>{employees.map(id => <option key={id}>{id}</option>)}</select></label>
        <label>Step instruction<textarea rows={2} value={item.instruction} maxLength={2048} onChange={event => step(index, {instruction: event.target.value})}/></label>
        <label>Acceptance checks (one per line)<textarea value={item.acceptance_checks.join('\n')} maxLength={8192} rows={2} onChange={event => step(index, {acceptance_checks: event.target.value.split('\n')})}/></label>
        <div>Expected evidence{artifactTypes.map(type => <label key={type}><input type="checkbox" checked={item.expected_artifact_types.includes(type)} onChange={event => step(index, {expected_artifact_types: event.target.checked ? [...item.expected_artifact_types, type] : item.expected_artifact_types.filter(value => value !== type)})}/>{type.replaceAll('_', ' ')}</label>)}</div>
        {index > 0 && <label><input type="checkbox" checked={item.depends_on.includes(saved.draft.steps[index - 1].key)} onChange={event => step(index, {depends_on: event.target.checked ? [saved.draft.steps[index - 1].key] : []})}/>After the previous step</label>}
      </fieldset>)}
      <button disabled={editBlocked || saved.draft.steps.length >= 12} onClick={() => {const steps = [...saved.draft.steps, {...blank().steps[0], key: `step-${saved.draft.steps.length + 1}`}]; edit({steps, employee_ids: [...new Set(steps.map(item => item.employee_id))]});}}>Add proposed step</button>
      <p>Repository inputs are owner declarations, not verified repository observations.</p>
      {saved.draft.repository_inputs.map((item, index) => <fieldset key={index} disabled={editBlocked}><legend>Repository input {index + 1}</legend>{(['repository', 'revision'] as const).map(field => <label key={field}>{field === 'repository' ? 'Repository' : 'Pinned commit'}<input value={item[field]} maxLength={field === 'repository' ? 128 : 64} onChange={event => edit({repository_inputs: saved.draft.repository_inputs.map((input, at) => at === index ? {...input, [field]: event.target.value} : input)})}/></label>)}<label>Allowed paths (one per line)<textarea value={item.paths.join('\n')} maxLength={8192} onChange={event => edit({repository_inputs: saved.draft.repository_inputs.map((input, at) => at === index ? {...input, paths: event.target.value.split('\n')} : input)})}/></label></fieldset>)}
      <button disabled={editBlocked || saved.draft.repository_inputs.length >= 8} onClick={() => edit({repository_inputs: [...saved.draft.repository_inputs, {repository: '', revision: '', paths: ['']}]})}>Add repository input</button>
      {pendingProposal ? <button disabled={busy || !online} onClick={() => void propose(true)}>Check saved proposal</button> : <button disabled={editBlocked || !online || !validDraft || Boolean(saved.planRef && !view?.eligibility.is_current)} onClick={() => void propose()}>Store proposed plan</button>}
    </details>}
    {view && <div className="company-exact-plan"><strong>{view.plan.plan.summary}</strong><p>Project {view.plan.project_id} · revision {view.plan.revision} · budget ceiling ${(view.plan.plan.budget_cents / 100).toFixed(2)}</p>
      <p>Original instruction: {view.plan.basis.instruction.record.instruction}</p>
      <h4>Charter registration snapshot</h4><p>{view.plan.basis.charter.spec.name}: {view.plan.basis.charter.spec.purpose}</p><p>Repositories: {view.plan.basis.charter.spec.repositories.join(', ') || 'None'} · paths: {view.plan.basis.charter.spec.permitted_paths.join(', ') || 'None'}</p>
      <h4>{readOnly ? 'Planned staffing · not admitted' : 'Proposed staff · not admitted'}</h4><ul>{view.plan.basis.staffing.map(grant => <li key={grant.employee_id}>{grant.employee_id}: {grant.responsibility} · grant expires {displayTime(grant.expires_at_epoch_seconds)}</li>)}</ul>
      <ol>{view.plan.plan.steps.map(item => <li key={item.key}><strong>{item.employee_id}</strong>: {item.instruction}<p>Dependencies: {item.depends_on.join(', ') || 'None'} · evidence: {item.expected_artifact_types.join(', ')}</p><ul>{item.acceptance_checks.map((check, index) => <li key={index}>{check}</li>)}</ul></li>)}</ol>
      <ul>{view.plan.plan.repository_inputs.map(input => <li key={input.repository}>{input.repository} · {input.revision} · {input.paths.join(', ')}</li>)}</ul>
      {!fresh && <p>{readOnly ? 'Saved read · current eligibility has not been refreshed.' : 'Saved read · refresh exact eligibility before authorizing.'}</p>}
      {fresh && !view.eligibility.can_authorize && <p>Authorization unavailable: {view.eligibility.blockers.map(reason).join(' ') || 'Current service policy does not permit a new authorization.'}</p>}
      {!readOnly && !draftMatches && <p>Unsubmitted plan changes remain saved. Store and read a new exact revision before authorization.</p>}
      <details><summary>Exact scope and evidence references</summary><pre>{JSON.stringify({plan: workPlanRef(view.plan), currentHead: view.current_head_ref, basis: view.plan.basis, eligibility: view.eligibility}, null, 2)}</pre></details>
    </div>}
    {!readOnly && <><label>Authorization expiry<input type="datetime-local" step="1" value={expiry} disabled={busy || pendingAuthorization || Boolean(authorization)} onChange={event => setExpiry(event.target.value)}/></label>
    <p>Approve only the displayed revision, staff, budget and declared inputs through this expiry. Execution remains disabled.</p>
    <button disabled={!canAuthorize} onClick={() => void authorize()}>Authorize exact WorkOrder</button></>}
    {authorization && <section aria-label="Stored WorkOrder receipt"><strong>{fresh && view && !view.eligibility.authorization_current ? 'Historical authorization · current authority unavailable' : 'WorkOrder stored'}</strong><p>No tasks created · dispatch disabled · live readiness unverified</p><p>WorkOrder {authorization.authorization.work_order.id}</p><p>Original authorization expiry: {displayTime(authorization.authorization.expires_at_epoch_seconds)}</p><details><summary>Stored authorization receipt</summary><pre>{JSON.stringify(authorization, null, 2)}</pre></details></section>}
  </section>;
}
