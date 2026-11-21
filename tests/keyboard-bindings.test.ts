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
const MODIFIERS = [['ctrlKey', 'ctrl'], ['metaKey', 'meta'], ['altKey', 'alt'], ['shiftKey', 'shift']] as const;
/** A comparison and the modifiers guarding it share one statement in these handlers, so `;` bounds the evidence. */
const statements = (text: string) => text.split(';');
const KEY_COMPARISON = /\.key(?:\.toLowerCase\(\))?\s*[!=]==?\s*'([^']*)'/g, KEY_LIST = /\[([^\]]*)\]\.includes\(\s*event\.key\s*\)/g, PREFERENCE_READ = /keybindings\.([A-Za-z]+)/g;

/** The modifiers a statement requires and negates around a key comparison. */
function guards(segment: string) {
  const positive = new Set<string>(), negated = new Set<string>();
  for (const [flag, modifier] of MODIFIERS) for (const match of segment.matchAll(new RegExp(`(!?)\\s*(?:[A-Za-z_$][\\w$]*\\.)?${flag}\\b`, 'g'))) (match[1] === '!' ? negated : positive).add(modifier);
  return {positive, negated};
}

/** True when a key comparison for the chord's key is guarded by exactly that chord's modifiers, not merely present in the file. */
function predicate(text: string, chord: string): boolean {
  const {modifiers, key} = readChord(chord), required = new Set(modifiers), escaped = key.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const comparison = new RegExp(`\\.key(?:\\.toLowerCase\\(\\))?\\s*[!=]==?\\s*'${escaped}'|\\[[^\\]]*'${escaped}'[^\\]]*\\]\\.includes\\(\\s*event\\.key\\s*\\)`, 'i');
  return statements(text).some(segment => {
    if (!comparison.test(segment)) return false;
    const {positive, negated} = guards(segment);
    return [...required].every(modifier => positive.has(modifier) || (modifier === 'ctrl' && positive.has('meta')))
      && [...positive].every(modifier => required.has(modifier) || (modifier === 'meta' && required.has('ctrl')))
      && ![...negated].some(modifier => required.has(modifier));
  });
}

/** Why a handler does not register this binding, or null when it does: it reads the registry chord, or its own predicate matches the chord's modifiers. */
function unregistered(binding: KeyboardBinding, text: string): string | null {
  if (binding.scope === 'System') return text.includes('toElectronAccelerator') ? null : 'a call to toElectronAccelerator';
  if (binding.preference) return text.includes(`keybindings.${binding.preference}`) ? null : `keybindings.${binding.preference}`;
  if (text.includes(`chordFor('${binding.id}')`)) return null;
  const missing = chords(binding).filter(chord => !predicate(text, chord));
  return missing.length ? `a predicate for ${missing.join(', ')}` : null;
}

/** Native control behavior rather than an app chord: these keys move focus or are recorded, never dispatched as a shortcut. */
const NATIVE_KEYS: Record<string, readonly string[]> = {
  'apps/web/src/App.tsx': ['enter', 'tab'],
  'apps/web/src/TerminalBody.tsx': ['tab'],
  'apps/web/src/Settings.tsx': ['tab', ',', ' ', 'control', 'meta', 'alt', 'shift'],
};

/** Every key literal and preference id the scanned modules register, so a chord no binding declares is reported. */
function undeclared(files: Record<string, string>, bindings: readonly KeyboardBinding[] = KEYBOARD_BINDINGS): string[] {
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

const MATCHER_ARGUMENT = /matchesShortcut\(\s*[A-Za-z_$][\w$]*\s*,\s*((?:[^()]|\([^()]*\))+)\)/g;

/** Matcher call sites must name a registered preference, a registry chord, or a chord the handler reads from the registry. */
function unregisteredMatchers(files: Record<string, string>): string[] {
  const preferences = new Set<string>(PREFERENCE_BINDINGS.map(binding => binding.preference)), literals = new Set(KEYBOARD_BINDINGS.flatMap(chords)), found: string[] = [];
  for (const [file, text] of Object.entries(files)) for (const match of text.matchAll(MATCHER_ARGUMENT)) {
    const argument = match[1]!.trim(), preference = /^preferences\.keybindings\.([A-Za-z]+)$/.exec(argument), literal = /^'([^']+)'$/.exec(argument), registered = /^chordFor\('([^']+)'\)$/.exec(argument);
    if (registered ? !KEYBOARD_BINDINGS.some(binding => binding.id === registered[1]) : preference ? !preferences.has(preference[1]!) : literal ? !literals.has(literal[1]!) : true) found.push(`${file}: matchesShortcut(…, ${argument})`);
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
  it('matches each chord against a handler predicate with the same modifiers, not a same-key coincidence', () => {
    for (const binding of KEYBOARD_BINDINGS) for (const handler of binding.handlers) expect(unregistered(binding, source(handler)), `${binding.id} in ${handler}`).toBeNull();
    const text = "if(event.shiftKey&&event.key==='ArrowUp')resize();if(event.ctrlKey&&event.key.toLowerCase()==='f')open();";
    expect(predicate(text, 'Ctrl+F')).toBe(true);
    expect(predicate(text, 'Ctrl+Shift+F')).toBe(false);
    expect(predicate(text, 'Ctrl+ArrowUp')).toBe(false);
    expect(predicate(text, 'Shift+ArrowUp')).toBe(true);
    expect(predicate("if(event.ctrlKey&&event.shiftKey&&event.key==='F'){}", 'Ctrl+Shift+F')).toBe(true);
    expect(predicate("if(event.ctrlKey&&event.shiftKey&&event.key==='F'){}", 'Ctrl+F')).toBe(false);
    expect(predicate("if(event.altKey&&!event.shiftKey&&event.key==='Enter'){}", 'Alt+Enter')).toBe(true);
    expect(predicate("if(event.altKey&&!event.shiftKey&&event.key==='Enter'){}", 'Alt+Shift+Enter')).toBe(false);
    const find = KEYBOARD_BINDINGS.find(binding => binding.id === 'find-in-conversation')!, selectAll = KEYBOARD_BINDINGS.find(binding => binding.id === 'terminal-select-all')!;
    expect(unregistered(find, "if(event.ctrlKey&&event.key==='f'){}")).toBeNull();
    expect(unregistered(selectAll, "if(event.ctrlKey&&event.key==='a'){}")).toContain('a predicate for Ctrl+Shift+A');
    expect(unregistered(find, "if(matchesShortcut(event,chordFor('find-in-conversation'))){}")).toBeNull();
  });
  it('reports a handler key the registry does not declare', () => {
    const scanned = new Set(KEYBOARD_BINDINGS.flatMap(binding => binding.handlers)), files = Object.fromEntries([...scanned].map(file => [file, source(file)]));
    expect(undeclared(files)).toEqual([]);
    expect(undeclared({'apps/web/src/TerminalBody.tsx': "if(event.ctrlKey&&event.key==='q'){}", 'apps/web/src/WorkspaceHost.tsx': 'matchesShortcut(event, preferences.keybindings.executeShell)'})).toEqual(['apps/web/src/TerminalBody.tsx: q', 'apps/web/src/WorkspaceHost.tsx: keybindings.executeShell']);
  });
  it('rejects a matcher call site the registry does not know, anywhere in the web app', () => {
    const files = Object.fromEntries((readdirSync(new URL('../apps/web/src', import.meta.url), {recursive: true}) as string[]).filter(file => /\.tsx?$/.test(file)).map(file => {const path = `apps/web/src/${file.replaceAll('\\', '/')}`; return [path, source(path)] as const;}));
    expect(Object.keys(files).length).toBeGreaterThan(50);
    expect(unregisteredMatchers(files)).toEqual([]);
    expect(unregisteredMatchers({'apps/web/src/Terminal.tsx': "matchesShortcut(event, 'Ctrl+Q'); matchesShortcut(event, preferences.keybindings.executeShell); matchesShortcut(event, shortcut); matchesShortcut(event, chordFor('no-such-binding'));"})).toEqual(['apps/web/src/Terminal.tsx: matchesShortcut(…, \'Ctrl+Q\')', 'apps/web/src/Terminal.tsx: matchesShortcut(…, preferences.keybindings.executeShell)', 'apps/web/src/Terminal.tsx: matchesShortcut(…, shortcut)', 'apps/web/src/Terminal.tsx: matchesShortcut(…, chordFor(\'no-such-binding\'))']);
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
    expect(shortcutKeys('Ctrl+K', 'mac')).toBe('⌘K');
    expect(shortcutKeys('Ctrl+Meta+K', 'mac')).toBe('⌃⌘K');
    expect(shortcutKeys('Ctrl+Meta+K', 'other')).toBe('Ctrl+Meta+K');
    const combined = {key: 'k', ctrlKey: true, metaKey: true, shiftKey: false, altKey: false};
    expect(matchesShortcut(combined, 'Ctrl+Meta+K')).toBe(true);
    expect(matchesShortcut({...combined, ctrlKey: false}, 'Ctrl+Meta+K')).toBe(false);
    expect(ariaShortcut('Ctrl+Shift+A')).toBe('Control+Shift+A');
    expect(ariaShortcut('Alt+ArrowUp')).toBe('Alt+ArrowUp');
    expect(shortcutPlatform({platform: 'MacIntel'})).toBe('mac');
    expect(shortcutPlatform({platform: 'Win32', userAgent: 'Mozilla/5.0'})).toBe('other');
    expect(shortcutPlatform({userAgent: 'Mozilla/5.0 (iPhone)'})).toBe('mac');
  });
  it('keeps the sidebar announcement derived from the registry', () => {
    expect(ariaKeyShortcuts(['thread-place', 'thread-reorder-up', 'thread-reorder-down'])).toBe('Alt+Enter Alt+ArrowUp Alt+ArrowDown');
    expect(ariaKeyShortcuts(['thread-reorder-up', 'thread-reorder-down'])).toBe('Alt+ArrowUp Alt+ArrowDown');
  });
  it('renders every registered binding from the registry and follows a rebound chord', () => {
    const html = renderToStaticMarkup(createElement(KeyboardReference, {keybindings: {...DEFAULT_PREFERENCES.keybindings, search: 'Alt+K'}, desktop: true}));
    expect(html.split('data-binding-id="').length - 1).toBe(KEYBOARD_BINDINGS.length);
    for (const binding of KEYBOARD_BINDINGS) {
      expect(html, binding.id).toContain(`data-binding-id="${binding.id}"`);
      expect(html, binding.id).toContain(binding.label);
      expect(html, binding.scope).toContain(`<h3>${binding.scope}</h3>`);
    }
    const search = html.slice(html.indexOf('data-binding-id="search"')).split('</div>')[0]!;
    expect(search).toContain(shortcutKeys('Alt+K', shortcutPlatform()));
    expect(html).toContain(KEYBOARD_BINDINGS.find(binding => binding.id === 'window-move')!.hint!);
  });
  it('is reachable from the Settings shortcut section', () => {
    const data: SettingsData = {
      sequence: 1, settings: {theme: 'dark', modelId: null, preferences: {keybindings: {search: 'Alt+K'}}},
      accounts: [], skills: [], skillProposals: [], learning: {supported: true, status: 'idle', lastReview: null}, projects: [], resources: [], archivedThreads: [],
      counts: {threads: 0, archivedThreads: 0, artifacts: 0, resources: 0, uncertainOperations: 0},
    };
    const html = renderToStaticMarkup(createElement(SettingsView, {data, draftReferences: async () => ({threads: [], skills: [], requests: [], userStates: []}), initialSection: 'keybindings', modelError: '', refresh: async () => {}, loadModels: async () => {}, close: () => {}, addResource: () => {}}));
    expect(html).toContain('data-setting-id="harness-keyboard-reference"');
    const visible = KEYBOARD_BINDINGS.filter(binding => binding.scope !== 'System');
    expect(html.split('data-binding-id="').length - 1).toBe(visible.length);
    for (const binding of visible) expect(html, binding.id).toContain(`data-binding-id="${binding.id}"`);
  });
});
