# Gen V1 audit: stream hashes of large RC evidence files — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1180
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: stream hashes of large RC evidence files. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
RC evidence hashes load a complete file via readFile. On current Linux Node 24.22.3, a 2 GiB sparse ordinary file fails immediately with ERR_FS_FILE_TOO_LARGE. Profiles, archives and installer receipts require SHA-256 independent of working-set-sized allocations. Change only the hash helper, preserve exact digest/errors, and validate empty and multi-chunk fixtures plus a local sparse-file check. No change to the subprocess helper, archive format, installer or release gate.

## REPO_MAP
Verified at baseline unless marked discovery:
- `scripts/rc-review/common.ts` — hash helper loads whole file via readFile (verify)

## DESIGN
Stream SHA-256 for RC evidence so multi-GiB files don't hit ERR_FS_FILE_TOO_LARGE on Node 24; identical digests and errors; only the hash helper changes.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Convert hash helper to stream reads; empty + multi-chunk fixture tests | NONE | digests identical to readFile version |
| T02 | Local sparse-file (>2 GiB) check | T01 | sparse file hashes without allocation error |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1180; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1180: https://github.com/skytuhua-org/Gen-V1/issues/1180
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
