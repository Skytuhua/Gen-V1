import {describe, expect, it, vi} from 'vitest';
import {PDFDocument, PDFName} from 'pdf-lib';

const channel: {port: {postMessage: ReturnType<typeof vi.fn>}, data: unknown} = {port: {postMessage: vi.fn()}, data: undefined};
vi.mock('node:worker_threads', () => ({
  get parentPort() { return channel.port; },
  get workerData() { return channel.data; },
}));

// Regression coverage for literal-string tokenization: balanced parentheses,
// line continuations and odd-length hex strings are legal PDF syntax.
async function inspectStream(content: string) {
  const document = await PDFDocument.create();
  const page = document.addPage();
  const stream = document.context.stream(new TextEncoder().encode(content));
  page.node.set(PDFName.of('Contents'), document.context.register(stream));
  channel.data = {kind: 'inspect', bytes: new Uint8Array(await document.save())};
  channel.port.postMessage.mockClear();
  vi.resetModules();
  await import('../packages/capabilities/pdf-worker.ts');
  await vi.waitFor(() => expect(channel.port.postMessage.mock.calls.length).toBeGreaterThan(0));
  const message = channel.port.postMessage.mock.calls[0][0] as {kind: string; result?: any};
  expect(message.kind).toBe('inspection');
  return message.result.pages[0].text as string;
}

describe('pdf text extraction', () => {
  it('extracts literal strings with balanced parentheses', async () => {
    expect(await inspectStream('BT /F1 12 Tf (a(b)c) Tj ET')).toBe('a(b)c');
    expect(await inspectStream('(deep(er(st))) Tj')).toBe('deep(er(st))');
    expect(await inspectStream('(a\\(b\\)c) Tj')).toBe('a(b)c');
  });

  it('honors line continuations and octal escapes', async () => {
    expect(await inspectStream('(a\\\nb) Tj')).toBe('ab');
    expect(await inspectStream('(a\\\r\nb) Tj')).toBe('ab');
    expect(await inspectStream('(a\\101b) Tj')).toBe('aAb');
    expect(await inspectStream('(x\\n\\t\\(\\)\\\\) Tj')).toBe('x\n\t()\\');
  });

  it('pads odd-length hex strings and extracts TJ array items', async () => {
    expect(await inspectStream('<612> Tj')).toBe('a ');
    expect(await inspectStream('[(a) -50 (b) 10 <63>] TJ')).toBe('a b c');
    expect(await inspectStream('[(x(y)z) 20 <6465>] TJ')).toBe('x(y)z de');
  });

  it('recovers from malformed operands', async () => {
    expect(await inspectStream('(unterminated (ok) Tj')).toBe('ok');
    expect(await inspectStream('<zz> (still) Tj')).toBe('still');
  });
});
