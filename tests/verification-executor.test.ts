import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectTrustLedger } from '../packages/core/project-trust.ts';
import { SecretReferenceLedger } from '../packages/core/secret-references.ts';
import { digestFileSha256 } from '../packages/core/execution-policy.ts';
import { createVerificationExecutorFactory, type VerificationExecutorSession } from '../packages/core/verification-executor.ts';
import type { ObservedVerificationBackend, VerificationExecutorHostConfig, ManagedVerificationBrowserDriver } from '../packages/core/verification-executor-binding.ts';
import type { LaunchedProcess } from '../packages/core/project-verification.ts';
import type { BrowserSession } from '../packages/core/browser-verification.ts';
import type { ExecutionProfileV1 } from '../packages/contracts/execution-profile.ts';

const dirs: string[] = [], sessions: VerificationExecutorSession[] = [];
afterEach(async () => { await Promise.allSettled(sessions.splice(0).map(session => session.close())); dirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); vi.restoreAllMocks(); });
async function fixture({ secret = '', browser = false, readiness = false, setup }: { secret?: string; browser?: boolean; readiness?: boolean; setup?: (backend: ObservedVerificationBackend, controller: AbortController) => void } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'verification-session-')); dirs.push(root);
  const executable = join(root, 'tool'); writeFileSync(executable, 'test-only observed tool');
  const sha256 = await digestFileSha256(executable), trust = new ProjectTrustLedger(), secrets = new SecretReferenceLedger();
  const origin = 'http://127.0.0.1:8123';
  await trust.decide({ trustId: 'trust', rootPath: root, approvedFiles: [{ path: 'tool', kind: 'executable' }], scope: { read: true, write: false, network: browser || readiness ? 'allowlist' : 'none' }, decision: 'trusted' });
  const owner = { threadId: 'thread', runId: 'run', epoch: 1, projectId: 'project', workspaceId: null, accountBinding: 'account' };
  const raw: LaunchedProcess = { pid: 42, wait: vi.fn(async () => ({ exitCode: 0, termination: 'NONE' as const })), tree: vi.fn(async () => []), log: vi.fn(async () => ({ text: `result ${secret}`, truncated: false })), terminate: vi.fn(async () => {}) };
  const browserSession: BrowserSession = { page: { url: () => origin, goto: vi.fn(async () => {}), click: vi.fn(async () => {}), type: vi.fn(async () => {}), text: vi.fn(async () => 'Ready'), visible: vi.fn(async () => true), screenshot: vi.fn(async () => Buffer.from('not a screenshot proof')) }, collectedFailures: () => ({ console: [], network: [] }), observedOrigins: () => [origin], close: vi.fn(async () => {}) };
  const driver = { profileDir: join(tmpdir(), 'backend-owned-test-profile'), launch: vi.fn(async () => browserSession), close: vi.fn(async () => {}) };
  const backend: ObservedVerificationBackend = { backendId: 'unit-test-backend', platform: process.platform, installed: true, approved: true,
    proof: { platformProofRef: 'unit-test-proof', platform: process.platform, status: 'PASS', recordedAt: '2026-11-17T00:00:00.000Z', evidenceRef: 'test-double-not-native-evidence' },
    launch: vi.fn(), launchObserved: vi.fn(async request => { request.assertCurrent(); return raw; }), probeListener: vi.fn(async () => ({ reachable: true, ownerPid: 42 })), ...(browser ? { openBrowserDriver: vi.fn(async () => driver) } : {}) };
  const profile: ExecutionProfileV1 = { profileId: 'workspace-check', version: 1, backendId: backend.backendId, capabilities: ['process.execute', 'fs.read'], readRoots: [root], writeRoots: [], networkPolicy: browser || readiness ? { mode: 'allowlist', origins: [origin] } : { mode: 'none' }, secretRefs: secret ? ['test-token'] : [], executableAllowlist: [{ executableSha256: sha256, argv: ['test'] }], platformProofRef: 'unit-test-proof' };
  const resolver = vi.fn(async () => secret);
  if (secret) secrets.register({ version: 1, refId: 'test-token', purpose: 'unit test', owner: 'account', destination: { kind: 'process-env', executableSha256: sha256, envName: 'TEST_TOKEN' } }, resolver);
  const config: VerificationExecutorHostConfig = { approvedBackendId: backend.backendId, backends: [backend], profiles: [{ profile, trustId: 'trust', projectId: 'project', workspaceId: null, accountBinding: 'account' }],
    executables: [{ id: 'test-tool', path: executable }], trust, secrets, environment: { LANG: 'C' }, flags: { HARNESS_FLAG_VERIFICATION_WORKFLOW_V1: '1', HARNESS_FLAG_SECURITY_EXECUTION_PROFILES_V1: '1', HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1: '1', HARNESS_FLAG_SECURITY_SECRET_REFS_V1: '1' } };
  const controller = new AbortController(), assertCurrent = vi.fn(), factory = createVerificationExecutorFactory(config);
  setup?.(backend, controller);
  const binding = await factory.describe({ owner, rootPath: root, profileId: profile.profileId, executableIds: ['test-tool'], approvedOrigins: browser || readiness ? [origin] : [], browserRequired: browser, signal: controller.signal, assertCurrent });
  const session = await factory.open({ owner, binding, executionId: 'execution', signal: controller.signal, assertCurrent }); sessions.push(session);
  const request = { executableId: 'test-tool', argv: ['test'], cwd: root, envRefs: secret ? ['test-token'] : [], timeoutMs: 1_000 };
  return { root, executable, origin, owner, backend, driver, browserSession, raw, profile, config, trust, secrets, resolver, controller, assertCurrent, session, request, binding };
}

it('launches only the approved observed backend with an explicit child environment and physical witnesses', async () => {
  const f = await fixture(), process = await f.session.launcher.launch(f.request);
  expect(await process.wait()).toEqual({ exitCode: 0, termination: 'NONE' });
  expect(f.backend.launch).not.toHaveBeenCalled();
  expect(f.backend.launchObserved).toHaveBeenCalledWith(expect.objectContaining({ environment: { LANG: 'C' }, argv: ['test'], cwd: f.root, rootIdentities: [expect.objectContaining({ canonicalPath: f.root })], executableIdentity: expect.objectContaining({ dev: expect.any(String), ino: expect.any(String) }) }));
  await f.session.close(); await f.session.close(); expect(f.raw.terminate).toHaveBeenCalledOnce();
});

it.each(['argv', 'cwd', 'secret', 'executable', 'limit'] as const)('rejects changed %s before launch', async kind => {
  const f = await fixture(), request = { ...f.request };
  if (kind === 'argv') request.argv = ['other'];
  if (kind === 'cwd') request.cwd = tmpdir();
  if (kind === 'secret') request.envRefs = ['caller-token'];
  if (kind === 'executable') request.executableId = '/usr/bin/caller-tool';
  if (kind === 'limit') request.timeoutMs = Infinity;
  await expect(f.session.launcher.launch(request)).rejects.toThrow();
  expect(f.backend.launchObserved).not.toHaveBeenCalled();
});

it('resolves secrets only after dispatch and redacts raw and encoded output', async () => {
  const secret = 'executor-secret-token', f = await fixture({ secret });
  expect(f.resolver).not.toHaveBeenCalled();
  vi.mocked(f.raw.log).mockResolvedValue({ text: `${secret} ${Buffer.from(secret).toString('base64')}`, truncated: false });
  const process = await f.session.launcher.launch(f.request), output = await process.log();
  expect(f.resolver).toHaveBeenCalledOnce(); expect(output.text).toBe('[REDACTED] [REDACTED]');
  expect(JSON.stringify(f.binding)).not.toContain(secret);
});

it('withholds logs for short injected secrets instead of claiming unsupported redaction', async () => {
  const f = await fixture({ secret: '1234' }), process = await f.session.launcher.launch(f.request);
  const output = await process.log(); expect(output.truncated).toBe(true); expect(output.text).not.toContain('1234');
});

it('does not disclose resolver or backend exception text', async () => {
  const f = await fixture({ secret: 'sensitive-resolver-value' });
  f.resolver.mockRejectedValueOnce(Error('sensitive-resolver-value'));
  await expect(f.session.launcher.launch(f.request)).rejects.toThrow('The approved verification backend operation failed.');
  expect(f.backend.launchObserved).not.toHaveBeenCalled();
});

it('rechecks revocation after a delayed secret resolution and never launches', async () => {
  const f = await fixture({ secret: 'pending-secret-token' });
  f.resolver.mockImplementationOnce(async () => { f.trust.revoke('trust'); return 'pending-secret-token'; });
  await expect(f.session.launcher.launch(f.request)).rejects.toThrow(/authority|trust/i);
  expect(f.backend.launchObserved).not.toHaveBeenCalled();
});

it('kills a process handle that arrives after cancellation and closes the session', async () => {
  const f = await fixture(); let finish!: (process: LaunchedProcess) => void;
  vi.mocked(f.backend.launchObserved).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const launched = f.session.launcher.launch(f.request);
  await vi.waitFor(() => expect(f.backend.launchObserved).toHaveBeenCalledOnce());
  f.controller.abort(); finish(f.raw);
  await expect(launched).rejects.toThrow(/cancelled/); await f.session.close();
  expect(f.raw.terminate).toHaveBeenCalledOnce();
});

it('enforces the process deadline even when the backend wait never returns', async () => {
  const f = await fixture(); vi.mocked(f.raw.wait).mockImplementationOnce(() => new Promise(() => {}));
  const process = await f.session.launcher.launch({ ...f.request, timeoutMs: 10 });
  expect(await process.wait()).toEqual({ exitCode: null, termination: 'TIMEOUT' });
  await f.session.close(); expect(f.raw.terminate).toHaveBeenCalledOnce();
});

it('bounds native launch startup and cleans a handle that arrives after the deadline', async () => {
  const f = await fixture(); let finish!: (process: LaunchedProcess) => void;
  vi.mocked(f.backend.launchObserved).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const launched = f.session.launcher.launch({ ...f.request, timeoutMs: 10 }).then(() => 'STARTED', error => String(error.code));
  await vi.waitFor(() => expect(f.backend.launchObserved).toHaveBeenCalledOnce());
  const result = await Promise.race([launched, new Promise<string>(resolve => setTimeout(() => resolve('OBSERVATION_DEADLINE'), 30))]);
  finish(f.raw); await launched; await f.session.close();
  expect(result).toBe('EXECUTION_TIMEOUT'); expect(f.raw.terminate).toHaveBeenCalledOnce();
});

it('admits readiness-only origins without requiring a browser backend', async () => {
  const f = await fixture({ readiness: true });
  expect(f.session.browser).toBeNull(); expect(f.session.browserProfileDir).toBeNull();
  expect(await f.session.probe.probe({ host: '127.0.0.1', port: 8123, path: '/ready' })).toEqual({ reachable: true, ownerPid: 42 });
  await expect(f.session.probe.probe({ host: '127.0.0.1', port: 8124, path: '/ready' })).rejects.toThrow(/endpoint/);
});

it('retains cleanup failure instead of certifying successful teardown', async () => {
  const f = await fixture(); vi.mocked(f.raw.terminate).mockRejectedValue(Error('native cleanup failed'));
  const process = await f.session.launcher.launch(f.request); await process.wait();
  await expect(f.session.close()).rejects.toThrow('Verification cleanup failed.');
});

it('uses the backend-owned browser profile, enforces origin fences and closes each session once', async () => {
  const f = await fixture({ browser: true });
  const options = { profileDir: f.session.browserProfileDir!, viewport: { width: 800, height: 600 }, approvedOrigins: [f.origin], allowOrigin: () => true };
  await expect(f.session.browser!.launch({ ...options, profileDir: f.root })).rejects.toThrow(/profile/);
  expect(f.driver.launch).not.toHaveBeenCalled();
  const browser = await f.session.browser!.launch(options);
  expect(browser.page.url()).toBe(f.origin); expect(browser.collectedFailures()).toEqual({ console: [], network: [] });
  await expect(browser.page.goto('https://outside.example/')).rejects.toThrow();
  expect(f.browserSession.page.goto).not.toHaveBeenCalled();
  await browser.page.goto(f.origin); await browser.close(); await f.session.close();
  expect(f.browserSession.close).toHaveBeenCalledOnce(); expect(f.driver.close).toHaveBeenCalledOnce();
  expect(f.profile.writeRoots).toEqual([]);
});

it('closes a browser driver created after cancellation while opening the session', async () => {
  let finish!: () => void, controller!: AbortController, driver!: ManagedVerificationBrowserDriver;
  const pending = fixture({ browser: true, setup(backend, signal) {
    controller = signal;
    const create = backend.openBrowserDriver!;
    backend.openBrowserDriver = async scope => { driver = await create(scope); await new Promise<void>(resolve => { finish = resolve; }); return driver; };
  } });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  controller.abort(); finish();
  await expect(pending).rejects.toThrow(/cancelled/);
  expect(driver.close).toHaveBeenCalledOnce();
});

it('redacts injected secrets from browser observations and rejects non-origin evidence', async () => {
  const secret = 'browser-secret-token', f = await fixture({ browser: true, secret });
  await f.session.launcher.launch(f.request);
  f.browserSession.page.url = () => `${f.origin}/?token=${secret}`;
  f.browserSession.collectedFailures = () => ({ console: [`value=${secret}`], network: [Buffer.from(secret).toString('base64')] });
  const browser = await f.session.browser!.launch({ profileDir: f.session.browserProfileDir!, viewport: { width: 800, height: 600 }, approvedOrigins: [f.origin], allowOrigin: () => true });
  expect(browser.page.url()).toBe(`${f.origin}/?token=[REDACTED]`);
  expect(browser.collectedFailures()).toEqual({ console: ['value=[REDACTED]'], network: ['[REDACTED]'] });
  f.browserSession.observedOrigins = () => [`${f.origin}/?token=${secret}`];
  expect(() => browser.observedOrigins()).toThrow('invalid observation evidence');
  f.browserSession.page.url = () => { throw Error(secret); };
  expect(() => browser.page.url()).toThrow('invalid observation evidence');
});
