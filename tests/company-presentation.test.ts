import {describe, expect, it} from 'vitest';
import {companyBlockers, companyCount, companyManagerAccess, companyMarketing, companyRecordLabel, projectTaskTotal, recoverCompanySelection, sourceTime, taskCounts} from '../apps/web/src/company/presentation';
import type {CompanyProject, CompanyStatus} from '../apps/web/src/company/api';

describe('company presentation keeps reported facts separate from local selections', () => {
  it('does not invent counts for absent, invalid or unbounded values', () => {
    expect(companyCount(undefined)).toBe('Unavailable');
    expect(companyCount(-1)).toBe('Unavailable');
    expect(companyCount('32')).toBe('Unavailable');
    expect(companyCount(Number.MAX_SAFE_INTEGER + 1)).toBe('Unavailable');
    expect(companyCount(0)).toBe('0');
    expect(companyCount(32)).toBe('32');
  });
  it('rejects a misleading aggregate when any task count is invalid', () => {
    const project: CompanyProject = {id: 'project-fixture', name: 'Synthetic project', state: 'draft', scheduler_paused: false, task_counts: {queued: 3, completed: 2}, occupied_synthetic_slots: 0};
    expect(projectTaskTotal(project)).toBe('5');
    expect(taskCounts(project)).toEqual([{state: 'queued', count: 3}, {state: 'completed', count: 2}]);
    project.task_counts.failed = -1;
    expect(projectTaskTotal(project)).toBe('Unavailable');
    expect(taskCounts(project)).not.toContainEqual({state: 'failed', count: -1});
    expect(projectTaskTotal({...project, task_counts: {}})).toBe('Unavailable');
  });
  it('guards optional marketing JSON before rendering records', () => {
    const project: CompanyProject = {id: 'project-fixture', name: 'Synthetic project', state: 'draft', scheduler_paused: false, task_counts: {}, occupied_synthetic_slots: 0};
    expect(companyMarketing(project).unavailable).toBe(true);
    project.marketing = {status: 'available', campaigns: [{id: 'campaign-fixture', state: 'draft_only', goal: '<script>untrusted text</script>'}], new_service_field: {opaque: true}};
    expect(companyMarketing(project)).toMatchObject({unavailable: false, campaigns: [{id: 'campaign-fixture', goal: '<script>untrusted text</script>'}]});
    project.marketing = {campaigns: 'not-an-array'};
    expect(companyMarketing(project).unavailable).toBe(true);
  });
  it('preserves unavailable marketing instead of turning missing ledgers into zero records', () => {
    const project: CompanyProject = {id: 'project-fixture', name: 'Synthetic project', state: 'draft', scheduler_paused: false, task_counts: {}, occupied_synthetic_slots: 0};
    const samples: NonNullable<CompanyProject['marketing']>[] = [{status: 'unavailable'}, {status: 'blocked'}, {}, {status: 'future_semantics', campaigns: []}];
    for (const marketing of samples) {
      expect(companyMarketing({...project, marketing}).unavailable).toBe(true);
    }
  });
  it('recovers only supported local view selections and bounds stored fields', () => {
    expect(recoverCompanySelection({view: 'dispatch', projectId: 42, filter: null})).toEqual({view: 'manager', projectId: '', filter: ''});
    expect(recoverCompanySelection({view: 'people', projectId: 'project-a', filter: 'Hermes'})).toEqual({view: 'people', projectId: 'project-a', filter: 'Hermes'});
    expect(recoverCompanySelection({filter: 'x'.repeat(300)}).filter).toHaveLength(200);
  });
  it('does not turn local planning capability into company-message delivery authority', () => {
    expect(companyManagerAccess(undefined).canSend).toBe(false);
    expect(companyManagerAccess({configured: false}).canSend).toBe(false);
    const planning = {configured: true, mode: 'shadow_proposals', admission: 'checked_per_request', dispatchAuthorized: false, durableCompanyStorage: false, blockers: []} as const;
    expect(companyManagerAccess(planning)).toMatchObject({canSend: false, title: "Your manager isn't connected yet"});
    expect(companyManagerAccess(planning).reason).toContain('local plan drafts');
    expect(companyManagerAccess({configured: true, mode: 'unknown'}).canSend).toBe(false);
  });
  it('identifies test evidence without treating a missing source as real records', () => {
    expect(companyRecordLabel('synthetic_only')).toBe('Test evidence only');
    expect(companyRecordLabel(undefined)).toBe('Record source unverified');
    expect(companyRecordLabel('company_records')).toBe('Company records');
    expect(companyRecordLabel('future_evidence')).toBe('Record source unverified');
  });
  it('retains source blockers without claiming that an empty list clears readiness', () => {
    const status = {blockers: ['native_dispatch_unavailable', 'native_dispatch_unavailable', 'synthetic_only']} as CompanyStatus;
    expect(companyBlockers(status, ['not_connected', 'native_dispatch_unavailable'])).toEqual(['not_connected', 'native_dispatch_unavailable', 'synthetic_only']);
    expect(companyBlockers(undefined, [])).toEqual([]);
  });
  it('marks missing and invalid source timestamps unavailable', () => {
    expect(sourceTime(null)).toBe('Unavailable');
    expect(sourceTime('not-a-date')).toBe('Unavailable');
    expect(sourceTime(0)).not.toBe('Unavailable');
  });
});
