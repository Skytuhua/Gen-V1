# Patch vulnerable basic-ftp, @hono/node-server and hono overrides — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1005
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Patch vulnerable basic-ftp, @hono/node-server and hono overrides. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
## Requested outcome
Patch the vulnerable `pnpm.overrides` in `package.json`: move `basic-ftp` (pinned 6.2.1) to >=6.2.4, `@hono/node-server` (pinned 2.1.3) to >=2.1.6, and `hono` to >=4.13.16. Source: Gen V1 security audit, finding #3.

## Scope
`package.json` overrides and `pnpm-lock.yaml` only. One concern; no CI or security gate changes.

## Completion criteria
- [ ] All three packages resolve to patched versions (`pnpm why`)
- [ ] `pnpm audit` before/after posted; no basic-ftp/hono advisories remain
- [ ] Build green (CI)
- [ ] PR ready for review; merge only with owner's explicit approval

## REPO_MAP
Verified at baseline unless marked discovery:
- `package.json` — pnpm.overrides: basic-ftp 6.2.1, @hono/node-server 2.1.3, hono
- `pnpm-lock.yaml` — regenerate after override bumps

## DESIGN
Bump overrides: basic-ftp>=6.2.4, @hono/node-server>=2.1.6, hono>=4.13.16; reinstall to update the lockfile; no other changes.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Run pnpm audit before and record baseline | NONE | baseline advisory list captured |
| T02 | Bump the three overrides, pnpm install, verify pnpm why resolves patched versions | T01 | all three resolve to >= targets |
| T03 | Run pnpm audit after; confirm no basic-ftp/hono advisories; build green | T02 | audit clean; CI green; PR open |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1005; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1005: https://github.com/skytuhua-org/Gen-V1/issues/1005
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
