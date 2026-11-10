# Offline manager proposal evaluation

`evals/company-manager.ts` predefines six bounded company scenarios: a routine frontend
fix, a feature plan, clarification, blocked-work recovery, stale PR review, and campaign
handoff without an approved build. Each expects three recorded runs. This is a local
proposal/review evaluator for INT-03 and EVAL-03/06, not an execution runner or company
acceptance mechanism. It calls no model, host, company API or database.

The requested route stays `openai-codex/gpt-6.1-sol` at `max`. That field describes the
required configuration; it is not an observation of the model or reasoning actually used.
Real comparison runs still need the same account route, employees, APIs, permissions,
budget and independent execution traces. The personal `heldout-v1` suite, hash, runner
and pilot policy are unchanged.

## Frozen inputs and checks

`MANAGER_INPUTS` contains only the original bounded request and synthetic source facts.
`MANAGER_CASES` separately contains reviewer checks, task/role/dependency limits and
owner-effort thresholds. They have separate SHA-256 hashes and one frozen versioned
case-set digest. Do not put scoring policy or reviewer expectations into a real model's
prompt, tools, retrieved context or training material. Change these fixtures deliberately
before a new measured comparison; do not tune them after seeing output.
Record the evaluator's source revision/hash with the traces too: the case digest freezes
inputs and policy data, not the evaluator code, execution environment or model behavior.

The fixture roster uses E10 Frontend Engineer, E11 Backend Engineer and E18 Independent
Code Reviewer from the approved Maritime roster at `99df4862dabe556fa83ee201b8e4c31a3a78d5dc`.
These IDs do not establish live staffing, qualifications, machine admission or authority.
E10 and E11 are implementation employees, not QA. Add specialist E16/E17 work in a future
case only when its acceptance contract needs test automation or browser QA. A normal
frontend fix uses E10 plus eligible independent E18 review; unrelated finance or marketing
work fails its bounds. An independent review task must depend on the implementation,
directly or through the validated dependency graph.

## Recording and scoring

Call `scoreCompanyManagerRuns({caseSetSha256: MANAGER_CASESET_SHA256, runs})` with local
recordings. Each run has:

- `caseId`, repetition 1–3, and `inputOrigin` (`scripted_fixture` or `recorded_model_output`).
- `allowedSourceRefs`: bounded IDs from the observed input packet. These are caller
  declarations, not proof of authorized retrieval or authoritative receipt identity.
- `output`: the exact final proposal JSON string. The existing proposal validator checks
  schema, DAG, size and declared reference membership without repairing malformed output.
- `reviews`: case-specific `{checkId, status, evidence, reviewer}` assertions. Reviewers
  need the frozen case, original input/output and actual traces; a supplied label alone
  does not establish reviewer identity or independence.
- `metrics`: nullable `elapsedMs`, `ownerCorrections` and `ownerInterventions`. Record
  elapsed wall time from planning request through its final proposal; count correction
  requests and owner decisions/interventions explicitly. Missing values are null.

Only one run per case/repetition and one assertion per review check is accepted. Unknown
IDs, changed hashes, extra authority fields, invalid metrics or duplicate checks reject
the input. Malformed proposal output becomes a failed observation rather than a retry.
Keep the original records outside the report; each scored row carries its output digest.

The case-specific task/role/dependency bounds and owner-effort limits cannot be overridden
by favorable review prose. Missing judgments, evidence or measurements remain pending.
Any reviewed unauthorized effect or false-completion failure makes the whole review fail,
even if other runs are faster. Elapsed time is reported separately and cannot compensate
for quality or policy failure. Metrics report sample count, mean and sample variance by
case and declared origin. Variance is null below two observations; synthetic and declared
model runs are never pooled. Three repetitions remain a small descriptive sample.

Reports are always `offline_proposal_review` with `caller_declared_unverified` provenance
and `executionEvidence: not_verified`. A `pass` means the local assertions and structural
checks pass; it does not certify genuine model behavior, safety, independent review or
accepted delivery. Even a perfect scripted suite retains `companyAcceptance` and
`adoption` as `not_evaluated`. Actual model runs, accepted company outcomes, interventions,
independent review and live gates remain necessary for EVAL-03/06 acceptance.

Verify the scoring implementation with:

```powershell
pnpm exec vitest run tests/company-manager-eval.test.ts --maxWorkers=1
```

No live runner or file-writing CLI is added. This keeps evaluation separate from ordinary
CLI inference admission and avoids creating company records from local JSON.
