import {expect, it} from 'vitest';
import {
  FILE_MENTION_LIMITS, fileMentionPathSchema, fileMentionsV1Schema, sentFileMentionV1Schema,
  fileSuggestionsQuerySchema, fileSuggestionsResponseSchema,
} from '../packages/contracts/file-mentions.ts';
import {capabilityFlagEnvName, capabilityEnabled, readCapabilityFlagOverrides} from '../packages/core/capability-flags.ts';

it('admits project-relative POSIX mention paths and rejects absolute, parent, Windows and control forms', () => {
  for (const ok of ['src/main.ts', 'deep/path/to/file.ts', 'a', 'x'.repeat(1024), 'dir with space/f.json'])
    expect(fileMentionPathSchema.safeParse(ok).success, ok).toBe(true);
  for (const bad of ['', '/etc/passwd', '../secret', 'a/../b', 'a\\b', 'C:\\win', 'a\0b', '//share', 'x'.repeat(1025), '/a'])
    expect(fileMentionPathSchema.safeParse(bad).success, bad).toBe(false);
});

it('admits at most eight distinct mentions per message and rejects duplicates and unknown fields', () => {
  const paths = Array.from({length: FILE_MENTION_LIMITS.maxMentions}, (_, i) => `src/f${i}.ts`);
  expect(fileMentionsV1Schema.parse(paths.map(path => ({path})))).toHaveLength(8);
  expect(fileMentionsV1Schema.safeParse([...paths, 'extra.ts'].map(path => ({path}))).success).toBe(false);
  expect(fileMentionsV1Schema.safeParse([{path: 'a.ts'}, {path: 'a.ts'}]).success).toBe(false);
  expect(fileMentionsV1Schema.safeParse([{path: 'a.ts', extra: 1}]).success).toBe(false);
  expect(fileMentionsV1Schema.safeParse(['a.ts']).success).toBe(false);
});

it('records sent mentions with an exact digest envelope and no extra fields', () => {
  const sent = {path: 'src/main.ts', sha256: 'a'.repeat(64), bytes: 12, truncated: false};
  expect(sentFileMentionV1Schema.parse(sent)).toEqual(sent);
  for (const bad of [
    {...sent, sha256: 'A'.repeat(64)}, {...sent, sha256: 'a'.repeat(63)}, {...sent, bytes: -1},
    {...sent, bytes: 1.5}, {...sent, truncated: 'yes'}, {...sent, unknown: true},
  ]) expect(sentFileMentionV1Schema.safeParse(bad).success).toBe(false);
});

it('bounds the suggestion query like the search route and defaults an empty query', () => {
  expect(fileSuggestionsQuerySchema.parse({threadId: 't_1'})).toEqual({threadId: 't_1', q: '', limit: FILE_MENTION_LIMITS.defaultSuggestions});
  expect(fileSuggestionsQuerySchema.parse({threadId: 'th-1:2.3', q: 'src', limit: '50'})).toEqual({threadId: 'th-1:2.3', q: 'src', limit: 50});
  for (const bad of [
    {threadId: 'a/b'}, {threadId: ''}, {threadId: 'x'.repeat(201)}, {threadId: 'space id'},
    {threadId: 't', q: 'q'.repeat(201)}, {threadId: 't', limit: 0}, {threadId: 't', limit: 51}, {threadId: 't', limit: 'x'},
    {threadId: 't', unknown: true},
  ]) expect(fileSuggestionsQuerySchema.safeParse(bad).success).toBe(false);
});

it('round-trips the frozen suggestion response shape', () => {
  const response = {
    enabled: true, projectId: 'p', threadId: 't', query: 'ma',
    items: [{path: 'src/main.ts', name: 'main.ts', directory: 'src'}], complete: true,
  };
  expect(fileSuggestionsResponseSchema.parse(response)).toEqual(response);
  expect(fileSuggestionsResponseSchema.parse({...response, complete: false, limitReason: 'time'})).toMatchObject({limitReason: 'time'});
  expect(fileSuggestionsResponseSchema.safeParse({...response, limitReason: 'other'}).success).toBe(false);
  expect(fileSuggestionsResponseSchema.safeParse({...response, extra: 1}).success).toBe(false);
});

it('registers the mentions flag as default-off with a finite host definition and env override', () => {
  expect(capabilityFlagEnvName('ui.fileMentionsV1')).toBe('HARNESS_FLAG_UI_FILE_MENTIONS_V1');
  expect(capabilityEnabled('ui.fileMentionsV1')).toBe(false);
  expect(() => capabilityEnabled('ui.inventedMentions' as 'ui.fileMentionsV1')).toThrow('Unknown capability flag');
  expect(readCapabilityFlagOverrides({HARNESS_FLAG_UI_FILE_MENTIONS_V1: '1'})).toEqual({'ui.fileMentionsV1': true});
  expect(readCapabilityFlagOverrides({HARNESS_FLAG_UI_FILE_MENTIONS_V1: 'nope'})).toEqual({'ui.fileMentionsV1': false});
});
