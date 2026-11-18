import { afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/storage/store.ts';
import { createIntegrationHost } from '../../apps/server/integration-host.ts';
import { integrationIds } from '../../packages/integrations/manifest.ts';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** Owned MCP subprocess only. It performs no network or model work and records
 * credential delivery as a boolean, never as a value or value-derived hash. */
export async function ownedContext7(options = {}) {
  const { expectedCredential, ownedExecutable, holdCall, echoCredential, ...hostOptions } = options;
  const root = await mkdtemp(join(tmpdir(), 'm03-owned-context7-'));
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const bundle = join(root, 'bundle'), project = join(root, 'project'), marker = join(root, 'child-starts.jsonl'), callsMarker = join(root, 'tool-calls.jsonl');
  const executable = ownedExecutable ? join(root, process.platform === 'win32' ? 'owned-node.exe' : 'owned-node') : process.execPath;
  if (ownedExecutable) await copyFile(process.execPath, executable, constants.COPYFILE_FICLONE);
  await mkdir(project);
  const entry = 'third-party/integrations/context7/owned-fixture.cjs';
  const script = [
    "const fs = require('node:fs'), { createInterface } = require('node:readline');",
    'fs.appendFileSync(' + JSON.stringify(marker) + ", JSON.stringify({ credential: Boolean(process.env.CONTEXT7_API_KEY)" + (expectedCredential === undefined ? '' : ', credentialMatched: process.env.CONTEXT7_API_KEY === ' + JSON.stringify(expectedCredential)) + " }) + '\\n');",
    "createInterface({ input: process.stdin }).on('line', line => {",
    '  const request = JSON.parse(line); if (request.id === undefined) return;',
    '  let result;',
    "  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'owned-context7', version: '1.0.0' } };",
    "  else if (request.method === 'ping') result = {};",
    "  else if (request.method === 'tools/list') result = { tools: [{ name: 'owned_documentation', description: 'Owned public documentation', inputSchema: { type: 'object', properties: { topic: { type: 'string' } } } }] };",
    "  else if (request.method === 'tools/call') { fs.appendFileSync(" + JSON.stringify(callsMarker) + ", JSON.stringify({ name: request.params.name, pid: process.pid }) + '\\n'); " + (holdCall ? 'return;' : "result = { content: [{ type: 'text', text: " + (echoCredential ? 'process.env.CONTEXT7_API_KEY' : "'Owned public documentation result'") + ' }], isError: false };') + ' }',
    "  else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown owned fixture method' } }) + '\\n'); return; }",
    "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');",
    '});',
  ].join('\n');
  await mkdir(join(bundle, 'third-party/integrations/context7'), { recursive: true });
  await writeFile(join(bundle, entry), script);
  await mkdir(join(bundle, 'node_modules/m03-owned-context7'), { recursive: true });
  await writeFile(join(bundle, 'node_modules/m03-owned-context7/package.json'), JSON.stringify({ name: 'm03-owned-context7', version: '1.0.0' }));
  const integrations = integrationIds.map(id => ({
    id, name: id, version: 'owned-fixture', license: ['UNLICENSED'],
    upstream: { repository: 'https://example.invalid/owned-context7', pin: 'owned-fixture' },
    files: id === 'context7' ? [{ path: entry, bytes: Buffer.byteLength(script), sha256: createHash('sha256').update(script).digest('hex'), source: 'owned-test-fixture' }] : [],
    skills: [], capabilities: { skills: [], mcp: id === 'context7', hooks: [], commands: [] },
    ...(id === 'context7' ? { runtime: { kind: 'node', entry, args: [], package: 'm03-owned-context7', version: '1.0.0' } } : {}),
  }));
  await writeFile(join(bundle, 'third-party/integrations/manifest.json'), JSON.stringify({ version: 1,
    createdAt: new Date().toISOString(), integrations, bytes: Buffer.byteLength(script) }));
  const store = new Store(join(root, 'state'));
  cleanups.push(async () => store.close());
  const stamp = new Date().toISOString();
  const thread = { id: 'owner', title: 'Owned integration fixture', projectName: 'owned', projectId: 'project',
    createdAt: stamp, updatedAt: stamp, status: 'working', epoch: 2, runId: 'owned-run',
    modelId: 'test/model', accountId: null, sessionPath: null };
  store.internal('fixture', null, () => {
    store.put('thread', thread.id, thread.id, thread);
    store.put('workspaceProject', 'project', null, { id: 'project', name: 'Owned integration fixture', authority: { kind: 'local' }, rootPath: project, createdAt: stamp });
  });
  const host = createIntegrationHost({ store, root: bundle, nodeExecutable: executable,
    runtime: { refreshIntegrations: async () => {} }, ...hostOptions });
  cleanups.push(() => host.close());
  const records = async path => {
    try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  return { root, bundle, project, executable, entry, marker, store, host, thread, starts: () => records(marker), calls: () => records(callsMarker), keep: close => cleanups.push(close),
    ctx: { threadId: thread.id, runId: thread.runId, epoch: thread.epoch },
    scope: { authority: { kind: 'local' }, threadId: thread.id } };
}
