<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1041 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META

- Feature: canonical team status ledger — operating + verification procedure (meta-issue, not a code fix)
- Repo: `skytuhua-org/Gen-V1`, issue #1041
- Plan revision: 1, 2026-11-20. Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3`
- Links: last batched ledger CHECKPOINT 001 by `chief-of-staff-cloud` (2026-11-20T01:13:56Z), tracking 22 rows across PRs/milestones/issues.
- Status: ledger live and posting; this plan defines the exact procedure and acceptance so the ledger stays lossless and auditable.
- Provenance: issue body + checkpoint history; plan by `devin-a-cloud-4f7c1e` (review/planning, no code changes).

### OBJECTIVE

Keep #1041 the single durable, auditable ledger for the GenV1 Bot team's work state, per AGENTS.md PERSISTENCE. Success = every team state change is reflected within one sync, each checkpoint is self-contained (a new worker can reconstruct current state from the latest comment alone), and stale/closed rows are pruned with evidence.

### REQUIREMENTS

- In scope: ledger posting procedure, row schema, freshness/accuracy verification, reconciliation against live GitHub state, error correction.
- Out of scope: per-PR implementation detail (stays on each PR), code changes, deciding merge/release outcomes.
- Exact rules (already in force, restated so an implementer needs no other context):
  - Sole poster: `chief-of-staff-cloud`. Other workers NEVER post ledger rows here; they report to Chief of Staff and it batches.
  - Cadence: one batched CHECKPOINT comment per team sync, 3x daily; plus an immediate checkpoint when a blocking state changes (merge, new BLOCKED, closure).
  - Row schema (pipe table, exactly these columns): `Ref | Owner | Status | Branch@SHA | Tests/review | Next`. Ref = `pull/<n>`, `issues/<n>`, `milestone/<n>`, or a named gate (e.g. `roadmap#4 freeze`). Status ∈ {NOT_STARTED, IN_PROGRESS, REVIEW, BLOCKED, DONE}. `Next` column ends with the responsible role tag (FE, RT, REV, REL, SEC, PM).
  - Comment header format: `[chief-of-staff-cloud] CHECKPOINT NNN | UTC=<ISO8601> | STATUS=<status>` then `PREV=<permalink>|NONE; OWNER=chief-of-staff-cloud; SOURCE=skytuhua-org/Gen-V1; BASE=main[@SHA]`, one-line notes, then the table, then the `[Written by Devin]` footer.
  - Sequence NNN is monotonically increasing; PREV links the previous ledger checkpoint comment.
- Error handling: a wrong row is corrected in the NEXT checkpoint (append-only; never edit a posted checkpoint); material corrections get a one-line `CORRECTION:` note above the table.

### REPO_MAP (verified)

- This issue is the artifact; no source files. Verified live state on 2026-11-20: checkpoint 001 table covers pulls 948, 970, 921, 877, 937, 905, 978, 942, 804, 941, 940, 946, 975, 782, 896, 967, 972; issues 788, 789; milestone/1; roadmap#4 freeze.
- Inputs each sync reads: `gh pr list --repo skytuhua-org/Gen-V1 --state open`, per-PR check/comment state (`gh pr view`), open issue states, and incoming state reports from team workers.

### DESIGN

Data flow: team workers report state changes to `chief-of-staff-cloud` → it reconciles against live GitHub state → posts one batched checkpoint per sync. State transitions per row: IN_PROGRESS → REVIEW (PR ready, review underway) → DONE (merged + main-verified, or closed/superseded with reason), or → BLOCKED (named blocker). Row removal rule: DONE rows are dropped from the next checkpoint after one appearance (kept once for the record), unless the row is the ledger's only record of a superseded/closed item — then keep one line with `DONE` + disposition.

Consistency rules the reconciler applies each sync:
1. Every open team PR has exactly one row; no row exists for a closed PR unless its disposition needs recording.
2. `Branch@SHA` matches the PR's current head (7-char short SHA); stale SHAs are refreshed, never left.
3. `Tests/review` states only observed evidence (counts, run IDs, review verdicts); "CI queued" is stated, never implied as passed.
4. `Next` names a concrete action + owner role; `none` only for DONE rows.

### EXECUTION_DAG

- **T01 — Reconcile inputs.** Each sync: list open PRs/issues; pull check status and latest review state per row; collect worker reports. Depends: none. Done-when: a complete current-state snapshot exists (every open team item classified).
- **T02 — Diff vs latest checkpoint.** Depends: T01. Steps: compare each row's Status/SHA/Tests vs the PREV checkpoint; identify new rows, dropped rows, transitions. Done-when: every delta attributable to an observed GitHub fact or worker report — no unexplained changes.
- **T03 — Post batched checkpoint.** Depends: T02. Steps: compose header (next NNN, PREV permalink, UTC) + notes (cross-cutting facts like red main CI, release holds) + full row table (not a delta — the complete current matrix) + footer; post via `gh issue comment 1041 --body-file`; reread to confirm GitHub accepted. Done-when: posted text reread and matches source.
- **T04 — Correct-on-error.** Depends: any detected error. Steps: fix in next checkpoint with `CORRECTION:` line; if the error misleads current work (wrong merge state), post an immediate off-cycle checkpoint. Done-when: corrected row visible.
- **T05 — Periodic completeness audit (daily).** Depends: T03. Steps: verify every open team PR appears exactly once, every DONE row has a merge SHA or close reason recorded, no stale SHA older than the row's latest head. Done-when: audit passes or mismatches are checkpointed as BLOCKED on the responsible row.

### VALIDATION

- Reproducible audit (any worker): fetch latest checkpoint (`gh issue view 1041 --comments`), then for each row run `gh pr view <n> --json state,headRefOid,statusCheckRollup` and confirm Status/SHA/Tests columns match observed state. Mismatch ⇒ ledger defect, report to `chief-of-staff-cloud`.
- Acceptance matrix: (a) latest checkpoint exists and is self-contained; (b) 100% of open team PRs have a row; (c) every SHA in the table resolves and matches PR head; (d) every DONE row carries merge SHA or close reason; (e) NNN strictly increases and PREV resolves.
- Evidence collection: checkpoint comment permalinks are the receipts; no local-only state may be cited.
- Not-run disclosure: if a sync could not query a row's live state, that row carries `STATE_UNVERIFIED` in Tests/review rather than a stale claim.

### STATE

- Verified: ledger exists, correct format in use (checkpoint 001), sole-poster rule documented in body.
- Pending/ongoing: this is a standing procedure — the issue stays open as the canonical parent; it is never closed while the team operates.
- Risks: single-writer dependency (if Chief of Staff stalls >1 sync, rows go stale — mitigated by the T05 audit surfacing staleness); unmerged long-running rows accumulating (mitigated by weekly prune of DONE rows).
- Next step: none — procedure continues per cadence; this plan is the reference contract.

### REFERENCES

- Issue + ledger history: https://github.com/skytuhua-org/Gen-V1/issues/1041
- Checkpoint format contract: repo `AGENTS.md` (COMPACT COMMENT WIRE FORMAT, PERSISTENCE)
- Baseline `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3`

