import type { Route } from '@playwright/test';
import type { Snapshot, Thread } from '../../packages/contracts';

// Adapted from frontend.spec.ts's host/snapshot protocol pattern. Independent
// synthetic data; the spec is neither imported nor modified.
export function shellSnapshot(empty = false): Snapshot {
  const stamp = '2026-11-06T12:00:00.000Z';
  const threads: Thread[] = empty ? [] : ['one', 'two'].map((id, index) => ({ id, title: index ? 'Review keyboard navigation' : 'Audit the workspace', projectName: null, createdAt: stamp, updatedAt: stamp, status: 'ready', epoch: 0, runId: null, modelId: 'test/model', sessionPath: 'capture-session' }));
  return { seq: 1, threads, messages: empty ? [] : [{ id: 'assistant-one', threadId: 'one', role: 'assistant', content: 'Review the workspace, sidebar and composer. This is synthetic audit content.', createdAt: stamp, runId: null }], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {}, settings: { theme: 'dark', modelId: 'test/model' }, activeThreadId: empty ? null : 'one' };
}
export async function shellRoute(route: Route, snapshot: Snapshot, error: boolean): Promise<void> {
  const url = new URL(route.request().url()), path = url.pathname;
  if (error) return route.fulfill({ status: 503, json: { error: { code: 'CAPTURE_503', message: 'Synthetic host unavailable. Retry workspace.' } } });
  const reply = (json: unknown) => route.fulfill({ json });
  if (path === '/api/bootstrap') return reply({ csrfToken: 'capture-shell' });
  if (path === '/api/snapshot') return reply(snapshot);
  if (path === '/api/shell-settings') return reply(snapshot.settings);
  if (path === '/api/models') return reply({ models: [{ id: 'test/model', provider: 'test', name: 'Audit model' }] });
  if (path === '/api/workspace') return reply({ projects: [], state: { version: 1, revision: 0, activeCanvasId: 'workspace', canvases: [{ id: 'workspace', name: 'Workspace', preset: 'workspace', panels: [], filter: 'all', projectIds: [], viewport: { x: 0, y: 0, zoom: 1 } }], profiles: [], disabledKinds: [], integrations: {} } });
  if (path.startsWith('/api/shell/navigation/')) return reply(snapshot.threads.find(t => t.id === path.split('/').at(-1)));
  if (path === '/api/shell/navigation') return reply({ sequence: snapshot.seq, items: snapshot.threads, total: snapshot.threads.length, nextCursor: null, stats: { minOrder: 0, maxOrder: 1 } });
  if (path === '/api/shell/settings') return reply({ sequence: snapshot.seq, settings: snapshot.settings, accounts: [], skills: [], skillProposals: [], learning: { supported: true, status: 'idle', lastReview: null }, projects: [], resources: [], resourcePage: { total: 0, nextCursor: null }, counts: { threads: snapshot.threads.length, archivedThreads: 0, artifacts: 0, resources: 0, uncertainOperations: 0 } });
  if (path === '/api/shell/archive' || path === '/api/shell/resources') return reply({ sequence: 1, items: [], total: 0, nextCursor: null });
  if (path === '/api/plugins') return reply({ plugins: [] });
  if (path === '/api/skills/available') return reply({ skills: [], nextCursor: null });
  if (path === '/api/environment') return reply({ revision: 0, entries: [], secretStorageAvailable: false });
  if (path === '/api/integrations') return reply({ integrations: [] });
  if (path === '/api/commands') { const command = route.request().postDataJSON(); return reply({ commandId: command.id, eventSeq: ++snapshot.seq, result: {} }); }
  return reply({ items: [], profiles: [], nextCursor: null });
}
export const shellInit = `
  class CaptureEventSource extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.onopen?.()); }
    close() {}
  }
  Object.defineProperty(window, 'EventSource', {value: CaptureEventSource});
`;
