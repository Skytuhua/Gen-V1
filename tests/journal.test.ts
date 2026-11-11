import {afterEach, expect, it, vi} from 'vitest';
import type {JournalRecord} from '../apps/web/src/journal';

afterEach(() => {vi.unstubAllGlobals(); vi.resetModules();});

function fakeOpenRequest(record: JournalRecord<string>) {
 const get = vi.fn(() => {
  const request: {result: JournalRecord<string>; onsuccess?: () => void} = {result: record};
  queueMicrotask(() => request.onsuccess?.());
  return request;
 });
 const objectStore = vi.fn(() => ({get}));
 const transaction = vi.fn(() => ({objectStore}));
 const request: {result: {transaction: typeof transaction}; onsuccess?: () => void} = {result: {transaction}};
 return {request, transaction, objectStore, get};
}

it('retries a synchronous IndexedDB open failure on the same journal module', async () => {
 const failure = new Error('IndexedDB temporarily unavailable');
 const record = {value: 'recovered draft', updatedAt: 1, generation: 'draft-generation'};
 const db = fakeOpenRequest(record);
 const open = vi.fn().mockImplementationOnce(() => {throw failure;}).mockReturnValue(db.request);
 vi.stubGlobal('indexedDB', {open});
 const {journalReadRecord} = await import('../apps/web/src/journal');

 await expect(journalReadRecord('draft:example')).rejects.toBe(failure);
 const retry = journalReadRecord<string>('draft:example');
 db.request.onsuccess?.();
 await expect(retry).resolves.toEqual(record);
 expect(open).toHaveBeenCalledTimes(2);
 expect(open).toHaveBeenLastCalledWith('generative-harness-journal', 1);
 expect(db.transaction).toHaveBeenCalledWith('entries');
 expect(db.objectStore).toHaveBeenCalledWith('entries');
 expect(db.get).toHaveBeenCalledWith('draft:example');
});

it('retries an asynchronous IndexedDB open failure on the same journal module', async () => {
 const failure = new Error('IndexedDB open failed');
 const failedRequest: {error: Error; onerror?: () => void} = {error: failure};
 const record = {value: 'recovered draft', updatedAt: 1, generation: 'draft-generation'};
 const db = fakeOpenRequest(record);
 const open = vi.fn().mockReturnValueOnce(failedRequest).mockReturnValue(db.request);
 vi.stubGlobal('indexedDB', {open});
 const {journalReadRecord} = await import('../apps/web/src/journal');

 const failedRead = expect(journalReadRecord('draft:example')).rejects.toBe(failure);
 failedRequest.onerror?.();
 await failedRead;
 const retry = journalReadRecord<string>('draft:example');
 db.request.onsuccess?.();
 await expect(retry).resolves.toEqual(record);
 expect(open).toHaveBeenCalledTimes(2);
});

it('shares an in-flight open and retains a successful database for later reads', async () => {
 const record = {value: 'saved draft', updatedAt: 1, generation: 'draft-generation'};
 const db = fakeOpenRequest(record);
 const open = vi.fn().mockReturnValue(db.request);
 vi.stubGlobal('indexedDB', {open});
 const {journalReadRecord} = await import('../apps/web/src/journal');

 const first = journalReadRecord<string>('draft:first');
 const second = journalReadRecord<string>('draft:second');
 expect(open).toHaveBeenCalledTimes(1);
 db.request.onsuccess?.();
 await expect(Promise.all([first, second])).resolves.toEqual([record, record]);
 await expect(journalReadRecord<string>('draft:third')).resolves.toEqual(record);
 expect(open).toHaveBeenCalledTimes(1);
 expect(db.get.mock.calls).toEqual([['draft:first'], ['draft:second'], ['draft:third']]);
});
