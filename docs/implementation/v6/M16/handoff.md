# M16 Consented browser and desktop actions — handoff

## Custody

- Worktree: `C:/Users/Administrator/repos/Gen-V1-m16-v6` (independent clone, not a worktree of the fork checkout).
- Remote: `https://git-manager.devin.ai/proxy/github.com/skytuhua-org/Gen-V1` (resolves to skytuhua-org/Gen-V1).
- Branch: `agent/m16-v6`, cut at `origin/main` `f20b92c636f9ba749a2a2ac027a9e1f053574198`.
- Audit anchor: `4805af4680094d2af48ecf666688e750797e9dda` (source-inspection anchor only; not a claim of test success).
- No reset, clean, stash or ref updates performed; no account changes.

## R01 verbatim records (recorded on the candidate before this follow-up commit)

```text
$ git rev-parse --show-toplevel
C:/Users/Administrator/repos/Gen-V1-m16-v6
$ git remote -v
origin	https://git-manager.devin.ai/proxy/github.com/skytuhua-org/Gen-V1 (fetch)
origin	https://git-manager.devin.ai/proxy/github.com/skytuhua-org/Gen-V1 (push)
$ git branch --show-current
agent/m16-v6
$ git worktree list --porcelain
worktree C:/Users/Administrator/repos/Gen-V1-m16-v6
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
`/home/piadmin/Gen-V1-m16-v6`. One scoped draft PR is authorized; no merge, no
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
- **Window slice** (`packages/core/windows-control-bridge.cc`): Node-API addon
  exposing `pickWindow` (system `GraphicsCapturePicker` on a dedicated STA
  thread; result bound to exactly one live application HWND by title/client
  match — displays, zero or ambiguous matches fail closed), `windowIdentity`
  (live HWND+PID+bounds+DPI re-proof) and `captureWindow` (WGC frame pool →
  staging texture → WIC PNG). Native input dispatch is **unsupported** — no
  proven selected-target delivery path; the requirement stays held.
- **Registration** (`apps/server/host.ts` + `desktop-controls.ts`): the desktop
  pushes `harness.control.register` + manifest; the host recomputes SHA-256 of
  `artifact` (and `adapterModule` when present) before registering — an edited
  or stale manifest cannot qualify a different binary (D02). One manifest
  projects to per-protocol registry entries (`<driverId>:browser-tab`,
  `<driverId>:native-window`) so `resolve(mode)` still requires uniqueness.
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
- HOLD_PLATFORM_PROOF stays until the Windows box receipts land: real
  `windows-control-bridge.node` build SHA-256, `pickWindow` driven against the
  real `GraphicsCapturePicker`, real `captureWindow` PNG.
- HOLD_NATIVE_INPUT: native-window input dispatch is refused at the driver
  (`CONTROL_OP_UNSUPPORTED`) — no proven selected-target delivery exists.
- FRESH_VERIFICATION_BROWSER returns zero candidates this pass — it is not
  silently satisfied by an existing tab.

## Verification status

- Awaiting delegate receipts from `WIN-M0N0V07LGM1` (targeted vitest files,
  typecheck, native compile, addon smoke, picker interaction, capture PNG,
  artifact SHA-256). This section must be updated with verbatim results before
  any PR moves past draft.
