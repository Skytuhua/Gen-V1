# M16 installed platform-proof — recovered spec, bounded procedure, CI assessment

Prepared at curated PR #812 head `4110b56a3fc0b7cc81be0af7712bb90933f13428` on
`followup/m16-windows-control-bridge`. This document recovers the exact owned
verifier specification used around `98d8f599`, assesses the hosted Windows
`ci.yml` installer runner as an alternative verifier environment, and defines
the bounded installed browser-tab proof as a **scenario callable from the
established installed lifecycle** — `scripts/m16-installed-control-scenario.ts`.
The standalone-launcher variant was rejected: it could hash/launch an
unrelated `win-unpacked` tree beside a valid Setup, and `build-manifest.json`
carries no checkout SHA or unpacked-payload binding. Install, provenance,
launch, owner verification, profile creation and cleanup must stay with the
trusted verifier.

## 1. Recovered launch specification (`launchInstalled`, verify-installed-desktop.ts)

The owned installed launch is fully checked in:

- **Executable**: `spawn(exe, ['--remote-debugging-port=<P2>', '--remote-debugging-address=127.0.0.1', '--enable-automation', '--harness-verification=<nonce>'], {cwd: dirname(exe), env, windowsHide: false, stdio: ['ignore','pipe','pipe']})`.
- **Ports**: `verificationPorts()` — three ephemeral `listen(0)` loopback ports; `P0` host, `P1` widget, `P2` CDP debug.
- **Nonce**: `randomUUID()`; proven by `Browser.getBrowserCommandLine` → `assertWrapperArguments` (nonce must appear in argv) plus `sameWindowsPath(args[0], exe)` — the debug browser must be the exact installed executable.
- **Owned env**: `installedVerificationEnvironment(dir, ports)` — scrubbed `baseEnvironment()` + `HARNESS_DESKTOP_TEST_DATA_DIR=<owned dir>` + `HARNESS_DESKTOP_PORT=P0` + `HARNESS_DESKTOP_WIDGET_PORT=P1`. Ambient feature activation cannot inherit.
- **Disposable profile**: the evidence/data directory is newly created per run by the installed lifecycle, with a canonical non-symlink parent; its `verification.json` is the exclusive run receipt.
- **Provenance binding**: the trusted lifecycle binds the checkout/CI build identity, package version, invoked-installer digest, launched-executable digest and verified matching-content payload digest. The M16 scenario consumes these verbatim (`assertInstalledControlProvenance` refuses absent/malformed values) — it never accepts a filename or invocation cwd as proof.
- **Owner-guarded actions**: launchInstalled's `verifyBrowserOwner` (nonce + exact exe path) is the ownership gate; the scenario additionally refuses to act on a page whose origin is no longer the owned origin.
- **Bounded cleanup**: owned-process termination, uninstall and evidence writes stay with the established harness; the scenario launches and closes nothing.
- **Readiness**: `waitForInstalledMainPage` — 80s envelope (production 60s backend + 20s surface budget), owned-origin page classification, owner revalidated at candidate observation, failure kinds `deadline|launch-error|process-exit|owner-rejected|page-query`. Startup output via `observeInstalledStartup` (byte counts + spawn/exit/close only — child text stays out of evidence).
- **Owned clean exit**: `page.evaluate(() => window.close())` → `waitForOwnedExit` ≤15s → `assertInstalledCleanExit` (`exitCode===0 && signalCode===null`) → `/health` must go dark ≤15s.

## 2. M16 browser-tab proof sequence (`runInstalledBrowserControlScenario`)

Everything runs through the production command path — `POST /api/commands`
→ `service.command`, the same transaction the ControlConsentPanel issues — with
a real pending-consent lifecycle. The renderer's per-boot launch secret is read
from `location.hash` and exchanged once at `/api/bootstrap` for the session
cookie + CSRF token; every subsequent call is an authenticated same-origin
fetch. No UI stubbing, no driver bypass. Launch, owner verification, profile
creation and process cleanup remain with the calling installed verifier.

| # | Step | Call | Assertion |
|---|------|------|-----------|
| 0 | Baseline targets | `GET /api/threads/:id/control-targets?mode=CONSENTED_EXISTING_TAB` | snapshot `creationIdentity` set |
| 1 | Owned thread | command `thread.create` | thread id returned |
| 2 | Owned browser | `window.harnessDesktop.browser({type:'open'})` (docked app-owned BrowserView) | — |
| 3 | New candidate | `control-targets` poll ≤30s | exactly **one** new `creationIdentity` row — the exact selected target |
| 4 | Fixture consent request | command `control.request {mode: CONSENTED_EXISTING_TAB, observe: true, operations: []}` | `consent.state === 'PENDING'` |
| 5 | Grant | command `control.grant {consentId, target}` | `capturePermission===true`, `permittedOperations===[]`, surface `active` |
| 6 | Bounded capture | `POST /control-capture` | `artifactRef` under `control-captures/`, 64-hex `sha256`, positive `frameDimensions`, `captureScope.kind==='TAB'`; then the actual PNG bytes under `<profile>/host/` are read back — PNG magic, nonzero size, `sha256` must equal the record (runtime enforces `CAPTURE_BOUNDS_EXCEEDED`) |
| 7 | Independent Interact | `POST /control-action {CLICK}` | HTTP error with `CAPABILITY_DENIED` — Observe ≠ Interact; recorded as a **consent-scope denial**, not in-flight input cancellation |
| 8 | Independent Stop | command `control.stop` then `POST /control-capture` | post-stop capture `CAPABILITY_DENIED` — revocation fail-closed |
| 9 | Clean exit | (harness-owned) `window.close()` + wait + health poll | `assertInstalledCleanExit`, `/health` dark ≤15s |

`FRESH_VERIFICATION_BROWSER` returns zero candidates by design and is not
silently satisfied by an existing tab — the fresh-row diff in step 3 is the
exact-target proof instead. The scenario returns a bounded receipt (timings,
ids, digests, counts — no window titles beyond the owned browser's, no page
content, no machine paths); the caller merges it into `verification.json`.

Flag note: `HARNESS_FLAG_CONTROL_CONSENTED_BROWSER_V1=true` must be set **only**
in the owned child environment by the launching verifier — the flag snapshot in
every other process stays default-off; the shipped build and defaults are
unchanged.

## 2a. Proposed integration interface (NOT yet applied — shared files stay untouched)

`verify-installed-desktop.ts` would gain one opt-in flag
(`--m16-browser-control`, implies no memory phases). Inside `launchInstalled`,
after `waitForInstalledMainPage` succeeds and before `window.close()`:

```ts
const control = await runInstalledBrowserControlScenario({
  page, directory, origin,
  provenance: {
    sourceSha: process.env.GITHUB_SHA ?? '<filled by caller from build record>',
    packageVersion: <version already parsed for assertOwnedInstallEntries>,
    installerSha256: <setupSha256 already computed via identity()>,
    executableSha256: await hashFile(executable),
    payloadSha256: <expected.sha256 from packageContentManifest(unpacked)>,
  },
});
(receipt.controlScenario = control);
```

All inputs are values the lifecycle already computes or verifies
(`setupSha256`, `packageContentManifest`, `DisplayVersion`, and the launched
`executable` path). The scenario additionally guards every renderer call on
the owned-origin page; `window.close()`/exit stays in `launchInstalled`.
Because `verify-installed-desktop.ts` is under M15's active custody, this is
proposed only — the scenario stands alone and is callable from any driver that
supplies the same verified inputs (e.g. a thin local wrapper on a clean box).

## 3. Hosted `ci.yml` installer runner — assessment

The `installed-memory` job on `windows-latest` already runs the full installed
verifier (`pnpm exec tsx scripts/verify-installed-desktop.ts <Setup.exe>
<win-unpacked> …`) against a `pnpm desktop:package` build, launches the
installed Electron app, connects CDP, drives real UI, and uninstalls. All jobs
carry the draft gate `if: github.event_name != 'pull_request' ||
github.event.pull_request.draft == false`, so the manually dispatched run
`44417512648` (bound to `4110b56a3f`) executes this matrix on a clean hosted
box.

**Compatible for**: proving the exact-cut backend reaches `harness.ready`
inside an installed app on a clean Windows box, exact packaged digests
(`build-manifest.json`), owned clean exit/uninstall — i.e., the platform
prerequisite that the degraded box could not supply.

**Not sufficient alone for M16**: the installed-memory verifier asserts
default-off/enabled memory retention, not consent/capture/Stop. An M16 job
would additionally need (a) this script (or equivalent) added to the job, (b)
`HARNESS_FLAG_CONTROL_CONSENTED_BROWSER_V1=1` in the owned launch env, (c) a
display-session runner — windows-latest provides one (the existing job already
drives windows/screenshots). Windows Graphics Capture for
`SELECTED_DESKTOP_APPLICATION` additionally needs a non-headless session, which
the hosted runner's interactive session provides; the browser-tab slice needs
no native artifact at all (`browser-tab` registers without
`windows-control-bridge.node`).

## 3a. Native bridge packaging gate — /std:c++20 (pending clean-box proof)

Run `44417512648` job `135201569165` (windows-latest, MSVC 14.51.36231) failed
in `build-windows-control-bridge.ts` with `C2338 STL1011` from
`<experimental/coroutine>` — the modern MSVC STL removed the experimental
coroutine header that C++/WinRT pulls in under `/std:c++17`. Our own
`windows-control-bridge.cc` contains no coroutine keywords and no
`std::experimental::` names; all its constructs are C++20-valid (checked:
no `u8` literals, no `register`, no volatile-dependent code).

Fix applied (one flag, `scripts/build-windows-control-bridge.ts` only):
`/std:c++17` → `/std:c++20`, which takes the standard `<coroutine>` route per
Microsoft's documented coroutine support (no `/await`, no warning
suppression, no other switch). `build-windows-credential-lease.ts` keeps
`/std:c++17` — it builds no C++/WinRT code and passed in the same job.

**Cannot be proven on Linux**: acceptance = `cl.exe` success in the
`installed-memory`/`desktop-package` Windows job on the exact cut, followed by
the packaged `windows-control-bridge.node` passing the script's own
`require(...).pickWindow` load check, `pnpm desktop:package` completing, and
`verify-installed-desktop.ts` reaching `harness.ready`. Until a Windows run
shows `Gen-V1-Setup-*-win-x64.exe` + `win-unpacked` produced, packaging stays
blocked upstream of every M16 installed gate. Publication/dispatch of this
cut is the manager's call as a separate explicit source cut.

### 3a-i. Compile/packaging proven on 50a342d2; installed main-process abort identified and repaired

Run `44426869497` (@`50a342d2`, job `135233864834`, artifact `14488226796`)
on windows-latest:

- **PASS — C++20 compile/link**: `windows-control-bridge.cc` compiled and
  linked clean under `/std:c++20` (lib+exp created); the script's clean-PATH
  `require`/`pickWindow` load check passed (packaging proceeded).
- **PASS — packaging**: `win-unpacked` + `Gen-V1-Setup-0.6.5-win-x64.exe`
  produced; `payloadCustody` matched exactly (92955 files / 2.578 GB,
  sha256 `3fecb18…`); provider verification passed; identity-bound
  uninstall + cache removal clean.
- **FAIL — installed startup**: the installed app reached `backend-ready`
  at 28.567s, then the **Electron main process terminated** ~250ms later
  with code `0xFFFF7003` (crashpad `kTerminationCodeNotConnectedToHandler`
  = fatal abort, not a graceful quit): `failure: process-exit`,
  `firstFailure: null`, no `startup-failed` diagnostic.

Most probable cause (source-bound, M16-owned — consistent with the receipt
but not conclusively proven from the Crashpad code alone): `attachControlBridge`
(`apps/desktop/main.ts:327`) runs on every backend attach and calls
`loadWindowsWindowBridge` → `require('./windows-control-bridge.node')`
unconditionally (`control-bridge.ts:410`). The shipped addon was built
against **Node 24's headers and `node.lib`**, with normal PE imports of
`node.exe` — inside Electron there is no `node.exe`, and a mismatched
node.lib/Electron import can terminate the host rather than raise a
catchable error. `windows-credential-lease.node` is unaffected — it is
required only backend-side in the node child, where `node.lib` linking is
correct.

Repair applied (this cut), following Electron's Windows native-module
guidance: the addon is compiled against **Electron 45.2.0's headers and
`node.lib`** (pinned by SHA-256 in a dedicated
`.harness-windows-control-bridge-build` cache — header archive
`42eaab65…3c72`, `win-x64/node.lib` `c4ba898a4…3156`), links
`/DELAYLOAD:node.exe` + `delayimp.lib`, and `windows-control-bridge.cc`
carries the preload delay hook (`decltype(__pfnDliNotifyHook2)` →
`GetModuleHandle(NULL)` for `node.exe`) — the same mechanism node-gyp
injects as `win_delay_load_hook.cc`. The design contract is unchanged:
`require` must either produce the addon or fail into the designed
`return null` fail-closed path; this repair removes the known-bad
`node.exe` import dependency that made failure fatal. The Node-host
`require` smoke in the build script is diagnostic only — the acceptance
load is the installed Electron process reaching `harness.ready` on the
next Windows artifact. Not provable on Linux.

An unrelated `Tests (shard 4/4)` `view-loading-state` fixture failure also
appears in run `44426869497` — separate file, separate owner surface, not
an M16 gate.

## 4. Missing host prerequisites for live proof

Recorded honestly — proof is NOT obtained here:

1. A clean, non-degraded Windows host (hosted runner or an isolated verifier)
   with the exact-cut packaged app — `WIN-M0N0V07LGM1` is degraded
   (unreaped owned PowerShell) and must not be used.
2. The integration hook (§2a) or an equivalent thin wrapper driving
   `runInstalledBrowserControlScenario` on the verified installed page —
   expected receipt phases: `session-bound → thread-created → browser-opened →
   consent-requested → consent-granted → capture-bound → interact-denied →
   stop-revoked`, then the harness's own clean-exit proof.
   The scenario cannot run standalone (no launcher) — by design, so the
   installed receipt cannot be minted from an unrelated payload.
3. For `SELECTED_DESKTOP_APPLICATION`: the built `windows-control-bridge.node`
   at the recorded digest on a session host (native-window slice stays
   `HOLD_DRIVER_SPECIFICATION` until then).
4. Reviewer approval — `reviewerApproval` stays `false` regardless of receipts.

Until (1)+(2) produce a passing `verification.json`, the browser consent/
capture/Stop slice remains `HOLD_PLATFORM_PROOF`. No native-input proof exists;
`HOLD_NATIVE_INPUT` and `HOLD_PICKER_BINDING` are unchanged.
