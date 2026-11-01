import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, access as fsAccess } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { handleDomainTool, executeDomainOperation, type DomainContext } from '../packages/capabilities/index.ts';
import type { Operation } from '../packages/contracts/index.ts';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const clean of cleanups.splice(0)) await clean(); });
import { validateCanonicalPng } from '../packages/capabilities/signature-png.ts';
import { validateSignaturePng } from '../packages/ui-catalog/signature-data.ts';
function chunk(type: string, data: Uint8Array) {
  const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
function canonicalPng(raw = Buffer.from([0, 255, 0, 0, 255])) {
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const png = canonicalPng();
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'harness-mark-approval-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const doc = await PDFDocument.create(); doc.addPage([200, 200]); await writeFile(join(dir, 'source.pdf'), await doc.save()); await writeFile(join(dir, 'mark.png'), png);
  const files: Record<string, string> = { source: join(dir, 'source.pdf'), mark: join(dir, 'mark.png'), output: dir };
  const ctx: DomainContext = { threadId: 'thread', signal: new AbortController().signal,
    async resolveResource(id, path) { if (!files[id]) throw new Error('not granted'); return path ? join(files[id], path) : files[id]; },
    async withResource(id, path, _write, action) { return action(await ctx.resolveResource(id, path)); },
    publishData: (value, provenance) => ({ id: 'data', threadId: 'thread', revision: 1, value, provenance, createdAt: '' }), progress() {},
    prepareOperation: (kind, args, resourceIds, preconditions, description) => ({ id: 'operation', threadId: 'thread', revision: 1, kind, args, resourceIds, preconditions, description, status: 'prepared', approved: false, createdAt: '' }),
  };
  const args = { resourceId: 'source', exportResourceId: 'output', outputPath: 'signed.pdf', signatures: [{ kind: 'image', resourceId: 'mark', page: 1, x: 20, y: 20, width: 100, height: 40 }] };
  return { dir, ctx, args, prepare: () => handleDomainTool('pdf_prepare', args, ctx) as Promise<Operation> };
}
it('binds every signature resource and hash to approval and exports the prepared bytes', async () => {
  const x = await setup(), operation = await x.prepare();
  expect(operation.resourceIds).toEqual(['source', 'output', 'mark']);
  expect(operation.preconditions['signature:mark']).toBe(createHash('sha256').update(png).digest('hex'));
  const result = await executeDomainOperation({ ...operation, approved: true, status: 'running' }, x.ctx) as { sha256: string };
  expect(result.sha256).toBe(operation.preconditions.outputSha256);
  expect(createHash('sha256').update(await readFile(join(x.dir, 'signed.pdf'))).digest('hex')).toBe(result.sha256);
});
it('rejects a changed mark before creating any export', async () => {
  const x = await setup(), operation = await x.prepare();
  const changed = Buffer.from(png); changed[changed.length - 1] ^= 1; await writeFile(join(x.dir, 'mark.png'), changed);
  await expect(executeDomainOperation({ ...operation, approved: true, status: 'running' }, x.ctx)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  await expect(fsAccess(join(x.dir, 'signed.pdf'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects an ungranted image while preparing, without writing a PDF', async () => {
  const x = await setup();
  await expect(handleDomainTool('pdf_prepare', { ...x.args, signatures: [{ ...x.args.signatures[0], resourceId: 'other-thread-mark' }] }, x.ctx)).rejects.toThrow('not granted');
  await expect(fsAccess(join(x.dir, 'signed.pdf'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('bounds compressed pixel expansion before PDF embedding', () => {
  expect(() => validateCanonicalPng(canonicalPng(Buffer.alloc(8 * 1024 * 1024)))).toThrow();
  expect(() => validateCanonicalPng(png)).not.toThrow();
});
it('rejects a duplicate IHDR before an image decoder can reinterpret its dimensions', () => {
  const header = Buffer.alloc(13); header.writeUInt32BE(1025, 0); header.writeUInt32BE(512, 4); header[8] = 8; header[9] = 6;
  const ambiguous = Buffer.concat([png.subarray(0, 33), chunk('IHDR', header), png.subarray(33)]);
  expect(() => validateCanonicalPng(ambiguous)).toThrow();
  expect(() => validateSignaturePng(ambiguous)).toThrow();
});
it('rejects APNG and extra frames instead of treating them as a canonical static mark', () => {
  const animation = Buffer.concat([png.subarray(0, 33), chunk('acTL', Buffer.alloc(8)), png.subarray(33)]);
  expect(() => validateCanonicalPng(animation)).toThrow();
  expect(() => validateSignaturePng(animation, true)).toThrow();
});
