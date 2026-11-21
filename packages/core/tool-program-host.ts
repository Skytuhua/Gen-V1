import { HarnessError, type CommandReceipt, type HostCommand, type RunContext, type ToolCall } from '../contracts/index.ts';
import { toolOwnerSchema, type ToolOwner } from '../contracts/tool-effects.ts';
import { sameToolOwner } from '../contracts/tool-results.ts';
import type { ProgramExecutor, PythonKernelIdentity, ToolProgramV1, PythonKernelV1 } from '../contracts/tool-program.ts';
import { Store, digest } from '../storage/store.ts';
import { ToolDisclosure } from './tool-disclosure.ts';
import { PrivateToolResults } from './tool-results.ts';
import { ToolPrograms, type ToolProgramResult } from './tool-programs.ts';
import { PythonKernels, PYTHON_RESET_NOTICE, pythonKernelKey, type PythonKernelFactory } from './python-kernels.ts';
import { createToolProgramFlags, type M12FlagKey } from './capability-flags.ts';
import type { ToolAuthority } from './tool-authority.ts';
import type { ToolEffectLedger } from './tool-effects.ts';
import { PROGRAM_TOOLS, programArguments, pythonCellArguments, programDiscoveryArguments, programResultArguments } from './tool-program-tools.ts';

/** Only trusted host composition supplies executors and approval configuration. */
export interface ToolProgramHostOptions {
  flags?: Partial<Record<M12FlagKey, boolean>>;
  javascript?: ProgramExecutor;
  python?: { configure(owner: ToolOwner, toolRegistryDigest: string, protectedDataDir: string): Promise<{ identity: PythonKernelIdentity; factory: PythonKernelFactory }> };
}
interface Hooks {
  authority: ToolAuthority;
  effects: ToolEffectLedger;
  currentOwner(threadId: string): ToolOwner;
  retainedOwner(owner: ToolOwner): void;
  executeRead(call: ToolCall, owner: ToolOwner, signal: AbortSignal): Promise<unknown>;
}
interface ProgramRequest {
  owner: ToolOwner;
  commitment: string;
  state: 'CLAIMED' | 'FINISHED' | 'FAILED';
  result?: ToolProgramResult & { kernelId?: string; generation?: number };
}
export class ToolProgramHost {
  readonly programs: ToolPrograms;
  readonly kernels: PythonKernels;
  readonly results: PrivateToolResults;
  readonly disclosure: ToolDisclosure;
  private readonly flags;
  private readonly commands = new Map<string, Promise<CommandReceipt>>();
  private closing?: Promise<void>;
  private admissionStopped = false;
  constructor(private readonly store: Store, private readonly hooks: Hooks, private readonly options: ToolProgramHostOptions = {}) {
    this.flags = createToolProgramFlags(options.flags);
    this.results = new PrivateToolResults(store, { currentOwner: hooks.currentOwner, authorizeRetainedOwner: hooks.retainedOwner });
    this.disclosure = new ToolDisclosure(store, hooks.authority, { currentOwner: hooks.currentOwner });
    this.programs = new ToolPrograms(store, { ...hooks, disclosure: this.disclosure, results: this.results, enabled: key => this.flags.enabled(key) });
    this.kernels = new PythonKernels(store, this.programs, { currentOwner: hooks.currentOwner, enabled: () => this.flags.enabled('tools.pythonKernelV1') });
  }
  available() {
    if (this.admissionStopped) return { javascript: false, python: false, replay: false };
    return { javascript: this.flags.enabled('tools.jsReadProgramV1') && !!this.options.javascript,
      python: this.flags.enabled('tools.pythonKernelV1') && !!this.options.python,
      replay: this.flags.enabled('tools.jsReadProgramV1') && this.flags.enabled('tools.durableReplayExperimentV1') && !!this.options.javascript };
  }
  metadata() {
    const available = this.available();
    if (!available.javascript && !available.python) return [];
    return PROGRAM_TOOLS.filter(tool => tool.name !== 'tool_program' || available.javascript).filter(tool => tool.name !== 'python_cell' || available.python).map(tool => structuredClone(tool));
  }
  async tool(call: ToolCall, owner: ToolOwner): Promise<unknown> {
    const available = this.available();
    if (!available.javascript && !available.python || call.name === 'tool_program' && !available.javascript || call.name === 'python_cell' && !available.python)
      throw new HarnessError('PROGRAM_DISABLED', 'The requested program capability is disabled or has no tested backend');
    if (!sameToolOwner(owner, this.hooks.currentOwner(owner.threadId))) throw new HarnessError('PROGRAM_OWNER_REVOKED', 'The program owner changed');
    if (call.name === 'tool_program_discover') {
      const args = programDiscoveryArguments.parse(call.args);
      return args.names ? { tools: this.disclosure.disclose(owner, args.names) } : { tools: this.disclosure.index(owner), detail: 'Request exact names to disclose their schemas before program admission.' };
    }
    if (call.name === 'tool_program_result') {
      const args = programResultArguments.parse(call.args), program = this.programs.inspect(args.programId, owner);
      if (![program.program.resultRef, ...program.sourceRefs, ...program.program.inputRefs].includes(args.resultRef)) throw new HarnessError('RESULT_ACCESS_DENIED', 'Result is not a retained source of this program');
      return this.results.range(owner, args.resultRef, { programId: args.programId, offset: args.offset, limit: args.limit });
    }
    const args = (call.name === 'python_cell' ? pythonCellArguments : programArguments).parse(call.args);
    const key = digest({ owner, commandId: args.commandId }), commitment = digest({ name: call.name, args });
    const previous = this.store.get<ProgramRequest>('toolProgramRequest', key);
    if (previous) {
      if (!sameToolOwner(previous.owner, owner) || previous.commitment !== commitment) throw new HarnessError('DUPLICATE_PROGRAM_REQUEST', 'Program command ID was reused with different content');
      if (!previous.result) throw new HarnessError('PROGRAM_OUTCOME_UNKNOWN', 'The earlier program request has no confirmed result. It will not be automatically rerun');
      const result = previous.result;
      for (const ref of [...result.sourceRefs, ...(result.resultRef ? [result.resultRef] : [])]) await this.results.read(owner, ref, { programId: result.programId });
      return result;
    }
    this.store.internal('toolProgram.request.claimed', owner.threadId, () => {
      this.store.put('toolProgramRequest', key, owner.threadId, { owner, commitment, state: 'CLAIMED' } satisfies ProgramRequest);
      return { requestId: key, state: 'CLAIMED' };
    });
    let preparedProgramId: string | undefined;
    try {
      const { commandId: _commandId, ...input } = args;
      let result: ProgramRequest['result'];
      if (call.name === 'python_cell') {
        const selection = this.disclosure.snapshot(owner, input.allowedTools);
        const configured = await this.options.python!.configure(owner, selection.registryDigest, this.store.dataDir);
        if (!sameToolOwner(configured.identity.owner, owner) || configured.identity.toolRegistryDigest !== selection.registryDigest)
          throw new HarnessError('KERNEL_IDENTITY_CHANGED', 'Host Python configuration does not match the selected owner and tools');
        const selectedId = 'kernelId' in args && typeof args.kernelId === 'string' ? args.kernelId : undefined;
        const kernel = selectedId ? this.kernels.get(selectedId, owner) : await this.kernels.create(configured.identity, configured.factory);
        if (kernel.key !== pythonKernelKey(configured.identity)) throw new HarnessError('KERNEL_IDENTITY_CHANGED', 'Interpreter, configuration, working directory or tool set changed; use a new kernel');
        result = this.programs.finalResponse(await this.kernels.cell(kernel.kernelId, owner, input), owner, { kernelId: kernel.kernelId, generation: kernel.generation });
      } else {
        const program = await this.programs.prepare({ ...input, owner, language: 'JAVASCRIPT' }, this.options.javascript!);
        preparedProgramId = program.programId;
        result = await this.programs.run(program.programId, owner, this.options.javascript!);
      }
      this.store.internal('toolProgram.request.finished', owner.threadId, () => {
        this.store.put('toolProgramRequest', key, owner.threadId, { owner, commitment, state: 'FINISHED', result } satisfies ProgramRequest);
        return { requestId: key, programId: result.programId, state: result.state };
      });
      return result;
    } catch (error) {
      // run() may reject before it owns an executor (busy lane, revoked owner,
      // disabled admission). Do not leave that prepared card active forever.
      if (preparedProgramId) await this.programs.cancel(preparedProgramId, owner);
      this.store.internal('toolProgram.request.failed', owner.threadId, () => {
        this.store.put('toolProgramRequest', key, owner.threadId, { owner, commitment, state: 'FAILED' } satisfies ProgramRequest);
        return { requestId: key, state: 'FAILED' };
      });
      throw error;
    }
  }
  view(threadId: string) {
    const allPrograms = this.store.all<ToolProgramV1>('toolProgram', threadId), allKernels = this.store.all<PythonKernelV1>('pythonKernel', threadId);
    const authorized = (owner: ToolOwner) => { try { this.hooks.retainedOwner(owner); return true; } catch { return false; } };
    return { programs: allPrograms.filter(program => authorized(program.owner)).slice(-100).map(program => this.programs.inspect(program.programId, program.owner)),
      kernels: allKernels.filter(kernel => authorized(kernel.identity.owner)).slice(-100), available: this.available(), resetNotice: PYTHON_RESET_NOTICE };
  }
  async range(threadId: string, programId: string, resultRef: string, range: { offset: number; limit: number }) {
    const program = this.store.get<ToolProgramV1>('toolProgram', programId);
    if (!program || program.owner.threadId !== threadId) throw new HarnessError('PROGRAM_OWNER_REVOKED', 'Program is unavailable for this thread');
    this.hooks.retainedOwner(program.owner);
    const view = this.programs.inspect(programId, program.owner);
    if (![program.resultRef, program.error?.originalResultRef, ...program.inputRefs, ...view.sourceRefs].includes(resultRef)) throw new HarnessError('RESULT_ACCESS_DENIED', 'Result is not a retained source of this program');
    return this.results.rangeRetained(program.owner, resultRef, range);
  }
  async command(command: HostCommand): Promise<CommandReceipt> {
    const duplicate = this.store.receipt(command); if (duplicate) return duplicate;
    const pending = this.commands.get(command.id); if (pending) { await pending; return this.store.receipt(command)!; }
    const owner = toolOwnerSchema.parse(command.payload.owner);
    if (command.threadId !== owner.threadId) throw new HarnessError('PROGRAM_OWNER_REVOKED', 'The command thread does not match its exact owner');
    this.hooks.retainedOwner(owner);
    const work = (async () => {
      if (command.type === 'toolProgram.cancel') {
        const id = String(command.payload.programId ?? ''); this.programs.inspect(id, owner);
        await this.programs.cancel(id, owner);
        return this.store.command(command, () => ({ programId: id, state: this.programs.inspect(id, owner).program.state }));
      }
      if (!['pythonKernel.stop', 'pythonKernel.reset'].includes(command.type)) throw new HarnessError('INVALID_COMMAND', 'Unknown program command');
      const id = String(command.payload.kernelId ?? ''), kernel = this.kernels.get(id, owner);
      if (command.payload.generation !== kernel.generation) throw new HarnessError('KERNEL_GENERATION_CHANGED', 'The displayed kernel generation changed');
      const next = command.type === 'pythonKernel.reset' ? await this.kernels.reset(id, owner) : await this.kernels.stop(id, owner);
      return this.store.command(command, () => ({ kernelId: id, generation: next.generation, state: next.state, retainedState: next.retainedState, resetNotice: PYTHON_RESET_NOTICE }));
    })();
    this.commands.set(command.id, work);
    try { return await work; } finally { this.commands.delete(command.id); }
  }
  async cancelOwner(owner: ToolOwner) { await Promise.all([this.programs.cancelOwner(owner), this.kernels.stopOwner(owner)]); }
  async cancelRun(ctx: RunContext) {
    const owners = new Map<string, ToolOwner>();
    for (const program of this.store.all<ToolProgramV1>('toolProgram', ctx.threadId)) {
      if (program.owner.runId === ctx.runId && program.owner.epoch === ctx.epoch) owners.set(digest(program.owner), program.owner);
    }
    for (const kernel of this.store.all<PythonKernelV1>('pythonKernel', ctx.threadId)) {
      const owner = kernel.identity.owner;
      if (owner.runId === ctx.runId && owner.epoch === ctx.epoch) owners.set(digest(owner), owner);
    }
    await Promise.all([...owners.values()].map(owner => this.cancelOwner(owner)));
  }
  recover() { this.programs.recover(); this.kernels.recover(); }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.admissionStopped = true;
    this.closing = (async () => {
      const outcomes = await Promise.allSettled([this.kernels.close(), this.programs.close(), this.options.javascript?.stop()]);
      const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
      if (failures.length) throw new AggregateError(failures, 'Program worker cleanup could not be confirmed');
    })();
    return this.closing;
  }
}
