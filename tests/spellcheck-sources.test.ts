import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';

// Issue #1367 acceptance: the five prompt textareas follow the preference and
// the six non-prose inputs keep spellCheck={false}; Settings rows are registered.
const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('every prompt textarea takes the composer spellcheck preference', () => {
  expect(read('apps/web/src/App.tsx')).toContain('spellCheck={preferences.composerSpellcheck}');
  expect(read('apps/web/src/SideChat.tsx')).toContain('spellCheck={getPreferences(snapshot.settings).composerSpellcheck}');
  expect(read('apps/web/src/ScopedConversationComposer.tsx')).toContain('spellCheck={spellcheck === true}');
  expect(read('apps/web/src/agents-workspace/AgentsWorkspace.tsx')).toContain('spellCheck={preferences?.composerSpellcheck === true}');
  const app = read('apps/web/src/App.tsx');
  expect(app.match(/spellcheck=\{getPreferences\(snapshot\.settings\)\.composerSpellcheck\}/g)?.length).toBe(2); // SideThreadComposer call sites
});

test('the six non-prose inputs keep spellCheck={false}', () => {
  for (const path of ['apps/web/src/ModelPicker.tsx', 'apps/web/src/EnvironmentSettings.tsx', 'apps/web/src/ConversationFind.tsx', 'apps/web/src/ProjectPicker.tsx', 'apps/web/src/files/ProjectSearch.tsx', 'apps/web/src/CredentialEntry.tsx'])
    expect(read(path), path).toContain('spellCheck={false}');
});

test('settings registers Check spelling + Spelling language in Chat & Composer', () => {
  const source = read('apps/web/src/Settings.tsx');
  expect(source).toContain("row('composer-spellcheck', 'Check spelling', 'chat', 'spelling spellcheck typo dictionary language')");
  expect(source).toContain("row('spellcheck-language', 'Spelling language', 'chat'");
  expect(source).toContain('settings-row-reveal');
  expect(source).toContain('spellcheckLanguages');
  expect(read('apps/web/src/settings.css')).toContain('grid-template-rows:0fr');
});
