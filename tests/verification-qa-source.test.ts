import {expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {boundedQaResult, qaFindingSource, qaSourceView, QA_SOURCE_CAPTURE_BYTES, QA_SOURCE_RESULT_BYTES} from '../packages/core/verification-qa-source.ts';

const proposal = {findingId: 'advisory-review', path: 'src/app.ts', line: 2, observation: 'A source review claim', impact: 'Potential impact', reproduction: null};

it('binds an advisory finding to the exact Git blob and validates its real line count', () => {
  const bytes = Buffer.from('first\r\nsecond\r\n'), blobSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  expect(qaFindingSource(proposal, bytes)).toEqual({findingId: proposal.findingId, observation: proposal.observation, impact: proposal.impact, reproduction: null, source: {path: proposal.path, line: 2, blobSha}});
  expect(() => qaFindingSource({...proposal, line: 3}, bytes)).toThrow('outside the captured source');
  expect(() => qaFindingSource({...proposal, line: 0}, bytes)).toThrow();
  expect(() => qaFindingSource({...proposal, line: 1}, Buffer.alloc(0))).toThrow('outside the captured source');
  expect(qaFindingSource({...proposal, line: null}, Buffer.alloc(0)).source.line).toBeNull();
});

it.each(['source', 'provenance', 'authorizedScope', 'evidenceQuality', 'status'])('refuses model-supplied %s in an advisory finding', field => {
  expect(() => qaFindingSource({...proposal, [field]: 'forged authority'}, Buffer.from('one\ntwo'))).toThrow();
});

it('returns exact bounded UTF-8 byte ranges, including JSON escaping, with explicit omitted bytes', () => {
  const bytes = Buffer.from('😀"\\\n'.repeat(5000)), parts: Buffer[] = []; let offset = 0;
  while (offset < bytes.length) {
    const view = qaSourceView(bytes, {path: 'src/app.ts', byteOffset: offset});
    expect(Buffer.byteLength(JSON.stringify(view))).toBeLessThanOrEqual(QA_SOURCE_RESULT_BYTES);
    expect(Buffer.byteLength(view.text)).toBe(view.byteLength); expect(view.byteLength).toBeGreaterThan(0);
    expect(view.byteOffset).toBe(offset); expect(view.totalBytes).toBe(bytes.length); expect(view.omittedBytes).toBe(bytes.length - view.byteLength);
    expect(view.text).not.toContain('�'); parts.push(Buffer.from(view.text)); offset += view.byteLength;
    expect(view.nextByteOffset).toBe(offset < bytes.length ? offset : null);
  }
  expect(Buffer.concat(parts)).toEqual(bytes);
});

it('does not round invalid offsets into another source character or exceed a requested range', () => {
  const bytes = Buffer.from('😀abc');
  expect(() => qaSourceView(bytes, {path: 'app.ts', byteOffset: 1})).toThrow('UTF-8 character boundary');
  expect(() => qaSourceView(bytes, {path: 'app.ts', maxBytes: 1})).toThrow('complete character');
  expect(qaSourceView(bytes, {path: 'app.ts', maxBytes: 4})).toMatchObject({text: '😀', byteLength: 4, nextByteOffset: 4, omittedBytes: 3});
  expect(() => qaSourceView(bytes, {path: 'app.ts', byteOffset: 8})).toThrow('UTF-8 character boundary');
});

it.each([Buffer.from([0xff]), Buffer.from('binary\0payload'), Buffer.alloc(QA_SOURCE_CAPTURE_BYTES + 1, 65)])('rejects invalid, binary or oversized source bytes before producing model context', bytes => {
  expect(() => qaSourceView(bytes, {path: 'app.ts'})).toThrow();
  expect(() => qaFindingSource({...proposal, line: null}, bytes)).toThrow();
});

it('also bounds metadata projections by serialized bytes and keeps exact omission counts', () => {
  const all = Array.from({length: 32}, () => '長'.repeat(4000)), view = {sourceFiles: [...all], omittedSourceFiles: 0};
  const bounded = boundedQaResult(view, () => {if (!view.sourceFiles.length) return false; view.sourceFiles.pop(); view.omittedSourceFiles++; return true;});
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(QA_SOURCE_RESULT_BYTES);
  expect(bounded.sourceFiles.length + bounded.omittedSourceFiles).toBe(all.length); expect(bounded.omittedSourceFiles).toBeGreaterThan(0);
});
