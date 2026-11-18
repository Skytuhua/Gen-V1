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
- **Disposable profile**: the evidence/data directory must be **newly created** by the run (`mkdir` exclusive — a preexisting path fails), with a canonical non-symlink parent. The receipt `verification.json` is written with `flag:'wx'` — it never overwrites.
- **Provenance binding**: a bare exe path is insufficient. The verifier requires the release `build-manifest.json`, parses the package version from the real `Gen-V1-Setup-<version>-win-x64.exe` filename, hashes the installer and cross-checks it against the manifest declaration, hashes the executable, computes the whole-payload `packageContentManifest` digest, and records the source SHA (`GITHUB_SHA`/`HARNESS_SOURCE_SHA` dispatch env, else the invocation worktree `git rev-parse HEAD`, refusing disagreement).
- **Owner-guarded actions**: every renderer call and the final `window.close()` run only while `verifiedOwner === true`, the owned child is live, and the page origin is still the owned origin.
- **Bounded cleanup**: the spawned child is released first in `finally` via `terminateProcessTree` bounded at 15s — receipt writing can never strand the process.
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
