# Approved job read connection

This is a narrow read selection for an existing owner-approved job. It does not create an approval, task, employee binding or permission. Company Control remains the record and execution authority.

Set `GEN_COMPANY_APPROVED_JOB_FILE` to an absolute path to a public reference-only JSON configuration. It has exactly these fields:

```json
{
  "companyId": "leo-company",
  "projectId": "pilot-smoke",
  "instructionId": "proposal-e14aa4c6fb9d74188c06ed622ea616a5aa5ba7c2dc1b792350539776b6901edf",
  "planRef": {
    "kind": "work_plan",
    "id": "work-plan-7528c46a486415fd2effa1174555d7396099c825ea60f4fb2baff672d3088c17",
    "project_id": "pilot-smoke",
    "revision": 1,
    "digest": "eccabed6d0cd3bd38625b4f4ac018b1d5cdafd1f897fd2433243ab6838a863db"
  },
  "workOrderId": "work-plan-order-05d820b6114561032a72875b27f55d6c1541adcc9d115cb4114ee6764d1c5ce9",
  "authorizationDigest": "4474f0a9b8a3e9d248158d0c3bf2da91b337df516e4c3a637fc9f4baed4e2bff",
  "authorizationExpiresAt": 1793778896
}
```

Keep `GEN_COMPANY_SERVICE_ORIGIN=http://127.0.0.1:52555`, set only `GEN_COMPANY_SERVICE_TOKEN_FILE` to the protected `pilot-read.token` path supplied by CONTROL, and leave raw token values unset. `GEN_COMPANY_PLANNING_INTAKE` and `GEN_COMPANY_WORK_PLANS` must be absent or false. Approved-read configuration refuses either write option. No manager authority is constructed.

The ordinary company entry reuses its existing status read, project-context read and exact work-plan read clients. Only the configured project/instruction/PlanRef is permitted for the work-plan projection. Server and browser validate the full stored plan/authorization and compare the independently retained WorkOrder ID, authorization digest and original expiry. No credential reaches the browser. The real service repeats current credential/scope checks on every request.

In **Communications → Company data**, the existing work-plan component has an **Approved job · read-only** section. **Load approved job** explicitly reads the exact record. Proposal editors and authorization controls are absent. WorkOrder acceptance is distinct from queued tasks, admitted employees and execution. After reopening, the saved read is labeled stale until explicitly refreshed; denials hide protected plan records while preserving local drafts.

The existing **Portfolio → focus project → Load project context** path reads the approved charter/planned staffing and zero queued tasks. Task-context calls remain unavailable. No polling, task submission, materialization, authorization, expiry renewal, inference or dispatch is enabled. The 50-cent company/project/WorkOrder caps describe one nested total exposure, not three budgets. Current eligibility comes from the service at read time; an expired authorization stays historical.

Personal owns the isolated renderer/host capsule and native launcher. Existing status-only app, profiles, source-pinned Linux archive and sealed 0.6.3 remain separate. Unit/browser fixtures verify display and denial behavior only; actual approved-read/native acceptance requires the genuine service and separate file credential. No new schema/installer build or independent review is implied by this source change.
