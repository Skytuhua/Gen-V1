import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { ProjectTools } from '../packages/workspace/tools.ts';
import { TerminalHost } from '../packages/workspace/terminal.ts';
import { createIntegrationHost } from '../apps/server/integration-host.ts';
import { registerWorkspaceHost } from '../apps/server/workspace-host.ts';
import { buildServer } from '../apps/server/server.ts';
import type { RuntimeAdapter } from '../packages/contracts';
import type { IntegrationSecretReferenceStatus } from '../packages/contracts/integration-secrets.ts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });
async function fixture(options: { unbound?: boolean; response?: unknown } = {}) {
  vi.stubEnv('HARNESS_FLAG_SECURITY_SECRET_REFS_V1', '0');
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'gen-secret-metadata-http-'));
  const store = new Store(root);
  const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {},
    cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime), projects = new ProjectTools(store), terminals = new TerminalHost(projects);
  const integrations = createIntegrationHost({ store, workspace: projects.workspace, secretRefsEnabled: false, runtime: { refreshIntegrations: async () => {} } });
  registerWorkspaceHost(service, { projects, terminals, integrations: integrations.manager,
    ...(!options.unbound ? { secretReferences: options.response === undefined ? () => integrations.secretReferences()
      : async () => options.response as IntegrationSecretReferenceStatus } : {}) });
  const app = await buildServer(service, { port: 4317, dev: false });
  cleanup.push(async () => {
    await app.close(); await service.dispose(); await integrations.close(); await terminals.dispose(); await projects.dispose(); store.close();
    if (await realpath(root) !== resolve(root) || !root.startsWith(base + sep) || (await lstat(root)).isSymbolicLink()) throw Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const boot = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } });
  const headers = { host: '127.0.0.1:4317', cookie: String(boot.headers['set-cookie']).split(';')[0]! };
  return { app, store, integrations, headers, url: '/api/integrations/secret-references' };
}

it('returns actual default-off metadata without changing the Store or creating an operation', async () => {
  const f = await fixture(), sequence = f.store.sequence;
  const response = await f.app.inject({ url: f.url, headers: f.headers });
  expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toEqual({ version: 1, enabled: false, configured: false, references: [] });
  expect(f.store.sequence).toBe(sequence); expect(f.store.all('operation')).toEqual([]);
});

it('exposes configured status without the credential or a credential digest', async () => {
  const f = await fixture(), secret = 'synthetic-context7-http-credential-18';
  await f.integrations.configurePrivate({ context7ApiKey: secret });
  const sequence = f.store.sequence, response = await f.app.inject({ url: f.url, headers: f.headers });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ version: 1, enabled: false, configured: true, references: [] });
  expect(response.body).not.toContain(secret);
  expect(response.body).not.toContain(createHash('sha256').update(secret).digest('hex'));
  expect(f.store.sequence).toBe(sequence); expect(f.store.all('operation')).toEqual([]);
});

it('rejects reveal parameters and malformed host output without exposing the invalid material', async () => {
  const f = await fixture({ response: { version: 1, enabled: false, configured: true, references: [], secretValue: 'synthetic-invalid-material' } });
  const query = await f.app.inject({ url: f.url + '?reveal=true', headers: f.headers });
  expect(query.statusCode).toBe(400); expect(query.json().error.code).toBe('INVALID_INPUT');
  const response = await f.app.inject({ url: f.url, headers: f.headers });
  expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('INTEGRATION_UNAVAILABLE');
  expect(response.body).not.toContain('synthetic-invalid-material'); expect(response.body).not.toContain('secretValue');
});

it('uses a generic unavailable reason even if an internal producer returns sensitive diagnostics', async () => {
  const f = await fixture({ response: { version: 1, enabled: true, configured: true, references: [], unavailableReason: 'synthetic-private-diagnostic' } });
  const response = await f.app.inject({ url: f.url, headers: f.headers });
  expect(response.statusCode).toBe(200);
  expect(response.json().unavailableReason).toBe('Secret reference metadata is unavailable.');
  expect(response.body).not.toContain('synthetic-private-diagnostic');
});

it('does not invent unconfigured metadata when the host has no reference reader', async () => {
  const f = await fixture({ unbound: true }), response = await f.app.inject({ url: f.url, headers: f.headers });
  expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('INTEGRATION_UNAVAILABLE');
});

it('requires the real authenticated session before reading reference metadata', async () => {
  const f = await fixture(), sequence = f.store.sequence;
  const response = await f.app.inject({ url: f.url, headers: { host: f.headers.host } });
  expect(response.statusCode).toBe(401); expect(f.store.sequence).toBe(sequence);
});
