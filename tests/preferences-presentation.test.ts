import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppearanceSettings, NotificationSettings } from '../apps/web/src/AppearanceSettings.tsx';
import { ProjectContextCard } from '../apps/web/src/ProjectContextCard.tsx';
import { getPreferences } from '../packages/contracts/preferences.ts';
import type { Snapshot } from '../packages/contracts/index.ts';

describe('compact settings and unified context presentation', () => {
  it('offers scoped appearance choices with explicit Preview, Apply, Cancel and reset', () => {
    const html = renderToStaticMarkup(createElement(AppearanceSettings, { preferences: getPreferences({}), theme: 'dark', threads: [], busy: false, save: async () => true }));
    expect(html).toContain('aria-label="Interface accent"');
    expect(html).toContain('Custom accent');
    expect(html).not.toContain('Choose image');
    for (const label of ['Preview', 'Cancel', 'Apply', 'Reset appearance', 'Project colors']) expect(html).toContain(label);
    expect(html).not.toContain('data:image/svg');
  });

  it('keeps quiet-hour inputs and preview privacy understandable', () => {
    const preferences = getPreferences({ preferences: { notificationQuietHours: { enabled: true, start: '23:00', end: '07:00' } } });
    const html = renderToStaticMarkup(createElement(NotificationSettings, { preferences, busy: false, update: async () => {} }));
    expect(html).toContain('Notification preview privacy');
    expect(html).toContain('Quiet hours start');
    expect(html).toContain('23:00');
    expect(html).toContain('Private · no content');
  });

  it('shows a concise validated plan and honest empty companion sections', () => {
    const snapshot = { threads: [], data: [{ id: 'plan:thread-a', threadId: 'thread-a', provenance: 'harness:plan', revision: 2, value: { version: 1, title: 'Inspect changes', agents: [], steps: [{ id: 'check', title: 'Run checks', status: 'working', requirements: [] }] } }] } as unknown as Snapshot;
    const html = renderToStaticMarkup(createElement(ProjectContextCard, { snapshot, threadId: 'thread-a', threadTitle: 'Current conversation', onOpenDetailedPlan: () => {} }));
    expect(html).toContain('aria-label="Plan summary"');
    expect(html).toContain('data-plan-revision="2"');
    expect(html).toContain('Open full plan');
    expect(html).toContain('0 of 1 tasks complete');
    expect(html).toContain('No automation service connected.');
    expect(html).toContain('Side conversations');
    expect(html).not.toContain('plan-steps');
  });
});
