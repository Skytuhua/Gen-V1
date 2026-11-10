import { expect, it } from 'vitest';
import { browserApiResponse, browserSnapshot, scopedContext } from '../../scripts/capture-ui/browser-data';
import { pluginDocument } from '../../scripts/capture-ui/plugin-assets';
import { conversationContextSchema, conversationHistoryPageSchema } from '../../packages/contracts/conversation-read-models';
it('provides a valid scoped conversation and bounded transcript dataset', () => {
  expect(conversationContextSchema.parse(scopedContext).owner.threadId).toBe('exact-owner');
  const page = conversationHistoryPageSchema.parse(browserApiResponse(new URL('http://local/api/conversations/exact-owner/transcript')));
  expect(page.messages).toHaveLength(1); expect(page.messages[0].threadId).toBe(scopedContext.owner.threadId);
});
it('provides real source records for side history, memory, and skills without credentials', () => {
  const snapshot = browserSnapshot();
  expect(snapshot.threads[1].sideParentId).toBe(snapshot.threads[0].id);
  expect(snapshot.memory?.[0].content).toBeTruthy(); expect(snapshot.skills?.[0].name).toBeTruthy();
  expect(browserApiResponse(new URL('http://local/api/artifacts/test/credentials/token'))).toEqual({present:false,version:0,expiresAt:null});
});
it('loads the trusted plugin runtime after its root and gates iframe load on port acceptance', () => {
  const html = pluginDocument();
  expect(html.indexOf('id="root"')).toBeLessThan(html.indexOf('src="/capture-plugin/runtime.js"'));
  expect(html).toContain('src="/capture-plugin/barrier.js"');
  expect(html).not.toContain('type="module"');
});
