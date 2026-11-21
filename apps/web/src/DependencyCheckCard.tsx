import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink, ShieldCheck } from 'lucide-react';
import { ErrorState } from '../../../packages/ui-shell/Feedback';
import { Select } from '../../../packages/ui-shell/Select';
import type { Operation } from '../../../packages/contracts/index.ts';
import type { DependencyCapability, DependencyFinding, DependencyScanResult } from './dependency-check-api';
import { dependencyApprove, dependencyCapability, dependencyDecline, dependencyResult, dependencyScanCancel, dependencyScanPrepare, dependencyScanRun } from './dependency-check-api';
import { journalWrite } from './journal';
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';

type Phase = 'loading' | 'idle' | 'prepared' | 'running' | 'done';
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'unknown'];
const SEVERITY_LABELS: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Moderate', low: 'Low', unknown: 'Unknown' };
const advisoryUrl = (id: string) => `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`dep-check-severity dep-check-severity-${severity}`} aria-label={`Severity ${SEVERITY_LABELS[severity] ?? severity}`}><ShieldCheck size={13} aria-hidden="true" />{SEVERITY_LABELS[severity] ?? severity}</span>;
}

function FindingRow({ finding, expanded, toggle, onUpgrade, stale }: { finding: DependencyFinding; expanded: boolean; toggle: () => void; onUpgrade: (finding: DependencyFinding) => void; stale?: boolean }) {
  const id = useId();
  const occ = finding.occurrence;
  return <li className="dep-check-row">
    <button type="button" className="dep-check-row-main" aria-expanded={expanded} aria-controls={id} onClick={toggle}>
      {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
      <span className="dep-check-name">{occ.name}</span>
      <span className="dep-check-class muted">{occ.directness} · {occ.lockPath}</span>
      <span className="dep-check-versions"><span className="sr-only">Installed version </span>{occ.installedVersion}<span aria-hidden="true"> → </span><span className="sr-only">fixed version </span>{finding.fixedVersions[0] ?? (finding.candidateEligible ? 'unknown' : 'no applicable fix')}</span>
      <SeverityBadge severity={finding.severity} />
    </button>
    {expanded && <div id={id} className="dep-check-detail">
      <dl>
        <div><dt>Advisories</dt><dd>{finding.advisoryIds.map((advisoryId, index) => <span key={advisoryId}>{index > 0 && ', '}<a href={advisoryUrl(advisoryId)} target="_blank" rel="noreferrer">{advisoryId}<ExternalLink size={11} aria-hidden="true" /></a></span>)}</dd></div>
        {finding.severitySource && <div><dt>Severity source</dt><dd>{finding.severitySource}</dd></div>}
        <div><dt>Fixed versions</dt><dd>{finding.fixedVersions.length ? finding.fixedVersions.join(', ') : 'None reported by the advisory'}</dd></div>
        {occ.importerPath && <div><dt>Manifest</dt><dd>{occ.importerPath}</dd></div>}
      </dl>
      {!stale && <button type="button" className="quiet" onClick={() => onUpgrade(finding)}>Ask agent to upgrade</button>}
    </div>}
  </li>;
}

export function DependencyCheckCard({ threadId, projectId }: { threadId: string; projectId: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [capability, setCapability] = useState<DependencyCapability | null>(null);
  const [op, setOp] = useState<Operation | null>(null);
  const [result, setResult] = useState<DependencyScanResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [github, setGithub] = useState(false);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  const [showRemote, setShowRemote] = useState(false);
  const [skeleton, setSkeleton] = useState(false);
  const mounted = useRef(true), poll = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { mounted.current = false; clearTimeout(poll.current); }, []);

  const loadResult = async (expected?: string) => {
    const found = await dependencyResult(projectId, threadId, expected);
    if (!mounted.current) return;
    if (found) { setResult(found); setPhase('done'); }
    else if (!expected) setPhase('idle');
    return found;
  };
  const pollResult = (scanId: string) => {
    const tick = async () => {
      if (!mounted.current) return;
      const found = await dependencyResult(projectId, threadId, scanId).catch(() => null);
      if (!mounted.current) return;
      if (found && found.scanId === scanId) { setResult(found); setPhase('done'); setSkeleton(false); return; }
      poll.current = setTimeout(() => void tick(), 1200);
    };
    void tick();
  };

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const cap = await dependencyCapability(projectId, threadId);
        if (!live) return;
        setCapability(cap);
        if (!cap.available) { setPhase('idle'); return; }
        setGithub(false);
        await loadResult();
      } catch { if (live) { setCapability({ available: false }); setPhase('idle'); } }
    })();
    return () => { live = false; };
  }, [projectId, threadId]);

  // Defer the skeleton 150ms so instant results never flash a loading frame.
  useEffect(() => {
    if (phase !== 'running') { setSkeleton(false); return; }
    const timer = setTimeout(() => setSkeleton(true), 150);
    return () => clearTimeout(timer);
  }, [phase]);

  const prepare = async () => {
    setBusy(true); setError('');
    try {
      const prepared = await dependencyScanPrepare(projectId, threadId, { github });
      if (!mounted.current) return;
      setOp(prepared); setPhase('prepared');
    } catch (cause) { if (mounted.current) setError(messageOf(cause)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const approve = async () => {
    if (!op) return;
    setBusy(true); setError('');
    try {
      await dependencyApprove(threadId, op.id, op.revision);
      await dependencyScanRun(projectId, threadId, op.id);
      if (!mounted.current) return;
      setPhase('running');
      pollResult(op.id);
    } catch (cause) { if (mounted.current) setError(messageOf(cause)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const decline = async () => {
    if (!op) return;
    setBusy(true); setError('');
    try { await dependencyDecline(threadId, op.id, op.revision); if (mounted.current) { setOp(null); setPhase('idle'); } }
    catch (cause) { if (mounted.current) setError(messageOf(cause)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const cancel = async () => {
    if (!op) return;
    setBusy(true); setError('');
    try { await dependencyScanCancel(projectId, threadId, op.id); if (mounted.current) { setPhase(result ? 'done' : 'idle'); } }
    catch (cause) { if (mounted.current) setError(messageOf(cause)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const askUpgrade = (finding: DependencyFinding) => {
    void journalWrite(`draft:${threadId}`, `Prepare an upgrade for dependency check ${result?.scanId ?? 'latest'}, finding ${finding.occurrence.occurrenceId}. Show the exact proposed change for my review; do not apply or commit it before approval.`);
  };

  const findings = useMemo(() => {
    const rows = (result?.findings ?? []).slice().sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
    return filter === 'all' ? rows : rows.filter(f => f.severity === filter);
  }, [result, filter]);
  const skipped = result?.coverage.filter(c => c.status !== 'scanned') ?? [];

  if (phase === 'loading' || (phase === 'idle' && capability && !capability.available)) return null;
  const running = phase === 'running';
  const stale = result?.status === 'stale' || result?.fresh === false;

  return <section className="dep-check" aria-label="Dependency check" tabIndex={0}>
    <header className="dep-check-header">
      <h2><ShieldCheck size={15} aria-hidden="true" />Dependency check</h2>
      <div className="dep-check-actions">
        {result && !running && !stale && <button type="button" className="quiet" disabled={busy} onClick={() => void prepare()}>Check again</button>}
        {phase === 'idle' && <button type="button" className="primary" disabled={busy} onClick={() => void prepare()}>{busy ? 'Preparing…' : 'Check dependencies'}</button>}
        {running && <button type="button" className="quiet" disabled={busy} onClick={() => void cancel()}>Cancel check</button>}
      </div>
    </header>
    <p className="sr-only" role="status" aria-live="polite">{running ? 'Dependency check in progress' : result ? `Dependency check ${result.status}` : ''}</p>

    {phase === 'idle' && capability?.available && <p className="dep-check-summary muted">Scans this working copy's lockfiles against the public OSV advisory database{capability.sources?.github ? ', with optional GitHub repository alerts' : ''}. No file contents or private paths leave this machine.</p>}
    {phase === 'idle' && capability?.sources?.github && <label className="dep-check-source"><input type="checkbox" checked={github} onChange={e => setGithub(e.target.checked)} /> Include GitHub repository alerts (uses your signed-in GitHub access)</label>}

    {phase === 'prepared' && op && <div className="dep-check-prepare" role="group" aria-label="Approve dependency check">
      <p>{op.description}</p>
      <div className="decision-actions">
        <button type="button" className="quiet" disabled={busy} onClick={() => void decline()}>Decline</button>
        <button type="button" className="primary" disabled={busy} onClick={() => void approve()}>{busy ? 'Approving…' : 'Approve and check'}<Check size={14} /></button>
      </div>
    </div>}

    {running && (skeleton
      ? <div className="dep-check-skeleton" aria-hidden="true"><div /><div /><div /></div>
      : <p className="muted" role="status">Checking dependencies…</p>)}
    {running && result && <p className="muted">Checking again — previous results stay until the new check completes.</p>}

    {phase === 'done' && result && <>
      <p className="dep-check-meta muted">
        {result.status === 'stale' && <span className="dep-check-stale"><AlertTriangle size={13} aria-hidden="true" /> Out of date — lockfiles changed since this check. Run a new check before acting on it.</span>}
        {result.status === 'partial' && <span className="dep-check-stale"><AlertTriangle size={13} aria-hidden="true" /> Partial — some advisory lookups did not answer; findings below may be incomplete.</span>}
        {result.status === 'unavailable' && <span className="dep-check-stale"><AlertTriangle size={13} aria-hidden="true" /> Unavailable — the advisory service did not answer.</span>}
        <span>Checked {new Date(result.checkedAt).toLocaleString()} · {result.queriedCount} packages queried · source OSV{result.remoteAlertState !== 'not_requested' ? ' + GitHub' : ''}</span>
      </p>
      {result.status !== 'unavailable' && <>
        <h3 className="dep-check-section">Local lockfile results <span className="muted">({result.findings.length})</span></h3>
        {result.findings.length > 0 && <div className="dep-check-filter"><Select value={filter} onValueChange={setFilter} aria-label="Filter findings by severity" options={[{ value: 'all', label: 'All severities' }, ...SEVERITY_ORDER.map(s => ({ value: s, label: SEVERITY_LABELS[s] }))]} />
          {filter !== 'all' && <button type="button" className="quiet" onClick={() => setFilter('all')}>Reset</button>}
        </div>}
        {result.findings.length === 0 && <p className="dep-check-clean"><Check size={14} aria-hidden="true" /> No known vulnerabilities in {result.queriedCount} queried packages.</p>}
        {result.findings.length > 0 && findings.length === 0 && <p className="muted" role="status">No findings match this filter.</p>}
        <ul className="dep-check-list">
          {findings.map(f => <FindingRow key={f.occurrence.occurrenceId + ':' + f.advisoryIds.join(',')} finding={f} onUpgrade={askUpgrade} stale={stale} expanded={expanded === f.occurrence.occurrenceId + f.advisoryIds.join(',')}
            toggle={() => setExpanded(expanded === f.occurrence.occurrenceId + f.advisoryIds.join(',') ? null : f.occurrence.occurrenceId + f.advisoryIds.join(','))} />)}
        </ul>
        {result.nextCursor && <button type="button" className="quiet" onClick={() => void loadResult(result.scanId).then(() => dependencyResult(projectId, threadId, result.scanId, result.nextCursor).then(page => page && setResult({ ...result, findings: [...result.findings, ...page.findings], nextCursor: page.nextCursor })))}>Show next 100 findings</button>}
        {result.coverage.length > 0 && <details className="dep-check-coverage" open={showCoverage} onToggle={e => setShowCoverage((e.target as HTMLDetailsElement).open)}>
          <summary>Coverage — {result.coverage.length} lockfiles considered, {skipped.length} skipped</summary>
          <ul>{result.coverage.map((c, i) => <li key={i}><code>{c.relativePath}</code> <span className="muted">{c.format} · {c.status.replace(/_/g, ' ')}{c.reason ? ` — ${c.reason}` : ''}</span></li>)}</ul>
        </details>}
        {result.remoteAlertState !== 'not_requested' && <details className="dep-check-remote" open={showRemote} onToggle={e => setShowRemote((e.target as HTMLDetailsElement).open)}>
          <summary>GitHub repository alerts ({result.remoteAlertState === 'available' ? result.remoteAlerts.length : result.remoteAlertState})</summary>
          {result.remoteAlertState === 'available' ? (result.remoteAlerts.length
            ? <ul>{result.remoteAlerts.map((a, i) => <li key={i}>{a.package} · {SEVERITY_LABELS[a.severity] ?? a.severity} · {a.advisoryIds.join(', ')}{a.matchedOccurrence ? '' : ' (no matching installed package)'}</li>)}</ul>
            : <p className="muted">No open repository alerts.</p>)
            : <p className="muted">GitHub alerts unavailable — kept as a separate source; local results above are unaffected.</p>}
        </details>}
      </>}
    </>}
    {error && <ErrorState message={error} onRetry={() => void prepare()} retryLabel="Retry check" />}
  </section>;
}
