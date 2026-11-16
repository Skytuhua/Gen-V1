import type {CodeIntelligencePanelProps} from '../../apps/web/src/code-review-workspace/CodeIntelligencePanel';
import type {CodeDiagnostic, EditPreviewV1} from '../../packages/contracts/code-intelligence';

// Synthetic M07 panel states for the code-review-workspace fixture (?intel=<name>).
const at = (line: number, character: number) => ({start: {line, character}, end: {line, character: character + 4}});
const diagnostic = (path: string, line: number, severity: CodeDiagnostic['severity'], message: string, code?: string): CodeDiagnostic =>
  ({path, range: at(line, 2), severity, message, source: 'ts', ...(code ? {code} : {})});
const preview = (previewId: string, state: EditPreviewV1['state'], ...paths: string[]): EditPreviewV1 =>
  ({version: 1, previewId, owner: 'o'.repeat(8), schemaDigest: 'a'.repeat(64), finalArgumentsDigest: null, state,
    targetFiles: paths.map(path => ({path, identity: null, beforeDigest: null, proposedDigest: 'b'.repeat(64)}))});

export function codeIntelligenceScenario(name: string | null, onOpenLocation: CodeIntelligencePanelProps['onOpenLocation'], onDebugCommand: NonNullable<CodeIntelligencePanelProps['debug']>['onCommand']): CodeIntelligencePanelProps | undefined {
  if (name === 'full') return {
    problems: {state: 'CURRENT', baselineStatus: 'AVAILABLE',
      introduced: [diagnostic('src/first.ts', 11, 'error', "Property 'value' does not exist on type 'Options'.", '2339'), diagnostic('src/first.ts', 23, 'warning', "'count' is declared but its value is never read.", '6133')],
      existing: [diagnostic('src/second.ts', 4, 'information', 'This may be converted to an async function.', '80006')],
      stale: [diagnostic('src/old.ts', 2, 'hint', 'Unused import.')]},
    previews: [preview('p1', 'STREAMING_UNAPPLIED', 'src/first.ts'), preview('p2', 'READY_UNAPPLIED', 'src/second.ts', 'src/third.ts'), preview('p3', 'APPLIED', 'src/fourth.ts'), preview('p4', 'INVALID', 'src/fifth.ts'), preview('p5', 'CONFLICT', 'src/sixth.ts')],
    rename: {planId: 'plan-1', entries: [{path: 'src/first.ts', disposition: 'Applied'}, {path: 'src/second.ts', disposition: 'Restored'}, {path: 'src/third.ts', disposition: 'Unchanged'}, {path: 'src/fourth.ts', disposition: 'Conflict', detail: 'The file changed outside the rename.'}]},
    debug: {session: {version: 1, sessionId: 's1', owner: 'o'.repeat(8), executableIdentity: 'node', approvedRecipe: 'node-test', confinementProfile: 'workspace-execute-no-network', processIdentity: '4242', state: 'PAUSED'},
      inspectEnabled: true, effectEnabled: false, disabledReason: 'Continue, Step over and Stop need approval before they can run code.', onCommand: onDebugCommand},
    onOpenLocation,
  };
  if (name === 'clean') return {problems: {state: 'CURRENT', baselineStatus: 'AVAILABLE', introduced: [], existing: [], stale: []}, previews: [], rename: null, debug: null, onOpenLocation};
  if (name === 'unavailable') return {problems: {state: 'UNAVAILABLE', baselineStatus: 'UNAVAILABLE', introduced: [], existing: [], stale: []}, previews: [], rename: null,
    debug: {session: null, inspectEnabled: false, effectEnabled: false, disabledReason: 'No approved debugger is installed on this computer.', onCommand: onDebugCommand}, onOpenLocation};
  if (name === 'no-baseline') return {problems: {state: 'STALE', baselineStatus: 'UNAVAILABLE', introduced: [],
    existing: [diagnostic('src/first.ts', 3, 'error', "Cannot find name 'missing'.", '2304')], stale: []}, previews: [], rename: null, debug: null, onOpenLocation};
  if (name === 'empty') return {problems: null, previews: [], rename: null, debug: null, onOpenLocation};
  return undefined;
}
