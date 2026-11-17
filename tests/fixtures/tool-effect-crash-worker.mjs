const { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } = await import('node:fs');
const { join } = await import('node:path');
const { Store } = await import('../../packages/storage/store.ts');
const { buildToolRegistry, ToolAuthority } = await import('../../packages/core/tool-authority.ts');
const { __setEffectFaultHookForTests, createToolEffectFlags, ToolEffectLedger } = await import('../../packages/core/tool-effects.ts');
const { recoverEffects } = await import('../../packages/core/effect-recovery.ts');

const [mode, root, phase] = process.argv.slice(2);
if (!root || !['crash', 'recover'].includes(mode)) throw new Error('Expected mode and owned fixture root');
const store = new Store(join(root, 'state'));
const ledger = new ToolEffectLedger(store, new ToolAuthority(buildToolRegistry()),
  createToolEffectFlags({ 'audit.effectsV1': true, 'security.authorityV1': true }));
const thread = {
  id: 'crash-thread', title: 'Crash fixture', projectName: null, createdAt: '', updatedAt: '',
  status: 'working', epoch: 1, runId: 'crash-run', modelId: null, sessionPath: null,
  accountId: null, projectId: null, workspaceId: null,
};
const operation = {
  id: 'counted-write', threadId: thread.id, revision: 1, kind: 'fixture.external.write',
  description: 'Append exactly one externally durable marker', args: {}, resourceIds: [], preconditions: {},
  status: 'prepared', approved: true, createdAt: '',
};
const invocationId = 'operation:counted-write@1';
const counter = join(root, 'external-effects.txt');
function durableWrite(path, value, append = false) {
  const fd = openSync(path, append ? 'a' : 'w');
  try { writeSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
}
function terminate(at) {
  if (phase !== at) return;
  durableWrite(join(root, 'termination-point.txt'), at + '\n');
  process.kill(process.pid, 'SIGKILL');
  throw new Error('SIGKILL did not terminate the owned worker');
}
function effectCount() {
  return existsSync(counter) ? readFileSync(counter, 'utf8').trim().split('\n').filter(Boolean).length : 0;
}

if (mode === 'crash') {
  const approval = ledger.issueApproval(operation, thread);
  store.internal('fixture.initialized', thread.id, () => {
    store.put('thread', thread.id, thread.id, thread);
    store.put('operation', operation.id, thread.id, operation);
    store.put('approval', approval.approvalId, thread.id, approval);
  });
  // These test-only wrappers stop inside the actual synchronous transaction.
  // No mock Store or alternate ledger replaces the production implementation.
  const put = store.put.bind(store);
  store.put = (kind, id, threadId, value) => {
    put(kind, id, threadId, value);
    if (kind === 'approval' && value.remainingUses === 0) terminate('approval-written');
    if (kind === 'toolEffect' && value.state === 'DISPATCHED') terminate('dispatched-record');
    if (kind === 'toolEffect' && value.state === 'SUCCEEDED') terminate('settlement-record');
  };
  __setEffectFaultHookForTests(at => {
    if (at === 'admission') terminate('admission');
    if (at === 'dispatch') terminate('prepared-record');
    if (at === 'settlement') terminate('settlement');
  });
  store.subscribe(event => {
    if (event.type === 'toolEffect.admitted') terminate('admission-commit');
    if (event.type === 'toolEffect.settled') terminate('settlement-commit');
  });
  ledger.verifyOperationApproval(operation, thread);
  const admitted = ledger.admitOperationDispatch(operation, thread,
    () => store.put('operation', operation.id, thread.id, { ...operation, status: 'running' }));
  if (admitted?.state !== 'DISPATCHED') throw new Error('Fixture was not admitted');
  terminate('before-external');
  durableWrite(counter, 'effect\n', true);
  terminate('external-committed');
  ledger.settle(invocationId, { value: { effects: 1 } }, 'SUCCEEDED');
  throw new Error('Selected crash point was not reached');
}

const before = ledger.get(invocationId);
const recovery = recoverEffects(store);
const after = ledger.get(invocationId);
let readmissionStarted = 0, readmissionState = null, readmissionError = null;
if (after) {
  try {
    readmissionState = ledger.admitOperationDispatch(operation, thread, () => { readmissionStarted++; })?.state ?? null;
  } catch (error) {
    readmissionError = error.code ?? String(error);
  }
}
const result = {
  beforeState: before?.state ?? null, state: after?.state ?? null,
  transitions: after?.transitions.map(item => item.to) ?? null,
  remainingUses: ledger.approvalFor(operation.id)?.remainingUses,
  externalEffects: effectCount(), readmissionStarted, readmissionState, readmissionError,
  uncertain: recovery.uncertain, sequence: store.sequence,
};
store.close();
process.stdout.write(JSON.stringify(result) + '\n');
