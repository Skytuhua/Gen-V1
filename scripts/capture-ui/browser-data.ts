import type { Snapshot } from '../../packages/contracts';
import type { ProjectContext } from '../../packages/contracts/workspace';
import { scopedContext, scopedEnvelope, scopedMessage } from '../../tests/scoped-conversation-fixture';
export { scopedContext, scopedEnvelope };
export function browserSnapshot(): Snapshot {
  const stamp = '2026-11-06T12:00:00Z';
  const parent = { id: 'one', title: 'Main investigation', projectId: 'capture-project', projectName: 'Audit project', status: 'ready' as const, epoch: 0, runId: null, modelId: 'synthetic/model', sessionPath: 'capture-session', createdAt: stamp, updatedAt: stamp };
  return { seq: 1, activeThreadId: 'one', threads: [parent, { ...parent, id: 'side-one', sideParentId: 'one', title: 'Earlier side question' }], messages: [{ id: 'side-answer', threadId: 'side-one', role: 'assistant', content: 'The side conversation keeps its own transcript and draft.', createdAt: stamp, runId: null }], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {}, settings: { theme: 'dark', modelId: 'synthetic/model' }, memory: [{ id: 'note-one', threadId: 'one', key: 'review-scope', content: 'Keep capture tooling separate from application changes.', revision: 1, author: 'user', updatedAt: stamp }], skills: [{ name: 'capture-review', description: 'Review local UI evidence.', category: 'general', revision: 1, state: 'active', enabled: true, protected: false, origin: 'user', managed: true, author: 'user', createdAt: stamp, updatedAt: stamp, lastUsedAt: null, useCount: 2, patchCount: 0 }], skillProposals: [], learning: { supported: true, status: 'idle', lastReview: null } };
}
export const projectContext: ProjectContext = { project: { id: 'capture-project', name: 'Audit project', rootPath: '/synthetic/project', authority: { kind: 'local' }, createdAt: '2026-11-06' }, machineName: 'Fixture machine', editor: { available: false, label: 'Synthetic editor' }, branch: 'wo-1/ui-capture', head: 'a'.repeat(40), changes: { added: 3, removed: 1, files: 2 }, lineage: [], scripts: [], capabilities: { git: true, terminal: true, pullRequests: false } };
export function browserApiResponse(url: URL, payload?: Record<string, unknown>): unknown | undefined {
  const path = url.pathname;
  if (path.startsWith('/api/conversations/')) {
    if (path.endsWith('/transcript')) return { ...scopedEnvelope, messages: [scopedMessage('capture-message', 'A source-bound conversation rendered through the real scoped reader.')], nextCursor: null };
    if (path.endsWith('/updates')) return { ...scopedEnvelope, fromSequence: scopedContext.sequence, owner: null, transcriptChanged: false, checkpoint: scopedContext.checkpoint };
    return scopedContext;
  }
  if (path === '/api/models') return { models: [{ id: 'synthetic/model', name: 'Audit model', provider: 'synthetic' }] };
  if (path.includes('/credentials/')) return { present: false, version: 0, expiresAt: null };
  if (path === '/api/account-auth') return { state: 'signed-out', message: 'Synthetic connection status; no account is used.', identity: { availability: 'unavailable' } };
  if (path === '/api/terminals' || path.startsWith('/api/terminals/')) return { id: payload?.terminalId ?? 'capture-terminal', projectId: 'capture-project', threadId: 'one', output: 'Synthetic terminal output\r\nUI audit complete.\r\n', start: 0, cursor: 48, exited: true, exitCode: 0 };
  if (path.endsWith('/context') && path.startsWith('/api/projects/')) return projectContext;
  if (path === '/api/skills/available') return { skills: [], nextCursor: null };
  if (path.startsWith('/api/skills/')) { const skill = browserSnapshot().skills![0]; return { skill, content: 'Inspect screenshots and recorded motion before reporting acceptance.', files: [], versions: [], nextVersionOffset: null }; }
  if (path.endsWith('/rpc') && path.startsWith('/api/plugins/')) {
    if (payload?.operation === 'visual.document.read') return { documentId: 'main', revision: 0, document: null, draft: null };
    if (payload?.operation === 'state.read') return null;
    return {};
  }
  return undefined;
}
