import { expect, it } from 'vitest';
import { EMPTY_USAGE } from '../packages/contracts';
import { calculateNextContextBudget } from '../packages/core/context-compiler';
import { createInferenceBudgetLedger } from '../packages/runtime-hermes/context-budget';
import type { NativeContextCompilation } from '../packages/runtime-hermes/context';

const context = (digest: string, previousDigest: string | null, bytes: number, toolBytes: number | null, generation = 1): NativeContextCompilation => ({
  receipt: null, unavailableReason: null, previousDigest,
  projection: { source: 'ORIGINAL_ACP_MESSAGES', measurement: 'BYTE_ONLY', generation, revisionDigest: digest.repeat(64), change: previousDigest ? 'APPEND' : 'RESET',
    sourceCount: 2, sourceBytes: bytes, reusedSources: 1, compiledSources: 1, inspectedSources: 2, newToolResults: toolBytes === null ? null : toolBytes > 0 ? 1 : 0, newToolResultBytes: toolBytes, sources: [], omittedSources: 2 },
});
const request = (sequence: number, nativeContext?: NativeContextCompilation) => ({ sequence, inputIds: ['input'], phase: 'foreground' as const, nativeContext });

it('keeps every unavailable token-budget component null and never treats a cached token as absent', () => {
  expect(calculateNextContextBudget({ observedInputTokens: null, cacheReadSubsetTokens: null, newUnreportedToolTokens: null, reservedOutputTokens: null, contextWindowTokens: null, turnNeedsAnotherRequest: true }))
    .toEqual({ requiredTokens: null, shouldConsiderCompaction: null });
  expect(calculateNextContextBudget({ observedInputTokens: 1000, cacheReadSubsetTokens: 900, newUnreportedToolTokens: 600, reservedOutputTokens: 200, contextWindowTokens: 1500, turnNeedsAnotherRequest: true }))
    .toEqual({ requiredTokens: 1800, shouldConsiderCompaction: true });
  expect(calculateNextContextBudget({ observedInputTokens: 1000, cacheReadSubsetTokens: 900, newUnreportedToolTokens: 600, reservedOutputTokens: 200, contextWindowTokens: 1500, turnNeedsAnotherRequest: false }))
    .toEqual({ requiredTokens: 1800, shouldConsiderCompaction: false });
});

it('projects actual source bytes after the last request while preserving raw usage conventions', () => {
  const ledger = createInferenceBudgetLedger('owner'), first = request(1, context('a', null, 100, null));
  ledger.record(first, 'request-1', { ...EMPTY_USAGE, inputTokens: 12, outputTokens: 9, cacheReadTokens: 80, cacheWriteTokens: null, contextTokens: 5000, contextWindow: 10000 }, 'completed');
  const budget = ledger.preview(request(2, context('b', 'a'.repeat(64), 200, 80)), 220);
  expect(budget).toMatchObject({ measurement: 'BYTE_ONLY', byteAdmission: 'WITHIN_LIMIT', sourceContinuity: 'VERIFIED', newSourceBytes: 100, newToolResultBytes: 80, newToolResults: 1,
    normalizedInputTokens: null, newUnreportedToolTokens: null, reservedOutputTokens: null, requiredTokens: null, shouldConsiderCompaction: null, tokenAdmission: 'UNAVAILABLE',
    previousRequest: { requestId: 'request-1', sequence: 1, inputTokens: 12, outputTokens: 9, cacheReadTokens: 80, cacheWriteTokens: null, reportedContextTokens: 5000, contextMeasurement: 'UNSPECIFIED' } });
});

it.each(['generation', 'digest', 'unavailable'])('does not describe old results as newly unreported after %s invalidation', reason => {
  const ledger = createInferenceBudgetLedger('owner'); ledger.record(request(1, context('a', null, 100, null)), 'request-1', { ...EMPTY_USAGE, inputTokens: 30 }, 'completed');
  const native = reason === 'unavailable' ? undefined : context('b', reason === 'digest' ? 'c'.repeat(64) : 'a'.repeat(64), 200, 80, reason === 'generation' ? 2 : 1);
  expect(ledger.preview(request(2, native), 250)).toMatchObject({ sourceContinuity: 'UNAVAILABLE', newSourceBytes: null, newToolResultBytes: null, newUnreportedToolTokens: null, requiredTokens: null });
});

it('reuses an unchanged owner across source turns but refuses an account or instruction scope change', () => {
  const ledger = createInferenceBudgetLedger('original'); ledger.record(request(1, context('a', null, 100, null)), 'request-1', { ...EMPTY_USAGE, inputTokens: 30 }, 'completed');
  const next = request(3, context('b', 'a'.repeat(64), 140, 0));
  expect(createInferenceBudgetLedger('original', ledger.anchor()).preview(next, 180)).toMatchObject({ sourceContinuity: 'VERIFIED', newToolResultBytes: 0, newUnreportedToolTokens: 0 });
  expect(createInferenceBudgetLedger('changed', ledger.anchor()).preview(next, 180)).toMatchObject({ sourceContinuity: 'UNAVAILABLE', previousRequest: null });
});

it('does not seed a future request from failed work or a background summary', () => {
  const ledger = createInferenceBudgetLedger('owner'), first = request(1, context('a', null, 100, null));
  ledger.record(first, 'request-1', { ...EMPTY_USAGE, inputTokens: 30 }, 'completed');
  ledger.record({ ...request(2), phase: 'background_review' }, 'background', { ...EMPTY_USAGE, inputTokens: 999 }, 'completed');
  expect(ledger.anchor()?.requestId).toBe('request-1');
  ledger.record(request(3), 'failed', { ...EMPTY_USAGE, inputTokens: 45 }, 'failed');
  expect(ledger.anchor()).toBeUndefined();
});

it('blocks the real host byte limit without fabricating a token overflow or performing compaction', () => {
  const ledger = createInferenceBudgetLedger(null);
  expect(ledger.preview(request(1), 16 * 1024 * 1024 + 1)).toMatchObject({ byteAdmission: 'BLOCKED', tokenAdmission: 'UNAVAILABLE', measurement: 'BYTE_ONLY', requiredTokens: null, reservedOutputTokens: null });
});
