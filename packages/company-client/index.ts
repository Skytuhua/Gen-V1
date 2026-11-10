// Server-only transport: node:http sends directly to the pinned loopback address;
// it does not consult proxy environment variables or follow redirects.
import { request as httpRequest, type ClientRequest } from 'node:http';
import { z } from 'zod';
import {
  COMPANY_TRANSPORT, StatusInputSchema, CompanyStatusSchema, EmployeeStatusSchema,
  OwnerPlanInputSchema, OwnerStartInputSchema, OwnerControlInputSchema,
  ArtifactPreviewInputSchema, ReviewPackageInputSchema, EmployeeToolInputSchema,
  PlanningProposalSchema, StartResultSchema, PauseResultSchema, CancelResultSchema,
  ArtifactPreviewSchema, ReviewPackageSchema, EmployeeAssignmentSchema,
  type CompanyRole, type CompanyScope, type CompanyStatus, type EmployeeStatus,
  type OwnerPlanInput, type OwnerStartInput, type OwnerControlInput,
  type ArtifactPreviewInput, type ReviewPackageInput, type EmployeeToolInput,
} from '../company-contracts/index.ts';
import {
  COMPANY_MANAGER_TRANSPORT, ProjectContextInputSchema, ProjectContextResponseSchema,
  TaskContextInputSchema, TaskContextResponseSchema, contextResponseMatchesRequest,
  type ProjectContextInput, type ProjectContextResponse, type TaskContextInput, type TaskContextResponse,
} from '../company-contracts/manager.ts';
export type { ProjectContextInput, ProjectContextResponse, TaskContextInput, TaskContextResponse } from '../company-contracts/manager.ts';
import {
  COMPANY_PLANNING_TRANSPORT, COMPANY_PLANNING_HTTP_ERRORS, PlanningErrorResponseSchema,
  MandateSetInputSchema, MandateSetResponseSchema, IntakeRecordInputSchema, IntakeRecordResponseSchema,
  ProposalSubmitInputSchema, ProposalSubmitResponseSchema, ProposalReviewInputSchema, ProposalReviewResponseSchema,
  PlanningContextInputSchema, PlanningContextResponseSchema, planningReceiptMatchesRequest, planningContextMatchesRequest,
  type MandateSetInput, type MandateSetResponse, type IntakeRecordInput, type IntakeRecordResponse,
  type ProposalSubmitInput, type ProposalSubmitResponse, type ProposalReviewInput, type ProposalReviewResponse,
  type PlanningContextInput, type PlanningContextResponse, type PlanningWireErrorCode,
} from '../company-contracts/planning.ts';
export type {
  MandateSetInput, MandateSetResponse, IntakeRecordInput, IntakeRecordResponse,
  ProposalSubmitInput, ProposalSubmitResponse, ProposalReviewInput, ProposalReviewResponse,
  PlanningContextInput, PlanningContextResponse,
} from '../company-contracts/planning.ts';

const MESSAGES = Object.freeze({
  COMPANY_CONFIG: 'Company connection configuration is invalid.',
  COMPANY_FORBIDDEN: 'Company operation is outside this credential role.',
  COMPANY_REQUEST: 'Company request does not match the bounded contract.',
  COMPANY_AUTH: 'Company service authentication is unavailable.',
  COMPANY_TIMEOUT: 'Company service request exceeded its deadline.',
  COMPANY_TRANSPORT: 'Company service connection is unavailable.',
  COMPANY_RESPONSE: 'Company service response does not match the bounded contract.',
  COMPANY_HTTP: 'Company service rejected this request.',
  COMPANY_SNAPSHOT_CHANGED: 'Company context continuation is unavailable. Restart from the first page.',
  COMPANY_NOT_FOUND: 'The requested company planning record is unavailable.',
  COMPANY_MESSAGE_CONFLICT: 'This owner message identifies different planning arguments.',
  COMPANY_REVISION_CONFLICT: 'The company planning revision changed. Exact recovery or a new owner decision is required.',
  COMPANY_STALE_BASIS: 'The controlling company planning records changed.',
  COMPANY_REFERENCE_MISMATCH: 'The exact company planning reference does not match.',
  COMPANY_RECORD_TOO_LARGE: 'The company planning record exceeds its bounded contract.',
  COMPANY_STORAGE_UNAVAILABLE: 'Company planning storage is unavailable. Storage is unconfirmed.',
  COMPANY_CAPABILITY_UNAVAILABLE: 'This company planning capability is unavailable.',
});
export type CompanyErrorCode = keyof typeof MESSAGES;
const PLANNING_ERRORS: Readonly<Record<PlanningWireErrorCode, CompanyErrorCode>> = Object.freeze({
  invalid_request: 'COMPANY_REQUEST', authentication_required: 'COMPANY_AUTH', scope_denied: 'COMPANY_FORBIDDEN',
  not_found: 'COMPANY_NOT_FOUND', message_conflict: 'COMPANY_MESSAGE_CONFLICT', revision_conflict: 'COMPANY_REVISION_CONFLICT',
  stale_basis: 'COMPANY_STALE_BASIS', reference_mismatch: 'COMPANY_REFERENCE_MISMATCH', planning_record_too_large: 'COMPANY_RECORD_TOO_LARGE',
  planning_storage_unavailable: 'COMPANY_STORAGE_UNAVAILABLE', capability_unavailable: 'COMPANY_CAPABILITY_UNAVAILABLE',
});
export class CompanyError extends Error {
  readonly code: CompanyErrorCode;
  get restartRequired(): boolean { return this.code === 'COMPANY_SNAPSHOT_CHANGED'; }
  constructor(code: CompanyErrorCode) { super(MESSAGES[code]); this.name = 'CompanyError'; this.code = code; }
}
export interface CompanyClientOptions<Role extends CompanyRole = CompanyRole> {
  origin: string;
  credential: () => string | Promise<string>;
  role: Role;
  timeoutMs?: number;
}
function parse<T>(schema: z.ZodType<T>, input: unknown, code: CompanyErrorCode): T {
  try { const result = schema.safeParse(input); if (result.success) return result.data; } catch { /* Do not expose validation data or getter exceptions. */ }
  throw new CompanyError(code);
}
function copyContextInput<T>(schema: z.ZodType<T>, input: unknown): T {
  try { return parse(schema, structuredClone(input), 'COMPANY_REQUEST'); }
  catch { throw new CompanyError('COMPANY_REQUEST'); }
}
// JSON escaping can conceal a reflected bearer in the raw wire text. Walk the
// decoded, byte-bounded JSON without recursion before admitting any display data.
function reflectsCredential(input: unknown, token: string): boolean {
  const pending: unknown[] = [input];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string' && value.includes(token)) return true;
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (key.includes(token)) return true;
        pending.push(child);
      }
    }
  }
  return false;
}
export class CompanyClient<Role extends CompanyRole = 'owner'> {
  #port: number;
  #credential: () => string | Promise<string>;
  #role: Role;
  #timeoutMs: number;
  constructor(options: CompanyClientOptions<Role>) {
    const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(options.origin);
    const timeout = options.timeoutMs ?? COMPANY_TRANSPORT.defaultTimeoutMs;
    if (!match || Number(match[1]) > 65535 || !Number.isInteger(timeout) || timeout < 1 || timeout > COMPANY_TRANSPORT.maxTimeoutMs || typeof options.credential !== 'function' || !['owner', 'employee'].includes(options.role)) throw new CompanyError('COMPANY_CONFIG');
    this.#port = Number(match[1]); this.#credential = options.credential; this.#role = options.role; this.#timeoutMs = timeout;
  }
  get role(): Role { return this.#role; }
  #require(role: CompanyRole) { if (this.#role !== role) throw new CompanyError('COMPANY_FORBIDDEN'); }

  async status(scope: CompanyScope): Promise<Role extends 'owner' ? CompanyStatus : EmployeeStatus> {
    const input = parse(StatusInputSchema, { scope }, 'COMPANY_REQUEST');
    if (this.#role === 'employee' && input.scope.kind !== 'project') throw new CompanyError('COMPANY_FORBIDDEN');
    const value = await this.#send<CompanyStatus | EmployeeStatus>('status', input, this.#role === 'owner' ? CompanyStatusSchema : EmployeeStatusSchema);
    if (input.scope.kind === 'project') {
      if ('projects' in value) {
        if (value.project?.id !== input.scope.id || value.projects.length !== 1 || value.projects[0].id !== input.scope.id) throw new CompanyError('COMPANY_RESPONSE');
      } else if (value.project_id !== input.scope.id) throw new CompanyError('COMPANY_RESPONSE');
    }
    return value as Role extends 'owner' ? CompanyStatus : EmployeeStatus;
  }
  async plan(input: OwnerPlanInput) { this.#require('owner'); return this.#call('plan', OwnerPlanInputSchema, input, PlanningProposalSchema); }
  async start(input: OwnerStartInput) { this.#require('owner'); return this.#call('start', OwnerStartInputSchema, input, StartResultSchema); }
  async pause(input: OwnerControlInput) { this.#require('owner'); return this.#call('pause', OwnerControlInputSchema, input, PauseResultSchema); }
  async cancel(input: OwnerControlInput) { this.#require('owner'); return this.#call('cancel', OwnerControlInputSchema, input, CancelResultSchema); }
  async artifactPreview(input: ArtifactPreviewInput) {
    this.#require('owner');
    const body = parse(ArtifactPreviewInputSchema, input, 'COMPANY_REQUEST');
    const value = await this.#send('artifactPreview', body, ArtifactPreviewSchema);
    if (value.artifact_id !== body.artifact_id) throw new CompanyError('COMPANY_RESPONSE');
    return value;
  }
  async reviewPackage(input: ReviewPackageInput) { this.#require('owner'); return this.#call('reviewPackage', ReviewPackageInputSchema, input, ReviewPackageSchema); }
  async projectContext(input: ProjectContextInput): Promise<ProjectContextResponse> {
    this.#require('owner');
    const body = copyContextInput(ProjectContextInputSchema, input);
    const value = await this.#send('projectContext', body, ProjectContextResponseSchema);
    if (!contextResponseMatchesRequest(body, value)) throw new CompanyError('COMPANY_RESPONSE');
    return value;
  }
  async taskContext(input: TaskContextInput): Promise<TaskContextResponse> {
    this.#require('owner');
    const body = copyContextInput(TaskContextInputSchema, input);
    const value = await this.#send('taskContext', body, TaskContextResponseSchema);
    if (!contextResponseMatchesRequest(body, value)) throw new CompanyError('COMPANY_RESPONSE');
    return value;
  }
  async setMandate(input: MandateSetInput): Promise<MandateSetResponse> {
    this.#require('owner');
    const body = copyContextInput(MandateSetInputSchema, input);
    const value = await this.#send('setMandate', body, MandateSetResponseSchema);
    if (!planningReceiptMatchesRequest(body, value)) throw new CompanyError('COMPANY_RESPONSE');
    return value;
  }
  async recordIntake(input: IntakeRecordInput): Promise<IntakeRecordResponse> {
    this.#require('owner');
    const body = copyContextInput(IntakeRecordInputSchema, input);
    const value = await this.#send('recordIntake', body, IntakeRecordResponseSchema);
    if (!planningReceiptMatchesRequest(body, value)) throw new CompanyError('COMPANY_RESPONSE');
    return value;
  }
  async submitProposal(input: ProposalSubmitInput): Promise<ProposalSubmitResponse> {
    this.#require('owner');
    const body = copyContextInput(ProposalSubmitInputSchema, input);
    const value = await this.#send('submitProposal', body, ProposalSubmitResponseSchema);
    if (!planningReceiptMatchesRequest(body, value)) throw new CompanyError('COMPANY_RESPONSE');
    return value;
  }
  async reviewProposal(input: ProposalReviewInput): Promise<ProposalReviewResponse> {
    this.#require('owner');
    const body = copyContextInput(ProposalReviewInputSchema, input);
    const value = await this.#send('reviewProposal', body, ProposalReviewResponseSchema);
    if (!planningReceiptMatchesRequest(body, value)) throw new CompanyError('COMPANY_RESPONSE');
    return value;
  }
  async planningContext(input: PlanningContextInput): Promise<PlanningContextResponse> {
    this.#require('owner');
    const body = copyContextInput(PlanningContextInputSchema, input);
    const value = await this.#send('planningContext', body, PlanningContextResponseSchema);
    if (!planningContextMatchesRequest(body, value)) throw new CompanyError('COMPANY_RESPONSE');
    return value;
  }
  async employeeTool(input: EmployeeToolInput) {
    this.#require('employee');
    const body = parse(EmployeeToolInputSchema, input, 'COMPANY_REQUEST');
    if (body.tool === 'read_artifact') {
      const value = await this.#send('employeeTool', body, ArtifactPreviewSchema);
      if (value.artifact_id !== body.arguments.artifact_id) throw new CompanyError('COMPANY_RESPONSE');
      return value;
    }
    const value = await this.#send('employeeTool', body, body.tool === 'status_scoped' ? EmployeeStatusSchema : EmployeeAssignmentSchema);
    if (value.project_id !== body.project_id) throw new CompanyError('COMPANY_RESPONSE');
    return value;
  }
  async #call<Input, Output>(route: keyof typeof COMPANY_TRANSPORT.routes, inputSchema: z.ZodType<Input>, input: unknown, outputSchema: z.ZodType<Output>) {
    return this.#send(route, parse(inputSchema, input, 'COMPANY_REQUEST'), outputSchema);
  }
  async #send<Output>(route: keyof typeof COMPANY_TRANSPORT.routes | keyof typeof COMPANY_MANAGER_TRANSPORT.routes | keyof typeof COMPANY_PLANNING_TRANSPORT.routes, input: unknown, outputSchema: z.ZodType<Output>): Promise<Output> {
    const managerRoute = route === 'projectContext' || route === 'taskContext';
    const planningRoute = route === 'setMandate' || route === 'recordIntake' || route === 'submitProposal' || route === 'reviewProposal' || route === 'planningContext';
    const path = planningRoute ? COMPANY_PLANNING_TRANSPORT.routes[route] : managerRoute ? COMPANY_MANAGER_TRANSPORT.routes[route] : COMPANY_TRANSPORT.routes[route];
    const responseBytes = planningRoute ? COMPANY_PLANNING_TRANSPORT.responseBytes : managerRoute ? COMPANY_MANAGER_TRANSPORT.responseBytes : COMPANY_TRANSPORT.responseBytes;
    const requestBytes = planningRoute ? COMPANY_PLANNING_TRANSPORT.requestBytes : COMPANY_TRANSPORT.requestBytes;
    const body = Buffer.from(JSON.stringify(input), 'utf8');
    if (body.length > requestBytes) throw new CompanyError('COMPANY_REQUEST');
    return new Promise<Output>((resolve, reject) => {
      let settled = false, request: ClientRequest | undefined;
      const finish = (code?: CompanyErrorCode, value?: Output) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (code) { request?.destroy(); reject(new CompanyError(code)); } else resolve(value!);
      };
      const timer = setTimeout(() => finish('COMPANY_TIMEOUT'), this.#timeoutMs);
      // Include credential lookup in the same absolute deadline and suppress its
      // raw rejection. No credential is retained in serializable public fields.
      Promise.resolve().then(() => this.#credential()).then(token => {
        if (settled) return;
        if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) { finish('COMPANY_AUTH'); return; }
        try {
          request = httpRequest({
            hostname: '127.0.0.1', port: this.#port, method: 'POST', path, agent: false,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': body.length, Accept: 'application/json', Connection: 'close' },
          }, response => {
            const status = response.statusCode ?? 0;
            if (status !== 200 && (!planningRoute || status === 401 || status === 403)) { finish(status === 401 ? 'COMPANY_AUTH' : status === 403 ? 'COMPANY_FORBIDDEN' : managerRoute && status === 409 ? 'COMPANY_SNAPSHOT_CHANGED' : 'COMPANY_HTTP'); response.destroy(); return; }
            const length = response.headers['content-length'];
            if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers['content-type'] ?? '') || response.headers['content-encoding'] || (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) > responseBytes))) {
              finish('COMPANY_RESPONSE'); response.destroy(); return;
            }
            const chunks: Buffer[] = []; let size = 0;
            response.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > responseBytes) { finish('COMPANY_RESPONSE'); response.destroy(); return; }
              chunks.push(chunk);
            });
            response.on('error', () => finish('COMPANY_RESPONSE'));
            response.on('aborted', () => finish('COMPANY_RESPONSE'));
            response.on('end', () => {
              if (settled) return;
              try {
                const bytes = Buffer.concat(chunks);
                const raw = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
                // A service must never reflect the bearer into a successful DTO.
                if (raw.includes(token)) { finish('COMPANY_RESPONSE'); return; }
                const decoded: unknown = JSON.parse(raw);
                if (reflectsCredential(decoded, token)) { finish('COMPANY_RESPONSE'); return; }
                if (planningRoute && status !== 200) {
                  const error = parse(PlanningErrorResponseSchema, decoded, 'COMPANY_RESPONSE');
                  finish(COMPANY_PLANNING_HTTP_ERRORS[error.error.code] === status ? PLANNING_ERRORS[error.error.code] : 'COMPANY_RESPONSE');
                  return;
                }
                const value = parse(outputSchema, decoded, 'COMPANY_RESPONSE');
                finish(undefined, value);
              } catch { finish('COMPANY_RESPONSE'); }
            });
          });
          request.on('error', () => finish('COMPANY_TRANSPORT'));
          request.end(body);
        } catch { finish('COMPANY_TRANSPORT'); }
      }, () => finish('COMPANY_AUTH'));
    });
  }
}

export function createCompanyManagerTools(client: CompanyClient<CompanyRole>) {
  if (client.role !== 'employee') throw new CompanyError('COMPANY_FORBIDDEN');
  return Object.freeze({
    names: Object.freeze(['status_scoped', 'read_assignment', 'read_artifact'] as const),
    async invoke(input: unknown) { return client.employeeTool(parse(EmployeeToolInputSchema, input, 'COMPANY_REQUEST')); },
  });
}
