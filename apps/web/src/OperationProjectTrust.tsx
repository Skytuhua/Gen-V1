import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Operation, Thread } from '../../../packages/contracts';
import type { OperationProjectTrustReview, OperationProjectTrustStatus as TrustStatus } from '../../../packages/contracts/operation-project-trust';
import { Modal } from '../../../packages/ui-shell/Modal';
import { decideOperationProjectTrust, getOperationProjectTrust, getOperationProjectTrustStatus, revokeOperationProjectTrust } from './operation-project-trust-api';
import './operation-project-trust.css';
import {errorMessage} from '../../../packages/ui-shell/format-utils';

export interface ProjectTrustReadiness { key: string; allowed: boolean }

const labels = { required: 'Project trust required', trusted: 'Trusted reviewed bytes', declined: 'Project trust declined', revoked: 'Project trust revoked', invalidated: 'Reviewed bytes or owner changed' } as const;

/** One mounted session per complete operation/owner key. A late read or decision
 * from an earlier session cannot enable this operation's approval control. */
export function OperationProjectTrust({ operation, owner, ownerKey, onReady }: {
  operation: Operation; owner?: Thread; ownerKey: string; onReady(value: ProjectTrustReadiness): void;
}) {
  const target = useMemo(() => ({ threadId: operation.threadId, operationId: operation.id, operationRevision: operation.revision }),
    [operation.threadId, operation.id, operation.revision]);
  const capturedOwner = useMemo(() => owner, [ownerKey]);
  const [view, setView] = useState<OperationProjectTrustReview>(), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [actionError, setActionError] = useState(''), [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false), [hostSelected, setHostSelected] = useState(false), [expired, setExpired] = useState(false);
  const active = useRef(true), generation = useRef(0), locked = useRef(false);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  const load = useCallback(async () => {
    const request = ++generation.current;
    onReady({ key: ownerKey, allowed: false }); setLoading(true); setError(''); setView(undefined); setHostSelected(false);
    try {
      const next = await getOperationProjectTrust(target, capturedOwner);
      if (!active.current || request !== generation.current) return;
      setView(next); onReady({ key: ownerKey, allowed: !next.enabled || next.current.decision === 'trusted' });
    } catch (cause) {
      if (active.current && request === generation.current) setError(errorMessage(cause,'The project trust request could not be completed.'));
    } finally { if (active.current && request === generation.current) setLoading(false); }
  }, [target, capturedOwner, ownerKey, onReady]);
  useEffect(() => { void load(); }, [load]);
  const current = view?.enabled ? view : undefined;
  useEffect(() => {
    if (!current) { setExpired(false); return; }
    const remaining = Date.parse(current.expiresAt) - Date.now();
    setExpired(remaining <= 0);
    if (remaining <= 0) return;
    const timer = setTimeout(() => setExpired(true), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [current?.reviewId, current?.expiresAt]);
  const act = async (decision: 'trusted' | 'declined' | 'revoke') => {
    if (!current || locked.current || decision === 'trusted' && !hostSelected) return;
    if (decision !== 'revoke' && Date.parse(current.expiresAt) <= Date.now()) { setExpired(true); return; }
    locked.current = true; setBusy(true); setActionError(''); onReady({ key: ownerKey, allowed: false });
    try {
      if (decision === 'revoke') await revokeOperationProjectTrust({ ...target, trustId: current.current.trustId, expectedTrustRevision: current.current.revision });
      else await decideOperationProjectTrust({ ...target, reviewId: current.reviewId, expectedTrustRevision: current.current.revision,
        decision, ...(decision === 'trusted' ? { executionMode: 'TRUSTED_HOST' as const } : {}) });
      if (!active.current) return;
      setOpen(false); await load();
    } catch (cause) {
      if (active.current) { setActionError(errorMessage(cause,'The project trust request could not be completed.')); await load(); }
    } finally { locked.current = false; if (active.current) setBusy(false); }
  };
  if (view && !view.enabled) return null;
  return <section className="project-trust-summary" aria-label="Project trust">
    {loading && <p role="status" className="muted">Reading the current project trust requirement…</p>}
    {error && <p role="status" className="error-text">Project trust could not be reviewed. {error}</p>}
    {actionError && <p role="status" className="error-text">{actionError}</p>}
    {current && <><strong>{labels[current.current.decision]}</strong><p className="muted">Trust applies to these reviewed bytes. Each operation still requires its own approval.</p>
      <div className="decision-actions"><button type="button" className="secondary" disabled={busy} onClick={() => { setActionError(''); setHostSelected(false); setOpen(true); }}>Review project trust</button>
        {current.current.decision === 'trusted' && <button type="button" className="quiet" disabled={busy} onClick={() => void act('revoke')}>Revoke project trust</button>}</div></>}
    <button type="button" className="quiet" disabled={loading || busy} onClick={() => void load()}>Reload project trust</button>
    {current && <Modal open={open} title="Trust project bytes" onClose={() => { if (!busy) setOpen(false); }} className="dialog project-trust-dialog">
      <div className="project-trust-content">
        <section><h3>Deterministic decision</h3><p>{labels[current.current.decision]}.</p><p>Isolated execution is blocked for this operation because no approved isolation backend or platform proof is attached.</p></section>
        <section><h3>Project root</h3><code>{current.root.canonicalPath}</code><details><summary>Physical root identity</summary><code>Device {current.root.identity.dev}; file {current.root.identity.ino}</code></details></section>
        <section><h3>Reviewed executable and configuration</h3><dl><div><dt>Executable</dt><dd><code>{current.execution.executable.path}</code><code>SHA-256 {current.execution.executable.sha256}</code></dd></div>
          {current.approvedDigests.map(file => <div key={file.path}><dt>{file.kind}: {file.path}</dt><dd><code>SHA-256 {file.sha256}</code></dd></div>)}</dl></section>
        <section><h3>Requested project scope</h3><dl className="project-trust-scope"><dt>Read</dt><dd>{current.requestedScope.read ? 'Requested' : 'Not requested'}</dd><dt>Write</dt><dd>{current.requestedScope.write ? 'Requested' : 'Not requested'}</dd><dt>Network</dt><dd>{current.requestedScope.network === 'none' ? 'None granted by project trust' : 'Allowlisted destinations requested'}</dd></dl><p>Project trust records consent to the reviewed bytes. It does not enforce process isolation or authorize future writes.</p></section>
        <section><h3>Actual execution: {current.execution.label}</h3><p>The existing host runner uses your local user privileges for files, network access and child processes.</p><dl><dt>Working directory</dt><dd><code>{current.execution.cwd}</code></dd><dt>Exact arguments</dt><dd><code>{JSON.stringify(current.execution.argv)}</code></dd></dl>
          <label className="check-field"><input type="checkbox" checked={hostSelected} disabled={busy || expired} onChange={event => setHostSelected(event.target.checked)}/>Choose Unrestricted host for this operation</label></section>
        {expired && <p role="status" className="error-text">This review expired. Reload project trust before deciding.</p>}
        {actionError && <p role="status" className="error-text">{actionError}</p>}
        <footer className="dialog-actions"><button type="button" className="quiet" disabled={busy} onClick={() => void load()}>Reload project trust</button><button type="button" className="quiet" disabled={busy || expired} onClick={() => void act('declined')}>Decline</button><button type="button" className="primary" disabled={busy || expired || !hostSelected} onClick={() => void act('trusted')}>{busy ? 'Checking…' : 'Trust these bytes'}</button></footer>
      </div>
    </Modal>}
  </section>;
}

/** Recorded status can revoke a queued or running operation's trust, but never
 * enables approval or issues a new review token. Native launch rechecks bytes. */
export function OperationProjectTrustStatus({ operation, owner, ownerKey }: { operation: Operation; owner?: Thread; ownerKey: string }) {
  const target = useMemo(() => ({ threadId: operation.threadId, operationId: operation.id, operationRevision: operation.revision }),
    [operation.threadId, operation.id, operation.revision]);
  const capturedOwner = useMemo(() => owner, [ownerKey]);
  const [view, setView] = useState<TrustStatus>(), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [actionError, setActionError] = useState('');
  const active = useRef(true), generation = useRef(0), locked = useRef(false);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  const load = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError(''); setView(undefined);
    try {
      const next = await getOperationProjectTrustStatus(target, capturedOwner);
      if (active.current && request === generation.current) setView(next);
    } catch (cause) { if (active.current && request === generation.current) setError(errorMessage(cause,'The project trust request could not be completed.')); }
    finally { if (active.current && request === generation.current) setLoading(false); }
  }, [target, capturedOwner]);
  useEffect(() => { void load(); }, [load]);
  const current = view?.enabled ? view : undefined;
  const revoke = async () => {
    if (!current || locked.current) return;
    locked.current = true; setBusy(true); setActionError('');
    try {
      await revokeOperationProjectTrust({ ...target, trustId: current.current.trustId, expectedTrustRevision: current.current.revision });
      if (active.current) await load();
    } catch (cause) { if (active.current) { setActionError(errorMessage(cause,'The project trust request could not be completed.')); await load(); } }
    finally { locked.current = false; if (active.current) setBusy(false); }
  };
  if (view && !view.enabled) return null;
  return <section className="project-trust-summary" aria-label="Recorded project trust">
    {loading && <p role="status" className="muted">Reading recorded project trust…</p>}
    {error && <p role="status" className="error-text">Recorded project trust is unavailable. {error}</p>}
    {actionError && <p role="status" className="error-text">{actionError}</p>}
    {current && <><strong>{current.current.decision === 'trusted' ? 'Project trust recorded' : labels[current.current.decision]}</strong>
      <p className="muted">This is the recorded decision. The host checks the current bytes again before launch.</p>
      <p className="muted">{operation.status === 'running' ? 'Revoking trust prevents future launches. Use Stop to cancel the running operation.' : 'Revoking trust prevents this queued operation from starting.'}</p>
      {current.current.decision === 'trusted' && <button type="button" className="quiet" disabled={busy} onClick={() => void revoke()}>Revoke project trust</button>}</>}
    <button type="button" className="quiet" disabled={loading || busy} onClick={() => void load()}>Reload project trust status</button>
  </section>;
}
