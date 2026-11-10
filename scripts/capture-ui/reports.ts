import { table, type CaptureEntry } from './helpers';
import type { aggregate } from './helpers';
type Scope = ReturnType<typeof aggregate> & { source: string; warnings: string[] };
export function scopeMarkdown(scope: Scope) {
  return `# Scope\n\nSource: ${scope.source}\n\n${scope.warnings.join('\n')}\n\n## PRs → screens\n\n${table(scope.pulls.map(pr => ({ number: pr.number, title: pr.title, mergedAt: pr.mergedAt, screens: pr.screens })))}\n## Justified exclusions\n\n${table(scope.excludedWebUi.map(file => ({ file: file.path, reason: file.reason, attemptedRoute: file.attemptedRoute })))}\n## Non-UI files count\n\n${scope.nonUi.length} unique files (tests, docs, scripts, server, core, Python and other non-renderer modules). Full paths in scope.json.\n\n## Desktop-only files\n\n${table(scope.desktopOnly.map(path => ({ path, reason: 'Native Electron owner; not captured' })))}\n`;
}
export function skipEntry(screen: string, state: string, width: number, reason: string, code = 'U'): CaptureEntry {
  return { screen, state, width, status: 'skipped', reason, code };
}
