import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('rejects API responses larger than the byte cap', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { for (let index = 0; index < 65; index++) controller.enqueue(chunk); controller.close(); },
  });
  const { read } = await import('../apps/web/src/api');
  await expect(read(new Response(stream))).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
});

it('still parses ordinary JSON responses', async () => {
  const { read } = await import('../apps/web/src/api');
  await expect(read<{ ok: boolean }>(Response.json({ ok: true }))).resolves.toEqual({ ok: true });
});
