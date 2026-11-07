import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Settings, SETTINGS_ROWS, SETTINGS_SECTIONS, settingAvailability } from '../apps/web/src/Settings';
import { AppearanceSettings, accentContrast } from '../apps/web/src/AppearanceSettings';
import { getPreferences, mergePreferences } from '../packages/contracts/preferences';
import type { Snapshot } from '../packages/contracts';

const labels = ['General', 'Appearance', 'Chat & Composer', 'Models & Accounts', 'Projects & Working Copies', 'Source Control & Reviews', 'Skills & Integrations', 'Notifications & Usage', 'Browser', 'Keyboard Shortcuts', 'Data & Recovery', 'About & Licenses'];
const snapshot = { seq: 0, threads: [], archivedThreads: [], messages: [], artifacts: [], data: [], resources: [], operations: [], settings: { theme: 'dark', modelId: null } } as unknown as Snapshot;

describe('supported settings contract', () => {
  it('exposes exactly the approved twelve sections, with supported search rows only', () => {
    expect(SETTINGS_SECTIONS.map(([, label]) => label)).toEqual(labels);
    expect(SETTINGS_ROWS.every(row => settingAvailability(row) !== 'Unavailable')).toBe(true);
    expect(new Set(SETTINGS_ROWS.map(row => row.id)).size).toBe(SETTINGS_ROWS.length);
    for (const [section] of SETTINGS_SECTIONS) expect(SETTINGS_ROWS.some(row => row.section === section)).toBe(true);
  });
  it('leaves modal ownership to the parent and never renders unsupported inventory', () => {
    const html = renderToStaticMarkup(createElement(Settings, { snapshot, modelError: '', refresh: async () => {}, loadModels: async () => {}, close: () => {}, addResource: () => {} }));
    expect(html).not.toContain('<dialog');
    expect(html).not.toContain('Unavailable');
    expect(html).not.toContain('Labs');
    expect(html).toContain('Settings sections');
  });
  it('migrates saved appearance without dropping project colors or future-owned preferences', () => {
    const saved = { fontSize: 17, interfaceFont: 'Georgia' as const, panelAnimations: false, motionDuration: 180, projectColors: { '["local","project-a"]': '#4F6EFF' }, futureLane: { keep: true } };
    const migrated = getPreferences({ preferences: saved });
    expect(migrated).toMatchObject({ fontSize: 17, interfaceFont: 'Georgia', chatFontSize: 17, codeFontSize: 17, motion: 'off', futureLane: { keep: true } });
    expect(mergePreferences(migrated, { density: 'touch', controlRadius: 10 })).toMatchObject({ projectColors: saved.projectColors, futureLane: { keep: true } });
  });
  it('persists bounded explicit appearance options and rejects invalid new writes', () => {
    expect(mergePreferences(getPreferences({}), { density: 'compact', uiFontSize: 13, chatFontSize: 20, codeFontSize: 12, controlRadius: 0, motion: 'reduced', motionSpeed: 1.25, customAccent: '#2468AC' })).toMatchObject({ density: 'compact', controlRadius: 0, customAccent: '#2468AC' });
    for (const patch of [{ uiFontSize: 4 }, { customAccent: 'url(https://bad)' }, { controlRadius: 100 }, { motionSpeed: 2 }, { inventedNewSetting: true }, { browserStartUrl: 'javascript:alert(1)' }, { browserStartUrl: 'https://name:secret@example.com/' }]) expect(() => mergePreferences(getPreferences({}), patch)).toThrow();
  });
  it('checks custom accent contrast against both supported surface families', () => {
    expect(accentContrast('#000000', '#FFFFFF')).toBe(21);
    expect(accentContrast('#FFFFFF', '#FFFFFF')).toBe(1);
    expect(Math.min(accentContrast('#4F6EFF', '#0F0F0F'), accentContrast('#4F6EFF', '#FFFFFF'))).toBeGreaterThan(3);
  });
  it('provides all approved appearance controls without adding a wallpaper editor', () => {
    const html = renderToStaticMarkup(createElement(AppearanceSettings, { preferences: getPreferences({}), theme: 'dark', threads: [], busy: false, save: async () => true }));
    for (const label of ['Density', 'Interface font', 'UI size', 'Chat size', 'Code size', 'Control radius', 'Chat width', 'Code line wrap', 'Motion', 'Motion speed', 'Custom accent']) expect(html).toContain(label);
    expect(html).not.toContain('Choose image');
  });
});
