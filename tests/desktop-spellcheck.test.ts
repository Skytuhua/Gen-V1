import { expect, it, vi } from 'vitest';
import { DESKTOP_CHANNELS } from '../packages/desktop-contract/index.ts';
import { pluginDesktopChannelAllowed } from '../apps/desktop/window-policy.ts';
import { buildSpellcheckMenuTemplate, parseSpellcheckState, resolveSpellcheckLanguages, spellcheckLanguagesInfo } from '../apps/desktop/spellcheck.ts';
import { readFileSync } from 'node:fs';

const session = (langs: string[]) => ({ availableSpellCheckerLanguages: langs, addWordToSpellCheckerDictionary: vi.fn() });
const contents = () => ({ replaceMisspelling: vi.fn() });
const baseParams: { isEditable: boolean; misspelledWord: string; dictionarySuggestions: string[] } = { isEditable: true, misspelledWord: '', dictionarySuggestions: [] };

it('parses exactly {enabled,language} spellcheck payloads and rejects malformed values', () => {
  expect(parseSpellcheckState({ enabled: true, language: 'de-DE' })).toEqual({ enabled: true, language: 'de-DE' });
  expect(parseSpellcheckState({ enabled: false, language: null })).toEqual({ enabled: false, language: null });
  for (const bad of [null, 4, 'x', { enabled: true }, { enabled: 'yes', language: null }, { enabled: true, language: '' }, { enabled: true, language: '../x' }, { enabled: true, language: 'ab-' + 'x'.repeat(40) }, { enabled: true, language: 12 }, { enabled: true, language: null, extra: 1 }]) {
    expect(() => parseSpellcheckState(bad)).toThrow();
  }
});

it('matches the system spellcheck language list and falls back to en-US', () => {
  const available = ['en-US', 'de-DE', 'fr'];
  expect(resolveSpellcheckLanguages(['de-DE', 'fr'], available, 'linux')).toEqual(['de-DE', 'fr']);
  expect(resolveSpellcheckLanguages(['c', 'xx'], available, 'linux')).toEqual(['en-US']);
  expect(resolveSpellcheckLanguages([], available, 'win32')).toEqual(['en-US']);
});

it('reports platform-managed dictionaries on macOS and sorted lists elsewhere', () => {
  expect(spellcheckLanguagesInfo('darwin', session(['de-DE', 'en-US']))).toEqual({ platformManaged: true, available: [] });
  expect(spellcheckLanguagesInfo('linux', session(['fr', 'de-DE', 'en-US']))).toEqual({ platformManaged: false, available: ['de-DE', 'en-US', 'fr'] });
});

it('builds no menu while the preference is off or the target is not editable', () => {
  const word = { ...baseParams, misspelledWord: 'recieving', dictionarySuggestions: ['receiving'] };
  expect(buildSpellcheckMenuTemplate(word, false, contents(), session([]))).toBeNull();
  expect(buildSpellcheckMenuTemplate({ ...word, isEditable: false }, true, contents(), session([]))).toBeNull();
});

it('caps suggestions at five, wires corrections and dictionary additions', () => {
  const dict = session(['en-US']), view = contents();
  const menu = buildSpellcheckMenuTemplate({ ...baseParams, misspelledWord: 'recieving', dictionarySuggestions: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }, true, view, dict)!;
  expect(menu).toHaveLength(11); // 5 suggestions + add-to-dictionary + separator + 4 edit roles
  (menu[0].click as () => void)();
  expect(view.replaceMisspelling).toHaveBeenCalledWith('a');
  (menu[5].click as () => void)();
  expect(dict.addWordToSpellCheckerDictionary).toHaveBeenCalledWith('recieving');
  expect(menu.slice(7).map(item => item.role)).toEqual(['cut', 'copy', 'paste', 'selectAll']);
});

it('shows a disabled placeholder with no suggestions and no dictionary item without a misspelling', () => {
  const menu = buildSpellcheckMenuTemplate({ ...baseParams, misspelledWord: 'recieving', dictionarySuggestions: [] }, true, contents(), session([]))!;
  expect(menu[0]).toMatchObject({ label: 'No suggestions', enabled: false });
  const plain = buildSpellcheckMenuTemplate(baseParams, true, contents(), session([]))!;
  expect(plain.some(item => item.label === 'Add to dictionary')).toBe(false);
  expect(plain.slice(1).map(item => item.role)).toEqual(['cut', 'copy', 'paste', 'selectAll']);
});

it('keeps the spellcheck channels out of the plug-in allow-list', () => {
  expect(pluginDesktopChannelAllowed(DESKTOP_CHANNELS.spellcheck)).toBe(false);
  expect(pluginDesktopChannelAllowed(DESKTOP_CHANNELS.spellcheckLanguages)).toBe(false);
});

it('keeps the manual browser and notification popup spellcheck disabled', () => {
  const main = readFileSync(new URL('../apps/desktop/main.ts', import.meta.url), 'utf8');
  expect(main).toContain("'persist:harness-browser'");
  expect(main).toContain("'gen-attention',sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false");
});
