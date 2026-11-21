import type { ModelInfo } from '../../../packages/contracts/index.ts';
import type { UiPreferences } from '../../../packages/contracts/preferences.ts';
import type { WorkspaceAuthority } from '../../../packages/contracts/workspace.ts';
import { projectColorKey } from './project-colors.ts';

export type ModelSource = 'explicit' | 'project' | 'project-unavailable' | 'global' | 'first' | 'bound';
export interface ResolvedModel { modelId: string; thinkingLevel: string; source: ModelSource; reasoningDropped: boolean }

export function projectModelDefaultFor(preferences: UiPreferences, authority: WorkspaceAuthority, projectId: string): { modelId: string; thinkingLevel: string | null } | null {
  return preferences.projectModelDefaults[projectColorKey(authority, projectId)] ?? null;
}

/** Resolution order for an unbound thread or draft: explicit composer choice > project default > global default > first advertised model (R03). Pure; the composers supply their already-loaded catalog. */
export function resolveNewThreadModel(input: {
  bound: boolean;
  boundModelId?: string | null;
  explicitModelId?: string | null;
  explicitThinking?: string | null;
  project?: { modelId: string; thinkingLevel: string | null } | null;
  globalModelId?: string | null;
  catalog: ModelInfo[];
}): ResolvedModel {
  const { catalog } = input;
  const entry = (id: string) => catalog.find(model => model.id === id);
  if (input.bound) return { modelId: input.boundModelId ?? '', thinkingLevel: '', source: 'bound', reasoningDropped: false };
  if (input.explicitModelId && entry(input.explicitModelId)) {
    const model = entry(input.explicitModelId)!;
    const thinking = input.explicitThinking && model.thinkingLevels?.includes(input.explicitThinking) ? input.explicitThinking : '';
    return { modelId: input.explicitModelId, thinkingLevel: thinking, source: 'explicit', reasoningDropped: false };
  }
  if (input.project) {
    const model = entry(input.project.modelId);
    if (!model) return { modelId: '', thinkingLevel: '', source: 'project-unavailable', reasoningDropped: false };
    const candidate = input.explicitThinking ?? input.project.thinkingLevel;
    const advertised = Boolean(candidate && model.thinkingLevels?.includes(candidate));
    return { modelId: input.project.modelId, thinkingLevel: advertised ? candidate! : '', source: 'project', reasoningDropped: Boolean(candidate) && !advertised };
  }
  if (input.globalModelId && entry(input.globalModelId)) return { modelId: input.globalModelId, thinkingLevel: '', source: 'global', reasoningDropped: false };
  return { modelId: catalog[0]?.id ?? '', thinkingLevel: '', source: 'first', reasoningDropped: false };
}
