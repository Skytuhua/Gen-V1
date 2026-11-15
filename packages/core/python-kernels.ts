import { randomUUID } from 'node:crypto';
import { HarnessError } from '../contracts/index.ts';
import type { ToolOwner } from '../contracts/tool-effects.ts';
import { sameToolOwner } from '../contracts/tool-results.ts';
import { pythonKernelIdentitySchema, pythonKernelV1Schema, type PythonKernelIdentity, type PythonKernelV1, type ProgramExecutor } from '../contracts/tool-program.ts';
import { digest, type Store } from '../storage/store.ts';
import type { PrepareToolProgram, ToolPrograms, ToolProgramResult } from './tool-programs.ts';

export const PYTHON_RESET_NOTICE = 'Reset clears variables. It does not undo files or prior remote effects. Previous cells are never replayed.';
export function pythonKernelKey(identity: PythonKernelIdentity): string { return digest(pythonKernelIdentitySchema.parse(identity)); }
export interface PythonKernelHooks {
  currentOwner(threadId: string): ToolOwner;
  enabled(): boolean;
}
export type PythonKernelFactory = (generation: number) => ProgramExecutor | Promise<ProgramExecutor>;
type CellInput = Omit<PrepareToolProgram, 'owner' | 'language'>;
interface OwnedKernel { executor: ProgramExecutor; factory: PythonKernelFactory; generation: number; stopping?: Promise<void> }
interface KernelSelection { kernelId: string; token: symbol }

/** Persisted kernel identity is not a process checkpoint. Only a live owned
 * executor can retain variables. Recovery always requires an explicit reset. */
export class PythonKernels {
  private readonly owned = new Map<string, OwnedKernel>();
  private readonly factories = new Map<string, PythonKernelFactory>();
  private readonly selections = new Map<string, KernelSelection>();
  private readonly teardowns = new Map<string, { owner: ToolOwner; done: Promise<void> }>();
  private closed = false;
  private closing?: Promise<void>;
  constructor(private readonly store: Store, private readonly programs: ToolPrograms, private readonly host: PythonKernelHooks) {}
  private current(owner: ToolOwner): void {
    if (this.closed || !this.host.enabled()) throw new HarnessError('KERNEL_DISABLED', 'Python kernels are disabled by the host');
    if (!sameToolOwner(owner, this.host.currentOwner(owner.threadId))) throw new HarnessError('KERNEL_OWNER_DENIED', 'Kernel owner is no longer current');
  }
  get(kernelId: string, owner: ToolOwner): PythonKernelV1 {
    const record = this.store.get<PythonKernelV1>('pythonKernel', kernelId);
    if (!record || !sameToolOwner(record.identity.owner, owner)) throw new HarnessError('KERNEL_OWNER_DENIED', 'Kernel is unavailable for this exact owner');
    return pythonKernelV1Schema.parse(record);
  }
  private put(record: PythonKernelV1, event: string): PythonKernelV1 {
    const checked = pythonKernelV1Schema.parse({ ...record, updatedAt: Date.now() });
    this.store.internal(event, checked.identity.owner.threadId, () => {
      this.store.put('pythonKernel', checked.kernelId, checked.identity.owner.threadId, checked);
      return { kernelId: checked.kernelId, generation: checked.generation, state: checked.state, retainedState: checked.retainedState };
    });
    return checked;
  }
  private checkExecutor(executor: ProgramExecutor): void {
    if (executor.proof.language !== 'PYTHON' || !executor.proof.tested || !executor.proof.hardMemoryLimit || executor.proof.isolation !== 'M03_CONFINED_PROCESS' || executor.proof.memoryLimitBytes > 128 * 1024 * 1024)
      throw new HarnessError('UNSUPPORTED_BACKEND', 'Python requires a tested M03 confined interpreter with a hard memory ceiling');
  }
  private select(owner: ToolOwner, kernelId: string): KernelSelection {
    const selection = { kernelId, token: Symbol(kernelId) };
    this.selections.set(digest(owner), selection); return selection;
  }
  private selected(owner: ToolOwner, selection: KernelSelection): void {
    this.current(owner);
    if (this.selections.get(digest(owner)) !== selection)
      throw new HarnessError('KERNEL_RESET_REQUIRED', 'A newer kernel selection superseded this interpreter admission');
  }
  private stopProcess(process: OwnedKernel): Promise<void> {
    return process.stopping ??= Promise.resolve().then(() => process.executor.stop());
  }
  private teardown(kernel: PythonKernelV1, process?: OwnedKernel): Promise<void> {
    const existing = this.teardowns.get(kernel.kernelId);
    if (existing) return existing.done;
    // Retain custody until cleanup actually settles. Other selections can
    // revoke this record immediately, but cannot launch beside its old process.
    const done = Promise.resolve().then(async () => {
      await Promise.all([process ? this.stopProcess(process) : undefined, kernel.activeProgramId ? this.programs.cancel(kernel.activeProgramId, kernel.identity.owner) : undefined]);
    });
    const pending = { owner: kernel.identity.owner, done };
    this.teardowns.set(kernel.kernelId, pending);
    void done.then(() => { if (this.teardowns.get(kernel.kernelId) === pending) this.teardowns.delete(kernel.kernelId); }, () => {
      // An unconfirmed teardown keeps admission blocked. It is not permission
      // to forget an old process and start a replacement.
    });
    return done;
  }
  private activate(expected: PythonKernelV1, executor: ProgramExecutor, factory: PythonKernelFactory, selection: KernelSelection, event: string): PythonKernelV1 {
    const process = { executor, factory, generation: expected.generation };
    const ready = pythonKernelV1Schema.parse({ ...expected, state: 'READY', updatedAt: Date.now() });
    try {
      this.store.internal(event, expected.identity.owner.threadId, () => {
        this.selected(expected.identity.owner, selection);
        const current = this.get(expected.kernelId, expected.identity.owner);
        // Compare the complete admission record inside the sole-writer
        // transaction. Recovery can revoke an admission without changing its
        // generation or RESET_REQUIRED state; Stop/Reset may also have won.
        if (expected.state !== 'RESET_REQUIRED' || digest(current) !== digest(expected) || this.owned.has(expected.kernelId)
            || [...this.teardowns.values()].some(pending => sameToolOwner(pending.owner, expected.identity.owner)))
          throw new HarnessError('KERNEL_RESET_REQUIRED', 'Kernel state changed while selecting the interpreter; the late executor cannot acquire ownership');
        this.store.put('pythonKernel', ready.kernelId, ready.identity.owner.threadId, ready);
        // Install before committed listeners run, so a reentrant Stop sees
        // and revokes this exact executor. No asynchronous work occurs here.
        this.owned.set(expected.kernelId, process);
        return { kernelId: ready.kernelId, generation: ready.generation, state: ready.state, retainedState: ready.retainedState };
      });
      return ready;
    } catch (error) {
      if (this.owned.get(expected.kernelId) === process) this.owned.delete(expected.kernelId);
      throw error;
    }
  }
  async create(input: PythonKernelIdentity, factory: PythonKernelFactory): Promise<PythonKernelV1> {
    const identity = pythonKernelIdentitySchema.parse(input), key = pythonKernelKey(identity);
    this.current(identity.owner);
    const existing = this.store.all<PythonKernelV1>('pythonKernel', identity.owner.threadId).find(kernel => kernel.key === key);
    if (existing) {
      this.factories.set(existing.kernelId, factory);
      if (existing.state === 'READY' && this.owned.has(existing.kernelId) && this.selections.get(digest(identity.owner))?.kernelId === existing.kernelId) return existing;
      throw new HarnessError(existing.state === 'RUNNING' ? 'KERNEL_BUSY' : 'KERNEL_RESET_REQUIRED', 'Kernel reset required; variables cannot be reconstructed from persisted metadata');
    }
    const kernelId = randomUUID(), selection = this.select(identity.owner, kernelId);
    // A changed interpreter/profile/tool set cannot leave two live processes
    // serving one owner or silently borrow variables from the old key.
    for (const kernel of this.store.all<PythonKernelV1>('pythonKernel', identity.owner.threadId)) {
      this.selected(identity.owner, selection);
      if (sameToolOwner(kernel.identity.owner, identity.owner) && (kernel.state !== 'STOPPED' || this.teardowns.has(kernel.kernelId))) await this.stop(kernel.kernelId, identity.owner);
    }
    this.selected(identity.owner, selection);
    const record = this.put({ version: 1, kernelId, key, identity, generation: 1, state: 'RESET_REQUIRED', activeProgramId: null,
      retainedState: false, updatedAt: Date.now(), error: null }, 'pythonKernel.created');
    this.factories.set(kernelId, factory);
    let executor: ProgramExecutor | undefined;
    try {
      this.selected(identity.owner, selection);
      executor = await factory(1); this.checkExecutor(executor); this.current(identity.owner);
      return this.activate(record, executor, factory, selection, 'pythonKernel.ready');
    } catch (error) { await executor?.stop(); throw error; }
  }
  async cell(kernelId: string, owner: ToolOwner, input: CellInput): Promise<ToolProgramResult> {
    this.current(owner);
    let kernel = this.get(kernelId, owner);
    const process = this.owned.get(kernelId);
    if (kernel.state === 'RUNNING') throw new HarnessError('KERNEL_BUSY', 'One cell is already running in this kernel');
    if (kernel.state !== 'READY' || !process || process.generation !== kernel.generation || this.selections.get(digest(owner))?.kernelId !== kernelId) throw new HarnessError('KERNEL_RESET_REQUIRED', 'Kernel reset required; no retained variables are available');
    const generation = kernel.generation;
    let preparedProgramId: string | undefined;
    kernel = this.put({ ...kernel, state: 'RUNNING', activeProgramId: null }, 'pythonKernel.cell.admitted');
    try {
      const program = await this.programs.prepare({ ...input, owner, language: 'PYTHON' }, process.executor);
      preparedProgramId = program.programId;
      const current = this.get(kernelId, owner);
      if (current.generation !== generation || current.state !== 'RUNNING') throw new HarnessError('KERNEL_RESET_REQUIRED', 'Kernel generation changed before cell dispatch');
      kernel = this.put({ ...current, activeProgramId: program.programId }, 'pythonKernel.cell.started');
      const result = await this.programs.run(program.programId, owner, process.executor);
      const after = this.get(kernelId, owner);
      if (after.generation === generation && after.state === 'RUNNING') {
        if (result.state === 'SUCCEEDED') this.put({ ...after, state: 'READY', activeProgramId: null, retainedState: true, error: null }, 'pythonKernel.cell.finished');
        else {
          this.owned.delete(kernelId);
          const cleanup = this.teardown(after, process);
          this.put({ ...after, state: 'RESET_REQUIRED', activeProgramId: null, retainedState: false,
            error: { code: 'KERNEL_RESET_REQUIRED', message: 'Kernel reset required after a failed or cancelled cell', originalResultRef: result.resultRef } }, 'pythonKernel.invalidated');
          await cleanup;
        }
      }
      return result;
    } catch (error) {
      const current = this.get(kernelId, owner);
      const ownsProcess = this.owned.get(kernelId) === process;
      if (ownsProcess) this.owned.delete(kernelId);
      const stopping = ownsProcess ? this.teardown({ ...current, activeProgramId: preparedProgramId ?? current.activeProgramId }, process) : this.stopProcess(process);
      if (current.generation === generation && current.state === 'RUNNING') this.put({ ...current, state: 'RESET_REQUIRED', activeProgramId: null, retainedState: false,
        error: { code: 'KERNEL_RESET_REQUIRED', message: 'Kernel reset required; cell state is unavailable', originalResultRef: null } }, 'pythonKernel.invalidated');
      const cleanup = await Promise.allSettled([stopping, !ownsProcess && preparedProgramId ? this.programs.cancel(preparedProgramId, owner) : undefined]);
      const unconfirmed = cleanup.find(result => result.status === 'rejected');
      if (unconfirmed?.status === 'rejected') throw unconfirmed.reason;
      throw error;
    }
  }
  async stop(kernelId: string, owner: ToolOwner): Promise<PythonKernelV1> {
    const kernel = this.get(kernelId, owner), process = this.owned.get(kernelId);
    if (this.selections.get(digest(owner))?.kernelId === kernelId) this.selections.delete(digest(owner));
    this.owned.delete(kernelId);
    const cleanup = this.teardown(kernel, process);
    // Persist revocation before asynchronous process cleanup. Late cells cannot
    // turn STOPPED back into READY or imply that variables survived.
    const stopped = this.put({ ...kernel, state: 'STOPPED', retainedState: false, activeProgramId: null }, 'pythonKernel.stopped');
    await cleanup;
    return stopped;
  }
  async reset(kernelId: string, owner: ToolOwner): Promise<PythonKernelV1> {
    this.current(owner);
    const kernel = this.get(kernelId, owner), process = this.owned.get(kernelId), factory = this.factories.get(kernelId);
    if (!factory) throw new HarnessError('KERNEL_RESET_REQUIRED', 'Select the installed approved interpreter again before resetting this kernel');
    const selection = this.select(owner, kernelId);
    this.owned.delete(kernelId);
    const cleanup = this.teardown(kernel, process);
    const next = this.put({ ...kernel, generation: kernel.generation + 1, state: 'RESET_REQUIRED', retainedState: false,
      activeProgramId: null, error: null }, 'pythonKernel.reset.started');
    await cleanup;
    this.selected(owner, selection);
    // Explicit reset of an old key selects it exclusively for this owner.
    // Every other live or stopping key must settle before its factory runs.
    for (const other of this.list(owner)) {
      this.selected(owner, selection);
      if (other.kernelId !== kernelId && (other.state !== 'STOPPED' || this.teardowns.has(other.kernelId))) await this.stop(other.kernelId, owner);
    }
    this.selected(owner, selection);
    if (digest(this.get(kernelId, owner)) !== digest(next)) throw new HarnessError('KERNEL_RESET_REQUIRED', 'A newer lifecycle transition superseded this reset');
    let executor: ProgramExecutor | undefined;
    try {
      executor = await factory(next.generation); this.checkExecutor(executor); this.current(owner);
      return this.activate(next, executor, factory, selection, 'pythonKernel.reset.finished');
    } catch (error) { await executor?.stop(); throw error; }
  }
  list(owner: ToolOwner): PythonKernelV1[] { return this.store.all<PythonKernelV1>('pythonKernel', owner.threadId).filter(kernel => sameToolOwner(kernel.identity.owner, owner)); }
  recover(): void {
    for (const kernel of this.store.all<PythonKernelV1>('pythonKernel')) {
      if (kernel.state === 'STOPPED' || this.owned.has(kernel.kernelId)) continue;
      if (this.selections.get(digest(kernel.identity.owner))?.kernelId === kernel.kernelId) this.selections.delete(digest(kernel.identity.owner));
      this.put({ ...kernel, state: 'RESET_REQUIRED', activeProgramId: null, retainedState: false,
        error: { code: 'KERNEL_RESET_REQUIRED', message: 'Kernel process was lost. Reset is required; previous cells were not replayed', originalResultRef: null } }, 'pythonKernel.recovered');
    }
  }
  async stopOwner(owner: ToolOwner): Promise<void> { this.selections.delete(digest(owner)); await Promise.all(this.list(owner).map(kernel => this.stop(kernel.kernelId, owner))); }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.selections.clear();
    this.closing = (async () => {
      const kernels = this.store.all<PythonKernelV1>('pythonKernel');
      for (const kernel of kernels) this.put({ ...kernel, generation: kernel.generation + 1, retainedState: false }, 'pythonKernel.generation.invalidated');
      await Promise.all(kernels.map(kernel => this.stop(kernel.kernelId, kernel.identity.owner)));
    })();
    return this.closing;
  }
}
