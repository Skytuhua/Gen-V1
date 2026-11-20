import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { CapturePage } from '../apps/web/src/session-branch-api';

const state = vi.hoisted(() => ({ index: 0, slots: [] as unknown[] }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: () => [state.slots[state.index++], () => {}],
}));
vi.mock('../packages/ui-shell/Modal', () => ({ Modal: ({ children }: { children: import('react').ReactNode }) => children }));
import { CaptureViewer } from '../apps/web/src/SessionBranchMenu';

function render(page: CapturePage | null, error: string | null = null) {
  state.index = 0;
  state.slots = [page, error, []];
  return renderToStaticMarkup(createElement(CaptureViewer, { captureId: 'capture', onClose: () => {} }));
}

const page: CapturePage = {
  captureId: 'capture', sourceThreadId: 'thread', sourceCut: { sequence: 1, messageCount: 1, revisionDigest: 'a'.repeat(64) },
  coverage: 'TRUNCATED', truncated: 1, incompleteSource: ['TRUNCATED_HISTORY'],
  snapshotUpperSequence: 1, messages: [], nextCursor: null,
};

it('explains an empty truncated capture without claiming only earlier messages were omitted', () => {
  const html = render(page);
  expect(html).toContain('Incomplete coverage: the newest message exceeded the Inspect content budget.');
  expect(html).toContain('1 message(s) not captured');
  expect(html).toContain('No messages were captured.');
  expect(html).not.toContain('earlier message(s) not captured');
  expect(html).not.toContain('the oldest messages were outside the capture bound');
});

it('keeps the earlier-message notice for a nonempty truncated capture', () => {
  const html = render({ ...page, messages: [{ id: 'message', role: 'assistant', content: 'Captured text', createdAt: '2026-01-01', runId: null, revision: 'a'.repeat(64) }] });
  expect(html).toContain('1 earlier message(s) not captured');
  expect(html).toContain('Incomplete coverage: the oldest messages were outside the capture bound.');
  expect(html).not.toContain('newest message exceeded');
});

it('does not report a budget overflow for an empty complete capture', () => {
  const html = render({ ...page, coverage: 'COMPLETE', truncated: 0, incompleteSource: [] });
  expect(html).toContain('No messages were captured.');
  expect(html).not.toContain('Incomplete coverage');
});

it('shows capture read errors without a misleading coverage notice', () => {
  const html = render(null, 'Capture unavailable');
  expect(html).toContain('role="alert"');
  expect(html).toContain('Capture unavailable');
  expect(html).not.toContain('Incomplete coverage');
});
