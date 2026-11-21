import {describe, it, expect} from 'vitest';
import {manualEditCapabilityV1, manualEditFileStateV1, manualEditSaveRequestV1, manualEditSaveResponseV1, MANUAL_EDIT_LIMITS} from '../packages/contracts/manual-edit.ts';

const hex64 = 'a'.repeat(64);

describe('manual-edit contracts (T01)', () => {
  it('parses capability and file state shapes', () => {
    expect(manualEditCapabilityV1.parse({available: true, checkpoints: false}).available).toBe(true);
    expect(manualEditCapabilityV1.parse({available: false, checkpoints: false, reason: 'flag_off'}).reason).toBe('flag_off');
    expect(() => manualEditCapabilityV1.parse({available: false, checkpoints: false, reason: 'unknown'})).toThrow();
    expect(manualEditFileStateV1.parse({editable: false, reason: 'binary', bom: false, lineSeparator: 'lf'}).reason).toBe('binary');
    expect(() => manualEditFileStateV1.parse({editable: true, bom: false, lineSeparator: 'lf', extra: 1})).toThrow();
  });

  it('accepts a valid save request and rejects bad SHA, extra keys and overlong paths', () => {
    const good = {path: 'src/a.ts', text: 'x', expectedSha256: hex64};
    expect(manualEditSaveRequestV1.parse(good).path).toBe('src/a.ts');
    expect(manualEditSaveRequestV1.parse({...good, threadId: 'thr:1'}).threadId).toBe('thr:1');
    expect(() => manualEditSaveRequestV1.parse({...good, expectedSha256: 'xyz'})).toThrow();
    expect(() => manualEditSaveRequestV1.parse({...good, signature: 'sig'})).toThrow();
    expect(() => manualEditSaveRequestV1.parse({...good, path: 'p'.repeat(1025)})).toThrow();
    expect(() => manualEditSaveRequestV1.parse({...good, threadId: 'bad id!'})).toThrow();
  });

  it('parses save responses with the checkpoint enum', () => {
    for (const checkpoint of ['captured', 'excluded', 'unavailable', 'disabled'] as const)
      expect(manualEditSaveResponseV1.parse({sha256: hex64, bytes: 3, checkpoint}).checkpoint).toBe(checkpoint);
    expect(() => manualEditSaveResponseV1.parse({sha256: hex64, bytes: -1, checkpoint: 'captured'})).toThrow();
  });

  it('limits stay at the planned caps', () => {
    expect(MANUAL_EDIT_LIMITS.bytes).toBe(1024 * 1024);
    expect(MANUAL_EDIT_LIMITS.bodyLimit).toBe(2 * 1024 * 1024);
  });
});
