# M16 Consented browser and desktop actions — handoff

## Custody

- Worktree: `%USERPROFILE%/repos/Gen-V1-m16-v6` (independent clone, not a worktree of the fork checkout).
- Remote: `https://git-manager.devin.ai/proxy/github.com/skytuhua-org/Gen-V1` (resolves to skytuhua-org/Gen-V1).
- Branch: `agent/m16-v6`, cut at `origin/main` `f20b92c636f9ba749a2a2ac027a9e1f053574198`.
- Audit anchor: `4805af4680094d2af48ecf666688e750797e9dda` (source-inspection anchor only; not a claim of test success).
- No reset, clean, stash or ref updates performed; no account changes.

## R01 verbatim records (recorded on the candidate before this follow-up commit)

```text
$ git rev-parse --show-toplevel
%USERPROFILE%/repos/Gen-V1-m16-v6
$ git remote -v
origin	https://git-manager.devin.ai/proxy/github.com/skytuhua-org/Gen-V1 (fetch)
origin	https://git-manager.devin.ai/proxy/github.com/skytuhua-org/Gen-V1 (push)
$ git branch --show-current
agent/m16-v6
$ git worktree list --porcelain
worktree %USERPROFILE%/repos/Gen-V1-m16-v6
HEAD 4fc0196e4a0087c7a50467c2c9ef3068547be9f4
branch refs/heads/agent/m16-v6
$ git status --porcelain
 M apps/web/src/ControlConsentPanel.tsx
 M packages/contracts/interactive-control.ts
 M packages/core/browser-consent.ts
 M packages/core/desktop-control.ts
 M packages/core/service.ts
 M tests/browser-consent-v3.test.ts
 M tests/desktop-control-v3.test.ts
 M tests/interactive-control-decisions-v6.test.ts
 ?? docs/implementation/v6/M16/ updated evidence files (this commit)
```

Preflight, before the first landing, HEAD was `f20b92c636f9ba749a2a2ac027a9e1f053574198` and `git status --porcelain` was empty; the same remote/branch/worktree values applied.

## Scope completed

- C1 contracts + pure deny tests: `packages/contracts/interactive-control.ts` (grant/action/capture/driver-registration/surface schemas, the D06/S06 constants and the D05/S07 `classifyControlAction` pure function), `packages/core/browser-consent.ts` (driver registry, consent lifecycle, grant/revoke with target-kind/mode consistency, live-record target revalidation, per-action authorization, host `stop`, surface model), `packages/core/desktop-control.ts` (serialized dispatcher: 200 ms min spacing, queue cap 16, 2 s observation freshness, generation-bound Stop, effect classification and consent allowlist at the input boundary).
- C2 disabled capability presentation: `apps/web/src/ControlConsentPanel.tsx` + `GET /api/threads/:id/control` + `control.request` and `control.stop` commands; the unavailable screen states no live control is active, separates Observe/Interact, names expiry and keeps Stop visible — and the active-state Stop is bound to `control.stop` through the real command path.
- G02 flags: `control.consentedBrowserV1`, `control.selectedDesktopV1` in `capability-flags.ts`, default false, host-test injection only.
- Store gained a read-only `inTransaction` accessor so host writes fold into the open command transaction (Store forbids nested commits).

## Holds (recorded reasons, not status)

- HOLD_DRIVER_SPECIFICATION: no approved driver registration exists; D02 blocks selection. C3/C4 live stages are BLOCKED and all live capture/input cases are NOT_RUN.
- HOLD_PLATFORM_PROOF: real Windows multi-monitor/focus/minimized/permission-loss acceptance (D06) must run against the installed approved driver before any live approval.
- `pnpm test` 57 failed / 4338 passed and `pnpm test:browser` environment-bound failures (missing Chrome distribution, fixture timeouts) — identical in character to the M15-recorded baseline; no M16-scope test failed.

## Tested

- `pnpm exec vitest run tests/browser-consent-v3.test.ts` — 13/0.
- `pnpm exec vitest run tests/desktop-control-v3.test.ts` — 10/0.
- `pnpm exec vitest run tests/interactive-control-decisions-v6.test.ts` — 8/0.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — exit 0.
- `pnpm test` — 57 failed / 4338 passed, all environment-bound, none in M16 scope.
- `pnpm test:browser` — 313 failed + 14 timed out / 1433 passed / 5 skipped across 78 suites, all environment-bound (missing Chrome distribution, fixture hosts, native brokers); no M16-scope spec exists in the suite. See bounded log.

## Not tested / not run

- All live capture/input paths (S08, T04, T05, U03 live closeout, D06 real-platform matrix): NOT_RUN, phase BLOCKED. This is not completed desktop control.
- Production flags remain false; reviewerApproval remains false; publication LOCAL_ONLY.

---

# Follow-up: first-party Windows control bridge (`followup/m16-windows-control-bridge`)

Manager-approved continuation of M16, cut at `origin/main` `b826684a` in worktree
`$HOME/Gen-V1-m16-v6`. One scoped draft PR is authorized; no merge, no
production flag change.

## Custody

- Branch: `followup/m16-windows-control-bridge`, implementation head `4b5a832c`.
- The M16 C1/C2 contract landed in the first pass is unchanged in shape — the
  bridge plugs into it, never bypasses it (grant authority stays in
  `BrowserConsentHost`; dispatch stays serialized in `ControlDispatcher`).

## What the bridge adds

- **Contracts** (`packages/contracts/interactive-control.ts`): `ControlDriverManifestV1`
  (immutable artifact path + SHA-256, optional adapter-module digest, supported
  protocols `browser-tab`/`native-window`, backend proof ref, target identity
  format, capture bounds, tested stop route) and `StoredCaptureV1` (host-owned
  artifact ref + content digest + `image/png`).
- **Host runtime** (`packages/core/control-runtime.ts`): the single approved
  driver attachment, per-thread dispatchers, target discovery, grant reuse,
  capture artifact storage (`control-captures/<thread>/<artifactId>.png`, mode
  0600) and stop/revocation. No grant is written outside the command path.
- **Sidecar driver** (`packages/core/control-sidecar-driver.ts`): backend-side
  `ControlDriverOperations` that forwards `candidates/pickTarget/observe/
  capture/dispatch/cancel` to the desktop bridge over the private
  launch-token IPC (`harness.control.call` / `.result`). Driver errors keep
  their HarnessError codes across the hop.
- **Desktop adapter** (`apps/desktop/control-bridge.ts`): C3 binds to the
  existing in-app `BrowserRecord` WebContents only — creation identity is
  `tab:<recordId>@<webContents.id>`, session identity binds navigation
  generation + geometry + DPI, origin binds the loaded URL. `capturePage` for
  observation; `sendInputEvent` for CLICK/TYPE/KEYPRESS only while window and
  contents focus are provable; NAVIGATE reuses the same public-URL guard;
  UPLOAD/DOWNLOAD refuse (session already denies them). No external profiles,
  no remote debugging, no page scripting, no global injection.
- **Window slice** (`packages/core/windows-control-bridge.cc`): app-owned
  consent chooser with **bound-item identity** (manager correction: an
  `HWND`+PID token cannot prove creation identity — HWNDs recycle within a
  process). `listWindows` enumerates live top-level application windows and,
  inside the same enumeration pass, marks each row with a window PROP token
  and calls `IGraphicsCaptureItemInterop::CreateForWindow` for it. The
  resulting `GraphicsCaptureItem` is HELD in a binding registry for the
  selection lifetime; the row's `bindingId` (`wgc:<token>`) is the
  creation-bound identity (`wgc:<bindingId>` in the target). Window props die
  with the window object, so `GetProp==token` after binding proves the bound
  object is the enumerated one — the selection-to-binding race is closed
  (any swap either lacks the prop or fails the pre-bind re-describe).
  Invalidation is three-way reliable: the item's `Closed` event, the window
  prop vanishing, and liveness `describe()` revalidation — a destroyed or
  same-process-replaced window (even same geometry, even recycled HWND)
  fails closed, and capture can never re-derive an object from an HWND.
  `captureWindow(bindingId)` runs WGC frame-pool capture on the ALREADY-bound
  item; `dropBinding` releases it on Stop/cancel; the chooser session still
  binds geometry+DPI so move/resize/DPI drift is `TARGET_MISMATCH`. The
  system `GraphicsCapturePicker` op stays refused
  (`CONTROL_PICKER_BINDING_UNSUPPORTED`): it cannot return an authoritative
  HWND, so `pickTarget` remains held while `candidates` is the approved
  chooser path. Native input dispatch is still **unsupported**
  (`CONTROL_OP_UNSUPPORTED`) — no proven selected-target delivery. Windows
  where `SetProp` is denied (e.g. elevated targets) are excluded from the
  chooser rather than offered unbound.
- **Registration** (`apps/server/host.ts` + `desktop-controls.ts`): the desktop
  pushes `harness.control.register` + manifest; the host recomputes SHA-256 of
  `artifact` (and `adapterModule` when present) before registering — an edited
  or stale manifest cannot qualify a different binary (D02). One manifest
  projects to per-protocol registry entries (`<driverId>:browser-tab`,
  `<driverId>:native-window` when the addon loads) so `resolve(mode)` still
  requires uniqueness — fixture-qualified, flags stay off.
- **Surface** (`apps/web/src/ControlConsentPanel.tsx`): pending consent now
  lists/selects driver-named targets and approves via `control.grant`; the
  active state offers consented capture + the same Stop. New routes:
  `GET .../control-targets`, `POST .../control-capture`, `POST
  .../control-observe`, `POST .../control-action` — session+CSRF, no new
  command surface beyond `control.grant`.
- **Packaging**: `scripts/build-windows-control-bridge.ts` (same pinned
  Node-API header + vswhere pattern as credential-lease; links windowsapp,
  d3d11, dxgi, ole32, dwmapi), `pnpm build:control-bridge`, packaged into
  `host/packages/core/` beside the credential lease.

## Holds (unchanged semantics, named)

- Flags `control.consentedBrowserV1`, `control.selectedDesktopV1` remain
  default-off; `reviewerApproval` remains false; no deployment enablement.
- HOLD_PICKER_BINDING (D02/D04, narrowed): the *system* picker still yields no
  authoritative HWND binding — `pickTarget` stays refused. The approved
  alternative is the app-owned chooser with held-item binding
  (`listWindows`/`candidates` → `windowIdentity`/`captureWindow` by
  bindingId). Fixture qualification receipts landed @ `e4531ae2`.
- HOLD_PLATFORM_PROOF stays until remaining Windows box receipts land:
  installed-app browser-tab consent/capture/Stop (env-blocked:
  `backend-deadline` + port-9222 collision) and one clean-box re-run of the
  owned fixture for teardown-exit confirmation (all assertions passed; the
  fixture process hung at exit on the degraded box — environmental anomaly,
  since `pnpm build` hung identically without loading the addon). Note: the
  9222 collision was in the *verifier's own launch script*, not checked-in
  config — `verificationPorts()`/`installedVerificationEnvironment()`
  allocate fresh ephemeral ports + owned data dir per run. Isolation re-run
  confirmed: fresh ephemeral ports 54968–54970 + owned data dir + verified
  nonce → CDP ready in ~0.5s, backend still emitted 0 stdout bytes in 60s
  → `backend-deadline` → `startup-failed` (driver exit 3). Classification:
  the deadline is real, not the port collision. Root cause then named by
  per-stage `launchHost` bisect: everything completes ≈110 ms except
  `service.recover()` → `source.library.initialize()` — a `skills.list`
  request that never settles (standalone backend >300 s, zero output; event
  loop alive → unbounded promise, not a sync block). Manager-authorized
  discriminator then isolated the exact seam @ `98d8f599`: a bounded direct
  `py.exe -3.14 -I -S -B worker.py` spawn under the checked-in
  `environment(home)` answered `hello` in ~2.5 s and correctly refused
  `skills.list` before `hello` — **the worker is healthy**; a bare launch
  idles on stdin as designed. But the real `HermesClient.request` stayed
  PENDING at 90 s with `guardAcquired=false` — it never left `ensure()` →
  `withHermesHome` → `withPathGuard`. Verbatim replication showed the guard
  child `powershell.exe -NoLogo -NoProfile -NonInteractive -File
  windows-path-guard.ps1` spawning then emitting 0 bytes (wedged
  powershell, environmental); the 45 s acquire bound DOES fire
  (`rpc result=DENIED` at 45,013 ms); but the teardown in the `finally`
  (`child.stdin.end()`; `kill` at +2 s; `await closed`,
  `packages/core/file-access.ts`) never settles because the wedged
  powershell cannot be killed — even `taskkill /F` — so `withPathGuard`
  never returns and the bounded denial becomes a permanent hang. Fix
  implemented on this branch (owner-authorized): the Windows outer
  `withPathGuard` teardown is now bounded — the existing 2 s graceful
  exit, exactly one kill attempt, then at most 2 s more to confirm the
  close; an unconfirmed close invalidates the session (`exited`, rpc
  permanently denied and pending RPC cancelled). The timeout cleanup
  removes the guard's listeners, retains Node's stdio close handlers, and
  handles late process or pipe errors during shutdown. It destroys and
  unreferences the parent handles. A fulfilled action fails closed with
  `CAPABILITY_DENIED`
  rather than claiming the child was reaped; an earlier
  `CAPABILITY_DENIED`/`CANCELLED` (including native details) still wins.
  With a wedged powershell the guard now rejects at ≈49 s (45 s acquire
  bound + ≤4 s teardown) → `service.recover()` throws →
  `apps/server/main.ts` emits the `backend-error` stage + `harness.error`
  → desktop `backend-policy` records a diagnosed `backend-error` inside
  its deadline instead of a silent `backend-deadline` — a promptly
  diagnosed failure, distinct from `harness.ready` readiness.
  Fake-child regressions (`tests/file-access-startup.test.ts`): denied
  acquire settles inside the bound with action never entered and the
  original denial untouched (incl. `nativeCode`), fulfilled action +
  unconfirmed close fails closed, close-after-kill still returns the
  value, one-kill-attempt counts asserted; normal close unchanged.
  The shutdown regression also checks that the stdio close observer
  remains registered and late errors are handled after unconfirmed close.
  Verified locally on this cut: file-access-startup 14/14, control-bridge
  59/59 suites green, typecheck 0, lint 618/0, evidence checker 0 issues;
  `desktop-host-ipc` error-channel suite passes unchanged. The latent
  sibling — unbounded `child.once('spawn'|'error')` in
  `packages/runtime-hermes/client.ts` — remains by design (not this
  owner's hunk). Consent/capture/Stop unreachable → browser slice
  BLOCKED. Side effect disclosed: one orphaned owned powershell pid
  survived `taskkill /F` on the box; no further native launches there —
  a clean, isolated verifier is required for platform proof.
- HOLD_NATIVE_INPUT: native-window input dispatch is refused at the driver
  (`CONTROL_OP_UNSUPPORTED`) — no proven selected-target delivery exists.
- FRESH_VERIFICATION_BROWSER returns zero candidates this pass — it is not
  silently satisfied by an existing tab.

## Verification status

- Evidence curation on this cut: the eight `logs/*-m16-bridge.log` raw
  verifier logs are now bounded redacted summaries (private absolute
  paths, usernames and third-party window titles removed; timings,
  statuses, digests and native observations verbatim). Original bytes are
  retained out-of-source; `logs/provenance.json` binds each summary to
  its raw SHA-256 and cut. Command `logDigest` fields re-point at the
  summaries; `check_m16_evidence.mts` compares log headers modulo the
  same profile-path normalization and still validates: 0 issues.
- `WIN-M0N0V07LGM1` receipts @ `636d9095` (bound-item chooser cut): vitest 5
  files **59/59 PASS** (control-bridge-v6 now 20); `tsc --noEmit` 0; lint
  618/0; `pnpm build:control-bridge` 0 — `windows-control-bridge.node`
  SHA-256 `320823347bc3acff52a247b31d2532892374436c0d68511b25be03b975e74553`.
  Owned-fixture PASS: `listWindows` 9 bound rows; spawned notepad bound as
  `wgc-100000006`; `captureWindow` → 42,618-byte PNG 1906×1346; destroy →
  `windowIdentity` null; **same-process replacement on recycled HWND
  `0xB0898` → old bindingId null + capture refused** (live HWND-recycling
  refusal demonstrated); `dropBinding` → null+refused. `pickWindow` still
  `CONTROL_PICKER_BINDING_UNSUPPORTED`. Defect found: teardown
  `0xC0000005` — held `GraphicsCaptureItem`s released by the static-map
  destructor after the WinRT apartment died. Fix history, all box-verified:
  env-cleanup drain (`a3fced63`) fired too late → still AV; leaked registry
  (`9ffed8e5`) removed the AV but the drain hook then deadlocked on a busy
  STA; final fix (`e4531ae2`) deletes the hook — nothing destructs at
  teardown while runtime drop paths release bindings. Verified `e4531ae2`:
  `windows-control-bridge.node` SHA-256
  `3c0ecafed1cb6ecb7c9667758bf5cebbb1249832ffd6051e9eff859cef39ff4c`;
  smoke exits clean; fixture assertions all PASS but the fixture process
  hung at exit on a degraded box (pnpm build — which never loads the addon
  — hung the same way; ~30 wedged processes + dead powershell; identical
  op sequences incl. 40×listWindows all exit 0) → environmental
  process-reaping anomaly, not an addon defect — pending one clean-box
  fixture re-run for final teardown confirmation. Browser slice BLOCKED on
  `backend-deadline`: the backend never publishes `harness.ready` even
  standalone (>300 s silent) because `service.recover()` →
  `source.library.initialize()` hung inside `withPathGuard`'s previously
  unbounded teardown `await closed` when its wedged powershell guard
  child won't die — proven by the discriminator and now fixed on this
  branch (bounded close + fail-closed invalidation above); platform proof
  still requires a clean, isolated Windows run reaching `harness.ready`.
- Older receipts @ `bdf5e27c` (hold cut): vitest 56/56, typecheck/lint 0,
  artifact `FC7F2161…C1E4`, all three exports refusing — preserved in git
  history and superseded by the `636d9095` bound-item receipts above.
- Delegate fixes on this cut: `windowIdentity` executor checked `cancelled`
  while the hold path sets `error` — it would have resolved a fabricated
  zeroed window; fixed to propagate the error (`bdf5e27c`). Also manifest
  `source[]` splice repair, tsc 5.9 never-narrowing (`fail` → function
  declaration), `.cc` compile fixes (`winrt/Windows.Foundation.h`,
  namespaced `IDirect3DDxgiInterfaceAccess`, 3-arg `CreateStreamOnHGlobal`,
  `user32.lib`), unused-binding cleanup, and test drain/close hygiene.
