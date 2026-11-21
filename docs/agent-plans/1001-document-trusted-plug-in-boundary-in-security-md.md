# Document trusted plug-in boundary in SECURITY.md — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1001
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Document trusted plug-in boundary in SECURITY.md. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
## Requested outcome
State the trusted plug-in boundary in SECURITY.md (from a dependency/secret-handling audit). Trusted V1 plug-ins run in-process (`packages/plugins/host.ts`; the isolated lane is held closed in production, `apps/server/host.ts`). The `active.json` index and inventory digests are not a boundary against code running as the same Windows user, which can already unprotect current-user DPAPI data and modify the per-user install (`perMachine:false`).

## Scope
Docs only: `SECURITY.md`, plus one sentence in `docs/architecture.md`. No change to the plug-in trust format. This follows M13-C01/G01: existing V1 plug-ins stay explicitly trusted until an M03 backend exists (#774).

## Completion criteria
- SECURITY.md states that plug-ins are trusted in-process code and names the same-user limitation.
- docs/architecture.md doesn't present the frontend frame as the whole plug-in boundary.
- Markdown links and the required CI checks pass on PR #940.
- Owner review and explicit merge approval.

## REPO_MAP
Verified at baseline unless marked discovery:
- `SECURITY.md` — target doc
- `docs/architecture.md` — add one sentence; must not present the frontend frame as the whole plug-in boundary
- `packages/plugins/host.ts` — in-process plug-in host (source of truth)
- `apps/server/host.ts` — isolated lane held closed in production

## DESIGN
Docs only: state that trusted V1 plug-ins run in-process, that active.json and inventory digests are not a boundary against same-user code (DPAPI unprotect, per-user install modify, perMachine:false), and that full trust stays until an M03 backend (#774) exists.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Write the trusted-boundary section in SECURITY.md | NONE | states in-process trust + same-user limitation |
| T02 | Add the boundary sentence to docs/architecture.md | NONE | architecture doc no longer implies the frame is the boundary |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1001; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1001: https://github.com/skytuhua-org/Gen-V1/issues/1001
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
