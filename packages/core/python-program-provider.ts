import { isAbsolute, resolve } from 'node:path';
import { HarnessError } from '../contracts/index.ts';
import { executionProfileV1Schema, isTrustedHostProfile, projectTrustV1Schema, type ExecutionProfileV1, type ProjectTrustV1 } from '../contracts/execution-profile.ts';
import { toolOwnerSchema, type ToolOwner } from '../contracts/tool-effects.ts';
import { programLimitsSchema, pythonKernelIdentitySchema, type ProgramExecutor, type PythonKernelIdentity } from '../contracts/tool-program.ts';
import { digest } from '../storage/store.ts';
import { pythonExecutionBackend, pythonProgramArguments, pythonRuntimeFingerprint, type PythonExecutionBackend, type PythonRuntimeConfiguration } from '../runtime/python-program-worker.ts';
import { evaluateExecution, type ApprovedLaunch, type ExecutionHandle, type PlatformProof } from './execution-policy.ts';
import { HOST_FLAG_NAMES, hostFlagEnabled, hostFlagEnvName } from './host-flags.ts';
import { canonicalRootIdentity } from './project-trust.ts';
import { inside } from './security.ts';
import type { ToolProgramHostOptions } from './tool-program-host.ts';

/** All fields originate in host composition. They are never accepted in model
 * tool arguments. env is the M03 flag source, not an environment for Python. */
export interface PythonHostConfiguration {
  profile: ExecutionProfileV1;
  trust: ProjectTrustV1 | null;
  trustRootPath: string;
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
}
export interface PythonProgramProviderOptions {
  runtime: PythonRuntimeConfiguration;
  /** Actual Linux x86_64 evidence for the pinned runtime and OS boundary.
   * Python memory proof measures hard RLIMIT_AS, not aggregate process-tree
   * RSS. The provider never creates a PASS proof or operator approval. */
  platformProof: PlatformProof;
  /** Explicit operator/source-lock approval, never inferred by this provider. */
  approved: boolean;
  configuration(owner: ToolOwner): PythonHostConfiguration | Promise<PythonHostConfiguration>;
}
export type PythonProgramProvider = NonNullable<ToolProgramHostOptions['python']>;
interface Selection { identity: PythonKernelIdentity; configuration: PythonHostConfiguration }

const failure = (code: string, message: string) => new HarnessError(code, message);
const resetRequired = () => failure('KERNEL_RESET_REQUIRED', 'The Python kernel requires an explicit reset');

/** Compose one installed, explicitly pinned Python implementation with the
 * existing M03 decision API. No interpreter discovery, approval creation,
 * TRUSTED_HOST fallback, host environment forwarding or cell replay occurs. */
export function createPythonProgramProvider(options: PythonProgramProviderOptions): PythonProgramProvider {
  const runtime = structuredClone(options.runtime), runtimeFingerprint = pythonRuntimeFingerprint(runtime);
  const platformProof = structuredClone(options.platformProof), approved = options.approved === true;
  const readConfiguration = options.configuration;

  const capture = async (owner: ToolOwner, toolRegistryDigest: string, protectedDataDir: string): Promise<Selection> => {
    const supplied = await readConfiguration(structuredClone(owner));
    const profile = executionProfileV1Schema.parse(supplied.profile);
    const trust = supplied.trust === null ? null : projectTrustV1Schema.parse(supplied.trust);
    if (!isAbsolute(supplied.cwd) || !isAbsolute(supplied.trustRootPath) || typeof protectedDataDir !== 'string' || !isAbsolute(protectedDataDir))
      throw failure('PYTHON_PROFILE_DENIED', 'Python host configuration requires absolute working and trust roots');
    const [cwd, protectedRoot] = await Promise.all([canonicalRootIdentity(supplied.cwd), canonicalRootIdentity(protectedDataDir)]);
    if (inside(cwd.canonicalPath, protectedRoot.canonicalPath) || inside(protectedRoot.canonicalPath, cwd.canonicalPath))
      throw failure('PYTHON_PROFILE_DENIED', 'The Python working directory cannot expose protected host storage or its surrounding directory');
    if (cwd.canonicalPath !== resolve(supplied.cwd)) throw failure('PYTHON_PROFILE_DENIED', 'The private Python working directory must be a canonical physical path');
    // Keep only public policy booleans. Arbitrary environment values and
    // credentials are neither hashed into identity nor forwarded to the guest.
    const env = Object.fromEntries(HOST_FLAG_NAMES.map(name => [hostFlagEnvName(name), hostFlagEnabled(name, supplied.env ?? {}) ? 'true' : 'false']));
    const trustRootPath = resolve(supplied.trustRootPath);
    const identity = pythonKernelIdentitySchema.parse({ owner,
      interpreterDigest: runtime.interpreter.sha256,
      configurationDigest: digest({ version: 1, runtimeFingerprint, platformProof, approved, trust, trustRootPath, env, protectedRoot }),
      cwdIdentity: digest(cwd), toolRegistryDigest, executionProfileDigest: digest(profile) });
    return { identity, configuration: { profile, trust, trustRootPath, cwd: cwd.canonicalPath, env } };
  };

  const authorize = async (selection: Selection, backend: PythonExecutionBackend): Promise<ApprovedLaunch> => {
    const config = selection.configuration;
    const decision = await evaluateExecution({ profile: config.profile, trust: config.trust,
      trustRootPath: config.trustRootPath, env: config.env,
      request: { kind: 'executable', executable: runtime.interpreter.path, argv: pythonProgramArguments(), cwd: config.cwd },
      approvedBackendId: runtime.backendId, backends: [backend], explicitTrustedHost: false });
    if (decision.status !== 'ALLOW') throw new HarnessError('PYTHON_EXECUTION_DENIED', 'The host M03 execution policy did not authorize this confined Python launch',
      { status: decision.status, ...('code' in decision ? { code: decision.code } : {}) });
    if (decision.unrestricted || decision.backendId === 'TRUSTED_HOST' || isTrustedHostProfile(config.profile) || decision.backendId !== runtime.backendId)
      throw new HarnessError('PYTHON_EXECUTION_DENIED', 'Python programs require the explicitly selected confined M03 backend', { status: 'DENY' });
    return decision.launch;
  };

  return {
    async configure(inputOwner, toolRegistryDigest, protectedDataDir) {
      const owner = toolOwnerSchema.parse(inputOwner), selected = await capture(owner, toolRegistryDigest, protectedDataDir);
      const selectedKey = digest(selected.identity);
      const current = async () => {
        const configuration = await capture(owner, toolRegistryDigest, protectedDataDir);
        if (digest(configuration.identity) !== selectedKey)
          throw failure('KERNEL_IDENTITY_CHANGED', 'The approved Python owner, runtime, profile, configuration, directory or tool set changed');
        return configuration;
      };
      return {
        identity: structuredClone(selected.identity),
        async factory(generation) {
          const backend = pythonExecutionBackend({ runtime, platformProof, approved, generation });
          const launch = await authorize(await current(), backend);
          const handle = await backend.launch(launch);
          try {
            const executor = backend.executor(handle.id);
            return guardedExecutor(executor, handle, async () => {
              const nextLaunch = await authorize(await current(), backend);
              if (digest(nextLaunch) !== digest(launch)) throw failure('KERNEL_IDENTITY_CHANGED', 'The approved Python launch changed');
            });
          } catch (error) { await handle.terminate(); throw error; }
        },
      };
    },
  };
}

/** Revalidation belongs to the active cell budget. An aborted policy callback
 * may finish later, but can never dispatch source or revive a stopped kernel. */
function guardedExecutor(executor: ProgramExecutor, handle: ExecutionHandle, authorizeCell: () => Promise<void>): ProgramExecutor {
  let closed = false, busy = false, stopping: Promise<void> | undefined;
  let interruptActive: ((error: unknown) => void) | undefined;
  const stop = (reason: unknown = resetRequired()): Promise<void> => {
    if (!closed) {
      closed = true;
      const interrupt = interruptActive;
      stopping = Promise.resolve().then(() => handle.terminate());
      void stopping.then(() => interrupt?.(reason), error => interrupt?.(error));
    }
    return stopping ?? Promise.resolve();
  };
  return {
    proof: executor.proof,
    async execute(request) {
      if (closed) throw resetRequired();
      if (busy) throw failure('KERNEL_BUSY', 'The Python kernel already owns an active cell');
      programLimitsSchema.parse(request.limits);
      if (!Number.isSafeInteger(request.startClock) || request.startClock < 0)
        throw failure('PROGRAM_PROTOCOL', 'The Python cell start clock is invalid');
      busy = true;
      const deadline = Math.min(request.startClock + request.limits.deadlineMs, Date.now() + request.limits.deadlineMs);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const interrupted = new Promise<never>((_, reject) => { interruptActive = reject; });
      void interrupted.catch(() => {});
      const abort = () => { void stop(failure('PROGRAM_CANCELLED', 'The Python cell was cancelled during policy or process execution')); };
      request.signal.addEventListener('abort', abort, { once: true });
      const check = () => {
        if (closed) throw resetRequired();
        if (request.signal.aborted) throw failure('PROGRAM_CANCELLED', 'The Python cell was cancelled');
        if (Date.now() >= deadline) throw failure('PROGRAM_DEADLINE', 'The Python cell exceeded its absolute deadline');
      };
      try {
        check();
        timer = setTimeout(() => { void stop(failure('PROGRAM_DEADLINE', 'The Python cell exceeded its absolute deadline')); }, Math.max(1, deadline - Date.now()));
        const work = (async () => { await authorizeCell(); check(); return executor.execute(request); })();
        return await Promise.race([work, interrupted]);
      } catch (error) { await stop(error); throw error; }
      finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); interruptActive = undefined; busy = false; }
    },
    stop: () => stop(),
  };
}
