import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); });

it('passes folder cancellation through to the resource request', async () => {
  vi.resetModules();
  const controller = new AbortController();
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/bootstrap') return Response.json({ csrfToken: 'test' });
    return await new Promise<Response>((resolve, reject) => {
      if (!options?.signal) { resolve(Response.json({ path: 'sub', entries: [], truncated: false })); return; }
      options.signal.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    });
  });
  vi.stubGlobal('fetch', fetch);
  const { getResourceTree } = await import('../apps/web/src/api');
  const request = getResourceTree('grant-1', 'sub', controller.signal);
  const outcome = request.then(() => 'resolved', error => error.name);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  controller.abort();
  expect(await outcome).toBe('AbortError');
  expect(fetch).toHaveBeenLastCalledWith('/api/resources/grant-1/tree?path=sub', expect.objectContaining({ signal: controller.signal }));
});
