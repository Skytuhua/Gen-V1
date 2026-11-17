import { useEffect, useState } from 'react';
import { authenticated, read } from './api';

/** M06 verification panel — additive read model. Columns: requirement,
 * observed check, source revision, outcome, freshness, verifier, evidence.
 * Stale results never render as green badges; a Stale banner marks evidence
 * bound to an older source cut. */

interface Row {
  requirement: string;
  checkId: string | null;
  check: string;
  phase: string | null;
  sourceRevision: string;
  outcome: string;
  freshness: 'CURRENT' | 'STALE' | 'INDETERMINATE' | null;
  verifier: string | null;
  evidence: string[];
  missing: string[];
}

interface Model {
  label: 'VERIFIED' | 'COMPLETED_UNVERIFIED' | 'FAILED' | 'BLOCKED' | null;
  staleBanner: boolean;
  summary: { verified: number; failed: number; unverified: number; blocked: number; missing: string[] };
  rows: Row[];
}

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

export function VerificationPanel({ threadId }: { threadId: string }) {
  return <VerificationReadPanel key={threadId} threadId={threadId} />;
}

function VerificationReadPanel({ threadId }: { threadId: string }) {
  const [state, setState] = useState<{threadId: string; model: Model | null; unavailable: boolean} | null>(null);
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
  if (current?.unavailable) return <section className="verification-panel" aria-label="Verification">
    <p role="status">Verification unavailable. The current evidence could not be refreshed.</p>
  </section>;
  if (!model || (!model.label && !model.rows.length)) return null;
  return (
    <section className="verification-panel" aria-label="Verification">
      <header>
        <span className="verification-title">Verification</span>
        {model.label && <span className={outcomeClass(model.label, model.staleBanner ? 'STALE' : 'CURRENT')}>{LABEL_TEXT[model.label]}</span>}
        {model.staleBanner && <span className="verification-stale-banner">Stale results — evidence belongs to an earlier source</span>}
      </header>
      {model.summary.missing.length > 0 && (
        <p className="verification-missing">Missing checks: {model.summary.missing.join('; ')}</p>
      )}
      <table className="verification-table">
        <thead>
          <tr><th>Requirement</th><th>Observed check</th><th>Source revision</th><th>Outcome</th><th>Freshness</th><th>Verifier</th><th>Evidence</th></tr>
        </thead>
        <tbody>
          {model.rows.map((row, index) => (
            <tr key={row.checkId ?? `missing-${index}`}>
              <td>{row.requirement}</td>
              <td><code>{row.check}</code>{row.phase ? ` (${row.phase})` : ''}</td>
              <td><code>{row.sourceRevision}</code></td>
              <td><span className={outcomeClass(row.outcome, row.freshness)}>{row.outcome}</span></td>
              <td>{row.freshness ?? '—'}</td>
              <td>{row.verifier ?? '—'}</td>
              <td>{row.evidence.length ? row.evidence.map((ref, i) => <div key={i}><code>{ref}</code></div>) : row.missing.join('; ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
