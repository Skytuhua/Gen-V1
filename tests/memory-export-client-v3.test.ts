import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import type {MemoryExport, MemoryScope} from '../packages/contracts/project-memory.ts';

const scope: MemoryScope = {projectId: 'project:alpha', projectIdentity: 'a'.repeat(64), threadId: 'thread-a', accountId: null, bindingDigest: 'b'.repeat(64)};
const output: MemoryExport = {scope, redacted: true, items: [{id: 'memory-a', revision: 3, kind: 'CONSTRAINT', state: 'ACCEPTED', text: 'Use UTC.', sourceDigests: []}], tombstones: []};
const canonical = JSON.stringify(output, null, 2) + '\n';
const receipt = {status: 'saved', admitted: true, filename: 'project-memory-project_alpha.json', bytes: Buffer.byteLength(canonical), sha256: createHash('sha256').update(canonical).digest('hex')} as const;
const client = async () => {
  const module = await import('../apps/web/src/project-memory-api.ts');
  expect(module.downloadProjectMemory, 'The native export branch must preserve HTTP scope admission and await the native save result.').toBeTypeOf('function');
  return module;
};
const response = (value: unknown = output) => vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => String(url) === '/api/bootstrap' ? Response.json({csrfToken: 'csrf'}) : Response.json(value)));
beforeEach(() => {vi.resetModules(); response();});
afterEach(() => vi.unstubAllGlobals());

it('passes only a validated server export through the native bridge and binds its completed receipt', async () => {
  const native = vi.fn(async () => receipt); vi.stubGlobal('window', {harnessDesktop: {exportProjectMemory: native}});
  expect(await (await client()).downloadProjectMemory(scope, () => true)).toEqual(receipt);
  expect(native).toHaveBeenCalledWith(JSON.stringify(output));
  const call = vi.mocked(fetch).mock.calls.at(-1)!; expect(String(call[0])).toBe('/api/projects/project%3Aalpha/memory/export');
  expect(new Headers(call[1]?.headers).get('x-harness-csrf')).toBe('csrf'); expect(JSON.parse(String(call[1]?.body))).toEqual({scope});
});

it('does not offer a foreign server scope to the native download policy', async () => {
  response({...output, scope: {...scope, threadId: 'foreign'}});
  const native = vi.fn(); vi.stubGlobal('window', {harnessDesktop: {exportProjectMemory: native}});
  await expect((await client()).downloadProjectMemory(scope, () => true)).rejects.toMatchObject({code: 'INVALID_RESPONSE'}); expect(native).not.toHaveBeenCalled();
});

it('fails closed on an older desktop bridge instead of attempting the blocked browser download', async () => {
  vi.stubGlobal('window', {harnessDesktop: {}}); const createElement = vi.fn(); vi.stubGlobal('document', {createElement});
  await expect((await client()).downloadProjectMemory(scope, () => true)).rejects.toMatchObject({code: 'EXPORT_UNAVAILABLE'}); expect(createElement).not.toHaveBeenCalled();
});

it('does not fall back to an arbitrary browser download when native export is refused', async () => {
  const native = vi.fn(async () => {throw Error('Native sender denied');}); vi.stubGlobal('window', {harnessDesktop: {exportProjectMemory: native}});
  const createElement = vi.fn(); vi.stubGlobal('document', {createElement});
  await expect((await client()).downloadProjectMemory(scope, () => true)).rejects.toThrow('Native sender denied'); expect(createElement).not.toHaveBeenCalled();
});

it.each([{...receipt, admitted: false}, {...receipt, filename: 'other.json'}, {...receipt, bytes: receipt.bytes + 1}, {...receipt, sha256: 'd'.repeat(64)}, {...receipt, status: 'started'}])('rejects native completion metadata that does not attest the exact export', async result => {
  vi.stubGlobal('window', {harnessDesktop: {exportProjectMemory: async () => result}});
  await expect((await client()).downloadProjectMemory(scope, () => true)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('retains cancellation as cancellation rather than reporting a saved export', async () => {
  vi.stubGlobal('window', {harnessDesktop: {exportProjectMemory: async () => ({...receipt, status: 'cancelled'})}});
  expect(await (await client()).downloadProjectMemory(scope, () => true)).toEqual({...receipt, status: 'cancelled'});
});

it('does not acknowledge a native save after the owning review has changed', async () => {
  let current = true;
  vi.stubGlobal('window', {harnessDesktop: {exportProjectMemory: async () => {current = false; return receipt;}}});
  await expect((await client()).downloadProjectMemory(scope, () => current)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
});

it('keeps the ordinary browser export path without granting it native save status', async () => {
  vi.stubGlobal('window', {});
  const anchor = {href: '', download: '', click: vi.fn()}; vi.stubGlobal('document', {createElement: () => anchor});
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:browser-only'), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  try {
    expect(await (await client()).downloadProjectMemory(scope, () => true)).toEqual({status: 'started', admitted: false});
    expect(anchor.href).toBe('blob:browser-only'); expect(anchor.download).toBe('project-memory-project_alpha.json'); expect(anchor.click).toHaveBeenCalledOnce();
  } finally {createObjectURL.mockRestore(); revoke.mockRestore();}
});
