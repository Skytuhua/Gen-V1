import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { HarnessError } from '../packages/contracts/index.ts';
import { validatePdfStructure } from '../packages/capabilities/pdf-structure.ts';
import { PDF_LIMITATIONS, PDF_LIMITS } from '../packages/capabilities/pdf-protocol.ts';

const code = (fn: () => unknown) => { try { fn(); return null; } catch (error) { return (error as HarnessError).code; } };

async function documentWithPages(count: number): Promise<PDFDocument> {
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index++) document.addPage();
  return document;
}

const pagesRef = (document: PDFDocument) => document.catalog.get(PDFName.of('Pages')) as PDFRef;
const pagesDict = (document: PDFDocument) => document.context.lookup(pagesRef(document)) as PDFDict;
const kidsArray = (document: PDFDocument) => document.context.lookup(pagesDict(document).get(PDFName.of('Kids'))) as PDFArray;
const firstPage = (document: PDFDocument) => document.context.lookup(kidsArray(document).get(0)) as PDFDict;

describe('PDF_LIMITS', () => {
  it('freezes the documented processing bounds', () => {
    expect(PDF_LIMITS).toEqual(expect.objectContaining({ pages: 200, fields: 500, treeNodes: 2000, treeDepth: 64, deadlineMs: 15_000, inputBytes: 32 * 1024 * 1024 }));
    expect(Object.isFrozen(PDF_LIMITS)).toBe(true);
  });
  it('documents the operator-facing limitations', () => {
    expect(PDF_LIMITATIONS.length).toBeGreaterThan(0);
    for (const limitation of PDF_LIMITATIONS) expect(typeof limitation).toBe('string');
    expect(PDF_LIMITATIONS.join(' ')).toMatch(/200 pages|500 form fields/);
  });
});

describe('validatePdfStructure', () => {
  it('accepts documents at the page bound', async () => {
    const document = await documentWithPages(1);
    expect(() => validatePdfStructure(document)).not.toThrow();
    const full = await documentWithPages(200);
    expect(() => validatePdfStructure(full)).not.toThrow();
  });
  it('rejects more pages than the limit', async () => {
    const document = await documentWithPages(201);
    expect(code(() => validatePdfStructure(document))).toBe('PDF_LIMIT');
    expect(() => validatePdfStructure(document)).toThrowError(/1 to 200 pages/);
  });
  it('rejects a page whose parent link does not point back', async () => {
    const document = await documentWithPages(2);
    firstPage(document).set(PDFName.of('Parent'), document.context.obj({}));
    expect(code(() => validatePdfStructure(document))).toBe('INVALID_PDF_STRUCTURE');
    expect(() => validatePdfStructure(document)).toThrowError(/page tree/);
  });
  it('rejects a cyclic page tree', async () => {
    const document = await documentWithPages(1);
    // Point the Pages node back at itself as its only kid.
    pagesDict(document).set(PDFName.of('Kids'), document.context.obj([pagesRef(document)]));
    expect(code(() => validatePdfStructure(document))).toBe('INVALID_PDF_STRUCTURE');
  });
  it('rejects a shared page dict referenced from two parents', async () => {
    const document = await documentWithPages(1);
    const pages = pagesDict(document);
    const pageRef = kidsArray(document).get(0) as PDFRef;
    const sibling = document.context.obj({ Type: PDFName.of('Pages'), Kids: [pageRef], Parent: pagesRef(document) });
    const siblingRef = document.context.register(sibling);
    pages.set(PDFName.of('Kids'), document.context.obj([pageRef, siblingRef]));
    expect(code(() => validatePdfStructure(document))).toBe('INVALID_PDF_STRUCTURE');
  });
  it('rejects malformed page-tree nodes', async () => {
    for (const mutate of [
      (document: PDFDocument) => { pagesDict(document).set(PDFName.of('Kids'), document.context.obj('not-an-array')); },
      (document: PDFDocument) => { pagesDict(document).set(PDFName.of('Kids'), document.context.obj([])); },
      (document: PDFDocument) => { pagesDict(document).set(PDFName.of('Kids'), document.context.obj([{ Type: 'Page' }])); },
      (document: PDFDocument) => { pagesDict(document).set(PDFName.of('Type'), PDFName.of('SomethingElse')); },
    ]) {
      const document = await documentWithPages(1);
      mutate(document);
      expect(code(() => validatePdfStructure(document))).toBe('INVALID_PDF_STRUCTURE');
    }
  });
  it('accepts a document with form fields', async () => {
    const document = await documentWithPages(1);
    document.getForm().createTextField('field-one');
    document.getForm().createCheckBox('field-two');
    expect(() => validatePdfStructure(document)).not.toThrow();
  });
  it('rejects XFA forms', async () => {
    const document = await documentWithPages(1);
    document.getForm().createTextField('f');
    const acroForm = document.context.lookup(document.catalog.get(PDFName.of('AcroForm'))) as PDFDict;
    acroForm.set(PDFName.of('XFA'), document.context.obj({}));
    expect(code(() => validatePdfStructure(document))).toBe('UNSUPPORTED_PDF');
  });
  it('rejects form fields over the limit', async () => {
    const document = await documentWithPages(1);
    const form = document.getForm();
    for (let index = 0; index < 501; index++) form.createTextField(`f${index}`);
    expect(code(() => validatePdfStructure(document))).toBe('INVALID_PDF_STRUCTURE');
    expect(() => validatePdfStructure(document)).toThrowError(/form tree/);
  });
  it('rejects a field whose parent link does not point back', async () => {
    const document = await documentWithPages(1);
    const form = document.getForm();
    form.createTextField('f');
    const acroForm = document.context.lookup(document.catalog.get(PDFName.of('AcroForm'))) as PDFDict;
    const fields = document.context.lookup(acroForm.get(PDFName.of('Fields'))) as PDFArray;
    const field = document.context.lookup(fields.get(0)) as PDFDict;
    field.set(PDFName.of('Parent'), document.context.obj({}));
    expect(code(() => validatePdfStructure(document))).toBe('INVALID_PDF_STRUCTURE');
  });
  it('rejects a malformed Fields array entry', async () => {
    const document = await documentWithPages(1);
    document.getForm().createTextField('f');
    const acroForm = document.context.lookup(document.catalog.get(PDFName.of('AcroForm'))) as PDFDict;
    acroForm.set(PDFName.of('Fields'), document.context.obj('nope'));
    expect(code(() => validatePdfStructure(document))).toBe('INVALID_PDF_STRUCTURE');
  });
});
