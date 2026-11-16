import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppearanceSettings } from '../apps/web/src/AppearanceSettings.tsx';
import { SETTINGS_ROWS, SETTINGS_SECTIONS } from '../apps/web/src/Settings.tsx';
import { buildSupportedSettings, searchSettings } from '../apps/web/src/settings-registry.ts';
import { getPreferences } from '../packages/contracts/preferences.ts';

const render = () => renderToStaticMarkup(createElement(AppearanceSettings, { preferences: getPreferences({}), theme: 'dark', threads: [], busy: false, save: async () => true }));
const supported = buildSupportedSettings(SETTINGS_ROWS, SETTINGS_SECTIONS);
const search = (query: string, platform: 'browser' | 'desktop' = 'desktop') => searchSettings(query, supported, platform);

describe('one centralized settings search (T06)', () => {
  it('appearance renders every field without an independent child query filter', () => {
    const html = render();
    for (const label of ['Theme', 'Density', 'Interface font', 'Composer font', 'Chat width', 'Motion speed', 'Project colors']) expect(html).toContain(label);
  });
  it('gives nested appearance fields stable ids derived from their preference keys', () => {
    const html = render();
    for (const id of ['appearance-promptFont', 'appearance-chatFontSize', 'appearance-density', 'appearance-motion', 'harness-project-colors']) expect(html).toContain(`data-setting-id="${id}"`);
    for (const id of ['appearance-promptFont', 'appearance-chatFontSize', 'appearance-density']) expect(SETTINGS_ROWS.some(row => row.id === id)).toBe(true);
  });
  it('finds nested appearance fields through the registry, including prompt font', () => {
    expect(search('prompt font').map(row => row.id)).toContain('appearance-promptFont');
    expect(search('chat size').map(row => row.id)).toContain('appearance-chatFontSize');
    expect(search('density').map(row => row.id)).toContain('appearance-density');
    expect(search('project colors').map(row => row.id)).toContain('harness-project-colors');
  });
  it('finds providers from registered metadata without readiness work', () => {
    expect(search('ChatGPT').map(row => row.id)).toContain('provider-openai');
    expect(search('Claude').map(row => row.id)).toContain('provider-claude-code');
    expect(search('accounts').map(row => row.id)).toContain('harness-accounts');
    expect(search('Copilot').map(row => row.id)).toContain('provider-github-copilot');
  });
  it('returns one truthful empty result for unknown phrases and keeps platform scope', () => {
    expect(search('no-match-9f8c7b6a')).toEqual([]);
    expect(search('preview').length).toBeGreaterThan(0);
    for (const row of supported) expect(['all', 'desktop', 'browser']).toContain(row.platform);
  });
  it('exposes purpose groups for the supported categories', () => {
    const groups = new Set(supported.map(row => row.group));
    expect(groups.size).toBeGreaterThan(4);
    expect(supported.find(row => row.id === 'appearance-density')?.group).toBe('Look & feel');
    expect(supported.find(row => row.id === 'provider-openai')?.group).toBe('Models & accounts');
  });
});
