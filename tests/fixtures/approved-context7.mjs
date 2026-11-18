import { Service } from '../../packages/core/service.ts';
import { ownedContext7 } from './owned-context7.mjs';
import { testEffectAuthenticator } from './effect-authenticator.ts';

export const context7FixtureKey = 'context7_synthetic_approved_delivery_only';
export const context7FixtureRequest = { id: 'context7', action: 'call_tool', tool: 'owned_documentation', args: { topic: 'owned scope' } };
export async function approvedContext7(options = {}) {
  const x = await ownedContext7({ secretRefsEnabled: true, expectedCredential: context7FixtureKey, ownedExecutable: true, ...options });
  x.store.internal('fixture.ready', x.thread.id, () => x.store.put('thread', x.thread.id, x.thread.id,
    { ...x.thread, runId: null, status: 'ready', epoch: 0 }));
  const starts = [], runtime = { configure() {}, models: async () => [{ id: 'test/model', provider: 'test', name: 'Owned model' }],
    start: async input => { starts.push(input); }, followUp: async () => {}, cancel: async () => {},
    compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(x.store, runtime, {
    toolEffectFlags: options.toolEffectFlags ?? { 'audit.effectsV1': true, 'security.authorityV1': true },
    toolEffectAuthenticator: testEffectAuthenticator(),
    additionalTool: (call, ctx, host) => x.host.additionalTool(call, ctx, host),
    hostOperationExecutors: x.host.operationExecutors,
  });
  x.keep(() => service.dispose());
  const command = (type, payload = {}) => service.command({ id: crypto.randomUUID(), type, threadId: x.thread.id, payload });
  await command('message.send', { content: 'Prepare the explicitly requested Context7 action', modelId: 'test/model' });
  await service.deliverOutbox(x.thread.id);
  await x.host.configurePrivate({ context7ApiKey: context7FixtureKey });
  const run = starts[0], ctx = { threadId: x.thread.id, runId: run.runId, epoch: run.epoch };
  const prepare = (args = context7FixtureRequest) => service.tool({ name: 'integration_prepare', args }, ctx);
  const execute = async operation => {
    await command('operation.approve', { operationId: operation.id, revision: operation.revision });
    await service.dispatchOperation(operation.id).catch(() => {});
    return x.store.get('operation', operation.id);
  };
  return { ...x, service, run, ctx, command, prepare, execute };
}
