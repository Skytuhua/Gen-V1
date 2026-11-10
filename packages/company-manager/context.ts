import {createHash, randomUUID} from 'node:crypto';
import type {createCompanyManagerTools} from '../company-client/index.ts';
import {COMPANY_TRANSPORT, EmployeeAssignmentSchema} from '../company-contracts/index.ts';
import {CompanyManagerError, CompanyManagerPermitSchema, type CompanyManagerPermit} from './contracts.ts';

export const COMPANY_CONTEXT_MAX_BYTES = 16 * 1024;
export const COMPANY_CONTEXT_MAX_ASSIGNMENTS = 20;

export interface CompanyContextPacket {
  readonly projectId: string;
  readonly employeeId: 'E01';
  readonly capturedAt: number;
  readonly assignments: readonly {readonly taskId: string; readonly state: string; readonly workOrderId: string}[];
  readonly receipt: {
    readonly id: string;
    readonly kind: 'client_observation';
    readonly source: 'company_service';
    readonly operation: 'read_assignment';
    readonly projectId: string;
    readonly employeeId: 'E01';
    readonly bodyDigest: string;
    readonly receivedAt: number;
    readonly sourceRevision: null;
    readonly evidenceScope: 'synthetic_only';
  };
  readonly truncated: boolean;
  /** Complete only for assignment metadata in this observed response. */
  readonly complete: boolean;
  readonly liveReady: false;
  readonly knowledgeAvailability: 'unavailable';
}

/** The trusted host supplies the employee-only factory adapter and checks current
 * admission around capture. Structural tool validation does not grant authority. */
export function createCompanyContextSource(tools: ReturnType<typeof createCompanyManagerTools>, options: {now?: () => number} = {}) {
  let invoke: typeof tools.invoke;
  let now: () => number;
  try {
    const names = ['status_scoped', 'read_assignment', 'read_artifact'];
    if (!Array.isArray(tools.names) || tools.names.length !== names.length || tools.names.some((name, i) => name !== names[i]) || typeof tools.invoke !== 'function') throw new Error();
    invoke = tools.invoke.bind(tools); now = options.now ?? Date.now;
    if (typeof now !== 'function') throw new Error();
  } catch {throw new CompanyManagerError('COMPANY_MANAGER_BLOCKED');}
  return Object.freeze({
    async capture(permit: CompanyManagerPermit, signal: AbortSignal): Promise<CompanyContextPacket> {
      let admitted: CompanyManagerPermit;
      try {admitted = CompanyManagerPermitSchema.parse(permit);} catch {throw new CompanyManagerError('COMPANY_MANAGER_BLOCKED');}
      const current = () => {
        let aborted: boolean;
        try {aborted = signal.aborted; if (typeof aborted !== 'boolean') throw new Error();}
        catch {throw new CompanyManagerError('COMPANY_MANAGER_INPUT');}
        if (aborted) throw new CompanyManagerError('COMPANY_MANAGER_CANCELLED');
        let time: number;
        try {time = now();} catch {throw new CompanyManagerError('COMPANY_MANAGER_BLOCKED');}
        if (!Number.isSafeInteger(time) || time < admitted.issuedAt || time >= admitted.expiresAt) throw new CompanyManagerError('COMPANY_MANAGER_BLOCKED');
        return time;
      };
      current();
      let raw: unknown;
      try {raw = await invoke({project_id: admitted.projectId, tool: 'read_assignment', arguments: {}});}
      catch {current(); throw new CompanyManagerError('COMPANY_MANAGER_FAILED');}
      const receivedAt = current();
      try {
        if (!raw || typeof raw !== 'object' || !('project_id' in raw) || !('employee_id' in raw)) throw new Error();
        // Refuse scope before accessing assignments or any other content.
        if (raw.project_id !== admitted.projectId || raw.employee_id !== admitted.employeeId) throw new CompanyManagerError('COMPANY_MANAGER_BLOCKED');
        const value = EmployeeAssignmentSchema.parse(raw), body = JSON.stringify(value);
        if (Buffer.byteLength(body, 'utf8') > COMPANY_TRANSPORT.responseBytes) throw new CompanyManagerError('COMPANY_MANAGER_LIMIT');
        const assignments = value.assignments.slice(0, COMPANY_CONTEXT_MAX_ASSIGNMENTS).map(item => Object.freeze({taskId: item.task_id, state: item.state, workOrderId: item.work_order_id}));
        const packet = {
          projectId: admitted.projectId, employeeId: admitted.employeeId, capturedAt: receivedAt, assignments,
          receipt: Object.freeze({
            id: randomUUID(), kind: 'client_observation' as const, source: 'company_service' as const, operation: 'read_assignment' as const,
            projectId: admitted.projectId, employeeId: admitted.employeeId,
            // Digest of the validated client observation, not a server revision.
            bodyDigest: createHash('sha256').update(body).digest('hex'), receivedAt, sourceRevision: null,
            evidenceScope: value.evidence_scope,
          }),
          truncated: assignments.length < value.assignments.length, complete: assignments.length === value.assignments.length,
          liveReady: value.live_ready, knowledgeAvailability: 'unavailable' as const,
        };
        while (Buffer.byteLength(JSON.stringify(packet), 'utf8') > COMPANY_CONTEXT_MAX_BYTES) {
          if (!assignments.length) throw new CompanyManagerError('COMPANY_MANAGER_LIMIT');
          assignments.pop(); packet.truncated = true; packet.complete = false;
        }
        current(); Object.freeze(assignments); return Object.freeze(packet);
      } catch (error) {throw error instanceof CompanyManagerError ? error : new CompanyManagerError('COMPANY_MANAGER_INPUT');}
    },
  });
}
