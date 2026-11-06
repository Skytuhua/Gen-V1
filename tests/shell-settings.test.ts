import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { matchesShortcut, readShellLayout } from '../apps/web/src/shell-layout';
import { SETTINGS_ROWS, SETTINGS_SECTIONS, settingAvailability } from '../apps/web/src/Settings';
import { T3_SETTINGS_ROWS } from '../apps/web/src/settings-inventory';
import { contextSegments } from '../apps/web/src/ContextMeter';
import { EMPTY_USAGE } from '../packages/contracts';

afterEach(() => vi.unstubAllGlobals());

describe('recoverable browser shell layout', () => {
  it('bounds untrusted persisted dimensions and rejects unknown tabs and group states', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ sidebarWidth: 90000, rightPanelWidth: -8, activeTab: 'pretend-terminal', folded: { valid: true, invalid: 'yes' } }) });
    const value = readShellLayout();
    expect(value.sidebarWidth).toBe(380); expect(value.rightPanelWidth).toBe(280); expect(value.activeTab).toBe('artifact'); expect(value.folded).toEqual({ valid: true });
  });
  it('uses a usable layout when browser storage is corrupt or unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{broken' }); expect(readShellLayout().sidebarWidth).toBe(248);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Unavailable'); } }); expect(readShellLayout().rightPanelOpen).toBe(false);
  });
  it('matches Escape and platform shortcuts while preserving Shift and Alt distinctions', () => {
    const event = { key: 'Escape', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
    expect(matchesShortcut(event, 'Escape')).toBe(true);
    expect(matchesShortcut({ ...event, key: ',', metaKey: true }, 'Ctrl+Comma')).toBe(true);
    expect(matchesShortcut({ ...event, key: 'K', ctrlKey: true }, 'Ctrl+K')).toBe(true);
    expect(matchesShortcut({ ...event, key: 'K', ctrlKey: true, shiftKey: true }, 'Ctrl+K')).toBe(false);
    expect(matchesShortcut({ ...event, key: 'K', ctrlKey: true, altKey: true }, 'Ctrl+K')).toBe(false);
  });
});

describe('pinned T3 settings inventory', () => {
  it('preserves the exact pinned row content and ordering', () => {
    // Frozen before the representation change: covers every ID, title, section and search term.
    expect(createHash('sha256').update(JSON.stringify(T3_SETTINGS_ROWS)).digest('hex')).toBe('2893f2e3a1de79b9c628ac73fe7670c686088f86c9f18acce61df3936c1d727e');
  });
  it('retains every static indexed row, original navigation, supplemental pages and skill controls', () => {
    expect(T3_SETTINGS_ROWS).toHaveLength(136);
    expect(SETTINGS_SECTIONS).toHaveLength(25);
    expect(SETTINGS_SECTIONS).toContainEqual(['integrations','Bundled integrations']);
    expect(SETTINGS_ROWS.find(row=>row.id==='harness-integrations')).toMatchObject({section:'integrations',title:'Bundled integrations'});
    expect(SETTINGS_SECTIONS).toContainEqual(['skills', 'Skills & learning']);
    expect(SETTINGS_ROWS.find(row => row.id === 'harness-skills')).toMatchObject({section:'skills',title:'Skills & learning'});
    expect(new Set(SETTINGS_ROWS.map(row => row.id)).size).toBe(SETTINGS_ROWS.length);
    for (const [section] of SETTINGS_SECTIONS) expect(SETTINGS_ROWS.some(row => row.section === section), section).toBe(true);
    for (const row of T3_SETTINGS_ROWS) expect(SETTINGS_ROWS.find(item => item.id === row.id)).toEqual(row);
  });
  it('classifies all unsupported desktop and service capabilities as unavailable', () => {
    for (const row of SETTINGS_ROWS.filter(row => ['browser', 'devices', 'snap-shot', 'scheduled-tasks', 'secrets', 'worktrees', 'source-control', 'access'].includes(row.section))) expect(settingAvailability(row), row.id).toBe('Unavailable');
    expect(settingAvailability(SETTINGS_ROWS.find(row => row.id === 'chat-width')!)).toBe('Working');
    expect(settingAvailability(SETTINGS_ROWS.find(row => row.id === 'delete-confirmation')!)).toBe('Unavailable');
  });
});

describe('reported context measurements', () => {
  it('keeps unknown context unknown', () => {
    expect(contextSegments(EMPTY_USAGE)).toBeNull();
    expect(contextSegments({ ...EMPTY_USAGE, contextTokens: 30 })).toBeNull();
  });
  it('uses reported categories without fabricating an unreported remainder', () => {
    const value = contextSegments({ ...EMPTY_USAGE, contextTokens: 42000, contextWindow: 100000, contextBreakdown: [{ label: 'System', tokens: 14000 }, { label: 'Conversation', tokens: 20000 }] })!;
    expect(value.ratio).toBe(42); expect(value.free).toBeUndefined(); expect(value.categorized).toBe(true);
    expect(value.categories.map(item => [item.label, item.tokens])).toEqual([['System', 14000], ['Messages', 20000]]);
    expect(value.categories[0].width).toBeCloseTo(14);
  });
  it('rejects inconsistent partitions without fabricating categories', () => {
    const value = contextSegments({ ...EMPTY_USAGE, contextTokens: 20, contextWindow: 100, contextBreakdown: [{ label: 'Impossible', tokens: 90 }] })!;
    expect(value.categorized).toBe(false); expect(value.categories).toEqual([]);
  });
});
