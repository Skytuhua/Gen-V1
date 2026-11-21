import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';

const thread = {id: 'thread-a', title: 'Export Demo!'};
const markdown = '<!-- gen-v1-thread-export v1 -->\n# Export Demo!\n';
const filename = 'export-demo-2026-11-21.md';
const receipt = {status: 'saved', admitted: true, filename, bytes: Buffer.byteLength(markdown), sha256: createHash('sha256').update(markdown).digest('hex')} as const;
const client = async () => {
  const module = await import('../apps/web/src/thread-export-api.ts');
  expect(module.downloadThreadMarkdown, 'The export client must preserve ownership checks and await the native save result.').toBeTypeOf('function');
  return module;
};
const endpoint = '/api/threads/thread-a/export.md';
const response = (body: string | Response = markdown, headers: Record<string, string> = {'X-Gen-Export-Filename': filename}) => vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
  if (String(url) === '/api/bootstrap') return Response.json({csrfToken: 'csrf'});
  return body instanceof Response ? body : new Response(body, {headers});
}));
beforeEach(() => {vi.resetModules(); response();});
afterEach(() => vi.unstubAllGlobals());

it('hands the exact host document and filename to the native bridge and binds its receipt', async () => {
  const native = vi.fn(async () => receipt); vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: native}});
  expect(await (await client()).downloadThreadMarkdown(thread, () => true)).toEqual(receipt);
  expect(native).toHaveBeenCalledWith({threadId: 'thread-a', filename, content: markdown});
  const call = vi.mocked(fetch).mock.calls.at(-1)!; expect(String(call[0])).toBe(endpoint);
});

it('derives a safe filename when the host header is missing or malformed', async () => {
  response(markdown, {});
  const native = vi.fn(async (input: {filename: string}) => ({...receipt, filename: input.filename}));
  vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: native}});
  const result = await (await client()).downloadThreadMarkdown(thread, () => true);
  if (!('filename' in result)) throw new Error('expected a native export receipt');
  expect(result.filename).toMatch(/^export-demo-\d{4}-\d{2}-\d{2}\.md$/);
});

it('fails closed on an older desktop bridge instead of attempting a browser download', async () => {
  vi.stubGlobal('window', {harnessDesktop: {}});
  const createElement = vi.fn(); vi.stubGlobal('document', {createElement});
  await expect((await client()).downloadThreadMarkdown(thread, () => true)).rejects.toMatchObject({code: 'EXPORT_UNAVAILABLE', message: 'This desktop version cannot export threads.'});
  expect(createElement).not.toHaveBeenCalled();
});

it('does not fall back to an arbitrary browser download when native export is refused', async () => {
  const native = vi.fn(async () => {throw Error('Native sender denied');}); vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: native}});
  const createElement = vi.fn(); vi.stubGlobal('document', {createElement});
  await expect((await client()).downloadThreadMarkdown(thread, () => true)).rejects.toThrow('Native sender denied'); expect(createElement).not.toHaveBeenCalled();
});

it.each([{...receipt, admitted: false}, {...receipt, filename: 'other.md'}, {...receipt, bytes: receipt.bytes + 1}, {...receipt, sha256: 'd'.repeat(64)}, {...receipt, status: 'started'}, {...receipt, bytes: 33 * 1024 * 1024}])('rejects native completion metadata that does not attest the exact export: %j', async result => {
  vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: async () => result}});
  await expect((await client()).downloadThreadMarkdown(thread, () => true)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('retains cancellation as cancellation rather than reporting a saved export', async () => {
  vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: async () => ({...receipt, status: 'cancelled'})}});
  expect(await (await client()).downloadThreadMarkdown(thread, () => true)).toEqual({...receipt, status: 'cancelled'});
});

it('does not acknowledge a native save after the owning thread has changed', async () => {
  let current = true;
  vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: async () => {current = false; return receipt;}}});
  await expect((await client()).downloadThreadMarkdown(thread, () => current)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
});

it('keeps the ordinary browser download path without granting it native save status', async () => {
  vi.stubGlobal('window', {});
  const anchor = {href: '', download: '', click: vi.fn()}; vi.stubGlobal('document', {createElement: () => anchor});
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:browser-only'), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  try {
    expect(await (await client()).downloadThreadMarkdown(thread, () => true)).toEqual({status: 'started', admitted: false});
    expect(anchor.href).toBe('blob:browser-only'); expect(anchor.download).toBe(filename); expect(anchor.click).toHaveBeenCalledOnce();
    await new Promise(resolve => setTimeout(resolve, 0)); expect(revoke).toHaveBeenCalledWith('blob:browser-only');
  } finally {createObjectURL.mockRestore(); revoke.mockRestore();}
});

it('surfaces the host error envelope instead of saving a failure body', async () => {
  response(new Response(JSON.stringify({error: {code: 'NOT_FOUND', message: 'Thread unavailable'}}), {status: 404, headers: {'Content-Type': 'application/json'}}));
  const native = vi.fn(); vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: native}});
  await expect((await client()).downloadThreadMarkdown(thread, () => true)).rejects.toMatchObject({code: 'NOT_FOUND'}); expect(native).not.toHaveBeenCalled();
});

it('rejects a host document over the export byte bound before any save path', async () => {
  response('x'.repeat(32 * 1024 * 1024 + 1));
  const native = vi.fn(); vi.stubGlobal('window', {harnessDesktop: {exportThreadMarkdown: native}});
  const createElement = vi.fn(); vi.stubGlobal('document', {createElement});
  await expect((await client()).downloadThreadMarkdown(thread, () => true)).rejects.toMatchObject({code: 'EXPORT_TOO_LARGE'});
  expect(native).not.toHaveBeenCalled(); expect(createElement).not.toHaveBeenCalled();
});
