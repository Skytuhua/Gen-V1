import type {MemoryPreparedRequest, MemoryRevisionRef} from '../../../packages/contracts/project-memory';
import {memoryOwnerKey, type MemoryOwner} from './project-memory-api';
import {excludeMemoryFromRequest, latestMemoryRequest, prepareMemoryRequest} from './project-memory-request-api';
import {errorMessage} from '../../../packages/ui-shell/format-utils';

export interface MemoryRequestInput {owner: MemoryOwner; prompt: string; modelId: string; thinkingLevel: string | null; ownerVersion?: string}
export const memoryRequestKey = (input?: MemoryRequestInput) => input ? JSON.stringify([memoryOwnerKey(input.owner), input.prompt, input.modelId, input.thinkingLevel, input.ownerVersion]) : '';
export interface MemoryPreparationTransport {
  prepare(input: MemoryRequestInput, signal: AbortSignal): Promise<MemoryPreparedRequest | null>;
  latest(owner: MemoryOwner, signal: AbortSignal): Promise<MemoryPreparedRequest | null>;
  exclude(view: MemoryPreparedRequest, revision: MemoryRevisionRef, signal: AbortSignal): Promise<MemoryPreparedRequest>;
}
export interface MemoryPreparationState {key: string; view: MemoryPreparedRequest | null; pending: boolean; blocked: boolean; error: string}
const initial = (key = ''): MemoryPreparationState => ({key, view: null, pending: false, blocked: false, error: ''});

/** Request previews and exclusion state live only in this renderer owner, never its journal. */
export class MemoryPreparationController {
  private state = initial();
  private generation = 0;
  private abort?: AbortController;
  private listeners = new Set<() => void>();
  constructor(private readonly transport: MemoryPreparationTransport = {prepare: prepareMemoryRequest, latest: latestMemoryRequest, exclude: excludeMemoryFromRequest}) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private emit(value: MemoryPreparationState) {this.state = value; for (const listener of this.listeners) listener();}
  bind(input?: MemoryRequestInput) {
    const key = memoryRequestKey(input); if (key === this.state.key) return;
    this.generation++; this.abort?.abort(); this.emit(initial(key));
  }
  async inspect(input: MemoryRequestInput) {
    this.bind(input); this.abort?.abort(); const abort = new AbortController(); this.abort = abort;
    const generation = ++this.generation, key = this.state.key;
    this.emit({...initial(key), pending: true, blocked: Boolean(input.prompt)});
    try {
      const view = await (input.prompt ? this.transport.prepare(input, abort.signal) : this.transport.latest(input.owner, abort.signal));
      if (generation !== this.generation || abort.signal.aborted) return;
      this.emit({...initial(key), view});
    } catch (cause) {
      if (generation !== this.generation || abort.signal.aborted) return;
      this.emit({...initial(key), blocked: Boolean(input.prompt), error: errorMessage(cause,'Context preparation failed. Refresh before sending.')});
    }
  }
  async exclude(revision: MemoryRevisionRef) {
    const {view, key} = this.state;
    if (!view || view.phase !== 'PREPARING' || this.state.pending || this.state.blocked || !view.items.some(item => item.id === revision.itemId && item.revision === revision.revision)) throw Error('This prepared request cannot be changed. Refresh context before sending.');
    const generation = this.generation, abort = new AbortController(); this.abort = abort;
    this.emit({...this.state, pending: true, blocked: true, error: ''});
    try {
      const updated = await this.transport.exclude(view, revision, abort.signal);
      if (generation !== this.generation || abort.signal.aborted) return;
      this.emit({...initial(key), view: updated});
    } catch (cause) {
      if (generation !== this.generation || abort.signal.aborted) return;
      const error = errorMessage(cause,'Exclusion was not confirmed. Refresh context before sending.');
      this.emit({...this.state, pending: false, blocked: true, error}); throw Error(error);
    }
  }
  requestContextId(input?: MemoryRequestInput): string | undefined {
    this.bind(input);
    if (!input?.prompt) return;
    if (this.state.pending || this.state.blocked) throw Error(this.state.error || 'Wait for context preparation and exclusion to finish before sending.');
    const view = this.state.view; if (view?.phase !== 'PREPARING') return;
    if (Date.parse(view.expiresAt) <= Date.now()) throw Error('Prepared context expired. Refresh context before sending.');
    return view.requestId;
  }
  dispose() {this.generation++; this.abort?.abort(); this.listeners.clear(); this.state = initial();}
}
