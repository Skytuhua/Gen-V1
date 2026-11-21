import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ResourceGrant } from '../packages/contracts/index.ts';
import { validateImageBytes, storeGeneratedImages, storeThreadAttachment, GENERATED_IMAGE_MAX_DIMENSION, ATTACHMENT_MAX_BYTES } from '../packages/core/generated-images.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'genimg-')); cleanups.push(() => rmSync(d, { recursive: true, force: true })); return d; };

const png = (w = 16, h = 8) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  b[24] = 8; b[25] = 6; // bit depth, RGBA
  return b;
};
const jpeg = (w = 16, h = 8) => {
  const b = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x00, 0x00, 0x00, 0x03, 0x01, 0x22, 0x00]);
  b.writeUInt16BE(h, 7); b.writeUInt16BE(w, 9);
  return b;
};
const webpVp8x = (w = 16, h = 8) => {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
};

it('accepts PNG, JPEG and WebP and reports real dimensions', () => {
  expect(validateImageBytes(png(320, 200))).toMatchObject({ format: 'png', width: 320, height: 200 });
  expect(validateImageBytes(jpeg(640, 480))).toMatchObject({ format: 'jpeg', width: 640, height: 480 });
  expect(validateImageBytes(webpVp8x(1024, 768))).toMatchObject({ format: 'webp', width: 1024, height: 768 });
});

it('rejects GIF, SVG, HTML and truncated inputs', () => {
  expect(() => validateImageBytes(Buffer.from('GIF89a......'))).toThrowError(/PNG, JPEG or WebP/);
  expect(() => validateImageBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toThrowError(/PNG, JPEG or WebP/);
  expect(() => validateImageBytes(Buffer.from('<!doctype html><html></html>'))).toThrowError(/PNG, JPEG or WebP/);
  expect(() => validateImageBytes(png().subarray(0, 10))).toThrowError(/PNG, JPEG or WebP/);
  expect(() => validateImageBytes(Buffer.alloc(0))).toThrowError(/PNG, JPEG or WebP/);
});

it('rejects oversized bytes and over-limit dimensions', () => {
  expect(() => validateImageBytes(Buffer.alloc(ATTACHMENT_MAX_BYTES + 1))).toThrowError(/20 MiB/);
  expect(() => validateImageBytes(png(GENERATED_IMAGE_MAX_DIMENSION + 1, 16))).toThrowError(/4096/);
  expect(() => validateImageBytes(jpeg(16, GENERATED_IMAGE_MAX_DIMENSION + 1))).toThrowError(/4096/);
});

const provenance = { model: 'gpt-image-2', promptSha256: createHash('sha256').update('p').digest('hex'), size: '1024x1024', quality: 'high', background: 'auto', referenceIds: [] };
const collect = () => { const grants: ResourceGrant[] = []; return { grants, put: (g: ResourceGrant) => { grants.push(g); }, remove: (id: string) => { const i = grants.findIndex(g => g.id === id); if (i >= 0) grants.splice(i, 1); } }; };

it('stores generated images as read-only grants with provenance and deterministic ids', async () => {
  const dataDir = tempDir();
  const { grants, put, remove } = collect();
  const out = await storeGeneratedImages({ dataDir, threadId: 't1', generationId: 'gen-1', images: [png(4, 4), jpeg(8, 8)], provenance }, put, remove);
  expect(out).toHaveLength(2);
  expect(grants.map(g => g.id)).toEqual(['gen-1-0', 'gen-1-1']);
  const [first] = out;
  expect(first.grant).toMatchObject({ kind: 'attachment', writable: false, threadId: 't1' });
  expect(first.grant.provenance).toMatchObject({ kind: 'generated-image', generationId: 'gen-1', index: 0, model: 'gpt-image-2', quality: 'high' });
  expect(first.image).toMatchObject({ format: 'png', width: 4, height: 4, sha256: createHash('sha256').update(png(4, 4)).digest('hex') });
  expect(existsSync(first.grant.path)).toBe(true);
  expect(readdirSync(join(dataDir, 'attachments', 't1'))).toHaveLength(2);
});

it('idempotently re-stores the same generationId and rejects different bytes', async () => {
  const dataDir = tempDir();
  const { put, remove } = collect();
  const first = await storeGeneratedImages({ dataDir, threadId: 't1', generationId: 'gen-1', images: [png(4, 4)], provenance }, put, remove);
  const again = await storeGeneratedImages({ dataDir, threadId: 't1', generationId: 'gen-1', images: [png(4, 4)], provenance }, put, remove);
  expect(again[0].created).toBe(false);
  expect(again[0].grant.id).toBe(first[0].grant.id);
  expect(readdirSync(join(dataDir, 'attachments', 't1'))).toHaveLength(1);
  await expect(storeGeneratedImages({ dataDir, threadId: 't1', generationId: 'gen-1', images: [png(5, 5)], provenance }, put, remove)).rejects.toMatchObject({ code: 'DUPLICATE_COMMAND' });
});

it('stores nothing when the signal is already aborted', async () => {
  const dataDir = tempDir();
  const { grants, put, remove } = collect();
  const controller = new AbortController(); controller.abort();
  await expect(storeGeneratedImages({ dataDir, threadId: 't1', generationId: 'gen-1', images: [png()], provenance, signal: controller.signal }, put, remove)).rejects.toThrowError(/abort|cancel/i);
  expect(grants).toHaveLength(0);
  expect(existsSync(join(dataDir, 'attachments'))).toBe(false);
});

it('cleans up files and grants written before a mid-run abort', async () => {
  const dataDir = tempDir();
  const { grants, put, remove } = collect();
  const controller = new AbortController();
  const wrapped = (g: ResourceGrant) => { put(g); controller.abort(); };
  await expect(storeGeneratedImages({ dataDir, threadId: 't1', generationId: 'gen-1', images: [png(), png()], provenance, signal: controller.signal }, wrapped, remove)).rejects.toThrowError(/abort|cancel/i);
  expect(grants).toHaveLength(0);
  expect(readdirSync(join(dataDir, 'attachments', 't1'))).toHaveLength(0);
});

it('rejects a batch containing an invalid image before writing anything', async () => {
  const dataDir = tempDir();
  const { grants, put, remove } = collect();
  await expect(storeGeneratedImages({ dataDir, threadId: 't1', generationId: 'gen-1', images: [png(), Buffer.from('GIF89a')], provenance }, put, remove)).rejects.toThrowError(/PNG, JPEG or WebP/);
  expect(grants).toHaveLength(0);
  expect(existsSync(join(dataDir, 'attachments'))).toBe(false);
});

it('storeThreadAttachment keeps the upload layout and duplicate detection', async () => {
  const dataDir = tempDir();
  const { grant, created } = await storeThreadAttachment({ dataDir }, 't1', 'cmd-9', 'My File.png', png());
  expect(created).toBe(true);
  expect(grant).toMatchObject({ id: 'cmd-9', kind: 'attachment', writable: false, label: 'My File.png' });
  expect(grant.path.endsWith(join('t1', 'cmd-9-My File.png'))).toBe(true);
  const same = await storeThreadAttachment({ dataDir }, 't1', 'cmd-9', 'My File.png', png());
  expect(same.created).toBe(false);
  await expect(storeThreadAttachment({ dataDir }, 't1', 'cmd-9', 'My File.png', jpeg())).rejects.toMatchObject({ code: 'DUPLICATE_COMMAND' });
  await expect(storeThreadAttachment({ dataDir }, 't1', 'cmd-10', 'big.png', Buffer.alloc(ATTACHMENT_MAX_BYTES + 1))).rejects.toThrowError(/20 MiB/);
});
