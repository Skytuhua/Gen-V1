import { evaluateExecution } from './execution-policy.ts';
import { createSecretRedactor, type SecretApproval } from './secret-references.ts';
import type { BrowserDriver, BrowserSession } from './browser-verification.ts';
import { BROWSER_STEP_TIMEOUT_MS } from '../contracts/verification.ts';
import type { LaunchedProcess, ListenerProbe, VerificationLauncher } from './project-verification.ts';
import {
  assertExecutionFence, createVerificationBindingAuthority, executorDenied,
  type DescribeVerificationExecutor, type VerificationExecutionFence,
  type VerificationExecutorBinding, type VerificationExecutorHostConfig, type ManagedVerificationBrowserDriver,
} from './verification-executor-binding.ts';
export type { VerificationExecutorBinding, VerificationExecutorHostConfig } from './verification-executor-binding.ts';

export interface VerificationExecutorSession {
  readonly launcher: VerificationLauncher;
  readonly probe: ListenerProbe;
  readonly browser: BrowserDriver | null;
  readonly browserProfileDir: string | null;
  close(): Promise<void>;
}
export interface OpenVerificationExecutor extends VerificationExecutionFence {
  readonly executionId: string;
  readonly binding: VerificationExecutorBinding;
}
export interface VerificationExecutorFactory {
  describe(input: DescribeVerificationExecutor): Promise<VerificationExecutorBinding>;
  /** Non-consuming read-side fence. It never launches or resolves secrets. */
  assertCurrent(binding: VerificationExecutorBinding, fence: VerificationExecutionFence): void;
  /** Service calls only after durable M02 dispatch and exact approval consumption. */
  open(input: OpenVerificationExecutor): Promise<VerificationExecutorSession>;
}
const MAX_LOG_BYTES = 1024 * 1024;
const CLEANUP_TIMEOUT_MS = 10_000;
async function backendCall<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch { throw executorDenied('VERIFICATION_BACKEND_FAILED', 'The approved verification backend operation failed.'); }
}
async function untilAbort<T>(operation: Promise<T>, signal: AbortSignal, failure: () => Error): Promise<T> {
  let aborted: () => void = () => {};
  try {
    const cancelled = new Promise<never>((_, reject) => { aborted = () => reject(failure()); signal.addEventListener('abort', aborted, { once: true }); });
    if (signal.aborted) aborted();
    return await Promise.race([operation, cancelled]);
  } finally { signal.removeEventListener('abort', aborted); }
}
async function boundedCleanup(action: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([action, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(executorDenied('CLEANUP_FAILED', 'Verification cleanup did not finish within its deadline.')), CLEANUP_TIMEOUT_MS); })]);
  } finally { clearTimeout(timer); }
}

/** Host-composed adapter. There is deliberately no child_process or browser
 * launch fallback: only the operator-selected observed M03 backend can run. */
export function createVerificationExecutorFactory(config: VerificationExecutorHostConfig): VerificationExecutorFactory {
  const authority = createVerificationBindingAuthority(config);
  return {
    describe: authority.describe,
    assertCurrent: authority.assertCurrent,
    async open(input) {
      assertExecutionFence(input);
      if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(input.executionId)) throw executorDenied('INVALID_INPUT', 'Verification execution identity is invalid.');
      const stop = new AbortController();
      const signal = AbortSignal.any([input.signal, stop.signal]);
      const fence = { ...input, signal };
      const admitted = await authority.take(input.binding, fence);
      const processes = new Set<LaunchedProcess>(), browsers = new Set<BrowserSession>(), pending = new Set<Promise<unknown>>();
      const lateCleanupFailures: unknown[] = [];
      const secretValues = new Set<string>();
      let driver: ManagedVerificationBrowserDriver | undefined, closing: Promise<void> | undefined;
      const active = () => { assertExecutionFence(fence); admitted.assertCurrent(); };
      const track = <T>(task: Promise<T>): Promise<T> => {
        pending.add(task);
        void task.finally(() => pending.delete(task)).catch(() => {});
        return task;
      };
      const takePendingHandle = async <T>(creation: Promise<T>, actionSignal: AbortSignal, dispose: (value: T) => Promise<void>, failure: () => Error): Promise<T> => {
        track(creation);
        try { return await untilAbort(creation, actionSignal, failure); }
        catch (error) {
          // Native creation can finish after the caller stops waiting. Keep
          // ownership of the eventual handle until its cleanup also settles.
          void track(creation.then(value => boundedCleanup(backendCall(() => dispose(value))).catch(cleanupFailure => { lateCleanupFailures.push(cleanupFailure); }))).catch(() => {});
          throw error;
        }
      };
      const redactLog = (text: string) => {
        if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_LOG_BYTES) throw executorDenied('RESOURCE_LIMIT', 'Verification log exceeds the bounded read limit.');
        if ([...secretValues].some(value => value.length < 8)) return '[Log withheld because an injected secret is outside the supported redaction scope.]';
        return createSecretRedactor(secretValues).redact(text).text;
      };
      const close = () => closing ??= (async () => {
        stop.abort();
        input.signal.removeEventListener('abort', onAbort);
        const failures: unknown[] = [];
        // Pending launch completions also observe the aborted fence and clean
        // their handles before settling. A timeout remains a cleanup failure.
        try { await boundedCleanup((async () => { while (pending.size) await Promise.allSettled([...pending]); })()); } catch (error) { failures.push(error); }
        failures.push(...lateCleanupFailures);
        const results = await Promise.allSettled([
          ...[...processes].map(process => boundedCleanup(backendCall(() => process.terminate()))),
          ...[...browsers].map(browser => boundedCleanup(backendCall(() => browser.close()))),
          ...(driver ? [boundedCleanup(backendCall(() => driver!.close()))] : []),
        ]);
        for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
        if (failures.length) throw new AggregateError(failures, 'Verification cleanup failed.');
      })();
      const onAbort = () => { void close().catch(() => {}); };
      input.signal.addEventListener('abort', onAbort, { once: true });
      const launcher: VerificationLauncher = {
        launch: request => track((async () => {
          active();
          if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 600_000 || request.envRefs.length > 32 || new Set(request.envRefs).size !== request.envRefs.length)
            throw executorDenied('INVALID_INPUT', 'Verification launch limits are invalid.');
          const state = await admitted.revalidate();
          const executable = state.executables.find(entry => entry.id === request.executableId);
          if (!executable) throw executorDenied('EXECUTABLE_UNAVAILABLE', 'The executable was not included in this approval.');
          const decision = await evaluateExecution({ profile: input.binding.profile, request: { kind: 'executable', executable: executable.canonicalPath, argv: [...request.argv], cwd: request.cwd },
            trust: state.trust, trustRootPath: input.binding.rootIdentity.canonicalPath, approvedBackendId: config.approvedBackendId, backends: config.backends, env: config.flags });
          active();
          if (decision.status !== 'ALLOW' || decision.unrestricted || decision.backendId !== input.binding.backendId)
            throw executorDenied('CAPABILITY_DENIED', 'The exact verification launch is not authorized by the current profile.');
          const environment = { ...config.environment }, approvals: SecretApproval[] = [];
          for (const refId of request.envRefs) {
            if (!input.binding.profile.secretRefs.includes(refId)) throw executorDenied('SECRET_REF_APPROVAL', 'A secret reference is outside the approved profile.');
            const ref = config.secrets.list().find(entry => entry.refId === refId);
            if (!ref || ref.revoked || ref.owner !== input.owner.accountBinding || ref.destination.kind !== 'process-env' || ref.destination.executableSha256 !== executable.sha256 || Object.hasOwn(environment, ref.destination.envName))
              throw executorDenied('SECRET_REF_DESTINATION', 'A secret reference does not match this executable and account.');
            active();
            const approval = config.secrets.approve(refId, ref.destination, { actor: `verification:${input.executionId}` }); approvals.push(approval);
            const resolved = await backendCall(() => config.secrets.resolve(refId, ref.destination, approval));
            active();
            for (const [name, value] of Object.entries(resolved.env ?? {})) { environment[name] = value; secretValues.add(value); }
          }
          const current = await admitted.revalidate();
          const launchStop = new AbortController(), processSignal = AbortSignal.any([signal, launchStop.signal]);
          const deadlineAt = Date.now() + request.timeoutMs;
          const launchFailure = () => signal.aborted ? executorDenied('CANCELLED', 'Verification was cancelled.') : executorDenied('EXECUTION_TIMEOUT', 'Verification launch exceeded its deadline.');
          const beforeSpawn = () => {
            active();
            if (launchStop.signal.aborted) throw launchFailure();
            if (approvals.some(approval => approval.expiresAt <= Date.now())) throw executorDenied('SECRET_REF_APPROVAL', 'Secret approval expired before native dispatch.');
          };
          beforeSpawn();
          const launchTimer = setTimeout(() => launchStop.abort(), request.timeoutMs);
          const creation = backendCall(() => current.backend.launchObserved({ ...decision.launch, secretRefs: [...request.envRefs], environment: Object.freeze(environment), timeoutMs: request.timeoutMs,
            rootIdentities: current.roots, executableIdentity: { dev: executable.dev, ino: executable.ino }, signal: processSignal, assertCurrent: beforeSpawn }));
          let raw: LaunchedProcess;
          try { raw = await takePendingHandle(creation, processSignal, process => process.terminate(), launchFailure); }
          finally { clearTimeout(launchTimer); }
          // Take custody before the post-await fence, including late cancellation.
          processes.add(raw);
          try { beforeSpawn(); } catch (error) { await boundedCleanup(backendCall(() => raw.terminate())); processes.delete(raw); throw error; }
          if (!Number.isSafeInteger(raw.pid) || raw.pid <= 0) { await boundedCleanup(backendCall(() => raw.terminate())); processes.delete(raw); throw executorDenied('INVALID_PROCESS_EVIDENCE', 'The backend did not return an observed process identity.'); }
          let termination: 'TIMEOUT' | 'CANCELLED' | null = null, cleanupError: unknown, terminatePromise: Promise<void> | undefined;
          let finishForced!: () => void;
          const forced = new Promise<void>(resolve => { finishForced = resolve; });
          const terminate = () => terminatePromise ??= boundedCleanup(backendCall(() => raw.terminate())).catch(error => { cleanupError = error; throw error; }).finally(finishForced);
          const timer = setTimeout(() => { termination = 'TIMEOUT'; launchStop.abort(); void terminate().catch(() => {}); }, Math.max(0, deadlineAt - Date.now()));
          const cancel = () => { termination ??= 'CANCELLED'; void terminate().catch(() => {}); };
          signal.addEventListener('abort', cancel, { once: true });
          const wait = Promise.race([backendCall(() => raw.wait()), forced.then(() => ({ exitCode: null, termination: termination ?? 'CANCELLED' as const }))]).then(result => {
            if (cleanupError) throw cleanupError;
            if (termination) return { exitCode: result.exitCode, termination };
            active();
            if (!['NONE', 'TIMEOUT', 'CANCELLED', 'SPAWN_ERROR'].includes(result.termination) || (result.exitCode !== null && !Number.isInteger(result.exitCode)))
              throw executorDenied('INVALID_PROCESS_EVIDENCE', 'The backend returned invalid process completion evidence.');
            return result;
          }).finally(() => { clearTimeout(timer); signal.removeEventListener('abort', cancel); });
          void wait.catch(() => {});
          const process: LaunchedProcess = {
            pid: raw.pid, wait: () => wait, terminate,
            async tree() { const value = await backendCall(() => raw.tree()); if (!Array.isArray(value) || value.length > 4096 || value.some(pid => !Number.isSafeInteger(pid) || pid <= 0)) throw executorDenied('INVALID_PROCESS_EVIDENCE', 'Invalid owned process tree.'); return value; },
            async log() { active(); const result = await backendCall(() => raw.log()); active(); return { text: redactLog(result.text), truncated: result.truncated || [...secretValues].some(value => value.length < 8) }; },
          };
          processes.delete(raw); processes.add(process);
          return process;
        })()),
      };
      const probe: ListenerProbe = { async probe(request) {
        active();
        const origin = `http://${request.host}:${request.port}`;
        if (!['localhost', '127.0.0.1'].includes(request.host) || !Number.isInteger(request.port) || request.port < 1 || request.port > 65535 || !request.path.startsWith('/') || request.path.length > 2048 || new URL(request.path, origin).origin !== origin || !admitted.origins.includes(origin) || !admitted.backend.probeListener)
          throw executorDenied('CAPABILITY_DENIED', 'Readiness endpoint is not covered by the admitted backend and origin.');
        const result = await backendCall(() => admitted.backend.probeListener!(request)); active(); return result;
      } };
      try {
        active();
        if (input.binding.browserRequired) {
          const openingStop = new AbortController(), openingSignal = AbortSignal.any([signal, openingStop.signal]);
          const openingFailure = () => signal.aborted ? executorDenied('CANCELLED', 'Verification was cancelled.') : executorDenied('BROWSER_STEP_TIMEOUT', 'Managed browser startup exceeded its deadline.');
          const beforeOpen = () => { active(); if (openingStop.signal.aborted) throw openingFailure(); };
          const timer = setTimeout(() => openingStop.abort(), BROWSER_STEP_TIMEOUT_MS);
          try {
            driver = await takePendingHandle(backendCall(() => admitted.backend.openBrowserDriver!({ ...fence, signal: openingSignal, assertCurrent: beforeOpen, executionId: input.executionId, binding: input.binding, approvedOrigins: admitted.origins })), openingSignal, value => value.close(), openingFailure);
            beforeOpen();
          } finally { clearTimeout(timer); }
          if (typeof driver.profileDir !== 'string' || !driver.profileDir || driver.profileDir.length > 4096) throw executorDenied('INVALID_BROWSER_PROFILE', 'The backend did not supply its owned browser profile.');
        }
      } catch (error) { await close(); throw error; }
      const browser: BrowserDriver | null = driver ? { launch: request => track((async () => {
        active();
        if (request.profileDir !== driver!.profileDir || [...request.approvedOrigins].sort().join('\0') !== admitted.origins.join('\0')) throw executorDenied('CAPABILITY_DENIED', 'Browser profile or origins changed after approval.');
        const allowOrigin = (origin: string) => { active(); return admitted.origins.includes(origin) && request.allowOrigin(origin); };
        const raw = await takePendingHandle(backendCall(() => driver!.launch({ ...request, allowOrigin })), signal, value => value.close(), () => executorDenied('CANCELLED', 'Verification was cancelled.'));
        browsers.add(raw);
        try { active(); } catch (error) { await boundedCleanup(backendCall(() => raw.close())); browsers.delete(raw); throw error; }
        const page = raw.page;
        const guarded = async <T>(action: () => Promise<T>) => { active(); const value = await backendCall(action); active(); return value; };
        const read = <T>(action: () => T) => {
          active(); let value: T;
          try { value = action(); } catch { throw executorDenied('INVALID_BROWSER_EVIDENCE', 'The approved browser returned invalid observation evidence.'); }
          active(); return value;
        };
        let browserClose: Promise<void> | undefined;
        const session: BrowserSession = {
          page: {
            url: () => read(() => redactLog(page.url())),
            goto: url => guarded(() => { if (!allowOrigin(new URL(url).origin)) throw executorDenied('CAPABILITY_DENIED', 'Browser navigation origin is not approved.'); return page.goto(url); }),
            click: selector => guarded(() => page.click(selector)), type: (selector, value) => guarded(() => page.type(selector, value)),
            text: selector => guarded(async () => redactLog(await page.text(selector))), visible: selector => guarded(() => page.visible(selector)), screenshot: () => guarded(() => page.screenshot()),
          },
          collectedFailures: () => read(() => { const failures = raw.collectedFailures(); return { console: failures.console.slice(0, 100).map(redactLog), network: failures.network.slice(0, 100).map(redactLog) }; }),
          observedOrigins: () => read(() => {
            const origins = raw.observedOrigins();
            if (!Array.isArray(origins) || origins.length > 64 || origins.some(origin => typeof origin !== 'string' || origin.length > 2048 || new URL(origin).origin !== origin)) throw executorDenied('INVALID_BROWSER_EVIDENCE', 'Browser origin observations are not bounded canonical origins.');
            return [...origins];
          }),
          close: () => browserClose ??= boundedCleanup(backendCall(() => raw.close())).then(() => { browsers.delete(session); }),
        };
        browsers.delete(raw); browsers.add(session);
        return session;
      })()) } : null;
      return { launcher, probe, browser, browserProfileDir: driver?.profileDir ?? null, close };
    },
  };
}
