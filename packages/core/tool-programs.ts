import { randomBytes, randomUUID } from 'node:crypto';
import { HarnessError, type Thread, type ToolCall } from '../contracts/index.ts';
import type { ToolEffectRecord, ToolOwner } from '../contracts/tool-effects.ts';
import {
  DEFAULT_PROGRAM_LIMITS, PROGRAM_INPUT_LIMITS, programInputRefsSchema, toolProgramV1Schema, nestedCallV1Schema, programJournalV1Schema,
  type ToolProgramV1, type NestedCallV1, type ProgramJournalV1, type ProgramLimits,
  type ProgramError, type ProgramExecutor, type ProgramToolDelivery,
} from '../contracts/tool-program.ts';
import { digest, type Store } from '../storage/store.ts';
import { authorize, type ToolAuthority, type RegistryEntry } from './tool-authority.ts';
import { ToolEffectLedger } from './tool-effects.ts';
import { ToolDisclosure, toolDefinitionDigest } from './tool-disclosure.ts';
import { PrivateToolResults } from './tool-results.ts';
import type { M12FlagKey } from './capability-flags.ts';

export interface ToolProgramOptions {
  authority: ToolAuthority;
  effects: ToolEffectLedger;
  disclosure: ToolDisclosure;
  results: PrivateToolResults;
  currentOwner(threadId: string): ToolOwner;
  enabled(key: M12FlagKey): boolean;
  executeRead(call: ToolCall, owner: ToolOwner, signal: AbortSignal): Promise<unknown>;
  /** Fault injection runs outside transactions except named before-commit points. */
  boundary?(point: string, programId: string, callKey?: string): void;
}
export interface PrepareToolProgram {
  owner: ToolOwner;
  language: 'JAVASCRIPT' | 'PYTHON';
  source: string;
  allowedTools: string[];
  inputRefs?: string[];
  requestedAggregate: string;
  limits?: Partial<ProgramLimits>;
}
interface PrivateProgram {
  source: string;
  requestedAggregate: string;
  definitions: Record<string, string>;
  attempts: number;
}
export interface ToolProgramResult {
  programId: string;
  state: ToolProgramV1['state'];
  resultRef: string | null;
  sourceRefs: string[];
  /** Remaining handles stay in the authenticated program call graph. */
  sourceRefsOmitted?: number;
  aggregate?: unknown;
  error: ProgramError | null;
  usage: { nestedCalls: number; elapsedMs: number; visibleBytes: number };
}

/** Measure the complete serialized envelope and bound it to the program's
 * output cap. The count includes its own decimal representation, so reach its
 * fixed point: usage is measured bytes, never an approximation. Failure
 * envelopes also obey the cap; full references and the original error stay
 * inspectable in the authenticated program view. */
export function boundProgramResult<T extends ToolProgramResult>(result: T, maxOutputBytes: number, totalSourceRefs: number): T {
  const measure = () => {
    for (let pass = 0; pass < 8; pass++) {
      const bytes = Buffer.byteLength(JSON.stringify(result));
      if (bytes === result.usage.visibleBytes) return bytes;
      result.usage.visibleBytes = bytes;
    }
    return result.usage.visibleBytes;
  };
  while (measure() > maxOutputBytes && result.sourceRefs.length) {
    result.sourceRefs.pop(); result.sourceRefsOmitted = totalSourceRefs - result.sourceRefs.length;
  }
  while (measure() > maxOutputBytes && result.error?.message.length) {
    result.error = { ...result.error, message: result.error.message.slice(0, -1) };
  }
  measure();
  return result;
}
const activeStates = new Set(['PREPARED', 'RUNNING', 'WAITING_TOOL']);
const forbiddenArguments = new Set(['accountId', 'accountBinding', 'workspaceId', 'projectId', 'threadId', 'runId', 'epoch', 'commandId', 'invocationId']);
const cancelled = () => new HarnessError('PROGRAM_CANCELLED', 'Program cancelled; dispatched reads retain their receipts');
const sameOwner = (left: ToolOwner, right: ToolOwner) => digest(left) === digest(right);
const now = () => Date.now();
// Backend errors can contain guest-controlled messages, including private tool
// values. Preserve only known codes and host-authored public descriptions.
const backendErrors: Readonly<Record<string, string>> = Object.freeze({
  PROGRAM_BACKEND_UNAVAILABLE: 'The bounded program executor is unavailable',
  PROGRAM_INVALID_INPUT: 'The bounded executor rejected a program input',
  PROGRAM_MEMORY_LIMIT: 'The program exceeded its memory budget',
  PROGRAM_CALL_LIMIT: 'The program exceeded its nested call budget',
  PROGRAM_OUTPUT_LIMIT: 'The explicit aggregate exceeded its byte budget',
  PROGRAM_PROTOCOL_ERROR: 'The bounded executor rejected an invalid protocol message',
  PROGRAM_DELIVERY_COMMIT_FAILED: 'A tool delivery could not be committed',
  PROGRAM_SCRIPT_ERROR: 'Program execution failed; inspect its retained source handles',
  PROGRAM_DEADLINE_EXCEEDED: 'The original program deadline expired',
  PROGRAM_CANCELLED: 'Program execution was cancelled',
});
const safeError = (error: unknown, originalResultRef: string | null = null): ProgramError => {
  if (!(error instanceof HarnessError)) {
    const backendCode = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
    if (typeof backendCode === 'string' && Object.hasOwn(backendErrors, backendCode)) {
      return { code: backendCode === 'PROGRAM_DEADLINE_EXCEEDED' ? 'PROGRAM_DEADLINE' : backendCode,
        message: backendErrors[backendCode]!, originalResultRef };
    }
  }
  const code = error instanceof HarnessError ? error.code : 'PROGRAM_FAILED';
  const message = code === 'NESTED_TOOL_FAILED' ? 'The program includes failed source tools; inspect retained source handles'
    : error instanceof HarnessError && /^(REPLAY_|PROGRAM_|CALL_|OUTPUT_|NESTED_|UNSUPPORTED_|TOOL_|INPUT_|KERNEL_)/.test(code)
    ? error.message.slice(0, 1800) : 'Program failed; inspect its retained result reference';
  return { code, message, originalResultRef };
};
function ownerThread(owner: ToolOwner): Thread {
  return { id: owner.threadId, runId: owner.runId, epoch: owner.epoch, projectId: owner.projectId ?? undefined,
    workspaceId: owner.workspaceId ?? undefined, accountId: owner.accountBinding, status: 'working', title: '',
    projectName: null, modelId: null, sessionPath: null, createdAt: '', updatedAt: '' };
}
function parentDefinition(language: ToolProgramV1['language']): RegistryEntry {
  // Host-owned execution metadata, never eligible for nested read disclosure.
  return { id: `program_${language.toLowerCase()}`, version: 1, schemaDigest: digest({ version: 1, language }),
    risk: 'HOST_EXECUTE', replayClass: 'PROCESS_BOUND', allowedRoles: ['run'], executorBinding: 'store', approval: 'none' };
}

/** The SQLite writer and admission controller. Executors receive JSON values and
 * callbacks only. They never get a Store, account, grant record or credential. */
export class ToolPrograms {
  private readonly active = new Map<string, { controller: AbortController; done: Promise<ToolProgramResult> }>();
  private admissionStopped = false;
  constructor(private readonly store: Store, private readonly host: ToolProgramOptions) {}

  private assertOwner(owner: ToolOwner): void {
    let current: ToolOwner;
    try { current = this.host.currentOwner(owner.threadId); }
    catch { throw new HarnessError('PROGRAM_OWNER_REVOKED', 'Program owner is no longer active'); }
    if (!sameOwner(owner, current)) throw new HarnessError('PROGRAM_OWNER_REVOKED', 'Program account, workspace or run owner changed');
  }
  private require(programId: string, owner: ToolOwner): ToolProgramV1 {
    const program = this.store.get<ToolProgramV1>('toolProgram', programId);
    if (!program || !sameOwner(program.owner, owner)) throw new HarnessError('PROGRAM_OWNER_REVOKED', 'Program is unavailable for this exact owner');
    return program;
  }
  private checkBackend(executor: ProgramExecutor, language: ToolProgramV1['language'], limits: ProgramLimits): void {
    const proof = executor.proof;
    const expectedScope = language === 'PYTHON' ? 'INTERPRETER_ADDRESS_SPACE' : 'GUEST_WASM_LINEAR';
    const syntheticContract = proof.memoryScope === 'SYNTHETIC_CONTRACT' && proof.platform === 'synthetic';
    if (proof.language !== language || !proof.tested || !proof.hardMemoryLimit
      || !Number.isSafeInteger(proof.memoryLimitBytes) || proof.memoryLimitBytes <= 0 || proof.memoryLimitBytes > limits.memoryBytes
      || !(proof.memoryScope === expectedScope || syntheticContract) || !/^[a-f0-9]{64}$/.test(proof.runtimeFingerprint)
      || language === 'PYTHON' && proof.isolation !== 'M03_CONFINED_PROCESS')
      throw new HarnessError('UNSUPPORTED_BACKEND', 'A tested backend enforcing the requested isolation and memory ceiling is required');
  }
  private flag(language: ToolProgramV1['language']): M12FlagKey { return language === 'JAVASCRIPT' ? 'tools.jsReadProgramV1' : 'tools.pythonKernelV1'; }
  private boundary(point: string, programId: string, key?: string) { this.host.boundary?.(point, programId, key); }
  private write(program: ToolProgramV1, type: string): void {
    this.store.internal(type, program.owner.threadId, () => {
      this.store.put('toolProgram', program.programId, program.owner.threadId, toolProgramV1Schema.parse(program));
      return { programId: program.programId, state: program.state };
    });
  }
  async prepare(input: PrepareToolProgram, executor: ProgramExecutor): Promise<ToolProgramV1> {
    if (this.admissionStopped || !this.host.enabled(this.flag(input.language))) throw new HarnessError('PROGRAM_DISABLED', 'This program capability is disabled by the host');
    this.assertOwner(input.owner);
    if (typeof input.source !== 'string' || Buffer.byteLength(input.source) > 128 * 1024 || !input.source.trim()) throw new HarnessError('INPUT_LIMIT', 'Program source must contain at most 128 KiB');
    if (typeof input.requestedAggregate !== 'string' || !input.requestedAggregate.trim() || Buffer.byteLength(input.requestedAggregate) > 2048)
      throw new HarnessError('INPUT_LIMIT', 'Name the requested aggregate explicitly, within 2048 bytes');
    const inputRefs = programInputRefsSchema.safeParse(input.inputRefs ?? []);
    if (!inputRefs.success) throw new HarnessError('INPUT_LIMIT', 'Program inputs require at most 64 unique result references');
    const selected = this.host.disclosure.snapshot(input.owner, input.allowedTools);
    const program = toolProgramV1Schema.parse({ version: 1, programId: randomUUID(), owner: input.owner,
      language: input.language, sourceDigest: digest(input.source), runtimeFingerprint: executor.proof.runtimeFingerprint,
      toolRegistryDigest: selected.registryDigest, allowedTools: [...input.allowedTools], inputRefs: inputRefs.data,
      limits: { ...DEFAULT_PROGRAM_LIMITS, ...input.limits }, state: 'PREPARED', resultRef: null,
      createdAt: now(), startedAt: null, deadlineAt: null, elapsedMs: 0, nestedCallCount: 0, error: null });
    this.checkBackend(executor, program.language, program.limits);
    if (program.limits.maxOutputBytes < 2048) throw new HarnessError('UNSUPPORTED_OUTPUT_LIMIT', 'A program result envelope requires at least 2048 visible bytes');
    for (const ref of program.inputRefs) await this.host.results.authorizeInput(input.owner, ref, program.programId);
    this.assertOwner(input.owner);
    this.store.internal('toolProgram.prepared', program.owner.threadId, () => {
      this.store.put('toolProgram', program.programId, program.owner.threadId, program);
      this.store.put('toolProgramPrivate', program.programId, program.owner.threadId, {
        source: input.source, requestedAggregate: input.requestedAggregate,
        definitions: Object.fromEntries(program.allowedTools.map(name => [name, toolDefinitionDigest(this.host.authority.require(name))])), attempts: 0,
      } satisfies PrivateProgram);
      return { programId: program.programId, language: program.language, state: program.state };
    });
    this.boundary('program.prepared', program.programId);
    return program;
  }

  async run(programId: string, owner: ToolOwner, executor: ProgramExecutor, options: { replay?: boolean } = {}): Promise<ToolProgramResult> {
    this.assertOwner(owner);
    const program = this.require(programId, owner);
    if (this.active.has(programId)) throw new HarnessError('PROGRAM_BUSY', 'The program already has an owned executor');
    if ([...this.active.keys()].some(id => {
      const other = this.store.get<ToolProgramV1>('toolProgram', id);
      return other && sameOwner(other.owner, owner);
    })) throw new HarnessError('PROGRAM_BUSY', 'This owner already has an active bounded program');
    if (this.admissionStopped || !this.host.enabled(this.flag(program.language))) throw new HarnessError('PROGRAM_DISABLED', 'Program admission is disabled');
    this.checkBackend(executor, program.language, program.limits);
    if (program.state !== 'PREPARED' && !options.replay) throw new HarnessError('PROGRAM_ALREADY_RUN', 'A program is not automatically rerun');
    if (options.replay && (program.language !== 'JAVASCRIPT' || !this.host.enabled('tools.durableReplayExperimentV1')))
      throw new HarnessError('REPLAY_DISABLED', 'Durable replay is a separate JavaScript experiment; Python cells never replay');
    const controller = new AbortController();
    // Install ownership before execution can yield or a caller can cancel.
    const done = Promise.resolve().then(() => this.execute(programId, owner, executor, controller, options.replay === true));
    this.active.set(programId, { controller, done });
    try { return await done; }
    finally { if (this.active.get(programId)?.controller === controller) this.active.delete(programId); }
  }

  private async execute(programId: string, owner: ToolOwner, executor: ProgramExecutor, controller: AbortController, replay: boolean): Promise<ToolProgramResult> {
    let program = this.require(programId, owner);
    // Reject older/corrupted duplicate lists before any write or payload read.
    // They cannot be persisted again under the current strict program schema.
    if (!programInputRefsSchema.safeParse(program.inputRefs).success)
      throw new HarnessError('INPUT_LIMIT', 'Program inputs require at most 64 unique result references');
    const privateProgram = this.store.get<PrivateProgram>('toolProgramPrivate', programId)!;
    let journal = this.store.get<ProgramJournalV1>('programJournal', programId);
    const originalResultRef = program.resultRef;
    const terminalOriginal = replay && ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(program.state);
    let replayJournal: ProgramJournalV1 | null = null;
    let issued = 0, delivered = 0, admitted = 0, nestedFailed = false;
    const ready = new Map<string, { resultRef: string; state: 'SUCCEEDED' | 'FAILED' }>();
    const waiting: { resolve(): void; reject(error: unknown): void }[] = [];
    const reads = new Set<Promise<unknown>>();
    const deliveryWaiters = new Map<string, { resolve(value: ProgramToolDelivery): void; reject(error: unknown): void; value?: ProgramToolDelivery; error?: unknown }>();
    let attemptId: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let execution: Promise<unknown> | undefined;
    const current = () => this.require(programId, owner);
    const check = () => {
      if (controller.signal.aborted) throw controller.signal.reason ?? cancelled();
      this.assertOwner(owner);
      if (!this.host.enabled(this.flag(program.language)) || this.admissionStopped) throw new HarnessError('PROGRAM_DISABLED', 'Program admission was disabled');
      if (journal && now() >= journal.deadlineAt) throw new HarnessError('PROGRAM_DEADLINE', 'The original program deadline expired');
    };
    const diverged = (reason: string) => new HarnessError('REPLAY_DIVERGED', reason);
    const release = () => { admitted--; const waiter = waiting.shift(); if (waiter) { admitted++; waiter.resolve(); } };
    const acquire = async () => { check(); if (admitted < program.limits.maxConcurrentCalls) { admitted++; return; } await new Promise<void>((resolve, reject) => waiting.push({ resolve, reject })); check(); };
    const abortPending = () => {
      for (const waiter of waiting.splice(0)) waiter.reject(controller.signal.reason ?? cancelled());
      for (const waiter of deliveryWaiters.values()) waiter.reject(controller.signal.reason ?? cancelled());
      deliveryWaiters.clear();
    };
    controller.signal.addEventListener('abort', abortPending, { once: true });
    const resultValue = async (call: NestedCallV1): Promise<ProgramToolDelivery> => {
      const result = await this.host.results.read(owner, call.resultRef!, { programId, signal: controller.signal });
      ready.set(call.stableCallKey, { resultRef: call.resultRef!, state: result.status });
      if (result.status === 'FAILED') { nestedFailed = true; throw new HarnessError('NESTED_TOOL_FAILED', result.error!.message, { resultRef: call.resultRef }); }
      return { value: result.value, resultRef: call.resultRef!, clock: journal!.startClock };
    };
    const pumpReplay = () => {
      if (!replayJournal) return;
      const expected = replayJournal.deliveries[delivered];
      if (!expected) return;
      const waiter = deliveryWaiters.get(expected.stableCallKey);
      if (!waiter || !('value' in waiter || 'error' in waiter)) return;
      // Offering a receipt does not deliver it to the VM. The worker first
      // reports its actual issued count through beforeDelivery, after every
      // preceding call frame. Waiting for the expected count here would turn
      // an early-await divergence into a deadlock instead of checking it.
      deliveryWaiters.delete(expected.stableCallKey);
      if (waiter.error) waiter.reject(waiter.error); else waiter.resolve(waiter.value!);
    };
    try {
      check();
      const selected = this.host.disclosure.snapshot(owner, program.allowedTools);
      if (program.sourceDigest !== digest(privateProgram.source))
        throw diverged('Program source digest differs from the original execution');
      if (program.runtimeFingerprint !== executor.proof.runtimeFingerprint)
        throw diverged('Program runtime fingerprint differs from the original execution');
      if (program.toolRegistryDigest !== selected.registryDigest)
        throw diverged('Program tool registry digest differs from the original execution');
      if (replay && !journal) throw diverged('The original start journal is missing');
      if (journal) {
        const parsed = programJournalV1Schema.safeParse(journal);
        if (!parsed.success) throw diverged('The retained program journal is invalid');
        journal = parsed.data;
        if (journal.programId !== programId)
          throw diverged('Retained journal program identity differs from the program');
        if (journal.sourceDigest !== program.sourceDigest)
          throw diverged('Retained journal source digest differs from the program');
        if (journal.runtimeFingerprint !== program.runtimeFingerprint)
          throw diverged('Retained journal runtime fingerprint differs from the program');
        if (journal.toolRegistryDigest !== program.toolRegistryDigest)
          throw diverged('Retained journal tool registry digest differs from the program');
        if (program.startedAt !== null && program.startedAt !== journal.startClock)
          throw diverged('Retained journal start clock differs from the original program start');
        if (journal.deadlineAt !== journal.startClock + program.limits.deadlineMs)
          throw diverged('Retained journal deadline differs from its start clock and original deadline limit');
        if (program.deadlineAt !== null && program.deadlineAt !== journal.deadlineAt)
          throw diverged('Retained journal deadline differs from the original program deadline');
        if (journal.committedIssuedCount > program.limits.maxCalls || journal.issuedCallKeys.some((key, index) => key !== `call:${index}`))
          throw diverged('The retained issued-call identities are inconsistent');
        const calls = new Map<string, NestedCallV1>();
        for (const key of journal.issuedCallKeys) {
          const parsedCall = nestedCallV1Schema.safeParse(this.store.get('nestedCall', `${programId}:${key}`));
          if (!parsedCall.success) throw diverged(`The retained identity for ${key} is invalid`);
          const call = parsedCall.data;
          if (call.parentProgramId !== programId || call.invocationId !== `${programId}:${key}` || call.stableCallKey !== key
            || !sameOwner(call.owner, owner) || !program.allowedTools.includes(call.toolName)
            || call.definitionDigest !== privateProgram.definitions[call.toolName])
            throw diverged(`The retained identity for ${key} differs from its program owner or definition`);
          calls.set(key, call);
        }
        const deliveredKeys = new Set<string>();
        let previousCount = 0, previousClock = journal.startClock;
        for (const delivery of journal.deliveries) {
          const call = calls.get(delivery.stableCallKey);
          const index = journal.issuedCallKeys.indexOf(delivery.stableCallKey);
          if (!call || deliveredKeys.has(delivery.stableCallKey) || index >= delivery.issuedCount
            || delivery.issuedCount < previousCount || delivery.issuedCount > journal.committedIssuedCount
            || delivery.clock < previousClock || delivery.clock > journal.deadlineAt
            || call.resultRef !== delivery.resultRef || call.state !== delivery.state)
            throw diverged('The retained delivery order, issued counts or source receipts are inconsistent');
          deliveredKeys.add(delivery.stableCallKey);
          previousCount = delivery.issuedCount; previousClock = delivery.clock;
        }
        if (replay) replayJournal = structuredClone(journal);
      }
      if (!journal) {
        const start = now();
        journal = programJournalV1Schema.parse({ version: 1, programId, sourceDigest: program.sourceDigest,
          runtimeFingerprint: program.runtimeFingerprint, toolRegistryDigest: program.toolRegistryDigest,
          startSeed: randomBytes(32).toString('hex'), startClock: start, deadlineAt: start + program.limits.deadlineMs,
          issuedCallKeys: [], committedIssuedCount: 0, deliveries: [] });
      }
      check();
      program = { ...program, state: 'RUNNING', startedAt: journal.startClock, deadlineAt: journal.deadlineAt, error: null };
      this.store.internal('toolProgram.started', owner.threadId, () => {
        this.store.put('programJournal', programId, owner.threadId, journal);
        this.store.put('toolProgram', programId, owner.threadId, program);
        this.store.put('toolProgramPrivate', programId, owner.threadId, { ...privateProgram, attempts: privateProgram.attempts + 1 });
        return { programId, replay, state: program.state };
      });
      this.boundary('journal.start_committed', programId);
      const definition = parentDefinition(program.language);
      if (authorize(definition, 'run', owner, { epoch: owner.epoch, runId: owner.runId, accountId: owner.accountBinding, projectId: owner.projectId, workspaceId: owner.workspaceId }).kind !== 'ALLOW')
        throw new HarnessError('TOOL_AUTHORITY_DENIED', 'The program owner is not authorized');
      attemptId = `${programId}:attempt:${privateProgram.attempts + 1}`;
      this.host.effects.admit({ call: { name: definition.id, args: { invocationId: attemptId, sourceDigest: program.sourceDigest } }, owner, definition, privateArguments: true });
      timer = setTimeout(() => controller.abort(new HarnessError('PROGRAM_DEADLINE', 'The original program deadline expired')), Math.max(1, journal.deadlineAt - now()));
      timer.unref();
      const inputValues: unknown[] = [];
      let inputBytes = 2, inputNodes = 1; // The serialized inputs array itself.
      const inputLimit = () => new HarnessError('INPUT_LIMIT', 'Combined program inputs exceed 4 MiB of JSON, 100000 nodes or depth 64');
      const inspectInput = (value: unknown, depth: number, ancestors: Set<object>): void => {
        if (++inputNodes > PROGRAM_INPUT_LIMITS.maxNodes || depth > PROGRAM_INPUT_LIMITS.maxDepth) throw inputLimit();
        if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
        if (!value || typeof value !== 'object' || ancestors.has(value)) throw inputLimit();
        const array = Array.isArray(value);
        if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw inputLimit();
        const properties = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(properties);
        if (array && keys.length !== properties.length!.value + 1) throw inputLimit();
        ancestors.add(value);
        for (const key of keys) {
          if (typeof key !== 'string') throw inputLimit();
          if (array && key === 'length') continue;
          const descriptor = properties[key]!;
          if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw inputLimit();
          inspectInput(descriptor.value, depth + 1, ancestors);
        }
        ancestors.delete(value);
      };
      // Reads are sequential. Retain only the admitted aggregate plus the one
      // currently inspected source (M10 bounds it to 8 MiB / 100000 nodes).
      // Exact serialized accounting handles text escaping without a multiplier.
      for (const ref of program.inputRefs) {
        if (inputNodes >= PROGRAM_INPUT_LIMITS.maxNodes) throw inputLimit();
        const input = await this.host.results.read(owner, ref, { programId, signal: controller.signal });
        if (input.status === 'FAILED') throw new HarnessError('INPUT_FAILED', 'A failed source handle cannot be used as a successful input');
        inspectInput(input.value, 1, new Set());
        const serialized = JSON.stringify(input.value);
        if (serialized === undefined) throw inputLimit();
        const nextBytes = inputBytes + (inputValues.length ? 1 : 0) + Buffer.byteLength(serialized);
        if (nextBytes > PROGRAM_INPUT_LIMITS.maxBytes) throw inputLimit();
        inputBytes = nextBytes;
        inputValues.push(input.value);
      }
      check();
      const executeCall = async (call: NestedCallV1, args: Record<string, unknown>) => {
        await acquire();
        try {
          check();
          const definition = this.host.disclosure.require(owner, call.toolName, call.definitionDigest);
          const grants = await this.host.results.captureGrants(owner, typeof args.resourceId === 'string' ? [{ resourceId: args.resourceId, ...(typeof args.path === 'string' ? { path: args.path } : {}) }] : [], controller.signal);
          check();
          this.boundary('call.before_dispatch', programId, call.stableCallKey);
          let storedRef: string | undefined;
          try {
            await this.host.effects.invoke({ call: { name: call.toolName, args: { ...args, invocationId: call.invocationId } },
              ctx: { threadId: owner.threadId, runId: owner.runId, epoch: owner.epoch }, thread: ownerThread(this.host.currentOwner(owner.threadId)),
              role: 'run', parentInvocationId: attemptId, privateArguments: true }, async () => {
              check();
              this.boundary('call.effect_committed', programId, call.stableCallKey);
              this.store.internal('toolProgram.call.dispatched', owner.threadId, () => {
                this.store.put('nestedCall', call.invocationId, owner.threadId, { ...call, state: 'DISPATCHED' });
                return { programId, stableCallKey: call.stableCallKey, invocationId: call.invocationId, state: 'DISPATCHED' };
              });
              this.boundary('call.dispatched', programId, call.stableCallKey);
              let value: unknown, failure: unknown, sourceFailed = false;
              try {
                value = await this.host.executeRead({ name: definition.id, args }, owner, controller.signal);
                const actual = value && typeof value === 'object' && 'provenance' in value && 'value' in value ? value.value : value;
                if (actual && typeof actual === 'object' && (('isError' in actual && actual.isError === true) || ('error' in actual && actual.error != null && actual.error !== false) || ('ok' in actual && actual.ok === false) || ('success' in actual && actual.success === false) || ('exitCode' in actual && actual.exitCode !== 0) || ('cancelled' in actual && actual.cancelled === true) || ('timedOut' in actual && actual.timedOut === true)))
                  throw new HarnessError('SOURCE_TOOL_FAILED', 'Source tool reported failure', actual);
              } catch (error) { sourceFailed = true; failure = error; }
              this.boundary('call.read_returned', programId, call.stableCallKey);
              check();
              await this.host.results.revalidateGrants(owner, grants, controller.signal);
              check();
              const prepared = this.host.results.prepare(sourceFailed
                ? { owner, programId, invocationId: call.invocationId, status: 'FAILED', error: { code: failure instanceof HarnessError ? failure.code : 'SOURCE_TOOL_FAILED', message: failure instanceof Error ? failure.message : String(failure), ...(failure instanceof HarnessError ? { details: failure.details } : {}) }, grants }
                : { owner, programId, invocationId: call.invocationId, status: 'SUCCEEDED', value: value ?? null, grants });
              this.store.internal('toolProgram.call.result', owner.threadId, () => {
                storedRef = this.host.results.put(prepared);
                this.store.put('nestedCall', call.invocationId, owner.threadId, { ...call, state: sourceFailed ? 'FAILED' : 'SUCCEEDED', resultRef: storedRef,
                  error: sourceFailed ? { code: 'NESTED_TOOL_FAILED', message: 'Nested tool failed; inspect its retained source handle', originalResultRef: storedRef } : null });
                return { programId, stableCallKey: call.stableCallKey, resultRef: storedRef, state: sourceFailed ? 'FAILED' : 'SUCCEEDED' };
              });
              this.boundary('call.result_committed', programId, call.stableCallKey);
              if (sourceFailed) throw new HarnessError('NESTED_TOOL_FAILED', 'Private nested tool failed', { resultRef: storedRef });
              return { resultRef: storedRef };
            });
          } catch (error) {
            if (!storedRef) throw error;
          }
          const recorded = this.store.get<NestedCallV1>('nestedCall', call.invocationId)!;
          return await resultValue(recorded);
        } finally { release(); }
      };
      const rejectHostCall = (key: string, error: unknown): never => {
        // A committed failed source still follows the delivery journal into the
        // VM. Admission/protocol failures are host-fatal and cannot be caught by
        // the script or replaced by an executor's generic transport error.
        if (!(error instanceof HarnessError && error.code === 'NESTED_TOOL_FAILED' && ready.get(key)?.state === 'FAILED')
          && !controller.signal.aborted) controller.abort(error);
        throw error;
      };
      const issueCall = async (key: string, name: string, args: Record<string, unknown>): Promise<ProgramToolDelivery> => {
        check();
        if (issued >= program.limits.maxCalls) throw new HarnessError('CALL_LIMIT', 'The nested call budget is exhausted');
        if (key !== `call:${issued}`) throw diverged(`Call order differs: expected call:${issued}, received ${key}`);
        if (!program.allowedTools.includes(name)) throw new HarnessError('TOOL_NOT_VISIBLE', 'The tool was not disclosed and allowed for this program');
        if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => forbiddenArguments.has(key)))
          throw new HarnessError('TOOL_ARGUMENTS_DENIED', 'Nested arguments cannot change ownership or invocation identity');
        if (Buffer.byteLength(JSON.stringify(args)) > 64 * 1024) throw new HarnessError('INPUT_LIMIT', 'Nested arguments exceed 64 KiB');
        const definition = this.host.disclosure.require(owner, name, privateProgram.definitions[name]);
        const commitment = this.host.effects.privateArgumentCommitment({ name, args });
        let nested: NestedCallV1;
        if (replayJournal && issued < replayJournal.committedIssuedCount) {
          const prior = this.store.get<NestedCallV1>('nestedCall', `${programId}:${key}`);
          if (!prior || replayJournal.issuedCallKeys[issued] !== key || prior.toolName !== name || prior.argumentsCommitment !== commitment || !sameOwner(prior.owner, owner) || prior.definitionDigest !== toolDefinitionDigest(definition))
            throw diverged(`Call ${key} changed its tool, arguments, owner or definition`);
          nested = nestedCallV1Schema.parse(prior);
        } else {
          if (terminalOriginal) throw diverged('A completed original execution cannot admit an additional call during replay');
          if (replayJournal && delivered < replayJournal.deliveries.length) throw diverged('A new call was issued before the original delivery sequence was reproduced');
          nested = nestedCallV1Schema.parse({ version: 1, parentProgramId: programId, stableCallKey: key, invocationId: `${programId}:${key}`,
            owner, toolName: name, definitionDigest: toolDefinitionDigest(definition), argumentsCommitment: commitment,
            resultRef: null, effectClass: 'READ_RETRYABLE', state: 'PREPARED', error: null });
          journal = { ...journal!, issuedCallKeys: [...journal!.issuedCallKeys, key], committedIssuedCount: journal!.committedIssuedCount + 1 };
          this.store.internal('toolProgram.call.issued', owner.threadId, () => {
            this.store.put('nestedCall', nested.invocationId, owner.threadId, nested);
            this.store.put('programJournal', programId, owner.threadId, programJournalV1Schema.parse(journal));
            this.store.put('toolProgram', programId, owner.threadId, { ...current(), state: 'WAITING_TOOL', nestedCallCount: journal!.committedIssuedCount });
            return { programId, stableCallKey: key, invocationId: nested.invocationId, issuedCount: journal!.committedIssuedCount };
          });
          this.boundary('call.identity_committed', programId, key);
        }
        issued++;
        let pending: Promise<ProgramToolDelivery>;
        if (nested.resultRef && ['SUCCEEDED', 'FAILED'].includes(nested.state)) pending = resultValue(nested);
        else if (replayJournal && this.host.effects.get(nested.invocationId)) pending = Promise.reject(diverged(`Call ${key} has no committed result; its dispatched outcome is unknown`));
        else pending = executeCall(nested, structuredClone(args));
        pending = pending.catch(error => rejectHostCall(key, error));
        reads.add(pending);
        void pending.finally(() => reads.delete(pending)).catch(() => {});
        if (replayJournal && replayJournal.deliveries.some(entry => entry.stableCallKey === key)) {
          const deliveredResult = new Promise<ProgramToolDelivery>((resolve, reject) => {
            const waiter = { resolve, reject } as { resolve(value: ProgramToolDelivery): void; reject(error: unknown): void; value?: ProgramToolDelivery; error?: unknown };
            deliveryWaiters.set(key, waiter);
            void pending.then(value => { waiter.value = value; pumpReplay(); }, error => { waiter.error = error; pumpReplay(); });
          });
          pumpReplay();
          return deliveredResult;
        }
        pumpReplay();
        return pending;
      };
      const call = (key: string, name: string, args: Record<string, unknown>) =>
        issueCall(key, name, args).catch(error => rejectHostCall(key, error));
      const commitDelivery = async (key: string, count: number) => {
        check();
        const entry = ready.get(key);
        if (!entry) throw diverged(`Call ${key} has no committed result to deliver`);
        if (count !== issued || count > journal!.committedIssuedCount) throw diverged(`Issued-call count differs before delivery of ${key}`);
        const expected = replayJournal?.deliveries[delivered];
        if (expected) {
          if (expected.stableCallKey !== key || expected.issuedCount !== count || expected.resultRef !== entry.resultRef || expected.state !== entry.state)
            throw diverged(`Delivery ${delivered} differs in call order, committed count or receipt`);
          delivered++; ready.delete(key); pumpReplay();
          return expected.clock;
        }
        const clock = Math.max(journal!.startClock, journal!.deliveries.at(-1)?.clock ?? 0, now());
        journal = { ...journal!, deliveries: [...journal!.deliveries, { stableCallKey: key, resultRef: entry.resultRef, state: entry.state, issuedCount: count, clock }] };
        this.store.internal('toolProgram.delivery', owner.threadId, () => {
          this.store.put('programJournal', programId, owner.threadId, programJournalV1Schema.parse(journal));
          return { programId, stableCallKey: key, resultRef: entry.resultRef, deliveryOrder: journal!.deliveries.length - 1, issuedCount: count };
        });
        delivered++; ready.delete(key);
        this.boundary('journal.delivery_committed', programId, key);
        return clock;
      };
      const beforeDelivery = (key: string, count: number) => commitDelivery(key, count).catch(error => {
        if (!controller.signal.aborted) controller.abort(error);
        throw error;
      });
      const aborted = new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(controller.signal.reason);
        else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
      });
      execution = executor.execute({ source: privateProgram.source, inputValues, limits: program.limits,
        startSeed: journal.startSeed, startClock: journal.startClock, signal: controller.signal, call, beforeDelivery });
      const output = await Promise.race([execution, aborted]);
      check();
      if (reads.size) throw new HarnessError('PROGRAM_PENDING_CALLS', 'Program returned before its nested reads settled');
      if (replayJournal && (issued < replayJournal.committedIssuedCount || delivered < replayJournal.deliveries.length)) throw diverged('Replay ended before reproducing every committed call and delivery');
      if (nestedFailed || this.calls(programId, owner).some(call => call.state === 'FAILED')) throw new HarnessError('NESTED_TOOL_FAILED', 'The aggregate includes failed source tools; inspect retained source handles');
      if (ready.size) throw new HarnessError('PROGRAM_PENDING_DELIVERIES', 'Program returned without acknowledging all tool deliveries');
      const sourceRefs = this.sourceRefs(programId, owner);
      if (Buffer.byteLength(JSON.stringify({ aggregate: output ?? null, sourceRefs })) > program.limits.maxOutputBytes - 1024)
        throw new HarnessError('OUTPUT_LIMIT', 'The explicit aggregate and references exceed the visible output budget');
      const grants = [] as Awaited<ReturnType<PrivateToolResults['captureGrants']>>;
      for (const ref of [...program.inputRefs, ...sourceRefs]) grants.push(...(await this.host.results.read(owner, ref, { programId, signal: controller.signal })).grants);
      const uniqueGrants = [...new Map(grants.map(grant => [digest(grant), grant])).values()];
      const resultRef = await this.host.results.save({ owner, programId, status: 'SUCCEEDED', value: output ?? null, grants: uniqueGrants });
      check();
      program = { ...current(), state: 'SUCCEEDED', resultRef, elapsedMs: now() - journal.startClock, error: null };
      this.write(program, 'toolProgram.succeeded');
      this.boundary('program.result_committed', programId);
      const result = this.response(program, sourceRefs, output ?? null);
      this.host.effects.settle(attemptId, { value: { programId, resultRef, usage: result.usage } }, 'SUCCEEDED', resultRef);
      return result;
    } catch (error) {
      const cause = controller.signal.aborted ? controller.signal.reason : error;
      const reported = nestedFailed && (!(cause instanceof HarnessError) || cause.code === 'NESTED_TOOL_FAILED')
        ? new HarnessError('NESTED_TOOL_FAILED', 'The program includes failed source tools; inspect retained source handles') : cause;
      if (!controller.signal.aborted) controller.abort(reported);
      const failure = safeError(reported, originalResultRef);
      const state = failure.code === 'PROGRAM_CANCELLED' ? 'CANCELLED' : 'FAILED';
      const startedAt = Number.isSafeInteger(journal?.startClock) ? journal!.startClock : now();
      program = { ...current(), state, error: failure, elapsedMs: Math.max(0, now() - startedAt) };
      this.write(program, 'toolProgram.failed');
      for (const call of this.calls(programId, owner).filter(call => call.state === 'PREPARED' || call.state === 'DISPATCHED')) {
        const effect = this.host.effects.get(call.invocationId);
        const terminal = effect ? 'UNKNOWN' : 'CANCELLED';
        this.store.internal('toolProgram.call.interrupted', owner.threadId, () => {
          this.store.put('nestedCall', call.invocationId, owner.threadId, { ...call, state: terminal, error: failure });
          return { programId, stableCallKey: call.stableCallKey, state: terminal };
        });
        if (effect) this.host.effects.settle(call.invocationId, { error: 'Program interrupted; dispatched read outcome is not confirmed' }, 'UNKNOWN_EXTERNAL_OUTCOME');
      }
      if (attemptId) this.host.effects.settle(attemptId, { value: { programId, error: failure.code }, error: failure.message }, state === 'CANCELLED' ? 'CANCELLED' : 'FAILED');
      return this.response(program, this.sourceRefs(programId, owner));
    } finally {
      if (timer) clearTimeout(timer);
      controller.signal.removeEventListener('abort', abortPending);
      // Abort acknowledgement is not process teardown. Retain ownership until
      // the backend and every admitted host read have actually settled.
      if (execution) await execution.catch(() => {});
      await Promise.allSettled([...reads]);
    }
  }

  private response(program: ToolProgramV1, sourceRefs: string[], aggregate?: unknown): ToolProgramResult {
    const result: ToolProgramResult = { programId: program.programId, state: program.state, resultRef: program.resultRef, sourceRefs: [...sourceRefs],
      ...(aggregate === undefined ? {} : { aggregate }), error: program.error,
      usage: { nestedCalls: program.nestedCallCount, elapsedMs: program.elapsedMs, visibleBytes: 0 } };
    return boundProgramResult(result, program.limits.maxOutputBytes, sourceRefs.length);
  }
  /** The final model-visible envelope after host metadata (for example a
   * Python kernel id and generation) is attached. It is re-measured and bounded
   * as one object, so usage.visibleBytes is the exact byte length returned. */
  finalResponse<T extends Record<string, unknown>>(result: ToolProgramResult, owner: ToolOwner, metadata: T): ToolProgramResult & T {
    const program = this.require(result.programId, owner);
    const final = { ...structuredClone(result), ...structuredClone(metadata), usage: { ...result.usage } } as ToolProgramResult & T;
    return boundProgramResult(final, program.limits.maxOutputBytes, result.sourceRefs.length + (result.sourceRefsOmitted ?? 0));
  }
  calls(programId: string, owner: ToolOwner): NestedCallV1[] {
    this.require(programId, owner);
    return this.store.all<NestedCallV1>('nestedCall', owner.threadId).filter(call => call.parentProgramId === programId);
  }
  private sourceRefs(programId: string, owner: ToolOwner): string[] { return this.calls(programId, owner).flatMap(call => call.resultRef ? [call.resultRef] : []); }
  inspect(programId: string, owner: ToolOwner) {
    const program = this.require(programId, owner);
    return { program, calls: this.calls(programId, owner), sourceRefs: this.sourceRefs(programId, owner) };
  }
  list(owner: ToolOwner): ReturnType<ToolPrograms['inspect']>[] {
    return this.store.all<ToolProgramV1>('toolProgram', owner.threadId).filter(program => sameOwner(program.owner, owner)).map(program => this.inspect(program.programId, owner));
  }
  async cancel(programId: string, owner: ToolOwner): Promise<void> {
    this.require(programId, owner);
    const active = this.active.get(programId);
    if (active) { active.controller.abort(cancelled()); await active.done; }
    else { const program = this.require(programId, owner); if (activeStates.has(program.state)) this.write({ ...program, state: 'CANCELLED', error: safeError(cancelled()) }, 'toolProgram.cancelled'); }
  }
  async cancelOwner(owner: ToolOwner): Promise<void> { await Promise.all(this.list(owner).map(({ program }) => this.cancel(program.programId, owner))); }
  recover(): void {
    const pending = (effect: ToolEffectRecord) => effect.state === 'PREPARED' || effect.state === 'DISPATCHED';
    // M12 always writes its own effects, independently of the M02 admission
    // flags. Recover only receipts whose complete M12 linkage is retained.
    // This never grants current-owner authority or starts an executor.
    for (const stored of this.store.all<ToolProgramV1>('toolProgram')) {
      const parsed = toolProgramV1Schema.safeParse(stored);
      if (!parsed.success || this.active.has(parsed.data.programId)) continue;
      const program = parsed.data, { programId, owner } = program;
      const privateProgram = this.store.get<PrivateProgram>('toolProgramPrivate', programId);
      const attempts = Number.isSafeInteger(privateProgram?.attempts) && privateProgram!.attempts > 0 ? privateProgram!.attempts : 0;
      const definition = parentDefinition(program.language), prefix = `${programId}:attempt:`;
      const parents = new Map<string, { effect: ToolEffectRecord; attempt: number }>();
      for (const effect of this.store.all<ToolEffectRecord>('toolEffect', owner.threadId)) {
        if (!effect.invocationId.startsWith(prefix)) continue;
        const suffix = effect.invocationId.slice(prefix.length), attempt = Number(suffix);
        if (!/^[1-9][0-9]*$/.test(suffix) || !Number.isSafeInteger(attempt) || attempt > attempts ||
          effect.threadId !== owner.threadId || !sameOwner(effect.owner, owner) || effect.parentInvocationId !== null ||
          effect.toolId !== definition.id || effect.definitionDigest !== definition.schemaDigest ||
          effect.privateArgumentCommitment !== this.host.effects.privateArgumentCommitment({ name: definition.id, args: { sourceDigest: program.sourceDigest } })) continue;
        parents.set(effect.invocationId, { effect, attempt });
      }
      for (const storedCall of this.store.all<NestedCallV1>('nestedCall', owner.threadId)) {
        const parsedCall = nestedCallV1Schema.safeParse(storedCall);
        if (!parsedCall.success) continue;
        const call = parsedCall.data;
        if (call.parentProgramId !== programId || call.invocationId !== `${programId}:${call.stableCallKey}` ||
          !sameOwner(call.owner, owner) || !program.allowedTools.includes(call.toolName) ||
          call.definitionDigest !== privateProgram?.definitions?.[call.toolName]) continue;
        const effect = this.host.effects.get(call.invocationId);
        let callDefinition: RegistryEntry | undefined;
        try { callDefinition = this.host.authority.require(call.toolName); } catch { callDefinition = undefined; }
        const bound = effect && effect.threadId === owner.threadId && sameOwner(effect.owner, owner) &&
          effect.invocationId === call.invocationId && effect.toolId === call.toolName &&
          effect.definitionDigest === callDefinition?.schemaDigest && effect.privateArgumentCommitment === call.argumentsCommitment &&
          effect.parentInvocationId !== null && parents.has(effect.parentInvocationId);
        let verified = false;
        if (call.resultRef && (call.state === 'SUCCEEDED' || call.state === 'FAILED')) {
          try {
            verified = this.host.results.recoveryMetadata(owner, call.resultRef, { programId, invocationId: call.invocationId }).status === call.state;
          } catch { /* Retain the handle, but never infer a result from invalid evidence. */ }
        }
        if (verified) {
          if (effect && bound && pending(effect)) this.host.effects.settle(call.invocationId,
            { value: { resultRef: call.resultRef }, ...(call.state === 'FAILED' ? { error: 'Private nested tool failed; inspect the retained source handle' } : {}) },
            call.state as 'SUCCEEDED' | 'FAILED', call.resultRef);
          continue;
        }
        // A call identity committed before effect admission is safe to issue
        // only through a later explicit, exact-owner replay. Do not discard it.
        if (call.state === 'PREPARED' && !effect && !call.resultRef) continue;
        if (effect || call.state === 'DISPATCHED' || call.resultRef) {
          if (call.state !== 'UNKNOWN') this.store.internal('toolProgram.call.recovered', owner.threadId, () => {
            this.store.put('nestedCall', call.invocationId, owner.threadId, { ...call, state: 'UNKNOWN',
              error: { code: call.resultRef ? 'CALL_RESULT_UNVERIFIED' : 'CALL_INTERRUPTED',
                message: 'No verified committed source result is available; the read was not repeated', originalResultRef: call.resultRef } });
            return { programId, stableCallKey: call.stableCallKey, state: 'UNKNOWN', resultRef: call.resultRef };
          });
          if (effect && bound && pending(effect)) this.host.effects.settle(call.invocationId,
            { error: 'Program interrupted without a verified committed source result' }, 'UNKNOWN_EXTERNAL_OUTCOME');
        }
      }
      for (const { effect, attempt } of parents.values()) {
        if (!pending(effect)) continue;
        let state: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN_EXTERNAL_OUTCOME' = 'UNKNOWN_EXTERNAL_OUTCOME';
        let resultRef: string | null = null;
        if (attempt === attempts && program.state === 'SUCCEEDED' && program.resultRef) {
          try {
            if (this.host.results.recoveryMetadata(owner, program.resultRef, { programId }).status === 'SUCCEEDED') {
              state = 'SUCCEEDED'; resultRef = program.resultRef;
            }
          } catch { /* A terminal label without its bound receipt is not enough. */ }
        } else if (attempt === attempts && (program.state === 'FAILED' || program.state === 'CANCELLED')) state = program.state;
        this.host.effects.settle(effect.invocationId,
          state === 'SUCCEEDED' ? { value: { programId, resultRef } }
            : { error: state === 'UNKNOWN_EXTERNAL_OUTCOME' ? 'Program execution ended without a verified terminal receipt' : 'Program execution ended; inspect its retained source handles' },
          state, resultRef);
      }
      if (activeStates.has(program.state)) this.write({ ...program, state: 'UNKNOWN',
        error: { code: 'PROGRAM_INTERRUPTED', message: 'Executor state was lost; no script or Python cell was rerun', originalResultRef: program.resultRef } }, 'toolProgram.recovered');
    }
  }
  async close(): Promise<void> {
    this.admissionStopped = true;
    for (const active of this.active.values()) active.controller.abort(cancelled());
    await Promise.allSettled([...this.active.values()].map(active => active.done));
    this.recover();
  }
}
