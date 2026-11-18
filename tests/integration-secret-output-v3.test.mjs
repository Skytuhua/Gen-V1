const { afterEach, describe, expect, it } = await import('vitest');
const { createHash } = await import('node:crypto');
const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { Store } = await import('../packages/storage/store.ts');
const { createIntegrationHost } = await import('../apps/server/integration-host.ts');
const { integrationIds } = await import('../packages/integrations/manifest.ts');

const syntheticToken = 'context7_fixture/only+synthetic=20261117';
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(leakDescription = false) {
  const root = await mkdtemp(join(tmpdir(), 'm03-mcp-output-'));
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const bundle = join(root, 'bundle'), project = join(root, 'project');
  await mkdir(project);
  const entry = 'third-party/integrations/context7/owned-fixture.cjs';
  // An owned JSON-RPC subprocess exercises the real MCP stdio client. This is
  // not the upstream Context7 service and it performs no network or model work.
  const script = [
    "const { createInterface } = require('node:readline');",
    "const token = process.env.CONTEXT7_API_KEY;",
    "if (!token) throw Error('Owned fixture did not receive its scoped token');",
    "const leakDescription = " + JSON.stringify(leakDescription) + ";",
    "const encode = value => value === 'public' ? 'Public documentation' : value === 'percent' ? encodeURIComponent(token) : value === 'base64' ? Buffer.from(token).toString('base64') : value === 'ansi' ? token.slice(0, 9) + String.fromCharCode(27) + '[31m' + token.slice(9) : token;",
    "createInterface({ input: process.stdin }).on('line', line => {",
    "  const request = JSON.parse(line);",
    "  if (request.id === undefined) return;",
    "  let result;",
    "  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'owned-secret-fixture', version: '1.0.0' } };",
    "  else if (request.method === 'ping') result = {};",
    "  else if (request.method === 'tools/list') result = { tools: [{ name: 'fixture_documentation', description: leakDescription ? 'Documentation ' + token : 'Public documentation tool', inputSchema: { type: 'object', properties: { encoding: { type: 'string' } } } }] };",
    "  else if (request.method === 'tools/call') { const value = encode(request.params.arguments.encoding); result = { content: [{ type: 'text', text: 'Public prefix\\n' + value + '\\nPublic suffix' }], structuredContent: { nested: [{ value }], public: 'metadata' }, isError: false }; }",
    "  else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Owned fixture method unavailable' } }) + '\\n'); return; }",
    "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');",
    "});",
  ].join('\n');
  await mkdir(join(bundle, 'third-party/integrations/context7'), { recursive: true });
  await writeFile(join(bundle, entry), script);
  await mkdir(join(bundle, 'node_modules/m03-owned-mcp-fixture'), { recursive: true });
  await writeFile(join(bundle, 'node_modules/m03-owned-mcp-fixture/package.json'),
    JSON.stringify({ name: 'm03-owned-mcp-fixture', version: '1.0.0' }));
  const definitions = integrationIds.map(id => ({
    id, name: id, version: 'owned-fixture', license: ['UNLICENSED'],
    upstream: { repository: 'https://example.invalid/owned-fixture', pin: 'owned-fixture' },
    files: id === 'context7' ? [{ path: entry, bytes: Buffer.byteLength(script),
      sha256: createHash('sha256').update(script).digest('hex'), source: 'owned-test-fixture' }] : [],
    skills: [], capabilities: { skills: [], mcp: id === 'context7', hooks: [], commands: [] },
    ...(id === 'context7' ? { runtime: { kind: 'node', entry, args: [],
      package: 'm03-owned-mcp-fixture', version: '1.0.0' } } : {}),
  }));
  await writeFile(join(bundle, 'third-party/integrations/manifest.json'),
    JSON.stringify({ version: 1, createdAt: new Date().toISOString(),
      integrations: definitions, bytes: Buffer.byteLength(script) }));
  const store = new Store(join(root, 'state'));
  cleanups.push(async () => store.close());
  const stamp = new Date().toISOString();
  const thread = { id: 'owner', title: 'Owned fixture', projectName: 'fixture', projectId: 'project',
    createdAt: stamp, updatedAt: stamp, status: 'working', epoch: 3, runId: 'active-run',
    modelId: 'openai/test', accountId: null, sessionPath: null };
  store.internal('fixture', null, () => {
    store.put('thread', thread.id, thread.id, thread);
    store.put('workspaceProject', 'project', null, { id: 'project', name: 'Owned fixture',
      authority: { kind: 'local' }, rootPath: project, createdAt: stamp });
  });
  const host = createIntegrationHost({ store, root: bundle, nodeExecutable: process.execPath,
    runtime: { refreshIntegrations: async () => {} } });
  cleanups.push(() => host.close());
  await host.configurePrivate({ context7ApiKey: syntheticToken });
  const ctx = { threadId: thread.id, runId: thread.runId, epoch: thread.epoch };
  return {
    list: () => host.additionalTool({ name: 'integration_list', args: { id: 'context7' } }, ctx),
    call: encoding => host.additionalTool({ name: 'integration_call',
      args: { id: 'context7', tool: 'fixture_documentation', args: { encoding } } }, ctx),
  };
}

describe('M03 private integration credentials at the model output boundary', () => {
  it.each(['raw', 'percent', 'base64', 'ansi'])
    ('redacts a known %s key from actual MCP text and structured results', async encoding => {
      const owned = await fixture();
      const result = await owned.call(encoding);
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Public prefix\n[REDACTED]\nPublic suffix' }],
        structuredContent: { nested: [{ value: '[REDACTED]' }], public: 'metadata' },
        isError: false,
      });
    });

  it('redacts a known key from tool metadata returned to the model', async () => {
    const owned = await fixture(true);
    const result = await owned.list();
    expect(result.tools).toEqual([{
      name: 'fixture_documentation', description: 'Documentation [REDACTED]',
      inputSchema: { type: 'object', properties: { encoding: { type: 'string' } } },
    }]);
  });

  it('preserves ordinary MCP results and public tool metadata', async () => {
    const owned = await fixture();
    expect(await owned.call('public')).toEqual({
      content: [{ type: 'text', text: 'Public prefix\nPublic documentation\nPublic suffix' }],
      structuredContent: { nested: [{ value: 'Public documentation' }], public: 'metadata' },
      isError: false,
    });
    const result = await owned.list();
    expect(result.tools[0].description).toBe('Public documentation tool');
  });
});
