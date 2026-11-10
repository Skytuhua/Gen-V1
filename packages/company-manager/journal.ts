import {isDeepStrictEqual} from 'node:util';
import type {Store} from '../storage/store.ts';
import {CompanyManagerError, CompanyManagerInputSchema, type CompanyManagerInput, type CompanyManagerDraft, type CompanyManagerErrorCode} from './contracts.ts';

export interface CompanyManager {
  propose(input: unknown, signal?: AbortSignal): Promise<CompanyManagerDraft>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}
export interface CompanyManagerInteraction {
  id: string; projectId: string; input: CompanyManagerInput;
  scope: 'local_ui_interaction'; companyReceipt: null;
  status: 'pending' | 'stop_requested' | 'draft_ready' | 'failed' | 'cancelled' | 'uncertain';
  createdAt: number; updatedAt: number;
  draft?: CompanyManagerDraft; errorCode?: CompanyManagerErrorCode;
}
type Active = {promise: Promise<CompanyManagerInteraction>; stopRequested: boolean; cancellation?: Promise<void>};
const kind = 'companyManagerInteraction';

/** Gen interaction recovery only. These rows are never company intakes, tasks or approvals. */
export class CompanyManagerJournal {
  private readonly active = new Map<string, Active>();
  private stopping = false;
  private closing?: Promise<void>;
  constructor(private readonly store: Store, private readonly manager: CompanyManager) {
    // A restarted client cannot prove that an interrupted native call terminated.
    for (const record of store.all<CompanyManagerInteraction>(kind)) {
      if (record.status === 'pending' || record.status === 'stop_requested') this.write({...record, status: 'uncertain', errorCode: 'COMPANY_MANAGER_CLEANUP'});
    }
  }
  private write(record: CompanyManagerInteraction) {
    const next = {...record, updatedAt: Date.now()};
    this.store.internal('company.manager.interaction', null, () => this.store.put(kind, next.id, null, next));
    return next;
  }
  get(projectId: string, requestId: string): CompanyManagerInteraction | null {
    const record = this.store.get<CompanyManagerInteraction>(kind, requestId);
    if (record && record.projectId !== projectId) throw new CompanyManagerError('COMPANY_MANAGER_INPUT');
    return record;
  }
  async propose(value: unknown): Promise<CompanyManagerInteraction> {
    if (this.stopping) throw new CompanyManagerError('COMPANY_MANAGER_BLOCKED');
    const parsed = CompanyManagerInputSchema.safeParse(value);
    if (!parsed.success) throw new CompanyManagerError('COMPANY_MANAGER_INPUT');
    const input = parsed.data, existing = this.get(input.projectId, input.requestId);
    if (existing) {
      if (!isDeepStrictEqual(existing.input, input)) throw new CompanyManagerError('COMPANY_MANAGER_INPUT');
      return this.active.get(input.requestId)?.promise ?? existing;
    }
    if (this.active.size || this.store.all<CompanyManagerInteraction>(kind).some(record => record.status === 'uncertain')) throw new CompanyManagerError('COMPANY_MANAGER_BUSY');
    // No eviction: dropping old request identities could silently repeat inference.
    if (this.store.all(kind).length >= 64) throw new CompanyManagerError('COMPANY_MANAGER_LIMIT');
    const record = this.write({id: input.requestId, projectId: input.projectId, input, scope: 'local_ui_interaction', companyReceipt: null, status: 'pending', createdAt: Date.now(), updatedAt: Date.now()});
    const entry: Active = {promise: Promise.resolve(record), stopRequested: false};
    this.active.set(input.requestId, entry);
    entry.promise = (async () => {
      try {
        const draft = await this.manager.propose(input);
        if (entry.cancellation) await entry.cancellation;
        if (entry.stopRequested) return this.write({...record, status: 'cancelled'});
        if (draft.projectId !== input.projectId || draft.requestId !== input.requestId || draft.kind !== 'local_manager_draft' || draft.dispatchAuthorized !== false || draft.companyReceipt !== null) throw new CompanyManagerError('COMPANY_MANAGER_FAILED');
        return this.write({...record, status: 'draft_ready', draft});
      } catch (error) {
        let failure = error instanceof CompanyManagerError ? error : new CompanyManagerError('COMPANY_MANAGER_FAILED');
        if (entry.cancellation) try {await entry.cancellation;} catch {failure = new CompanyManagerError('COMPANY_MANAGER_CLEANUP');}
        const uncertain = failure.code === 'COMPANY_MANAGER_CLEANUP';
        return this.write({...record, status: uncertain ? 'uncertain' : entry.stopRequested ? 'cancelled' : 'failed', errorCode: failure.code});
      } finally {this.active.delete(input.requestId);}
    })();
    return entry.promise;
  }
  async cancel(projectId: string, requestId: string): Promise<CompanyManagerInteraction | null> {
    const record = this.get(projectId, requestId), entry = this.active.get(requestId);
    if (!entry) return record;
    entry.stopRequested = true;
    if (record) this.write({...record, status: 'stop_requested'});
    entry.cancellation ??= Promise.resolve().then(() => this.manager.cancel());
    // Observe rejection immediately; the interaction's settlement records it.
    void entry.cancellation.catch(() => {});
    return entry.promise;
  }
  dispose(): Promise<void> {
    this.stopping = true;
    return this.closing ??= (async () => {
      const entries = [...this.active.entries()];
      for (const [, entry] of entries) entry.stopRequested = true;
      const recordStop = Promise.resolve().then(() => {
        for (const [id, entry] of entries) {
          if (this.active.get(id) !== entry) continue;
          const record = this.store.get<CompanyManagerInteraction>(kind, id);
          if (record && (record.status === 'pending' || record.status === 'stop_requested')) this.write({...record, status: 'stop_requested'});
        }
      });
      const results = await Promise.allSettled([recordStop, Promise.resolve().then(() => this.manager.dispose()), ...entries.map(([, entry]) => entry.promise)]);
      if (results.some(result => result.status === 'rejected')) throw new CompanyManagerError('COMPANY_MANAGER_CLEANUP');
    })();
  }
}
