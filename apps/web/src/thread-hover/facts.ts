import type {ProjectContext, WorkspaceAuthority} from '../../../../packages/contracts/workspace';

/** Parent-owned source identity. A null working copy cannot carry branch or PR facts. */
export interface ThreadHoverScope {
  readonly authority: WorkspaceAuthority;
  readonly threadId: string;
  readonly projectId: string | null;
  readonly workingCopyId: string | null;
  readonly revision: string;
}

export interface ThreadHoverPullRequest<Target = unknown> {
  readonly id: string;
  readonly label: string;
  readonly target: Target;
  readonly state?: string;
  readonly checks?: string;
}

/** Only source-reported facts. Display strings are not commands or authority. */
export interface ThreadHoverFacts<Target = unknown> {
  readonly scope: ThreadHoverScope;
  readonly title: string;
  readonly project?: {readonly name: string; readonly monogram?: string};
  readonly machine?: string;
  readonly environment?: string;
  readonly workingCopy?: string;
  readonly branch?: string;
  readonly runtime?: string;
  readonly model?: string;
  readonly reasoning?: string;
  readonly activity?: string;
  readonly lastActivity?: {readonly label: string; readonly at?: string};
  readonly sourceHandoff?: string;
  readonly parent?: {readonly threadId: string; readonly title?: string};
  readonly childCount?: number;
  readonly pullRequests?: readonly ThreadHoverPullRequest<Target>[];
}

export function hoverScopeKey(scope: ThreadHoverScope): string {
  const authority = scope.authority;
  return JSON.stringify([authority.kind === 'local' ? ['local'] : ['plugin', authority.pluginId, authority.scopeId],
    scope.threadId, scope.projectId, scope.workingCopyId, scope.revision]);
}

export function scopedThreadHoverFacts<Target>(facts: ThreadHoverFacts<Target>): ThreadHoverFacts<Target> {
  const {branch, workingCopy, pullRequests, ...basic} = facts;
  return facts.scope.workingCopyId && facts.scope.revision ? facts : basic;
}

/** Adapts an already authenticated project read; no fetch, lineage totals or PR inference. */
export function factsFromProjectContext(scope: ThreadHoverScope, title: string, context: ProjectContext): ThreadHoverFacts | null {
  const candidate: ThreadHoverScope = {authority: context.project.authority, threadId: context.threadId ?? '',
    projectId: context.project.id, workingCopyId: context.workingCopy?.id ?? null, revision: context.threadRevision ?? ''};
  if (context.error || !scope.workingCopyId || !scope.revision || hoverScopeKey(scope) !== hoverScopeKey(candidate)) return null;
  return {scope, title, project: {name: context.project.name},
    ...(context.machineName ? {machine: context.machineName} : {}), workingCopy: context.workingCopy?.path,
    ...(context.branch ? {branch: context.branch} : {})};
}
