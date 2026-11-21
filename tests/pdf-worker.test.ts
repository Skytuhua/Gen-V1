import {beforeEach, describe, expect, it, vi} from 'vitest';
import {PDFDocument, StandardFonts} from 'pdf-lib';
import {PDF_LIMITS} from '../packages/capabilities/pdf-protocol.ts';

const channel: {port: {postMessage: ReturnType<typeof vi.fn>}, data: unknown} = {port: {postMessage: vi.fn()}, data: undefined};
vi.mock('node:worker_threads', () => ({
  get parentPort() { return channel.port; },
  get workerData() { return channel.data; },
}));

async function runPdfJob(job: unknown) {
  channel.data = job;
  channel.port.postMessage.mockClear();
  vi.resetModules();
  await import('../packages/capabilities/pdf-worker.ts');
  await vi.waitFor(() => expect(channel.port.postMessage.mock.calls.length).toBeGreaterThan(0));
  return channel.port.postMessage.mock.calls[0][0] as {kind: string; result?: any; code?: string; error?: string};
}

describe('pdf worker job validation', () => {
  beforeEach(() => { channel.port.postMessage.mockClear(); });

  it('rejects malformed or oversized jobs before parsing', async () => {
    for (const job of [null, {kind: 'delete'}, {kind: 'inspect'}, {kind: 'inspect', bytes: new Uint8Array()}, {kind: 'inspect', bytes: new Uint8Array(PDF_LIMITS.inputBytes + 1)}])
      expect(await runPdfJob(job)).toMatchObject({kind: 'error', code: 'PDF_LIMIT'});
  });

  it('rejects invalid render arguments as PDF_ERROR', async () => {
    const bytes = new Uint8Array(await (await PDFDocument.create()).save());
    expect(await runPdfJob({kind: 'render', bytes, args: {outputPath: 'out.txt'}, pngs: []})).toMatchObject({kind: 'error', code: 'PDF_ERROR'});
  });
});

describe('pdf worker inspect', () => {
  it('reports page geometry, extracted text and fields', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([600, 400]);
    page.drawText('Hello Gen', {x: 50, y: 300, size: 12, font: await document.embedFont(StandardFonts.Helvetica)});
    const field = document.getForm().createTextField('name');
    field.setText('Ada');
    field.addToPage(page, {x: 10, y: 10, width: 100, height: 20});
    const message = await runPdfJob({kind: 'inspect', bytes: new Uint8Array(await document.save())});
    expect(message.kind).toBe('inspection');
    const result = message.result;
    expect(result.pageCount).toBe(1);
    expect(result.pages[0]).toMatchObject({page: 1, width: 600, height: 400, rotation: 0});
    expect(result.pages[0].text).toContain('Hello Gen');
    expect(result.fields).toEqual([{name: 'name', type: 'PDFTextField', readOnly: false, value: 'Ada'}]);
    expect(result.limitations).toHaveLength(5);
  });
});

describe('pdf worker render', () => {
  const args = (extra: object = {}) => ({resourceId: 'res-1', exportResourceId: 'res-2', outputPath: 'filled.pdf', ...extra});

  async function formDocument() {
    const document = await PDFDocument.create();
    const page = document.addPage([600, 400]);
    const form = document.getForm();
    const text = form.createTextField('name');
    text.addToPage(page, {x: 10, y: 10, width: 100, height: 20});
    const box = form.createCheckBox('agree');
    box.addToPage(page, {x: 10, y: 40, width: 15, height: 15});
    const list = form.createDropdown('choice');
    list.addOptions(['a', 'b']);
    list.addToPage(page, {x: 10, y: 60, width: 100, height: 20});
    return document;
  }

  async function render(args: object, build: () => Promise<PDFDocument> = formDocument, pngs: [string, Uint8Array][] = []) {
    const document = await build();
    return {message: await runPdfJob({kind: 'render', bytes: new Uint8Array(await document.save()), args, pngs}), document};
  }

  it('fills text, checkbox and dropdown fields', async () => {
    const {message} = await render(args({fields: {name: 'Ada', agree: true, choice: 'b'}}));
    expect(message.kind).toBe('rendered');
    const out = await PDFDocument.load(message.result);
    const form = out.getForm();
    expect(form.getTextField('name').getText()).toBe('Ada');
    expect(form.getCheckBox('agree').isChecked()).toBe(true);
    expect(form.getDropdown('choice').getSelected()).toEqual(['b']);
  });

  it('rejects unknown options, wrong value kinds and read-only fields', async () => {
    expect((await render(args({fields: {choice: 'zzz'}}))).message).toMatchObject({kind: 'error', code: 'INVALID_PDF_FIELD'});
    expect((await render(args({fields: {name: true}}))).message).toMatchObject({kind: 'error', code: 'UNSUPPORTED_PDF_FIELD'});
    expect((await render(args({fields: {name: 'x'}}), async () => {
      const d = await PDFDocument.create(), page = d.addPage(), field = d.getForm().createTextField('name');
      field.addToPage(page, {x: 1, y: 1, width: 50, height: 15});
      field.enableReadOnly();
      return d;
    })).message).toMatchObject({kind: 'error', code: 'UNSUPPORTED_PDF_FIELD'});
  });

  it('draws typed and drawn signatures inside the page', async () => {
    const {message} = await render(args({signatures: [
      {kind: 'typed', text: 'Signed', page: 1, x: 10, y: 10, width: 80, height: 16},
      {kind: 'drawn', points: [{x: 0, y: 0}, {x: 1, y: 1}, {x: 0.5, y: 0.2}], page: 1, x: 200, y: 100, width: 60, height: 30},
    ]}));
    expect(message.kind).toBe('rendered');
    const out = await PDFDocument.load(message.result);
    expect(out.getPageCount()).toBe(1);
  });

  it('rejects out-of-bounds and unavailable image signatures', async () => {
    expect((await render(args({signatures: [{kind: 'typed', text: 'x', page: 1, x: 590, y: 10, width: 50, height: 16}]}))).message)
      .toMatchObject({kind: 'error', code: 'INVALID_SIGNATURE_PLACEMENT'});
    expect((await render(args({signatures: [{kind: 'image', resourceId: 'sig', page: 1, x: 10, y: 10, width: 50, height: 16}]}))).message)
      .toMatchObject({kind: 'error', code: 'SIGNATURE_RESOURCE_UNAVAILABLE'});
  });

  it('enforces the 100-edit field bound', async () => {
    const fields = Object.fromEntries(Array.from({length: 101}, (_, i) => [`f${i}`, 'x']));
    expect((await render(args({fields}))).message).toMatchObject({kind: 'error', code: 'PDF_LIMIT'});
  });
});
