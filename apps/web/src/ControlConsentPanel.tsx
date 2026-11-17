import { useEffect, useState } from 'react';
import { authenticated, read } from './api';
import type { ControlSurfaceModelV1 } from '../../../packages/contracts/interactive-control.ts';

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

export function ControlConsentPanel({ threadId }: { threadId: string }) {
  const [model, setModel] = useState<ControlSurfaceModelV1 | null>(null);
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
  if (model.state === 'consent' && model.pendingConsent) {
    return (
      <section className="control-consent-panel" aria-label="Browser and desktop control">
        <header><span className="control-consent-title">Browser and desktop control</span><span className="control-consent-state">Needs permission</span></header>
        <p>{MODE_LABEL[model.pendingConsent.mode] ?? model.pendingConsent.mode}</p>
        <p>Observe: {model.pendingConsent.requestedObserve ? 'requested' : 'not requested'} · Interact: {model.pendingConsent.requestedOperations.length ? model.pendingConsent.requestedOperations.join(', ') : 'not requested'} · Expires 10 minutes after approval.</p>
        {model.pendingConsent.allowedOrigins.length > 0 && <p>Origins: {model.pendingConsent.allowedOrigins.join(', ')}</p>}
        <p>Screenshots can include private data and are not automatically redacted.</p>
        <button type="button" disabled>Stop</button>
      </section>
    );
  }
  const grant = model.activeGrant!;
  return (
    <section className="control-consent-panel" aria-label="Browser and desktop control" role="status">
      <header><span className="control-consent-title">Controlled {grant.target.kind === 'BROWSER_TAB' ? 'tab' : 'application'}</span><span className="control-consent-state">Active</span></header>
      <p>{MODE_LABEL[grant.mode] ?? grant.mode} · Observe {grant.capturePermission ? 'allowed' : 'not allowed'} · Interact {grant.permittedOperations.length ? grant.permittedOperations.join(', ') : 'not allowed'}</p>
      {model.expiryMs !== null && <p>Permission expires in {Math.max(0, Math.ceil(model.expiryMs / 1000))}s{grant.allowedOrigins.length ? ` · Origins: ${grant.allowedOrigins.join(', ')}` : ''}</p>}
      <button type="button">Stop</button>
    </section>
  );
}
