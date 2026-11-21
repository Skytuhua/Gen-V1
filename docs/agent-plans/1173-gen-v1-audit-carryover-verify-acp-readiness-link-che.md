# Gen V1 audit carryover: verify ACP, readiness, link checker and Gemini merges — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1173
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit carryover: verify ACP, readiness, link checker and Gemini merges. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
Resume scheduled backend audit verification for four existing PRs now merged outside the audit run: T01 #891 (ACP frame accounting), T02 #897 (readiness launch error), T03 #926 (ATX heading handling in CI link checker), and T04 #938 (Gemini clean-close final record). This issue tracks the audit's verification only, not the all-PR merge sweep (#1126) or the separate docs correction (#1060). No new implementation or merge is authorized by this issue. Acceptance per PR: confirm exact merged head and parent/tree on main, record exact PR CI and independent review evidence separately, run targeted regressions on current main, and check the exact main-push workflow. Preserve unrelated failing baseline evidence; do not waive checks or edit docs here. Do not close without authorization.

## REPO_MAP
Verified at baseline unless marked discovery:
- `PRs #891,#897,#926,#938` — the four merges under verification
- `scripts/check-doc-links.mjs` — ATX/link checker subject (verify)

## DESIGN
Verification-only issue: for each merged PR, confirm exact merged head/parent/tree on main, record PR CI + independent review as separate evidence, run targeted regressions on current main, and check exact main-push CI. No new implementation or merge.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | #891 ACP frame accounting verification | NONE | head/ancestry/CI/regression evidence |
| T02 | #897 readiness launch error verification | NONE | same evidence set |
| T03 | #926 ATX heading link checker verification | NONE | same evidence set |
| T04 | #938 Gemini clean-close final record verification | NONE | same evidence set |
| T05 | Consolidated verification report; no closing without authorization | T01-T04 | report comment posted |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1173; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1173: https://github.com/skytuhua-org/Gen-V1/issues/1173
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
