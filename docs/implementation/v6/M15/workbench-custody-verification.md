# M15 V6 C4 — installed workbench source/draft custody verification addendum

## Status

**NOT_RUN — clean Windows execution pending.** This addendum records the
installed-app custody verifier and its exact command contract. No Windows gate was executed, so no
acceptance case below is proved. The prior attempt to launch the T3 Windows
environment returned HTTP 524 and the linked WIN-M0N0V07LGM1 box has evidenced
hangs plus an unreaped process; no native launch was retried.

## Custody (authoring environment)

- Worktree: isolated T3 worktree at `verify-m15-installed-wo-172f6e62f2b292e1`,
  remote `https://github.com/skytuhua-org/Gen-V1.git` (repository ID 1442565952).
- Exact cut under test: `db3c0cf6ca675e70f396ff0011abe88be216fc0c` (HEAD, clean
  before this patch).
- Authoring host: Linux aarch64, Node v24.11.1, pnpm workspace install.
- The patch is verification-only. Product flags stay default-off. The manual
  run on the dedicated verification ref adds the workbench case after the
  existing Windows installer job's steps. `ui.sourceWorkbenchV1` and
  `reviewerApproval` remain false in product configuration; activation exists
  only inside the disposable installed profile for the duration of the owned
  launch (`HARNESS_FLAG_UI_SOURCE_WORKBENCH_V1=true` on the spawned process
  environment, same channel as the memory phase's flag injection).

## What was added

- `scripts/installed-workbench-custody.ts` — new verifier module mirroring
  `installed-memory-retention.ts` conventions:
  - `seedInstalledWorkbenchProfile(directory)` — creates a brand-new disposable
    `host/` profile inside the owned evidence directory; refuses non-absolute,
    symlinked, or pre-existing profile paths; seeds two `ready` owner threads
    (`installed-workbench-owner`, `installed-workbench-unrelated`) each with one
    assistant message containing unique select-able fragments. No account,
    model, project, or provider records.
  - `verifyInstalledWorkbenchUI(page, seed, iteration, observations, nativeOwner)`
    — drives the real packaged renderer through the owned CDP session.
  - `observeInstalledWorkbenchStorage(seed, iteration)` — post-exit SQLite
    `Store` audit of the same physical profile.
- `scripts/verify-installed-desktop.ts` — new exclusive `--workbench-custody`
  option (mutually exclusive with the memory phases), `workbenchCustody`
  parameter through `installedVerificationEnvironment`, `launchInstalled`, and
  `verifyInstalledDesktop`; receipt gains `workbenchCustodyRequested`,
  `workbenchCustody` scope block, and per-launch `workbenchCustody` markers.
- `tests/installed-desktop-verification.test.ts` — new
  `installed workbench custody fixture` describe: option parsing and phase
  exclusivity, environment isolation (ambient `HARNESS_FLAG_*` never inherited;
  only the explicit phase sets the source-workbench flag), seed invariants,
  refusal paths (existing profile, redirected root, replaced backend directory),
  and post-exit audit refusal when no capture exists.

## Acceptance-case mapping

| # | Case | Where exercised | Status |
|---|------|-----------------|--------|
| 1 | Exact installed executable startup | Unchanged packaged-launch custody: nonce-bound CDP ownership, `Browser.getBrowserCommandLine` exe identity, health endpoint, clean exit | NOT_RUN |
| 2 | Two owned tasks; draft + authorized source reference retained on switch | Seed two threads; Ask capture + Attach capture under owner A; `draft:<A>` and `source-context:<A>::` in IndexedDB; switch to B: empty composer, `Destination:` B, zero chips, zero B journal records | NOT_RUN |
| 3 | Native desktop window handoff/return with custody | Product sidebar `Options for …` → `Detach thread` menuitem → real bridge `detach` (asserts `getContext().surface` is the owner thread); main window held notice; draft continues in detached window; `bridge.reattach()`; custody audit (draft sha, 2 refs, `sendMode: AFTER_CURRENT`, `conflictState: NONE`, no `workbench-conflict:*`, no B writes) | NOT_RUN |
| 4 | Orderly close + restart on same disposable profile | `launchInstalled` iteration 2, same profile/ports: draft value, 2 chips, `After current run` restored; journal + post-exit `Store` audit: 2 owner captures with expected selected-text digests, 0 user messages, 0 outbox, 0 admissions, threads unchanged | NOT_RUN |
| 5 | Ask does not auto-submit; exactly-once owner-bound send | Asserted: no `POST /api/commands message.send`, no `agents-pending:<A>` record, Send button disabled (no model). Exactly-once queued send after settle is **bounded-fixture-only**: installed `sendMessage` requires an available model binding (`MODEL_UNAVAILABLE` precedes durable outbox admission) and this proof uses no model endpoint — recorded as `queuedDispatch` note in observations | NOT_RUN (send portion fixture-bounded) |

Conflict-copy behavior on failed/uncertain flush is exercised only if the
product itself encounters the condition during the real run; the verifier
asserts the resulting `workbench-conflict:*`/retained-state keys rather than
simulating failure. No synthetic flush failure is injected.

## Exact Windows command contract

Requirements on the clean Windows x64 box, from repo root at the exact cut:

- Windows x64 (`process.platform==='win32' && process.arch==='x64'` — enforced).
- Pinned Node `>=24.10.0` (repo `engines`; Windows box used v24.22.2) and pnpm
  `10.30.3` via corepack; `pnpm install --frozen-lockfile` completed.
- A packaged-but-uninstalled `win-unpacked/` tree plus its `Setup.exe`
  installer produced by the checked-in packaging pipeline for this commit.
- Absolute paths to both; the verifier owns a temporary per-user install, an
  exclusive evidence directory, and ephemeral loopback ports.

```
cmd.exe /c node_modules\.bin\tsx scripts\verify-installed-desktop.ts "C:\ABSOLUTE\PATH\Gen V1 Setup.exe" "C:\ABSOLUTE\PATH\win-unpacked" --workbench-custody
```

Success exits 0 and writes `.harness-desktop-installed/run-*/verification.json`
with `workbenchCustody.observations`, `launchReadiness` entries carrying
`workbenchCustody: true`, screenshot digests (detached + reattached +
restart), the bounded `/api` request log (captures present, zero
`message.send`), and post-exit storage audits. Any assertion failure throws
with the stage and leaves the failure observation in the receipt.

## Blocker

The linked Windows verifier remains unavailable following a T3 HTTP 524
and observed native-process hangs. The dedicated manual CI run uses the
existing Windows packaging job on a verification ref and records the
actual checked-out SHA and the source cut. The run uploads a redacted
summary and only digest-verified screenshots from the synthetic profile.

## Local (Linux) validation of the patch itself

- `node_modules/.bin/vitest run tests/installed-desktop-verification.test.ts`
  — 42/42 pass (includes the 5 new custody-fixture tests and updated arg
  assertions).
- `NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc --noEmit` —
  clean (default heap OOMs on this repo; unrelated to the change).
- `node_modules/.bin/tsx scripts/lint-ui.ts --check` — 0 violations.
