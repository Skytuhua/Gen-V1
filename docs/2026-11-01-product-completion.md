# Current product completion checks

Version 0.6.0 is built. This report separates implemented
behavior, local verification and remaining live acceptance.

## Completed implementation

- Optional composer predictions appear as ghost text in an empty focused chat box.
  Tab accepts into the existing durable draft; Enter uses the normal send action.
  Escape dismisses. Typing, IME, context changes and real work retain priority.
  Suggestions that cannot be displayed in full are suppressed. The setting is off
  by default under Chat: **Suggest my next message**.
- Predictions use the selected account/model through an independently owned,
  tool-free runtime. Context/output are bounded; Pi uses an in-memory session.
  Official adapters atomically refuse an existing prediction conversation. One
  generation is allowed globally; cancellation retains ownership until teardown.
  The deadline is fifteen seconds, adjusted after a cold signed-in OpenAI result
  took 11.3 seconds. Reported usage stays separate from the primary task.
- Each account has token-free readiness information. Native desktop sign-in has
  owned opening/completion/cancel/retry states. Unconfirmed shutdown stays blocked.
  Supported Pi and Cursor signout removes local credentials only.
- Cursor stages browser login and verifies the native authenticated user ID before
  replacing credentials. Claude binds authenticated metadata at native process
  initialization; its SDK does not supply an immutable subject or a fresh
  `accountInfo()` on each call. Bound Claude profiles refuse unsupported reconnect;
  this is not universal staged reconnect for older unbound profiles. Pi/Gemini
  cannot supply authenticated person identity through their installed public APIs.
- Generated-app discovery and execution share one enabled flag after actual-host
  mount/checkpoint/reload/continuation, startup-failure and watchdog responsiveness
  checks. Existing opaque workers, CSP, grants, schema and message limits remain.
  This does not establish a hard operating-system memory quota.

## Verification evidence

- Independent host, frontend, native and account reviews found issues in action
  cancellation, blocked login cancellation, clipped suggestions, Cursor streaming
  output and official session freshness. They were corrected and re-reviewed.
- Final isolated confirmation: **1,040/1,040 passed**, zero failures/skips,
  `.harness-product-gaps-full-confirmed.json`. TypeScript, web and desktop builds
  passed. The earlier `.harness-product-gaps-full-unit.json` passed 1,037/1,040. Three
  failures involved process/SDK startup observation or Windows temporary cleanup.
  `.harness-product-failed-rechecks.json`: all 29 checks in the affected suites
  passed, including a new two-foreground-turn original Python/ACP/broker regression.
  The final complete run includes that regression.
- Original Hermes: all 14 worker, five custody/parser and four atomic-control
  checks passed. Retained upstream source remains byte-identical to its pinned
  manifest; this pass adds no copied Hermes source or dependency.
- Composer: 12 focused browser cases passed; account readiness/flows: 17 passed.
  Combined model/account/composer motion run passed 35/36; its remaining locator
  assumed only one status region. The scoped locator correction passed separately.
- Actual-host generated apps: seven positive cases passed. One disabled-feature
  negative test is deliberately skipped while execution is enabled. Evidence is
  `.harness-generated-host-candidate/`; traces/videos were disabled.
- Genuine production Hermes/OpenAI created a Stack/TraceWaterfall/Comparison
  artifact. A 214-character prediction appeared, Tab accepted it and reload
  preserved the draft. Expansion/collapse and later restart retained artifact
  identity/state. Evidence: `.harness-current-hermes-ui/run-1793594806352/` and
  `.harness-current-hermes-ui/run-1793595187665/`.

## Remaining acceptance

The first genuine continuation was interrupted after approximately 69 seconds
during concurrent verification. Normal Resume subsequently completed three real
model requests, cleared the error and preserved the existing artifact. Evidence:
`.harness-hermes-continuation-diagnostic.json`. The original transient failure was
not retained with enough detail to identify its cause; successful recovery does
not prove it cannot recur. No stale-ACP client fix was applied: the original client
starts a fresh process per request. A subsequent explicit investigation-update
request passed: the same artifact advanced from revision 1 to 2 with native input
confirmed and no source errors. Restart preserved that exact artifact and user
state; Chromium displayed the recovered artifact. Evidence:
`.harness-hermes-artifact-update/result.json`.

Current nine-provider status: OpenAI configured; OpenAI-Codex, Copilot, xAI, Kimi,
Go and Cursor signed out; Claude unavailable; Gemini unknown. No named accounts
are saved. Only the owned OpenAI subscription has genuine inference evidence.
Other-provider sign-in, entitlement and native task acceptance need those actual
accounts. Configured credentials are not proof of authenticated person identity.

Version 0.6.0 was built as an unsigned Windows x64 installer:
`dist/desktop-release-0.6.0/Generative-Harness-Setup-0.6.0-win-x64.exe`
(482,567,378 bytes; SHA-256
`e2ca976c435c50053dafadfb31ce11ebe388ac475133c6bfd0b8bcde710fc7e1`).
The bundle includes pinned Node 24.22.2, Electron 45.2.0, Python 3.14.3 and the
verified 4,129-file / 78,512,756-byte Hermes payload.

All 14 packaged native window/edit/draft/browser/restart checks passed:
`.harness-desktop-native/run-1793596533039/verification.json`.
Packaged Claude/Gemini/Cursor executable/resolver/distribution checks passed:
`.harness-packaged-providers/run-1793596514761-2d66c631-70a5-4bc3-811f-7ac7d3ce58fc/verification.json`.
Those provider checks do not establish signed-in inference.

Setup verification refused to replace an existing Harness registry installation
and made no installation change. Its receipt is
`.harness-desktop-installed/run-1793596523368-267d1565-1525-46ac-88e8-07c2e9f26070/verification.json`.
Installed upgrade/uninstall acceptance therefore remains open. A genuine task
using packaged Electron, bundled Node, original Hermes and the existing owned
OpenAI subscription passed. Its exact response survived native application
restart; prior thread selection was restored and cleanup confirmed. Evidence:
`.harness-packaged-live/result.json`.

Existing installations/releases and archived traces are preserved. The broader
36-run generation-quality pilot and physical mixed-DPI/multi-monitor checks
remain separate acceptance work.

The new build staging directory was removed after matching 33,981 files and
960,135,648 bytes to retained package/build output. The only omitted dependency
file was a zero-byte `.gitkeep`. Installer checksum, source paths, file hashes,
directory identity and containment were checked before removal. Receipt:
`.harness-release-staging-custody.json`. No old traces or releases were removed.

Completed native helper results were received and acknowledged. T3 `task_status`
returned `task_not_found` for their native task names, so no recoverable child
thread IDs could be verified; those threads were left visible.
