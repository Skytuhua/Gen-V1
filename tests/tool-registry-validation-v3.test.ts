import { describe, expect, it } from 'vitest';
import { ToolAuthority, authorize, buildToolRegistry, type RegistryEntry } from '../packages/core/tool-authority.ts';

const owner = { threadId: 'thread', runId: 'run', epoch: 1, projectId: null, workspaceId: null, accountBinding: null };
const current = { runId: 'run', epoch: 1, projectId: null, workspaceId: null, accountId: null };

describe('M02 S02 host registry admission', () => {
  it.each([
    ['unknown effect risk', { risk: 'UNCLASSIFIED' }],
    ['unknown replay class', { replayClass: 'MAGIC_RETRY' }],
    ['unsupported role alongside an allowed role', { allowedRoles: ['run', 'plugin_admin'] }],
    ['empty role allowlist', { allowedRoles: [] }],
    ['unknown executor binding', { executorBinding: 'plugin-native' }],
    ['unknown approval policy', { approval: 'annotation' }],
    ['external write without an approval path', { risk: 'NETWORK_WRITE', executorBinding: 'network', approval: 'none' }],
    ['empty tool identifier', { id: '' }],
    ['empty schema commitment', { schemaDigest: '' }],
    ['unexpected authority field', { allowEverything: true }],
  ])('rejects %s before the definition becomes executable', (_name, patch) => {
    const read = buildToolRegistry().find(entry => entry.id === 'repository_read')!;
    // Deliberately malformed host input must be checked at the runtime boundary.
    const registry = [{ ...read, ...patch }] as unknown as RegistryEntry[];
    expect(() => new ToolAuthority(registry)).toThrow();
  });

  it('retains every supported host definition and its read authorization', () => {
    const registry = buildToolRegistry(), authority = new ToolAuthority(registry);
    expect(authority.list()).toEqual(registry);
    expect(authorize(authority.require('repository_read'), 'run', owner, current)).toEqual({ kind: 'ALLOW' });
  });

  it('retains explicit approval for a classified external write', () => {
    const authority = new ToolAuthority(buildToolRegistry());
    expect(authorize(authority.require('integration_call'), 'run', owner, current))
      .toEqual({ kind: 'REQUIRE_APPROVAL', reason: 'approval_required' });
  });

  it('retains duplicate identifier rejection', () => {
    const read = buildToolRegistry().find(entry => entry.id === 'repository_read')!;
    expect(() => new ToolAuthority([read, read])).toThrowError(expect.objectContaining({ code: 'REGISTRY_CONFLICT' }));
  });
});
