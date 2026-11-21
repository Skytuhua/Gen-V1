import {DEFAULT_PREFERENCES, type UiPreferences} from '../../../packages/contracts/preferences';

/** Where a chord is registered. The reference lists scopes in this order. */
export type KeyboardScope = 'System' | 'Global' | 'Conversation' | 'Terminal' | 'Sidebar' | 'Settings' | 'Workspace';
export const KEYBOARD_SCOPES: readonly KeyboardScope[] = ['System', 'Global', 'Conversation', 'Terminal', 'Sidebar', 'Settings', 'Workspace'];
export type ShortcutPlatform = 'mac' | 'other';

export interface KeyboardBinding {
  id: string;
  label: string;
  scope: KeyboardScope;
  /** Canonical chords in the form matchesShortcut reads and Settings stores; absent when `preference` owns the chord. */
  chords?: readonly string[];
  /** What a held modifier does to the chord, when the handler applies it instead of matching it. */
  hint?: string;
  /** Settings key that rebinds the chord. The live value always comes from preferences, never a copy here. */
  preference?: keyof UiPreferences['keybindings'];
  /** Repository-relative modules that compare the chord against a key event; tests/keyboard-bindings.test.ts reads them. */
  handlers: readonly string[];
}

const module = (name: string) => `apps/web/src/${name}`;

/** The only declaration of a shortcut. Handlers, Settings rows and the reference all read it. */
export const KEYBOARD_BINDINGS: readonly KeyboardBinding[] = [
  {id: 'quick-ask', label: 'Open quick ask from any app', scope: 'System', preference: 'quickAsk', handlers: ['apps/desktop/quick-ask.ts']},
  {id: 'search', label: 'Search threads', scope: 'Global', preference: 'search', handlers: [module('App.tsx'), module('WorkspaceHost.tsx')]},
  {id: 'new-thread', label: 'New thread', scope: 'Global', preference: 'newThread', handlers: [module('App.tsx'), module('WorkspaceHost.tsx')]},
  {id: 'toggle-sidebar', label: 'Toggle sidebar', scope: 'Global', preference: 'toggleSidebar', handlers: [module('App.tsx'), module('WorkspaceHost.tsx')]},
  {id: 'toggle-workspace-panel', label: 'Toggle workspace panel', scope: 'Workspace', preference: 'toggleRightPanel', handlers: [module('App.tsx')]},
  {id: 'open-settings', label: 'Open settings', scope: 'Global', preference: 'openSettings', handlers: [module('App.tsx'), module('WorkspaceHost.tsx')]},
  {id: 'stop-run', label: 'Stop active run', scope: 'Global', preference: 'stop', handlers: [module('App.tsx'), module('WorkspaceHost.tsx')]},
  {id: 'find-in-conversation', label: 'Find in the conversation', scope: 'Conversation', chords: ['Ctrl+F'], handlers: [module('ConversationFind.tsx')]},
  {id: 'find-next-match', label: 'Next match', scope: 'Conversation', chords: ['Enter'], handlers: [module('ConversationFind.tsx')]},
  {id: 'find-previous-match', label: 'Previous match', scope: 'Conversation', chords: ['Shift+Enter'], handlers: [module('ConversationFind.tsx')]},
  {id: 'close-find', label: 'Close find', scope: 'Conversation', chords: ['Escape'], handlers: [module('ConversationFind.tsx')]},
  {id: 'terminal-select-all', label: 'Select all terminal text', scope: 'Terminal', chords: ['Ctrl+Shift+A'], handlers: [module('TerminalBody.tsx')]},
  {id: 'thread-place', label: 'Place a focused thread in the workspace', scope: 'Sidebar', chords: ['Alt+Enter'], handlers: [module('ShellSidebar.tsx')]},
  {id: 'thread-reorder-up', label: 'Move a focused thread up', scope: 'Sidebar', chords: ['Alt+ArrowUp'], handlers: [module('sidebar-reorder.ts')]},
  {id: 'thread-reorder-down', label: 'Move a focused thread down', scope: 'Sidebar', chords: ['Alt+ArrowDown'], handlers: [module('sidebar-reorder.ts')]},
  {id: 'thread-drag-cancel', label: 'Cancel a sidebar drag', scope: 'Sidebar', chords: ['Escape'], handlers: [module('sidebar-reorder.ts')]},
  {id: 'settings-next-section', label: 'Next settings section', scope: 'Settings', chords: ['ArrowDown'], handlers: [module('Settings.tsx')]},
  {id: 'settings-previous-section', label: 'Previous settings section', scope: 'Settings', chords: ['ArrowUp'], handlers: [module('Settings.tsx')]},
  {id: 'settings-first-section', label: 'First settings section', scope: 'Settings', chords: ['Home'], handlers: [module('Settings.tsx')]},
  {id: 'settings-last-section', label: 'Last settings section', scope: 'Settings', chords: ['End'], handlers: [module('Settings.tsx')]},
  {id: 'settings-clear-search', label: 'Clear the settings search', scope: 'Settings', chords: ['Escape'], handlers: [module('Settings.tsx')]},
  {id: 'window-move', label: 'Move the focused window', scope: 'Workspace', chords: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], hint: 'Hold Shift to resize it, or Alt for 2 px steps', handlers: [module('FloatingWindow.tsx')]},
  {id: 'window-restore', label: 'Return the focused window to its edge position', scope: 'Workspace', chords: ['Home'], handlers: [module('FloatingWindow.tsx')]},
  {id: 'window-close', label: 'Close or collapse the focused window', scope: 'Workspace', chords: ['Escape'], handlers: [module('FloatingWindow.tsx')]},
];

/** The rebindable subset, in registry order; Settings turns these into shortcut rows. */
export const PREFERENCE_BINDINGS: readonly {preference: keyof UiPreferences['keybindings']; label: string}[] = KEYBOARD_BINDINGS.flatMap(binding => binding.preference ? [{preference: binding.preference, label: binding.label}] : []);

/** Splits a canonical chord with the same literal-plus rule matchesShortcut applies. */
export function readChord(chord: string) {
  const binding = chord.toLowerCase().trim(), plus = binding === '+' || binding.endsWith('++');
  const parts = (plus ? binding.slice(0, -1) : binding).split('+').map(part => part.trim());
  return {modifiers: parts.slice(0, -1), key: plus ? '+' : parts.at(-1) ?? ''};
}

const macModifiers: Record<string, string> = {ctrl: '⌘', meta: '⌘', alt: '⌥', shift: '⇧'};
const displayModifiers: Record<string, string> = {ctrl: 'Ctrl', meta: 'Meta', alt: 'Alt', shift: 'Shift'};
const displayKeys: Record<string, string> = {comma: ',', space: 'Space', esc: 'Esc', escape: 'Esc', home: 'Home', end: 'End', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', enter: '↩'};
const spellKey = (key: string, named: string | undefined) => named ?? (/^[a-z]$/.test(key) ? key.toUpperCase() : key);
const ariaModifiers: Record<string, string> = {ctrl: 'Control', meta: 'Meta', alt: 'Alt', shift: 'Shift'};
const ariaKeys: Record<string, string> = {comma: ',', space: 'Space', esc: 'Escape', escape: 'Escape', enter: 'Enter', home: 'Home', tab: 'Tab', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight'};

/** Detects the chord spelling a person expects for their platform; the app window reports mac or its own platform. */
export function shortcutPlatform(nav: {platform?: string; userAgent?: string} | undefined = typeof navigator === 'undefined' ? undefined : navigator): ShortcutPlatform {
  return /mac|iphone|ipad/i.test(`${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`) ? 'mac' : 'other';
}

/** Formats a canonical chord for the person's keyboard, e.g. ⌘K on mac and Ctrl+K elsewhere. */
export function shortcutKeys(chord: string, platform: ShortcutPlatform = shortcutPlatform()): string {
  const {modifiers, key} = readChord(chord), named = spellKey(key, displayKeys[key]);
  // A lone Ctrl means either platform modifier, but Ctrl+Meta needs both, so mac must spell the Control key it requires.
  const both = platform === 'mac' && modifiers.includes('ctrl') && modifiers.includes('meta');
  return platform === 'mac' ? `${modifiers.map(modifier => both && modifier === 'ctrl' ? '⌃' : macModifiers[modifier] ?? modifier.toUpperCase()).join('')}${named}` : [...modifiers.map(modifier => displayModifiers[modifier] ?? modifier), named].join('+');
}

/** Canonical aria-keyshortcuts spelling for one chord. */
export function ariaShortcut(chord: string): string {
  const {modifiers, key} = readChord(chord);
  return [...modifiers.map(modifier => ariaModifiers[modifier] ?? modifier), spellKey(key, ariaKeys[key])].join('+');
}

/** The one chord a handler compares. Handlers use this instead of spelling a chord, so a registry edit can never leave them behind. */
export function chordFor(id: string, keybindings: UiPreferences['keybindings'] = DEFAULT_PREFERENCES.keybindings): string {
  const binding = KEYBOARD_BINDINGS.find(value => value.id === id);
  if (!binding) throw Error(`No keyboard binding is registered as ${id}.`);
  return bindingChords(binding, keybindings)[0]!;
}

/** The chords a binding registers, resolved against the live preferences for rebindable ones. */
export function bindingChords(binding: KeyboardBinding, keybindings: UiPreferences['keybindings'] = DEFAULT_PREFERENCES.keybindings): readonly string[] {
  return binding.preference ? [keybindings[binding.preference]] : binding.chords ?? [];
}

export interface ResolvedKeyboardBinding { id: string; label: string; scope: KeyboardScope; chords: readonly string[]; keys: readonly string[]; hint?: string; rebindable: boolean }

/** Everything a reference row needs, with keys already spelled for the platform. */
export function resolveKeyboardBindings(keybindings: UiPreferences['keybindings'] = DEFAULT_PREFERENCES.keybindings, platform: ShortcutPlatform = shortcutPlatform()): ResolvedKeyboardBinding[] {
  return KEYBOARD_BINDINGS.map(binding => {
    const chords = bindingChords(binding, keybindings);
    return {id: binding.id, label: binding.label, scope: binding.scope, chords, keys: chords.map(chord => shortcutKeys(chord, platform)), hint: binding.hint, rebindable: Boolean(binding.preference)};
  });
}

/** aria-keyshortcuts list for the given binding ids, in registry order. */
export function ariaKeyShortcuts(ids: readonly string[], keybindings: UiPreferences['keybindings'] = DEFAULT_PREFERENCES.keybindings): string {
  return KEYBOARD_BINDINGS.filter(binding => ids.includes(binding.id)).flatMap(binding => bindingChords(binding, keybindings).map(ariaShortcut)).join(' ');
}
