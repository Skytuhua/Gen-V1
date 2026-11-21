// Renders one Windows Explorer "Open in Gen V1" request (plan r1 T04): derives a
// Windows basename label, enrolls or reuses the project through the existing
// workspace.project.connect command, then creates a new empty conversation
// scoped to that project and reveals it. Pure and dependency-injected so the
// decision matrix is testable without a mounted App, DOM, or Electron. The T03
// delivery handshake already validated the path form; this layer still produces
// safe outcomes for every envelope shape the host can return.

export interface ExplorerProjectRef {
  id: string;
  rootPath?: string;
  authority?: { kind: string };
}
export interface ExplorerConnectResult {
  projects: readonly ExplorerProjectRef[];
}
export interface ExplorerToastOptions {
  tone?: 'info' | 'success' | 'error';
  action?: { label: string; onClick: () => void };
}
export interface ExplorerOpenProjectDeps {
  /** Current workspace projects, or null while the workspace envelope has not loaded. */
  projects(): readonly ExplorerProjectRef[] | null;
  /** workspace.project.connect — resolves with the post-connect envelope. */
  connect(name: string, path: string): Promise<ExplorerConnectResult>;
  /** creationPending equivalent: the in-flight thread creation, when any. */
  pendingThread(): Promise<string> | null;
  /** App createThread with no draft migration, scoped to the project. */
  createThread(projectId: string): Promise<string>;
  /** Reveal/select the finished conversation. */
  select(threadId: string): void;
  toast(message: string, options?: ExplorerToastOptions): void;
}

const reasonOf = (error: unknown) => error instanceof Error && error.message ? error.message : 'The request could not be completed.';

/**
 * Windows basename rules: trailing separators are stripped and the last segment
 * wins. A drive root keeps the drive text (C:\ -> "C:"); whitespace-only or
 * empty results fall back to "Folder". Capped at the 100-character project
 * label limit.
 */
export function explorerProjectName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const name = (trimmed.match(/[^\\/]+$/)?.[0] ?? trimmed).trim();
  return (name || 'Folder').slice(0, 100);
}

export async function openExplorerProject(path: string, deps: ExplorerOpenProjectDeps): Promise<void> {
  const before = deps.projects();
  const name = explorerProjectName(path);
  if (!before) {
    deps.toast(`Couldn't open ${path}: the workspace is still loading. Try again.`, { tone: 'error' });
    return;
  }
  let next: ExplorerConnectResult;
  try {
    next = await deps.connect(name, path);
  } catch (cause) {
    deps.toast(`Couldn't open ${path}: ${reasonOf(cause)}`, { tone: 'error' });
    return;
  }
  // Project identity comes from the post-connect envelope: a project absent
  // from the pre-connect set is new; otherwise match the supplied path
  // verbatim — Explorer %V arrives absolute, and canonical-alias reuse that
  // cannot be identified falls through to an honest error rather than guessing.
  const known = new Set(before.map(item => item.id));
  const project = next.projects.find(item => !known.has(item.id))
    ?? next.projects.find(item => item.authority?.kind === 'local' && item.rootPath === path);
  if (!project) {
    deps.toast(`Couldn't open ${path}: the project connected but could not be located in the workspace.`, { tone: 'error' });
    return;
  }
  let threadId: string;
  try {
    // An unrelated in-flight creation must finish first; its thread is never
    // adopted as this request's conversation.
    for (let pending = deps.pendingThread(); pending; pending = deps.pendingThread()) await pending.catch(() => {});
    threadId = await deps.createThread(project.id);
  } catch (cause) {
    deps.toast(`Couldn't open ${path}: the project connected, but the conversation could not start. ${reasonOf(cause)}`, { tone: 'error' });
    return;
  }
  deps.select(threadId);
  deps.toast(`✓ Opened ${name} as a project`, {
    tone: 'success',
    action: { label: 'Reveal', onClick: () => deps.select(threadId) },
  });
}

/**
 * Request queue for delivered Explorer paths: an identical in-flight path is
 * deduplicated ("already open" semantics), while distinct paths serialize in
 * arrival order so each consumed request still gets its own conversation.
 */
export function createExplorerOpenHandler(deps: () => ExplorerOpenProjectDeps): (path: string) => void {
  const inflight = new Set<string>();
  let chain: Promise<unknown> = Promise.resolve();
  return path => {
    if (inflight.has(path)) return;
    inflight.add(path);
    chain = chain.catch(() => {}).then(async () => {
      try { await openExplorerProject(path, deps()); }
      finally { inflight.delete(path); }
    });
  };
}
