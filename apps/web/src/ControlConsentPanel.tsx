import { useEffect, useState } from 'react';
import { authenticated, command, csrfToken, read } from './api';
import type { ControlSurfaceModelV1, ControlTargetCandidateV1 } from '../../../packages/contracts/interactive-control.ts';

/** M16 consented control surface. While input is active the persistent
 * indicator shows the controlled application/tab, allowed scope and Stop
 * (U01). The consent preview separates Observe from Interact and names
 * expiry/origins (U02). With no approved driver the surface presents the
 * unavailable state: no live control is active. Captures can include private
 * data — capture never implies secrets are hidden (S05). */

const MODE_LABEL: Record<string, string> = {
  FRESH_VERIFICATION_BROWSER: 'Fresh verification browser',
  CONSENTED_EXISTING_TAB: 'Consented existing tab',
  SELECTED_DESKTOP_APPLICATION: 'Selected desktop application',
};

const post = <T,>(url: string, body: unknown = {}) => authenticated(() => fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken }, body: JSON.stringify(body) })).then(read<T>);

export function ControlConsentPanel({ threadId }: { threadId: string }) {
  const [model, setModel] = useState<ControlSurfaceModelV1 | null>(null);
  const [targets, setTargets] = useState<ControlTargetCandidateV1[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [capture, setCapture] = useState<{ artifactRef: string; sha256: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => authenticated(() => fetch(`/api/threads/${encodeURIComponent(threadId)}/control`, { credentials: 'same-origin', cache: 'no-store' }))
      .then(read<{ control: ControlSurfaceModelV1 }>)
      .then(body => { if (!cancelled) setModel(body.control); })
      .catch(() => {});
    load();
    const timer = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [threadId]);
  // The indicator exists only while control is live or consent is pending;
  // an untouched capability stays silent rather than claiming activity.
  if (!model || (model.state === 'unavailable' && !model.pendingConsent)) return null;
  if (model.state === 'unavailable') {
    return (
      <section className="control-consent-panel" aria-label="Browser and desktop control">
        <header><span className="control-consent-title">Browser and desktop control</span><span className="control-consent-state">Unavailable</span></header>
        <p>No live control is active{model.reason ? ` — ${model.reason}` : ''}.</p>
        <ul className="control-consent-modes">
          {model.modes.map(mode => <li key={mode.mode}>{MODE_LABEL[mode.mode] ?? mode.mode}: unavailable{mode.reason ? ` (${mode.reason})` : ''}</li>)}
        </ul>
        <p>Observe and Interact are separate permissions; neither is granted. Screenshots can include private data and are not automatically redacted.</p>
        <button type="button" disabled>Stop</button>
      </section>
    );
  }
  const refresh = () => void authenticated(() => fetch(`/api/threads/${encodeURIComponent(threadId)}/control`, { credentials: 'same-origin', cache: 'no-store' }))
    .then(read<{ control: ControlSurfaceModelV1 }>)
    .then(body => setModel(body.control))
    .catch(() => {});
  if (model.state === 'consent' && model.pendingConsent) {
    const pending = model.pendingConsent;
    // Target selection is explicit: the approved driver names each candidate
    // and the user picks the exact one the grant binds to (S02/U02). For the
    // desktop mode the driver's OS picker runs inside this request.
    const loadTargets = () => {
      setBusy(true); setNote(null); setTargets(null); setSelected(null);
      void authenticated(() => fetch(`/api/threads/${encodeURIComponent(threadId)}/control-targets?mode=${encodeURIComponent(pending.mode)}`, { credentials: 'same-origin', cache: 'no-store' }))
        .then(read<{ candidates: ControlTargetCandidateV1[] }>)
        .then(body => { setTargets(body.candidates); if (!body.candidates.length) setNote('No target is available for this mode.'); })
        .catch(cause => setNote(cause instanceof Error ? cause.message : 'Targets could not be listed.'))
        .finally(() => setBusy(false));
    };
    const approve = () => {
      if (selected === null || !targets?.[selected]) return;
      setBusy(true); setNote(null);
      void command('control.grant', { consentId: pending.consentId, target: targets[selected].target }, threadId)
        .then(receipt => { const control = (receipt.result as { control?: ControlSurfaceModelV1 }).control; if (control) setModel(control); setTargets(null); })
        .catch(cause => setNote(cause instanceof Error ? cause.message : 'The consent could not be granted.'))
        .finally(() => setBusy(false));
    };
    const decline = () => {
      void command('control.stop', {}, threadId).then(receipt => { const control = (receipt.result as { control?: ControlSurfaceModelV1 }).control; if (control) setModel(control); setTargets(null); }).catch(() => {});
    };
    return (
      <section className="control-consent-panel" aria-label="Browser and desktop control">
        <header><span className="control-consent-title">Browser and desktop control</span><span className="control-consent-state">Needs permission</span></header>
        <p>{MODE_LABEL[pending.mode] ?? pending.mode}</p>
        <p>Observe: {pending.requestedObserve ? 'requested' : 'not requested'} · Interact: {pending.requestedOperations.length ? pending.requestedOperations.join(', ') : 'not requested'} · Expires 10 minutes after approval.</p>
        {pending.allowedOrigins.length > 0 && <p>Origins: {pending.allowedOrigins.join(', ')}</p>}
        {targets === null && <p><button type="button" onClick={loadTargets} disabled={busy}>{pending.mode === 'SELECTED_DESKTOP_APPLICATION' ? 'Choose a window…' : 'List targets'}</button></p>}
        {targets !== null && (
          <ul className="control-consent-targets">
            {targets.map((candidate, index) => (
              <li key={candidate.target.creationIdentity}>
                <label>
                  <input type="radio" name="control-target" checked={selected === index} onChange={() => setSelected(index)} />
                  {candidate.title ?? candidate.target.creationIdentity}
                </label>
              </li>
            ))}
          </ul>
        )}
        {note && <p>{note}</p>}
        <p>Screenshots can include private data and are not automatically redacted.</p>
        <p>
          <button type="button" onClick={approve} disabled={busy || selected === null}>Approve</button>
          <button type="button" onClick={decline} disabled={busy}>Decline</button>
        </p>
      </section>
    );
  }
  const grant = model.activeGrant!;
  // Independent Stop (S04/U01): revokes the grant through the host command
  // path; only this thread's own control connection is closed (G03).
  const stop = () => { void command('control.stop', {}, threadId).then(receipt => { const control = (receipt.result as { control?: ControlSurfaceModelV1 }).control; if (control) setModel(control); }).catch(() => {}); };
  const captureTarget = () => {
    setBusy(true); setNote(null);
    void post<{ capture: { artifactRef: string; sha256: string } }>(`/api/threads/${encodeURIComponent(threadId)}/control-capture`)
      .then(body => setCapture(body.capture))
      .catch(cause => setNote(cause instanceof Error ? cause.message : 'The capture failed.'))
      .finally(() => { setBusy(false); refresh(); });
  };
  return (
    <section className="control-consent-panel" aria-label="Browser and desktop control" role="status">
      <header><span className="control-consent-title">Controlled {grant.target.kind === 'BROWSER_TAB' ? 'tab' : 'application'}</span><span className="control-consent-state">Active</span></header>
      <p>{MODE_LABEL[grant.mode] ?? grant.mode} · Observe {grant.capturePermission ? 'allowed' : 'not allowed'} · Interact {grant.permittedOperations.length ? grant.permittedOperations.join(', ') : 'not allowed'}</p>
      {model.expiryMs !== null && <p>Permission expires in {Math.max(0, Math.ceil(model.expiryMs / 1000))}s{grant.allowedOrigins.length ? ` · Origins: ${grant.allowedOrigins.join(', ')}` : ''}</p>}
      {grant.capturePermission && <p><button type="button" onClick={captureTarget} disabled={busy}>Capture</button>{capture && <span> saved {capture.artifactRef} (sha256 {capture.sha256.slice(0, 12)}…)</span>}</p>}
      {note && <p>{note}</p>}
      <button type="button" onClick={stop}>Stop</button>
    </section>
  );
}
