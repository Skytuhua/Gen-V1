import {expect, it} from 'vitest';
import {activeMentions, mentionLiteral, mentionToken, replaceMentionToken} from '../apps/web/src/composer-mentions';

it('finds @ tokens at the start and after whitespace, never inside an e-mail', () => {
  expect(mentionToken('@', 1)).toEqual({start: 0, end: 1, query: ''});
  expect(mentionToken('@src/ma', 7)).toEqual({start: 0, end: 7, query: 'src/ma'});
  expect(mentionToken('explain @src', 12)).toEqual({start: 8, end: 12, query: 'src'});
  expect(mentionToken('one\ntwo @no', 11)).toEqual({start: 8, end: 11, query: 'no'});
  for (const text of ['a@b', 'mail me a@b.com', 'text@', 'x@', 'path@@x'])
    expect(mentionToken(text, text.length), text).toBeNull();
});

it('reads a quoted query and stops the token at the caret', () => {
  expect(mentionToken('@"my fi', 7)).toEqual({start: 0, end: 7, query: 'my fi'});
  expect(mentionToken('go @"dir sub/x', 14)).toEqual({start: 3, end: 14, query: 'dir sub/x'});
  expect(mentionToken('@abc def', 4)).toEqual({start: 0, end: 4, query: 'abc'}); // caret before the space
});

it('returns null for a non-collapsed selection or out-of-range caret', () => {
  expect(mentionToken('@ab', 3, 1)).toBeNull();
  expect(mentionToken('@ab', 5)).toBeNull();
  expect(mentionToken('@ab', -1)).toBeNull();
});

it('replaces the token with a literal plus trailing space and moves the caret', () => {
  const token = mentionToken('See @src/ma please', 10)!; // caret ends the token; the rest of the word stays
  expect(replaceMentionToken('See @src/ma please', token, 'src/main.ts'))
    .toEqual({text: 'See @src/main.ts a please', caret: 17});
  expect(replaceMentionToken('See @src/ma please', token, 'dir sub/x.ts'))
    .toEqual({text: 'See @"dir sub/x.ts" a please', caret: 20});
  expect(() => replaceMentionToken('changed text', token, 'src/main.ts')).toThrow();
  expect(() => replaceMentionToken('See @src/ma please', token, 'bad"path')).toThrow();
});

it('keeps only mentions whose literal is still present at a boundary', () => {
  const list = [{path: 'a.ts'}, {path: 'dir/b.ts'}, {path: 'gone.ts'}, {path: 'with space/c.md'}];
  expect(activeMentions('check @a.ts and @"with space/c.md" end', list)).toEqual([{path: 'a.ts'}, {path: 'with space/c.md'}]);
  expect(activeMentions('check @a.t', list)).toEqual([]);
  expect(activeMentions('check @a.tsx', list)).toEqual([]); // literal must end at whitespace or end
  expect(activeMentions('@a.ts', list)).toEqual([{path: 'a.ts'}]); // literal at end of text
});

it('renders the literal quoted only when the path has whitespace', () => {
  expect(mentionLiteral('src/main.ts')).toBe('@src/main.ts');
  expect(mentionLiteral('dir sub/x.ts')).toBe('@"dir sub/x.ts"');
});
