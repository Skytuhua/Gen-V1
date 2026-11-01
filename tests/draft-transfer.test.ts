import {beforeEach,expect,it,vi} from 'vitest';
import type {Snapshot} from '../packages/contracts/index.ts';
import type {JournalRecord} from '../apps/web/src/journal.ts';
const journal=vi.hoisted(()=>({entries:vi.fn(),read:vi.fn(),save:vi.fn()}));
vi.mock('../apps/web/src/journal',()=>({journalEntries:journal.entries,journalReadRecord:journal.read,journalCompareAndSwap:journal.save}));
vi.mock('../apps/web/src/signature-assets',()=>({hasPendingDocumentAssets:()=>false}));
import {exportDraftTransfer,importDraftTransfer} from '../apps/web/src/draft-transfer.ts';

const snapshot={threads:[],userStates:[],requests:[],skills:[{name:'verify-release',revision:3}]} as unknown as Snapshot;
const draft={content:'Keep this unfinished procedure.',description:'Verify a release.',baseRevision:3};
const entry=(key='skill-draft:verify-release',value:unknown=draft)=>({key,record:{value,generation:'browser-draft',updatedAt:1} satisfies JournalRecord});
const backup=(entries:ReturnType<typeof entry>[])=>JSON.stringify({app:'generative-harness-drafts',version:1,entries});
beforeEach(()=>{vi.clearAllMocks();journal.entries.mockResolvedValue([]);journal.read.mockResolvedValue(undefined);journal.save.mockResolvedValue(true);});

it('exports skill drafts, including stale drafts, without exporting unrelated journal state',async()=>{
 const rows=[entry(),entry('skill-draft:verify-release',{...draft,baseRevision:2}),entry('private:account-token','private')];journal.entries.mockResolvedValue(rows);
 expect(JSON.parse(await exportDraftTransfer(snapshot)).entries).toEqual(rows.slice(0,2));expect(journal.save).not.toHaveBeenCalled();
});
it('imports a compatible skill draft through the existing compare-and-swap journal',async()=>{
 expect(await importDraftTransfer(backup([entry()]),snapshot)).toEqual([{key:'skill-draft:verify-release',status:'imported'}]);
 expect(journal.save).toHaveBeenCalledWith('skill-draft:verify-release',undefined,draft);
});
it('blocks unknown skills, stale revisions and malformed skill drafts',async()=>{
 const cases=[entry('skill-draft:missing'),entry(undefined,{...draft,baseRevision:2}),entry(undefined,{...draft,baseRevision:-1}),entry(undefined,{...draft,baseRevision:3.5}),entry(undefined,{...draft,content:[]}),entry(undefined,{...draft,description:42})];
 for(const row of cases){const [result]=await importDraftTransfer(backup([row]),snapshot);expect(result.status).toBe('blocked');}
 expect(journal.save).not.toHaveBeenCalled();
});
it('retains local skill drafts and edits arriving during import',async()=>{
 journal.read.mockResolvedValueOnce({value:{...draft,content:'New local edit.'},generation:'new',updatedAt:2});
 expect((await importDraftTransfer(backup([entry()]),snapshot))[0].status).toBe('retained');expect(journal.save).not.toHaveBeenCalled();
 journal.save.mockResolvedValueOnce(false);expect((await importDraftTransfer(backup([entry()]),snapshot))[0]).toMatchObject({status:'retained',reason:'A local edit arrived during import'});
});
