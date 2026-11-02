import { afterEach, expect, it, vi } from 'vitest';
import { getPreferences, mergePreferences, DEFAULT_PREFERENCES } from '../packages/contracts/preferences';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('keeps existing profiles opted out and validates the prediction preference', () => {
  expect(getPreferences({}).composerPredictions).toBe(false);
  expect(mergePreferences(DEFAULT_PREFERENCES, { composerPredictions: true }).composerPredictions).toBe(true);
  expect(() => mergePreferences(DEFAULT_PREFERENCES, { composerPredictions: 'yes' })).toThrow();
});
it('sends only reply/model identifiers through authenticated CSRF and preserves cancellation', async () => {
  const abort = new AbortController();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'csrf' })).mockResolvedValueOnce(Response.json({ suggestion: null, replyId: 'reply', modelId: 'model' }));
  vi.stubGlobal('fetch', fetch);
  const { getComposerPrediction } = await import('../apps/web/src/api');
  await expect(getComposerPrediction({ threadId: 'thread', replyId: 'reply', modelId: 'model' }, abort.signal)).resolves.toEqual({ suggestion: null, replyId: 'reply', modelId: 'model' });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]).toEqual(['/api/composer-prediction', expect.objectContaining({ method: 'POST', credentials: 'same-origin', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'x-harness-csrf': 'csrf' }, body: JSON.stringify({ threadId: 'thread', replyId: 'reply', modelId: 'model' }) })]);
});
it('does not repeat a failed prediction network request', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'csrf' })).mockRejectedValueOnce(new TypeError('Connection lost'));
  vi.stubGlobal('fetch', fetch);
  const { getComposerPrediction } = await import('../apps/web/src/api');
  await expect(getComposerPrediction({ threadId: 'thread', replyId: 'reply', modelId: 'model' }, new AbortController().signal)).rejects.toThrow('Connection lost');
  expect(fetch).toHaveBeenCalledTimes(2);
});
