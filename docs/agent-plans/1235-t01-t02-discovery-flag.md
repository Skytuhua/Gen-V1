# Sub-plan: Discovery + capability flag (parent #1235 tasks T01–T02)

## META
- Feature: Publish (real commit, push and PR from a thread) — foundation slice.
- Repo: skytuhua-org/Gen-V1. Parent issue: #1235 (plan `docs/agent-plans/thread-publish-pr.md` r1).
- Baseline: `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52`.
- Status: NOT_STARTED. Planning approved; implementation needs owner go-ahead.

## OBJECTIVE
Answer the open DISCOVERY questions and land the `workspace.publishV1` capability flag (default off) so every later slice can gate its work. When the flag is off, all current surfaces behave byte-for-byte as today.

## REQUIREMENTS
- R1: flag `workspace.publishV1`, default off.
- Discovery answers are posted as a checkpoint comment on #1235 before/with the flag change.

## SCOPE (from parent EXECUTION_DAG)
- **T01 Discovery** (read-only, no edits): confirm the agent has no PR/push host tool (search `packages/runtime-*`, `packages/agent-projection`, `packages/core`); confirm `SelectiveCommitService` (`packages/workspace/selective-commit.ts`) has no HTTP route and decide whether to expose it behind `workspace.provenanceV1`; find whether a host can append a host-authored typed card to a thread (search `packages/core/service.ts`, `packages/agent-projection`, thread message types in `packages/contracts` — needed for T06/T07 card placement); read the M08 flag union shape. Done when a #1235 comment lists each answer with file:line evidence.
- **T02 Flag**: add `workspace.publishV1` to `packages/core/capability-flags.ts` (definition plus the appropriate key union). Done when `pnpm typecheck` passes and a unit test shows the flag off by default and routes deny when off (route test may land with T05 if routes don't exist yet — record that in the checkpoint).

## VALIDATION
`pnpm typecheck`; flag unit test under the existing capability-flag test pattern.

## STATE / HANDOFF
- Depends on: nothing. Unblocks every other sub-issue.
- Handoff recipients: T03 sub-issue (contracts) and T06/T07 sub-issues (card placement answer).
- Worker: claim with an AGENTS.md claim comment on #1235 before editing; release with a RELEASE checkpoint when done.
