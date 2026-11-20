<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1107 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: relocate root-level M16 evidence helpers to `scripts/`
- Repo: skytuhua-org/Gen-V1 · Plan rev: 1 (2026-11-20)
- Baseline: `main` @ `7ef0710c90a479233f8dd9fe484a296f8c3c86d3`
- Issue: #1107 · In-progress claim: `devin-cloud-7f3a19` (checkpoint 001, UTC 2026-11-20T02:05Z) — T01–T03 reported done locally on `chore/move-m16-evidence-scripts`, **unpushed** (absent from `git ls-remote`); T04 checks in progress; no PR. Remaining scope below is for whoever lands it.
- Source provenance: review by devin-a-cloud-9c41e2; reference list independently re-verified on baseline.

### OBJECTIVE
Keep only product/build files at the repo root. The four M16 helpers move to `scripts/` unchanged in behavior; every live reference resolves; frozen generated evidence that records historical paths is reported, not rewritten.

### REQUIREMENTS
- Move exactly: `check_m16_evidence.mts`, `gen_m16_evidence.py`, `run_m16_bounded.py`, `m16_records.json` → `scripts/` (issue allows `docs/evidence/` "where more appropriate"; `scripts/` is the concrete choice because all four are runnable tooling and `scripts/public-source-files.json` already tracks them).
- Every live reference updated; scripts still runnable from repo root (`node --import tsx scripts/check_m16_evidence.mts`, `python3 scripts/gen_m16_evidence.py`, `python3 scripts/run_m16_bounded.py`).
- Escape clause: frozen generated evidence under `docs/implementation/v3/` records historical `changedFiles`/path entries and is validated by `check_m16_evidence.mts` digests — do NOT edit it; report it in the PR.
- `pnpm build` still runs on the PR.

### REPO_MAP (verified on baseline by grep for the four basenames, `rg -l` excluding node_modules/.git)
Live references to update:
1. `scripts/public-source-files.json` — entries at lines 369, 2406-2407, 2715 (`"check_m16_evidence.mts"`, `"gen_m16_evidence.py"`, `"m16_records.json"`, `"run_m16_bounded.py"`) → repath to `scripts/<name>` in the manifest's sorted position.
2. `check_m16_evidence.mts` — its own relative import(s) of `packages/…` must become `../packages/…` (e.g. `./packages/` → `../packages/`).
3. `gen_m16_evidence.py` — usage/help line references its own path → `scripts/gen_m16_evidence.py`.
4. The moved files themselves (self-references inside each script, if any — grep each file for its own basename after the move).
Frozen (do NOT edit, report only): `docs/implementation/v3/{M10,M15,M16}-verification.json`, `M15-source-cut.json` mention the old paths as recorded evidence.
Verified absent: no matches in `package.json`, `.github/workflows/`, `docs/*.md`, `README.md`, `CONTRIBUTING.md`, `AGENTS.md`.

### DESIGN
`git mv` the four files into `scripts/` (preserves history). Three edit sites: (a) inside `scripts/check_m16_evidence.mts` repoint package imports one level up; (b) in `scripts/public-source-files.json` rewrite the four entries to `scripts/<basename>` keeping the manifest's ordering rules; (c) fix the usage string in `scripts/gen_m16_evidence.py`. Any path the scripts take as CLI args (e.g. `m16_records.json` consumed by `check_m16_evidence.mts` or `run_m16_bounded.py`) must be verified by reading each moved file's argument handling — if a script hardcodes a root-relative default such as `m16_records.json`, update the default to `scripts/m16_records.json` or resolve relative to the script file (`new URL('./m16_records.json', import.meta.url)` for .mts; `Path(__file__).with_name('m16_records.json')` for .py) so the script still runs from the repo root. No other code changes.

### EXECUTION_DAG
- T01 — (DONE by devin-cloud-7f3a19) reference list compiled; matches the verified list in REPO_MAP.
- T02 — (reported IMPLEMENTED, unpushed) `git mv` ×4 into `scripts/`.
- T03 — (reported IMPLEMENTED, unpushed) reference updates per DESIGN.
- T04 — Verify: `node --import tsx scripts/check_m16_evidence.mts` from repo root → expected `M16 evidence validates: 0 issues` (reported PASS pre-push); `pnpm typecheck`, `pnpm lint`, `pnpm build`; `python3 scripts/gen_m16_evidence.py --help`-equivalent smoke check if it takes no args safely — otherwise cite that it was run read-only. Done when all pass on the pushed tree.
- T05 — Commit with only the move+repath, push `chore/move-m16-evidence-scripts`, open PR to `main` linking #1107 with the reference list and the frozen-evidence report in the body. Done when PR exists.
- T06 — Wait PR CI green + review, merge, then on `main` re-run `node --import tsx scripts/check_m16_evidence.mts`. Done when merged and post-merge check passes.
- Ownership boundary: if `devin-cloud-7f3a19` resumes, it owns T04–T06; a new worker ACKs by comment and starts by pushing the branch or reproducing the diff from this plan.

### VALIDATION
- Executed during planning: `rg -l 'check_m16_evidence|gen_m16_evidence|run_m16_bounded|m16_records'` → exactly the REPO_MAP set; remote lacks the branch (`git ls-remote`).
- Planned: T04/T06 commands above with exact outputs; PR CI.
- Acceptance: four files absent from root on the PR; all live refs resolve; `pnpm build` green; evidence check prints `0 issues`.

### STATE
- Researched/decided: destination `scripts/`; frozen-evidence escape confirmed applicable.
- Implemented (unpublished): T02, T03 per checkpoint 001 on `chore/move-m16-evidence-scripts`.
- Verified: evidence checker PASS locally per checkpoint; build not yet run.
- Risks: another worker's local edits are unreachable — if the branch isn't pushed within the assignment window, reproduce T02/T03 from scratch (small, fully specified above).
- Next step: push branch or reproduce T02–T03, then T04.

### REFERENCES
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1107 · Worker checkpoint: issue comment by devin-cloud-7f3a19 (UTC 2026-11-20T02:05Z).
- `scripts/public-source-files.json:369,2406-2407,2715`; `check_m16_evidence.mts`, `gen_m16_evidence.py`, `run_m16_bounded.py`, `m16_records.json` (root, baseline).

