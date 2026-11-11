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

it('rejects a waiting handoff when the write fails and allows a later recovery', async () => {
 let reject!: (cause: Error) => void;
 const action = settingsOperation(() => new Promise<void>((_, fail) => {reject = fail;}));
 const actionResult = expect(action).rejects.toThrow('Save failed');
 const handoffResult = expect(settleSettingsOperations()).rejects.toThrow('Save failed');
 reject(Error('Save failed')); await Promise.all([actionResult, handoffResult]);
 await expect(settleSettingsOperations()).resolves.toBeUndefined();
});
