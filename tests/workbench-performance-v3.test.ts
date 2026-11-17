import {describe, expect, it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const owner = {threadId: 'thread-a', projectId: null, workspaceId: null};
const identity = {logicalOwner: owner, sourceId: 'tool-output-a', sourceRevision: 'revision-a'};
const rows = Object.freeze(Array.from({length: 100_000}, (_, index) => Object.freeze({
  id: `line:${index}`, text: index === 95_001 ? 'retained needle beyond the mounted window' : `Output line ${index}`,
})));

describe('M15 bounded workbench presentation', () => {
  it('windows retained output without dropping immutable 10,000-message and 500-task read models', async () => {
    const {windowWorkbenchItems} = await import('../apps/web/src/workbench-window');
    const messages = Object.freeze(Array.from({length: 10_000}, (_, index) => Object.freeze({id: `message:${index}`, revision: index})));
    const tasks = Object.freeze(Array.from({length: 500}, (_, index) => Object.freeze({id: `task:${index}`, status: 'unknown'})));
    const outputWindow = windowWorkbenchItems(rows, {scrollTop: 800_007, viewportHeight: 800, rowHeight: 20, overscan: 12});
    expect(outputWindow.start).toBe(39_988);
    expect(outputWindow.end).toBe(40_053);
    expect(outputWindow.items[12]).toBe(rows[40_000]);
    expect(outputWindow.topSpacer).toBe(799_760);
    expect(outputWindow.topSpacer + outputWindow.items.length * 20 + outputWindow.bottomSpacer).toBe(2_000_000);
    expect(windowWorkbenchItems(messages, {scrollTop: 40_000, viewportHeight: 800, rowHeight: 20}).items.length).toBeLessThanOrEqual(300);
    expect(windowWorkbenchItems(tasks, {scrollTop: 5_000, viewportHeight: 800, rowHeight: 20}).items.length).toBeLessThanOrEqual(300);
    expect(messages).toHaveLength(10_000);
    expect(tasks).toHaveLength(500);
    expect(rows).toHaveLength(100_000);
    expect(messages[9_999]).toEqual({id: 'message:9999', revision: 9_999});
    expect(tasks[499]).toEqual({id: 'task:499', status: 'unknown'});
    expect(rows[95_001].text).toBe('retained needle beyond the mounted window');
  });

  it('enforces the mounted-row ceiling even when viewport or overscan requests exceed it', async () => {
    const {windowWorkbenchItems} = await import('../apps/web/src/workbench-window');
    for (const scrollTop of [0, 20, 400_000, 1_999_999]) {
      const window = windowWorkbenchItems(rows, {scrollTop, viewportHeight: 40_000, rowHeight: 20, overscan: 100_000});
      expect(window.items.length).toBeLessThanOrEqual(300);
      expect(window.start).toBeGreaterThanOrEqual(0);
      expect(window.end).toBeLessThanOrEqual(100_000);
    }
    expect(windowWorkbenchItems([], {scrollTop: 0, viewportHeight: 800, rowHeight: 20}).items).toEqual([]);
    expect(() => windowWorkbenchItems(rows, {scrollTop: 0, viewportHeight: 800, rowHeight: 0})).toThrow();
    expect(() => windowWorkbenchItems(rows, {scrollTop: Number.NaN, viewportHeight: 800, rowHeight: 20})).toThrow();
  });

  it('preserves a logical row and intra-row offset when retained output streams or earlier rows arrive', async () => {
    const {captureOutputAnchor, restoreOutputAnchor} = await import('../apps/web/src/workbench-window');
    const anchor = captureOutputAnchor(rows, 999_993, 20);
    expect(anchor).toEqual({itemId: 'line:49999', offset: 13});
    const appended = Object.freeze([...rows, {id: 'line:100000', text: 'New streamed line'}]);
    expect(restoreOutputAnchor(appended, anchor, 20)).toBe(999_993);
    const prefixed = Object.freeze([{id: 'earlier', text: 'Earlier retained line'}, ...appended]);
    expect(restoreOutputAnchor(prefixed, anchor, 20)).toBe(1_000_013);
    expect(restoreOutputAnchor(prefixed, {itemId: 'gone', offset: 0}, 20, 420)).toBe(420);
    expect(captureOutputAnchor([], 0, 20)).toBeNull();
  });

  it('copies and searches the reauthorized full model beyond mounted rows', async () => {
    const {readAuthorizedOutput, fullOutputText, searchOutputRows} = await import('../apps/web/src/workbench-window');
    let reads = 0;
    const readFull = async () => {reads++; return {identity, rows, complete: true as const, trailingNewline: true};};
    const copy = await readAuthorizedOutput(identity, readFull);
    const text = fullOutputText(copy);
    expect(text.startsWith('Output line 0\nOutput line 1\n')).toBe(true);
    expect(text.endsWith('Output line 99999\n')).toBe(true);
    expect(text.split('\n')).toHaveLength(100_001);
    const searched = await readAuthorizedOutput(identity, readFull);
    expect(searchOutputRows(searched, 'NEEDLE')).toEqual([{itemId: 'line:95001', index: 95_001, offset: 9}]);
    expect(reads).toBe(2);
    expect(rows).toHaveLength(100_000);
  });

  it('rejects stale, cross-owner, incomplete and aborted full reads instead of copying misleading output', async () => {
    const {readAuthorizedOutput} = await import('../apps/web/src/workbench-window');
    for (const changed of [
      {...identity, sourceRevision: 'revision-b'},
      {...identity, logicalOwner: {...owner, threadId: 'thread-b'}},
      {...identity, logicalOwner: {...owner, workspaceId: 'foreign-workspace'}},
    ]) await expect(readAuthorizedOutput(identity, async () => ({identity: changed, rows, complete: true}))).rejects.toThrow(/owner|revision|identity/i);
    await expect(readAuthorizedOutput(identity, async () => ({identity, rows, complete: false}))).rejects.toThrow(/complete|partial/i);
    await expect(readAuthorizedOutput(identity, async () => {throw Error('Access revoked');})).rejects.toThrow('Access revoked');
    const controller = new AbortController();
    await expect(readAuthorizedOutput(identity, async () => {controller.abort(); return {identity, rows, complete: true};}, controller.signal)).rejects.toThrow();
  });

  it('renders fewer than 301 output rows and preserves source-owned row IDs', async () => {
    const {WorkbenchOutput} = await import('../apps/web/src/WorkbenchOutput');
    const markup = renderToStaticMarkup(createElement(WorkbenchOutput, {
      identity, rows, state: 'ready', initialAnchor: {itemId: 'line:49999', offset: 13},
      readFull: async () => ({identity, rows, complete: true}),
    }));
    const mounted = [...markup.matchAll(/data-output-row-id=/g)];
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThanOrEqual(300);
    expect(markup).toContain('data-output-row-id="line:49999"');
    expect(markup).toContain('Copy full result');
    expect(markup).not.toContain('retained needle beyond the mounted window');
  });

  it('hides denied source bytes and keeps full-read actions disabled in unavailable states', async () => {
    const {WorkbenchOutput} = await import('../apps/web/src/WorkbenchOutput');
    for (const state of ['loading', 'empty', 'denied', 'unsupported'] as const) {
      const markup = renderToStaticMarkup(createElement(WorkbenchOutput, {identity, rows: [{id: 'private-row', text: 'previously visible private output'}], state, readFull: async () => ({identity, rows, complete: true})}));
      expect(markup).not.toContain('previously visible private output');
      expect(markup).not.toContain('data-output-row-id=');
      expect(markup).toContain('disabled=""');
    }
    for (const state of ['offline', 'partial'] as const) {
      const markup = renderToStaticMarkup(createElement(WorkbenchOutput, {identity, rows: [{id: 'retained-row', text: 'Retained output'}], state}));
      expect(markup).toContain('Retained output');
      expect(markup).toContain('disabled=""');
    }
  });
});
