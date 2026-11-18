import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UserStateRecord } from '../packages/contracts/index.ts';
import { offlineCommandFixture } from './fixtures/offline-command-benchmark.ts';
import { measure, measuredArm, recordOfflineBenchmark } from './fixtures/offline-benchmark-receipt.ts';

it('measures serial edits and two same-revision clients with explicit merge/retry to identical saved state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm01-concurrent-edits-')), rounds = 16;
  const run = async (concurrent: boolean) => {
    const fixture = await offlineCommandFixture(join(root, concurrent ? 'concurrent' : 'serial'));
    const initial: UserStateRecord = { id: 'owned-state', threadId: fixture.thread.id, revision: 0, schemaVersion: 1, values: { left: '', right: '' } };
    fixture.store.internal('fixture.user-state', fixture.thread.id, () => fixture.store.put('userState', initial.id, fixture.thread.id, initial));
    const current = () => fixture.store.get<UserStateRecord>('userState', initial.id)!;
    const payload = (clientId: string, clientSequence: number, state: UserStateRecord, values: Record<string, unknown>) =>
      ({ stateId: state.id, baseRevision: state.revision, clientId, clientSequence, values });
    try {
      fixture.resetMeasurements();
      const observed = await measure(async () => {
        const savedValues: Record<string, unknown>[] = [], rejectedCodes: string[] = [], rejectedReceiptStates: unknown[] = [];
        for (let index = 0; index < rounds; index++) {
          const before = current(), left = 'seed-42-left-' + index, right = 'seed-42-right-' + index;
          const leftPayload = payload('client-left', index + 1, before, { ...before.values, left });
          if (concurrent) {
            const rightPayload = payload('client-right', index + 1, before, { ...before.values, right });
            // Both clients submit their captured revision without awaiting the
            // other. SQLite command admission remains the actual single writer.
            const [first, stale] = await Promise.all([
              fixture.attempt('state.save', leftPayload), fixture.attempt('state.save', rightPayload),
            ]);
            if (first.status !== 'accepted' || stale.status !== 'rejected')
              throw new Error('Same-revision clients must produce one accepted edit and one stale rejection');
            rejectedCodes.push(stale.code); rejectedReceiptStates.push(fixture.store.receipt(stale.command));
            if (current().values.left !== left || current().values.right !== before.values.right)
              throw new Error('A rejected client overwrote the accepted edit');
          } else {
            const first = await fixture.attempt('state.save', leftPayload);
            if (first.status !== 'accepted') throw new Error('Serial first edit was rejected: ' + first.code);
          }
          savedValues.push(current().values);
          // The same desired right-field edit is applied against the observed
          // saved state. This explicit merge retains the accepted left edit.
          const refreshed = current();
          const second = await fixture.attempt('state.save', payload('client-right', index + 1, refreshed, { ...refreshed.values, right }));
          if (second.status !== 'accepted') throw new Error('Explicit merged edit was rejected: ' + second.code);
          savedValues.push(current().values);
        }
        const final = current();
        return { final: { revision: final.revision, schemaVersion: final.schemaVersion, values: final.values },
          savedValues, rejectedCodes, rejectedReceiptStates };
      });
      expect(fixture.runtimeCalls).toEqual([]);
      const durableSaves = fixture.store.eventsAfter(0).filter(event => event.type === 'state.save').length;
      return { ...observed, ...fixture.measurements(), durableSaves };
    } finally { await fixture.close(); }
  };
  try {
    const baseline = await run(false), candidate = await run(true);
    expect(candidate.value.final).toEqual(baseline.value.final);
    expect(candidate.value.final).toEqual({ revision: 32, schemaVersion: 1, values: { left: 'seed-42-left-15', right: 'seed-42-right-15' } });
    expect(candidate.value.savedValues).toEqual(baseline.value.savedValues);
    expect(candidate.value.rejectedCodes).toEqual(Array.from({ length: rounds }, () => 'STALE_USER_STATE'));
    expect(candidate.value.rejectedReceiptStates).toEqual(Array.from({ length: rounds }, () => null));
    expect(baseline.durableSaves).toBe(rounds * 2); expect(candidate.durableSaves).toBe(rounds * 2);
    expect(baseline.accepted).toBe(rounds * 2); expect(candidate.accepted).toBe(rounds * 2);
    expect(baseline.rejected).toBe(0); expect(candidate.rejected).toBe(rounds);
    recordOfflineBenchmark(root, {
      fixture: 'concurrent-edits', model: null, account: null, seed: 42,
      config: '16 identical left/right edit pairs: serial current revisions versus same-revision clients and explicit merged retry',
      baseline: measuredArm('baseline', baseline.elapsedMs, baseline.inputBytes, baseline.outputBytes),
      candidate: measuredArm('candidate', candidate.elapsedMs, candidate.inputBytes, candidate.outputBytes),
      notes: [
        'Both arms execute current Service state.save commands and real SQLite transactions, preserving identical accepted values and final state.',
        'The scenario submits both client promises before awaiting, observes one stale rejection, then explicitly merges the saved state.',
        'Input bytes are serialized command envelopes; output bytes are actual receipts or typed public error envelopes.',
        'Elapsed includes receipt serialization and saved-state rereads, with setup and final assertions outside the measured loop.',
        'The scenario performs 16 extra rejected commands. This is conflict-recovery overhead, not an optimization, browser benchmark, or historical-build comparison.',
      ],
    }, { rounds, baseline: { accepted: baseline.accepted, rejected: baseline.rejected, durableSaves: baseline.durableSaves },
      candidate: { accepted: candidate.accepted, rejected: candidate.rejected, durableSaves: candidate.durableSaves },
      final: candidate.value.final, rejectedCode: 'STALE_USER_STATE', rejectedCommandsPersisted: 0, runtimeCalls: 0 });
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
});
