import type {Page, Route} from '@playwright/test';
import {describe, expect, it} from 'vitest';
import type {HostCommand} from '../packages/contracts';
import type {PanelBinding} from '../packages/contracts/workspace';
import type {SplitWorkspaceLayout} from '../packages/contracts/split-workspace';
import {serveTaskSplitLayout, taskFixture} from './e2e/task-interface-fixture';

async function fixture() {
  const snapshot = taskFixture({root: 'text', elements: {text: {type: 'Text', props: {text: 'Synthetic owner'}}}});
  snapshot.threads[0].projectId = 'before';
  const routes = new Map<string, (route: Route) => unknown>();
  const page = {route: async (pattern: string, handler: (route: Route) => unknown) => { routes.set(pattern, handler); }} as unknown as Page;
  await serveTaskSplitLayout(page, snapshot);
  const invoke = async (path: string, command?: HostCommand) => {
    let response: unknown;
    const route = {request: () => ({postDataJSON: () => command}), fulfill: async ({json}: {json: unknown}) => { response = structuredClone(json); }} as unknown as Route;
    await routes.get(path)!(route);
    return response;
  };
  const read = () => invoke('**/api/split-workspace?workspaceId=workspace') as Promise<SplitWorkspaceLayout>;
  const send = async (type: string, payload: Record<string, unknown>) => {
    const layout = await read();
    return invoke('**/api/split-workspace/commands', {id: 'fixture-command', type, payload: {workspaceId: layout.id, baseRevision: layout.revision, ...payload}} as HostCommand);
  };
  const binding: PanelBinding = {authority: {kind: 'local'}, projectId: 'before', threadId: 'task-thread', agentId: 'agent', artifactId: 'artifact', resourceId: 'resource', terminalId: 'terminal', browserId: 'browser', liveProject: false};
  await send('split-workspace.view.open', {view: {id: 'rich-owner', kind: 'thread', binding}});
  snapshot.threads[0].projectId = 'after';
  return {read, send, binding};
}

describe('shared task fixture host reconciliation', () => {
  it('accepts reordered exact binding keys and updates only canonical local conversation views', async () => {
    const host = await fixture();
    await host.send('split-workspace.view.open', {view: {id: 'other-owner', kind: 'thread', binding: {authority: {kind: 'local'}, threadId: 'other-thread', projectId: 'other-project'}}});
    const before = await host.read();
    const expectedBinding = Object.fromEntries(Object.entries(host.binding).reverse());
    await host.send('split-workspace.thread.reconcile', {viewId: 'rich-owner', expectedBinding, projectId: 'after'});
    const after = await host.read();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.views['rich-owner'].binding).toEqual({...host.binding, projectId: 'after'});
    expect(after.views['thread:task-thread'].binding.projectId).toBe('after');
    expect(after.views['other-owner']).toEqual(before.views['other-owner']);
  });

  it.each(['projectId', 'threadId', 'agentId', 'artifactId', 'resourceId', 'terminalId', 'browserId', 'liveProject'] as const)('rejects a changed captured %s without mutating the layout', async key => {
    const host = await fixture(), before = await host.read();
    const expectedBinding = {...host.binding, [key]: key === 'liveProject' ? true : 'changed'};
    await expect(host.send('split-workspace.thread.reconcile', {viewId: 'rich-owner', expectedBinding, projectId: 'after'})).rejects.toThrow('captured conversation owner binding changed');
    expect(await host.read()).toEqual(before);
  });

  it.each(['omitted', 'undefined', 'plugin', 'unknown-key'] as const)('rejects %s captured binding identity without mutating the layout', async variant => {
    const host = await fixture(), before = await host.read();
    const expectedBinding: Record<string, unknown> = {...host.binding};
    if (variant === 'omitted') delete expectedBinding.liveProject;
    if (variant === 'undefined') expectedBinding.liveProject = undefined;
    if (variant === 'plugin') expectedBinding.authority = {kind: 'plugin', pluginId: 'fixture-plugin', scopeId: 'fixture-scope'};
    if (variant === 'unknown-key') expectedBinding.extra = 'untrusted';
    await expect(host.send('split-workspace.thread.reconcile', {viewId: 'rich-owner', expectedBinding, projectId: 'after'})).rejects.toThrow();
    expect(await host.read()).toEqual(before);
  });

  it('distinguishes an absent optional field from a present undefined field', async () => {
    const host = await fixture(), before = await host.read();
    const expectedBinding = {...before.views['thread:task-thread'].binding, liveProject: undefined};
    await expect(host.send('split-workspace.thread.reconcile', {viewId: 'thread:task-thread', expectedBinding, projectId: 'after'})).rejects.toThrow('captured conversation owner binding changed');
    expect(await host.read()).toEqual(before);
  });

  it.each([{workspaceId: 'foreign'}, {baseRevision: -1}, {projectId: 'not-canonical'}, {viewId: 'missing'}, {extra: true}])('retains workspace, revision, target and canonical-project checks: %j', async change => {
    const host = await fixture(), before = await host.read();
    await expect(host.send('split-workspace.thread.reconcile', {viewId: 'rich-owner', expectedBinding: host.binding, projectId: 'after', ...change})).rejects.toThrow();
    expect(await host.read()).toEqual(before);
  });
});
