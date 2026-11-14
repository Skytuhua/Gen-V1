import {expect, it} from 'vitest';
import {matchesShortcut} from '../apps/web/src/shell-layout';

const key = {key:'+', ctrlKey:true, metaKey:false, shiftKey:true, altKey:false};
it('matches a literal plus shortcut as recorded by Settings, including Shift on US keyboards', () => {
  expect(matchesShortcut(key, 'Ctrl+Shift++')).toBe(true);
  expect(matchesShortcut({...key, key:'='}, 'Ctrl+Shift++')).toBe(false);
  expect(matchesShortcut({...key, ctrlKey:false, shiftKey:false}, '+')).toBe(true);
});
it('requires both requested modifiers while preserving existing Ctrl cross-platform aliases', () => {
  const press = {...key, key:'K', shiftKey:false};
  expect(matchesShortcut(press, 'Ctrl+Meta+K')).toBe(false);
  expect(matchesShortcut({...press, ctrlKey:false, metaKey:true}, 'Ctrl+Meta+K')).toBe(false);
  expect(matchesShortcut({...press, metaKey:true}, 'Ctrl+Meta+K')).toBe(true);
  expect(matchesShortcut({...press, ctrlKey:false, metaKey:true}, 'Ctrl+K')).toBe(true);
  expect(matchesShortcut({...press, metaKey:true}, 'Ctrl+K')).toBe(false);
  expect(matchesShortcut({...press, metaKey:true}, 'Meta+K')).toBe(false);
});
