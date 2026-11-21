import { Store, digest } from '../../packages/storage/store.ts';
import { ToolAuthority, buildToolRegistry, type RegistryEntry } from '../../packages/core/tool-authority.ts';
import { ToolEffectLedger, createToolEffectFlags } from '../../packages/core/tool-effects.ts';
import { createEffectAuthenticator } from '../../packages/core/host-effect-authenticator.ts';
import { ToolDisclosure } from '../../packages/core/tool-disclosure.ts';
import { PrivateToolResults } from '../../packages/core/tool-results.ts';
import { ToolPrograms, type ToolProgramOptions } from '../../packages/core/tool-programs.ts';
import type { ToolOwner } from '../../packages/contracts/tool-effects.ts';
import type { ProgramExecutor } from '../../packages/contracts/tool-program.ts';

export const REPLAY_OWNER: ToolOwner = Object.freeze({
  threadId: 'm12-replay-thread', runId: 'm12-replay-run', epoch: 1,
  projectId: 'm12-replay-project', workspaceId: 'm12-replay-workspace', accountBinding: 'm12-replay-account',
});
export const REPLAY_SOURCE = "const value = await tools.call('repository_read', {sequence: 0}); return {total: value.total, clock: Date.now(), random: Math.random()};";
export const CRASH_POINTS = [
  'program.prepared', 'journal.start_committed', 'call.identity_committed', 'call.before_dispatch',
  'call.effect_committed', 'call.dispatched', 'call.read_returned', 'call.result_committed', 'journal.delivery_committed', 'program.result_committed',
] as const;
export type CrashPoint = typeof CRASH_POINTS[number];
export interface ReplayFixtureState {
  owner: ToolOwner;
  reads: number;
  programId: string | null;
  killedAt: CrashPoint | null;
}

/** Fixed fixture key — deterministic across the crash child and the reopening
 * parent so signed argument commitments compare equal in both processes. This
 * exercises real HMAC crypto; it is injected test material, not OS custody. */
const M12_EFFECT_KEY = new Uint8Array(32).fill(0x6d);
const M12_EFFECT_KEY_ID = '6d7f0a12-0000-4000-8000-000000000d12';

/** Ledger in the same admission mode as every reopened store that already holds
 * effect receipts: the latched AUDIT history requires audit.effectsV1, and the
 * signed commitments need the deterministic fixture authenticator. */
export function m12Ledger(store: Store, authority: ToolAuthority): ToolEffectLedger {
  return new ToolEffectLedger(store, authority,
    createToolEffectFlags({ 'audit.effectsV1': true }),
    createEffectAuthenticator(M12_EFFECT_KEY, M12_EFFECT_KEY_ID));
}

/** The same deterministic credentials for a Service that reopens a store whose
 * receipts were admitted by m12Ledger/the crash child: deployment-realistic
 * custody keeps the same key across restart. */
export function m12EffectAuthenticator() {
  return createEffectAuthenticator(M12_EFFECT_KEY, M12_EFFECT_KEY_ID);
}
interface HarnessOptions {
  owner: ToolOwner;
  executor: ProgramExecutor;
  registry?: RegistryEntry[];
  executeRead?: ToolProgramOptions['executeRead'];
  boundary?: ToolProgramOptions['boundary'];
}

/** A host-only fixture, with an explicitly supplied owner and persistent read count.
 * It deliberately does not instantiate Service or resurrect a run/epoch on reopen. */
export function openReplayHarness(directory: string, options: HarnessOptions) {
  const store = new Store(directory);
  const saved = store.get<ReplayFixtureState>('m12ReplayFixture', 'fixture');
  if (saved && digest(saved.owner) !== digest(options.owner)) {
    store.close();
    throw new Error('The test must explicitly reopen the exact recorded owner');
  }
  if (!saved) store.internal('m12.fixture.created', options.owner.threadId, () => {
    store.put('m12ReplayFixture', 'fixture', options.owner.threadId, {
      owner: options.owner, reads: 0, programId: null, killedAt: null,
    } satisfies ReplayFixtureState);
  });
  let currentOwner = { ...options.owner };
  const authority = new ToolAuthority(options.registry ?? buildToolRegistry());
  const disclosure = new ToolDisclosure(store, authority, { currentOwner: () => currentOwner, eligibleTools: ['repository_read'] });
  disclosure.disclose(options.owner, ['repository_read']);
  const results = new PrivateToolResults(store, { currentOwner: () => currentOwner });
  const effects = m12Ledger(store, authority);
  const host: ToolProgramOptions = {
    authority, disclosure, results, effects, currentOwner: () => currentOwner,
    enabled: () => true,
    executeRead: async (call, owner, signal) => {
      if (call.name !== 'repository_read') throw new Error('Unexpected mutation or undisclosed tool reached the read fixture');
      if (signal.aborted) throw signal.reason;
      store.internal('m12.fixture.read', owner.threadId, () => {
        const state = store.get<ReplayFixtureState>('m12ReplayFixture', 'fixture')!;
        store.put('m12ReplayFixture', 'fixture', owner.threadId, { ...state, reads: state.reads + 1 });
        return { reads: state.reads + 1 };
      });
      return options.executeRead ? options.executeRead(call, owner, signal)
        : { total: 7, privateMarker: 'M12_REPLAY_PRIVATE_SOURCE' };
    },
    ...(options.boundary ? { boundary: options.boundary } : {}),
  };
  const programs = new ToolPrograms(store, host);
  return {
    store, authority, disclosure, results, effects, programs, host, executor: options.executor,
    state: () => store.get<ReplayFixtureState>('m12ReplayFixture', 'fixture')!,
    setCurrentOwner: (owner: ToolOwner) => { currentOwner = { ...owner }; },
    prepare: (source = REPLAY_SOURCE, limits = {}) => programs.prepare({
      owner: options.owner, language: 'JAVASCRIPT', source, allowedTools: ['repository_read'],
      requestedAggregate: 'Return the explicit fixture aggregate', limits,
    }, options.executor),
    close: async () => { await programs.close(); store.close(); },
  };
}
