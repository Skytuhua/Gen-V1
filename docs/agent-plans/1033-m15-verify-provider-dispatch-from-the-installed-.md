<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1033 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META

- Feature: M15 provider dispatch from the installed workbench — verification procedure (no code fix)
- Repo: `skytuhua-org/Gen-V1`, issue #1033 (M-series coordinator issue)
- Plan revision: 1, 2026-11-20. Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3`
- Links: PR #851 merged `2b41659c4cc4226c2527bafb73924638db35f520`; PR #865 merged `1ab9e7972770a5d015a60eb73684dd46699453de`; installed custody run `44418295418` (job `135204274180`, artifact `14486607582`); coordinator checkpoints 013/053.
- Status: BLOCKED — durable AFTER_CURRENT queue custody proven at `db3c0cf6` (installed desktop, Windows x64); provider dispatch `NOT_RUN`, `providerNetworkCalls` unmeasured. Flags `ui.sourceWorkbenchV1`, `reviewerApproval` remain false.
- Provenance: M15 handoff-postmerge + requirements.json + checkpoints; plan by `devin-a-cloud-4f7c1e` (review/planning, no code changes).

### OBJECTIVE

Discharge the provider-dependent gate with real evidence or keep it explicitly BLOCKED: identify the exact authorized provider/model binding (T01), prove queued workbench handoff dispatches to that provider on the installed product with measured provider traffic (T02), and record an independent release disposition (T03). Success = source-bound PASS evidence bound to an exact installed cut, or each criterion stays BLOCKED naming the missing input.

### REQUIREMENTS

- In scope: documenting the approved provider/model + fixture binding; running the installed-desktop verification with a real provider bound; recording measured provider network calls; independent review + disposition.
- Out of scope: enabling flags, code changes, product edits, deploying, testing on non-Windows hardware, extending the `db3c0cf6` custody evidence to current main (it is bound only to that packaged build).
- Hard constraints: evidence must come from the installed packaged product (not dev server); `providerNetworkCalls` is recorded only if actually measured — `null`/NOT_RUN is an honest result, never inferred; the historical D01 payload-byte gap (`HOLD_UNPUBLISHED_CUSTODY`) stays separate and is not discharged by this gate; flags `ui.sourceWorkbenchV1=false`, `reviewerApproval=false` until T03.
- Environment: installed-desktop verification runs on Windows x64 via `scripts/verify-installed-desktop.ts` (CI `installed-*` jobs or a Windows box without Edge PNA policy blocking loopback); Linux cannot produce this evidence.

### REPO_MAP (verified on `main@7ef0710c`)

- `scripts/verify-installed-desktop.ts` — installed-desktop verification harness. CLI: `verify-installed-desktop <absolute Setup.exe> <absolute win-unpacked> [--project-memory-retention [--project-memory-enabled]]` (`readInstalledVerificationArguments`, lines ~118-123). Custody phases run via its owned-install launches (`launchInstalled`, `assertOwnedInstallEntries`); the run records `providerNetworkCalls`, digests, screenshots. There is no `--workbench-custody` flag and no `scripts/installed-workbench-custody.ts` driver — provider-dispatch evidence comes from the standard custody run plus the owned-task flow below.
- `apps/web/src/workbench-recovery.ts`, `apps/web/src/SourceWorkbench.tsx`, `apps/web/src/WorkspaceSurfaceBody.tsx` — draft/source workbench (DraftContextV1, WorkbenchViewV1, source chips, AFTER_CURRENT send mode).
- `packages/contracts/source-selection.ts` — `SelectedSourceV1` union.
- Flag registry: `ui.sourceWorkbenchV1` (owner `m15`, default false) — referenced in `packages/core/service.ts`, `scripts/m15-evidence.mts`.
- Docs: `docs/implementation/v6/M15/{requirements.json,handoff-postmerge.md,handoff-windows.md,handoff.md,logs/}`.

### DESIGN

Verification procedure; three gates in order.

1. **T01 binding gate.** Input required: the operator-approved provider/model binding (exact provider id, model id, credential reference name — the value itself is never recorded) plus the approved owned installed fixture (installer package identity). If unavailable: T01 stays BLOCKED and the missing binding is named verbatim in a checkpoint. Output: binding record in the issue (provider + model identity, fixture installer digest, approval reference).
2. **T02 dispatch gate.** Depends: T01. Procedure: on Windows, install the exact packaged build (record `setupSha256`); launch the installed product with the approved provider bound and `ui.sourceWorkbenchV1` enabled *for the owned test task only*; run `pnpm exec tsx scripts/verify-installed-desktop.ts <absolute Setup.exe> <absolute win-unpacked>` (the harness's owned-install custody run) exercising: capture two sources on the owner task (no submit), queue a draft with sendMode `AFTER_CURRENT`, complete the handoff (the queued message dispatches to the provider), verify provider dispatch actually executes and record `providerNetworkCalls` count + endpoint host, then detach/reattach and restart to confirm custody. Record: `testedSha`, `setupSha256`, `executableSha256`, `payloadSha256`, `draftSha256`, `queuedDispatch` result, `providerNetworkCalls`, screenshot digests, artifact ID + zip sha256, run ID. Any dispatch failure or unmeasured traffic ⇒ FAIL/NOT_RUN recorded, never claimed.
3. **T03 disposition gate.** Depends: T02. Procedure: independent reviewer signs the record: flag states, evidence links, whether the installed workbench provider gate is discharged; flags remain false until this lands.

### EXECUTION_DAG

- **T01 — Record approved provider/model + fixture binding.** Deps: operator/provider approval. Steps: obtain binding identity + approval reference; post checkpoint with the binding record (no secret values). Done-when: exact binding named in issue, or BLOCKED + missing item. Owner: operator responsible for provider approval.
- **T02 — Run installed provider-dispatch verification.** Deps: T01 + Windows installed-desktop environment. Steps: install packaged build at exact SHA; run custody script with provider bound; collect summary JSON + screenshots + artifact digests; post results. Done-when: `queuedDispatch` = dispatched + measured `providerNetworkCalls` recorded with run/artifact IDs, or FAIL/NOT_RUN recorded. Owner: M15 owner/verifier.
- **T03 — Independent review + release disposition.** Deps: T02 PASS. Steps: reviewer posts signed disposition confirming flag defaults preserved or authorizing a separate flag PR. Done-when: disposition comment recorded; flags unchanged until then.

### VALIDATION

- Baseline re-verification (repo root, Linux OK): `pnpm exec vitest run tests/installed-desktop-verification.test.ts --maxWorkers=1` plus the M15 unit suites in `requirements.json` (`source-selection-v3`, `workbench-recovery-v3`); expected all-pass, re-binds the harness to the audited SHA.
- Installed run (Windows only): `scripts/verify-installed-desktop.ts --workbench-custody` under the approved binding; success = `queuedDispatch` observed dispatched, `providerNetworkCalls` a concrete number (not null), custody digests stable across restart.
- Acceptance matrix: T01 binding recorded | T02 run ID + artifact sha256 + measured traffic | T03 signed disposition | flags still false unless T03 approves.
- Negative checks: unrelated task untouched (`unrelatedDraft=false`, `unrelatedSourceContext=false`); storage partition shows 0 submissions without dispatch; revoke/disable path not regressed.

### STATE

- Verified: installed queue custody across detach/reattach + restart at `db3c0cf6` (run `44418295418`, artifact `14486607582`, zip sha256 `f4203eee…`); 13-observation validation table in handoff-postmerge.md.
- Blocked: T01 (no approved provider binding), T02 (provider dispatch NOT_RUN, traffic unmeasured), T03 (no disposition).
- Risks: verifier-box Edge PNA loopback policy blocks app bootstrap (use org CI or a Windows box without that policy); `db3c0cf6` evidence must not be extended to current main (`App.tsx` et al. changed since).
- Next step: T01 — identify an approved owned provider/model fixture binding (coordinator's stated next action).

### REFERENCES

- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1033
- Merges: #851 `2b41659c`, #865 `1ab9e797`
- Custody run: https://github.com/skytuhua-org/Gen-V1/actions/runs/44418295418
- Docs: `docs/implementation/v6/M15/{requirements.json,handoff-postmerge.md}` @`5cde22a7`
- Baseline `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3`

