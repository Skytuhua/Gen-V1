import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { VerificationPanelModel as Model, VerificationPanelRow as Row } from '../../../packages/core/verification-read-models';
import { authenticated, command, read } from './api';
import {VerificationArtifact, isRetainedVerificationArtifact} from './VerificationArtifact';

/** M06 verification panel — additive read model. Columns: requirement,
 * observed check, source revision, outcome, freshness, verifier, evidence.
 * Stale results never render as green badges; a Stale banner marks evidence
 * bound to an older source cut. */

const LABEL_TEXT: Record<NonNullable<Model['label']>, string> = {
  VERIFIED: 'Verified',
  COMPLETED_UNVERIFIED: 'Completed unverified',
  FAILED: 'Failed',
  BLOCKED: 'Blocked',
};

function outcomeClass(outcome: string, freshness: Row['freshness']): string {
  if (freshness === 'STALE') return 'verification-outcome stale';
  if ((outcome === 'PASS' || outcome === 'VERIFIED') && freshness === 'CURRENT') return 'verification-outcome pass';
  if (outcome === 'FAIL' || outcome === 'FAILED') return 'verification-outcome fail';
  return 'verification-outcome other';
}

const rowKey = (row: Row, index: number) => JSON.stringify([row.requirement, row.checkId ?? `missing-${index}`]);
const detailsLabel = (row: Row) => `Check details for ${row.checkId} (${row.requirement})`;

function DetailField({label, children, wide = false}: {label: string; children: ReactNode; wide?: boolean}) {
  return <div className={wide ? 'verification-detail-wide' : undefined}><dt>{label}</dt><dd aria-label={label}>{children}</dd></div>;
}

function CheckDetails({row, id, threadId, close}: {row: Row; id: string; threadId: string; close: () => void}) {
  const panel = useRef<HTMLElement>(null), details = row.details!;
  const retained = row.evidence.filter(isRetainedVerificationArtifact);
  const [selected, select] = useState<string | null>(() => retained[0] ?? null);
  const active = selected && retained.includes(selected) ? selected : retained[0] ?? null;
  useEffect(() => {panel.current?.focus({preventScroll: true}); panel.current?.scrollIntoView({block: 'nearest'});}, []);
  return <section ref={panel} id={id} className="verification-check-details" aria-label={detailsLabel(row)} tabIndex={-1}>
    <header><div><h3>Check details</h3><p>{row.requirement} · {row.checkId}</p></div><button type="button" className="quiet" onClick={close}>Close check details</button></header>
    <dl>
      <DetailField label="Recorded outcome"><span className={outcomeClass(row.outcome, row.freshness)}>{row.outcome}</span></DetailField>
      <DetailField label="Current freshness">{row.freshness ?? 'Not reported'}</DetailField>
      <DetailField label="Arguments (JSON)" wide><pre tabIndex={0}>{JSON.stringify(details.argv, null, 2)}</pre></DetailField>
      <DetailField label="Working directory identity" wide><code>{details.cwdIdentity}</code></DetailField>
      <DetailField label="Code digest"><code>{details.codeDigest}</code></DetailField>
      <DetailField label="Dependency digest"><code>{details.dependencyDigest}</code></DetailField>
      <DetailField label="Recipe digest"><code>{details.recipeDigest}</code></DetailField>
      <DetailField label="Environment identity"><code>{details.environmentId}</code></DetailField>
      <DetailField label="Execution identity"><code>{row.verifier ?? 'Not reported'}</code></DetailField>
      <DetailField label="Observation kind">{details.observationKind}</DetailField>
      <DetailField label="Started"><time dateTime={details.startedAt}>{details.startedAt}</time></DetailField>
      <DetailField label="Ended"><time dateTime={details.endedAt}>{details.endedAt}</time></DetailField>
      <DetailField label="Exit code">{details.exitCode ?? 'Not reported'}</DetailField>
      <DetailField label="Recorded detail" wide><pre tabIndex={0}>{details.detail ?? 'Not reported'}</pre></DetailField>
    </dl>
    {details.visual && <><h4>Browser observation</h4><dl>
      <DetailField label="Expected" wide><pre tabIndex={0}>{details.visual.assertion}</pre></DetailField>
      <DetailField label="Observed" wide><pre tabIndex={0}>{details.visual.observed}</pre></DetailField>
      <DetailField label="Origin"><code>{details.visual.origin}</code></DetailField>
      <DetailField label="Viewport">{details.visual.viewport.width} × {details.visual.viewport.height}</DetailField>
      <DetailField label="Checklist item"><code>{details.visual.checklistItemId}</code></DetailField>
      <DetailField label="Action trace"><code>{details.visual.actionTraceId}</code></DetailField>
      <DetailField label="Screenshot digest" wide><code>{details.visual.screenshotDigest ?? 'Not captured'}</code></DetailField>
    </dl></>}
    <h4>Artifact references</h4>
    {row.evidence.length ? <ul>{row.evidence.map((ref, index) => <li key={index}>{isRetainedVerificationArtifact(ref) && <button type="button" className="quiet" aria-pressed={active === ref} onClick={() => select(ref)}>Artifact {index + 1}</button>}<code>{ref}</code></li>)}</ul> : <p>None recorded.</p>}
    {active && <VerificationArtifact key={`${threadId}:${active}`} threadId={threadId} artifactRef={active} />}
  </section>;
}

function SecurityFindings({findings}: {findings: NonNullable<Model['securityFindings']>}) {
  return <section className="verification-security-findings" aria-label="Security findings">
    <h3>Security findings</h3>
    <p>Review evidence does not verify task requirements. Source freshness is shown separately from the recorded status.</p>
    {findings.truncated && <p role="status">Showing the 50 most recent stored records.</p>}
    {findings.invalid > 0 && <p role="status">{findings.invalid} stored {findings.invalid === 1 ? 'record could' : 'records could'} not be read.</p>}
    {findings.items.map(finding => <details key={JSON.stringify([finding.findingId, finding.source, finding.executionId])}>
      <summary>{finding.findingId} · {finding.status} · {finding.evidenceQuality}</summary>
      <div className="verification-check-details"><dl>
        <DetailField label="Source path" wide><code>{finding.source.path}</code></DetailField>
        <DetailField label="Source blob"><code>{finding.source.blobSha}</code></DetailField>
        <DetailField label="Source line">{finding.source.line ?? 'Not reported'}</DetailField>
        <DetailField label="Recorded status">{finding.status}</DetailField>
        <DetailField label="Evidence quality">{finding.evidenceQuality}</DetailField>
        <DetailField label="Current source freshness">{finding.freshness}</DetailField>
        <DetailField label="Scope authority">{finding.scopeAuthority === 'HOST_RECORDED' ? 'Recorded by host' : 'Unverified legacy or prior-owner scope'}</DetailField>
        <DetailField label="Authorized scope" wide>{finding.authorizedScope}</DetailField>
        <DetailField label="Recorded observation" wide><pre tabIndex={0}>{finding.observation}</pre></DetailField>
        <DetailField label="Reported impact" wide><pre tabIndex={0}>{finding.impact}</pre></DetailField>
        <DetailField label="Reproduction" wide><pre tabIndex={0}>{finding.reproduction ?? 'Not recorded'}</pre></DetailField>
        <DetailField label="Finding execution"><code>{finding.executionId ?? 'Not recorded'}</code></DetailField>
        <DetailField label="First recorded"><time dateTime={finding.createdAt}>{finding.createdAt}</time></DetailField>
        <DetailField label="Last recorded"><time dateTime={finding.updatedAt}>{finding.updatedAt}</time></DetailField>
      </dl></div>
    </details>)}
  </section>;
}


type Workflow = NonNullable<Model['workflow']>;
const repairState: Record<NonNullable<Workflow['repair']>['state'], string> = {
  AWAITING_APPROVAL: 'Awaiting approval', RUNNING: 'Attempt running', READY: 'Ready for another attempt',
  BLOCKED: 'Cannot continue', STOPPING: 'Stopping and cleaning up', STOPPED: 'Repair stopped',
};
const repairStop = {PASSED: 'Checks passed', UNCHANGED_FAILURE: 'Repeated unchanged failure', BUDGET: 'Budget exhausted',
  REVOKED: 'Approval or execution authority revoked', CONFLICT: 'Source or owner changed', BLOCKED: 'Execution or cleanup unconfirmed', CANCELLED: 'Cancelled'};

function VerificationActions({threadId, workflow, refresh}: {threadId: string; workflow: Workflow; refresh: () => void}) {
  const alive = useRef(true), pending = useRef(false), latest = useRef(workflow);
  latest.current = workflow;
  const [loading, setLoading] = useState<string | null>(null), [waiting, setWaiting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(String(workflow.suggestedBudget.ms / 1000)), [tokens, setTokens] = useState(String(workflow.suggestedBudget.tokens));
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  useEffect(() => {setWaiting(false);}, [workflow]);
  const act = async (type: string, payload: Record<string, unknown>, label: string) => {
    if (pending.current || waiting) return;
    const captured = workflow, isCurrent = () => alive.current && latest.current.ownerKey === captured.ownerKey && latest.current.executionId === captured.executionId &&
      latest.current.repair?.planId === captured.repair?.planId && latest.current.repair?.revision === captured.repair?.revision;
    pending.current = true; setLoading(label); setNotice(null); setError(null);
    try {
      await command(type, payload, threadId, crypto.randomUUID(), isCurrent);
      if (isCurrent()) setNotice(type === 'verification.repair.stop' ? 'Repair stopped. Cleanup status is shown below.' : 'Verification prepared. Review and approve the new operation.');
    } catch (fault) {
      if (isCurrent()) setError(fault instanceof Error ? fault.message.slice(0, 500) : 'The verification request failed.');
    } finally {
      pending.current = false;
      if (alive.current) {setLoading(null); setWaiting(true); refresh();}
    }
  };
  const busy = Boolean(loading) || waiting, plan = workflow.repair;
  return <section className="verification-actions" aria-label="Verification actions" aria-busy={busy}>
    <p>Each run prepares a new operation for your approval. Previous check results remain in the history.</p>
    {plan && <div className="verification-repair" aria-label="Bounded repair progress">
      <h3>Bounded repair</h3>
      <p>{plan.attempts} of {plan.maxAttempts} attempts used · {repairState[plan.state]}</p>
      <p>{Math.ceil(plan.remainingMs / 1000)} seconds remaining · Deadline <time dateTime={plan.deadline}>{new Date(plan.deadline).toLocaleString()}</time></p>
      {workflow.qa && <p>{plan.remainingTokens} QA tokens remaining · {plan.reservedTokens} reserved for the running attempt</p>}
      {plan.state === 'AWAITING_APPROVAL' && <p>Review and approve the prepared operation to run this attempt.</p>}
      {plan.stopped && <p role="status">Stop reason: {repairStop[plan.stopped]}{plan.stopDetail ? '. ' + plan.stopDetail : '.'}</p>}
      {plan.state === 'BLOCKED' && plan.unavailableReason && <p role="status">{plan.unavailableReason}</p>}
      <div className="verification-action-buttons">
        {plan.canContinue && <button type="button" disabled={busy} onClick={() => void act('verification.repair.next', {planId: plan.planId, revision: plan.revision}, 'Preparing next attempt...')}>Prepare next attempt</button>}
        <button type="button" disabled={busy || !plan.canStop} onClick={() => void act('verification.repair.stop', {planId: plan.planId, revision: plan.revision}, 'Stopping repair...')}>Stop repair</button>
      </div>
    </div>}
    {!plan && workflow.canStartRepair && <form className="verification-budget" aria-label="Bounded repair budget" onSubmit={event => {
      event.preventDefault();
      const ms = Number(seconds) * 1000, allocation = workflow.qa ? Number(tokens) : 0;
      if (!Number.isInteger(ms) || ms < 1000 || ms > 1_800_000 || !Number.isInteger(allocation) || allocation < (workflow.qa ? 1 : 0) || allocation > 300_000) {
        setError('Choose a time limit from 1 to 1800 seconds and a QA token budget from 1 to 300000 when QA is included.'); return;
      }
      void act('verification.repair.start', {executionId: workflow.executionId, budget: {tokens: allocation, ms}}, 'Preparing bounded repair...');
    }}>
      <p>Bounded repair allows at most 3 approved attempts within the budget. Apply changes in your working copy before each attempt.</p>
      <label>Repair time limit (seconds)<input type="number" min="1" max="1800" step="1" required value={seconds} disabled={busy} onChange={event => setSeconds(event.target.value)} /></label>
      {workflow.qa && <label>Repair QA token budget<input type="number" min="1" max="300000" step="1" required value={tokens} disabled={busy} onChange={event => setTokens(event.target.value)} /></label>}
      <button type="submit" disabled={busy}>Start bounded repair</button>
    </form>}
    <div className="verification-action-buttons"><button type="button" disabled={busy || !workflow.canRerun} onClick={() => void act('verification.rerun', {executionId: workflow.executionId}, 'Preparing rerun...')}>Rerun checks</button></div>
    {plan && !plan.stopped && workflow.canRerun && <p>A separate rerun replaces the execution used to continue this repair.</p>}
    {workflow.unavailableReason && (!plan || plan.state === 'STOPPED') && <p role="status">{workflow.unavailableReason}</p>}
    {(loading || waiting || notice) && <p role="status">{loading ?? (waiting ? 'Refreshing verification...' : notice)}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function VerificationPanel({ threadId }: { threadId: string }) {
  return <VerificationReadPanel key={threadId} threadId={threadId} />;
}

function VerificationReadPanel({ threadId }: { threadId: string }) {
  const [state, setState] = useState<{threadId: string; model: Model | null; unavailable: boolean} | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null), opener = useRef<HTMLButtonElement | null>(null), id = useId();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await authenticated(() => fetch(`/api/threads/${encodeURIComponent(threadId)}/verification`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        }));
        const body = await read<{verification: Model}>(response);
        if (!controller.signal.aborted) setState({threadId, model: body.verification, unavailable: false});
      } catch {
        if (!controller.signal.aborted) setState({threadId, model: null, unavailable: true});
      } finally {
        // One read owns the next poll. A slower old response cannot replace a
        // newer source result, and a hidden owner has no outstanding request.
        if (!controller.signal.aborted) timer = setTimeout(() => void load(), 4000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [threadId, refresh]);
  // Render-time ownership matters: effects run after the newly selected owner
  // renders, so resetting state in an effect alone can show the prior result.
  const current = state?.threadId === threadId ? state : null;
  const model = current?.model;
  const expandedRow = model?.rows.find((row, index) => rowKey(row, index) === expanded && row.details);
  if (current?.unavailable) return <section className="verification-panel" aria-label="Verification">
    <p role="status">Verification unavailable. The current evidence could not be refreshed.</p>
  </section>;
  const hasFindings = Boolean(model?.securityFindings && (model.securityFindings.items.length || model.securityFindings.invalid || model.securityFindings.truncated));
  if (!model || (!model.label && !model.rows.length && !hasFindings && !model.workflow)) return null;
  return (
    <section className="verification-panel" aria-label="Verification" tabIndex={0}>
      <header>
        <span className="verification-title">Verification</span>
        {model.label && <span className={outcomeClass(model.label, 'CURRENT')}>{LABEL_TEXT[model.label]}</span>}
        {model.staleBanner && <span className="verification-stale-banner">Stale results — evidence belongs to an earlier source</span>}
      </header>
      {model.workflow && <VerificationActions key={model.workflow.ownerKey + ':' + model.workflow.executionId} threadId={threadId} workflow={model.workflow} refresh={() => setRefresh(value => value + 1)} />}
      {model.summary.missing.length > 0 && (
        <p className="verification-missing">Missing checks: {model.summary.missing.join('; ')}</p>
      )}
      {model.rows.length > 0 && <><p id={`${id}-scroll-help`} className="sr-only">Use the left and right arrow keys to scroll through all check columns.</p>
      <div className="verification-table-scroll" role="region" aria-label="Verification checks" aria-describedby={`${id}-scroll-help`} tabIndex={0}><table className="verification-table">
        <thead>
          <tr><th>Requirement</th><th>Observed check</th><th>Source revision</th><th>Outcome</th><th>Freshness</th><th>Verifier</th><th>Evidence</th></tr>
        </thead>
        <tbody>
          {model.rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              <td>{row.requirement}</td>
              <td>{row.details ? <button type="button" className="verification-check-trigger" aria-label={detailsLabel(row)} aria-expanded={expanded === rowKey(row, index)} aria-controls={`${id}-details`} onClick={event => {opener.current = event.currentTarget; setExpanded(previous => previous === rowKey(row, index) ? null : rowKey(row, index));}}><code>{row.check || row.checkId}</code></button> : <code>{row.check}</code>}{row.phase ? ` (${row.phase})` : ''}</td>
              <td><code>{row.sourceRevision}</code></td>
              <td><span className={outcomeClass(row.outcome, row.freshness)}>{row.outcome}</span></td>
              <td>{row.freshness ?? '—'}</td>
              <td>{row.verifier ?? '—'}</td>
              <td>{row.evidence.length ? row.evidence.map((ref, i) => <div key={i}><code>{ref}</code></div>) : row.missing.join('; ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div></>}
      {hasFindings && model.securityFindings && <SecurityFindings findings={model.securityFindings} />}
      {expandedRow && <CheckDetails key={expanded} id={`${id}-details`} row={expandedRow} threadId={threadId} close={() => {setExpanded(null); opener.current?.focus();}} />}
    </section>
  );
}
