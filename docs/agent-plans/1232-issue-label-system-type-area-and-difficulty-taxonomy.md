# Issue label system: type, area and difficulty taxonomy — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1232
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Issue label system: type, area and difficulty taxonomy. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
Documents the label taxonomy now applied across open issues, requested by the maintainer to make the backlog more organized.

## Taxonomy

### Type (what kind of work)
- `bug` — something is broken
- `enhancement` — new feature or improvement
- `documentation` — docs changes
- `type:refactor` — cleanup with no behavior change (casts, dedupe, dead code)
- `type:test` — add/fix tests, verification and acceptance work
- `type:security` — security fixes, hardening, vulnerable dependencies
- `type:tracking` — umbrella issue grouping sub-tasks (sweeps, worker issues, audits)

### Area (where it lives)
- `area:frontend` — web/desktop UI
- `area:runtime` — server, core and runtime packages
- `area:ci` — CI workflows, test infrastructure, scripts
- `area:docs` — documentation

### Level — difficulty (who/what can take it)
- `level:low` — mechanical work, safe for free sessions or smaller models
- `level:medium` — focused change with some design or risk
- `level:high` — design-heavy work for stronger models

### Priority — backlog order
- `priority:high` — blocks the release or other work in flight; do first
- `priority:medium` — normal backlog order
- `priority:low` — nice to have; pick up when free

### Standing labels (unchanged)
`accessibility`, `ci-test`, `deferred`, `good first issue`, `help wanted`, `duplicate`, `invalid`, `question`, `wontfix`

## Conventions
- Every open issue should carry at least one type and one difficulty; area and priority where they apply.
- `type:tracking` issues group sub-tasks and stay open until the children land.
- `deferred` stays the signal for out-of-scope work.
- New issues are first-pass labeled by the `issue-labeler` workflow (PR #1233) and confirmed by agents per AGENTS.md.

## Done when
- [x] New labels created (incl. priority:*)
- [x] All open issues labeled with type/area/level/priority
- [x] Taxonomy + auto-label rule written into AGENTS.md (PR #1233)

## REPO_MAP
Verified at baseline unless marked discovery:
- `docs/` — location for the taxonomy doc (name TBD, e.g. docs/issue-labels.md)
- `AGENTS.md` — may need a pointer to the taxonomy

## DESIGN
Document the label taxonomy already applied across open issues: type, area, level and priority labels, with when to apply each. Docs only.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Write the taxonomy doc from the issue's taxonomy | NONE | doc covers type/area/level/priority tables |
| T02 | Add a pointer from contributor-facing docs | T01 | discoverable link |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1232; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1232: https://github.com/skytuhua-org/Gen-V1/issues/1232
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
