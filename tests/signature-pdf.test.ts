import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { toolSchemas } from '../packages/capabilities/schemas';
import { renderPdf } from '../packages/capabilities/pdf';
const base = { resourceId: 'source', exportResourceId: 'export', outputPath: 'signed.pdf' };
const box = { page: 1, x: 20, y: 20, width: 100, height: 40 };
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
describe('canonical signature PDF export', () => {
  it('accepts durable image resource IDs and multiple isolated strokes while retaining legacy points', () => {
    expect(toolSchemas.pdf_prepare.safeParse({ ...base, signatures: [{ kind: 'image', resourceId: 'signature-png', ...box }] }).success).toBe(true);
    expect(toolSchemas.pdf_prepare.safeParse({ ...base, signatures: [{ kind: 'drawn', strokes: [[{ x: 0, y: 0 }, { x: .2, y: .2 }], [{ x: .8, y: .8 }, { x: 1, y: 1 }]], ...box }] }).success).toBe(true);
    expect(toolSchemas.pdf_prepare.safeParse({ ...base, signatures: [{ kind: 'drawn', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], ...box }] }).success).toBe(true);
    expect(toolSchemas.pdf_prepare.safeParse({ ...base, signatures: [{ kind: 'drawn', strokes: [Array.from({ length: 2001 }, () => ({ x: 0, y: 0 }))], ...box }] }).success).toBe(false);
  });
  it('requires resolved PNG bytes and embeds the exact approved resource without changing its source', async () => {
    const source = await PDFDocument.create(); source.addPage([200, 200]); const original = await source.save();
    const args = toolSchemas.pdf_prepare.parse({ ...base, signatures: [{ kind: 'image', resourceId: 'signature-png', ...box }] });
    await expect(renderPdf(original, args)).rejects.toThrow(/resolved|available/i);
    const result = await renderPdf(original, args, new Map([['signature-png', png]]));
    const doc = await PDFDocument.load(result); expect(doc.getPage(0).node.Resources()?.get(requirePdfName('XObject'))).toBeDefined();
    expect((await PDFDocument.load(original)).getPage(0).node.Resources()?.get(requirePdfName('XObject'))).toBeUndefined();
    await expect(renderPdf(original, args, new Map([['signature-png', new TextEncoder().encode('<svg/>')]]))).rejects.toThrow(/PNG/i);
  });
});
import { PDFName } from 'pdf-lib';
function requirePdfName(value: string) { return PDFName.of(value); }

import { readVisualSignature, validateSignaturePng } from '../packages/ui-catalog/signature-data';
it('bounds PNG dimensions before decode and validates saved stroke/resource identities', () => {
  expect(validateSignaturePng(png)).toEqual({ width: 1, height: 1 });
  const bomb = png.slice(); new DataView(bomb.buffer).setUint32(16, 1_000_000);
  expect(() => validateSignaturePng(bomb)).toThrow(/dimensions/);
  expect(() => validateSignaturePng(new Uint8Array(512 * 1024 + 1))).toThrow(/PNG/);
  expect(() => readVisualSignature({ kind: 'image', resourceId: 'https://outside.invalid/sign.png' })).toThrow(/invalid/);
  expect(() => readVisualSignature({ kind: 'drawn', strokes: [[{ x: 0, y: 0 }, { x: 1.1, y: 1 }]] })).toThrow(/normalized/);
  expect(() => readVisualSignature({ kind: 'drawn', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], strokes: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] })).toThrow(/invalid/);
});
