import {useId} from 'react';
import type {UiPreferences} from '../../../packages/contracts/preferences';
import {KEYBOARD_SCOPES, resolveKeyboardBindings, shortcutPlatform, type ShortcutPlatform} from './keyboard-bindings';

/** Reference surface for KEYBOARD_BINDINGS. Every row comes from the registry, so a registered chord cannot be missing here. */
export function KeyboardReference({keybindings, platform = shortcutPlatform()}: {keybindings: UiPreferences['keybindings']; platform?: ShortcutPlatform}) {
  const id = useId(), rows = resolveKeyboardBindings(keybindings, platform);
  return <section className="settings-card settings-shortcuts" aria-labelledby={id}>
    <h2 id={id}>All shortcuts</h2>
    <p className="settings-card-intro">Chords the workspace registers, by scope. Rebinding the shortcuts above updates this list.</p>
    {KEYBOARD_SCOPES.map(scope => {
      const group = rows.filter(row => row.scope === scope);
      return group.length ? <div key={scope} className="settings-shortcuts-group"><h3>{scope}</h3>{group.map(row => <div key={row.id} className="settings-shortcuts-row" data-binding-id={row.id}><span className="settings-shortcuts-label">{row.label}{row.hint ? <small>{row.hint}</small> : null}</span><span className="settings-shortcuts-keys">{row.keys.map((key, index) => <kbd key={`${index}-${key}`}>{key}</kbd>)}</span></div>)}</div> : null;
    })}
  </section>;
}
