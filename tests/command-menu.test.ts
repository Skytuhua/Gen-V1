import {describe, expect, it} from 'vitest';
import {
  COMMAND_GROUP_ORDER, groupCommands, normalize, rankCommands, readRecent, scoreCommand, writeRecent,
  type CommandItem,
} from '../apps/web/src/command-menu';

const item = (id: string, label: string, group: CommandItem['group'] = 'actions', extra: Partial<CommandItem> = {}): CommandItem => ({
  id, group, label, run: () => {}, ...extra,
});

const memoryStorage = (seed: Record<string, string> = {}) => {
  const map = new Map(Object.entries(seed));
  return {getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value)};
};

describe('normalize', () => {
  it('strips accents, lower-cases and collapses whitespace', () => {
    expect(normalize('  Crème   Brûlée\tX ')).toBe('creme brulee x');
  });
});

describe('scoreCommand', () => {
  it('scores label word-prefix highest, boosted at label start', () => {
    const start = scoreCommand('new', item('a', 'New thread'));
    const mid = scoreCommand('thread', item('a', 'New thread'));
    const sub = scoreCommand('ew thr', item('a', 'New thread'));
    expect(start).toBe(110);
    expect(mid).toBe(100);
    expect(sub).toBe(160); // 'ew' substring 60 + 'thr' word-prefix 100
  });

  it('matches keyword word-prefix and in-order subsequence', () => {
    expect(scoreCommand('cfg', item('a', 'Appearance', 'settings', {keywords: ['config', 'cfg']}))).toBe(40);
    expect(scoreCommand('nwt', item('a', 'New thread'))).toBe(20);
    expect(scoreCommand('x', item('a', 'New thread'))).toBe(0); // subsequence needs ≥ 2 chars
  });

  it('requires every query word to match some field', () => {
    expect(scoreCommand('new bogus', item('a', 'New thread'))).toBe(0);
    expect(scoreCommand('', item('a', 'New thread'))).toBe(0);
  });
});

describe('rankCommands', () => {
  it('orders by score desc, then group order, then input order', () => {
    const items = [
      item('p1', 'Projects panel', 'projects'),
      item('a1', 'New thread', 'actions'),
      item('a2', 'New project', 'actions'),
      item('t1', 'New discussion', 'threads'),
    ];
    const ranked = rankCommands('new', items);
    expect(ranked.map(entry => entry.id)).toEqual(['a1', 'a2', 't1']);
  });

  it('respects the limit', () => {
    const items = Array.from({length: 60}, (_, index) => item(`a${index}`, `Alpha ${index}`));
    expect(rankCommands('alpha', items, 50)).toHaveLength(50);
  });
});

describe('groupCommands', () => {
  it('returns non-empty groups in COMMAND_GROUP_ORDER', () => {
    const groups = groupCommands([item('s', 'Theme', 'settings'), item('a', 'Stop', 'actions'), item('p', 'Files', 'panels')]);
    expect(groups.map(entry => entry.group)).toEqual(['actions', 'panels', 'settings']);
    expect(COMMAND_GROUP_ORDER).toEqual(['recent', 'actions', 'threads', 'panels', 'projects', 'skills', 'settings']);
  });
});

describe('recent commands storage', () => {
  it('reads back up to 5 string ids; junk returns empty', () => {
    const storage = memoryStorage({'command-menu-recent': JSON.stringify(['a', 1, 'b', null, 'c', 'd', 'e', 'f'])});
    expect(readRecent(storage)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(readRecent(memoryStorage({'command-menu-recent': 'not json'}))).toEqual([]);
    expect(readRecent(memoryStorage({'command-menu-recent': '{"a":1}'}))).toEqual([]);
    expect(readRecent(memoryStorage())).toEqual([]);
  });

  it('writes most-recent-first, dedupes and caps at 5', () => {
    const storage = memoryStorage();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) writeRecent(storage, id);
    writeRecent(storage, 'c');
    expect(readRecent(storage)).toEqual(['c', 'f', 'e', 'd', 'b']);
  });

  it('swallows storage failures on both read and write', () => {
    const failing = {
      getItem: () => {throw new Error('denied');},
      setItem: () => {throw new Error('quota');},
    };
    expect(readRecent(failing)).toEqual([]);
    expect(() => writeRecent(failing, 'a')).not.toThrow();
  });
});
