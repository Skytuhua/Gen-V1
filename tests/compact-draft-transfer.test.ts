import {beforeEach, expect, it, vi} from 'vitest';
import type {DraftTransferReferences} from '../packages/contracts/shell-read-models';
const journal = vi.hoisted(() => ({entries: vi.fn(), read: vi.fn(), save: vi.fn(), pending: vi.fn()}));
vi.mock('../apps/web/src/journal', () => ({journalEntries: journal.entries, journalReadRecord: journal.read, journalCompareAndSwap: journal.save}));
vi.mock('../apps/web/src/signature-assets', () => ({hasPendingDocumentAssets: journal.pending}));
import {exportDraftTransfer, importDraftTransfer} from '../apps/web/src/draft-transfer';
const entry = (key: string, value: unknown) => ({key, record: {value, generation: 'browser', updatedAt: 1}});
const backup = (entries: ReturnType<typeof entry>[]) => JSON.stringify({app: 'generative-harness-drafts', version: 1, entries});
const refs = (): DraftTransferReferences => ({threads: [{id: 'with-draft'}, {id: 'signature-only'}], skills: [{name: 'saved', revision: 4}], userStates: [{id: 'state', revision: 2}], requests: [{id: 'request', revision: 3, responseSchema: {type: 'string'}}]});
beforeEach(() => {vi.clearAllMocks(); journal.pending.mockReturnValue(false); journal.entries.mockResolvedValue([]); journal.read.mockResolvedValue(undefined); journal.save.mockResolvedValue(true);});
it('checks every visible Personal thread for pending signatures, even without a transferable journal key', async () => {
  journal.entries.mockResolvedValue([entry('draft:with-draft', 'draft')]); journal.pending.mockImplementation(id => id === 'signature-only');
  const source = vi.fn(async () => refs());
  await expect(exportDraftTransfer(source)).rejects.toThrow(/pending signature/);
  expect(source).toHaveBeenCalledWith(['draft:with-draft']); expect(journal.save).not.toHaveBeenCalled();
});
it('requests only bounded transferable keys, batches at 500 and never sends local draft values', async () => {
  journal.entries.mockResolvedValue([...Array.from({length: 501}, (_, i) => entry('draft:t' + i, 'private local text')), entry('private:token', 'secret')]);
  const source = vi.fn(async (_keys: string[]) => refs());
  await exportDraftTransfer(source);
  expect(source.mock.calls.map(([keys]) => keys.length)).toEqual([500, 1]);
  expect(JSON.stringify(source.mock.calls)).not.toMatch(/private|secret|local text/);
});
it('blocks exact request-key/schema and state/skill revision mismatches and retains local/CAS edits', async () => {
  const source = vi.fn(async () => refs());
  const entries = [entry('request:request:2', {schema: JSON.stringify({type: 'string'}), response: 'local'}), entry('request:request:3', {schema: '{}', response: 'local'}), entry('state:state', {baseRevision: 1, values: {local: true}}), entry('skill-draft:saved', {baseRevision: 3, content: 'local', description: 'local'})];
  expect((await importDraftTransfer(backup(entries), source)).every(row => row.status === 'blocked')).toBe(true);
  expect(journal.save).not.toHaveBeenCalled();
  const good = entry('draft:with-draft', 'preserve'); journal.read.mockResolvedValueOnce({value: 'newer'});
  expect((await importDraftTransfer(backup([good]), source))[0].status).toBe('retained');
  journal.save.mockResolvedValueOnce(false); expect((await importDraftTransfer(backup([good]), source))[0].status).toBe('retained');
});
it('validates backups before requesting references and aborts before writing', async () => {
  const source = vi.fn(async () => refs());
  await expect(importDraftTransfer(backup([entry('draft:new', 'one'), entry('draft:new', 'two')]), source)).rejects.toThrow(/duplicate/);
  expect(source).not.toHaveBeenCalled();
  const controller = new AbortController(); const aborting = async () => {controller.abort(); return refs();};
  await expect(importDraftTransfer(backup([entry('draft:new', 'one')]), aborting, controller.signal)).rejects.toThrow();
  expect(journal.save).not.toHaveBeenCalled();
});
it('imports compatible text, planning decisions, state and skill drafts with the original keys and CAS', async () => {
  const current = refs(); current.requests[0].presentation = true;
  const rows = [entry('draft:new', 'new text'), entry('thinking:with-draft', 'thinking text'), entry('request:request:planning', {schema: JSON.stringify({type: 'string'}), response: 'local decision'}), entry('state:state', {baseRevision: 2, values: {local: true}}), entry('skill-draft:saved', {baseRevision: 4, content: 'local skill', description: 'description'})];
  const source = vi.fn(async () => current);
  expect((await importDraftTransfer(backup(rows), source)).map(row => row.status)).toEqual(rows.map(() => 'imported'));
  expect(source).toHaveBeenCalledWith(rows.map(row => row.key));
  rows.forEach(row => expect(journal.save).toHaveBeenCalledWith(row.key, undefined, row.record.value));
});
it('still checks pending signatures when the journal contains no transferable draft keys', async () => {
  journal.pending.mockImplementation(id => id === 'signature-only'); const source = vi.fn(async () => refs());
  await expect(exportDraftTransfer(source)).rejects.toThrow(/pending signature/); expect(source).toHaveBeenCalledWith([]);
});
