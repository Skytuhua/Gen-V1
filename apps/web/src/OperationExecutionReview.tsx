import { useEffect, useState } from 'react';
import type { Operation, Thread } from '../../../packages/contracts';
import type { OperationExecutionReview } from '../../../packages/contracts/operation-execution-review';
import { getOperationExecutionReview } from './operation-execution-review-api';
import './operation-execution-review.css';

const staleReason = { OWNER_CHANGED: 'The operation owner changed.', ACTION_CHANGED: 'The prepared action changed.',
  STATE_CHANGED: 'The operation or conversation state changed.', TRUST_CHANGED: 'Project trust changed.', SOURCE_UNAVAILABLE: 'The recorded source cannot currently be compared.' } as const;
const unavailableReason = { NOT_RECORDED: 'No advisory was recorded for this operation.', INVALID_RECORD: 'The stored advisory could not be validated.',
  COMPUTATION_FAILED: 'Advisory computation was unavailable.' } as const;

/** A read-only view. No result from this component participates in readiness. */
export function OperationExecutionReviewPanel({ operation, owner, refreshToken, lazy = false }: {
  operation: Operation; owner?: Thread; refreshToken?: object; lazy?: boolean;
}) {
  const supported = operation.kind === 'repository.test' || operation.kind === 'integration.context7';
  const requestKey = JSON.stringify([operation.threadId, operation.id, operation.revision, operation.kind, operation.status, operation.approved,
    owner?.id, owner?.runId ?? null, owner?.epoch, owner?.accountId ?? null, owner?.projectId ?? null, owner?.workspaceId ?? null,
    owner?.modelId ?? null, owner?.mode ?? 'build', owner?.kind ?? 'main', owner?.sideParentId ?? null, owner?.status]);
  const [open, setOpen] = useState(!lazy), [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; refreshToken?: object; attempt: number; value?: OperationExecutionReview; error?: true }>();
  useEffect(() => {
    if (!supported || !open) return;
    let active = true;
    const key = requestKey, token = refreshToken, revision = attempt;
    void getOperationExecutionReview(operation, owner).then(value => {
      if (active) setResult({ key, refreshToken: token, attempt: revision, value });
    }).catch(() => { if (active) setResult({ key, refreshToken: token, attempt: revision, error: true }); });
    return () => { active = false; };
  }, [requestKey, refreshToken, attempt, open, supported]);
  if (!supported) return null;
  // Comparing the complete key/token in render also hides old results before
  // the previous effect's cleanup has run after a changed snapshot.
  const current = result?.key === requestKey && result.refreshToken === refreshToken && result.attempt === attempt ? result : undefined;
  const view = current?.value, advice = view?.advice, recorded = advice && advice.state !== 'UNAVAILABLE' ? advice.recorded : undefined;
  return <section className="operation-execution-review" aria-label="Execution review"><details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Execution review</summary>
    {open && <div className="execution-review-content">
      {!current && <p role="status" className="muted">Reading execution metadata…</p>}
      {current?.error && <p role="status" className="muted">Execution review is unavailable. Reload to read the current metadata.</p>}
      {view && <>
        <section aria-label="Recorded operation state"><h3>Current recorded state</h3>
          <p>Operation: {view.current.operationStatus}. Approval: {view.current.approved ? 'recorded' : 'not recorded'}.</p>
          {view.current.archived && <p>This conversation is archived.</p>}
          <p>Permission to run has not been evaluated here. The host still checks current trust, ownership and executable bytes before launch.</p>
        </section>
        <section aria-label="Actual execution policy"><h3>Actual execution: Unrestricted host</h3>
          <p>Backend: <code>{view.execution.backendId}</code>. Runner: <code>{view.execution.runner}</code>.</p>
          <p>Files: {view.execution.policy.filesystem}. Network: {view.execution.policy.network}. Child processes: {view.execution.policy.processes}.</p>
          <p>No approved isolation backend or platform proof is attached. Blocked stage: isolated execution.</p>
        </section>
        <section aria-label="Advisory"><h3>Advisory</h3>
          <p className="muted">Advisory cannot authorize this operation or override a trust denial.</p>
          {advice?.state === 'UNAVAILABLE' && <p>{unavailableReason[advice.reason]}</p>}
          {advice?.state === 'STALE' && <p><strong>Historical advice is stale.</strong> {staleReason[advice.reason]}</p>}
          {recorded && <><p>Historical preparation requirement: approval required.</p><p>{recorded.advisory.rationale}</p>
            <p>Model: {recorded.advisory.model}. Version: {recorded.advisory.version}. Uncertainty: {recorded.advisory.uncertainty}.</p>
            <p className="muted">Recorded <time dateTime={recorded.recordedAt}>{recorded.recordedAt}</time>. The action and files have not been revalidated by this metadata read.</p></>}
        </section>
      </>}
      <button type="button" className="quiet" disabled={!current} onClick={() => setAttempt(value => value + 1)}>Reload execution review</button>
    </div>}
  </details></section>;
}
