import {describe,expect,it} from 'vitest';
import {readdirSync, readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DEFAULT_PREFERENCES} from '../packages/contracts/preferences';
import {KEYBOARD_BINDINGS, KEYBOARD_SCOPES, PREFERENCE_BINDINGS, ariaKeyShortcuts, ariaShortcut, bindingChords, readChord, shortcutKeys, shortcutPlatform, type KeyboardBinding} from '../apps/web/src/keyboard-bindings';
import {KeyboardReference} from '../apps/web/src/KeyboardReference';
import {SettingsView} from '../apps/web/src/Settings';
import type {SettingsData} from '../apps/web/src/settings-data';
import {matchesShortcut} from '../apps/web/src/shell-layout';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const chords = (binding: KeyboardBinding) => bindingChords(binding, DEFAULT_PREFERENCES.keybindings);

/** Key-event flags a chord must be compared against, plus the literal its handler compares the key name to. */
function evidence(chord: string): string[] {
  const {modifiers, key} = readChord(chord), flags = modifiers.filter(modifier => ['ctrl', 'meta', 'alt', 'shift'].includes(modifier)).map(modifier => `${modifier}Key`);
  return [...flags, `'${key}'`];
}

const MATCHER_ARGUMENT = /matchesShortcut\(\s*[A-Za-z_$][\w$]*\s*,\s*([^)]+)\)/g;
const KEY_COMPARISON = /\.key(?:\.toLowerCase\(\))?\s*[!=]==?\s*'([^']*)'/g, KEY_LIST = /\[([^\]]*)\]\.includes\(\s*event\.key\s*\)/g, PREFERENCE_READ = /keybindings\.([A-Za-z]+)/g;
/** Native control behavior rather than an app chord: these keys move focus or are recorded, never dispatched as a shortcut. */
const NATIVE_KEYS: Record<string, readonly string[]> = {
  'apps/web/src/App.tsx': ['enter', 'tab'],
  'apps/web/src/TerminalBody.tsx': ['tab'],
  'apps/web/src/Settings.tsx': ['tab', ',', 'control', 'meta', 'alt', 'shift'],
};

/** Every key literal and preference id the scanned modules register, so a chord no binding declares is reported. */
function unregistered(files: Record<string, string>, bindings: readonly KeyboardBinding[] = KEYBOARD_BINDINGS): string[] {
  const preferences = new Set<string>(PREFERENCE_BINDINGS.map(binding => binding.preference)), found: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    const known = new Set(bindings.filter(binding => binding.handlers.includes(file)).flatMap(binding => chords(binding).map(chord => readChord(chord).key.toLowerCase()))), native = NATIVE_KEYS[file] ?? [];
    const keys = [...text.matchAll(KEY_COMPARISON)].map(match => match[1]!.toLowerCase());
    for (const list of [...text.matchAll(KEY_LIST)]) for (const quoted of list[1]!.matchAll(/'([^']+)'/g)) keys.push(quoted[1]!.toLowerCase());
    for (const key of new Set(keys)) if (!known.has(key) && !native.includes(key)) found.push(`${file}: ${key}`);
    for (const match of text.matchAll(PREFERENCE_READ)) if (!preferences.has(match[1]!)) found.push(`${file}: keybindings.${match[1]}`);
  }
  return found;
}

/** Matcher call sites must name a registered preference or a chord the registry declares. */
function unregisteredMatchers(files: Record<string, string>): string[] {
  const preferences = new Set<string>(PREFERENCE_BINDINGS.map(binding => binding.preference)), literals = new Set(KEYBOARD_BINDINGS.flatMap(chords)), found: string[] = [];
  for (const [file, text] of Object.entries(files)) for (const match of text.matchAll(MATCHER_ARGUMENT)) {
    const argument = match[1]!.trim(), preference = /^preferences\.keybindings\.([A-Za-z]+)$/.exec(argument), literal = /^'([^']+)'$/.exec(argument);
    if (preference ? !preferences.has(preference[1]!) : literal ? !literals.has(literal[1]!) : true) found.push(`${file}: matchesShortcut(…, ${argument})`);
  }
  return found;
}

describe('keyboard binding registry', () => {
  it('declares one chord source, a known scope and readable handlers for every binding', () => {
    const ids = new Set<string>(), labels = new Set<string>();
    for (const binding of KEYBOARD_BINDINGS) {
      expect(ids.has(binding.id), binding.id).toBe(false); ids.add(binding.id);
      expect(labels.has(binding.label), binding.label).toBe(false); labels.add(binding.label);
      expect(KEYBOARD_SCOPES).toContain(binding.scope);
      expect(Boolean(binding.preference) !== Boolean(binding.chords?.length), `${binding.id} needs exactly one chord source`).toBe(true);
      expect(binding.handlers.length, binding.id).toBeGreaterThan(0);
      for (const handler of binding.handlers) expect(source(handler).length, `${binding.id} handler ${handler}`).toBeGreaterThan(0);
      for (const chord of chords(binding)) expect(chord.trim(), binding.id).toBe(chord);
    }
  });
  it('registers every rebindable contract key once', () => {
    expect(PREFERENCE_BINDINGS.map(binding => binding.preference).sort()).toEqual(Object.keys(DEFAULT_PREFERENCES.keybindings).sort());
  });
  it('parses every chord with the matcher the handlers call', () => {
    for (const binding of KEYBOARD_BINDINGS) for (const chord of chords(binding)) {
      const {modifiers, key} = readChord(chord), press = {key: key === 'comma' ? ',' : key === 'esc' ? 'Escape' : key, ctrlKey: modifiers.includes('ctrl'), metaKey: false, shiftKey: modifiers.includes('shift'), altKey: modifiers.includes('alt')};
      expect(matchesShortcut(press, chord), `${binding.id} ${chord}`).toBe(true);
      if (modifiers.length) expect(matchesShortcut({...press, ctrlKey: false, altKey: false, shiftKey: false}, chord), `${binding.id} ${chord} without modifiers`).toBe(false);
      expect(matchesShortcut({...press, metaKey: true, ctrlKey: false}, chord), `${binding.id} ${chord} as Cmd`).toBe(modifiers.includes('ctrl'));
    }
  });
  it('names the chords its declared handlers compare against', () => {
    for (const binding of KEYBOARD_BINDINGS) for (const handler of binding.handlers) {
      const text = source(handler);
      for (const chord of chords(binding)) for (const token of binding.preference ? [`keybindings.${binding.preference}`] : evidence(chord)) expect(text.toLowerCase(), `${binding.id} ${chord} in ${handler}`).toContain(token.toLowerCase());
    }
  });
  it('reports a handler key the registry does not declare', () => {
    const scanned = new Set(KEYBOARD_BINDINGS.flatMap(binding => binding.handlers)), files = Object.fromEntries([...scanned].map(file => [file, source(file)]));
    expect(unregistered(files)).toEqual([]);
    expect(unregistered({'apps/web/src/TerminalBody.tsx': "if(event.ctrlKey&&event.key==='q'){}", 'apps/web/src/WorkspaceHost.tsx': 'matchesShortcut(event, preferences.keybindings.executeShell)'})).toEqual(['apps/web/src/TerminalBody.tsx: q', 'apps/web/src/WorkspaceHost.tsx: keybindings.executeShell']);
  });
  it('rejects a matcher call site the registry does not know, anywhere in the web app', () => {
    const files = Object.fromEntries((readdirSync(new URL('../apps/web/src', import.meta.url), {recursive: true}) as string[]).filter(file => /\.tsx?$/.test(file)).map(file => {const path = `apps/web/src/${file.replaceAll('\\', '/')}`; return [path, source(path)] as const;}));
    expect(Object.keys(files).length).toBeGreaterThan(50);
    expect(unregisteredMatchers(files)).toEqual([]);
    expect(unregisteredMatchers({'apps/web/src/Terminal.tsx': "matchesShortcut(event, 'Ctrl+Q'); matchesShortcut(event, preferences.keybindings.executeShell); matchesShortcut(event, shortcut);"})).toEqual(['apps/web/src/Terminal.tsx: matchesShortcut(…, \'Ctrl+Q\')', 'apps/web/src/Terminal.tsx: matchesShortcut(…, preferences.keybindings.executeShell)', 'apps/web/src/Terminal.tsx: matchesShortcut(…, shortcut)']);
  });
  it('spells keys for the platform and for assistive technology', () => {
    expect(shortcutKeys('Ctrl+K', 'other')).toBe('Ctrl+K');
    expect(shortcutKeys('Ctrl+Shift+O', 'mac')).toBe('⌘⇧O');
    expect(shortcutKeys('Shift+ArrowUp', 'mac')).toBe('⇧↑');
    expect(shortcutKeys('Alt+ArrowDown', 'other')).toBe('Alt+↓');
    expect(shortcutKeys('Ctrl+Comma', 'other')).toBe('Ctrl+,');
    expect(shortcutKeys('Escape', 'other')).toBe('Esc');
    expect(shortcutKeys('Home', 'other')).toBe('Home');
    expect(shortcutKeys('Ctrl+ArrowUp', 'other')).toBe('Ctrl+↑');
    expect(ariaShortcut('Ctrl+Shift+A')).toBe('Control+Shift+A');
    expect(ariaShortcut('Alt+ArrowUp')).toBe('Alt+ArrowUp');
    expect(shortcutPlatform({platform: 'MacIntel'})).toBe('mac');
    expect(shortcutPlatform({platform: 'Win32', userAgent: 'Mozilla/5.0'})).toBe('other');
    expect(shortcutPlatform({userAgent: 'Mozilla/5.0 (iPhone)'})).toBe('mac');
  });
  it('keeps the sidebar announcement derived from the registry', () => {
    expect(ariaKeyShortcuts(['thread-place', 'thread-reorder'])).toBe('Alt+Enter Alt+ArrowUp Alt+ArrowDown');
    expect(ariaKeyShortcuts(['thread-reorder'])).toBe('Alt+ArrowUp Alt+ArrowDown');
  });
  it('renders every registered binding from the registry and follows a rebound chord', () => {
    const html = renderToStaticMarkup(createElement(KeyboardReference, {keybindings: {...DEFAULT_PREFERENCES.keybindings, search: 'Alt+K'}}));
    expect(html.split('data-binding-id="').length - 1).toBe(KEYBOARD_BINDINGS.length);
    for (const binding of KEYBOARD_BINDINGS) {
      expect(html, binding.id).toContain(`data-binding-id="${binding.id}"`);
      expect(html, binding.id).toContain(binding.label);
      expect(html, binding.scope).toContain(`<h3>${binding.scope}</h3>`);
    }
    const search = html.slice(html.indexOf('data-binding-id="search"')).split('</div>')[0]!;
    expect(search).toContain(shortcutKeys('Alt+K', shortcutPlatform()));
  });
  it('is reachable from the Settings shortcut section', () => {
    const data: SettingsData = {
      sequence: 1, settings: {theme: 'dark', modelId: null, preferences: {keybindings: {search: 'Alt+K'}}},
      accounts: [], skills: [], skillProposals: [], learning: {supported: true, status: 'idle', lastReview: null}, projects: [], resources: [], archivedThreads: [],
      counts: {threads: 0, archivedThreads: 0, artifacts: 0, resources: 0, uncertainOperations: 0},
    };
    const html = renderToStaticMarkup(createElement(SettingsView, {data, draftReferences: async () => ({threads: [], skills: [], requests: [], userStates: []}), initialSection: 'keybindings', modelError: '', refresh: async () => {}, loadModels: async () => {}, close: () => {}, addResource: () => {}}));
    expect(html).toContain('data-setting-id="harness-keyboard-reference"');
    expect(html.split('data-binding-id="').length - 1).toBe(KEYBOARD_BINDINGS.length);
    for (const binding of KEYBOARD_BINDINGS) expect(html, binding.id).toContain(`data-binding-id="${binding.id}"`);
  });
});
