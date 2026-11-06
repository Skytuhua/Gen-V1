import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, getPreferences, mergePreferences } from '../packages/contracts/preferences.ts';

describe('appearance and notification preferences', () => {
  it('adds presentation defaults to old settings without changing their existing values', () => {
    const preferences = getPreferences({ preferences: { chatWidth: 'full', fontSize: 16 } });
    expect(preferences).toMatchObject({ chatWidth: 'full', fontSize: 16, appearanceAccent: 'blue', backgroundStyle: 'solid', backgroundImage: null, notificationVolume: .35, notificationPreview: 'title' });
    expect(preferences.projectColors).toEqual({});
    expect(preferences.notificationQuietHours).toEqual({ enabled: false, start: '22:00', end: '08:00' });
  });

  it('keeps independent project color and quiet-hour preference values', () => {
    const first = getPreferences({});
    first.projectColors['["local","project-a"]'] = '#4F6EFF';
    first.notificationQuietHours.enabled = true;
    expect(getPreferences({}).projectColors).toEqual({});
    expect(getPreferences({}).notificationQuietHours.enabled).toBe(false);
    const updated = mergePreferences(DEFAULT_PREFERENCES, { projectColors: { '["local","project-a"]': '#4F6EFF' }, notificationQuietHours: { enabled: true, start: '23:30', end: '06:45' } });
    expect(updated.projectColors['["local","project-a"]']).toBe('#4F6EFF');
    expect(updated.keybindings).toEqual(DEFAULT_PREFERENCES.keybindings);
  });

  it.each([
    { backgroundImage: 'https://example.test/image.png' },
    { backgroundImage: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { backgroundImage: 'data:image/png;base64,not-an-image' },
    { appearanceAccent: 'pastel' },
    { notificationVolume: 2 },
    { notificationQuietHours: { enabled: true, start: '25:00', end: '08:00' } },
    { projectColors: { 'mutable project name': '#cccccc' } },
  ])('rejects unsupported appearance data %j', patch => {
    expect(() => mergePreferences(DEFAULT_PREFERENCES, patch)).toThrow();
  });

  it('accepts a bounded raster image and supports removing it without resetting fonts', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=';
    const selected = mergePreferences(DEFAULT_PREFERENCES, { backgroundStyle: 'image', backgroundImage: png, backgroundOpacity: .2, interfaceFont: 'Inter' });
    expect(selected.backgroundImage).toBe(png);
    expect(mergePreferences(selected, { backgroundImage: null, backgroundStyle: 'solid' }).interfaceFont).toBe('Inter');
  });
});
