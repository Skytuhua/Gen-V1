import { expect, it } from 'vitest';
import { releaseOwnedBrowsers } from '../apps/desktop/browser-lifecycle.ts';

it('cleans up the other owned browser even if one native disposer throws', () => {
  type View = { id: string; owner?: unknown };
  const owner: { browser?: View; dockedBrowser?: View } = {};
  const first = { id: 'first', owner }, second = { id: 'second', owner };
  owner.browser = first; owner.dockedBrowser = second;
  const records = new Map<string, View>([[first.id, first], [second.id, second]]);
  const attempts: string[] = [];
  const failures = releaseOwnedBrowsers(owner, records, browser => {
    attempts.push(browser.id);
    if (browser === first) throw new Error('Native view already detached');
  });
  expect(failures).toBe(1);
  expect(attempts).toEqual(['first', 'second']);
  expect(records.size).toBe(0);
  expect([first.owner, second.owner]).toEqual([undefined, undefined]);
  expect([owner.browser, owner.dockedBrowser]).toEqual([undefined, undefined]);
});
