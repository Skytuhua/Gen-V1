import { useCallback, useState } from 'react';
import { authenticated, csrfToken, read } from './api';
import { usePolling } from './usePolling';

/** M17 paired devices management surface (U01/G). The approval screen names
 * the claimed device fingerprint, the exact requested project scopes and the
 * read-only/control distinction: VIEW_TASKS is read-only, VIEW_EVIDENCE is a
 * separate explicit consent, and remote input submission is not available in
 * this release — no mutation control is ever presented as enabled (S08).
 * Revoke is local and immediate with a visible last-seen time. Remote access
 * requires a configured authenticated TLS transport; downloaded device data
 * cannot be remotely undisclosed with certainty (S09). */

interface DeviceRow {
  grantId: string; deviceId: string; label: string | null; fingerprint: string | null;
  scopes: string[]; approvedProjects: string[]; issuedAt: string; expiresAt: string | null;
  revokedAt: string | null; lastSeenAt: string | null; grantGeneration: number; state: string;
}
interface PendingRow {
  pairingId: string; deviceIdentity: { deviceId: string; label: string | null; fingerprint: string | null } | null;
  requestedScopes: string[]; requestedProjects: string[]; claimedAt: string | null; expiresAt: string;
}
interface DeviceSurface { devices: DeviceRow[]; pending: PendingRow[]; readOnly: boolean; submitInputAvailable: boolean }

const post = (url: string, body: unknown = {}) =>
  authenticated(() => fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken }, body: JSON.stringify(body) })).then(read<unknown>);
const SCOPE_LABEL: Record<string, string> = {
  VIEW_TASKS: 'Read tasks',
  VIEW_EVIDENCE: 'Read evidence (separate consent)',
  SUBMIT_INPUT: 'Submit input (unavailable)',
};
const projectLabel = (id: string) => id === 'personal' ? 'Personal tasks (no project)' : id;

export function PairedDevicesPanel() {
  const [surface, setSurface] = useState<DeviceSurface | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<{ pairingId: string; challenge: string; expiresAt: string } | null>(null);
  const [evidenceConsent, setEvidenceConsent] = useState(false);
  const load = useCallback(() => authenticated(() => fetch('/api/devices', { credentials: 'same-origin', cache: 'no-store' }))
    .then(read<DeviceSurface>).then(value => { setSurface(value); setError(''); }), []);
  const report = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);
  usePolling(load, 5000, report);
  const run = (action: () => Promise<unknown>) => { setBusy(true); void action().then(load).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false)); };

  const issue = () => run(async () => { setChallenge(await post('/api/device-pairing/challenges') as { pairingId: string; challenge: string; expiresAt: string }); });
  const confirm = (pending: PendingRow) => run(async () => {
    await post(`/api/device-pairing/${encodeURIComponent(pending.pairingId)}/confirm`, {
      scopes: pending.requestedScopes, projects: pending.requestedProjects,
      ...(pending.requestedScopes.includes('VIEW_EVIDENCE') ? { evidenceConsent } : {}),
    });
    setChallenge(null); setEvidenceConsent(false);
  });
  const deny = (pending: PendingRow) => run(() => post(`/api/device-pairing/${encodeURIComponent(pending.pairingId)}/deny`));
  const revoke = (device: DeviceRow) => run(() => post(`/api/devices/${encodeURIComponent(device.grantId)}/revoke`));

  return (
    <section className="settings-card paired-devices" data-setting-id="paired-devices-panel">
      <h2>Paired devices</h2>
      <p className="settings-card-intro">
        Paired devices receive a read-only view of approved projects over a configured authenticated TLS transport.
        Remote input submission is not available in this release, and devices never see task mutation controls.
        Data already downloaded to a device cannot be remotely undisclosed with certainty.
      </p>
      {error && <p role="alert" className="error-text">{error}</p>}
      {surface?.pending.map(pending => (
        <section key={pending.pairingId} className="settings-row" data-pairing-id={pending.pairingId}>
          <div className="settings-row-copy">
            <h2>Approve {pending.deviceIdentity?.label ?? pending.deviceIdentity?.deviceId ?? 'device'}?</h2>
            <p>
              Fingerprint: {pending.deviceIdentity?.fingerprint ?? 'not supplied'} ·
              Projects: {pending.requestedProjects.map(projectLabel).join(', ') || 'none'} ·
              Permission: {pending.requestedScopes.map(scope => SCOPE_LABEL[scope] ?? scope).join(', ') || 'none'} ·
              Read only — no remote control
            </p>
            {pending.requestedScopes.includes('VIEW_EVIDENCE') && (
              <label className="field"><input type="checkbox" checked={evidenceConsent} onChange={event => setEvidenceConsent(event.target.checked)} /> Explicitly consent to evidence read access</label>
            )}
          </div>
          <div className="settings-row-control">
            <button type="button" className="secondary" disabled={busy || (pending.requestedScopes.includes('VIEW_EVIDENCE') && !evidenceConsent)} onClick={() => confirm(pending)}>Approve read-only access</button>
            <button type="button" className="quiet" disabled={busy} onClick={() => deny(pending)}>Deny</button>
          </div>
        </section>
      ))}
      {challenge && (
        <section className="settings-row">
          <div className="settings-row-copy">
            <h2>Pairing code</h2>
            <p>Enter this one-time code on the device, then approve its request here. It expires {new Date(challenge.expiresAt).toLocaleTimeString()}.</p>
          </div>
          <code className="settings-value" data-challenge>{challenge.challenge}</code>
        </section>
      )}
      {(surface?.devices.length ?? 0) === 0 && !surface?.pending.length && !challenge && <p className="settings-empty">No paired devices.</p>}
      {surface?.devices.map(device => (
        <section key={device.grantId} className="settings-row" data-grant-id={device.grantId}>
          <div className="settings-row-copy">
            <h2>{device.label ?? device.deviceId}{device.state !== 'active' ? ` (${device.state})` : ''}</h2>
            <p>
              Fingerprint: {device.fingerprint ?? 'not supplied'} ·
              Projects: {device.approvedProjects.map(projectLabel).join(', ') || 'none'} ·
              {device.scopes.map(scope => SCOPE_LABEL[scope] ?? scope).join(', ')} ·
              Read only{device.lastSeenAt ? ` · Last seen ${new Date(device.lastSeenAt).toLocaleString()}` : ' · Never connected'}
            </p>
          </div>
          <div className="settings-row-control">
            {device.state === 'active' && <button type="button" className="secondary" disabled={busy} onClick={() => revoke(device)}>Revoke</button>}
          </div>
        </section>
      ))}
      <div className="settings-inline-controls">
        <button type="button" className="secondary" disabled={busy} onClick={issue}>Pair a device</button>
      </div>
    </section>
  );
}
