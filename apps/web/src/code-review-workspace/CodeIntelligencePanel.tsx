import type {ReactNode} from 'react';
import {CircleX, Info, Lightbulb, TriangleAlert} from 'lucide-react';
import type {
  CodeDiagnostic, DiagnosticObservationV1, DebugSessionV1, EditPreviewV1, RenameDisposition, RenameRecoveryEntry,
} from '../../../../packages/contracts/code-intelligence';

/** M07 review-context sections: problems, proposed edits, rename outcome and
 * the debugger. Data arrives as contract-shaped props. The panel never
 * fabricates intelligence and only renders controls the host can act on. */

export type DebugControl = 'inspect' | 'continue' | 'step' | 'stop';

export interface CodeIntelligencePanelProps {
  problems: {
    state: DiagnosticObservationV1['state'];
    baselineStatus: 'AVAILABLE' | 'UNAVAILABLE';
    introduced: CodeDiagnostic[];
    existing: CodeDiagnostic[];
    stale: CodeDiagnostic[];
  } | null;
  previews: EditPreviewV1[];
  rename: {planId: string; entries: RenameRecoveryEntry[]} | null;
  debug: {
    session: DebugSessionV1 | null;
    inspectEnabled: boolean;
    effectEnabled: boolean;
    /** Why a disabled control is unavailable (missing approval or confinement). */
    disabledReason?: string;
    /** Controls render only when the host supplies a handler. */
    onCommand?: (command: DebugControl) => void;
  } | null;
  onOpenLocation?: (path: string, range: CodeDiagnostic['range']) => void;
}

type Tone = 'neutral' | 'pending' | 'success' | 'danger';
const Pill = ({tone, children}: {tone: Tone; children: ReactNode}) => <span className="cr-pill" data-tone={tone}>{children}</span>;

const SEVERITY: Record<CodeDiagnostic['severity'], {label: string; icon: ReactNode}> = {
  error: {label: 'Error', icon: <CircleX size={14} aria-hidden="true" />},
  warning: {label: 'Warning', icon: <TriangleAlert size={14} aria-hidden="true" />},
  information: {label: 'Info', icon: <Info size={14} aria-hidden="true" />},
  hint: {label: 'Hint', icon: <Lightbulb size={14} aria-hidden="true" />},
};
const location = (d: CodeDiagnostic) => `${d.path}:${d.range.start.line + 1}:${d.range.start.character + 1}`;

function ProblemRow({diagnostic, onOpen}: {diagnostic: CodeDiagnostic; onOpen?: CodeIntelligencePanelProps['onOpenLocation']}) {
  const severity = SEVERITY[diagnostic.severity];
  const body = <>
    <span className="cr-problem-icon" title={severity.label}>{severity.icon}<span className="sr-only">{severity.label}:</span></span>
    <span className="cr-problem-message">{diagnostic.message}</span>
    <span className="cr-meta cr-problem-location">{location(diagnostic)}</span>
  </>;
  return <li className="cr-problem" data-severity={diagnostic.severity}>
    {onOpen
      ? <button type="button" className="cr-problem-row" aria-label={`${severity.label}: ${diagnostic.message} — open ${location(diagnostic)}`} onClick={() => onOpen(diagnostic.path, diagnostic.range)}>{body}</button>
      : <div className="cr-problem-row">{body}</div>}
  </li>;
}

function ProblemGroup({title, items, onOpen}: {title: string; items: CodeDiagnostic[]; onOpen?: CodeIntelligencePanelProps['onOpenLocation']}) {
  if (!items.length) return null;
  return <div className="cr-intel-group">
    <h3>{title} ({items.length})</h3>
    <ul className="cr-problems">{items.map((d, i) => <ProblemRow key={`${location(d)}:${i}`} diagnostic={d} onOpen={onOpen} />)}</ul>
  </div>;
}

function Problems({problems, onOpen}: {problems: CodeIntelligencePanelProps['problems']; onOpen?: CodeIntelligencePanelProps['onOpenLocation']}) {
  const total = problems ? problems.introduced.length + problems.existing.length + problems.stale.length : 0;
  const status = !problems ? 'Not checked yet.'
    : problems.state === 'UNAVAILABLE' ? 'Couldn’t check these files for problems.'
    : problems.state === 'STALE' ? 'These results are from an earlier version of the files.'
    : total === 0 ? 'No problems found.'
    : null;
  const noComparison = !!problems && total > 0 && problems.baselineStatus === 'UNAVAILABLE';
  return <section aria-label="Problems">
    <h2>Problems{total ? ` (${total})` : ''}</h2>
    {status && <p className="cr-meta">{status}</p>}
    {noComparison && <p className="cr-meta">Couldn’t compare with the previous version, so no problem is marked as new.</p>}
    {problems && <>
      <ProblemGroup title="New in this change" items={problems.introduced} onOpen={onOpen} />
      <ProblemGroup title={noComparison ? 'Found' : 'Already present'} items={problems.existing} onOpen={onOpen} />
      <ProblemGroup title="Outdated" items={problems.stale} onOpen={onOpen} />
    </>}
  </section>;
}

const PREVIEW_STATE: Record<EditPreviewV1['state'], {tone: Tone; label: string}> = {
  STREAMING_UNAPPLIED: {tone: 'pending', label: 'Receiving · not applied'},
  READY_UNAPPLIED: {tone: 'pending', label: 'Not applied'},
  APPLIED: {tone: 'success', label: 'Applied'},
  INVALID: {tone: 'danger', label: 'Out of date · not applied'},
  CONFLICT: {tone: 'danger', label: 'File changed · not applied'},
};

function ProposedEdits({previews}: {previews: EditPreviewV1[]}) {
  if (!previews.length) return null;
  return <section aria-label="Proposed edits">
    <h2>Proposed edits ({previews.length})</h2>
    <p className="cr-meta">Files change only when an edit shows Applied.</p>
    <ul className="cr-status-list">{previews.map(preview => {
      const state = PREVIEW_STATE[preview.state];
      const paths = preview.targetFiles.map(file => file.path);
      return <li key={preview.previewId} data-state={preview.state}>
        <span className="cr-file-path">{paths.length ? paths.join(', ') : 'Waiting for file names…'}</span>
        <Pill tone={state.tone}>{state.label}</Pill>
      </li>;
    })}</ul>
  </section>;
}

const RENAME_STATE: Record<RenameDisposition, {tone: Tone; label: string}> = {
  Applied: {tone: 'success', label: 'Renamed'},
  Restored: {tone: 'neutral', label: 'Restored'},
  Unchanged: {tone: 'neutral', label: 'Not changed'},
  Conflict: {tone: 'danger', label: 'Needs attention'},
};

function RenameOutcome({rename}: {rename: NonNullable<CodeIntelligencePanelProps['rename']>}) {
  const count = (disposition: RenameDisposition) => rename.entries.filter(entry => entry.disposition === disposition).length;
  const renamed = count('Applied'), conflicts = count('Conflict'), restored = count('Restored');
  const summary = conflicts ? `${conflicts} ${conflicts === 1 ? 'file needs' : 'files need'} manual review before the rename is complete.`
    : restored ? 'The rename was undone. Files were restored to their original content.'
    : renamed ? `Renamed in ${renamed} ${renamed === 1 ? 'file' : 'files'}.`
    : 'No files were changed.';
  return <section aria-label="Rename">
    <h2>Rename</h2>
    <p className="cr-meta">{summary}</p>
    <ul className="cr-status-list">{rename.entries.map(entry => {
      const state = RENAME_STATE[entry.disposition];
      return <li key={entry.path} data-disposition={entry.disposition}>
        <span className="cr-file-path">{entry.path}</span>
        <Pill tone={state.tone}>{state.label}</Pill>
        {entry.detail && <span className="cr-meta cr-status-detail">{entry.detail}</span>}
      </li>;
    })}</ul>
  </section>;
}

const DEBUG_STATE: Record<DebugSessionV1['state'], {tone: Tone; label: string}> = {
  STARTING: {tone: 'pending', label: 'Starting'},
  PAUSED: {tone: 'pending', label: 'Paused'},
  RUNNING: {tone: 'success', label: 'Running'},
  STOPPED: {tone: 'neutral', label: 'Stopped'},
  UNKNOWN: {tone: 'danger', label: 'Status unknown'},
};

function Debugger({debug}: {debug: NonNullable<CodeIntelligencePanelProps['debug']>}) {
  const {session, onCommand} = debug;
  const state = session ? DEBUG_STATE[session.state] : null;
  const paused = session?.state === 'PAUSED', live = !!session && ['STARTING', 'PAUSED', 'RUNNING'].includes(session.state);
  const controls = onCommand && live ? [
    {command: 'inspect' as const, label: 'Inspect', enabled: paused && debug.inspectEnabled, hint: 'Read the paused program’s stack and variables'},
    {command: 'continue' as const, label: 'Continue', enabled: paused && debug.effectEnabled},
    {command: 'step' as const, label: 'Step over', enabled: paused && debug.effectEnabled},
    {command: 'stop' as const, label: 'Stop', enabled: debug.effectEnabled},
  ] : [];
  const blocked = controls.some(control => !control.enabled) || !session;
  return <section aria-label="Debugger">
    <div className="cr-intel-heading"><h2>Debugger</h2>{state && <Pill tone={state.tone}>{state.label}</Pill>}</div>
    <p className="cr-meta">{session ? `Launch configuration: ${session.approvedRecipe}` : 'No debug session is running.'}</p>
    {controls.length > 0 && <div className="cr-debug-controls">{controls.map(control =>
      <button key={control.command} type="button" disabled={!control.enabled} title={control.hint} onClick={() => onCommand?.(control.command)}>{control.label}</button>)}
    </div>}
    {blocked && debug.disabledReason && <p className="cr-meta">{debug.disabledReason}</p>}
  </section>;
}

export function CodeIntelligencePanel({problems, previews, rename, debug, onOpenLocation}: CodeIntelligencePanelProps) {
  return <div className="cr-intel">
    <Problems problems={problems} onOpen={onOpenLocation} />
    <ProposedEdits previews={previews} />
    {rename && <RenameOutcome rename={rename} />}
    {debug && <Debugger debug={debug} />}
  </div>;
}
