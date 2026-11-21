> **Front-end ownership:** Leonardo's separate front-end team defines all visual design and animation. This plan covers behavior, data and wiring only. Implementers must not invent visuals; use existing components unstyled/with placeholder copy until the front-end specification lands. T08 owns that specification and hands it to implementation.

# Plan: “Open in Gen V1” in Windows File Explorer

## META

| Field | Value |
|---|---|
| Feature | Open a folder as a project from Windows File Explorer |
| Repository | skytuhua-org/Gen-V1 |
| Size / labels | small; `feature`, `small` |
| Revision / date | r1 / 2026-11-21 |
| Baseline | fetched `origin/main` / `e883ac0327c834120d89c3697dec7380a342ba4d` |
| Planning branch | `devin/explorer-open-in-genv1-plan` |
| Issue / PR | Publication authorized; canonical issue and docs PR links will be filled after creation |
| Implementation | NOT_STARTED; no runtime or installer changes |
| Provenance | Approved by Leonardo (repository owner) on 2026-11-21 in the batch-2 proposals as: '"Open in Gen V1" in File Explorer (small): right-click a folder to open it as a project.' Instruction: create the issue and hand off to the front-end team to design it. Detailed decisions below were supplied in the planning handoff. Repository facts were read at the baseline; upstream builder facts were checked against the published `app-builder-lib@26.18.0` tarball. |

Publication is authorized: publish this complete plan as the canonical issue body, retain the notice above, and provide an identical Markdown source through a reviewed docs PR and SHA-pinned link because issue file attachments are unavailable via API. Read back body and source section by section before declaring HANDOFF_COMPLETE. Record actual issue/PR links and increment revision when decisions change; do not implement from a synopsis.

## OBJECTIVE

Let a Windows user right-click one folder, or the background inside a folder, choose **Open in Gen V1**, and arrive in the focused main Gen V1 window with that project selected and a new empty conversation bound to it. Do not require manually entering the folder path, create duplicate project records, grant trust, or run an agent.

Success: both classic Explorer verbs work on cold and warm launches, canonical-path project reuse works, invalid requests leave the app usable, and a per-user Settings toggle survives upgrades and cleans up on uninstall.

## REQUIREMENTS

### Agreed scope and decisions

- **R01 — Windows classic shell only.** Register `HKCU\Software\Classes\Directory\shell\GenV1` and `HKCU\Software\Classes\Directory\Background\shell\GenV1`. Both labels are `Open in Gen V1`, icon is the app executable followed by `,0`, and each command is `"<INSTDIR>\Gen V1.exe" --open-project "%V"`. Set `MultiSelectModel=Single`; process only one folder per request. Per-user HKCU only, never elevation or HKLM.
- **R02 — Installer owns registration.** An NSIS `nsis.include` script supplies `customInstall` and `customUnInstall`. Install writes both verb keys unless DWORD value `ExplorerIntegration` under `HKCU\Software\Gen V1` exists and equals 0. This is the opt-out marker, not a subkey. Missing marker means default enabled; marker 1 means explicitly enabled. Upgrades must preserve an explicit 0. Uninstall removes both GenV1 verb keys and this value, not unrelated Classes entries or unrelated values under `Software\Gen V1`.
- **R03 — Local toggle.** Windows desktop-only General setting: `Show “Open in Gen V1” in File Explorer` (final copy from front-end team). Registry is the source of truth, not a synced preference. Main-process service uses `reg.exe` via `execFile`, never a shell or native dependencies. Expose `desktop.explorerIntegration.get/set` through authenticated preload IPC. Enable writes both verbs and marker 1; disable removes both verbs and writes marker 0. Read actual keys as well as marker; do not report enabled for partial/stale registration. Errors are non-blocking and shown in the row; retry/readback exposes actual state.
- **R04 — Untrusted argv.** A pure parser extracts only the value following `--open-project` and ignores unrelated arguments. Reject absent/empty values, relative paths, URL-like inputs and `\\?\` / `\\.\` device paths; accept drive-letter and UNC absolute paths. Do not execute, expand, or interpolate the path. Filesystem validation stays with existing project enrollment. Bound input length to the existing connect path limit (4096). Reject ambiguous repeated switches rather than opening multiple paths.
- **R05 — Reliable cold/warm delivery.** Cold launch parses `process.argv`; warm launch parses the `second-instance` argv, restores/focuses the main window and forwards. Main buffers until the main renderer subscribes and signals application readiness. Preload exposes `onOpenProjectRequest(path)` plus internal ready/ack operations. Keep at most one pending request, latest wins; an acknowledged older request cannot clear a newer one. Only the trusted main renderer may receive or acknowledge requests. No detached-window fanout.
- **R06 — Visible project opening.** Renderer calls existing `workspace.project.connect` with `{name: folder basename, path}`, resolves the returned project by canonical enrollment result, then selects it by opening a new empty conversation bound to its project ID. Existing canonical `rootPath` enrollment reuses a project; each successfully consumed request creates a new empty conversation, not a duplicate project. Window remains focused. No automatic agent run or trust grant; M03 stays untouched.
- **R07 — Errors and recovery.** Missing/deleted paths, non-directories, app-data overlap and rejected repository configuration produce an error toast containing the supplied path and safe reason; no project is created for these enrollment failures. App stays usable. Parser failures also produce a safe non-blocking error, not a crash. If enrollment succeeds but conversation creation fails, keep the enrolled project, report that stage and allow a later explicit request; do not delete shared project state or silently retry thread creation. Existing drafts and running conversations must not be retargeted.
- **R08 — Security/privacy.** Only one validated path value crosses the bridge. No shell interpolation anywhere, including registry commands. Main validates trusted IPC sender and payload. Renderer performs normal protected HTTP calls; existing CSRF/origin/cookie checks remain intact. Do not log raw folder paths or include them in telemetry/evidence; show the path locally in the error toast as requested. Test evidence uses synthetic paths.
- **R09 — Design ownership and accessibility.** T08 belongs to Leonardo's front-end team. They specify toggle copy/helper text/pending/disabled/error states, hidden state off Windows desktop, project-open focus/selection/reveal transition, motion and reduced-motion, toast tone/copy, and confirmation of Explorer label/icon. Implementation consumes their spec; until it lands use existing components with placeholder copy, without invented styling or motion. Preserve keyboard access, accessible status/error announcement and existing draft retention.
- **R10 — Installed acceptance and lifecycle.** Verify both verbs, cold/warm launch, spaces/Unicode/quoting, deleted path, duplicate reuse, toggle off/on, opt-out-preserving upgrade, uninstall cleanup and unchanged ordinary launch on Windows. Record real installed evidence separately from unit results.

### Explicit exclusions / known limitation

No files, drives, multi-select opening, macOS/Linux shell integration, deep-link scheme, automatic trust changes, agent runs, new workspace provisioning policy, or enabling M01–M17 capabilities. No signing changes. Windows 11 displays classic verbs under **Show more options**: a top-level modern menu is out of scope and is a follow-up candidate requiring investigation of IExplorerCommand plus sparse-package/MSIX identity. Do not promise modern-menu placement.

## REPO_MAP

Verified baseline locations (line references refer to the baseline, not future edits):

| Location | Fact / integration point |
|---|---|
| `scripts/desktop-assets.ts:116–126` | `desktopBuilderConfig`: product `Gen V1`, app ID `local.generativeharness.desktop`, Electron 45.2.0; x64 NSIS; one-click/per-user/no elevation; no current include; Start-menu shortcut enabled. |
| `scripts/verify-installed-desktop.ts:16` | Installed executable constant is `Gen V1.exe`; uninstaller `Uninstall Gen V1.exe`. |
| `scripts/package-desktop.ts:27,42–44` | Stages desktop app then calls builder with staged `projectDir`; include path must resolve at packaging time, not relative to the source by accident. |
| `scripts/build-desktop.ts:5–9` | Bundles Electron main/preload, generated package entry `main.mjs`. |
| `apps/desktop/main.ts:82–83,236–244` | Existing trusted-sender guard and IPC registration/ready pattern. Existing ready is window readiness, not proof that App's project-open handler is mounted. |
| `apps/desktop/main.ts:308–324,376–387` | Backend startup/token handshake and single-instance startup; second-instance currently only opens main window, ignores argv. |
| `apps/desktop/preload.ts:14–30` | Typed bridge methods, invoke handlers, subscriptions with cleanup, exposed frozen `harnessDesktop`. |
| `apps/web/src/App.tsx:53,492,761–780,1205` | Existing toast with error tone; select/createThread; Connect project dialog. `createThread(undefined, projectId)` issues `thread.create` with projectId, refreshes and selects. Its shared creationPending promise needs explicit coordination, not blind reuse for a different project. |
| `apps/server/workspace-routes.ts:20–25,44–45` | Protected workspace command envelope/route dispatches connect to ProjectTools. |
| `packages/workspace/tools.ts:79–99` | Connect validates/canonicalizes path, rejects storage overlap, reuses local project by canonical rootPath, stores root identity, optionally binds an unused thread; repository restrictions. |
| `packages/contracts/workspace.ts:18–21,39–58` | ProjectSummary, WorkspaceEnvelope, PanelBinding, workspace/canvas and ProjectContext models. |
| `packages/contracts/index.ts:3` | Thread projectId/workspaceId references. |
| `packages/core/workspace-layout.ts:29–31,90,97–102` | WorkspaceRepository reads workspace/project records; rename and legacy migration. |
| `apps/web/src/Settings.tsx:18,33–39`; `apps/web/src/settings-inventory.ts:51–73`; `apps/web/src/settings-registry.ts:34–38` | Desktop context, General settings and platform filtering. |
| `tests/desktop-packaging.test.ts:73–92`; `tests/installed-desktop-verification.test.ts:135–144`; `tests/desktop-native.test.ts:88`; `tests/project-tools.test.ts:13–37` | Existing packaging/config, installed-launch identity, sidecar path and enrollment coverage; new behavior needs new tests. |
| `.github/workflows/ci.yml:216,292–322`; `.github/workflows/release.yml:138–154` | Installed packaging/verification lane and release packaging. Do not casually edit shared workflows. |
| `docs/progress.md:13–37` | No Explorer milestone; M03 trust, M08 workspaces, M15 workbench and M16 desktop automation are adjacent, not dependencies to activate. Matrix marks milestones not verified. |

Upstream verification: published [app-builder-lib 26.18.0 tarball](https://registry.npmjs.org/app-builder-lib/-/app-builder-lib-26.18.0.tgz), inspected in memory: `out/targets/nsis/nsisOptions.d.ts:165` declares `include`; `out/targets/nsis/NsisTarget.js:709` resolves `this.options.include`; `templates/nsis/installSection.nsh:81–82` invokes `customInstall`; `templates/nsis/uninstaller.nsh:156–157` invokes `customUnInstall`. `out/appInfo.js:54–57` derives productFilename from productName absent an executableName override; `out/winPackager.js:235` appends `.exe`. Together with the repository's installed verifier these support `Gen V1.exe`; no installed binary was launched in this research.

Related open work: [#1234](https://github.com/skytuhua-org/Gen-V1/issues/1234), [#1249](https://github.com/skytuhua-org/Gen-V1/pull/1249), [#1252](https://github.com/skytuhua-org/Gen-V1/pull/1252) concern installer signing/config/workflow. They were unmerged in the research snapshot; refresh before implementation. Prior all-state searches for File Explorer/context menu/Open in found no matching feature issue; repeat before publication. [#1242](https://github.com/skytuhua-org/Gen-V1/issues/1242) is the structural plan precedent, [#1247](https://github.com/skytuhua-org/Gen-V1/pull/1247) the separate FE-spec precedent.

## DESIGN

### Registration and toggle

NSIS include and main-process registry service implement the same fixed schema. Use quoted DefaultIcon executable paths with `,0`; quote executable and `%V` in command data. NSIS uses `$INSTDIR`; runtime uses `process.execPath`, never a renderer-supplied executable. Value names/keys are constants, not caller-controlled. Installer includes must be resolved with an explicit source-root absolute path or deliberately staged path, because builder projectDir is staged.

On fresh install (marker absent), register; marker 0 skips registration on upgrade; marker 1 registers. Runtime get reports actual enabled/disabled/inconsistent/error state from both owned verbs and marker. Runtime set performs all writes/deletes with argument-array execFile, validates Windows desktop, then reads back. A partial failure is not success: retain a non-blocking inconsistent/error state with retry. Do not fall back to HKLM/elevation or delete parent keys. Uninstall owns only the two GenV1 keys and the marker value. Registration removal is rollback; a downgrade to an installer predating this marker contract cannot be promised to preserve it and needs explicit release guidance.

### Request lifecycle

`Explorer → executable argv → pure parser → main latest-pending slot → trusted ready main renderer → protected connect command → createThread(undefined, project.id) → selection/reveal → ack`.

The public preload listener accepts path only; internal request envelopes have a monotonically changing request ID for acknowledgement. Install listener before declaring ready. Track renderer readiness per main-window webContents/navigation; reset on destruction/reload. Deliver only after backend, workspace bootstrap and handler mount. Ack completion (including handled failure) only for that ID; stale acknowledgements do not discard newer pending requests. Unsubscription stops delivery. Main window restore includes unminimize/show/focus, without focus bouncing to detached windows.

At most one undelivered pending path exists; newer requests replace older pending paths. A renderer operation already started is serialized to completion and is not cancelled midway through a store command; the latest pending request follows it. Duplicate transport delivery of the same request ID must not create another conversation. In-memory deduplication/ack is not an exactly-once guarantee across a process crash; no persisted auto-replay is promised. T01 must verify renderer-reload recovery and decide the minimal safe receipt retention needed to avoid duplicate thread creation in the supported handshake tests; escalate any incompatible contract before coding.

Resolve the connected project from the returned enrollment result, not by comparing raw argv against canonical rootPath. T01 discovers a safe canonical-result identification mechanism within the existing response shape; do not guess a newly added project by array order. Reuse host canonicalization and path identity checks. Derive name with Windows basename rules including trailing separator/drive-root/UNC-share fallbacks; cap to the existing 100-character project label limit without changing the path. Renderer validates readiness and serializes against `creationPending`: never adopt an unrelated in-flight thread as the requested project's conversation. Do not migrate an existing draft into the new empty conversation. A root request must still have a nonempty display name.

User cancellation is not part of this one-click flow; failing validation ends that request and leaves prior selection/drafts intact. A new explicit Explorer action retries. Do not auto-retry a thread mutation after an unknown response. When enrollment succeeds but thread creation fails, expose the stage and retain the project as R07 specifies. Rejected enrollment creates neither project nor conversation.

### Boundaries and migration

No database schema migration or synced preference is required. Bridge type/channel additions are confined to this feature and use existing trusted-sender checks. Registry state is machine-local per-user. Feature rollback disables the verbs; a release removing this feature must also remove its owned keys/marker rather than leave dead commands. Tests must compare NSIS and runtime registration schema to prevent drift. No CI/signing changes are required by default.

## EXECUTION_DAG

All implementation owners are currently unassigned. Paths labelled proposed are new files, not existing facts. Each worker must claim its task in the eventual canonical issue, refresh related work, record tests and hand off exact commit/evidence. T08 is listed last for the FE handoff but has no dependency on implementation; run it early. T04/T06 can build behavior with existing placeholders, but final user-facing acceptance is gated on consuming T08.

### T01 — Verify integration contracts and close discovery gaps

- **Owner / dependencies:** desktop integrator; baseline only.
- **Goal / inputs:** this plan, baseline source, builder 26.18.0. Reconfirm executable and include/macros already researched above on the implementation baseline; inspect `packages/desktop-contract/index.ts` bridge/channel types and current main/preload lifecycle before choosing exact additions.
- **Edits / outputs:** record findings and finalized IPC/result-resolution contract in the canonical plan/journal; no speculative shared-type edits. Inspect App `createThread`/creationPending and workspace send return type; determine how to recover the exact project ID after connect canonicalizes a new or reused path. Discover relevant server enrollment tests and toast/Settings test harness. Verify reload/ack deduplication and same-user installer-upgrade/uninstall macro behavior (including updater uninstall if applicable); distinguish explicit uninstall from upgrade cleanup before deleting marker.
- **Tests:** positive code trace and fixture for new/reused canonical project and project-scoped empty thread; negative concurrent creation, rejected path, stale ack and upgrade opt-out trace. Verify NSIS hook execution with an actual installed upgrade in T07, not template inspection alone.
- **Done when:** executable `Gen V1.exe`, include resolution, bridge ownership, canonical-result lookup, creation serialization and opt-out-preserving lifecycle have executable test designs without guessed APIs. Escalate any design conflict before implementation.
- **Handoff:** exact contracts and discovered test paths to T02–T06 and T08; gaps remain BLOCKED, never invented.

### T02 — Pure Windows launch-argument parser

- **Owner / dependencies:** desktop parser worker; T01.
- **Files / edits:** proposed `apps/desktop/open-project-args.ts`, `tests/desktop-open-project-args.test.ts`; add manifest source/runtime entries when packaging requires them under CONTRIBUTING. No Electron dependency in parser.
- **Inputs / outputs:** argv array → no request, validated absolute folder string, or safe validation error; apply R04, Windows basename naming rules available for T04 or separately tested there.
- **Tests:** drive/UNC, spaces, Unicode, trailing separators, unrelated args, absent switch; reject missing/empty operand, relative/root-relative/drive-relative path, URL, device prefix, overlong input, repeated switches and a switch where the operand should be. Windows forbids literal double quotes in file names: test malformed quote-bearing input rejection separately from valid space-containing argv transport.
- **Done when:** deterministic platform-independent fixtures pass, no filesystem/shell side effects or path expansion.
- **Handoff:** exported typed parser result and fixtures to T03/T04.

### T03 — Cold/warm main-process delivery and bridge handshake

- **Owner / dependencies:** desktop integration worker; T01, T02.
- **Files / edits:** `apps/desktop/main.ts`, `apps/desktop/preload.ts`, `packages/desktop-contract/index.ts` (exact symbols confirmed T01); proposed `tests/desktop-open-project-delivery.test.ts`. Own open-request channels only; leave registry channels to T06 with coordinated non-overlapping edits.
- **Inputs / outputs:** process.argv and second-instance argv → latest-pending state, main restore/focus, onOpenProjectRequest(path), ready/ack by request ID. Restrict trusted main renderer and reset readiness on reload; do not equate existing window ready with handler ready.
- **Tests:** cold before/after renderer mount; warm minimized/main open; no switch; two rapid requests latest wins; stale ack; listener cleanup; renderer reload; duplicate envelope; unavailable backend; malformed/untrusted/detached IPC denied. No raw paths in logs.
- **Done when:** no request lost before mount, no detached fanout or stale clearing, ordinary launches unchanged and invalid requests stay non-blocking.
- **Handoff:** typed bridge plus delivery fixtures to T04, runtime readiness contract to T07.

### T04 — Renderer connect → scoped empty conversation → reveal

- **Owner / dependencies:** renderer behavior worker; T01, T03; T08 for final presentation.
- **Files / edits:** `apps/web/src/App.tsx`, `apps/web/src/desktop-context.tsx` only if discovery proves needed; proposed `tests/explorer-open-project.test.tsx` with harness discovered in T01. Use existing workspace client/toast/createThread; new helper only if needed for focused tests.
- **Inputs / outputs:** ready bridge request → basename label, connect receipt/project ID, new empty project-scoped thread, focused/revealed main UI; ack handled ID. Register only for main desktop App, after workspace bootstrap.
- **Tests:** new and reused project, plain folder, canonical alias, root-name fallback, spaces/Unicode, loaded split layout, pre-existing draft/running thread retained, concurrent creation serialized, duplicate request not repeated. Empty/missing/deleted/file/storage-overlap/rejected-repository paths show safe path+reason toast with no enrollment; connect success/thread failure retains project and reports stage. Assert no message.send/run/trust command.
- **Done when:** scoped thread is visible with correct project, no old draft migration or unrelated creationPending reuse, errors recover without app reload; T08 spec consumed before final acceptance.
- **Handoff:** renderer tests and UI state checklist to T07/FE team.

### T05 — NSIS include and minimal builder wiring

- **Owner / dependencies:** installer worker; T01; coordinate registry schema with T06.
- **Files / edits:** proposed `scripts/installer/explorer-integration.nsh` (create parent only after checking location); `scripts/desktop-assets.ts` minimal nsis.include addition; `tests/desktop-packaging.test.ts` and proposed `tests/explorer-integration-installer.test.ts`. Explicitly resolve/stage include given `scripts/package-desktop.ts` projectDir; edit staging only if required. Manifest include/test entries as applicable.
- **Inputs / outputs:** fixed R01/R02 schema → both HKCU verbs on fresh install, preserved opt-out on upgrade, owned-key cleanup on actual uninstall.
- **Tests:** generated/config include path exists and reaches macros; exact labels/icon/quoted command/Single model; marker absent/1/0; positive lifecycle scripts and negative non-owned parent-key preservation; no HKLM/elevation/signing config changes. Static assertions are not installed proof.
- **Done when:** builder packaging succeeds on Windows and installer/uninstaller hooks match runtime schema. Coordinate overlap with #1234/#1249/#1252; do not overwrite signing work or edit release workflow for convenience.
- **Handoff:** packaged installer, schema assertions and upgrade fixtures to T07; fixed schema to T06.

### T06 — Registry service, IPC and Windows-only General toggle

- **Owner / dependencies:** desktop settings worker; T01; schema agreed with T05; T08 for final presentation.
- **Files / edits:** proposed `apps/desktop/explorer-integration.ts`, `tests/desktop-explorer-integration.test.ts`; registry-specific additions to main/preload/desktop contract coordinated with T03; `apps/web/src/Settings.tsx`, `apps/web/src/settings-inventory.ts`, platform filtering if needed; proposed `tests/explorer-integration-settings.test.tsx` using discovered harness.
- **Inputs / outputs:** get/set boolean intent via `desktop.explorerIntegration.get/set` → actual per-user registry state and non-blocking structured status. Use execFile('reg.exe', args), fixed keys, process.execPath, marker 1/0; no shell/native package or synced preference.
- **Tests:** enabled, disabled/absent, marker 0/1, partial/stale key state, toggling off/on and readback; registry tool missing/nonzero/permission error, partial write, retries, malformed/untrusted IPC; Windows-only desktop row, hidden elsewhere, pending/disabled/error/accessibility behavior per T08. Assert argument arrays preserve spaces and no HKLM commands.
- **Done when:** state follows registry across restart, partial failure never reports success, invalid callers cannot write arbitrary keys, no platform leakage or UI blocking.
- **Handoff:** service/Settings fixtures and actual registry inspection steps to T07.

### T07 — Windows installed acceptance and release evidence

- **Owner / dependencies:** Windows verifier; T02–T06 and T08 final spec integration.
- **Files / edits:** extend `scripts/verify-installed-desktop.ts` only within its safe disposable-install ownership rules if feasible; discover exact installed UI harness in T01. Proposed redacted report `docs/review-evidence/explorer-open-in-gen-v1.md`; no binaries/raw profiles committed. Do not change shared CI without explicit scope approval.
- **Inputs / outputs:** production NSIS installer, synthetic folders and clean Windows user → acceptance matrix, redacted screenshots/logs, installer/app version+SHA, Windows version, actual commands and pass/fail/blocked per check.
- **Tests:** A01–A10 below, Win11 Show more options and Win10 classic placement where available; background `%V` resolves current folder; second instance restores minimized main window; single select only. Quote handling means correctly quoted executable/space paths plus rejection of impossible literal-quote file names, not creating invalid Windows fixtures. Upgrade from an opted-out version must not run cleanup that erases marker before reinstall. Uninstall removes both keys and marker while preserving unrelated entries/profile data.
- **Done when:** every release criterion has actual installed evidence; unsupported Windows environment is BLOCKED, never inferred from Linux/unit/static tests. Existing ordinary launch/installed retention acceptance remains intact.
- **Handoff:** results, remaining gates and rollback instructions to maintainer; no automatic release/merge/issue closure.

### T08 — Front-end design specification and handoff

- **Owner / dependencies:** Leonardo's separate front-end team; this plan and T01 findings, no implementation prerequisite. Start early despite last task number.
- **Files / edits:** separate reviewed docs PR, `docs/agent-plans/<issue>-explorer-open-design.md` (substitute actual issue number after publication); source manifest entry and link from canonical plan, following #1247 precedent. No behavior changes bundled into spec PR.
- **Inputs / outputs:** R09 and behavior contracts → toggle label/helper text, keyboard/accessible name, pending/disabled/error/retry states, non-Windows hidden; main focus/project selection/new empty conversation reveal, interruption/draft behavior, motion/reduced-motion; error toast path/reason copy/tone; confirmation of Explorer label/icon and Win11 limitation copy.
- **Tests / review:** positive cold/warm/success storyboards and empty/pending/failed/partial-registry states; negative non-Windows and reduced-motion review; verify no automatic run/trust language or invented unsupported platform promise. Docs links check and maintainer/team review.
- **Done when:** spec PR linked/readable with resolved states and explicit handoff to T04/T06/T07; final presentation cannot be accepted on placeholders.
- **Handoff:** T04/T06 consume design, T07 captures actual screenshots; disagreements update the entire canonical plan/source revision, not comments only.

## VALIDATION

### Planned setup and commands — NOT executed implementation tests

Use repository-supported Node/pnpm versions and locked dependencies per CONTRIBUTING. Commands run at repository root. Proposed test files below are created by the owning tasks; they do not exist at plan publication time. Confirm harness-specific invocations in T01; do not claim a planned command passed.

```sh
pnpm exec vitest run tests/desktop-open-project-args.test.ts tests/desktop-open-project-delivery.test.ts tests/desktop-explorer-integration.test.ts tests/explorer-integration-installer.test.ts --maxWorkers=1
pnpm exec vitest run tests/explorer-open-project.test.tsx tests/explorer-integration-settings.test.tsx --maxWorkers=1
pnpm exec vitest run tests/desktop-packaging.test.ts tests/desktop-native.test.ts tests/project-tools.test.ts tests/installed-desktop-verification.test.ts --maxWorkers=1
pnpm typecheck
pnpm build
pnpm check:docs-links
```

On Windows, `pnpm desktop:package --output-root .harness-explorer-package` builds the installer after normal build/runtime prerequisites. T07 records the exact generated installer path and invokes the existing installed verifier with that installer and its win-unpacked directory, then the focused Explorer acceptance harness discovered in T01. Do not install over a real user's existing profile or improvise cleanup outside verifier ownership checks. Unit mocks must exercise reg.exe errors without writing a real registry. FE interaction tests must use the existing browser/test setup discovered in T01 rather than guessing a runner.

### Acceptance matrix / release gate

| ID | Observable check | Evidence / owner |
|---|---|---|
| A01 | Both exact HKCU verbs/icon/quoted command and Single model exist, no HKLM/elevation; Win11 classic-only limitation documented | Static schema + Windows registry/shell check; T05/T07 |
| A02 | Parser accepts drive/UNC/spaces/Unicode and rejects empty/relative/URL/device/repeated/malformed input safely | Unit fixtures; T02 |
| A03 | Cold ready handshake and warm minimized-window forwarding deliver latest pending path without stale-ack loss or detached fanout | Delivery tests + installed launch; T03/T07 |
| A04 | New/reused canonical folder opens a new empty scoped conversation, project record count stable on repeat; no run/trust/draft migration | Renderer/host assertions + installed screenshot; T04/T07 |
| A05 | Deleted/file/storage-overlap/rejected repository paths show path+reason error and create no project; later valid request works | Negative enrollment/UI tests + installed deleted path; T04/T07 |
| A06 | General row hidden off Windows desktop; toggle off/on reflects registry, marker 0/1 and actual verbs; failures non-blocking | Mock registry/Settings + installed restart; T06/T07 |
| A07 | Upgrade retains disabled marker and absent verbs; re-enable works; uninstall removes owned keys/marker only | Installed lifecycle evidence; T05–T07 |
| A08 | Untrusted IPC rejected, argument-array reg.exe only, protected HTTP unchanged, no sensitive path telemetry | Unit/security review; T02–T06 |
| A09 | Final FE spec consumed, keyboard/error states and reduced-motion honored, focused project/conversation reveal visually verified | Spec PR + screenshots/interaction evidence; T08/T04/T06/T07 |
| A10 | Build/typecheck/relevant regressions and docs checks pass; ordinary launch and existing installed retention unchanged | Exact command outputs/versions, release gate; T07 |

Release gate: A01–A10 satisfied with reviewed implementation and installed Windows proof; unresolved lifecycle/discovery/security gaps block release. Docs publication or green Linux unit tests do not imply feature completion. No application/Windows checks have been executed for this plan. The authoring handoff must report the actual docs-link result separately; until then it is pending.

## STATE

- **Researched/decided:** owner-approved scope and decisions R01–R10; executable naming, upstream NSIS extension points, existing project-scoped createThread and connect path inspected. Fresh fetch baseline recorded above.
- **Implemented:** nothing. This document and its source-manifest entry are planning artifacts only.
- **Verified:** source/upstream inspection only; no installed Windows, visual, launch/registry or implementation test results. No claim of HANDOFF_COMPLETE publication yet.
- **Pending owners:** T01–T07 unassigned; T08 recipient front-end team, not yet claimed/acknowledged. Publication authorized on the planning branch; issue/PR creation and final SHA pin are in progress.
- **Risks:** staged include resolution; signing-config overlap; opt-out marker during upgrade uninstaller lifecycle; registry partial writes; canonical result lookup; shared creationPending; renderer reload/deduplication; invalid Windows quote fixtures; final FE spec not yet delivered. T01 must close or explicitly block these before dependent code.
- **Next exact step:** complete authorized issue/docs-PR publication, final SHA pin and readback, then T08 front-end team writes the design-spec PR and T01 integrator closes discovery before implementation. No implementation/merge/release authorized by this planning document.

### PREPUBLISH AUDIT — requirement → task → acceptance

| Requirement | Tasks | Checks |
|---|---|---|
| R01 classic Windows verbs / exclusions | T01, T05, T07, T08 | A01, A09 |
| R02 installer, opt-out, uninstall | T01, T05, T06, T07 | A01, A07 |
| R03 local toggle / registry truth | T06, T08, T07 | A06, A08, A09 |
| R04 untrusted parser | T02, T03 | A02, A08 |
| R05 reliable launch/handshake | T01, T03, T04, T07 | A03, A04 |
| R06 scoped empty conversation / reuse | T01, T04, T07 | A04 |
| R07 safe errors and recovery | T01, T02, T04, T06, T07, T08 | A02, A05, A06, A09 |
| R08 security/privacy | T01–T07 | A08 |
| R09 FE ownership/accessibility | T08, T04, T06, T07 | A09 |
| R10 lifecycle and regressions | T05, T06, T07 | A07, A10 |

Every task has dependencies, inputs/outputs, concrete files or discovery procedure, positive/negative tests, done-when and recipient handoff. T03/T06 share bridge files: coordinate channel-only scopes or integrate sequentially, never concurrent conflicting edits. T08 is logically upstream of final UI acceptance, avoiding a cyclic task dependency. Remaining discovery is explicitly bounded in T01; it is not fabricated completion. Before publication verify source/body equality, working links, actual baseline, owner/status and all task details; publication remains incomplete until readback.

## REFERENCES

- [Repository instructions](../../AGENTS.md), [contribution guide](../../CONTRIBUTING.md), [progress matrix](../progress.md).
- [Baseline source](https://github.com/skytuhua-org/Gen-V1/tree/e883ac0327c834120d89c3697dec7380a342ba4d); verified file/line map above supplies implementation context without private chat.
- [Builder 26.18.0 package](https://registry.npmjs.org/app-builder-lib/-/app-builder-lib-26.18.0.tgz): inspected extension/executable derivation locations listed in REPO_MAP. Exact installed behavior remains T07 work.
- [Plan structure precedent #1242](https://github.com/skytuhua-org/Gen-V1/issues/1242), [separate FE design PR #1247](https://github.com/skytuhua-org/Gen-V1/pull/1247).
- [Installer signing #1234](https://github.com/skytuhua-org/Gen-V1/issues/1234), [builder signing #1249](https://github.com/skytuhua-org/Gen-V1/pull/1249), [release signing #1252](https://github.com/skytuhua-org/Gen-V1/pull/1252): coordinate, do not absorb scope.
- Owner provenance and all substantive behavior/UX/security/lifecycle decisions from the planning handoff are preserved in META and R01–R10; no private conversation link is required to execute this plan.
