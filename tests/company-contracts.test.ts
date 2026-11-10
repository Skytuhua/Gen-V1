import { describe, expect, it } from 'vitest';
import {
  CompanyScopeSchema, CompanyStatusSchema, EmployeeToolInputSchema,
  OwnerPlanInputSchema, OwnerStartInputSchema, ReviewPackageSchema,
  COMPANY_PROTOCOL, COMPANY_SERVICE_BASELINE, COMPANY_TRANSPORT,
} from '../packages/company-contracts/index.ts';

describe('company transport contracts', () => {
  it('pins the existing eight POST routes and service source', () => {
    expect(Object.values(COMPANY_TRANSPORT.routes)).toHaveLength(8);
    expect(COMPANY_PROTOCOL).toBe('company-service.v1-draft1');
    expect(COMPANY_SERVICE_BASELINE).toBe('770b56620a6a8587a8c9e8e321e8c731cbb35807');
    expect(COMPANY_TRANSPORT.requestBytes).toBe(32768);
  });
  it('requires exact project or owner-company scopes', () => {
    expect(CompanyScopeSchema.parse({ kind: 'company', id: 'leo-company' })).toEqual({ kind: 'company', id: 'leo-company' });
    for (const scope of [{ kind: 'company', id: '*' }, { kind: 'project', id: '' }, { kind: 'project', id: 'Alpha', role: 'owner' }, { kind: 'company-ops', id: 'leo-company' }]) {
      expect(CompanyScopeSchema.safeParse(scope).success).toBe(false);
    }
  });
  it('rejects additional owner fields and requires exactly one start reference', () => {
    const input = { project_id: 'alpha', instruction: 'Plan a fix', message_id: 'message-1' };
    expect(OwnerPlanInputSchema.safeParse(input).success).toBe(true);
    expect(OwnerPlanInputSchema.safeParse({ ...input, approved: true }).success).toBe(false);
    expect(OwnerPlanInputSchema.safeParse({ ...input, instruction: 'x'.repeat(16001) }).success).toBe(false);
    const start = { project_id: 'alpha', message_id: 'message-2', proposal_id: 'proposal-1' };
    expect(OwnerStartInputSchema.safeParse(start).success).toBe(true);
    expect(OwnerStartInputSchema.safeParse({ ...start, work_order_id: 'work-1' }).success).toBe(false);
    expect(OwnerStartInputSchema.safeParse({ project_id: 'alpha', message_id: 'message-2' }).success).toBe(false);
  });
  it('admits only the three read-only employee tools with exact arguments', () => {
    for (const tool of ['status_scoped', 'read_assignment']) {
      expect(EmployeeToolInputSchema.safeParse({ project_id: 'alpha', tool, arguments: {} }).success).toBe(true);
    }
    expect(EmployeeToolInputSchema.safeParse({ project_id: 'alpha', tool: 'read_artifact', arguments: { artifact_id: 'artifact-1' } }).success).toBe(true);
    for (const tool of ['handoff', 'start', 'finance_aggregates', 'shell']) {
      expect(EmployeeToolInputSchema.safeParse({ project_id: 'alpha', tool, arguments: {} }).success).toBe(false);
    }
    expect(EmployeeToolInputSchema.safeParse({ project_id: 'alpha', tool: 'status_scoped', arguments: { employee_id: 'E02' } }).success).toBe(false);
  });
  it('cannot upgrade synthetic review or incomplete status into live acceptance', () => {
    const review = { synthetic_package_ready: true, evidence_scope: 'synthetic_contract', live_ready: false, company_accepted: false };
    expect(ReviewPackageSchema.safeParse(review).success).toBe(true);
    expect(ReviewPackageSchema.safeParse({ ...review, live_ready: true }).success).toBe(false);
    expect(CompanyStatusSchema.safeParse({ live_ready: false, targets: { employees: 32 } }).success).toBe(false);
  });
});
