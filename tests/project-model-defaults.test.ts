import { describe, expect, it } from 'vitest';
import type { ModelInfo } from '../packages/contracts';
import { DEFAULT_PREFERENCES } from '../packages/contracts/preferences';
import { projectModelDefaultFor, resolveNewThreadModel } from '../apps/web/src/project-model-defaults';

const model = (id: string, thinkingLevels?: string[]): ModelInfo => ({ id, provider: 'test', name: id, thinkingLevels });
const catalog = [model('a', ['low', 'high']), model('b'), model('c', ['x'])];
const project = { modelId: 'b', thinkingLevel: 'high' };

describe('resolveNewThreadModel', () => {
  it('returns bound threads unchanged, ignoring every other input', () => {
    expect(resolveNewThreadModel({ bound: true, boundModelId: 'pinned', explicitModelId: 'a', project, globalModelId: 'a', catalog }))
      .toEqual({ modelId: 'pinned', thinkingLevel: '', source: 'bound', reasoningDropped: false });
  });

  it('prefers an explicit composer choice over the project default', () => {
    expect(resolveNewThreadModel({ bound: false, explicitModelId: 'a', project, globalModelId: 'b', catalog }).source).toBe('explicit');
    expect(resolveNewThreadModel({ bound: false, explicitModelId: 'gone', project, globalModelId: 'b', catalog }).source).toBe('project');
  });

  it('prefers the project default over the global default and first model', () => {
    const result = resolveNewThreadModel({ bound: false, project, globalModelId: 'a', catalog });
    expect(result).toMatchObject({ modelId: 'b', source: 'project' });
  });

  it('reports an ineligible project default instead of falling back', () => {
    expect(resolveNewThreadModel({ bound: false, project: { modelId: 'unavailable', thinkingLevel: null }, globalModelId: 'a', catalog }))
      .toEqual({ modelId: '', thinkingLevel: '', source: 'project-unavailable', reasoningDropped: false });
  });

  it('applies advertised reasoning and drops unadvertised reasoning with a flag', () => {
    expect(resolveNewThreadModel({ bound: false, project: { modelId: 'a', thinkingLevel: 'high' }, catalog }))
      .toMatchObject({ thinkingLevel: 'high', reasoningDropped: false });
    expect(resolveNewThreadModel({ bound: false, project: { modelId: 'b', thinkingLevel: 'high' }, catalog }))
      .toMatchObject({ thinkingLevel: '', reasoningDropped: true });
    expect(resolveNewThreadModel({ bound: false, project: { modelId: 'b', thinkingLevel: null }, catalog }))
      .toMatchObject({ thinkingLevel: '', reasoningDropped: false });
  });

  it('lets explicit reasoning beat the project reasoning', () => {
    expect(resolveNewThreadModel({ bound: false, explicitThinking: 'low', project: { modelId: 'a', thinkingLevel: 'high' }, catalog }))
      .toMatchObject({ thinkingLevel: 'low', reasoningDropped: false });
  });

  it('keeps the existing order without a project default', () => {
    expect(resolveNewThreadModel({ bound: false, globalModelId: 'a', catalog }).source).toBe('global');
    expect(resolveNewThreadModel({ bound: false, globalModelId: 'gone', catalog })).toMatchObject({ modelId: 'a', source: 'first' });
  });

  it('yields an empty model on an empty catalog', () => {
    expect(resolveNewThreadModel({ bound: false, globalModelId: 'a', catalog: [] })).toMatchObject({ modelId: '', source: 'first' });
    expect(resolveNewThreadModel({ bound: false, project, catalog: [] })).toMatchObject({ modelId: '', source: 'project-unavailable' });
  });
});

describe('projectModelDefaultFor', () => {
  it('looks up entries by exact authority identity', () => {
    const key = JSON.stringify(['local', 'project-a']);
    const preferences = { ...DEFAULT_PREFERENCES, projectModelDefaults: { [key]: { modelId: 'x', thinkingLevel: 'high' } } };
    expect(projectModelDefaultFor(preferences, { kind: 'local' }, 'project-a')).toEqual({ modelId: 'x', thinkingLevel: 'high' });
    expect(projectModelDefaultFor(preferences, { kind: 'local' }, 'project-b')).toBeNull();
    expect(projectModelDefaultFor(preferences, { kind: 'plugin', pluginId: 'p', scopeId: 's' }, 'project-a')).toBeNull();
  });
});
