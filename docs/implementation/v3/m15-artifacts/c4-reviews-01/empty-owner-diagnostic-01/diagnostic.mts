import {writeFileSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const repo = '/workspace/scratch/1b47eb428672/m15-v3';
const output = '/workspace/scratch/1b47eb428672/m15-publication/c4/empty-owner-diagnostic-01';
const owner = {threadId: 'empty-thread', projectId: 'empty-project', workspaceId: 'empty-copy'};
const sourceKey = 'source-context:empty-thread:empty-project:empty-copy';
const keys = [sourceKey, 'draft:empty-thread', 'agents-pending:empty-thread'];
const events: {event: string; key?: string; reads?: number}[] = [];
let sourceReads = 0, allReads = 0;
const sentinel = Error('Empty-owner handoff exceeded 64 asynchronous source reads without settling.');
Object.defineProperty(globalThis, 'window', {value: undefined, configurable: true});
Object.defineProperty(globalThis, 'localStorage', {value: {getItem: () => null, setItem: () => {throw Error('Unexpected staging write');}, removeItem: () => {throw Error('Unexpected staging removal');}}, configurable: true});
const database = {transaction: (_store: string, mode?: string) => {
  if (mode === 'readwrite') throw Error('Unexpected write transaction');
  return {objectStore: () => ({get: (key: string) => {
    allReads++; if (key === sourceKey) sourceReads++;
    const count = sourceReads;
    events.push({event: 'read-start', key, reads: count});
    const request: {result?: unknown; error?: Error; onsuccess?: () => void; onerror?: () => void} = {};
    setImmediate(() => {
      if (key === sourceKey && count > 64) {request.error = sentinel; events.push({event: 'read-sentinel', key, reads: count}); request.onerror?.();}
      else {events.push({event: 'read-empty', key, reads: count}); request.onsuccess?.();}
    });
    return request;
  }})};
}};
Object.defineProperty(globalThis, 'indexedDB', {value: {open: () => {
  const request: {result: typeof database; onsuccess?: () => void} = {result: database};
  setImmediate(() => request.onsuccess?.()); return request;
}}, configurable: true});
const journal = await import(repo + '/apps/web/src/journal.ts');
const recovery = await import(repo + '/apps/web/src/workbench-recovery.ts');
const registry = await import(repo + '/apps/web/src/editor-handoff.ts');
const initial = await Promise.all(keys.map(key => journal.journalReadRecord(key)));
if (initial.some(value => value !== undefined)) throw Error('The fixture must have no durable or staged record.');
const removals = ['App', 'SourceWorkbench'].map(name => registry.registerEditorHandoff(name, async () => {
  events.push({event: name + '-start'});
  await recovery.prepareSourceOwnerHandoff(owner);
  events.push({event: name + '-ready'});
}));
const outcome = await registry.prepareEditorHandoff().then(() => ({status: 'READY'}), (cause: unknown) => ({status: 'REJECTED', message: cause instanceof Error ? cause.message : String(cause), sentinel: cause === sentinel}));
removals.forEach(remove => remove());
const files = ['apps/web/src/journal.ts', 'apps/web/src/workbench-recovery.ts', 'apps/web/src/editor-handoff.ts', 'apps/web/src/App.tsx', 'apps/web/src/SourceWorkbench.tsx', 'tests/source-handoff-v3.test.ts'];
const source = Object.fromEntries(files.map(path => [path, createHash('sha256').update(readFileSync(repo + '/' + path)).digest('hex')]));
const result = {scope: 'Actual journal/recovery/editor registry; scripted empty IndexedDB requests delivered by setImmediate; no React, browser, native, or host execution.', owner, outcome, allReads, sourceReads, sources: source, finalMetadata: journal.journalHandoffState(keys).map(({failure, ...state}: {failure?:{cause?:unknown};[key:string]:unknown}) => ({...state, ...(failure ? {failure: String(failure.cause)} : {})})), events};
writeFileSync(output + '/results.json', JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({outcome, allReads, sourceReads, source, started: events.filter(value => value.event.endsWith('-start') && !value.key).map(value => value.event), ready: events.filter(value => value.event.endsWith('-ready')).map(value => value.event)}));
if (outcome.status !== 'READY') throw Error('Both healthy empty-owner guards must settle: ' + JSON.stringify(outcome));
