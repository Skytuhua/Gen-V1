import { randomUUID } from "node:crypto";
import { Store, digest, compactionOwnerKey, type CompactionAttemptRecord } from "../storage/store.ts";
import { capabilityEnabled } from "./capability-flags.ts";
import { HarnessError, EMPTY_USAGE, type HostCommand, type ResourceGrant, type RunContext, type RuntimeAdapter, type RuntimeEvent, type RuntimeUsage, type StartRun, type Thread } from "../contracts/index.ts";
import { createCompactionCandidateRegistry, applyCompactionCandidate } from './context-compaction.ts';
import { readCompactionHostCut, prepareNativeCompaction, nativeCompactionEnvelope, requireNativeCompactionReceipt } from './native-compaction-protection.ts';
import type { NativeCompactionAdmissionV1, NativeCompactionAckV1, NativeCompactionReceiptV1 } from '../contracts/native-compaction.ts';
import type { RequestContextV1 } from '../contracts/request-context.ts';
import type { RequestContextBasis } from './request-custody.ts';
import { SourceWorkbench, type PreparedSourceContext } from './source-workbench.ts';
import { WORKBENCH_LIMITS } from '../contracts/source-selection.ts';
import type { ProjectMemoryHost } from './project-memory-host.ts';
import { modelProvider } from './accounts.ts';
import { withApprovedProjectContext } from './approved-project-context.ts';
import { withResourceGrant } from "./file-access.ts";
import { modelRequestObservationV1Schema, type ModelRequestObservationV1 } from "../contracts/model-request.ts";

const now = () => new Date().toISOString();

/** Cross-domain members of `Service` the compaction domain calls back into. */
export interface ServiceCompactionHost {
	readonly store: Store;
	readonly runtime: RuntimeAdapter;
	readonly aborts: Map<string, AbortController>;
	readonly sourceWorkbench: SourceWorkbench;
	isClosed(): boolean;
	background(promise: Promise<unknown>): void;
	deliverOutbox(threadId: string): Promise<void>;
	thread(threadId: string): Thread;
	binding(thread: Thread, providerId: string): { accountId: string | null; bound: boolean };
	requestBasis(thread: Thread, modelId: string, thinkingLevel: string | null | undefined): RequestContextBasis;
	latestRequestReceipt(threadId: string): RequestContextV1 | null;
	retainController(control: AbortController): void;
	releaseController(threadId: string, control: AbortController): void;
	runtimeFailure(ctx: RunContext, error: unknown): void;
	assertNoOtherRun(threadId: string): void;
	memoryHost(): ProjectMemoryHost;
}

/** Loss-aware + native compaction domain extracted from `Service` (#1338 PR 1).
 * Pure move: the host keeps the cross-domain methods; this collaborator owns
 * the compaction registries and all admission/commit/observation work. */
export class ServiceCompaction {
	private readonly registry = createCompactionCandidateRegistry();
	private readonly inflight = new Map<string, Promise<void>>();
	private readonly nativeAdmissions = new Map<string, { request: NativeCompactionAdmissionV1; assertCurrent: () => void; attempted: boolean; accepted: boolean }>();
	private readonly modelOwners = new Map<string, { ctx: RunContext; candidateId: string; ownerKey: string; binding: CompactionAttemptRecord['metadata']['binding'] }>();

	constructor(private readonly host: ServiceCompactionHost) { }

	hasInflight(threadId: string): boolean { return this.inflight.has(threadId); }

	dispose(): void {
		this.nativeAdmissions.clear();
		this.modelOwners.clear();
	}

	apply(command: HostCommand, thread: Thread) {
		const prev = this.inflight.get(thread.id) ?? Promise.resolve();
		const run = prev.then(() => this.applyInner(command, thread));
		const tail = run.then(() => undefined, () => undefined);
		this.inflight.set(thread.id, tail);
		this.host.background(tail);
		tail.finally(() => {
			if (this.inflight.get(thread.id) !== tail) return;
			this.inflight.delete(thread.id);
			if (!this.host.isClosed()) this.host.background(this.host.deliverOutbox(thread.id));
		});
		return run;
	}

	commit(request: NativeCompactionAdmissionV1): NativeCompactionAckV1 {
		const gate = this.nativeAdmissions.get(request.candidateId);
		if (!gate || gate.attempted) throw new HarnessError('HERMES_COMPACTION_OWNER', 'No unused host admission owns this native commit.');
		gate.attempted = true;
		if (digest(request) !== digest(gate.request)) throw new HarnessError('HERMES_COMPACTION_OWNER', 'The native commit differs from its captured host owner.');
		gate.assertCurrent();
		gate.accepted = true;
		return { version: 1, accepted: true, planDigest: gate.request.planDigest };
	}

	recordModelObservation(event: RuntimeEvent): void {
		if (event.type !== 'model.observation' || !capabilityEnabled('models.requestMetricsV1')) return;
		const admitted = this.modelOwners.get(event.runId);
		if (!admitted || event.threadId !== admitted.ctx.threadId || event.epoch !== admitted.ctx.epoch) return;
		const parsed = modelRequestObservationV1Schema.safeParse(event.observation);
		if (!parsed.success) return;
		const value = parsed.data, owner = value.owner, binding = admitted.binding;
		if (owner.threadId !== admitted.ctx.threadId || owner.runId !== admitted.ctx.runId || owner.epoch !== admitted.ctx.epoch ||
			value.binding.modelId !== binding.modelId || value.binding.accountId !== binding.accountId || value.binding.providerId !== binding.modelId.split('/')[0]) return;
		const attempt = this.host.store.get<CompactionAttemptRecord>('compactionAttempt', admitted.candidateId);
		if (!attempt || attempt.id !== admitted.candidateId || attempt.threadId !== admitted.ctx.threadId || attempt.ownerKey !== admitted.ownerKey ||
			attempt.metadata.candidateId !== admitted.candidateId || digest(attempt.metadata.binding) !== digest(binding)) return;
		const id = `compactionModelRequest:${value.requestId}`;
		const old = this.host.store.get<{ candidateId: string; ownerKey: string; ctx: RunContext; value: ModelRequestObservationV1 }>('compactionModelRequest', id);
		// The broker may publish firstPublicDelta after its final observation. No
		// repeated request may change identity, usage or outcome, or charge twice.
		const immutable = (observation: ModelRequestObservationV1) => digest({ ...observation, timings: { ...observation.timings, firstPublicDelta: null } });
		if (old && (old.candidateId !== admitted.candidateId || old.ownerKey !== admitted.ownerKey || digest(old.ctx) !== digest(admitted.ctx) || immutable(old.value) !== immutable(value) ||
			old.value.timings.firstPublicDelta !== null && old.value.timings.firstPublicDelta !== value.timings.firstPublicDelta)) return;
		if (old && digest(old.value) === digest(value)) return;
		// This is a historical observation under the still-owned native call,
		// not permission to update a stopped/new owner or a complete spend total.
		this.host.store.internal('context.compaction.model_observed', admitted.ctx.threadId, () => this.host.store.put('compactionModelRequest', id, admitted.ctx.threadId,
			{ id, candidateId: admitted.candidateId, ownerKey: admitted.ownerKey, ctx: admitted.ctx, value }));
	}

	writeProjection(threadId: string): void {
		const old = this.host.store.get<{ value: RuntimeUsage }>('usage', threadId)?.value ?? EMPTY_USAGE;
		this.host.store.put('usage', threadId, threadId, { id: threadId, value: { ...old, compaction: this.host.store.compactionProjection(threadId) } });
	}

	private compactionBindingOf(receipt: RequestContextV1) {
		return { generation: receipt.contextGeneration, modelId: receipt.modelBinding.modelId, accountId: receipt.modelBinding.accountId, workspaceId: receipt.owner.workspaceId, instructionDigest: receipt.instructionDigest, toolRegistryDigest: receipt.toolRegistryDigest, sourceCut: receipt.sourceCut.revisionDigest };
	}

	private async applyInner(command: HostCommand, thread: Thread) {
		const duplicate = this.host.store.receipt(command); if (duplicate) return duplicate;
		const receipt = this.host.latestRequestReceipt(thread.id);
		if (!receipt || typeof this.host.runtime.nativeHistoryDigest !== 'function' || typeof this.host.runtime.compactProtected !== 'function')
			throw new HarnessError('UNSUPPORTED_COMPACTION', 'This adapter has no verified protected native compare-and-swap for loss-aware compaction');
		const currentGeneration = () => this.host.store.get<{ generation: number }>('requestContextGeneration', thread.id)?.generation ?? receipt.contextGeneration;
		const generation = currentGeneration();
		if (!Number.isSafeInteger(generation) || generation < receipt.contextGeneration || generation >= Number.MAX_SAFE_INTEGER) throw new HarnessError('INVALID_REQUEST_CONTEXT', 'The context generation counter is unavailable.');
		const captured = this.host.requestBasis(thread, thread.modelId!, thread.thinkingLevel), receiptDigest = digest(receipt);
		if (receipt.owner.threadId !== thread.id || receipt.owner.workspaceId !== captured.workspaceId || receipt.modelBinding.modelId !== captured.modelId || receipt.modelBinding.accountId !== captured.accountId)
			throw new HarnessError('STALE_REQUEST_CONTEXT', 'The last request belongs to a different compaction owner.');
		const stable = (basis: RequestContextBasis) => { const { admissionDigest: _admission, ...rest } = basis; return digest(rest); };
		const stableDigest = stable(captured);
		const beforeAdmission = () => {
			const current = this.host.thread(thread.id);
			if (!capabilityEnabled('context.lossAwareCompactionV1') || current.epoch !== thread.epoch || current.runId !== thread.runId || current.status !== thread.status ||
				digest(this.host.requestBasis(current, thread.modelId!, thread.thinkingLevel)) !== digest(captured) || digest(this.host.latestRequestReceipt(thread.id)) !== receiptDigest || currentGeneration() !== generation)
				throw new HarnessError('CANCELLED_RUN', 'The compaction owner or source cut changed during admission.');
			this.host.assertNoOtherRun(thread.id);
		};
		const memoryCheckpoint = capabilityEnabled('memory.projectV1') ? await this.host.memoryHost().requirement(thread.id) : undefined;
		beforeAdmission();
		// This reads the retained source without replacing its conversation owner.
		const inspection = { threadId: thread.id, runId: 'compaction-inspect:' + randomUUID(), epoch: thread.epoch };
		const snapshot = await this.host.runtime.nativeHistoryDigest(inspection, thread.sessionPath!, captured.accountId);
		beforeAdmission();
		if (!snapshot) throw new HarnessError('HERMES_COMPACTION_MISMATCH', 'The retained native history is unavailable.');
		const hostCut = readCompactionHostCut(this.host.store, thread.id, receipt);
		const prepared = prepareNativeCompaction(snapshot, hostCut.references);
		const sourceContexts: PreparedSourceContext[] = [];
		const assertHostCut = () => {
			if (readCompactionHostCut(this.host.store, thread.id, receipt).revisionDigest !== hostCut.revisionDigest)
				throw new HarnessError('STALE_REQUEST_CONTEXT', 'A protected decision, approval, work item or source choice changed.');
			for (const source of sourceContexts) source.assertCurrent();
		};
		const sourceOwner = this.host.sourceWorkbench.owner(thread.id);
		for (let offset = 0; offset < hostCut.sourceRefs.length; offset += WORKBENCH_LIMITS.maxSourceRefs) {
			sourceContexts.push(await this.host.sourceWorkbench.prepareSend(sourceOwner, hostCut.sourceRefs.slice(offset, offset + WORKBENCH_LIMITS.maxSourceRefs), { accepted: true }));
			beforeAdmission(); assertHostCut();
		}
		const binding = { ...this.compactionBindingOf(receipt), generation, sourceCut: digest([receipt.sourceCut.revisionDigest, prepared.sourceSha256, hostCut.revisionDigest]) };
		const { metadata, candidate } = this.registry.prepare({ binding, unresolvedRefs: prepared.retainedRefs, toolPairs: prepared.toolPairs, sourceInterval: prepared.sourceInterval });
		if (candidate.status === 'PREPARING') this.registry.markReady(metadata.candidateId);
		const ctx = Object.freeze({ threadId: thread.id, runId: `compaction:${metadata.candidateId}`, epoch: thread.epoch + 1, accountId: binding.accountId });
		const envelope = nativeCompactionEnvelope(prepared, metadata.candidateId, { threadId: ctx.threadId, runId: ctx.runId, epoch: ctx.epoch,
			workspaceId: binding.workspaceId, modelId: binding.modelId, accountId: binding.accountId, generation,
			instructionDigest: binding.instructionDigest, toolRegistryDigest: binding.toolRegistryDigest });
		const accepted = this.host.store.command(command, () => {
			beforeAdmission(); assertHostCut();
			this.host.store.put('runtimeIntent', ctx.runId, thread.id, { kind: 'compaction', previousStatus: thread.status });
			this.host.store.put('thread', thread.id, thread.id, { ...thread, runId: ctx.runId, epoch: ctx.epoch, status: 'working', error: null, updatedAt: now() });
			const entry = this.registry.get(metadata.candidateId)!;
			const attempt: CompactionAttemptRecord = { id: metadata.candidateId, threadId: thread.id, ownerKey: compactionOwnerKey(thread, binding.modelId, binding.accountId), ...entry, verdict: null };
			this.host.store.put('compactionAttempt', attempt.id, thread.id, attempt);
			this.writeProjection(thread.id);
			return ctx;
		});
		const assertCurrent = () => {
			const current = this.host.thread(thread.id);
			if (this.host.isClosed() || !capabilityEnabled('context.lossAwareCompactionV1') || current.epoch !== ctx.epoch || current.runId !== ctx.runId ||
				!['working', 'awaiting_input'].includes(current.status) || current.sessionPath !== thread.sessionPath || current.modelId !== thread.modelId ||
				this.host.binding(current, modelProvider(thread.modelId!)).accountId !== binding.accountId ||
				stable(this.host.requestBasis(current, thread.modelId!, current.thinkingLevel)) !== stableDigest || digest(this.host.latestRequestReceipt(thread.id)) !== receiptDigest || currentGeneration() !== generation)
				throw new HarnessError('CANCELLED_RUN', 'The compaction owner or source cut changed during native work.');
			assertHostCut();
		};
		let nativeError: unknown;
		const verdict = await applyCompactionCandidate({ candidate: this.registry.get(metadata.candidateId)!.candidate, expected: binding, current: binding, cancelled: false,
			retainedTailBytes: prepared.retainedBytes, maxRetainedTailBytes: 64 * 1024, nativeApply: async () => {
			try {
				assertCurrent();
				let ended = false, settled = false, completionError: unknown;
				const completed: { receipt?: NativeCompactionReceiptV1 } = {};
				const unsubscribe = this.host.store.subscribe(event => {
					const payload = (event.payload as { result?: { runId?: string } } | null)?.result;
					if (event.threadId !== thread.id || payload?.runId !== ctx.runId) return;
					if (event.type === 'runtime.compaction.end') ended = true;
					if (event.type === 'runtime.settled' && ended) settled = true;
				});
				const control = this.host.aborts.get(thread.id) ?? new AbortController(); this.host.aborts.set(thread.id, control); this.host.retainController(control);
				try {
					const expected = receipt.segments.find(segment => segment.sourceId === 'approved-project-instructions');
					const compact = async (projectContext: StartRun['approvedProjectContext'], assertProjectCurrent: () => void) => {
						const current = projectContext?.instructionText ? 'sha256:' + projectContext.instructionDigest : null;
						if ((expected?.contentRef ?? null) !== current || expected && current === null) throw new HarnessError('STALE_REQUEST_CONTEXT', 'Project instruction sources changed or are unavailable. Start a new turn before compacting.');
						const gate = { request: { version: 1 as const, candidateId: metadata.candidateId, planDigest: envelope.planDigest, sourceSha256: prepared.sourceSha256, owner: structuredClone(envelope.plan.owner) },
							attempted: false, accepted: false, assertCurrent: () => {
								if (control.signal.aborted) throw new HarnessError('CANCELLED_RUN', 'Native compaction was cancelled.');
								assertCurrent(); assertProjectCurrent();
							} };
						const retainSourceFiles = async (index: number): Promise<void> => {
							const ref = hostCut.sourceRefs[index];
							if (!ref) {
								gate.assertCurrent();
								this.nativeAdmissions.set(metadata.candidateId, gate);
								if (capabilityEnabled('models.requestMetricsV1')) this.modelOwners.set(ctx.runId, { ctx: { threadId: ctx.threadId, runId: ctx.runId, epoch: ctx.epoch },
									candidateId: metadata.candidateId, ownerKey: compactionOwnerKey(thread, binding.modelId, binding.accountId), binding: structuredClone(binding) });
								try {
									const result = await this.host.runtime.compactProtected!(ctx, thread.sessionPath!, thread.modelId!, binding.accountId, structuredClone(envelope), memoryCheckpoint);
									if (!gate.accepted) throw new HarnessError('HERMES_COMPACTION_UNCONFIRMED', 'The native source bypassed the host commit gate.');
									completed.receipt = requireNativeCompactionReceipt(result, envelope, prepared.toolPairs.length);
								} finally { this.modelOwners.delete(ctx.runId); this.nativeAdmissions.delete(metadata.candidateId); }
								return;
							}
							if (ref.keepCaptured || ref.source.kind !== 'FILE_RANGE') return retainSourceFiles(index + 1);
							const grant = this.host.store.get<ResourceGrant>('resource', ref.source.sourceId);
							if (!grant || grant.threadId !== thread.id) throw new HarnessError('STALE_REQUEST_CONTEXT', 'A retained file source lost its original grant.');
							await withResourceGrant(grant, this.host.store.dataDir, ref.source.path, false, control.signal, async () => {
								gate.assertCurrent();
								await retainSourceFiles(index + 1);
							}, { readOnly: true });
						};
						gate.assertCurrent();
						await retainSourceFiles(0);
					};
					if (expected || capabilityEnabled('context.compilerV1')) {
						const nativeInput: StartRun = { ...ctx, modelId: thread.modelId!, thinkingLevel: thread.thinkingLevel, sessionPath: thread.sessionPath!, inputId: ctx.runId, prompt: '', resources: this.host.store.all<ResourceGrant>('resource', thread.id) };
						await withApprovedProjectContext(this.host.store, nativeInput, control.signal, compact);
					} else await compact(undefined, () => { });
				} catch (cause) {
					// A checked native receipt records an applied historical fact. A later
					// guard cleanup failure cannot undo it or authorize another commit.
					if (!completed.receipt) throw cause;
					completionError = cause;
				} finally { unsubscribe(); this.host.releaseController(thread.id, control); }
				if (!completed.receipt) throw new HarnessError('HERMES_COMPACTION_UNCONFIRMED', 'The protected native source did not confirm application.');
				const proof = completed.receipt, usageObservationRef = `compactionUsage:${metadata.candidateId}`;
				const appliedGeneration = this.host.store.internal('context.compaction.applied', thread.id, () => {
					const previous = currentGeneration();
					if (!Number.isSafeInteger(previous) || previous < binding.generation || previous >= Number.MAX_SAFE_INTEGER) throw new HarnessError('INVALID_REQUEST_CONTEXT', 'The context generation counter is unavailable.');
					this.host.store.put('requestContextGeneration', thread.id, thread.id, { generation: previous + 1 });
					this.host.store.put('compactionUsage', metadata.candidateId, thread.id, { id: metadata.candidateId, threadId: thread.id,
						beforeBytes: proof.beforeBytes, afterBytes: proof.afterBytes, nativeReceipt: proof, settled,
						completionError: completionError instanceof Error ? completionError.message : completionError ? String(completionError) : null });
					// Keep the reference with its checked receipt even if terminal bookkeeping is interrupted.
					const attempt = this.host.store.get<CompactionAttemptRecord>('compactionAttempt', metadata.candidateId);
					if (attempt) this.host.store.put('compactionAttempt', attempt.id, thread.id, { ...attempt, metadata: { ...attempt.metadata, usageObservationRef } });
					return previous + 1;
				}) as number;
				// Only clean up this still-owned maintenance run; a newer owner is untouched.
				if (!settled) this.host.runtimeFailure(ctx, new HarnessError('HERMES_COMPACTION_UNCONFIRMED', 'Native compaction applied, but maintenance settlement was not confirmed.'));
				return { generation: appliedGeneration, usageObservationRef };
			} catch (cause) { nativeError = cause; throw cause; }
		} });
		if (verdict.status === 'APPLIED') this.registry.markApplied(metadata.candidateId);
		else if (verdict.status === 'FAILED') this.registry.markFailed(metadata.candidateId);
		else this.registry.markDiscarded(metadata.candidateId);
		if (verdict.status !== 'APPLIED') this.host.runtimeFailure(ctx, nativeError ?? new Error('Native compaction was not applied.'));
		if (!this.host.isClosed()) this.host.store.internal('context.compaction.observed', thread.id, () => {
			const attempt = this.host.store.get<CompactionAttemptRecord>('compactionAttempt', metadata.candidateId);
			if (attempt) this.host.store.put('compactionAttempt', attempt.id, thread.id, { ...attempt, candidate: this.registry.get(attempt.id)!.candidate, verdict: verdict.status });
			this.writeProjection(thread.id);
			if (this.host.store.get<Thread>('thread', thread.id)?.runId === null) { const usage = this.host.store.get<{ value: RuntimeUsage }>('usage', thread.id)!; this.host.store.put('usage', thread.id, thread.id, { ...usage, value: { ...usage.value, activity: 'idle' } }); }
		});
		if (verdict.status !== 'APPLIED') throw new HarnessError('COMPACTION_FAILED', nativeError instanceof Error ? nativeError.message : 'The verified native compaction apply failed.');
		return accepted;
	}
}
