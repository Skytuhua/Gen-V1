import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../../../packages/storage/store.ts';
import { ToolAuthority, buildToolRegistry } from '../../../../packages/core/tool-authority.ts';
import { ToolEffectLedger } from '../../../../packages/core/tool-effects.ts';
import { ToolDisclosure } from '../../../../packages/core/tool-disclosure.ts';
import { PrivateToolResults } from '../../../../packages/core/tool-results.ts';
import { ToolPrograms } from '../../../../packages/core/tool-programs.ts';
import { createJavaScriptExecutor } from '../../../../packages/runtime/tool-program-worker.ts';
import type { ProgramExecutor } from '../../../../packages/contracts/tool-program.ts';

// A bounded-scale reproduction of duplicate input materialization. This uses
// one 256 KiB synthetic private result, not the potential 64 x 8 MiB maximum.
const cwd = fileURLToPath(new URL('../../../../', import.meta.url));
const sourcePaths = ['packages/core/tool-programs.ts', 'packages/core/tool-results.ts',
  'packages/contracts/tool-program.ts', 'packages/runtime/tool-program-worker.ts'];
const sourceSha256 = Object.fromEntries(sourcePaths.map(path => [path,
  createHash('sha256').update(readFileSync(join(cwd, path))).digest('hex'),
]));
const backend = await createJavaScriptExecutor();
let materialization: { inputValues: number; uniqueValueObjects: number; serializedBytes: number } | null = null;
const executor: ProgramExecutor = {
  proof: backend.proof,
  execute: async request => {
    materialization = { inputValues: request.inputValues.length,
      uniqueValueObjects: new Set(request.inputValues).size,
      serializedBytes: Buffer.byteLength(JSON.stringify(request.inputValues)) };
    return backend.execute(request);
  },
  stop: () => backend.stop(),
};
const directory = mkdtempSync(join(tmpdir(), 'm12-independent-inputs-'));
const store = new Store(directory);
const owner = { threadId: 'review-thread', runId: 'review-run', epoch: 1,
  projectId: 'review-project', workspaceId: 'review-workspace', accountBinding: 'review-account' };
const authority = new ToolAuthority(buildToolRegistry());
const effects = new ToolEffectLedger(store, authority);
const disclosure = new ToolDisclosure(store, authority, { currentOwner: () => owner });
const results = new PrivateToolResults(store, { currentOwner: () => owner });
const programs = new ToolPrograms(store, { authority, effects, disclosure, results,
  currentOwner: () => owner, enabled: () => true, executeRead: async () => { throw new Error('No reads expected'); },
});
try {
  const value = { payload: 'x'.repeat(256 * 1024) };
  const ref = await results.save({ owner, programId: 'review-input-source', status: 'SUCCEEDED', value, grants: [] });
  let outcome: unknown;
  try {
    const program = await programs.prepare({ owner, language: 'JAVASCRIPT',
      source: 'return {count: inputs.length};', allowedTools: [],
      inputRefs: Array.from({ length: 64 }, () => ref), requestedAggregate: 'Count the input values',
    }, executor);
    const result = await programs.run(program.programId, owner, executor);
    outcome = { stage: 'run', state: result.state, error: result.error?.code };
  } catch (error) {
    outcome = { stage: 'prepare', error: error instanceof Error ? error.name : typeof error };
  }
  console.log(JSON.stringify({ schema: 'M12IndependentReviewProbeV1',
    name: 'duplicate-input-reference-materialization', recordedAt: new Date().toISOString(), cwd, sourceSha256,
    liveExternalEffects: false, retainedUniqueReferences: 1, requestedReferenceCount: 64,
    storedJsonBytes: Buffer.byteLength(JSON.stringify(value)), materialization, outcome,
    theoreticalMaximumRawInputBytesBeforeFix: 64 * 8 * 1024 * 1024,
  }, null, 2));
} finally {
  await programs.close();
  await executor.stop();
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
