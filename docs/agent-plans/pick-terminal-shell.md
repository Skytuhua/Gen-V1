# Plan: Pick the terminal shell

## META

| Field | Value |
|---|---|
| Feature | Pick the terminal shell: PowerShell, Git Bash or WSL instead of always cmd.exe |
| Size | small (proposed labels `feature`, `small`); no sub-issues needed |
| Repo | skytuhua-org/Gen-V1 |
| Plan file | `docs/agent-plans/pick-terminal-shell.md` |
| Plan revision | r1, 2026-11-21 (UTC) |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified from fresh clone) |
| Existing issue/PR | Publication to a GitHub issue and docs PR was authorized by the maintainer (planning only, no implementation); issue/PR numbers are recorded in the issue header. |
| Related planning | #1234 / PR #1239, #1235 / PR #1238, #1236 / PR #1241, #1237 / PR #1240, #1242 / PR #1243. These docs PRs were open when inspected; none is evidence of shipped behavior. |
| Implementation status | NOT_STARTED. Publication to a GitHub issue and docs PR was authorized by the maintainer (planning only, no implementation); issue/PR numbers are recorded in the issue header. |
| Provenance | Requested feature and scope supplied in this assignment. Repository facts below were inspected at the baseline. **DECIDED** means a proposed implementation decision made by this planner, not an already-shipped API; **DISCOVERY** identifies checks required before implementation. |

**Design and animation ownership.** Leonardo's separate front end team owns animation and visual design for this feature. This plan covers behavior, data and wiring only, including accessibility semantics and copy contracts. Implementation workers must reuse existing controls as neutral scaffolding, introduce no new visual treatment or motion, and give that team the states listed under **Front end team handoff**. Placement below is a functional integration target, not a visual layout prescription.

## OBJECTIVE

**User problem.** Windows project terminals currently use `COMSPEC` or `C:/Windows/System32/cmd.exe` with `/D /Q`. A user cannot choose the shell matching their normal development environment. Linux/macOS already use `SHELL` or `/bin/sh`; do not regress that behavior.

**Intended behavior.** A searchable host-backed setting selects the shell for newly created interactive project terminals. Windows options include System default (Command Prompt), Command Prompt, PowerShell 7, Windows PowerShell, Git Bash and WSL (default or named installed distribution). Existing terminals keep their process. A missing explicit selection produces an actionable error, not a surprise shell switch. System default remains cmd.exe on Windows.

**Measurable success.** Each available Windows option starts in the bound project/working-copy directory, accepts input, resizes, retains output across hide/reopen, and stops normally. Selection survives host restart. All R01–R12 acceptance checks pass. Discovery performs no installation, elevation or network requests, is bounded, and never blocks opening an already-running terminal.

## REQUIREMENTS

### In scope

- R01 Enumerate host-local shell availability: cmd.exe, PowerShell 7 (`pwsh.exe`), Windows PowerShell (`powershell.exe`), Git Bash (`bash.exe` belonging to a Git installation), and WSL via `wsl.exe` plus installed distro names. Missing options remain explainable, not silently omitted.
- R02 Persist one global preference `terminalShell`, validated by shared Zod contracts; legacy/missing/corrupt stored values read as `{kind:'default'}`. Invalid new writes fail; unrelated preferences survive.
- R03 Apply the preference only to **new interactive terminals**. Existing IDs always reconnect to their original process. Settings changes never stop, replace or write into running terminals.
- R04 Build executable/argument arrays on the host, preserving working-copy ownership checks, native PTY behavior, size validation, 12-live-terminal capacity, bounded output, restart recovery and stop semantics.
- R05 WSL uses the selected distro and the actual project cwd after distro-aware `wslpath` conversion. Never silently start in Linux home or concatenate a `cd` command. Explain unsupported paths and old WSL versions.
- R06 Missing/disappeared executable or distro, discovery timeout, spawn failure and conversion failure have actionable errors. Explicit choices fail closed. Default resolves cmd from trusted host configuration then the system path; failure of both is an error, not a change to another shell family.
- R07 Non-Windows hosts retain `SHELL`/`/bin/sh`. Windows-only options are unavailable with a reason. A previously persisted Windows choice remains stored but is ignored on non-Windows, with an explanatory effective-shell note.
- R08 Integrate a searchable setting with loading, ready, no optional shells, unavailable selected value, failed discovery/retry, saving and failed-save states. The host OS, not browser user agent or Electron presence, controls availability.
- R09 Keyboard-operable labelled controls, descriptions for unavailable options, status announcements, and errors without focus theft. Discard stale discovery responses after unmount or host/session replacement.
- R10 Preserve existing sanitized environment plus device/project environment settings for interactive terminals. WSL receives configured user variables through a bounded explicit `WSLENV` allowlist; never forward the full host environment or secrets in argv/responses/logs.
- R11 Do not change agent/runtime subprocesses, trusted `program`/`args`/`environment` calls, or the existing `run-script` command lane. Those commands may contain cmd syntax and are not an interactive-shell preference.
- R12 Front end team owns visuals/animation; give them the complete behavioral handoff. Add decision-level unit, HTTP and Playwright tests plus real Windows PTY evidence before declaring shipped.

### Out of scope (v1)

- Per-terminal or per-project overrides. **DECIDED:** defer them for this small feature. Terminal creation auto-starts in `TerminalBody`, and workspace bindings carry identity, not shell configuration; a second picker would require a pre-start flow and recovery contract. A later override can reuse the shared selection type but must not mutate an existing ID.
- Arbitrary executable paths/arguments, terminal profiles/imports, shell installation/update, registry-wide scanning, WSL installation/distro creation, remote terminals, Linux-home project bindings, UNC/`\\wsl$` project support in WSL, multiple named Git installations, shell-integration scripts, themes/fonts/animations.
- Changing provider login shells, Hermes terminal tools or execution policy/confinement. Shell choice does not grant new filesystem/tool authority.
- Translating project-script syntax between cmd/PowerShell/bash; Windows environment value path translation (only cwd is translated).

### Decisions and user flows (DECIDED)

1. Settings → General → "Terminal shell" → choose available shell → save through the existing settings command. "Applies to new project terminals. Running terminals are unchanged." Open a terminal from the workspace; its returned shell label confirms the effective choice.
2. Show PowerShell 7 and Windows PowerShell separately if both are installed. Never persist an ambiguous `powershell` family that silently changes edition after uninstall. A detected `pwsh.exe` is not executed merely to obtain a version; verify actual edition in Windows acceptance.
3. WSL option → secondary distribution control: "Default distribution" or installed names. Default means WSL's current default at launch, not a snapshot. Named distro is exact and must remain installed. Saving selection is allowed without starting a distro.
4. Uninstall the saved shell → settings shows retained unavailable selection. Opening a new terminal reports "PowerShell 7 is no longer available. Choose another terminal shell in Settings and try again." User may choose System default; no automatic rewrite of preference.
5. Changing preference while terminal A runs changes only new terminal B. Reopening A and retrying a lost read never resolves a new shell. An ended ID stays ended; New terminal creates a fresh ID.
6. No optional shells installed → cmd/default still usable; explanations name what is missing. Discovery failure → retain current selection and offer Retry; do not save a fallback implicitly.

### Compatibility, performance, privacy

No new dependency is needed (Node filesystem/child_process, existing Zod and node-pty). No SQL migration or feature-milestone dependency. A separate feature flag is not required: the default leaves existing behavior unchanged. This is a new preference, not activation of M01–M17. The full M01–M17 table in `docs/progress.md` was inspected: none implements terminal-shell choice; M03 execution profiles and M15 source-workbench capabilities are separate and default off.

Discovery cache: 30 seconds, coalesced concurrent reads, explicit Refresh bypass; hard overall 5-second budget and at most 64 distro names / 64 KiB subprocess output. Shell launch revalidates relevant cached files/distro membership; do not serve stale success after uninstall. No auto-running shell profiles during discovery. Abort/timeout kills probe children and returns a typed unavailable reason. WSL conversion has a separate 10-second launch budget because it may cold-start a distro; timeout returns a retryable error, never a home-directory fallback.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Surface | File / symbols | Existing behavior and change boundary |
|---|---|---|
| PTY owner | `packages/workspace/terminal.ts`: `TerminalHost.open`, `persist`, `result`, `owned`, `command`, `dispose` | Picks Windows COMSPEC/cmd or POSIX SHELL/sh; merges `processEnvironment()` and `environmentSettingsFor(...).resolve(projectId)`; rechecks binding/id/capacity after awaits; writes optional command after spawn. Add interactive resolver here without weakening final synchronous rechecks. |
| Working copy | `packages/workspace/tools.ts`: `ProjectTools.binding` | Resolves project/thread working copy and enforces binding authority. Use its path, not renderer cwd. |
| HTTP | `apps/server/workspace-routes.ts`: `registerWorkspaceRoutes` | `POST /api/terminals`, read and command routes; strict create schema currently accepts project/thread/terminal IDs and dimensions only. `run-script` separately calls `terminals.open({...,command:script.command})`. Keep this lane legacy. |
| Host lifetime | `apps/server/workspace-host.ts`: `workspaceHost`; `apps/server/hermes-service.ts` | Both construct TerminalHost. Resolver should be constructed by TerminalHost (or optional injected dependency) so neither production constructor is missed. |
| Preferences | `packages/contracts/preferences.ts`: `preferencesSchema`, `DEFAULT_PREFERENCES`, `mergePreferences`, `getPreferences`, private `readPreferences` | Strict new patches; independent stored-field validation and unknown-field preservation. Add one nested field and default; migration follows existing reader. |
| Durable settings | `packages/core/service.ts`: `settings.update` branch; `packages/storage/store.ts`: `Store.get`, `put`, `command` | Stores global settings entity in SQLite; Snapshot.settings.preferences refers to PreferencePatch in `packages/contracts/index.ts`. No parallel localStorage preference. |
| Settings UI | `apps/web/src/Settings.tsx`: `SETTINGS_ROWS`, `SUPPORTED_SETTINGS`, `SettingsView`, `persist`, `update`, `customRows`; `settings-registry.ts`: `searchSettings` | Add supported `terminal-shell` General row and custom control. Reuse existing `Select`, busy/error/save handling. Do not change frozen upstream `T3_SETTINGS_ROWS`. |
| Shared settings shell | `apps/web/src/CompactSettings.tsx`, `settings-data.ts` | Compact settings renders the accepted Settings view and snapshot-derived preferences; shared integration should cover it rather than build a second picker. |
| Terminal renderer | `apps/web/src/TerminalBody.tsx`: local `TerminalRead`, mount/open effect, `ownerCurrent`, `restart` | Auto-opens with durable pending ID, polls/read-retries; renders start/read/ended/errors. Extend result metadata and label; preserve owner guards. Start errors currently need particular attention because a failed unacknowledged start is not the normal read-retry flow. |
| Workspace entry | `apps/web/src/App.tsx`: terminal branch in `openTool` flow near 1055 and binding reset near 906; `WorkspaceSurfaceBody.tsx`: terminal branch | Allocates fresh terminal IDs; routes New terminal through openAnother. No per-terminal shell field required. |
| Environment | `packages/core/environment-settings.ts`: `EnvironmentSettings.resolve`; `packages/capabilities/process.ts`: `processEnvironment`, `runProcess` | User variables are scoped device/project; reserved host variable names are rejected. Sanitized process env is intentional. Do not replace with process.env. `runProcess` captures UTF-8 strings; WSL listing needs dedicated byte-aware capture for UTF-16LE. |
| Errors/auth | `packages/contracts/index.ts`: `HarnessError` takes string code; `apps/server/server.ts` | Host API auth/origin/cookie/CSRF hooks and error mapping. No error-code union to extend; inspect status mapping for new errors in T01. |
| Existing tests | `tests/preferences.test.ts`, `tests/settings-operations.test.ts`, `tests/settings-supported.test.ts`, `tests/settings-registry.test.ts`, `tests/terminal-host-unit.test.ts`, `tests/terminal-host.test.ts`, `tests/terminal-opening-race.test.ts`, `tests/terminal-reopen-ended.test.ts`, `tests/environment-settings.test.ts` | Preference migration, settings support, host lifetime/races, actual PTY and environment patterns. `shell-settings.test.ts` concerns application UI shell layout, not terminal-shell selection. |
| Browser fixtures | `tests/e2e/terminal-read.spec.ts`, `terminal-read.playwright.config.ts`, `terminal-excerpts.spec.ts`, `terminal-excerpts.playwright.config.ts`, `settings-leaf-selects.spec.ts`, `settings-leaf-selects.playwright.config.ts` | Scoped fixture patterns for terminal ownership and settings selects. New dedicated fixture must exercise actual SettingsView + TerminalBody behavior, not a fabricated picker. |
| Publication | `AGENTS.md`, `CONTRIBUTING.md`, `scripts/public-source-files.json`, `scripts/public-source.ts`, `scripts/browser-suites.ts` | Manifest source allowlist, runtime subset, browser registration and full-plan publication requirements. Docs plan entry belongs in source only. |

## DESIGN

### 1. Shared contracts and settings state (new APIs, not existing facts)

Create `packages/contracts/terminal-shell.ts`, imported directly by preferences and host/web readers; export using adjacent contracts conventions after T01 checks.

```ts
type TerminalShellSelection =
  | {kind:'default'|'cmd'|'pwsh'|'powershell'|'git-bash'}
  | {kind:'wsl'; distro?:string};
// Each object is strict. distro: 1..200 chars, no control characters,
// cannot start with '-'; only allowed on kind:'wsl'.
type ShellAvailability = 'available'|'missing'|'unsupported'|'error';
interface TerminalShellOption {
  kind: TerminalShellSelection['kind']; label:string;
  availability:ShellAvailability; reason?:string;
}
interface TerminalShellCatalog {
  platform:'win32'|'linux'|'darwin'|'other';
  options:TerminalShellOption[];
  wsl:{distributions:string[]; availability:ShellAvailability; reason?:string};
}
interface TerminalShellInfo {
  kind:TerminalShellSelection['kind']; label:string; distro?:string;
  notice?:string;
}
```

Add `terminalShell:terminalShellSelectionSchema` and default `{kind:'default'}` to preferences. A whole selection is replaced atomically (not deep-merged), so switching WSL → cmd cannot retain a distro. `settings.update` already validates and persists. Preserve unknown fields and other defaults. Selection validity is syntactic; availability is checked on launch, not in the shared synchronous preference merger. UI blocks choosing unavailable entries but can retain a previously saved one. No executable paths or user-controlled argv enter contracts.

Add optional `shell?:TerminalShellInfo` to terminal responses and durable terminalSession records. Old records/replies without it still render "Terminal"; new sessions return actual effective metadata, never current preference recomputed on read. Default Windows records effective `cmd`; POSIX uses `default` with label "System shell". No executable absolute path or env contents in responses.

### 2. Host catalog and deterministic resolution

New `packages/workspace/terminal-shell.ts`: injectable platform/env/filesystem/probe runner/clock for unit tests; expose `catalog({refresh?,signal?})` and `resolve(selection,bindingPath,configuredEnv)` returning `{file,args,cwd,env,shell}`. Cache catalog only, never PTYs or decrypted env values. One instance per TerminalHost. Public `TerminalHost.shellCatalog(...)` delegates to it.

Windows candidate order (deduplicate absolute normalized paths, accept ordinary executable files only):

| Choice | Discovery candidates | Interactive args |
|---|---|---|
| default/cmd | Host `COMSPEC` if an absolute existing `.exe`, otherwise `%SystemRoot%\\System32\\cmd.exe` (`C:\\Windows` fallback). A default COMSPEC spawn ENOENT retries system cmd once; access denied/other errors do not retry. Explicit cmd uses system cmd. | `['/D','/Q']` |
| PowerShell 7 | `%ProgramFiles%\\PowerShell\\7\\pwsh.exe`, then absolute `pwsh.exe` matches from host PATH directories | `['-NoLogo']` (interactive profile loads normally) |
| Windows PowerShell | `%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` | `['-NoLogo']` |
| Git Bash | Git root from `HARNESS_BUNDLED_GIT`/actual bundled Git if present (`gitExecutable` layout), `%ProgramFiles%\\Git`, `%ProgramFiles(x86)%\\Git`, `%LOCALAPPDATA%\\Programs\\Git`, then roots inferred from absolute PATH `Git\\cmd\\git.exe` or `Git\\bin\\git.exe`; within each prefer `bin\\bash.exe`, then `usr\\bin\\bash.exe` | `['--login','-i']`; `CHERE_INVOKING='1'` to preserve cwd |
| WSL | `%SystemRoot%\\System32\\wsl.exe`; do not install or use arbitrary PATH `bash.exe` | `['--distribution',name,'--cd',linuxCwd]` if named, otherwise `['--cd',linuxCwd]` |

Do not run `where.exe` via cmd or search project/current directory. PATH scanning uses only explicit absolute directories and filesystem checks. No registry crawling for v1; custom Git installs work when their Git cmd/bin directory is on PATH. Bundled Git must actually contain bash before it is offered. Validate absolute executable path again immediately before spawn; all launches use argument arrays, not shell command strings.

WSL probe uses byte capture and shell:false: `wsl.exe --list --quiet` for names. Decode UTF-16LE (BOM or zero-byte pattern), otherwise UTF-8, remove BOM, split CRLF/LF, trim whitespace/NUL artifacts, validate names, dedupe deterministically, enforce count/output bounds. Never parse localized human-readable headers or assume default distro is first. No distros → WSL unavailable, "No WSL distributions are installed." Nonzero exit/timeout yields a catalog reason and Retry, not an empty-success list. Listing does not start a distro. No version probe of PowerShell/Git Bash needed.

Explicit choice is never automatically replaced by another edition/family. On native non-Windows return only System shell as available, mark Windows choices unsupported, resolve to current `process.env.SHELL ?? '/bin/sh'` with no args and native cwd. Retain stored Windows choice and add notice "Windows shell selection is unavailable on this host; using the system shell." No Windows probes execute there.

### 3. WSL cwd and environment

- Retain Windows `binding.path` as node-pty cwd and session ownership path. Resolve Linux cwd separately; never store the Linux path as the Windows binding key.
- v1 supports absolute local drive paths only, e.g. `C:\\work\\demo space`. Reject UNC, device namespace and `\\wsl$` paths with `TERMINAL_CWD_UNSUPPORTED` before launching PTY. Native shells keep native binding behavior.
- On user launch only, run system `wsl.exe` with optional `['--distribution',name]` and `['--exec','wslpath','-a','-u',binding.path]`, no shell interpolation. Use Windows binding cwd and sanitized env. Accept one nonempty absolute POSIX path, no NUL/CR/LF, within 4096 chars. This honors the distro automount configuration instead of assuming `/mnt/c`. Timeout/nonzero/malformed output fails with `TERMINAL_CWD_UNAVAILABLE`; never convert by simple slash replacement.
- Pass converted path as the argument after `--cd` in final wsl.exe PTY invocation. WSL chooses the distro's own default interactive shell. An old WSL that lacks `--cd` is unsupported; show "Update WSL to use project terminal directories." Do not add a `sh -c 'cd ...'` fallback. **DISCOVERY T01:** verify minimum supported Windows/WSL accepts these arguments and exact unsupported-version error classification; do not infer success from wsl.exe existing.
- Keep base environment `processEnvironment()` plus resolved project settings for native shells. Git Bash adds `CHERE_INVOKING=1` last. For WSL, build `WSLENV` only from validated configured variable names (no path conversion flags), bound to the existing maximum 200 entries; their values stay solely in the child environment. Do not inherit arbitrary process.env/WSLENV or forward host authentication variables. Do not explicitly forward Windows PATH/HOME through WSLENV; WSL's own distro-controlled `appendWindowsPath` behavior remains unchanged. Copy says values are passed literally, Windows paths inside values are not translated. Stop and revise before implementation if the Windows smoke test disproves environment forwarding.

### 4. Open, idempotency and errors

`TerminalHost.open` first retains existing live/ended-ID handling and binding authorization. For a new interactive open (no `program` and `command === undefined`), read `getPreferences(store.get('settings','global') ?? {})`, resolve configured env and shell once for that attempt, then re-fetch binding. All asynchronous detection/conversion must finish **before** the final synchronous existing-ID/ended-ID/capacity checks and `spawn`. This prevents concurrent opens orphaning a process. Do not cache selected preference globally; new opens see the latest store value. In-flight open uses the choice captured at its start.

For `program` calls and `command` calls preserve the current shell/args/env branch exactly, including project environment resolution behavior and `command+'\r'`. A test must prove changing the preference does not reroute `run-script`. Do not expose program/args/environment in the HTTP create schema. Reconnect/read/resize/stop never rediscover shells.

If spawn throws ENOENT, invalidate catalog and return `TERMINAL_SHELL_UNAVAILABLE`; EACCES/other start errors map to `TERMINAL_START_FAILED`, not fallback. Only default COMSPEC ENOENT has the single cmd fallback described above. No terminalSession record on failed spawn. Catching errors must not swallow Store failures or reclassify ownership errors. Existing immediate-exit PTYs retain output and exit code, with shell metadata; no automatic relaunch.

WSL named distro missing → `TERMINAL_SHELL_UNAVAILABLE`; conversion failed → `TERMINAL_CWD_UNAVAILABLE`; discovery unavailable → `TERMINAL_SHELL_DISCOVERY_FAILED`. Error text names the safe shell label, not raw stderr/environment. Include Settings/Retry guidance. **DISCOVERY T01:** integrate code→HTTP status mappings with existing server mapping, preserving normal auth/input error status. New start failures should be structured HarnessError responses, not opaque HTTP 500 exceptions.

`TerminalBody` preserves the pending ID on an unconfirmed transport failure; retry same ID to avoid duplicate processes. Add a separate start retry action for `phase==='unconfirmed'` when no ID was acknowledged, guarded by the current owner. After a definitive shell error and changing Settings, retry can use the same pending ID because host wrote no record; do not clear/replace IDs merely on fetch rejection. Read Retry stays read-only. New terminal after an ended ID follows existing fresh-ID flow. Shell label comes from response, not preferences.

### 5. HTTP and settings wiring

- Add `GET /api/terminal-shells` with strict optional `refresh=1`, `Cache-Control:no-store`, under existing API auth hooks in `registerWorkspaceRoutes`, before dynamic terminal routes. No arbitrary path, command, cwd or distro probe parameters. Use `terminals.shellCatalog` so metadata and launch share resolution rules. HTTP cache header does not disable the bounded internal catalog cache.
- New `apps/web/src/terminal-shell-api.ts` fetches authenticated catalog, validates shared schema and supports AbortSignal. New `TerminalShellSettings.tsx` receives saved selection, busy and save callback; fetch catalog on mount, Refresh bypasses cache, retain selected missing item and surface states from R08. Do not turn a failed catalog into an autosave.
- `Settings.tsx` registers `terminal-shell` in its supported rows, General section, search terms `terminal shell powershell pwsh cmd command prompt git bash wsl distribution`; add to customRows and mount the component. Save complete object through `update({terminalShell:selection})`; surface Settings persist result without optimistically claiming success. Keep failed draft selection visible and retryable. The component needs a boolean save result (reuse `persist` directly if `update` currently returns void).
- No new Electron IPC or renderer filesystem/proc access. Browser connected to Windows host can choose Windows shells; Linux browser fixture mocks catalog independently of user agent.

### Front end team handoff

T07 delivers behavior/state inventory and synthetic screenshots to Leonardo's separate front end team. They design, without implementation workers prescribing appearance:

| Surface / state | Required behavior and copy to design around |
|---|---|
| Picker location | General settings, searchable "Terminal shell" target; team decides visual placement/grouping and presentation. Description: "Applies to new project terminals. Running terminals are unchanged." |
| Options list | "System default (Command Prompt)", "Command Prompt", "PowerShell 7", "Windows PowerShell", "Git Bash", "WSL"; host determines availability. Non-Windows: "System shell" and unsupported explanations. |
| WSL distribution | "Default distribution" plus exact installed names; "No WSL distributions are installed." Explain literal environment values/no path translation. |
| Discovery states | "Checking available shells…", "Could not check available shells. Retry.", Refresh, no optional shells installed, unsupported host, partial catalog with per-option errors. |
| Missing selection | Keep saved label present and explain "This shell is no longer available. Choose another shell." Do not force a fallback save. |
| Save states | Saving, saved, failed save with retained choice and Retry, disabled unavailable entries with reasons accessible to keyboard users. |
| Terminal status/errors | Actual shell/distro label; starting/running/ended; missing shell, failed start, unsupported cwd, cold WSL conversion timeout, old WSL; Retry start vs Retry read vs New terminal semantics. |

No colours, iconography, geometry, animation timing, transitions or new CSS are specified here. Team may refine wording while retaining the same behavior/accessibility distinctions. Their visual acceptance is separate from mocked functional tests.

### Migration and rollback

Migration is read-time defaulting through the existing preferences reader, no destructive rewrite or SQL version bump. Legacy terminalSession records lack shell metadata and remain readable/ended on restart. Rollback uses System default in settings; reverting the feature leaves the unknown preference preserved by existing lossless readers and otherwise ignored. Never delete settings/session records or restart running PTYs to roll back. Ship contracts/readers/writers together; no partial deployment assuming old strict preference writers accept the new field.

## EXECUTION_DAG

Order: T01 → T02 → T03 → T04 → T05 → T06 → T07. Small feature: one implementation worker/PR is preferred. If split, keep contracts with their readers/writers in the same reviewed integration PR. No parallel edits to shared settings, terminal or manifest files; T07 visual specification work may proceed after T05 behavioral scaffold is available.

### T01 — Verify platform assumptions and refresh integration map
- Dependencies: implementation authorization; read complete latest canonical plan, comments, AGENTS and baseline diff. Read-only scope, no product edits.
- Inputs: this plan and Windows x64 host with optional shells/WSL. Inspect `server.ts` error mapping, contract export conventions, settings/browser fixture wiring and bundled Git payload for bash. Re-search issues/PRs for shell choice and claims. Verify WSL argument support, byte encoding and `WSLENV` forwarding on actual target Windows; inspect `TerminalBody` failed-start phase transitions.
- Output: checkpoint answering every DISCOVERY above with file/symbol or redacted platform output. Verify absence as well as presence (WSL disabled, zero distros, missing bash in bundled Git). Do not call Linux mocks proof of Windows behavior.
- Tests: probe installed/noninstalled cases without installation or elevation; inspect `wsl --help` for --cd and run conversion only on a synthetic project after consent to start distro.
- Done when: platform assumptions supported or plan revised before code. Hand off exact supported-version/error classification and fixture entry points to T02–T05. If Windows unavailable, block only native verification and explicitly record it; never invent results.

### T02 — Shared selection, catalog and preference migration
- Dependencies: T01. Own `packages/contracts/terminal-shell.ts` (new), `preferences.ts`, exports if needed, `tests/terminal-shell-contract.test.ts` (new), extend `tests/preferences.test.ts`. Input: finalized types above. Output: schemas and defaulted preference used by host/web.
- Edits: implement strict discriminated choices/catalog/result metadata schemas, default field, atomic patch behavior. Preserve lossless unknown fields. Add new files to manifest source and packaged runtime subset according to neighbors; docs/tests never runtime.
- Tests: every valid choice, WSL with/without distro; empty/oversized/control/leading-dash distro, unknown kinds/keys and distro on non-WSL rejected; empty legacy settings and corrupt field default; valid setting round trip; old settings with unrelated/custom fields survive; invalid update does not write.
- Done when: focused contract/preference tests and typecheck pass. Handoff schemas and examples to T03/T05; recipient verifies imports before editing consumers.

### T03 — Shell discovery and launch descriptor resolver
- Dependencies: T02. Own new `packages/workspace/terminal-shell.ts`, `tests/terminal-shell.test.ts`, manifest additions. Input: selection, host env/OS, binding path, configured variable map. Output: bounded catalog and deterministic descriptor, no PTY created.
- Edits: implement candidate order, safe PATH scanning, coalesced TTL/Refresh, byte-aware bounded WSL probe, conversion, native/WSL environment construction, non-Windows behavior and structured errors. Injection seam supplies filesystem/probe clock, no OS global mutation required in tests.
- Tests: candidate precedence/dedupe/spaced paths; pwsh vs Windows PowerShell; all Git locations including bundled Git lacking bash and arbitrary PATH bash excluded; no optional shells; UTF-16LE/UTF-8/BOM/CRLF/non-ASCII distro names; zero distro/nonzero/timeout/overflow; malicious names never become commands; unsupported OS no Windows probe; cache expiry/refresh; conversion with spaces, apostrophe, ampersand and Unicode plus custom mount output; UNC rejection; native env unchanged, WSL forwarding only configured names and no env values in catalog/errors.
- Done when: focused tests pass and descriptor snapshots match DESIGN args/cwd/env; descriptor generation never spawns an interactive shell during discovery. Handoff runner contract/error cases to T04.

### T04 — Host spawn, metadata and authenticated catalog route
- Dependencies: T03. Own `packages/workspace/terminal.ts`, `apps/server/workspace-routes.ts`, server error mapping only if needed, new `tests/terminal-shell-routes.test.ts`; extend terminal unit/race tests. Input: resolver descriptor. Output: shell-aware interactive PTY and route.
- Edits: capture preference on new interactive open, bypass for program/command, keep every awaited operation before final rechecks; persist/return optional shell metadata; default cmd fallback once on ENOENT only; add catalog method/route. No HTTP override/program/env input. Pass cancellation for request probes without cancelling another coalesced subscriber's live request.
- Tests: live reconnect with changed preference does not resolve/spawn; ended record denied; 13th open denied; concurrent opens/delayed conversion yield one PTY per ID; binding changes during awaits deny; missing shell leaves no record; COMSPEC fallback only for allowed case; EACCES not retried; explicit missing shell not switched; trusted program/args/env unchanged; project command keeps legacy shell. HTTP auth/no-store/refresh/bad query, structured unavailable and timeout responses, no executable/env leakage. Verify existing stop/recovery/buffer tests unchanged.
- Done when: unit/HTTP/race and existing terminal suites pass. Handoff terminal metadata/error response examples to T05, including post-failure retry semantics.

### T05 — Settings control and terminal status/retry wiring
- Dependencies: T04 (schemas available from T02). Own new `apps/web/src/terminal-shell-api.ts`, `TerminalShellSettings.tsx`, `Settings.tsx`, `TerminalBody.tsx`, manifest; add `tests/terminal-shell-client.test.ts` and extend settings-support tests as needed without changing frozen upstream inventory.
- Edits: implement R08–R09 states, authenticated/abortable catalog read, host-platform choice, complete selection save with truthful success/failure, search target, actual shell label and guarded start retry. Keep read retry/restart/ownership behavior. No per-terminal picker or CSS/animation work.
- Tests: client valid/invalid response, abort and HTTP error; settings row search matches shell aliases; valid selection save, failed save retains draft; deleted distro remains visible; unmount/owner change discards late response; retry start uses pending ID, read Retry does not POST a new terminal.
- Done when: typecheck/build and focused client/settings tests pass; hand off state fixture hooks and neutral scaffold to T06/T07. UI is not visually accepted by a build result.

### T06 — Playwright coverage and regression evidence
- Dependencies: T05. Own new `tests/e2e/terminal-shell.spec.ts`, `terminal-shell.playwright.config.ts`, fixture/vite files discovered in T01 (pattern terminal-read), `scripts/browser-suites.ts` and manifest entries. Input: actual SettingsView + TerminalBody. Output: reproducible scoped browser suite.
- Tests: catalog loading then choose each available shell; WSL secondary selection; command payload persists complete preference; reload restores; missing selection remains visible; empty optional list; catalog Retry; save failure retained; non-Windows system note; browser on Windows host not gated on UA; keyboard/focus/status; settings change leaves live terminal label/ID unchanged; start failure → Settings correction → same pending-ID retry; read retry never respawns; stale unmount response ignored. Intercept API responses only, not component implementation. Include terminal excerpt/regression fixtures unchanged.
- Done when: scoped suite plus terminal-read, terminal-excerpts and settings-leaf-selects regressions pass. Store redacted traces/screenshots under ignored evidence directory, label mock evidence explicitly, and give T07 command/results.

### T07 — Native Windows acceptance, documentation and front end handoff
- Dependencies: T06; front end may receive preliminary state inventory after T05. Own evidence, `CHANGELOG.md` and suitable existing terminal user-doc section (discover via `rg -n 'terminal' docs/getting-started.md docs/feature-map.md`); no code redesign. Input: built app and synthetic project.
- Steps: perform native matrix below on Windows x64, record OS/Node/WSL/distributions/shell versions and actual binary used privately (redact user paths in public evidence). Test source host and packaged app if bundled Git discovery differs. Provide Front end team handoff inventory/screenshots and request their separate visual specification; do not implement their visual decisions here. Document default, new-terminal-only scope, missing shell recovery and WSL limitations/environment literal values.
- Positive/negative tests: actual prompt/identity/cwd marker and input/resize/stop per shell; hide/reopen, host restart, uninstall/rename optional fixture executable, zero distro/WSL off fixture or separate clean host, WSL cold-start timeout and unsupported cwd. Restore fixture installations/settings without modifying users' real shell binaries.
- Done when: native evidence, unit/HTTP/browser results and reviewed documentation satisfy acceptance matrix; front end team owns outstanding visual acceptance explicitly. Handoff to maintainer for review/release; no claim of merged/shipped or closed issue without authorization.

## VALIDATION

### Reproducible setup and commands (planned, NOT executed as product verification)

Repo root, supported Windows x64 with Node ≥24.10.0 and pnpm 10.30.3. Follow `docs/getting-started.md`/CONTRIBUTING for native dependencies; `pnpm install`, `pnpm exec playwright install chromium`. Use synthetic directory `C:\\gen-shell-fixtures\\project space-é` and disposable Store data. Resolver/HTTP mocks run on Linux too; they do not prove ConPTY/WSL.

```sh
pnpm typecheck
pnpm build
pnpm exec vitest run tests/terminal-shell-contract.test.ts tests/terminal-shell.test.ts tests/terminal-shell-routes.test.ts tests/terminal-shell-client.test.ts tests/preferences.test.ts tests/settings-operations.test.ts tests/settings-supported.test.ts tests/settings-registry.test.ts tests/terminal-host-unit.test.ts tests/terminal-host.test.ts tests/terminal-opening-race.test.ts tests/terminal-reopen-ended.test.ts tests/environment-settings.test.ts --maxWorkers=1
pnpm exec playwright test --config tests/e2e/terminal-shell.playwright.config.ts
pnpm exec playwright test --config tests/e2e/terminal-read.playwright.config.ts
pnpm exec playwright test --config tests/e2e/terminal-excerpts.playwright.config.ts
pnpm exec playwright test --config tests/e2e/settings-leaf-selects.playwright.config.ts
pnpm check:docs-links
```

New test paths above are planned files. Register scoped browser suite for normal CI discovery, without changing CI workflow. Run required repository CI gates once implementation PR exists. Record command exit status/counts and distinguish skips (e.g. Windows-only tests on Linux).

### Native acceptance matrix

For each available shell open a new terminal, print shell identity + cwd, create/read a disposable marker in the synthetic project, send input, resize, hide/reopen and Stop. cmd: `echo %COMSPEC%` / `cd`; PowerShell: `$PSVersionTable.PSEdition` and `$PSVersionTable.PSVersion` / `Get-Location`; Git Bash: `printf '%s\n' "$BASH_VERSION"` / `pwd`; WSL: `printf '%s\n' "$WSL_DISTRO_NAME"` / `pwd`. WSL must address the same marker as the Windows folder, including custom automount configuration. Verify literal configured env variable with synthetic nonsecret value and no Windows PATH replacement. Do not paste credentials to prove env forwarding.

| Requirement | Tasks | Acceptance check |
|---|---|---|
| R01 | T01,T03,T04,T07 | Exact candidate order unit fixtures; real installed shell identities; WSL absent/zero/named distributions distinguishable |
| R02 | T02,T05,T06 | Missing/corrupt defaults, strict invalid write, persistence/restart round trip, unrelated preferences retained |
| R03 | T04,T05,T06,T07 | Change setting with live A; A same ID/process/label, B chosen shell; restart doesn't revive old PTY |
| R04 | T03,T04,T06,T07 | Arg-array snapshots, binding change/concurrency/capacity tests; cwd/input/resize/output/stop real PTY matrix |
| R05 | T01,T03,T07 | wslpath fixture/custom mount real proof; spaces/Unicode; UNC/old WSL/failed conversion errors, no home fallback |
| R06 | T03,T04,T05,T06,T07 | Missing selection retained; removed executable/distro errors; default cmd-only fallback; retry same pending ID no duplicate |
| R07 | T03,T05,T06 | Linux/darwin/other injection cases, no Windows probes, stored preference retained and effective system-shell notice |
| R08 | T05,T06 | Search target, host OS choice, loading/empty/error/Retry/saving/save failure/missing selected value visible |
| R09 | T05,T06 | Keyboard selection, label/descriptions/status/error focus, late response rejected after owner/unmount changes |
| R10 | T03,T04,T07 | Sanitized env snapshots, project variable resolution, WSLENV allowlist native proof; no secret values in argv/errors/catalog |
| R11 | T04 | Trusted pinned program/env untouched; run-script with cmd-specific command still legacy independent of preference |
| R12 | T05,T06,T07 | No new visuals/motion in implementation diff; front end inventory delivered; functional and native evidence separately recorded |

Release gate: all applicable matrix rows green, required CI green, actual Windows ConPTY/WSL evidence attached, docs reviewed, and front end team visual acceptance before claiming design complete. If WSL/platform checks cannot run, mark those rows NOT_RUN/BLOCKED rather than shipping based only on mocked discovery. This planning session ran no application tests or Windows shells and made no visual changes.

## STATE

- Researched: baseline terminal spawning, preferences/store/UI wiring, existing test fixtures, publication rules, sibling plans/docs PRs and M01–M17 ledger.
- Decided for this plan: explicit edition choices; host discovery; global new-interactive-terminal preference; no per-terminal override v1; explicit missing selection fails; default cmd-only fallback; WSL conversion + literal env forwarding; no dependency/flag/SQL migration.
- Implemented: nothing. Product behavior verified: nothing. Native Windows and visual checks: NOT_RUN (Linux planning session). DISCOVERY T01 remains required for WSL version/error details and runtime packaging assumptions.
- Owners: no implementation claim. Publication to a GitHub issue and docs PR was authorized by the maintainer (planning only, no implementation); issue/PR numbers are recorded in the issue header. Publication prep branch: `devin/pick-terminal-shell-plan`. Remote publication/read-back remain pending, not HANDOFF_COMPLETE.
- Risks: WSL cold starts and encoding/version differences; Git distribution without bash; startup profiles changing cwd despite flags; path-literal environment surprises; increased async work reopening terminal races. Real Windows evidence is essential. A profile that deliberately changes directory is user configuration: report it; do not suppress profiles silently to fake cwd acceptance.
- Exact next step: complete the authorized publication to a GitHub issue and docs PR using the checklist below; issue/PR numbers are recorded in the issue header. Implementation remains unauthorized; assign T01 only after separate implementation authorization. Do not implement from the title alone.

### Future publication checklist (not executed)

AGENTS requires all nine sections, every requirement mapped to tasks/checks, full canonical issue body, UTF-8 Markdown source, read-back comparison and honest attachment limitations. Prior plans use docs PRs because GitHub CLI/API cannot upload a real .md issue attachment. A pasted body is not an attachment. Retain this plan unchanged as source and prepend only a publication note to the issue body; never create a recursive self-SHA reference inside the committed file.

With future explicit authorization, use a focused branch (e.g. `devin/$(date +%s)-pick-terminal-shell-plan`), add exactly this JSON string in the sorted `source` array of `scripts/public-source-files.json`:

```json
    "docs/agent-plans/pick-terminal-shell.md",
```

No `runtime` entry for this docs-only file; don't change manifest baseline/version. The manifest edit is intentionally NOT made by this local-plan task. Product runtime source files introduced later need source plus runtime entries where packaged.

Representative exact publication commands (future only; ISSUE and BRANCH must be resolved from authorized discovery, never guessed):

```sh
git switch -c "$BRANCH"
git add docs/agent-plans/pick-terminal-shell.md scripts/public-source-files.json
git commit -m "docs: plan terminal shell selection"
git push -u origin "$BRANCH"
gh pr create --repo skytuhua-org/Gen-V1 --base main --head "$BRANCH" --title "docs: plan terminal shell selection" --body-file "$PR_BODY_FILE"
git rev-parse HEAD
gh issue edit "$ISSUE" --repo skytuhua-org/Gen-V1 --body-file "$ISSUE_BODY_FILE"
gh issue view "$ISSUE" --repo skytuhua-org/Gen-V1 --json body,labels
```

If no matching issue, future publisher first creates it with the complete plan (`gh issue create --repo skytuhua-org/Gen-V1 --title "Feature: Pick the terminal shell" --label feature --label small --body-file docs/agent-plans/pick-terminal-shell.md`), then updates body after commit/PR. Follow AGENTS claim/checkpoint/read-back/release rules; never skip review/merge protection. PR body follows `.github/pull_request_template.md`, including checks/skips.

Issue body header format matching siblings (substitute actual full SHA and PR number, then blank line + **entire byte-identical plan**):

```markdown
> **Plan file (.md):** [docs/agent-plans/pick-terminal-shell.md @ SHORT_SHA](https://github.com/skytuhua-org/Gen-V1/blob/FULL_40_CHAR_SHA/docs/agent-plans/pick-terminal-shell.md) — committed in docs PR #PR_NUMBER because GitHub's API cannot attach files to issues. The complete, identical plan (r1) follows below.
```

Fetch/read back full issue body and the SHA-pinned raw file (authenticated `gh api repos/skytuhua-org/Gen-V1/contents/docs/agent-plans/pick-terminal-shell.md?ref=FULL_SHA` with raw accept header is suitable). Strip only the known issue header and compare plan bytes/sections and SHA256; verify all links resolve. Report HANDOFF_COMPLETE only after every section/task/test/acceptance row is retrievable. If size limits prevent full body, use verified complete pinned file + contents manifest/hash and ordered continuation comments for all text where supported, mark HANDOFF_INCOMPLETE until recovered. On revision update entire body and file, increment revision, preserve prior commit and append change comment naming task IDs.

## REFERENCES

- Baseline: https://github.com/skytuhua-org/Gen-V1/tree/e883ac0327c834120d89c3697dec7380a342ba4d
- Publication/ownership: `AGENTS.md`, `CONTRIBUTING.md`, `.github/pull_request_template.md`; exact relevant symbols and files are in REPO_MAP.
- Precedent issue bodies: https://github.com/skytuhua-org/Gen-V1/issues/1234 ; https://github.com/skytuhua-org/Gen-V1/issues/1235 ; https://github.com/skytuhua-org/Gen-V1/issues/1236 ; https://github.com/skytuhua-org/Gen-V1/issues/1237 ; https://github.com/skytuhua-org/Gen-V1/issues/1242
- Linked docs PRs: https://github.com/skytuhua-org/Gen-V1/pull/1239 ; https://github.com/skytuhua-org/Gen-V1/pull/1238 ; https://github.com/skytuhua-org/Gen-V1/pull/1241 ; https://github.com/skytuhua-org/Gen-V1/pull/1240 ; https://github.com/skytuhua-org/Gen-V1/pull/1243
- Platform documentation to validate during T01 (not claims of native testing): https://learn.microsoft.com/windows/wsl/basic-commands ; https://learn.microsoft.com/windows/wsl/filesystems ; https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows
