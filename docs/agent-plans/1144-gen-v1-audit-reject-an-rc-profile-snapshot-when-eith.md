# Gen V1 audit: reject an RC profile snapshot when either source root is missing — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1144
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: reject an RC profile snapshot when either source root is missing. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
The RC snapshot inventories both profile and host roots as upgrade preservation evidence. Confirm that an absent or mistyped root is silently reported as empty. Fix only verified false-empty inventories: require both submitted roots to exist as directories, allow existing empty roots, and retain optional account-directory behavior. Test with synthetic temporary paths; no installer, profile migration, or release-gate changes. Open a focused PR only after red/green verification and preserve required CI and independent review.

## REPO_MAP
Verified at baseline unless marked discovery:
- `scripts/rc-review/profile-manifest.ts` — profile/host root inventory (verify)
- `scripts/rc-review/run-rc-review.ts` — snapshot entry point
- `tests/rc-review.test.ts` — existing RC tests

## DESIGN
Require both submitted roots to exist as directories before the RC snapshot; keep existing empty roots allowed and optional account-directory behavior. Synthetic temp paths only.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Reproduce false-empty inventory with a missing/mistyped root | NONE | red synthetic test |
| T02 | Validate roots as directories pre-inventory; preserve empty-root and account-dir behavior | T01 | green; focused PR |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1144; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1144: https://github.com/skytuhua-org/Gen-V1/issues/1144
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
