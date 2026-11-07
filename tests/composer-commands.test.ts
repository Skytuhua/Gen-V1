import {expect, it} from 'vitest';
import {commandToken, replaceCommandToken, skillBindingSchema} from '../apps/web/src/composer-commands';

it('finds slash commands at the caret after text without interpreting URLs or paths', () => {
  expect(commandToken('Please explain /', 16)).toEqual({start: 15, end: 16, query: ''});
  expect(commandToken('/model', 4)).toEqual({start: 0, end: 6, query: 'mod'});
  expect(commandToken('x\n/skill:test', 13)).toEqual({start: 2, end: 13, query: 'skill:test'});
  for (const text of ['https://example.test/model', 'C:/model', './model', '/usr/local', '/foo\\bar', 'text/model', '/']) {
    if (text === '/') continue;
    expect(commandToken(text, text.length), text).toBeNull();
  }
  expect(commandToken('/', 1, 0)).toBeNull();
});
it('replaces only the exact command token and preserves surrounding text and caret', () => {
  const text = 'Before /mod after', token = commandToken(text, 11)!;
  expect(replaceCommandToken(text, token)).toEqual({text: 'Before  after', caret: 7});
  expect(() => replaceCommandToken('changed', token)).toThrow();
});
it('admits a bounded Personal selection identity without converting literal text into a skill', () => {
  const ref = {version: 1, scope: {kind: 'personal'}, sourceId: 'personal:test', skillId: 'id', locator: 'a'.repeat(64), revision: 'b'.repeat(64), digest: 'c'.repeat(64), sourceBinding: 'd'.repeat(64)};
  const binding = {id: crypto.randomUUID(), name: 'Test', source: 'Personal', ref};
  expect(skillBindingSchema.parse(binding)).toEqual(binding);
  expect(skillBindingSchema.safeParse({...binding, ref: {...ref, scope: {kind: 'provider', providerId: 'private', scopeId: 'company'}}}).success).toBe(false);
  expect(skillBindingSchema.safeParse('/skill:Test').success).toBe(false);
});
