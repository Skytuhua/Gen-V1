import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppearanceSettings } from '../apps/web/src/AppearanceSettings.tsx';
import { getPreferences } from '../packages/contracts/preferences.ts';

const render = (query?: string) => renderToStaticMarkup(createElement(AppearanceSettings, { preferences: getPreferences({}), theme: 'dark', threads: [], busy: false, save: async () => true, query }));

describe('appearance settings search filtering', () => {
  it('renders every row when no query is given', () => {
    const html = render();
    for (const label of ['Theme', 'Density', 'Interface font', 'Chat width', 'Motion speed', 'Project colors']) expect(html).toContain(label);
  });
  it('filters to matching rows for a theme search instead of the whole panel', () => {
    const html = render('theme');
    expect(html).toContain('Color scheme');
    expect(html).not.toContain('Density');
    expect(html).not.toContain('Interface font');
    expect(html).not.toContain('Project colors');
  });
  it('matches multi-token queries against labels and option terms', () => {
    const html = render('chat width');
    expect(html).toContain('Chat width');
    expect(html).not.toContain('Chat size');
  });
  it('hides the panel entirely when nothing matches', () => {
    const html = render('no-match-9f8c7b6a');
    expect(html).not.toContain('Appearance');
    expect(html).not.toContain('Project colors');
  });
});
