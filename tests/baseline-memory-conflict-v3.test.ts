import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TaskMemory } from '../packages/contracts/index.ts';
import { offlineCommandFixture } from './fixtures/offline-command-benchmark.ts';
import { measure, measuredArm, recordOfflineBenchmark } from './fixtures/offline-benchmark-receipt.ts';

it('measures serial memory edits and explicit stale-edit recovery to the same desired final note', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm01-memory-conflict-')), rounds = 32;
  const run = async (conflict: boolean) => {
    const fixture = await offlineCommandFixture(join(root, conflict ? 'conflict' : 'serial'));
    const current = () => fixture.store.get<TaskMemory>('taskMemory', fixture.thread.id + ':decision')!;
    try {
      expect((await fixture.attempt('memory.save', { key: 'decision', content: 'Initial decision.', baseRevision: 0 })).status).toBe('accepted');
      fixture.resetMeasurements();
      const observed = await measure(async () => {
        const rejectedCodes: string[] = [], rejectedReceiptStates: unknown[] = [], acceptedContents: string[] = [];
        for (let index = 0; index < rounds; index++) {
          const before = current(), first = 'seed-42-first-edit-' + index, second = 'seed-42-final-edit-' + index;
          const accepted = await fixture.attempt('memory.save', { key: 'decision', content: first, baseRevision: before.revision });
          if (accepted.status !== 'accepted') throw new Error('Required first memory edit was rejected: ' + accepted.code);
          acceptedContents.push(current().content);
          if (conflict) {
            const stale = await fixture.attempt('memory.save', { key: 'decision', content: second, baseRevision: before.revision });
            if (stale.status !== 'rejected') throw new Error('A stale memory edit was accepted');
            rejectedCodes.push(stale.code); rejectedReceiptStates.push(fixture.store.receipt(stale.command));
            if (current().content !== first || current().revision !== before.revision + 1)
              throw new Error('The rejected edit changed committed memory');
          }
          // Both arms explicitly read the saved revision before the same desired
          // second edit. The scenario arm must first reject its stale attempt.
          const refreshed = current();
          const resolved = await fixture.attempt('memory.save', { key: 'decision', content: second, baseRevision: refreshed.revision });
          if (resolved.status !== 'accepted') throw new Error('Required resolved memory edit was rejected: ' + resolved.code);
          acceptedContents.push(current().content);
        }
        const final = current();
        return { final: { key: final.key, content: final.content, revision: final.revision, author: final.author },
          rejectedCodes, rejectedReceiptStates, acceptedContents };
      });
      expect(fixture.runtimeCalls).toEqual([]);
      return { ...observed, ...fixture.measurements() };
    } finally { await fixture.close(); }
  };
  try {
    const baseline = await run(false), candidate = await run(true);
    expect(candidate.value.final).toEqual(baseline.value.final);
    expect(candidate.value.final).toEqual({ key: 'decision', content: 'seed-42-final-edit-31', revision: 65, author: 'user' });
    expect(candidate.value.acceptedContents).toEqual(baseline.value.acceptedContents);
    expect(candidate.value.rejectedCodes).toEqual(Array.from({ length: rounds }, () => 'STALE_MEMORY'));
    expect(candidate.value.rejectedReceiptStates).toEqual(Array.from({ length: rounds }, () => null));
    expect(baseline.accepted).toBe(rounds * 2); expect(candidate.accepted).toBe(rounds * 2);
    expect(baseline.rejected).toBe(0); expect(candidate.rejected).toBe(rounds);
    recordOfflineBenchmark(root, {
      fixture: 'memory-conflict', model: null, account: null, seed: 42,
      config: '32 pairs of identical desired note edits: serial current revisions versus stale rejection and explicit reread/retry',
      baseline: measuredArm('baseline', baseline.elapsedMs, baseline.inputBytes, baseline.outputBytes),
      candidate: measuredArm('candidate', candidate.elapsedMs, candidate.inputBytes, candidate.outputBytes),
      notes: [
        'Both arms execute the current Service memory.save command and real SQLite transactions, and commit the same desired sequence/final note.',
        'Input bytes are serialized command envelopes; output bytes are actual receipts or typed public error envelopes.',
        'The measured sequence includes command receipt serialization and source rereads; thread/setup/cleanup and final assertions are outside it.',
        'The scenario includes 32 extra rejected commands. This compares conflict-recovery overhead, not a product optimization or historical implementation.',
      ],
    }, { rounds, baseline: { accepted: baseline.accepted, rejected: baseline.rejected, final: baseline.value.final },
      candidate: { accepted: candidate.accepted, rejected: candidate.rejected, final: candidate.value.final },
      rejectedCode: 'STALE_MEMORY', rejectedCommandsPersisted: 0, runtimeCalls: 0 });
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
});
