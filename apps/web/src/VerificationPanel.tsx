import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { VerificationPanelModel as Model, VerificationPanelRow as Row } from '../../../packages/core/verification-read-models';
import { authenticated, read } from './api';
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

export function VerificationPanel({ threadId }: { threadId: string }) {
  return <VerificationReadPanel key={threadId} threadId={threadId} />;
}

function VerificationReadPanel({ threadId }: { threadId: string }) {
  const [state, setState] = useState<{threadId: string; model: Model | null; unavailable: boolean} | null>(null);
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
  }, [threadId]);
  // Render-time ownership matters: effects run after the newly selected owner
  // renders, so resetting state in an effect alone can show the prior result.
  const current = state?.threadId === threadId ? state : null;
  const model = current?.model;
  const expandedRow = model?.rows.find((row, index) => rowKey(row, index) === expanded && row.details);
  if (current?.unavailable) return <section className="verification-panel" aria-label="Verification">
    <p role="status">Verification unavailable. The current evidence could not be refreshed.</p>
  </section>;
  if (!model || (!model.label && !model.rows.length)) return null;
  return (
    <section className="verification-panel" aria-label="Verification" tabIndex={0}>
      <header>
        <span className="verification-title">Verification</span>
        {model.label && <span className={outcomeClass(model.label, model.staleBanner ? 'STALE' : 'CURRENT')}>{LABEL_TEXT[model.label]}</span>}
        {model.staleBanner && <span className="verification-stale-banner">Stale results — evidence belongs to an earlier source</span>}
      </header>
      {model.summary.missing.length > 0 && (
        <p className="verification-missing">Missing checks: {model.summary.missing.join('; ')}</p>
      )}
      <p id={`${id}-scroll-help`} className="sr-only">Use the left and right arrow keys to scroll through all check columns.</p>
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
      </table></div>
      {expandedRow && <CheckDetails key={expanded} id={`${id}-details`} row={expandedRow} threadId={threadId} close={() => {setExpanded(null); opener.current?.focus();}} />}
    </section>
  );
}
