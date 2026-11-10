import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import {canonicalBytes} from '../../packages/company-contracts/communications/json.ts';
import examples from '../../packages/company-contracts/communications/owner-discussion-stream-candidate.1/examples.json';
import descriptor from '../../packages/company-contracts/communications/owner-discussion-stream-candidate.1/sse.json';

const moduleURL = new URL('../../packages/company-client/owner-discussion-sse-parser.ts', import.meta.url);
const load = () => import(moduleURL.href) as Promise<typeof import('../../packages/company-client/owner-discussion-sse-parser.ts')>;
const utf8 = (value: string) => new TextEncoder().encode(value);
const text = (value: Uint8Array) => new TextDecoder().decode(value);
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const changes = (data = '{}', id = 'AA') => utf8(`id: ${id}\nevent: changes\ndata: ${data}\n\n`);
const control = (data = '{}') => utf8(`event: control\ndata: ${data}\n\n`);

it('emits an exact frame only after its final blank LF, never after its id line', async () => {
  const {OwnerDiscussionSSEParser} = await load(), parser = new OwnerDiscussionSSEParser();
  const frame = changes();
  expect([...parser.push(frame.subarray(0, 7))]).toEqual([]);
  expect([...parser.push(frame.subarray(7, -1))]).toEqual([]);
  expect([...parser.push(frame.subarray(-1))]).toEqual([{kind: 'changes', id: 'AA', data: utf8('{}'), rawFrame: frame}]);
  expect(parser.bufferedBytes).toBe(0);
});

it('pins the exact descriptor bytes and every golden frame hash', async () => {
  const {OwnerDiscussionSSEParser} = await load();
  expect(hash(readFileSync(new URL('../../packages/company-contracts/communications/owner-discussion-stream-candidate.1/sse.json', import.meta.url))))
    .toBe('2e2460b26be8463b671296590c2963bd68387a55ac133ab985b189387511b7c1');
  const page = examples.examples[2].page;
  const golden = [utf8(': connected\n\n'), utf8(': keepalive\n\n'), changes(text(canonicalBytes(page)), page.next_cursor!),
    control(text(canonicalBytes({schema_version: 1, error: {code: 'RESYNC_REQUIRED'}})))];
  for (const [index, frame] of golden.entries()) {
    expect(frame.byteLength).toBe(descriptor.golden_vectors[index].bytes);
    expect(hash(frame)).toBe(descriptor.golden_vectors[index].sha256);
    const parsed = [...new OwnerDiscussionSSEParser().push(frame)];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].rawFrame).toEqual(frame);
    if (index < 2) expect(parsed[0]).toEqual({kind: 'comment', comment: index ? 'keepalive' : 'connected', rawFrame: frame});
    else expect(parsed[0]).toMatchObject({kind: index === 2 ? 'changes' : 'control'});
  }
});

it('preserves valid UTF-8 data over every single split and bytewise delivery without normalization', async () => {
  const {OwnerDiscussionSSEParser} = await load(), data = '{"text":"é😀é"}', frame = changes(data);
  for (let split = 0; split <= frame.byteLength; split++) {
    const parser = new OwnerDiscussionSSEParser();
    expect([...parser.push(frame.subarray(0, split)), ...parser.push(frame.subarray(split))])
      .toEqual([{kind: 'changes', id: 'AA', data: utf8(data), rawFrame: frame}]);
  }
  const parser = new OwnerDiscussionSSEParser(), parsed = [];
  for (const byte of frame) parsed.push(...parser.push(Uint8Array.of(byte)));
  expect(parsed).toEqual([{kind: 'changes', id: 'AA', data: utf8(data), rawFrame: frame}]);
});

it.each([[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0x80], [0xe2, 0x82]])
('rejects malformed UTF-8 only once the complete frame arrives: %s', async (...invalid) => {
  const {OwnerDiscussionSSEParser} = await load(), parser = new OwnerDiscussionSSEParser();
  const prefix = utf8('event: control\ndata: ');
  expect([...parser.push(Uint8Array.from([...prefix, ...invalid]))]).toEqual([]);
  expect(() => [...parser.push(utf8('\n\n'))]).toThrow();
});

it('accepts exactly 65,536 bytes including framing and rejects byte 65,537 before retaining it', async () => {
  const {OwnerDiscussionSSEParser} = await load(), overhead = control().byteLength - 2;
  const atLimit = control('x'.repeat(65536 - overhead));
  expect(atLimit.byteLength).toBe(65536);
  const parser = new OwnerDiscussionSSEParser();
  expect([...parser.push(atLimit)]).toEqual([{kind: 'control', data: utf8('x'.repeat(65536 - overhead)), rawFrame: atLimit}]);
  for (const chunks of [[control('x'.repeat(65537 - overhead))], [new Uint8Array(65536).fill(120), Uint8Array.of(120)]]) {
    const rejected = new OwnerDiscussionSSEParser();
    expect(() => {for (const chunk of chunks) [...rejected.push(chunk)];}).toThrow();
    expect(rejected.bufferedBytes).toBeLessThanOrEqual(65536);
  }
});

it('yields many frames one at a time without collecting a chunk-sized frame array', async () => {
  const {OwnerDiscussionSSEParser} = await load(), parser = new OwnerDiscussionSSEParser();
  const frames = utf8(': connected\n\n'.repeat(30000));
  const iterator = parser.push(frames);
  const expected = {kind: 'comment', comment: 'connected', rawFrame: utf8(': connected\n\n')};
  expect(iterator.next()).toEqual({done: false, value: expected});
  expect(parser.bufferedBytes).toBe(0);
  let count = 1;
  for (const frame of iterator) {expect(frame).toEqual(expected); count++;}
  expect(count).toBe(30000);
  expect(parser.bufferedBytes).toBe(0);
});

it.each(['id: AA\n', 'id: AA\nevent: changes\ndata: {}\n', 'event: control\ndata: {}\n', 'event: control\ndata: ', ': keepalive\n', '\ud83d'])
('discards incomplete EOF bytes and cannot splice a later stream: %s', async partial => {
  const {OwnerDiscussionSSEParser} = await load(), parser = new OwnerDiscussionSSEParser();
  expect([...parser.push(utf8(partial))]).toEqual([]);
  parser.finish();
  expect(parser.bufferedBytes).toBe(0);
  expect(() => [...parser.push(control())]).toThrow();
  expect(() => parser.finish()).not.toThrow();
});

it.each([
  ': unknown\n\n', ':connected\n\n', ': connected \n\n', '\n\n', '\ufeff: connected\n\n', ': connected\r\n\r\n',
  'id: AA\nevent: changes\ndata: {}\r\n\r\n', 'id: AA\nevent: changes\ndata: {}\nretry: 1\n\n',
  'id: AA\nevent: changes\ndata: {}\ndata: {}\n\n', 'id: AA\nevent: changes\nextra: value\ndata: {}\n\n',
  'event: changes\nid: AA\ndata: {}\n\n', 'id: AA\nevent: control\ndata: {}\n\n',
  'event: other\ndata: {}\n\n', 'event: control\ndata:{}\n\n', 'event:control\ndata: {}\n\n',
  'id: AA\nevent: changes\ndata: {"partial":\nevent: control\ndata: {}\n\n',
])('rejects nonexact fields, comments, terminators and partial-frame control splicing: %s', async frame => {
  const {OwnerDiscussionSSEParser} = await load(), parser = new OwnerDiscussionSSEParser();
  expect(() => [...parser.push(utf8(frame))]).toThrow();
});

it.each(['', 'A', 'AB', 'AAB', 'AA=', '+w', '/w', ' AA', 'AA ', 'é', 'A'.repeat(4097), 'AA\r', 'AA\0'])
('rejects noncanonical cursor spelling or unused bits: %s', async cursor => {
  const {OwnerDiscussionSSEParser} = await load();
  expect(() => [...new OwnerDiscussionSSEParser().push(changes('{}', cursor))]).toThrow();
});

it.each(['AA', 'AAA', '_w', '____', 'A'.repeat(4096)])('accepts only opaque cursor syntax without decoding claims: %s', async cursor => {
  const {OwnerDiscussionSSEParser} = await load();
  expect([...new OwnerDiscussionSSEParser().push(changes('{}', cursor))]).toEqual([{kind: 'changes', id: cursor, data: utf8('{}'), rawFrame: changes('{}', cursor)}]);
});

it('retains already completed frames but fails closed after a malformed subsequent frame', async () => {
  const {OwnerDiscussionSSEParser} = await load(), parser = new OwnerDiscussionSSEParser();
  const iterator = parser.push(utf8(': keepalive\n\nevent: wrong\ndata: {}\n\n'));
  expect(iterator.next().value).toEqual({kind: 'comment', comment: 'keepalive', rawFrame: utf8(': keepalive\n\n')});
  expect(() => iterator.next()).toThrow();
  expect(() => [...parser.push(control())]).toThrow();
});

it('copies emitted data and raw frames independently of input, pending storage and each other', async () => {
  const {OwnerDiscussionSSEParser} = await load(), parser = new OwnerDiscussionSSEParser(), input = changes('{"x":"é"}');
  const [first] = parser.push(input);
  expect(first.kind).toBe('changes');
  if (first.kind !== 'changes') throw new Error('expected changes');
  const expectedRaw = input.slice(), expectedData = first.data.slice();
  input.fill(0);
  expect(first.rawFrame).toEqual(expectedRaw);
  expect(first.data).toEqual(expectedData);
  [...parser.push(control())];
  expect(first.rawFrame).toEqual(expectedRaw);
  first.rawFrame.fill(0);
  expect(first.data).toEqual(expectedData);
});
