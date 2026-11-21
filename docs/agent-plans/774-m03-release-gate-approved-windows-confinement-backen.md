# M03 release gate: approved Windows confinement backend and native negative matrix — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/774
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
M03 release gate: approved Windows confinement backend and native negative matrix. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
## Exact remaining acceptance gap
The M03 implementation and focused security regressions exist, but `docs/implementation/v3/M03-verification.json` still records `outcome: PARTIAL`. There is no recorded `approvedBackendId` bound to an installed, independently approved Windows execution backend. The native platform-negative matrix and independent security review have not produced source-bound PASS evidence. Tool-level mocks and explicit `TRUSTED_HOST` operation approval do not certify confinement.

## Required source-bound acceptance
1. Record exactly one immutable operator/source-lock-approved backend identity, installed artifact digest and execution profile; ensure selected backend is neither ambiguous nor inferred from the model/project. Preserve existing `UNSUPPORTED_BACKEND` and `PLATFORM_PROOF_REQUIRED` fail-closed paths.
2. Run the **actual packaged Windows launcher** under `WORKSPACE_EXECUTE_NO_NETWORK` with a real token/network profile and verify: outside-granted-root read/write denial, protected account and app state denial, DNS/TCP denial, child/process escape denial, registry mutation denial, junction and hardlink swap resistance, second-user access denial, and process-tree cleanup after forced kill. Include an allowed in-root control. Bind every receipt to exact executable, profile, backend, platform, test source and package digests.
3. Demonstrate no automatic fallback to unrestricted host when backend initialization, proof, policy, child teardown or approval fails. Keep unknown external effects as uncertain.
4. Obtain an independent security review of the complete installed/runtime boundary. Publish its precise findings, exceptions and source hashes.
5. Only after all mandatory cases pass, prepare a separate explicit activation decision for `security.executionProfilesV1`; do not silently enable trust or SecretRef flags. Do not rewrite or erase historical failures.

## Current audit references
- Frozen 68-head integration validation: #749; offline test-toolchain repair: #770.
- Current-main storage protection/key regression: #773.
- Earlier M03 verification includes named blocking gates; only a new ImplementationEvidenceV3 acceptance bundle with actual results can discharge them.

**State:** BLOCKED for native confinement certification, not a report that all M03 product source is absent. No backend selection, driver installation, new privileged listener or production enablement is authorized by this issue.

## REPO_MAP
Verified at baseline unless marked discovery:
- `docs/implementation/v3/M03-verification.json` — records outcome: PARTIAL — the gap
- `docs/implementation/v3/M03-context7-reference-plan.md` — M03 planning context
- `docs/implementation/v3/M04-M06-review-20261117.md` — related qualification review

## DESIGN
Release-gate plan: record exactly one immutable approved backend identity + artifact digest + execution profile; run the actual packaged Windows launcher to produce the native negative matrix; independent security review must bind PASS evidence to source. Tool mocks and TRUSTED_HOST approval do not certify confinement.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Record the single approvedBackendId, artifact digest and execution profile; keep UNSUPPORTED_BACKEND and PLATFORM_PROOF_REQUIRED fail-closed | NONE | M03-verification.json updated with source-bound identity |
| T02 | Run the actual packaged Windows launcher under the workspace profile and record native platform negatives | T01 | negative-matrix evidence attached to the issue |
| T03 | Independent security review produces source-bound PASS evidence | T02 | review evidence recorded; outcome leaves PARTIAL |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #774; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #774: https://github.com/skytuhua-org/Gen-V1/issues/774
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
