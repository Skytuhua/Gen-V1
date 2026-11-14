import {expect, it, vi} from 'vitest';
import {settleSettingsOperations, settingsOperation} from '../apps/web/src/settings-operations';

it('holds handoff through the write and its accepted metadata refresh', async () => {
 let write!: () => void, refresh!: () => void;
 const first = new Promise<void>(resolve => {write = resolve;}), second = new Promise<void>(resolve => {refresh = resolve;});
 const action = settingsOperation(async () => {await first; await second;});
 const done = vi.fn(); const handoff = settleSettingsOperations().then(done);
 await Promise.resolve(); expect(done).not.toHaveBeenCalled();
 write(); await Promise.resolve(); expect(done).not.toHaveBeenCalled();
 refresh(); await action; await handoff; expect(done).toHaveBeenCalledOnce();
});

it('waits through a failed write for the rest of the batch and still settles', async () => {
 let reject!: (cause: Error) => void, release!: () => void;
 const failing = settingsOperation(() => new Promise<void>((_, fail) => {reject = fail;}));
 const surviving = new Promise<void>(resolve => {release = resolve;}), trailing = settingsOperation(() => surviving);
 const actionResult = expect(failing).rejects.toThrow('Save failed');
 const handoffResult = settleSettingsOperations();
 let settled = false; void handoffResult.then(() => {settled = true;});
 reject(Error('Save failed')); await Promise.resolve(); await Promise.resolve();
 expect(settled).toBe(false);
 release(); await Promise.all([actionResult, trailing]); await expect(handoffResult).resolves.toBeUndefined();
 await expect(settleSettingsOperations()).resolves.toBeUndefined();
});
