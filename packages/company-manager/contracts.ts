import {z} from 'zod';
import {CompanyProjectIdSchema} from '../company-contracts/index.ts';

export const COMPANY_MANAGER_MODEL = 'openai-codex/gpt-6.1-sol';
export const COMPANY_MANAGER_MAX_PROPOSAL_BYTES = 65536;
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0 && !value.includes('\0'));
const id = text(128);
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CompanyManagerInputSchema = z.strictObject({requestId: id, projectId: CompanyProjectIdSchema, instruction: text(16000)});
export type CompanyManagerInput = z.infer<typeof CompanyManagerInputSchema>;

/** A trusted host authorizer must verify this against actual company admission.
 * Parsing this record or supplying it in a request does not grant authority. */
export const CompanyManagerPermitSchema = z.strictObject({
  id, projectId: CompanyProjectIdSchema, employeeId: z.literal('E01'), machineId: id,
  machineGeneration: safeInteger.min(1),
  accountId: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i),
  modelId: z.literal(COMPANY_MANAGER_MODEL), thinkingLevel: z.literal('max'),
  policyRevision: id, receiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: safeInteger, expiresAt: safeInteger,
  maxModelRequests: safeInteger.min(1).max(50), maxToolCalls: safeInteger.min(1).max(100),
  maxDurationMs: safeInteger.min(1).max(300000),
}).refine(value => value.expiresAt > value.issuedAt, 'The permit must have a finite validity interval.');
export type CompanyManagerPermit = z.infer<typeof CompanyManagerPermitSchema>;
export interface CompanyManagerBootstrap {
  authorize(input: CompanyManagerInput, signal: AbortSignal): Promise<CompanyManagerPermit>;
  assertCurrent(permit: CompanyManagerPermit, signal: AbortSignal): Promise<void>;
}

const draftTask = z.strictObject({
  id, title: text(300), instructions: text(4000), dependsOn: z.array(id).max(11),
  proposedEmployeeId: z.string().regex(/^E(?:0[2-9]|[12][0-9]|3[0-2])$/).nullable(),
  sourceRefs: z.array(id).max(30),
  deliverable: z.enum(['code', 'research', 'design', 'media', 'business', 'documentation']),
  requiredEvidence: z.array(text(1000)).min(1).max(20),
});
export const CompanyManagerProposalSchema = z.strictObject({
  summary: text(5000), interpretation: text(16000), assumptions: z.array(text(2000)).max(20),
  tasks: z.array(draftTask).min(1).max(12),
  blockers: z.array(z.strictObject({kind: z.enum(['owner_decision', 'authorization', 'runtime', 'dependency', 'information']), detail: text(2000)})).max(20),
});
export type CompanyManagerProposal = z.infer<typeof CompanyManagerProposalSchema>;
export interface CompanyManagerDraft {
  readonly id: string;
  readonly kind: 'local_manager_draft';
  readonly state: 'unsubmitted';
  readonly authority: 'proposal_only';
  readonly evidenceScope: 'local_manager_output';
  readonly requestId: string;
  readonly projectId: string;
  readonly dispatchAuthorized: false;
  readonly companyReceipt: null;
  readonly permitId: string;
  readonly policyRevision: string;
  readonly sourceRefs: readonly string[];
  readonly createdAt: number;
  readonly digest: string;
  readonly content: CompanyManagerProposal;
}

const errors = {
  COMPANY_MANAGER_BLOCKED: 'Company manager admission is unavailable or no longer current.',
  COMPANY_MANAGER_INPUT: 'The company manager input or proposal is outside its bounded contract.',
  COMPANY_MANAGER_BUSY: 'The company manager still owns another request or uncertain cleanup.',
  COMPANY_MANAGER_MODEL: 'The exact company subscription model, account and reasoning are unavailable.',
  COMPANY_MANAGER_CANCELLED: 'The company manager request was cancelled.',
  COMPANY_MANAGER_LIMIT: 'The company manager request reached its approved bound.',
  COMPANY_MANAGER_FAILED: 'The company manager could not produce a verified draft.',
  COMPANY_MANAGER_CLEANUP: 'Company manager cleanup is unconfirmed; its ownership is retained.',
} as const;
export type CompanyManagerErrorCode = keyof typeof errors;
export class CompanyManagerError extends Error {
  constructor(readonly code: CompanyManagerErrorCode) {super(errors[code]); this.name = 'CompanyManagerError';}
}
