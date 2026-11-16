# M14 v6 handoff — Branchable sessions and inert history imports

Status: PARTIAL/BLOCKED — every implementable phase is complete and
source-bound; the remaining phases are named holds that require external
proof (a tested adapter fork API, an admitted parser manifest) or
platforms this Linux host cannot provide (browser, Windows/installed).
The final commit SHA is reported in the session response, not here.

## Custody

- Repository: `skytuhua-org/Gen-V1` (ID 1442565952), remote
  `https://github.com/skytuhua-org/Gen-V1.git`.
- Branch: `agent/m14-v3` (PR #343). Worktree:
  `/home/piadmin/Gen-V1-m14-v6` (clean).
- Recorded published head recovered at start:
  `b27c8360e1b0236a1df131cbc7893e9c492573df` (docs-only audit handoff —
  no product code existed).
- Base integration: merged `origin/main` `71b3b405` into the task branch
  as `ea48854b` (clean, no conflicts). That merge brings M04 request
  custody and M05 project memory onto the branch — the prior
  prerequisite gate is resolved.
- Original checkout `/home/piadmin/Gen-V1` left untouched, including its
  user edits and `qwencloud-api-key.txt`.

## Implementation (commit `5de9d4a6`)

- `packages/contracts/session-branch.ts` — `BranchRequestV1`,
  `SessionCaptureV1`, `ArchiveV1`, `HistoricalCursorV1`,
  `ARCHIVE_V1_LIMITS` (20 MiB, 100 conversations, 10,000 messages).
- `packages/core/history-import.ts` — strict ArchiveV1 validation
  (iterative cycle detection, graph integrity, typed `HarnessError`s),
  secret/access-link scan, deterministic digest dedup, atomic
  stage/commit/cancel inside `Store.command` (parse happens outside the
  transaction).
- `packages/core/session-branches.ts` — adapter capability matrix
  (hermes, pi, official-claude, official-gemini, official-cursor: receipt
  history yes, fixed-cut inspect `UNSUPPORTED`, native fork `UNPROVEN`),
  immutable owner-fenced captures with signed cursors and coverage-gap
  labels, `START_NEW_WITH_QUOTE` fresh-task creation with lineage,
  `FORK_CONVERSATION` refusing `FORK_UNSUPPORTED` with no partial state.
- `packages/core/service.ts` — `session.branch` and
  `historyImport.stage|commit|cancel` dispatch; side threads blocked;
  capability flags gate every mutation with `CAPABILITY_DENIED`.
- `packages/core/capability-flags.ts` — host-owned
  `sessions.branchV1`, `sessions.inertImportV1`, both default false.
- `apps/server/session-branch-routes.ts` + `server.ts` — owner-bound
  `Cache-Control: no-store` read routes and overview augmentation.
- `apps/web/src/` — `session-branch-api.ts`, `SessionBranchMenu.tsx`,
  `session-branch.css`, `App.tsx` wiring: Inspect point, quoted-context
  task, visibly-unavailable native fork, ArchiveV1 import with preview,
  lineage display. All labelled historical/inert; nothing is presented
  as continuation or native transcript.
- `scripts/public-source-files.json` — all new sources, tests and
  evidence enrolled.
- Tests: `tests/session-branch-v3.test.ts` (10),
  `tests/history-import-v3.test.ts` (12),
  `tests/history-import-decisions-v6.test.ts` (11) — 33/33 pass.

## Tested gates (receipts in `docs/implementation/v3/m14/logs/v6-*.log`)

- Targeted M14 suites: 33/33 PASS.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, prerequisite
  credential-lease/widget builds: PASS.
- `tests/public-source.test.ts`: 11/11 PASS after manifest enrollment.
- Consumed contracts on the merged tree: 8/9 files PASS;
  `tests/capabilities.test.ts` fails 13 on `linux-path-guard`
  (root/CAP_SYS_ADMIN mount namespaces) — environmental, matches the
  audited baseline class.
- `pnpm test`: 3650 passed / 279 failed / 57 skipped; every failure is in
  pre-existing environmental classes (path guard, missing `pty.node`,
  port conflicts with sibling worktrees, contention timeouts). No
  M14-caused failure after the manifest fix.

## Untested / blocked gates

- `pnpm test:browser`: NOT_RUN to completion — `pty.node` native module
  absent (pnpm-ignored build script), dev-server port conflict, `EACCES`
  on foreign `/tmp` artifacts. Environmental on this host.
- Windows/installed desktop matrix: NOT_RUN — no Windows host exists
  here; the platform claim is explicitly not made.
- Live UI acceptance: source-bound only (typecheck/lint/build/unit
  dispatch); no live browser proof of `SessionBranchMenu`.

## Holds

- `HOLD_NATIVE_FORK` — no `RuntimeAdapter` implementation exposes a
  tested fork API; `RuntimeAdapter.history` returns receipt IDs only.
  `FORK_CONVERSATION` stays `FORK_UNSUPPORTED`.
- `HOLD_EXTERNAL_FORMAT` — only strict ArchiveV1 JSON is admitted;
  ZIP/gzip/binary payloads reject `UNSUPPORTED_IMPORT_FORMAT` pending a
  pinned parser/license/dependency manifest.
- `HOLD_IMMUTABLE_SOURCE` — projected UI messages are not a native
  transcript; Inspect captures a host-copied fixed cut.

## Evidence

- `docs/implementation/v3/M14-verification.json` — V3 schema bundle;
  `reviewerApproval: false`, both flags reported disabled.
- `docs/implementation/v6/M14/source-lock.json` — inspected blobs at the
  implementation base.
- `docs/implementation/v6/M14/requirements.json` — C/S/U/T/G + D01–D05
  dispositions.
- `docs/implementation/v6/M14/verify-evidence.mjs` — passes: schema, lock
  digest, contract blobs, flags, holds and bounded log digests all
  verified.

## Activation and rollback

Both flags remain default-off; disabling creation/import preserves
already-committed captures, lineage and import receipts (read paths stay
available under owner fencing). LOCAL_ONLY — no push or remote merge was
performed or authorized.
