import { describe, expect, it } from 'vitest';
import { projectColor, projectColorKey, PROJECT_PALETTE, threadDragPayload } from '../apps/web/src/project-colors.ts';

describe('project identity colors and thread placement', () => {
  it('keeps colors stable by actual identity, with isolated authority namespaces', () => {
    const local = projectColorKey({ kind: 'local' }, 'project-a');
    const company = projectColorKey({ kind: 'plugin', pluginId: 'example-plugin', scopeId: 'company-a' }, 'project-a');
    expect(local).not.toBe(company);
    expect(projectColor({ kind: 'local' }, 'project-a')).toBe(projectColor({ kind: 'local' }, 'project-a'));
    const overrides = { [local]: PROJECT_PALETTE.rose };
    expect(projectColor({ kind: 'local' }, 'project-a', overrides)).toBe(PROJECT_PALETTE.rose);
    expect(projectColor({ kind: 'local' }, undefined, overrides)).toBeUndefined();
  });

  it('serializes only exact local thread ownership for drag placement', () => {
    const payload = JSON.parse(threadDragPayload({ id: 'thread-a', projectId: 'project-a', title: 'A title that is not authority' }));
    expect(payload).toEqual({ threadId: 'thread-a', binding: { authority: { kind: 'local' }, threadId: 'thread-a', projectId: 'project-a' } });
    expect(payload.title).toBeUndefined();
  });

  it('uses validated custom colors while ignoring malformed overrides', () => {
    const authority = { kind: 'local' } as const;
    const key = projectColorKey(authority, 'project-a');
    expect(projectColor(authority, 'project-a', { [key]: '#123abc' })).toBe('#123abc');
    expect(projectColor(authority, 'project-a', { [key]: 'red;display:none' })).toBe('#9855F7');
    expect(projectColor(authority, 'project-a', { [key]: '#fff' })).toBe('#9855F7');
  });

  it('keeps a fixed fallback through rename, reordering, reload and namespace changes', () => {
    expect(projectColor({ kind: 'local' }, 'project-a')).toBe('#9855F7');
    expect(projectColor({ kind: 'plugin', pluginId: 'example-plugin', scopeId: 'company-a' }, 'project-a')).toBe('#E84876');
    const overrides = JSON.parse(JSON.stringify({ '["local","project-a"]': '#abcdef' }));
    expect(projectColor({ kind: 'local' }, 'project-a', overrides)).toBe('#abcdef');
    expect(projectColor({ kind: 'plugin', pluginId: 'example-plugin', scopeId: 'company-a' }, 'project-a', overrides)).toBe('#E84876');
  });
});
