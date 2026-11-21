import {useId} from 'react';
import {useDesktop} from './desktop-context';
import type {UiPreferences} from '../../../packages/contracts/preferences';
import {KEYBOARD_SCOPES, resolveKeyboardBindings, shortcutPlatform, type ShortcutPlatform} from './keyboard-bindings';

/** Reference surface for KEYBOARD_BINDINGS. Every row comes from the registry, so a registered chord cannot be missing here. */
export function KeyboardReference({keybindings, platform = shortcutPlatform(), desktop, quickAskEnabled = true}: {keybindings: UiPreferences['keybindings']; platform?: ShortcutPlatform; desktop?: boolean; quickAskEnabled?: boolean}) {
  const context = useDesktop(), isDesktop = desktop ?? Boolean(context);
  const id = useId(), rows = resolveKeyboardBindings(keybindings, platform);
  return <section className="settings-card settings-shortcuts" aria-labelledby={id}>
    <h2 id={id}>All shortcuts</h2>
    <p className="settings-card-intro">Chords the workspace registers, by scope. Rebinding the shortcuts above updates this list.</p>
    {KEYBOARD_SCOPES.map(scope => {
      if (scope === 'System' && !isDesktop) return null;
      const group = rows.filter(row => row.scope === scope);
      return group.length ? <div key={scope} className="settings-shortcuts-group"><h3>{scope}</h3>{group.map(row => <div key={row.id} className="settings-shortcuts-row" data-binding-id={row.id}><span className="settings-shortcuts-label">{row.label}{row.hint ? <small>{row.hint}</small> : null}</span><span className="settings-shortcuts-keys">{row.keys.map((key, index) => <kbd key={`${index}-${key}`}>{key}</kbd>)}{row.scope === 'System' && !quickAskEnabled ? <small> (off)</small> : null}</span></div>)}</div> : null;
    })}
  </section>;
}
