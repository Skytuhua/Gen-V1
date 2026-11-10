import {z} from 'zod';
import {ApiError, authenticated, bootstrap, csrfToken, read} from '../api';
import {COMPANY_PROTOCOL, COMPANY_TRANSPORT, OwnerPlanInputSchema, PlanningProposalSchema, type OwnerPlanInput} from '../../../../packages/company-contracts';
import type {WorkPlanAuthorizeRequest, WorkPlanAuthorizeResponse, WorkPlanProposeRequest, WorkPlanProposeResponse, WorkPlanReadRequest, WorkPlanReadResponse} from '../../../../packages/company-contracts/work-plan';
import {captureApprovedJobRead} from '../../../../packages/company-contracts/approved-job-read';

export const WorkflowAvailabilitySchema = z.object({
  protocol: z.literal(COMPANY_PROTOCOL), mode: z.literal('planning_only'), recordInstruction: z.boolean(),
  authorize: z.literal(false), progress: z.literal(false), result: z.literal(false), blockers: z.array(z.string().max(1024)).max(1024),
  workPlans: z.object({configured: z.boolean(), readOnly: z.boolean().optional()}).optional(),
  approvedJob: z.unknown().transform(captureApprovedJobRead).optional(),
});
export const InstructionReceiptSchema = z.object({
  protocol: z.literal(COMPANY_PROTOCOL), source: z.literal('company_service'), receivedAt: z.iso.datetime(), proposal: PlanningProposalSchema,
});
export type WorkflowAvailability = z.infer<typeof WorkflowAvailabilitySchema>;
export type InstructionReceipt = z.infer<typeof InstructionReceiptSchema>;
export function captureCompanyInstruction(input: unknown) {
  const captured = OwnerPlanInputSchema.parse(structuredClone(input)), body = JSON.stringify(captured);
  if (new TextEncoder().encode(body).byteLength > COMPANY_TRANSPORT.requestBytes) throw new ApiError('COMPANY_REQUEST', 'The task is too large to submit. Shorten the instruction.');
  return {captured, body};
}
export async function getCompanyWorkflow(signal?: AbortSignal): Promise<WorkflowAvailability> {
  const value = await authenticated(() => fetch('/api/company/workflow', {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal})).then(read);
  return WorkflowAvailabilitySchema.parse(value);
}
export async function recordCompanyInstruction(input: OwnerPlanInput, signal?: AbortSignal): Promise<InstructionReceipt> {
  const {captured, body} = captureCompanyInstruction(input);
  await bootstrap();
  // A mutation gets one attempt. Even an upstream 401 must not cause an implicit
  // resend; explicit recovery uses the same durable message_id and original body.
  const value = await fetch('/api/company/workflow/instruction', {method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    headers: {'Content-Type': 'application/json', 'x-harness-csrf': csrfToken}, body}).then(read);
  const receipt = InstructionReceiptSchema.parse(value);
  if (receipt.proposal.project_id !== captured.project_id || receipt.proposal.instruction !== captured.instruction) throw new ApiError('COMPANY_RESPONSE', 'The response did not match the saved task request.');
  return receipt;
}

type WorkPlanRequests = {propose: WorkPlanProposeRequest; read: WorkPlanReadRequest; authorize: WorkPlanAuthorizeRequest};
type WorkPlanResponses = {propose: WorkPlanProposeResponse; read: WorkPlanReadResponse; authorize: WorkPlanAuthorizeResponse};
export async function companyWorkPlan<Operation extends keyof WorkPlanRequests>(operation: Operation, input: WorkPlanRequests[Operation], signal?: AbortSignal): Promise<WorkPlanResponses[Operation]> {
  const owned = structuredClone(input); // Retain caller intent before any await.
  const boundary = await import('../../../../packages/company-contracts/work-plan');
  const captured = boundary.captureWorkPlanRequest(operation, owned);
  await bootstrap();
  // One explicit HTTP attempt. A lost mutation response is reconciled by exact
  // plan read, never by the personal API's automatic resend helper.
  const response = await fetch(`/api/company/workflow/work-plan/${operation}`, {method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    headers: {'Content-Type': 'application/json', 'x-harness-csrf': csrfToken}, body: captured.body});
  const chunks: Uint8Array[] = []; let length = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('COMPANY_RESPONSE', 'The work plan response was unavailable.');
  try {
    for (;;) {const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > 262144) {await reader.cancel(); throw new ApiError('COMPANY_RESPONSE', 'The work plan response exceeded its bound.');} chunks.push(next.value);}
  } finally {reader.releaseLock();}
  const raw = new Uint8Array(length); let at = 0; for (const chunk of chunks) {raw.set(chunk, at); at += chunk.byteLength;}
  if (!response.ok) {
    const codes = ['invalid_request', 'authentication_required', 'scope_denied', 'not_found', 'stale_plan', 'stale_basis', 'command_conflict', 'already_authorized', 'authorization_expired', 'scoped_replanning_unavailable', 'prerequisite_unavailable', 'request_timeout', 'request_too_large', 'unsupported_media_type'];
    let code = response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'COMPANY_FORBIDDEN' : 'COMPANY_UNAVAILABLE';
    try {const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw)); if (codes.includes(value?.error?.code)) code = value.error.code;} catch { /* Non-JSON errors remain inert. */ }
    throw new ApiError(code, 'The company service did not confirm this exact work plan operation.');
  }
  return boundary.validateWorkPlanResponse(operation, raw, captured.request) as Promise<WorkPlanResponses[Operation]>;
}
