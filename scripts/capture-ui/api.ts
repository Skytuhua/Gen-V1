// Minimal read-only fixture responses. No request reaches a real application host.
export function apiResponse(url: URL, error = false, empty = false): unknown | undefined {
  if (error) return undefined;
  if (/^\/api\/projects\/[^/]+\/files$/.test(url.pathname) || /^\/api\/resources\/[^/]+\/tree$/.test(url.pathname)) return { path: '', entries: empty ? [] : [{ name: 'capture.txt', path: 'capture.txt', kind: 'file', bytes: 24 }], truncated: false };
  if (/^\/api\/projects\/[^/]+\/file$/.test(url.pathname)) return { text: 'Synthetic capture file.', binary: false, sha256: 'a'.repeat(64) };
  if (url.pathname === '/api/shell/settings') return { sequence: 1, settings: { theme: 'dark', modelId: '', selectedAccounts: {} }, accounts: [], skills: [], skillProposals: [], learning: { supported: true, status: 'idle', lastReview: null }, projects: [], resources: [], resourcePage: { total: 0, nextCursor: null }, counts: { threads: 0, archivedThreads: 0, artifacts: 0, resources: 0, uncertainOperations: 0 } };
  if (url.pathname === '/api/shell/archive') return { sequence: 1, items: [], total: 0, nextCursor: null };
  if (url.pathname === '/api/environment') return { revision: 0, entries: [], secretStorageAvailable: false };
  if (url.pathname === '/api/models') return { models: [] };
  if (url.pathname === '/api/integrations') return { integrations: [] };
  if (url.pathname === '/api/workspace') return { projects: [] };
  if (url.pathname === '/api/research' || /^\/api\/research\/(sources|documents)$/.test(url.pathname)) return { items: [], nextCursor: null };
  if (url.pathname.startsWith('/api/projects/') && url.pathname.includes('comparison')) {
    const identity = { kind: 'local', id: 'a'.repeat(64), scope: 'worktree', headOid: '1'.repeat(40), branch: 'capture', revision: 'b'.repeat(64), base: { kind: 'index', revision: 'c'.repeat(64) }, head: { kind: 'worktree', revision: 'b'.repeat(64) } };
    const file = { path: 'src/first.ts', status: 'MM', index: 'M', worktree: 'M', untracked: false, additions: 1, deletions: 1 };
    if (url.pathname.endsWith('/file')) return { identity, file, state: 'text', text: '@@ -1 +1 @@\n-old value\n+capture fixture value' };
    return { state: 'ready', value: { identity, files: [file], filesTruncated: false, checks: [], observedAt: '2026-11-01T00:00:00Z', access: { mode: 'managed', untrackedIncluded: true } } };
  }
  return undefined;
}
