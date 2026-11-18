# M17 Paired clients and bounded read synchronization — handoff

## Custody

- Worktree: `/home/piadmin/Gen-V1-m17-v6` (git worktree of `/home/piadmin/Gen-V1`).
- Remote: `https://github.com/skytuhua-org/Gen-V1.git` (resolves to skytuhua-org/Gen-V1, repository ID 1442565952).
- Branch: `agent/m17-v6`, cut at captured `origin/main` `c77d4716d94f72008be04562cbb596f1bb445512` (R03 merge was already-up-to-date).
- Audit anchor: `4805af4680094d2af48ecf666688e750797e9dda` (source-inspection anchor only; not a claim of test success).
- Duplicate-work search before creation: no `m17` branch, worktree, named implementation file or evidence doc existed locally or on remote refs.
- The original checkout `/home/piadmin/Gen-V1` (branch `fix/t10-agents-grid-v3`) and all other worktrees were preserved untouched, including uncommitted changes and the untracked `qwencloud-api-key.txt` (never read or copied).
- No reset, clean, stash or ref updates performed on the source cut; no account changes.
- Branch `agent/m17-v6` pushed at handoff (head `826db552131a72cd17eb762289d845979c865090`); draft PR <https://github.com/skytuhua-org/Gen-V1/pull/836> opened against `main` — no merge, no activation.

## R01 verbatim records (recorded on the original checkout before worktree creation)

```text
$ git rev-parse --show-toplevel
/home/piadmin/Gen-V1
$ git remote get-url origin
https://github.com/skytuhua-org/Gen-V1.git
$ git branch --show-current
fix/t10-agents-grid-v3
$ git status --porcelain=v1 --untracked-files=all
 M apps/web/src/App.tsx
 M tests/e2e/model-picker.spec.ts
?? qwencloud-api-key.txt
$ git worktree list --porcelain
worktree /home/piadmin/Gen-V1
HEAD 033d32cd3e14284a816a3e8aeaa66ffe92b34090
branch refs/heads/fix/t10-agents-grid-v3
(plus pre-existing m10/m12/m13/m14/m15/m16 worktrees; none named m17)
```

## Scope completed

- C1 pairing/cursor contracts: `packages/contracts/paired-device.ts` (DeviceGrantV1, SyncCursorV1, PairingRequestV1, SyncPageV1/deltas, RemoteTransportConfigV1, RemoteViewStatus, typed denial codes and the S05 page bounds), `apps/server/device-pairing.ts` (DevicePairingHost: 32-byte challenges, 10-minute TTL, verifier-only persistence, single-use consume inside one transaction, exact-match confirmation, 5-failures/minute and 100-pending limits, VIEW_EVIDENCE separate consent, SUBMIT_INPUT always denied, generation-bumping revoke, rollback, surface model, management routes, remote transport gate + TLS-only server builder).
- C2 host-authorized read handlers: `packages/core/read-sync.ts` (ReadSyncHost: Store-custodied HMAC-SHA-256 cursor key with rotation, fixed-cut snapshots, 1,000-delta/1-MiB bounded pages, owner/filter/generation/schema/bounds binding, filtered-vs-retention-gap distinction with RESYNC_REQUIRED, pre-emission grant recheck, reserved submit/approve rejects; ReadSyncClient: whole-page validation, request-generation staleness, OFFLINE/RESYNCING/STALE/SYNCED, draft separation, explicit cache clear).
- C4 bounded remote display/recovery: `ReadSyncClient` state model + `apps/web/src/PairedDevicesPanel.tsx` management surface wired into `Settings.tsx` (fingerprint, project scopes, read-only label, evidence consent, revoke with last-seen; no mutation control exists on the panel).
- G02 flags: `remote.readSyncV1` and `remote.submitInputV1` added to the owner registry, default false, owner `m17`, host-test injection only; never added to UI preferences.
- Tests: `tests/device-pairing-v3.test.ts` (12), `tests/read-sync-v3.test.ts` (16), `tests/read-sync-decisions-v6.test.ts` (6) — all D01–D06 cases bound to real assertions.

## Holds (recorded reasons, not status)

- HOLD_REMOTE_TRANSPORT: no TLS certificate/endpoint configuration was supplied; `buildRemoteReadSyncServer` stays unbuilt and no listener was opened. The remote surface exists only as the gate-tested `buildRemoteReadSyncServer` — deployment proof is a separate gate.
- HOLD_REMOTE_INPUT: `remote.submitInputV1` remains denied; the M09 durable-input and M02 authority bindings were never proved on this cut. Both `/remote/input/submit` and `/remote/operations/approve` (and their local mirrors) fail closed with REMOTE_INPUT_DISABLED.
- HOLD_CURSOR_KEY_CUSTODY is NOT held: the host-custodied key binds to the Store `hostSecret` entity with rotation; a malformed record fails closed with CURSOR_KEY_UNAVAILABLE (tested).

## Tested

- `pnpm exec vitest run tests/device-pairing-v3.test.ts` — 12/12 PASS.
- `pnpm exec vitest run tests/read-sync-v3.test.ts` — 16/16 PASS.
- `pnpm exec vitest run tests/read-sync-decisions-v6.test.ts` — 6/6 PASS.
- `pnpm typecheck` — PASS (NODE_OPTIONS heap raised to 12 GB on this 8 GB box; the default-heap run OOM'd mid-check, environment-bound).
- `pnpm lint` — PASS (0 violations).
- `pnpm exec vitest run tests/public-source.test.ts` — 10/11; sole failure is staged host/worker runtime resolution of `packages/{contracts,core}/verification-artifacts.ts`, absent from `runtime` on this base cut `c77d4716` (inherited manifest gap; fixed upstream by PR #765 / `8442085c`, deliberately not integrated; receipt: `logs/vitest-public-source-inherited.log`). All M17-owned manifest entries resolve.
- `pnpm test` aggregate — exit 1, 53 failed files, all environment-bound or pre-existing (server.test.ts, skills-integration, hermes-*, M16-D06's `PLATFORM_UNSUPPORTED`-vs-`DRIVER_UNAVAILABLE` on Linux, et al.). In-scope: read-sync-v3 16/16 and decisions 6/6 passed inside the aggregate; device-pairing-v3 recorded one flake (random deviceToken last-nibble `0` collision in the wrong-token case), identified and made deterministic in place; the post-fix standalone receipt (12/12) is attached in the verification doc.
- `pnpm build`, `pnpm test:browser` — see M17-verification.json command receipts and bounded logs.

## Untested / remaining gates

- No real remote listener ran: C3 usable-transport deployment proof is BLOCKED until an exact TLS+auth configuration exists and passes the separate deployment gate.
- `pnpm test` and `pnpm test:browser` outcomes are recorded verbatim in the verification doc; environment-bound failures outside M17 scope are named, not reclassified.
- Production flags `remote.readSyncV1` and `remote.submitInputV1` remain false; reviewerApproval remains false; publication stays LOCAL_ONLY.
- Evidence set: `docs/implementation/v3/M17-source-lock.json`, `docs/implementation/v3/M17-verification.json`, `docs/implementation/v6/M17/requirements.json`, `docs/implementation/v6/M17/logs/*` — all bound to base `c77d4716`.
