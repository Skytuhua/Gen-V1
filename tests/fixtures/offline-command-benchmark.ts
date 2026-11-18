import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { HarnessError, type CommandReceipt, type HostCommand, type RuntimeAdapter, type Thread } from '../../packages/contracts/index.ts';
import { Service } from '../../packages/core/service.ts';
import { Store } from '../../packages/storage/store.ts';

type Attempt = { status: 'accepted'; command: HostCommand; receipt: CommandReceipt }
  | { status: 'rejected'; command: HostCommand; code: string; message: string };
export async function offlineCommandFixture(directory: string) {
  const store = new Store(join(directory, 'store')), runtimeCalls: string[] = [];
  const unexpected = async () => { runtimeCalls.push('unexpected-runtime-operation'); throw new Error('This offline command fixture must not invoke a model runtime'); };
  const runtime: RuntimeAdapter = {
    configure() {}, models: async () => { runtimeCalls.push('models'); return []; },
    start: unexpected, followUp: unexpected, cancel: unexpected, compact: unexpected,
    history: async () => { await unexpected(); return []; }, dispose: async () => {},
  };
  const service = new Service(store, runtime);
  try {
    const created = await service.command({ id: randomUUID(), type: 'thread.create', payload: { title: 'Offline command benchmark' } });
    const thread = created.result as Thread;
    let inputBytes = 0, outputBytes = 0, accepted = 0, rejected = 0;
    return {
      store, service, thread, runtimeCalls,
      resetMeasurements() { inputBytes = 0; outputBytes = 0; accepted = 0; rejected = 0; },
      measurements: () => ({ inputBytes, outputBytes, accepted, rejected }),
      async attempt(type: string, payload: Record<string, unknown>): Promise<Attempt> {
        const command: HostCommand = { id: randomUUID(), type, threadId: thread.id, payload };
        inputBytes += Buffer.byteLength(JSON.stringify(command));
        try {
          const receipt = await service.command(command); accepted++;
          outputBytes += Buffer.byteLength(JSON.stringify(receipt));
          return { status: 'accepted', command, receipt };
        } catch (error) {
          if (!(error instanceof HarnessError)) throw error;
          rejected++;
          outputBytes += Buffer.byteLength(JSON.stringify({ error: { code: error.code, message: error.message, details: error.details } }));
          return { status: 'rejected', command, code: error.code, message: error.message };
        }
      },
      async close() { try { await service.dispose(); } finally { store.close(); } },
    };
  } catch (error) { await service.dispose(); store.close(); throw error; }
}
