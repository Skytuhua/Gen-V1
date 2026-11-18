const { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } = await import('node:fs');
const { join } = await import('node:path');
const { Store } = await import('../../packages/storage/store.ts');
const { buildToolRegistry, ToolAuthority } = await import('../../packages/core/tool-authority.ts');
const { __setEffectFaultHookForTests, createToolEffectFlags, ToolEffectLedger } = await import('../../packages/core/tool-effects.ts');
const { recoverEffects } = await import('../../packages/core/effect-recovery.ts');
const { createEffectAuthenticator } = await import('../../packages/core/host-effect-authenticator.ts');
const { randomBytes, randomUUID } = await import('node:crypto');

const [mode, root, phase] = process.argv.slice(2);
if (!root || !['crash', 'recover'].includes(mode)) throw new Error('Expected mode and owned fixture root');
const store = new Store(join(root, 'state'));
// Authenticated mode signs issued approvals, so this worker owns a signer exactly
// as the product host does when key custody is enabled. The crash and recovery
// runs are separate processes, so the fixture keeps one key in its own root:
// otherwise recovery refuses for a key mismatch instead of the durable state
// under test.
function effectSigner() {
  const path = join(root, 'effect-signer.json');
  if (existsSync(path)) {
    const { keyId, key } = JSON.parse(readFileSync(path, 'utf8'));
    return createEffectAuthenticator(Buffer.from(key, 'hex'), keyId);
  }
  const keyId = randomUUID(), key = randomBytes(32);
  durableWrite(path, JSON.stringify({ keyId, key: key.toString('hex') }));
  return createEffectAuthenticator(key, keyId);
}
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
function pauseAt(at) {
  if (phase !== at) return;
  const pending = join(root, 'termination-point.tmp');
  durableWrite(pending, at + '\n');
  // Publish the marker only after fsync. The supervisor owns the kill handle;
  // this synchronous pause can stop inside an open SQLite transaction.
  renameSync(pending, join(root, 'termination-point.txt'));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error('Crash worker unexpectedly resumed its durability pause');
}
function effectCount() {
  return existsSync(counter) ? readFileSync(counter, 'utf8').trim().split('\n').filter(Boolean).length : 0;
}

const ledger = new ToolEffectLedger(store, new ToolAuthority(buildToolRegistry()),
  createToolEffectFlags({ 'audit.effectsV1': true, 'security.authorityV1': true }), effectSigner());

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
    if (kind === 'approval' && value.remainingUses === 0) pauseAt('approval-written');
    if (kind === 'toolEffect' && value.state === 'DISPATCHED') pauseAt('dispatched-record');
    if (kind === 'toolEffect' && value.state === 'SUCCEEDED') pauseAt('settlement-record');
  };
  __setEffectFaultHookForTests(at => {
    if (at === 'admission') pauseAt('admission');
    if (at === 'dispatch') pauseAt('prepared-record');
    if (at === 'settlement') pauseAt('settlement');
  });
  store.subscribe(event => {
    if (event.type === 'toolEffect.admitted') pauseAt('admission-commit');
    if (event.type === 'toolEffect.settled') pauseAt('settlement-commit');
  });
  ledger.verifyOperationApproval(operation, thread);
  const admitted = ledger.admitOperationDispatch(operation, thread,
    () => store.put('operation', operation.id, thread.id, { ...operation, status: 'running' }));
  if (admitted?.state !== 'DISPATCHED') throw new Error('Fixture was not admitted');
  pauseAt('before-external');
  durableWrite(counter, 'effect\n', true);
  pauseAt('external-committed');
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
// Reported so the durability assertions can also prove the recovered grant is
// still the one the killed process signed, not an unsigned substitute.
const recoveredApproval = ledger.approvalFor(operation.id);
let approvalAuthenticated = false;
if (recoveredApproval?.hostAuthenticator) {
  const signer = effectSigner(), { hostAuthenticator, ...fields } = recoveredApproval;
  approvalAuthenticated = hostAuthenticator.keyId === signer.keyId && signer.verify('grant', fields, hostAuthenticator.tag);
}
const result = {
  approvalAuthenticated,
  beforeState: before?.state ?? null, state: after?.state ?? null,
  transitions: after?.transitions.map(item => item.to) ?? null,
  remainingUses: ledger.approvalFor(operation.id)?.remainingUses,
  externalEffects: effectCount(), readmissionStarted, readmissionState, readmissionError,
  uncertain: recovery.uncertain, sequence: store.sequence,
};
store.close();
process.stdout.write(JSON.stringify(result) + '\n');
