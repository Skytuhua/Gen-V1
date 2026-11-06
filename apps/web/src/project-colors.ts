import { PROJECT_PALETTE, projectColorSchema } from '../../../packages/contracts/preferences.ts';
import type { WorkspaceAuthority } from '../../../packages/contracts/workspace.ts';
export { PROJECT_PALETTE };

/** Identity is independent of editable project names and activity state. */
export function projectColorKey(authority: WorkspaceAuthority, projectId: string): string {
  return JSON.stringify(authority.kind === 'local' ? ['local', projectId] : ['plugin', authority.pluginId, authority.scopeId, projectId]);
}

export function projectColor(authority: WorkspaceAuthority, projectId?: string, overrides: Record<string, string> = {}): string | undefined {
  if (!projectId) return undefined;
  const key = projectColorKey(authority, projectId), overridden = overrides[key];
  if (overridden && projectColorSchema.safeParse(overridden).success) return overridden;
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const palette = Object.values(PROJECT_PALETTE);
  return palette[(hash >>> 0) % palette.length];
}

export function threadDragPayload(thread: { id: string; projectId?: string; title?: string }): string {
  return JSON.stringify({ threadId: thread.id, binding: { authority: { kind: 'local' }, threadId: thread.id, ...(thread.projectId ? { projectId: thread.projectId } : {}) } });
}
