# Sub-plan: Real-user verification and docs (parent #1235 task T10)

## META
- Feature: Publish — end-to-end verification on a real GitHub account, then docs updates.
- Repo: skytuhua-org/Gen-V1. Parent issue: #1235 (plan `docs/agent-plans/thread-publish-pr.md` r1).
- Baseline: `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52`.
- Status: NOT_STARTED. Depends on sub-issues T08 (recovery UI) and T09 (design applied — spec `docs/agent-plans/1235-publish-design.md`).

## OBJECTIVE
Prove the feature end-to-end against real GitHub, then correct the demo docs.

## REQUIREMENTS (from parent)
- R10 docs: once verified, update `README.md` line 57 and `docs/public/media/launch-demos.md` to describe the real flow. The scripted demo stays labelled scripted until a real recording exists.
- Measurable success (parent): 1 review screen + 1 approval to an open draft PR; created PR head SHA equals reviewed commit; PR linked without manual entry; no blind retry of uncertain steps; flag off = no change.

## EXECUTION_DAG
| ID | Goal | Depends | Edits | Tests | Done when |
|---|---|---|---|---|---|
| T10 | Real-user verification + docs | T08, T09 | `README.md`, `docs/public/media/launch-demos.md` after verification only | Manual on Windows x64 source build, signed-in test GitHub account, throwaway repo: real draft PR created, head matches, checks appear; kill the app mid-push and recover | Evidence (redacted screenshots, test-repo PR URL) posted on #1235 |

## VALIDATION
Manual on Windows x64 (bundled `gh.exe`; feature is Windows-only per parent). `pnpm check:docs-links` when docs change. Evidence posted on #1235, handoff to the owner.

## STATE / HANDOFF
- Final gate before the feature can be called verified. Claim on #1235 first; RELEASE checkpoint on stop.
