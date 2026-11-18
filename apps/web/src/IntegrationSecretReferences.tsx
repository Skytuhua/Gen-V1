import { useCallback, useEffect, useRef, useState } from 'react';
import { integrationSecretReferenceStatusSchema, type IntegrationSecretReferenceStatus } from '../../../packages/contracts/integration-secrets.ts';
import { authenticated, read } from './api';

/** This surface reads public reference metadata only. It cannot resolve a
 * credential, prepare an action, approve delivery, or reveal a secret. */
export function IntegrationSecretReferences() {
  const [view, setView] = useState<IntegrationSecretReferenceStatus>(), [loading, setLoading] = useState(true), [unavailable, setUnavailable] = useState(false);
  const active = useRef(false), generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setUnavailable(false); setView(undefined);
    try {
      const response = await authenticated(() => fetch('/api/integrations/secret-references', { credentials: 'same-origin', cache: 'no-store' }));
      const parsed = integrationSecretReferenceStatusSchema.safeParse(await read<unknown>(response));
      if (!active.current || request !== generation.current) return;
      if (!parsed.success) { setUnavailable(true); return; }
      setView(parsed.data);
    } catch { if (active.current && request === generation.current) setUnavailable(true); }
    finally { if (active.current && request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; generation.current++; }; }, [load]);
  return <section aria-label="Secret references" className="secret-reference-settings" style={{ minWidth: 0, marginTop: 12 }}>
    <h3>Secret references</h3>
    {loading && <p role="status" className="muted">Reading secret reference metadata…</p>}
    {(unavailable || view?.unavailableReason) && <p role="status" className="error-text">Secret reference metadata is unavailable. Reload to check the current host status.</p>}
    {view && <>
      <p>{view.configured ? 'A Context7 credential is configured.' : 'No Context7 credential is configured.'}</p>
      {!view.enabled && <p className="muted">Secret reference approvals are disabled on this host.</p>}
      {view.references.map(reference => <div key={reference.refId} style={{ minWidth: 0 }}>
        <strong>{reference.purpose}</strong>
        <dl style={{ marginBlock: 8 }}>
          <dt>Reference</dt><dd style={{ marginInlineStart: 0 }}><code style={{ overflowWrap: 'anywhere' }}>{reference.refId}</code></dd>
          <dt>Owner</dt><dd style={{ marginInlineStart: 0 }}>{reference.owner}</dd>
          <dt>Permitted destination</dt><dd style={{ marginInlineStart: 0 }}>Process environment field <code>{reference.destination.envName}</code></dd>
          <dt>Executable SHA-256</dt><dd style={{ marginInlineStart: 0 }}><code style={{ overflowWrap: 'anywhere' }}>{reference.destination.executableSha256}</code></dd>
        </dl>
        <p className="muted">Each prepared action requires approval before this reference can be used. The credential value is never displayed here.</p>
      </div>)}
    </>}
    <button type="button" className="quiet" disabled={loading} onClick={() => void load()}>Reload secret references</button>
  </section>;
}
