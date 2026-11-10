// Server-only fixed owner connection. No browser/engine credential or Store.
import {request as httpRequest, type ClientRequest} from 'node:http';
import {captureWorkPlanRequest, validateWorkPlanResponse, validateWorkPlanError, WORK_PLAN_PIN, WorkPlanError,
  type WorkPlanOperation, type WorkPlanRequests, type WorkPlanResponses, type WorkPlanErrorCode,
  type WorkPlanProposeRequest, type WorkPlanReadRequest, type WorkPlanAuthorizeRequest} from '../company-contracts/work-plan.ts';
import {prepareWorkOrderTasksRequest, validateWorkOrderTasksResponse, type WorkOrderTasksContext, type WorkOrderTasksRequest} from '../company-contracts/work-order-tasks.ts';
export {WorkPlanError, WORK_PLAN_PIN};
export interface WorkPlanClientOptions {origin: string; role: 'owner'; credential: () => string | Promise<string>; timeoutMs?: number}
function reflected(value: unknown, token: string) {
  const pending: unknown[] = [value];
  while (pending.length) {const item = pending.pop(); if (typeof item === 'string' && item.includes(token)) return true; if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {if (key.includes(token)) return true; pending.push(child);}}
  return false;
}
export class WorkPlanClient {
  #port: number; #credential: WorkPlanClientOptions['credential']; #timeoutMs: number;
  constructor(options: WorkPlanClientOptions) {
    try {
      if (!options || typeof options !== 'object' || Reflect.ownKeys(options).some(key => typeof key !== 'string' || !['origin', 'role', 'credential', 'timeoutMs'].includes(key))) throw 0;
      const {origin, role, credential, timeoutMs = 3000} = options;
      const match = typeof origin === 'string' && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
      if (!match || Number(match[1]) > 65535 || role !== 'owner' || typeof credential !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw 0;
      this.#port = Number(match[1]); this.#credential = credential; this.#timeoutMs = timeoutMs;
    } catch {throw new WorkPlanError('CONFIG');}
  }
  get role(): 'owner' {return 'owner';}
  propose(input: WorkPlanProposeRequest, signal?: AbortSignal) {return this.#send('propose', input, signal);}
  read(input: WorkPlanReadRequest, signal?: AbortSignal) {return this.#send('read', input, signal);}
  authorize(input: WorkPlanAuthorizeRequest, signal?: AbortSignal) {return this.#send('authorize', input, signal);}
  async materialize(input: WorkOrderTasksRequest, context: WorkOrderTasksContext, signal?: AbortSignal) {
    const captured = await prepareWorkOrderTasksRequest(input, context);
    return this.#post('materialize', captured.body, raw => validateWorkOrderTasksResponse(raw, captured.request, captured.context), signal);
  }
  async #send<K extends WorkPlanOperation>(operation: K, input: WorkPlanRequests[K], signal?: AbortSignal): Promise<WorkPlanResponses[K]> {
    // Synchronous clone/schema/semantics/wire bound before the credential await.
    const {request: captured, body} = captureWorkPlanRequest(operation, input);
    return this.#post(operation, body, raw => validateWorkPlanResponse(operation, raw, captured), signal);
  }
  #post<Output>(operation: WorkPlanOperation | 'materialize', body: string, validate: (raw: Uint8Array) => Promise<Output>, signal?: AbortSignal): Promise<Output> {
    return new Promise<Output>((resolve, reject) => {
      let settled = false, request: ClientRequest | undefined;
      const deadline = performance.now() + this.#timeoutMs;
      const abort = () => finish(new WorkPlanError('ABORTED'));
      const finish = (error?: WorkPlanError, result?: Output) => {
        if (settled) return;
        if (error?.code !== 'ABORTED' && performance.now() >= deadline) error = new WorkPlanError('TIMEOUT');
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); request?.destroy();
        if (error) reject(error); else resolve(result!);
      };
      const fail = (code: WorkPlanErrorCode) => finish(new WorkPlanError(code));
      const timer = setTimeout(() => fail('TIMEOUT'), this.#timeoutMs);
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) {abort(); return;}
      void (async () => {
        let token: string;
        try {token = await this.#credential();} catch {finish(new WorkPlanError('authentication_required', 401)); return;}
        if (settled) return;
        if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) {finish(new WorkPlanError('authentication_required', 401)); return;}
        if (performance.now() >= deadline) {fail('TIMEOUT'); return;}
        try {
          request = httpRequest({hostname: '127.0.0.1', port: this.#port, method: 'POST', path: `/v1/owner/work-plan/${operation}`, agent: false, maxHeaderSize: 16384,
            headers: {Host: `127.0.0.1:${this.#port}`, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body, 'utf8'), Connection: 'close'}}, response => {
            if (settled) {response.destroy(); return;}
            const counts = new Map<string, number>();
            for (let at = 0; at < response.rawHeaders.length; at += 2) {const name = response.rawHeaders[at].toLowerCase(); counts.set(name, (counts.get(name) ?? 0) + 1);}
            const length = response.headers['content-length'], status = response.statusCode ?? 0;
            if (counts.get('content-length') !== 1 || counts.get('content-type') !== 1 || counts.has('transfer-encoding') || counts.has('content-encoding') || typeof length !== 'string' || !/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > WORK_PLAN_PIN.responseBytes || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers['content-type'] ?? '') || status < 200 || status > 599) {fail('RESPONSE'); response.destroy(); return;}
            let size = 0; const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => {if (settled) return; size += chunk.length; if (size > WORK_PLAN_PIN.responseBytes) {fail('RESPONSE'); response.destroy();} else chunks.push(chunk);});
            response.on('error', () => fail('RESPONSE')); response.on('aborted', () => fail('RESPONSE'));
            response.on('end', () => {
              if (settled) return;
              void (async () => {
                try {
                  const raw = Buffer.concat(chunks);
                  if (!response.complete || raw.length !== Number(length)) {fail('RESPONSE'); return;}
                  if (status !== 200) {finish(validateWorkPlanError(raw, status)); return;}
                  const result = await validate(raw);
                  if (reflected(result, token)) {fail('RESPONSE'); return;}
                  finish(undefined, result);
                } catch {fail('RESPONSE');}
              })();
            });
          });
          request.on('error', () => fail('TRANSPORT')); request.end(body, 'utf8');
        } catch {fail('TRANSPORT');}
      })();
    });
  }
}
