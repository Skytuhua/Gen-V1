<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1126 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: PR sweep — review and merge every open non-draft PR targeting `main`.
- Repo: skytuhua-org/Gen-V1. Plan rev 1, 2026-11-20.
- Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified).
- Status: sweep **in progress** by `devin-a-cloud-a823d3` (checkpoints: claim + 001 + 002). **30 PRs already merged** (877, 899, 919, 921, 927, 937, 941, 944, 946, 947, 953, 959, 960, 961, 964, 970, 972, 973, 975, 977, 979, 981, 983, 772, 1007, 1016, 1018, 1019, 1037, 1038, 1040). Conflict repairs pushed on 948, 978, 982, 1035, 1036 (merge fresh `origin/main` into PR branch, union declarations). **This plan covers remaining scope only.**
- Provenance: issue checkpoints + live `gh pr list` snapshot 2026-11-20T18:45Z (72 open non-draft main PRs).

### OBJECTIVE
Every open non-draft PR targeting `main` is either merged after diff review + green CI, or documented with an exact blocker. Success = zero open mergeable non-draft main PRs; post-sweep `main` healthy (rollup checks pass on `main` HEAD).

### REQUIREMENTS
- In scope: open, non-draft PRs with `baseRefName=main` (72 at snapshot).
- Out of scope: draft PRs; PRs targeting non-main branches (e.g. #1142 → `refine/developer-tools-data`, handled by issue #1116); closing PRs (only maintainer closes); any code change beyond mechanical merge-conflict repair on PR branches.
- Per-PR rules (unchanged from worker procedure): (1) read the merge-base diff — scoped, correct-looking, no secrets, no generated-output churn; (2) merge only when all required checks green; (3) conflict repair = merge `origin/main` into the PR branch preserving BOTH sides' content (precedent: CHANGELOG.md kept both bullets; window-globals.d.ts unioned member declarations, PR-typed version wins on same member); push to PR branch and wait for fresh CI before merging; never rewrite PR semantics; (4) capy-ai[bot] review-failure comments are non-blocking (workspace out of credits); Devin Review findings get a look — blocking only if a real defect is confirmed; (5) do not merge if diff shows out-of-scope or suspicious changes — document and skip.

### REPO_MAP — remaining PR inventory (snapshot 2026-11-20T18:45Z; re-run `gh pr list` at execution)

| Class | PRs |
| --- | --- |
| CONFLICTING (repair first) | 1082, 1111, 1122, 1123, 1143 (1143 owned by #1125 plan — coordinate, don't double-repair) |
| Check FAILURE | 1083 (`Browser tests` — suspected main-wide/environmental flake, see #891 review note; rerun + compare before blocking) |
| Mergeable, checks green/pending resolution | 891, 897, 901, 926, 934, 938, 939, 940, 942, 943, 948, 949, 951, 952, 958, 962, 963, 965, 966, 968, 969, 971, 978, 982, 1008, 1017, 1021, 1035, 1036, 1039, 1045, 1047, 1052, 1064, 1066, 1068, 1069, 1070, 1071, 1072, 1078, 1084, 1086, 1087, 1088, 1089, 1092, 1093, 1094, 1095, 1096, 1101, 1109, 1110, 1112, 1113, 1119, 1120, 1121, 1124, 1127, 1129, 1130, 1141 |
| Special / coordinate | 1127 (Worker 2 PR — #1116 plan), 1130 (#1128 plan), 1143 (#1125 plan), 1119/1124/1141 (docs plan PRs), 896 (18-outcome acceptance PR — large, review carefully) |
| UNKNOWN mergeable | 801, 896, 897, 901, 939, 1089, 1112, 1119 — re-fetch after main churn settles |

Procedure order: green mergeables in ascending number order → conflict repairs → failure triage → specials/coordination.

### DESIGN — per-PR procedure (exact)
1. `gh pr view <n> --json ...` + `git fetch origin pull/<n>/head` + `git diff --merge-base origin/main FETCH_HEAD` — read the diff.
2. Classify: GREEN-REVIEW (small scoped fix/test/docs, no red flags) → proceed; REVIEW-NEEDED (behavioral/feature, e.g. 896, 1109, 1113) → fuller read + check Devin Review comments; SKIP-CANDIDATE (out of scope/suspicious/superseded) → document reason on this issue, leave open.
3. CI: all checks SUCCESS/SKIPPED/NEUTRAL → merge. Any FAILURE → get failing check name + log signature; if identical signature exists on a green sibling or known main flake (e.g. `Browser tests`), rerun once via `gh run rerun`; real failure → document, skip.
4. CONFLICTING → `git checkout <pr-branch>; git merge origin/main`; resolve per union rule (keep both sides' content; on same-line edits keep main's renamed tokens like `--control-border` inside PR rules); push; wait for fresh CI; then merge. If repair would require design decisions, document and skip.
5. Merge each PR individually (no squashing multiple PRs). After each batch of ~5–10 merges, post a compact CHECKPOINT on this issue listing merged/skipped numbers.
6. After every merge, re-fetch mergeable state for the next candidates — merges into shared files (CHANGELOG, css tokens, window-globals) can instantly create new conflicts.

### EXECUTION_DAG
- **T01 — Merge remaining green set.** Deps none. All PRs in the mergeable class above, ascending order, per-PR procedure. Done-when: every listed PR is merged or moved to skip/failure class with a documented reason.
- **T02 — Conflict repairs.** Deps T01 partially (main must be stable). For 1082, 1111, 1122, 1123 (+ re-check 948/978/982/1035/1036 repairs pushed earlier — merge when their CI is green). Done-when: each repaired branch CI green and merged, or documented unrepairable-without-design.
- **T03 — Failure triage.** Deps none. 1083 + any PR that lands in failure class during T01/T02. For each: failing check name, log signature, flake-vs-real verdict, action (rerun/repair/skip).
- **T04 — Coordination PRs.** Deps owner plans. 1127→#1116, 1130→#1128, 1143→#1125: sweep worker leaves these to the owning plans; merge them only under those plans' procedures.
- **T05 — Post-sweep main rollup.** Deps T01–T04. Wait for checks on `main` HEAD after last merge; run `pnpm typecheck && pnpm lint` on fresh main worktree; post final CHECKPOINT with totals (merged / skipped-with-reason / still-open).

### VALIDATION
- Per-PR: that PR's own CI rollup green post-repair; diff review note recorded.
- Rollup: `git log origin/main` shows all merge commits; `gh pr list --state open --base main` returns only documented-skips; main HEAD checks green.
- Evidence: per-batch checkpoint comments; final matrix PR# → outcome.

### STATE
- Done: 30 merged (list in META); conflict repairs pushed on 948, 978, 982, 1035, 1036 (awaiting green CI at snapshot).
- Pending: ~72 open at snapshot (includes coordination PRs); 4–5 conflicting; 1 check-failure suspected flake.
- Risks: churn — every merge re-conflicts CHANGELOG/CSS/widget-typed PRs; `Browser tests` flake may serialize progress; some UNKNOWN mergeable PRs may resolve CONFLICTING after next main advance.
- Exact next step: merge 948, 978, 982, 1035, 1036 when their re-run CI goes green; then continue ascending green set.

### REFERENCES
- Issue checkpoints: claim + comment-7035499735 (001) + comment-7036… (002).
- Flake note: PR #891 Devin Review comment "Browser tests CI failure looks main-wide".
- List snapshot file: /tmp/prs.json on this session's VM (regenerate with `gh pr list --repo skytuhua-org/Gen-V1 --state open --json number,title,isDraft,baseRefName,mergeable,statusCheckRollup`).
- File attachment: `.md` upload unavailable via `gh`; plan lives in issue body (HANDOFF_COMPLETE).

