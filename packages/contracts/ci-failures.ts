import { z } from "zod";

/** CI failure log excerpts shared between the host and the renderer. No raw
 * log text beyond the bounded excerpt and no credentials cross this contract. */
export const CI_FAILURE_LIMITS = { maxJobs: 6, rawLogBytes: 8 * 1024 * 1024, excerptLines: 200, afterLines: 20, maxErrorLines: 20, excerptBytes: 24 * 1024, reportBytes: 96 * 1024, cacheMs: 15 * 60 * 1000 } as const;

export const CiLogStateV1 = z.enum(['ready', 'unavailable', 'too-large', 'not-actions']);
export const CiFailedJobV1 = z.object({
  id: z.string().max(64),               // Actions job id, or 'ext:<index>' for non-Actions checks
  checkName: z.string().max(1024),
  workflowName: z.string().max(1024).nullable(),
  failedStep: z.string().max(1024).nullable(),
  conclusion: z.string().max(64),
  url: z.string().max(2048),            // https://github.com/... only; else ''
  logState: CiLogStateV1,
  excerpt: z.string(),                  // '' unless logState==='ready'
  excerptLines: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).strict();
export const CiFailureReportV1 = z.object({
  id: z.string().max(128),              // reviewHash([owner, repo, number, headOid, observedAt])
  repo: z.string(), number: z.number().int().positive(),
  headOid: z.string().max(64), localHead: z.string().max(64),
  observedAt: z.string(), jobs: z.array(CiFailedJobV1).max(CI_FAILURE_LIMITS.maxJobs), omittedJobs: z.number().int().nonnegative(),
}).strict();
export const CiFailureSendV1 = z.object({ reportId: z.string().max(128), jobIds: z.array(z.string().max(64)).min(1).max(CI_FAILURE_LIMITS.maxJobs) }).strict();

export type CiLogState = z.infer<typeof CiLogStateV1>;
export type CiFailedJob = z.infer<typeof CiFailedJobV1>;
export type CiFailureReport = z.infer<typeof CiFailureReportV1>;
export type CiFailureSend = z.infer<typeof CiFailureSendV1>;
