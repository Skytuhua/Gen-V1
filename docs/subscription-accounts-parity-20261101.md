# Subscription accounts: T3 parity verification

**Full T3 feature parity: HOLD.** The harness has a coherent named-profile system, but its implemented subset is materially smaller than T3's multiple-account system. Passing the local tests does not establish live operation of every provider or complete upstream parity.

## Source baseline

Harness baseline: `09b43c412153d31010fb330c0f8c17443cab4ea5`. All 26 preserved T3 originals match the SHA-256 values in `.harness-t3-accounts-source/SOURCE_MANIFEST.json`, pinned to [`8760d063e903406c8e8f695b0852c0a15fc1e00f`](https://github.com/pingdotgg/t3code/commit/8760d063e903406c8e8f695b0852c0a15fc1e00f).

Live GitHub verification found upstream HEAD [`82b10d546c1041d8eff40425f076d61f608d518f`](https://github.com/pingdotgg/t3code/commit/82b10d546c1041d8eff40425f076d61f608d518f). The [two-commit comparison](https://github.com/pingdotgg/t3code/compare/8760d063e903406c8e8f695b0852c0a15fc1e00f...82b10d546c1041d8eff40425f076d61f608d518f) changes a PR checkbox component and the Codex protocol implementation/tests; none of the 26 audited files changed. This is a source comparison of the preserved account/authentication/continuity corpus, not an exhaustive audit of every upstream component or a live T3 application run.

## Feature comparison

Upstream paths below are relative to the pinned T3 repository; harness paths are relative to this repository. Line numbers refer to the verified baseline.

| Feature | T3 source evidence | Harness behavior and verdict |
| --- | --- | --- |
| Multiple named provider entries | `packages/contracts/src/providerInstance.ts:84-118` | Implemented narrower metadata at `packages/contracts/accounts.ts:4-12` and `packages/core/accounts.ts:59-74`: Add/Rename/Use/Remove/Restore. |
| Multiple saved ChatGPT sessions inside one instance | `apps/server/src/provider/CodexChatGptAuth.ts:47-82,207-225,326-358` | Missing managed registration/session collection. Each named harness account has a separate native profile. |
| Reconnect a specific saved registration | `CodexChatGptAuth.ts:455-466,845-875,901-915`; `apps/web/src/components/settings/ChatGptAccountPicker.tsx:23-76` | Missing. `apps/web/src/Connections.tsx:22-53` chooses the default for future tasks; Connect launches an external native sign-in target. The copied picker adaptation has a different role. |
| Reconnect identity continuity | `CodexChatGptAuth.ts:622-645` verifies the saved subject | Missing harness-level subject continuity. `packages/contracts/accounts.ts:4-12` stores a local label/provider/UUID; reconnecting the same local slot does not prove the same person signed in. |
| Sign out and token revocation | `apps/web/src/components/settings/ProviderAuthenticationSection.tsx:298-314`; `apps/server/src/provider/ProviderAuthService.ts:260-265`; `CodexChatGptAuth.ts:802-835` | Missing. Soft Remove disables new selection and retains native credentials, as documented in `packages/core/accounts.ts:69-74`. Remove is not Sign out. |
| Verified remote sign-in handoff/import | `packages/contracts/src/providerSetup.ts:203-263`; `CodexChatGptAuth.ts:934-991`; `ProviderAuthService.ts:198-221` | Missing. No account import/transfer command or managed broker was copied. |
| Signed-in identity and status | `ProviderAuthenticationSection.tsx:60-93,159-176`; `CodexChatGptAuth.ts:845-875` | Missing per-account authenticated identity/status. Local labels and provider-level model counts cannot prove which saved account is signed in. |
| In-app sign-in progress/cancel/retry | `providerSetup.ts:101-143`; `ProviderAuthenticationSection.tsx:258-295`; `packages/provider-core/src/server/providerAuthFlow.ts:108-118,429-448` | Different. A native console is launched, but Settings has no owned flow/progress/Cancel/Retry contract. Native launcher cancellation is separately tested. |
| Select an account in an existing thread | `docs/user/providers-codex.md:28-31,67-75`; `packages/provider-core/src/server/instanceIdentity.ts:6-20` | Missing. `packages/core/service.ts:83-114` preserves an existing thread's captured account; Settings defaults apply to new tasks. |
| Continue a compatible native thread with another account | `apps/server/src/provider/Drivers/CodexHomeLayout.ts:18-39,49-70`; `docs/user/providers-codex.md:28-75` | Missing by design. `packages/runtime/account-profile.ts:16-32` separates sessions with profiles; `packages/runtime/index.ts:52-64` enforces the selected root. A new task is required. |
| Custom homes, environments and presets | `providerInstance.ts:26-87`; `packages/provider-core/src/server/instanceEnvironment.ts:7-25`; `apps/server/src/provider/Drivers/ClaudeHome.ts:30-42` | Deliberately narrower fixed homes/environment. No per-account environment, binary, endpoint or home editing. Harness isolated HOME behavior differs from T3's configurable Claude config-directory arrangement. |
| Adopt an existing external CLI login | `docs/user/providers-codex.md:22-25`; `CodexHomeLayout.ts:43-61`; `ClaudeHome.ts:18-27` | Different. Legacy means the existing harness data root, not automatic adoption of the user's external CLI profile. |
| Saved-account limits | `CodexChatGptAuth.ts:868-874` advertises up to 30 reconnect methods; `providerSetup.ts:129-131` limits advertised methods | Different. Harness permits 20 saved records per provider and 100 total, including soft-removed records. The upstream method cap is not evidence of a storage cap. |
| Change credentials while work is active | `ProviderAuthService.ts:90-168,226-237` stops affected sessions before mutation | Different safe behavior. Harness refuses login until the owning native work has stopped and its use claim is released. |
| Interrupted sign-in recovery | `providerAuthFlow.ts:77,251-264,310-349,429-448` has bounded owned flows and cancellation | Usability gap. Harness holds abandoned/unconfirmed login ownership across restart. No supported Settings reconciliation/reset operation currently exists. A blind reset would weaken ownership safety. |
| Automatic account rotation | Upstream FAQ and `MultipleAccountsNote.tsx` describe separate instances/accounts, not a rotation pool | No automatic rotation in this integration. Rotation is not a demonstrated T3 parity requirement. |

Canonical upstream sources: [managed ChatGPT authentication](https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/apps/server/src/provider/CodexChatGptAuth.ts), [authentication service](https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/apps/server/src/provider/ProviderAuthService.ts), [authentication UI](https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/apps/web/src/components/settings/ProviderAuthenticationSection.tsx), [Codex account continuity](https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/docs/user/providers-codex.md).

## Local acceptance evidence

- Fresh focused run: **188/188 account/provider tests passed**, receipt `.harness-accounts-parity-unit.json`.
- Added `tests/account-parity.test.ts`: **11/11 acceptance tests passed**. All nine admitted providers use the real Service, Store and account router with synthetic native adapters. Tests cover compaction, SQLite reopen, history-aware resume after changed defaults, plus side/planning child inheritance across asynchronous startup. The related six-file run passed **77/77**.
- The immediately preceding implementation run passed **750/750 unit tests**, **534 browser tests** with six skips/no failures/flaky results, strict typecheck and web/desktop builds. These results are preserved in [the implementation review](subscription-accounts-review-20261101.md); they do not prove full T3 parity.
- The account-only expanded suite passed **761/761**, receipt `.harness-accounts-parity-full-unit.json`; the final suite including the switcher and Claude regressions passed **766/766**, receipt `.harness-switching-final-unit-confirmed.json`. Both report `success:true`, zero failures/skips.
- The corrected final packaged-provider probe passed using bundled Node and exact packaged distributions: Claude Code `2.1.316 --version`, Gemini CLI `0.66.0 --version`, and Cursor SDK `1.0.38` empty-memory-store import plus stock ripgrep startup. Receipt: `.harness-packaged-providers/run-1793544078823-5f5768e6-f0b9-4aa1-b140-450e3e281af9/verification.json`, with `auth:false`, `inference:false`, `passed:true`.
- **56 packaged files match repository SHA-256 values:** eight source/license files including the corrected Claude adapter, plus all 48 built web files. Receipt: `.harness-switching-final-source-web-hashes.json`.
- The baseline NSIS build completed, but its native account test exposed the Claude/backend failure described below; that diagnostic build is not the final corrected candidate.

## Native defect found and corrected

The baseline package repeatedly lost its backend after selecting an empty named Claude profile. The rename UI then had no responding HTTP host. The focused native receipt captured backend exit code 1 with an unhandled Socket `read ENOTCONN` originating from `packages/runtime-official/claude.ts` during child spawn. This was a real backend failure, not a lost UI click.

The Claude adapter now attaches process/stdio error handlers before returning the child to the SDK, rejects initialization through the existing bounded path, closes input/compaction authority and sends fixed public error/settlement notifications. Independent notification guards preserve teardown if an observer throws. Five regressions cover stdin/stdout/stderr/process errors and a throwing observer; failing-then-passing evidence was observed. The final related Claude/router run passed **36/36**.

The real source desktop using the same bundled Node `24.22.2` then passed focused Claude Add/Rename/Use/Remove/Restore and restart persistence: `.harness-accounts-native/run-1793542721485/verification.json`. The verifier now also asserts that its owned backend has not exited before either planned shutdown.

The **corrected final unpacked Electron application passed all nine providers**, exercising Add/Rename/Use/Remove/Restore and a full native restart with 18 synthetic local account entries and nine persisted defaults. Both backend observations found no unexpected exit; page and cleanup errors were empty. Receipt: `.harness-accounts-native/run-1793544079411/verification.json`, with `passed:true`, `auth:false`, `inference:false`, `liveAccountAcceptance:false`.

## Model/account switcher refinement

The user additionally requested a well-designed switching interface with animation. The compact T3/Pitus visual world is preserved. The new model combobox opens an anchored searchable provider-grouped popover, marks the selected model, supports keyboard navigation/Enter/Escape/Tab/outside dismissal and focus restoration, closes/locks during work, fits narrow viewports, and respects reduced motion. Settings distinguishes the current radio choice from the durable default and shows actual saving feedback. These presentation changes do not add the missing managed-authentication workflows or in-thread account migration listed above.

The frontend worker's final bounded confirmation passed **33/33 focused browser checks** and typecheck. The first visual batch found narrow selected-account overflow and stale popup coordinates on rapid resizing; both were fixed together, then confirmed once. One existing transient fresh-prose test failed the first combined run and passed confirmation. The single Impeccable scan over the five changed UI files returned `[]`. Captures in `test-results/model-picker-visual-confirm-20261101` cover dark/light, desktop/narrow and reduced/default motion. These model catalogs are synthetic fixture data, not live entitlement evidence.

The expanded final unit confirmation passed **766/766**, zero failures/skips: `.harness-switching-final-unit-confirmed.json`. Its first attempt passed 764/766: a one-second fixture observation budget was too short for real Windows directory guards, and synchronous temp cleanup raced their release. The new fixture now uses bounded five-second state waits and asynchronous, identity-checked owned-temp cleanup with retries; application deadlines are unchanged. Web build, desktop shell build, typecheck and independent final source review passed.

The broad browser run recorded **535 passes, four failures and six skips**, with no flaky retries: `.harness-switching-final-e2e.json`. The failures were investigated separately:

- The actual-host restart fixture advertised model ID `fixture/host-contract` under provider `test-runtime`. Bound-thread filtering correctly requires the provider to match its ID prefix, so the fixture now advertises provider `fixture`; the production filter is unchanged. The new visible-label assertion exposed a mismatch the old native-select value assertion missed.
- Specification-to-visible latency measured p95 **180 ms** against the unchanged **150 ms** target. An isolated rerun after builds/native/unit jobs finished passed, with p95 **19 ms** for specification and committed-event updates and **2.2 ms** for local updates. Receipt: `.harness-switching-latency-isolated.json`. The first trace does not establish the cause of its outliers.
- Both 30-event snapshot cases hit the broad runner's 30-second timeout, after which the still-finishing test accessed the database already closed by teardown. Their dedicated configuration already permits 90 seconds; the spec now uses that same budget in the broad suite. Observation counts and performance thresholds are unchanged.

The affected host/snapshot recheck passed **nine cases**, with **two skips**, zero failures/flaky retries and no runner errors: `.harness-switching-affected-confirm.json`. Together with the isolated latency pass, all four failed cases from the broad run have passing recheck evidence. This records a broad run plus focused corrections/rechecks, not a second entirely green broad run. Review also identified a portability issue in the new owned-temp test cleanup: the fixture now canonicalizes the temporary root before creation so legitimate ancestor aliases are accepted while final-directory identity/containment guards remain. Its final focused rerun passed **11/11**, zero failures/skips, receipt `.harness-switching-account-cleanup-confirm.json`; final strict typecheck passed too. No production source changed after the full unit/build/package verification.

No live sign-in or inference was submitted. Synthetic routing and local account metadata persistence cannot prove provider entitlement, identity continuity or working paid/subscription sessions. The nine-provider synthetic compaction checks verify forwarding and ownership; they do not enable or establish native Gemini/Cursor compaction support.

## Desktop distribution custody

The existing `dist/desktop-release-0.5.2` installer was built on 2026-10-31 and its unpacked host lacks `packages/core/accounts.ts`. It predates this feature and must not be presented as the new account build.

C: had approximately 1.97 GiB free when checked; D: had approximately 209.88 GiB. Fresh verification output uses `D:/GenerativeHarnessVerification/subscription-accounts-20261101-1793541200000`, preserving prior releases. An ignored adapter of the existing packager changes only its import location and output/cache paths; original/adapter hashes and changes are recorded in `.harness-accounts-parity-package-adapter.json`. Runtime source and built app assets are copied from the current repository without credential/profile adoption. The first adapter attempt stopped before dependency installation because `pnpm exec` did not provide `npm_execpath`; the retry uses a task-local package script with the pinned manager.

`scripts/verify-subscription-accounts.ts` reserves a failure receipt before native launch, owns only its fresh Electron/process tree, and verifies Add/Rename/Use/Remove/Restore and restart persistence through the actual desktop bridge/HTTP host/SQLite. It never clicks Connect or sends a task. Its scope excludes real provider authentication and NSIS installed-app acceptance.

The final corrected NSIS build completed separately under `D:/GenerativeHarnessVerification/subscription-accounts-final-20261101-1793543404720`; its adapter receipt is `.harness-switching-final-package-adapter.json`. The earlier baseline build and all failed native receipts are retained for diagnosis.

- [Corrected Windows x64 installer](D:/GenerativeHarnessVerification/subscription-accounts-final-20261101-1793543404720/desktop-release-0.5.2/Generative-Harness-Setup-0.5.2-win-x64.exe): **457,202,167 bytes**.
- SHA-256: `21c4436fe59e7f8aec623c564bb72fe7bceede7da69d8e20dfea587b9df7faf1`.
- [Build manifest](D:/GenerativeHarnessVerification/subscription-accounts-final-20261101-1793543404720/desktop-release-0.5.2/build-manifest.json): bundled Node **24.22.2**, Electron **45.2.0**.
- Native verification launched the actual `win-unpacked/Generative Harness.exe`. The installer itself was built but was not installed; registry/install/uninstall behavior is outside this run's proof.

Completed review results were received and acknowledged. The T3 task-status bridge returned `task_not_found` for a completed native reviewer, so the required archival metadata could not be established. Completed native review threads remain visible; none was cancelled or deleted to clean up history.

## Remaining acceptance gates

Full T3 parity requires a deliberate managed-account/auth-flow and compatible session-continuity implementation; copying the namespace hash and picker does not provide these behaviors. Actual live verification also requires explicitly chosen test accounts and their interactive native sign-ins. Existing user credentials have not been inspected, copied or reused. A fresh package/unpacked native probe is separate from installation, live provider use and full T3 parity.
