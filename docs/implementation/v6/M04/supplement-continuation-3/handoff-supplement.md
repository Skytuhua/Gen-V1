# M04 v6 — Continuation-3 Evidence Supplement

**Scope.** This supplement carries only the *distinct* continuation-3 receipts produced by the
verification session committed locally as `b54c1f2a` on `handoff/m04-context-v3`. It is an
evidence annex — receipts, merge-attempt record, and hold states — extracted into files that do
not overlap the evidence-correction surface owned by PR #772.

**Out of scope (owned by #772 — preserved, not touched here):**

- `docs/implementation/v3/M04-verification.json` — the historical V3 acceptance record. #772
  corrects it (host-custody phase → BLOCKED, auxiliary live cases → NOT_RUN, native-CAS wording,
  added remaining-gate entries). No change to that file is proposed here.
- `docs/implementation/v6/M04/requirements.json` — the requirement ledger. #772 corrects the
  S09/S11 reasons (future-dated live authorization removed; native CAS existence corrected).
  The disposition normalization performed in the continuation-3 session is **not** republished
  here; the ledger remains #772's surface.
- `docs/implementation/v6/M04/source-lock.json` — not modified by #772, but the continuation-3
  session's regeneration (strict-schema repair, `executionBaseSha` → e5de6c3c) interlocks with
  the verification record #772 owns. Excluded to keep this patch strictly a new-file supplement.
- `docs/implementation/v6/M04/handoff.md` — continuation-3 was originally recorded inside this
  file at b54c1f2a. It is restated here as a standalone supplement instead of an edit, so this
  PR touches zero existing files.

## Identity (R01/R02)

- Repository: `skytuhua-org/Gen-V1` (ID 1442565952).
- **Tested cut: `e5de6c3c6425e6c3f66b132034a5472b6b6961f8`** — head of `handoff/m04-context-v3`
  for the entire session; identical on origin at test time.
- Extraction commit: `b54c1f2ae6b8b38d6b66c31810e14a6774059557` (local-only commit carrying the
  original continuation-3 record; not pushed as part of this supplement).
- This supplement is authored against main `ff38c62c3b0f8856e08f528f3c2ea8b1c1fea199`.
- Environment: linux-arm64 (Raspberry Pi 5), Node v24.11.1, pnpm 10.30.3, node-pty native
  artifact provisioned locally.

## R03 merge attempt record (vs captured main `4aef753e`)

- Merge base: `76d31a944c44c44ec7ea1d795fd4006c898b86fb`; task branch +2/−465.
- `git merge --no-commit --no-ff 4aef753ec272d6ab9f9f9eec1df0ca232386975b` conflicted in six
  paths; aborted with `git merge --abort`; worktree restored clean at e5de6c3c.
- Conflict paths (stage-1 base / stage-2 ours / stage-3 theirs blob identities recorded in the
  source record):

  | path | stage-1 (base) | stage-2 (task) | stage-3 (main) |
  |---|---|---|---|
  | packages/contracts/index.ts | 78c6954b | b0aa4832 | a9d196f9 |
  | packages/core/service.ts | 743ad372 | 0709e39d | 83415577 |
  | packages/runtime-hermes/index.ts | ac9c1b21 | 32d09c48 | dbd20a1d |
  | packages/runtime-hermes/task-pool.ts | 44d1923a | bf3e1241 | 1dca9e85 |
  | tests/context-request-observation.test.ts | d1a2aea4 | 780d4d9e | aa9b20a3 |
  | tests/hermes_source_worker.py | d23e80c7 | cd2318cf | e84213fc |

- The merge target has since advanced (`ff38c62c` → `7ac80d87` → `89142de9`). Re-inspection at
  `89142de9` shows all six joins absorbed or superseded — see "Source-drift join status"; no
  actionable join remains.

## Receipts at the tested cut (all in `logs/`; digests in `manifest.json`)

- Targeted suites: `context-compiler-v3` 11 PASS; `context-results-v3` 3 PASS; `compaction-v3`
  8 PASS; `context-contract-preservation-v6` 6 PASS (incl. D01 replay cases).
- Supporting suites (sequential, same cut): 15 suites / 219 tests PASS + 2 skipped, including
  CAS apply/mismatch/unsupported cases in `context-request-observation`.
- Gates: `pnpm typecheck` exit 0; `pnpm lint` exit 0 (564 sources); `pnpm build` exit 0;
  `pnpm build:credential-lease` and `pnpm build:widgets` exit 0.
- `pnpm test` exit 1 — 332 failed / 4013 passed / 70 skipped over ~58 min under ~3-agent host
  load. Failure classes are the documented environment gaps (linux path-guard boundary,
  pinned Python 3.14 hermes worker, native engines) plus 60s timeouts under contention. The two
  M04-file timeouts pass in the quiet sequential run at the same cut. **No M04 assertion failure
  observed; the full gate remains FAIL on this host.**
- `pnpm exec tsx scripts/test-browser.ts --suite usage-context` — the M04-scoped browser suite,
  on bundled chromium (msedge is win32-only post-merge): contended run 15 pass / 10 fail;
  sequential rerun 21 pass / 4 fail. All residuals are `data-usage-fixture-ready` 5s
  fixture-mount timeouts under host load — not channel unavailability, not inspector assertion
  failures. U01 tab-navigation and honest unknown/empty/failure rows pass at this cut.

## Holds status (re-evaluated at main `89142de9`)

1. **HOLD_SOURCE_DRIFT** — **discharged by inspection**: all six joins absorbed/superseded on
   current main; nothing actionable remains (see "Source-drift join status" below).
2. ~~Native worker CAS test provisioned for Windows CI~~ — **satisfied**: the real worker
   fixture passed on Windows CI at `7ac80d87` **and** `89142de9` (receipts above). The
   distinct remaining leg is installed-desktop compaction acceptance, still a separate gate.
3. U04 measured cache attribution — M11-dependent, NOT_RUN.
4. Full `pnpm test` gate — FAIL on this linux-arm64 host; **CI context**: all four `Tests`
   shards succeeded at `89142de9` (and `7ac80d87`). Local-host failures remain
   environment-bound; the merged cut is green on the real matrix.
5. Full `pnpm test:browser` gate — FAIL on this host (channels absent); **CI context**:
   `Browser tests` succeeded at `89142de9`.
6. **HOLD_AUXILIARY_MODEL** — unchanged: per #772's corrected record, no source-bound
   live-model authorization/receipts establish the auxiliary study; no approved inputs exist.
   The continuation-3 session's aux-related evidence strings are not republished.

## Windows native compaction CAS — source-bound receipt (CI at 7ac80d87)

The native-worker CAS acceptance leg requires a Windows host (CI runs `hermes` on
`windows-latest` via `.github/workflows/ci.yml`). The exact supported path — verified against
main `7ac80d870ff7ff7dc021b0632ef07d631d489afc` (the current cut carrying the merged CAS) — is:

- toolchain: Python 3.14.x (repo pin), `.harness-hermes-python-deps` installed per
  `.github/actions/setup` (`pip install --target .harness-hermes-python-deps
  -r third-party/hermes-agent/runtime-requirements.txt`);
- `python -I -S -B tests/hermes_source_worker.py WorkerFixture.test_source_cut_cas_rejects_stale_compact_and_applies_matching_digest -v`
  — the core case: stale `expectedHistorySha256` must return `compacted:false`/`mismatch`
  with history and the on-disk session file unchanged; the matching digest must apply
  (`compacted:true`, shortened persisted messages);
- `python -I -S -B tests/hermes_source_worker.py WorkerFixture.test_m04_protected_compaction_retains_exact_records_and_a_separate_original_archive -v`
  — protected compaction through the CAS digest + `compactionProtection` envelope;
- `python -I -S -B tests/hermes_source_worker.py WorkerFixture.test_original_summary_compaction_executes_with_the_retained_dependency_subset -v`
  — compaction sanity case; full-file run is the CI invocation.

Dispatch attempt on 2026-11-18 to the linked verifier `WIN-M0N0V07LGM1`
(environment `17662262-856e-45f7-98fb-56c92cacfa8f`) failed at transport: the link reports
`reachable` but the remote agent answered HTTP 524 on three attempts.

**Resolved via authenticated GitHub CI instead** — `logs/ci-hermes-cas-7ac80d87.log`
(bounded excerpt of the job log; digests in `manifest.json`):

- Workflow `ci.yml`, job **Hermes contracts** on `windows-latest`, check_run `135026554125`,
  run `44367920580`, **head_sha `7ac80d870ff7ff7dc021b0632ef07d631d489afc`** — the exact
  recorded cut — conclusion `success`, 2026-11-18 18:26–18:31 UTC.
- Toolchain from the job log: runner image `windows-2025-vs2026` (Windows Server 2025),
  **CPython 3.14.10** (the repo-pinned 3.14 line), pwsh.
- `python -I -S -B tests/hermes_source_worker.py -v` — the exact CI invocation — ran
  **45 tests in 200.9 s, OK**, including:
  - `test_source_cut_cas_rejects_stale_compact_and_applies_matching_digest … ok`
    (stale `expectedHistorySha256` refused — `compacted:false`/`mismatch`, history and
    session file unchanged — then matching digest applied — `compacted:true`,
    shortened persisted messages);
  - `test_m04_protected_compaction_retains_exact_records_and_a_separate_original_archive … ok`;
  - `test_original_summary_compaction_executes_with_the_retained_dependency_subset … ok`.
- Sibling steps in the same job: `hermes_source_contract.py` 5 tests OK,
  `hermes_atomic_controls.py` 4 tests OK, memory-checkpoint steps OK.

**Re-confirmed at newer main:** `logs/ci-hermes-cas-89142de9.log` — the same job at
`89142de980df86c4236dc49c28f280d78fe79e0d` (run `44393035599`, CPython 3.14.10,
windows-2025-vs2026): 45 tests OK including the same three cases. CAS behavior survives the
latest main state.

This is the real supported path — a spawned `worker.py` subprocess over JSON-RPC — executed on
the repo's own Windows CI at the merged main cut. It establishes **code-level** native CAS
behavior (matched apply + stale refusal) on Windows. It is not a claim of installed-desktop
acceptance, reviewer approval, or flag enablement.

### Acceptance-case coverage of the Windows receipt

| required case | covered | where |
|---|---|---|
| exact source-cut CAS precondition | yes (Windows CI) | `test_source_cut_cas_...` matched-apply leg |
| refusal after the source cut changes / no mutation on stale digest | yes (Windows CI) | same test, stale leg: `compacted:false` + `mismatch`, history and session file unchanged |
| rollback witness / protected original archive | yes (Windows CI) | `test_m04_protected_compaction_..._a_separate_original_archive` |
| ownership/binding verification | yes | worker ctx-bound params + service host checks; adapter case `rejects compaction of a different retained task, account or model` in `tests/hermes-runtime.test.ts` (CI test shards, green at both cuts) |
| measured before/after evidence | yes | worker-level shortened persisted messages + service-level measured-bytes cases (`compaction-v3`, `context-request-observation`; CI shards + linux receipts here) |
| adapters without native digest support → unsupported, never emulated | yes | `does not implement loss-aware compaction by calling legacy native compaction` (`context-request-observation` on main; CI shards) |

### Source-drift join status (re-inspected at main `89142de9`)

Each of the six R03 conflict paths was re-checked line-by-line: every unique task-cut delta is
present on current main — absorbed verbatim (`contracts/index.ts`, `task-pool.ts`,
`hermes_source_worker.py` CAS test) or superseded by newer main work (`service.ts`
`compactProtected` + envelope/owner contracts + host commit-gate;
`context-request-observation.test.ts` equivalent-or-newer compaction cases;
`runtime-hermes/index.ts` protected-compact signature). **No actionable join remains**: nothing
unique is left to reconcile, and a merge would re-land already-squashed work only.
HOLD_SOURCE_DRIFT is discharged by inspection — not by merge — for these six paths. The branch's
sole unique artifact is the local evidence commit already extracted into this supplement.

## Non-claims

- No claim of core acceptance, platform acceptance, release readiness, or completeness.
- `reviewerApproval` remains false. All four M04 flags
  (`context.compilerV1`, `tools.deferredV1`, `context.lossAwareCompactionV1`,
  `context.precomputeExperimentV1`) remain default false.
- No merge into or modification of #772 is proposed. If reviewers prefer the ledger corrections
  be validated against these receipts, the digests above bind each log to the exact tested cut.
