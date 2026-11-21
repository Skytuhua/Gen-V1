import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';

const thread = {id: 'thread-a', title: 'My Thread'} as const;
const content = '<!-- gen-v1-thread-export v1 -->\n# My Thread\n\nbody\n';
const filename = 'my-thread-2026-11-20.md';
const receipt = {status: 'saved', admitted: true, filename, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex')} as const;
const client = async () => {
  const module = await import('../apps/web/src/thread-export-api.ts');
  expect(module.exportThreadMarkdown, 'The export client must exist and verify the native receipt.').toBeTypeOf('function');
  return module;
};
const response = (body = content, headers: Record<string, string> = {'X-Gen-Export-Filename': filename}, status = 200) => vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) =>
  String(url) === '/api/bootstrap' ? Response.json({csrfToken: 'csrf'}) : new Response(status === 200 ? body : JSON.stringify({error: {code: 'NOT_FOUND', message: 'Thread unavailable'}}), {status, headers})));
beforeEach(() => {vi.resetModules(); response();});
afterEach(() => vi.unstubAllGlobals());

it('hands the rendered document to the native bridge and returns its receipt status', async () => {
  const native = vi.fn(async () => receipt); vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: native}});
  expect(await (await client()).exportThreadMarkdown(thread)).toEqual({status: 'saved', filename});
  expect(native).toHaveBeenCalledWith({threadId: 'thread-a', filename, content});
});

it('uses the header filename only when it matches the export slug format', async () => {
  response(content, {'X-Gen-Export-Filename': '../../evil.sh'});
  const native = vi.fn(async () => ({...receipt, filename: 'my-thread-' + new Date().toISOString().slice(0, 10) + '.md', bytes: Buffer.byteLength(content)}));
  const fallback = 'my-thread-' + new Date().toISOString().slice(0, 10) + '.md';
  native.mockResolvedValue({status: 'saved', admitted: true, filename: fallback, bytes: Buffer.byteLength(content), sha256: receipt.sha256});
  vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: native}});
  await (await client()).exportThreadMarkdown(thread);
  expect(((native.mock.calls[0] as unknown[])[0] as {filename: string}).filename).toBe(fallback);
});

it('fails closed on an older desktop bridge instead of attempting the blocked browser download', async () => {
  vi.stubGlobal('window', {harnessDesktop: {}}); const createElement = vi.fn(); vi.stubGlobal('document', {createElement});
  await expect((await client()).exportThreadMarkdown(thread)).rejects.toMatchObject({code: 'UNSUPPORTED_DESKTOP', message: 'This desktop version cannot export threads.'});
  expect(createElement).not.toHaveBeenCalled();
});

it.each<Record<string, unknown>>([{...receipt, filename: 'other-2026-11-20.md'}, {...receipt, bytes: receipt.bytes + 1}, {...receipt, sha256: 'd'.repeat(64)}, {...receipt, status: 'started'}, {status: 'saved'}])('rejects native completion metadata that does not attest the exact export: %j', async result => {
  vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: async () => result}});
  await expect((await client()).exportThreadMarkdown(thread)).rejects.toMatchObject({code: 'EXPORT_RECEIPT_MISMATCH'});
});

it('retains native cancellation as cancellation', async () => {
  vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: async () => ({...receipt, status: 'cancelled'})}});
  expect(await (await client()).exportThreadMarkdown(thread)).toEqual({status: 'cancelled', filename});
});

it('resolves as cancelled when the owner navigated mid-export', async () => {
  let current = true;
  vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: async () => {current = false; return receipt;}}});
  expect(await (await client()).exportThreadMarkdown(thread, () => current)).toEqual({status: 'cancelled', filename});
});

it('dispatches a browser download when no desktop bridge exists', async () => {
  vi.stubGlobal('window', {});
  const clicked: {download: string; href: string}[] = [];
  const anchor = {href: '', download: '', click: () => clicked.push({download: anchor.download, href: anchor.href}), remove: () => {}};
  vi.stubGlobal('document', {createElement: (tag: string) => {if (tag !== 'a') throw Error('unexpected'); return anchor;}, body: {append: () => {}}});
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:mock'; } static revokeObjectURL() {} });
  expect(await (await client()).exportThreadMarkdown(thread)).toEqual({status: 'saved', filename});
  expect(clicked[0]).toMatchObject({download: filename, href: 'blob:mock'});
});

it('maps a host failure to an ApiError', async () => {
  response('', {}, 404);
  vi.stubGlobal('window', {});
  await expect((await client()).exportThreadMarkdown(thread)).rejects.toMatchObject({code: 'NOT_FOUND'});
});
