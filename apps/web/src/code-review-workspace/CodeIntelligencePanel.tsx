import type {
  CodeDiagnostic, DiagnosticObservationV1, EditPreviewV1, RenameRecoveryEntry, DebugSessionV1,
} from '../../../../packages/contracts/code-intelligence';

/** M07 review-pane surface. Data arrives as contract-shaped props; every row
 * opens an exact file revision + range via onOpenLocation. The panel itself
 * never fabricates intelligence: with no observation it reports the missing
 * baseline instead of pretending all diagnostics are new. */

export interface CodeIntelligencePanelProps {
  problems: {
    state: DiagnosticObservationV1['state'];
    baselineStatus: 'AVAILABLE' | 'UNAVAILABLE';
    introduced: CodeDiagnostic[];
    existing: CodeDiagnostic[];
    stale: CodeDiagnostic[];
  } | null;
  previews: EditPreviewV1[];
  rename: { planId: string; entries: RenameRecoveryEntry[] } | null;
  debug: {
    session: DebugSessionV1 | null;
    /** Disabled commands carry the reason (missing approval or confinement). */
    inspectEnabled: boolean;
    effectEnabled: boolean;
    disabledReason?: string;
  } | null;
  onOpenLocation?: (path: string, range: CodeDiagnostic['range']) => void;
}

function DiagnosticRow({ diagnostic, onOpen }: { diagnostic: CodeDiagnostic; onOpen?: (path: string, range: CodeDiagnostic['range']) => void }) {
  return <li className="cr-problem" data-severity={diagnostic.severity}>
    <button type="button" onClick={() => onOpen?.(diagnostic.path, diagnostic.range)} title={`${diagnostic.path}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`}>
      <span className="cr-problem-severity">{diagnostic.severity}</span>
      <span className="cr-problem-message">{diagnostic.message}</span>
      <span className="cr-meta">{diagnostic.path}:{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}</span>
    </button>
  </li>;
}

export function CodeIntelligencePanel({ problems, previews, rename, debug, onOpenLocation }: CodeIntelligencePanelProps) {
  return <>
    <section aria-label="Problems">
      <h2>Problems</h2>
      {!problems && <p className="cr-meta">No diagnostic observation for this revision.</p>}
      {problems?.state === 'UNAVAILABLE' && <p className="cr-meta">Diagnostics unavailable for this revision.</p>}
      {problems?.baselineStatus === 'UNAVAILABLE' && <p className="cr-meta">Baseline unavailable — existing diagnostics are not shown as new.</p>}
      {problems && problems.introduced.length > 0 && <>
        <h3>Introduced</h3>
        <ul className="cr-problems">{problems.introduced.map((d, i) => <DiagnosticRow key={`i${i}`} diagnostic={d} onOpen={onOpenLocation} />)}</ul>
      </>}
      {problems && problems.existing.length > 0 && <>
        <h3>Existing{problems.baselineStatus === 'UNAVAILABLE' ? ' (no baseline)' : ''}</h3>
        <ul className="cr-problems">{problems.existing.map((d, i) => <DiagnosticRow key={`e${i}`} diagnostic={d} onOpen={onOpenLocation} />)}</ul>
      </>}
      {problems && problems.stale.length > 0 && <>
        <h3>Stale</h3>
        <ul className="cr-problems">{problems.stale.map((d, i) => <DiagnosticRow key={`s${i}`} diagnostic={d} onOpen={onOpenLocation} />)}</ul>
      </>}
    </section>
    {previews.length > 0 && <section aria-label="Edit previews">
      <h2>Edit previews</h2>
      <ul className="cr-previews">{previews.map(preview => <li key={preview.previewId}>
        <span className="cr-preview-files">{preview.targetFiles.map(file => file.path).join(', ')}</span>
        {(preview.state === 'STREAMING_UNAPPLIED' || preview.state === 'READY_UNAPPLIED') && <span className="cr-badge-not-applied" role="status">Not applied</span>}
        {preview.state === 'APPLIED' && <span className="cr-meta">Applied</span>}
        {preview.state === 'INVALID' && <span className="cr-meta" role="alert">Invalid — rebuild the preview</span>}
        {preview.state === 'CONFLICT' && <span className="cr-meta" role="alert">Conflict — the file changed</span>}
      </li>)}</ul>
    </section>}
    {rename && <section aria-label="Rename result">
      <h2>Rename result</h2>
      <ul className="cr-rename">{rename.entries.map(entry => <li key={entry.path} data-disposition={entry.disposition}>
        <span className="cr-file-path">{entry.path}</span>
        <span className="cr-meta">{entry.disposition}{entry.detail ? ` — ${entry.detail}` : ''}</span>
      </li>)}</ul>
    </section>}
    {debug && <section aria-label="Debug">
      <h2>Debug</h2>
      {!debug.session && <p className="cr-meta">No debug session.</p>}
      {debug.session && <p className="cr-meta">{debug.session.state} · recipe {debug.session.approvedRecipe}</p>}
      <div className="cr-debug-controls">
        <button type="button" disabled={!debug.inspectEnabled} title={debug.inspectEnabled ? undefined : debug.disabledReason}>Inspect</button>
        <button type="button" disabled={!debug.effectEnabled} title={debug.effectEnabled ? undefined : debug.disabledReason}>Run / Continue / Step</button>
      </div>
      {!debug.effectEnabled && debug.disabledReason && <p className="cr-meta">{debug.disabledReason}</p>}
    </section>}
  </>;
}
