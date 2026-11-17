import {describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';

const owner = {threadId: 'thread-a', projectId: 'project-a', workspaceId: 'workspace-a'};
const common = {sourceId: 'source-a', sourceRevision: 'a'.repeat(64), logicalOwner: owner, contentDigest: 'a'.repeat(64), capturedAt: '2026-11-15T10:00:00.000Z'};
const message = {...common, kind: 'MESSAGE', range: {encoding: 'UTF16', start: 1, end: 3, selectedTextDigest: 'b'.repeat(64)}};
const ref = {captureId: 'capture-a', source: message, keepCaptured: false};

async function contract() {
  const loaded = await import('../packages/contracts/source-selection.ts').catch(() => null);
  expect(loaded, 'M15 strict source contracts must be implemented').not.toBeNull();
  return loaded!;
}

describe('SelectedSourceV1', () => {
  it('accepts only the four explicit source kinds and their range encodings', async () => {
    const {selectedSourceV1Schema} = await contract();
    for (const value of [message,
      {...common, kind: 'FILE_RANGE', path: 'src/a.ts', range: {encoding: 'LINES_1_BASED', startLine: 1, endLine: 2}},
      {...common, sourceId: 'a'.repeat(64), kind: 'DIFF_HUNK', path: 'src/a.ts', comparison: {kind: 'local', scope: 'worktree'}, range: {encoding: 'DIFF_LINES_1_BASED', startLine: 5, endLine: 8}},
      {...common, kind: 'ARTIFACT_REGION', binding: 'rows', range: {encoding: 'JSON_POINTER', pointer: '/0'}},
    ]) expect(selectedSourceV1Schema.safeParse(value).success).toBe(true);
    expect(selectedSourceV1Schema.safeParse({...message, kind: 'DOM'}).success).toBe(false);
  });

  it('rejects hidden authority fields, malformed digests and cross-kind range encodings', async () => {
    const {selectedSourceV1Schema} = await contract();
    for (const value of [
      {...message, grants: ['all']}, {...message, trusted: true}, {...message, contentDigest: 'current'},
      {...message, logicalOwner: {...owner, accountId: 'other'}},
      {...message, range: {encoding: 'LINES_1_BASED', startLine: 1, endLine: 2}},
      {...message, range: {...message.range, end: 1}},
      {...message, range: {...message.range, start: -1}},
      {...message, range: {...message.range, selectedTextDigest: undefined}},
      {...common, kind: 'FILE_RANGE', path: '../secret', range: {encoding: 'LINES_1_BASED', startLine: 0, endLine: 2}},
      {...common, kind: 'ARTIFACT_REGION', binding: 'rows', range: {encoding: 'JSON_POINTER', pointer: '/__proto__/secret'}},
    ]) expect(selectedSourceV1Schema.safeParse(value).success).toBe(false);
  });
});

describe('exact source selection from authorized read models', () => {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  async function validate() {
    const loaded = await import('../packages/core/source-workbench.ts');
    expect(loaded).toHaveProperty('validateSourceSelection'); return loaded.validateSourceSelection;
  }
  it('uses inclusive one-based file lines and refuses bytes or revisions from another read', async () => {
    const select = await validate(), text = 'one\ntwo\nthree\n';
    const observed = {text, sourceRevision: 'revision-one', contentDigest: sha(text)};
    const ref = {...common, sourceRevision: observed.sourceRevision, contentDigest: observed.contentDigest, kind: 'FILE_RANGE', range: {encoding: 'LINES_1_BASED', startLine: 2, endLine: 3}};
    expect(select(ref, observed)).toBe('two\nthree');
    expect(() => select({...ref, range: {...ref.range, endLine: 4}}, observed)).toThrowError(expect.objectContaining({code: 'INVALID_SOURCE_RANGE'}));
    expect(() => select(ref, {...observed, text: 'one\nforged\nthree\n'})).toThrowError(expect.objectContaining({code: 'STALE_SOURCE'}));
    expect(() => select(ref, {...observed, sourceRevision: 'revision-two'})).toThrowError(expect.objectContaining({code: 'STALE_SOURCE'}));
  });
  it('admits an entire exact diff hunk and rejects partial or spanning hunks', async () => {
    const select = await validate(), text = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n@@ -8 +8 @@\n-other\n+changed\n';
    const observed = {text, sourceRevision: 'comparison-revision', contentDigest: sha(text)};
    const source = {...common, sourceId: 'c'.repeat(64), sourceRevision: observed.sourceRevision, contentDigest: observed.contentDigest, kind: 'DIFF_HUNK', path: 'a', comparison: {kind: 'local', scope: 'worktree'}, range: {encoding: 'DIFF_LINES_1_BASED', startLine: 4, endLine: 6}};
    expect(select(source, observed)).toBe('@@ -1 +1 @@\n-old\n+new');
    for (const range of [{startLine: 5, endLine: 6}, {startLine: 4, endLine: 9}, {startLine: 4, endLine: 5}]) expect(() => select({...source, range: {...source.range, ...range}}, observed)).toThrow();
  });
  it('selects only declared JSON array entries while preserving ordinary object properties',async()=>{
    const select=await validate(),text='["declared row"]',observed={text,sourceRevision:'artifact-revision',contentDigest:sha(text)};
    const source={...common,sourceRevision:observed.sourceRevision,contentDigest:observed.contentDigest,kind:'ARTIFACT_REGION',binding:'rows',range:{encoding:'JSON_POINTER',pointer:'/0'}};
    expect(select(source,observed)).toBe('"declared row"');
    for(const pointer of ['/length','/01','/-1','/1'])expect(()=>select({...source,range:{...source.range,pointer}},observed)).toThrowError(expect.objectContaining({code:'INVALID_SOURCE_RANGE'}));
    const objectText='{"length":17}',objectObserved={text:objectText,sourceRevision:'object-revision',contentDigest:sha(objectText)};
    expect(select({...source,sourceRevision:objectObserved.sourceRevision,contentDigest:objectObserved.contentDigest,range:{...source.range,pointer:'/length'}},objectObserved)).toBe('17');
  });
});

describe('draft and presentation contracts', () => {
  it('retains the existing 100000-character unsent draft limit independently of send budgets', async () => {
    const {draftContextV1Schema} = await contract();
    expect(draftContextV1Schema.safeParse({draftId: 'draft-long', logicalOwner: owner, revision: 3, text: 'a'.repeat(100000), sourceRefs: [], sendMode: 'NOW', conflictState: 'NONE'}).success).toBe(true);
  });
  it('limits drafts to eight distinct source identities belonging to the same owner', async () => {
    const {draftContextV1Schema} = await contract();
    const draft = {draftId: 'draft-a', logicalOwner: owner, revision: 0, text: 'Explain this', sourceRefs: [ref], sendMode: 'NOW', conflictState: 'NONE'};
    expect(draftContextV1Schema.safeParse(draft).success).toBe(true);
    expect(draftContextV1Schema.safeParse({...draft, sourceRefs: [ref, ref]}).success).toBe(false);
    expect(draftContextV1Schema.safeParse({...draft, sourceRefs: Array.from({length: 9}, (_, index) => ({...ref, captureId: 'capture-' + index}))}).success).toBe(false);
    expect(draftContextV1Schema.safeParse({...draft, sourceRefs: [{...ref, source: {...message, logicalOwner: {...owner, workspaceId: 'other'}}}]}).success).toBe(false);
    expect(draftContextV1Schema.safeParse({...draft, sendMode: 'AUTOMATIC', conflictState: 'NONE'}).success).toBe(false);
    expect(draftContextV1Schema.safeParse({...draft, runId: 'forged-authority'}).success).toBe(false);
  });

  it('stores presentation with a local device identity and no canonical task facts', async () => {
    const {workbenchViewV1Schema} = await contract();
    const view = {logicalOwner: owner, revision: 1, viewType: 'SOURCES', selectedItem: 'capture-a', scrollAnchor: {itemId: 'message-a', offset: 12}, deviceId: 'device-a', updatedAt: common.capturedAt};
    expect(workbenchViewV1Schema.safeParse(view).success).toBe(true);
    expect(workbenchViewV1Schema.safeParse({...view, status: 'completed'}).success).toBe(false);
    expect(workbenchViewV1Schema.safeParse({...view, verified: true}).success).toBe(false);
    expect(workbenchViewV1Schema.safeParse({...view, panelGeometry: {x: 0, y: 0, width: 0, height: 0}}).success).toBe(false);
  });
});
