import { expect, it } from 'vitest';
import { capabilityEnabled, configureHostCapabilityFlags, type CapabilityFlagKey } from '../packages/core/capability-flags.ts';
import { CI_FAILURE_LIMITS, CiFailureReportV1, CiFailureSendV1 } from '../packages/contracts/ci-failures.ts';

const job = { id: '98765432101', checkName: 'test', workflowName: 'CI', failedStep: 'pnpm test', conclusion: 'failure', url: 'https://github.com/acme/repo/actions/runs/1/job/98765432101', logState: 'ready', excerpt: 'FAIL tests/x.test.ts', excerptLines: 1, truncated: false };
const report = { id: 'f'.repeat(64), repo: 'acme/repo', number: 42, headOid: 'a'.repeat(40), localHead: 'b'.repeat(40), observedAt: '2026-11-21T00:00:00.000Z', jobs: [job], omittedJobs: 0 };

it('defaults workspace.ciFixV1 to false and rejects unknown flags at configure time', () => {
  const restore = configureHostCapabilityFlags({});
  try {
    expect(capabilityEnabled('workspace.ciFixV1')).toBe(false);
    expect(() => configureHostCapabilityFlags({ 'workspace.ciFixV1': true, 'workspace.nopeV1': true } as unknown as Record<CapabilityFlagKey, boolean>)).toThrow();
  } finally { restore(); }
});

it('accepts a fixture failure report matching the read-only surface contract', () => {
  const parsed = CiFailureReportV1.parse(report);
  expect(parsed.jobs).toHaveLength(1);
  expect(parsed.jobs[0].logState).toBe('ready');
  expect(CiFailureSendV1.parse({ reportId: report.id, jobIds: ['98765432101'] }).jobIds).toEqual(['98765432101']);
});

it('rejects extra keys on jobs, reports, and send payloads', () => {
  expect(CiFailureReportV1.safeParse({ ...report, accountId: 'x' }).success).toBe(false);
  expect(CiFailureReportV1.safeParse({ ...report, jobs: [{ ...job, token: 'redacted' }] }).success).toBe(false);
  expect(CiFailureSendV1.safeParse({ reportId: report.id, jobIds: ['1'], draft: 'open' }).success).toBe(false);
});

it('rejects more than the bounded job set', () => {
  const many = Array.from({ length: CI_FAILURE_LIMITS.maxJobs + 1 }, (_, index) => ({ ...job, id: `${index}` }));
  expect(CiFailureReportV1.safeParse({ ...report, jobs: many }).success).toBe(false);
  expect(CiFailureSendV1.safeParse({ reportId: report.id, jobIds: many.map(item => item.id) }).success).toBe(false);
  expect(CiFailureSendV1.safeParse({ reportId: report.id, jobIds: [] }).success).toBe(false);
});

it('rejects non-integer and negative numbers and out-of-enum log states', () => {
  expect(CiFailureReportV1.safeParse({ ...report, number: 1.5 }).success).toBe(false);
  expect(CiFailureReportV1.safeParse({ ...report, omittedJobs: -1 }).success).toBe(false);
  expect(CiFailureReportV1.safeParse({ ...report, jobs: [{ ...job, excerptLines: 2.5 }] }).success).toBe(false);
  expect(CiFailureReportV1.safeParse({ ...report, jobs: [{ ...job, logState: 'cached' }] }).success).toBe(false);
});
