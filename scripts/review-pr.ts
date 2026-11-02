import type { ElementSpec, SurfaceSpec } from '../packages/contracts/index.ts';
import type { RelationshipData } from '../packages/ui-catalog/workflow.ts';

export type PRPhase = 'preparing' | 'checking' | 'conflicts' | 'resolving' | 'ready' | 'merging' | 'merged';
const source = 'Recorded PR fixture. External GitHub and CI effects are simulated.';
const node = (type: string, props: Record<string, unknown>, children?: string[]): ElementSpec => ({ type, props, ...(children ? { children } : {}) });

export function graphSpec(orientation: 'vertical' | 'horizontal', phase: PRPhase): SurfaceSpec {
  const resolving = phase === 'resolving', merging = phase === 'merging';
  const action = phase === 'conflicts' || resolving ? 'resolve' : phase === 'ready' || merging ? 'merge' : undefined;
  return { root: 'root', elements: {
    root: node('Stack', { gap: 'none' }, ['graph']),
    graph: node('RelationshipGraph', { dataBinding: 'graph', stateKey: 'commit', orientation, label: 'Session refresh' }, action ? [action] : []),
    ...(action ? { [action]: node('Button', { label: resolving ? 'Resolving…' : merging ? 'Merging…' : action === 'resolve' ? 'Resolve conflicts' : 'Merge', actionId: action, tone: 'primary', ...(resolving || merging ? { disabled: true } : {}) }) } : {}),
  } };
}

export function graphData(phase: PRPhase, completed = 0): RelationshipData {
  const resolved = ['ready', 'merging', 'merged'].includes(phase), resolving = phase === 'resolving';
  const hasResolution = resolved || resolving && completed >= 8;
  const hasConflicts = phase === 'conflicts' || resolving && !hasResolution;
  const status: NonNullable<RelationshipData['summary']>['status'] = phase === 'merged' ? 'merged' : phase === 'preparing' || phase === 'checking' || resolving || phase === 'merging' ? 'running' : resolved ? 'success' : 'pending';
  const nodes: RelationshipData['nodes'] = [
    { id: 'merge', label: phase === 'merged' ? 'Merge pull request #128' : 'Merge into main', ...(phase === 'merged' ? { hash: 'f21ac87', author: 'You', time: 'Just now' } : {}), lane: 0, column: 8, kind: 'endpoint', tone: phase === 'merged' ? 'purple' : 'teal', status },
    ...(hasResolution ? [{ id: 'resolution', label: 'Resolve overlapping session changes', hash: 'e791bc4', author: 'You', time: 'Just now', lane: 1, column: 7, tone: phase === 'merged' ? 'purple' : 'blue', status: resolving ? 'running' : 'success' } as const] : []),
    { id: 'local2', label: 'Handle inactive sessions', hash: 'd4a8921', author: 'You', time: '18m ago', branch: 'fix/session-refresh', lane: 1, column: 6, tone: 'blue', status: hasConflicts ? 'pending' : 'neutral', conflictCount: hasConflicts ? 2 : 0, excerpts: [{ label: 'auth.ts · 42–48 · Lena', text: 'return refreshSession(token);' }, { label: 'auth.ts · 42–48 · You', text: 'return await refreshSession(token, signal);' }] },
    { id: 'local', label: 'Add session expiry handling', hash: 'a8cd219', author: 'You', time: '24m ago', lane: 1, column: 4, tone: 'blue', status: 'neutral' },
    { id: 'main2', label: 'Refresh tokens before expiry', hash: 'c19e06d', author: 'Lena', time: '42m ago', branch: 'main', lane: 0, column: 5, tone: 'teal', status: hasConflicts ? 'pending' : 'neutral', conflictCount: hasConflicts ? 1 : 0, excerpts: [{ label: 'middleware.ts · 18–22 · Lena', text: 'const timeout = session.expiresAt - now;' }, { label: 'middleware.ts · 18–22 · You', text: 'const timeout = Math.max(0, expiry - now);' }] },
    { id: 'main', label: 'Normalize session cookies', hash: '720be31', author: 'Lena', time: '1h ago', lane: 0, column: 3, tone: 'teal', kind: 'point', status: 'neutral' },
    { id: 'shared3', label: 'Improve auth middleware', hash: 'f41a9d0', author: 'Alex', time: '2h ago', lane: 0, column: 2, tone: 'neutral', kind: 'point', dimmed: true, status: 'neutral' },
    { id: 'shared2', label: 'Update request logging', hash: 'eb3287c', author: 'Lena', time: '3h ago', lane: 0, column: 1, tone: 'neutral', kind: 'point', dimmed: true, status: 'neutral' },
    { id: 'base', label: 'Update session expiry', hash: 'ab42e18', author: 'Alex', time: '4h ago', lane: 0, column: 0, tone: 'neutral', kind: 'point', dimmed: true, status: 'neutral' },
  ];
  const shown = phase === 'preparing' ? nodes.filter(item => ['main', 'shared3', 'shared2', 'base'].includes(item.id)) : nodes;
  const ids = new Set(shown.map(item => item.id));
  const edges: RelationshipData['edges'] = [
    { from: 'base', to: 'shared2' }, { from: 'shared2', to: 'shared3' }, { from: 'shared3', to: 'main' },
    { from: 'main', to: 'main2' }, { from: 'shared3', to: 'local' }, { from: 'local', to: 'local2' },
    ...(hasResolution ? [{ from: 'main2', to: 'resolution', status }, { from: 'local2', to: 'resolution', status }, { from: 'resolution', to: 'merge', status, prospective: phase !== 'merged' }] : [{ from: 'main2', to: 'merge', status, prospective: true }, { from: 'local2', to: 'merge', status, prospective: true }]),
  ];
  return {
    source, tone: phase === 'merged' ? 'merged' : 'neutral', nodes: shown, edges: edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)),
    branchLabels: [{ label: 'main', lane: 0, column: 1, tone: 'teal' }, { label: 'fix/session-refresh', lane: 1, column: 3, tone: 'blue' }],
    summary: { label: phase === 'preparing' ? 'Preparing commits' : phase === 'checking' ? 'Checking mergeability' : phase === 'conflicts' ? '3 conflicts to resolve' : resolving ? completed ? `Running checks · ${completed}/42` : 'Resolving conflicts' : phase === 'ready' ? 'Ready to merge' : phase === 'merging' ? 'Merging…' : 'Merged', status },
    ...(phase === 'ready' || phase === 'merging' ? { checks: [{ label: 'Tests', status: 'success', detail: '42/42 checks passed' }, { label: 'Lint', status: 'success', detail: 'Lint passed' }, { label: 'Types', status: 'success', detail: 'Typecheck passed' }, { label: 'Preview', status: 'success', detail: 'Preview ready' }] } : {}),
  };
}
