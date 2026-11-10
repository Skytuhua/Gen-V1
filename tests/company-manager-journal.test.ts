import {afterEach, expect, it, vi} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../packages/storage/store.ts';
import {CompanyManagerJournal} from '../packages/company-manager/journal.ts';
import {CompanyManagerError, type CompanyManagerDraft} from '../packages/company-manager/contracts.ts';
const owned: {store: Store; dir: string}[] = [];
afterEach(async () => {for (const item of owned.splice(0)) {item.store.close(); await rm(item.dir, {recursive: true, force: true});}});
const input = {requestId: 'request-1', projectId: 'alpha', instruction: 'Plan a bounded fix.'};
function draft(): CompanyManagerDraft {return {id: 'draft-1', kind: 'local_manager_draft', state: 'unsubmitted', authority: 'proposal_only', evidenceScope: 'local_manager_output', requestId: input.requestId, projectId: input.projectId, dispatchAuthorized: false, companyReceipt: null, permitId: 'permit-1', policyRevision: 'mandate-1', sourceRefs: [], createdAt: 100, digest: 'a'.repeat(64), content: {summary: 'Inspect first', interpretation: 'Draft a plan only.', assumptions: [], blockers: [], tasks: [{id: 'a', title: 'Inspect', instructions: 'Read approved evidence.', dependsOn: [], proposedEmployeeId: null, sourceRefs: [], deliverable: 'research', requiredEvidence: ['Review the exact input.']}]}};}
async function setup(manager = {propose: vi.fn(async () => draft()), cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {})}) {
  const dir = await mkdtemp(join(tmpdir(), 'company-manager-journal-')), store = new Store(dir); owned.push({dir, store});
  return {store, manager, journal: new CompanyManagerJournal(store, manager)};
}
it('stores only local draft interaction state and coalesces exact owner retries', async () => {
  const {journal, manager, store} = await setup();
  const first = await journal.propose(input), again = await journal.propose({...input});
  expect(first).toEqual(again); expect(first).toMatchObject({status: 'draft_ready', scope: 'local_ui_interaction', companyReceipt: null});
  expect(manager.propose).toHaveBeenCalledTimes(1);
  expect(store.all('task')).toEqual([]); expect(store.all('operation')).toEqual([]);
  await expect(journal.propose({...input, instruction: 'Different request under reused ID'})).rejects.toMatchObject({code: 'COMPANY_MANAGER_INPUT'});
  expect(() => journal.get('beta', input.requestId)).toThrow();
});
it('retains pending work when the owner stops waiting and recovers it by exact scope', async () => {
  let finish!: (value: CompanyManagerDraft) => void;
  const manager = {propose: vi.fn(() => new Promise<CompanyManagerDraft>(done => {finish = done;})), cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {})};
  const {journal} = await setup(manager), pending = journal.propose(input);
  expect(journal.get('alpha', input.requestId)?.status).toBe('pending');
  finish(draft()); await pending;
  expect(journal.get('alpha', input.requestId)?.status).toBe('draft_ready'); expect(manager.cancel).not.toHaveBeenCalled();
});
it('marks interrupted prior-process interactions uncertain and never replays inference', async () => {
  const {store, manager} = await setup();
  store.internal('fixture.pending', null, () => store.put('companyManagerInteraction', input.requestId, null, {id: input.requestId, projectId: 'alpha', input, status: 'pending', scope: 'local_ui_interaction', companyReceipt: null, createdAt: 1, updatedAt: 1}));
  const journal = new CompanyManagerJournal(store, manager);
  expect(journal.get('alpha', input.requestId)?.status).toBe('uncertain');
  expect((await journal.propose(input)).status).toBe('uncertain'); expect(manager.propose).not.toHaveBeenCalled();
});
it('retains uncertain cleanup and never turns raw failures into public diagnostics', async () => {
  const manager = {propose: vi.fn(async () => {throw new CompanyManagerError('COMPANY_MANAGER_CLEANUP');}), cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {})};
  const {journal} = await setup(manager);
  expect(await journal.propose(input)).toMatchObject({status: 'uncertain', errorCode: 'COMPANY_MANAGER_CLEANUP'});
  const other = await setup({propose: vi.fn(async () => {throw new Error('private-token-and-profile-path');}), cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {})});
  const failed = await other.journal.propose(input); expect(failed.status).toBe('failed'); expect(JSON.stringify(failed)).not.toContain('private-token');
});
it('waits for confirmed planning cancellation and fences a late successful draft', async () => {
  let finish!: (value: CompanyManagerDraft) => void, stopped!: () => void;
  const manager = {propose: vi.fn(() => new Promise<CompanyManagerDraft>(done => {finish = done;})), cancel: vi.fn(() => new Promise<void>(done => {stopped = done;})), dispose: vi.fn(async () => {})};
  const {journal} = await setup(manager), pending = journal.propose(input);
  const cancel = journal.cancel('alpha', input.requestId); finish(draft());
  await Promise.resolve(); expect(journal.get('alpha', input.requestId)?.status).toBe('stop_requested');
  stopped(); await cancel; await pending;
  expect(journal.get('alpha', input.requestId)?.status).toBe('cancelled');
  expect(journal.get('alpha', input.requestId)).not.toHaveProperty('draft');
});
it('fences new proposals during shutdown and waits for the last journal write before disposal completes', async () => {
  let finish!: (value: CompanyManagerDraft) => void;
  const manager = {propose: vi.fn(() => new Promise<CompanyManagerDraft>(done => {finish = done;})), cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {})};
  const {journal} = await setup(manager), pending = journal.propose(input);
  let closed = false;
  const disposal = journal.dispose().then(() => {closed = true;});
  await vi.waitFor(() => expect(manager.dispose).toHaveBeenCalledOnce());
  expect(closed).toBe(false);
  await expect(journal.propose({...input, requestId: 'after-stop'})).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
  finish(draft()); await pending; await disposal;
  expect(journal.get('alpha', input.requestId)?.status).toBe('cancelled');
  expect(journal.get('alpha', input.requestId)).not.toHaveProperty('draft');
  await journal.dispose(); expect(manager.dispose).toHaveBeenCalledOnce();
});
it('keeps failed shutdown explicit rather than reporting teardown as complete', async () => {
  const manager = {propose: vi.fn(async () => draft()), cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {throw new Error('private cleanup detail');})};
  const {journal} = await setup(manager);
  await expect(journal.dispose()).rejects.toMatchObject({code: 'COMPANY_MANAGER_CLEANUP'});
  await expect(journal.dispose()).rejects.toMatchObject({code: 'COMPANY_MANAGER_CLEANUP'});
  expect(manager.dispose).toHaveBeenCalledOnce();
  await expect(journal.propose(input)).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
});
it('does not overwrite terminal cancellation when an already-resolved proposal races disposal', async () => {
  const {journal} = await setup();
  const pending = journal.propose(input), closing = journal.dispose();
  await pending; await closing;
  expect(journal.get('alpha', input.requestId)?.status).toBe('cancelled');
});
