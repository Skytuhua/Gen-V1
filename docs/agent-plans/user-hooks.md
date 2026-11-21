# Plan: Your own hooks (run your scripts on agent events)

> **Design ownership (batch 5).** There is no separate front end team designing this feature: this plan itself specifies the visual design and the animation (section VISUAL_DESIGN_AND_MOTION). Implementers build exactly that specification. **When implementation is finished, the implementing agent sends the finished work to the front end team for review** (task T10) and does not close this issue until that review is recorded on the issue.

## META

| Field | Value |
|---|---|
| Feature | Your own hooks: user-written commands that Gen runs on four agent events (before a tool, after a tool, when a prompt is submitted, when a turn ends). A before-tool hook can block the call; an after-tool hook can, for example, run a formatter after a file edit |
| Size | medium (labels `feature`, `medium`); one issue, no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue |
| Plan file | `docs/agent-plans/user-hooks.md` (identical to this body; SHA-pinned link at the top of the issue) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified by clone) |
| Existing work | None for user-configured hooks. `gh issue list --search hook` returns only unrelated animation/refactor issues. Gen already has *bundled* integration hooks (fixed, checksum-admitted, see REPO_MAP) and internal code seams named "hooks"; neither runs user scripts |
| Implementation status | NOT_STARTED. Planning only; no code written |
| Source provenance | Feature proposal batch 5, item 5 ("Your own hooks", medium), filed directly at the maintainer's instruction; static repository research at the baseline SHA; public documentation of the same feature in Claude Code (code.claude.com/docs/en/hooks-guide) and OpenAI Codex (learn.chatgpt.com/docs/hooks) |

## OBJECTIVE

**Problem.** People want Gen to follow their own rules every time, without relying on the model to remember: run the formatter after every edit, refuse a dangerous command, check a prompt for pasted keys, or log the end of a turn. Today Gen has no way to run a user-provided command on agent events. The only hooks in the code are bundled integration hooks shipped with Gen (Impeccable, Superpowers, Ponytail; `packages/integrations/hermes.py`) and internal TypeScript seams such as `PlanningHooks` (`packages/core/planning.ts:16`). Project instruction files explicitly refuse hook directives (`packages/core/approved-project-context.ts:14-15,34`).

Comparable agents ship this as a core feature: Claude Code runs shell commands on `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop` and more, with JSON on stdin and exit code 2 meaning "block"; OpenAI Codex adopted the same event names and protocol (`hooks.json`, exit 2 or `permissionDecision: "deny"` to block, timeouts in seconds, hooks reviewed and trusted before they run).

**Intended behavior.**
1. Settings gets a new **Hooks** section. The user adds hooks; each hook has an event, an optional tool matcher, a command, a timeout and an on/off switch. A master "Run hooks" switch turns them all off at once.
2. **Before tool** hooks run before a matching Gen tool call executes; exit code 2 (or JSON `{"decision":"block","reason":"..."}`) blocks the call and the model receives the reason as the tool error.
3. **After tool** hooks run after a matching tool call or approved operation completes (for example after an approved file write), with the tool input and result on stdin.
4. **Prompt submitted** hooks run when the user sends a message; exit code 2 blocks the send, keeps the draft, and shows the reason under the composer.
5. **Turn ended** hooks run once each time a turn settles, for logging or notifications; they cannot block.
6. Every hook run that blocks, fails, times out or prints a `systemMessage` shows a compact row in the thread's work activity. Quiet successful runs show nothing in the thread (the user can see them in the hook's "Last run" line in Settings).
7. A **Test** button runs a hook once with a sample event and shows the exit code, duration and output.

**Measurable success.**
- With a Before tool hook `matcher: "operation_execute"` and command `exit 2` (stderr "blocked by my hook"), an agent attempt to execute an approved operation is refused, the model sees `HOOK_BLOCKED: blocked by my hook`, and the thread shows one "Hook blocked operation_execute" row.
- With an After tool hook `matcher: "op:file.replace"` running a formatter, every approved file write in the thread is followed by the formatter run within the hook timeout, and the written file on disk is formatted.
- With the master switch off, no hook process is spawned (verified by a counter in tests).
- A hook that hangs is killed at its timeout (default 30 s), including its child processes on Windows, and the tool call continues (default fail-open) or is blocked (when the hook is set to block on failure).

## REQUIREMENTS

### In scope (each maps to tasks and acceptance rows in VALIDATION)

- **R01 Hook model.** A hook is `{id, event, matcher, command, timeoutSeconds, onError, enabled, name}`.
  - `event`: `PreToolUse` | `PostToolUse` | `UserPromptSubmit` | `Stop` (wire names match Claude Code/Codex so existing scripts work; UI labels are "Before tool", "After tool", "Prompt submitted", "Turn ended").
  - `matcher`: string, max 200 chars; used only for `PreToolUse`/`PostToolUse`; empty or `*` matches every tool; otherwise a JavaScript regular expression tested against the match key (R04) with full-string semantics (`^(?:matcher)$`). Invalid regex is rejected on save.
  - `command`: string, 1 to 4000 chars, no NUL; run through the platform shell (R06).
  - `timeoutSeconds`: integer 1 to 120, default 30.
  - `onError`: `continue` (default) | `block`. Only meaningful for `PreToolUse` and `UserPromptSubmit`; decides what happens when the hook crashes, times out, cannot spawn, or exits with a code other than 0 or 2.
  - `enabled`: boolean, default `true`.
  - `name`: optional label, max 80 chars; UI falls back to the first 60 chars of the command.
  - Max 50 hooks. Document-level `enabled` (master switch) default `true`.
- **R02 Storage.** Hooks are global (device-level) in v1, stored in a new file-backed store `<dataDir>/hooks/hooks.json` following the `EnvironmentSettings` pattern (`packages/core/environment-settings.ts`): strict zod document `{version:1, revision, enabled, hooks[]}`, serialized mutations, regular-file and symlink checks, temporary-file rename, `0o600`/`0o700` permissions, optimistic `baseRevision`. `hooks` is added to `PROTECTED_STORAGE_DIRECTORIES` (`packages/core/security.ts:6`) so agent file tools can never read or write the hook file.
- **R03 API.** Dedicated authenticated routes like `apps/server/environment-routes.ts`: `GET /api/hooks` (document plus per-hook `lastRun`), `PUT /api/hooks` (create or replace one hook, `baseRevision`), `DELETE /api/hooks` (`{id, baseRevision}`), `PUT /api/hooks/enabled` (master switch), `POST /api/hooks/test` (`{id}` or an unsaved hook body; runs once with a sample payload; returns the run record). All responses `Cache-Control: no-store`. Hook commands never travel through `Store.command`/`settings.update`.
- **R04 Tool coverage and match key.** Hooks cover every tool call that passes through the host:
  - main and side conversation tool calls (`Service.tool` -> `Service.admittedTool`, `packages/core/service.ts:1925,1938`); match key = `call.name` (for example `file_replace_prepare`, `repository_test_prepare`, `operation_execute`, domain tools, MCP loopback tool names);
  - planning child tool calls (`PlanningCoordinator.tool` via `observeTool`, `packages/core/planning.ts:361`, wired at `service.ts:286`); same match key;
  - approved operation dispatch (`Service.executeOperation`, `service.ts:2183`); match key = `op:` + operation kind (for example `op:file.replace`, `op:repository.test`). This is where real file writes happen; `file_replace_prepare` only prepares.
  - **Not covered in v1, stated in the UI:** tools a model runtime executes natively without asking the host (documented at `packages/core/tool-authority.ts:154-170`: Hermes native `skill_tool`/`shared_skill_tool`, trusted plug-in internal sub-effects; Pi built-ins named in `packages/runtime-pi/tool-definitions.ts:64`). T01 confirms the exact list, which becomes the coverage note text.
- **R05 Event payloads (stdin, one JSON object, UTF-8, newline-terminated).** Common fields: `hook_event_name`, `session_id` (thread id), `thread_id`, `run_id` (or `null`), `cwd`, `project_dir` (or `null`), `gen_version`. Event fields:
  - `PreToolUse`: `tool_name` (match key), `tool_use_id`, `tool_input` (the call args; for `op:*` the operation's public data: kind, target path relative to project, and for `file.replace` the path and new content length, never the content itself).
  - `PostToolUse`: the PreToolUse fields plus `tool_response` (`{status:"succeeded"|"failed", error?:{code,message}, result?: <JSON, truncated to 64 KiB with "truncated": true>}`). For `op:file.replace` also `file_path` (absolute path of the written file) so a formatter can use it directly.
  - `UserPromptSubmit`: `prompt` (message text), `attachments_count`.
  - `Stop`: `final_state` (thread state after settlement, for example `completed`, `awaiting_input`, `stopped`, `interrupted`, `ready`), `aborted` boolean.
  - Payload larger than 1 MiB: the largest string fields are truncated and `"truncated": true` is set.
  - Env vars added for the process: `GEN_HOOK_EVENT`, `GEN_THREAD_ID`, `GEN_PROJECT_DIR` (when known), `GEN_TOOL_NAME` (tool events), `GEN_FILE_PATH` (`op:file.replace` PostToolUse). Also `CLAUDE_PROJECT_DIR` is **not** set (no impersonation of other products).
- **R06 Execution.** Commands run with the platform shell: Windows `%ComSpec%` (fallback `cmd.exe` under `SystemRoot`) with `/D /S /C "<command>"`; POSIX `/bin/sh -c <command>`. `cwd` = the thread's local project root if it has one, otherwise the user's home. Environment = `processEnvironment()` from `packages/capabilities/process.ts:14` plus R05 vars (device-level Environment Settings values are not injected in v1). Stdout and stderr captured, 64 KiB each, truncation flagged. Timeout kills the whole process tree (existing Windows `taskkill /T /F` and POSIX process-group logic). Turn cancellation aborts running Pre/Post hooks of that turn.
- **R07 Result protocol (compatible with Claude Code/Codex for the common cases).**
  - Exit 0: success. If stdout parses as a JSON object it may contain `systemMessage` (string, shown in the thread) and, for `PreToolUse`/`UserPromptSubmit`, `decision:"block"` + `reason`, or `hookSpecificOutput.permissionDecision:"deny"` + `permissionDecisionReason` (both mean block). Plain-text stdout is ignored (not sent to the model in v1).
  - Exit 2: block (for `PreToolUse` and `UserPromptSubmit`); reason = trimmed stderr (max 2000 chars), or "Blocked by hook <name>." when stderr is empty. For `PostToolUse` and `Stop`, exit 2 is treated as a failure row with stderr shown; it cannot undo anything.
  - Any other exit code, spawn error, timeout, or invalid JSON that starts with `{`: a hook error. For `PreToolUse`/`UserPromptSubmit` the hook's `onError` decides (continue with a warning row, or block with reason "Hook <name> failed: <short cause>"). For Post/Stop: warning row only.
  - Unsupported JSON fields (`updatedInput`, `additionalContext`, `continue`, `permissionDecision:"ask"`) are ignored and listed once in the run record as `ignoredFields` so the Test panel can show "Not supported yet: updatedInput".
- **R08 Ordering and blocking.** Hooks of one event run sequentially in list order. For `PreToolUse`/`UserPromptSubmit` the first block stops the remaining hooks of that event. Post and Stop hooks all run. Hooks of one tool call finish before the tool result is returned to the runtime (Pre before execution; Post before delivery). Stop hooks run detached from the turn (they do not delay settlement), at most 4 concurrently across the host, extra runs queued.
- **R09 Blocking semantics.**
  - Blocked tool call: the executor is never called; the call fails with `HarnessError('HOOK_BLOCKED', reason)`; the effect ledger (when enabled) records the failure like any executor error.
  - Blocked operation dispatch: the operation ends failed with `HOOK_BLOCKED` before any write; the approval is consumed exactly as for other dispatch failures (T01 confirms the existing failure path and reuses it).
  - Blocked prompt: `message.send` returns a rejected receipt with code `HOOK_BLOCKED` and the reason; the message is not stored or queued; the draft stays in the composer.
- **R10 No recursion.** Hook processes are not tools; nothing they do triggers hooks. A formatter that rewrites a file after `op:file.replace` changes its hash; the next `file_replace_prepare` for that file must use the new hash (existing expected-hash check makes the agent re-read; no special handling, but a regression test proves the second edit still works after re-read).
- **R11 Cached/replayed calls.** Hooks wrap the executor *inside* `ToolEffectLedger.invoke` (`tool-effects.ts:325`), so a ledger-cached result returned at `tool-effects.ts:352` does not re-run hooks. When the ledger flags are off, the same wrapper is applied directly (the hook wrapper is not gated by `audit.effectsV1` / `security.authorityV1`).
- **R12 Thread rows.** Hook runs that block, fail, time out, or return `systemMessage` add one bounded activity message (role `activity`) to the thread via the existing runtime activity path (`service.ts:1830-1834`), rendered by `WorkActivity` (`apps/web/src/WorkActivity.tsx`). Row content: hook name, event label, match key, outcome, duration, and up to 4 KiB of stderr/stdout (collapsed). Prompt blocks show under the composer instead of the thread (the message was never sent).
- **R13 Settings UI.** New section `hooks` ("Hooks") in `SETTINGS_SECTIONS` (`apps/web/src/Settings.tsx:32`) placed after `skills`, icon `Webhook` from lucide-react (fallback `Zap` if T07 finds `Webhook` missing in the pinned version); rows registered in `SETTINGS_ROWS` with ids `hooks-enabled`, `hooks-list`; search terms `hooks script command formatter block automation event`. Layout and motion in VISUAL_DESIGN_AND_MOTION.
- **R14 Last run.** The host keeps the last run record per hook in memory (not persisted): time, outcome, exit code, duration, truncated output. `GET /api/hooks` returns it.
- **R15 Security and privacy.**
  - Hooks run with the user's permissions; Settings shows "Hooks run on your computer with your permissions. Only add commands you trust." above the list.
  - Only the Settings UI (authenticated host routes) can create or change hooks; plug-ins, the model and agent file tools cannot (R02 protected directory; routes not exposed to plug-in RPC; T05 adds a negative test).
  - Hook payloads never include credentials, account tokens, environment-setting secrets, or file contents of operations; prompts are included only for `UserPromptSubmit` (documented in the Prompt submitted help text).
  - Hook output shown in the thread is truncated and HTML-escaped (rendered as text, never Markdown).
- **R16 Accessibility.** All controls labelled; event Select, matcher and command inputs keyboard reachable in order; hook cards are a list (`role="list"`/`listitem`); Test result announced with `aria-live="polite"`; status uses text and icon, not color alone; reduced motion removes transforms.
- **R17 Performance.** With zero enabled hooks for an event, the overhead per tool call is one in-memory lookup (no file read, no spawn): the store caches the parsed document and invalidates on mutation. Hook spawn is never on the send button path when there are no `UserPromptSubmit` hooks.

### Out of scope (v1)

- **Project-level hook files** (for example `.gen/hooks.json` committed in a repository). Research shows Gen deliberately refuses executable directives from project files today (`approved-project-context.ts`), and the project trust ledger (`project-trust.ts`) is behind flags marked off in `docs/progress.md` (M03). Running commands from a cloned repository is a new security boundary and needs its own issue built on project trust; do not implement here.
- Hook output fed to the model (`additionalContext`, plain stdout as context), rewriting tool input (`updatedInput`), "ask" decisions, Stop hooks that force the agent to continue, background/async Post hooks, hook types other than shell commands (HTTP, MCP tool, prompt hooks), other events (SessionStart, PreCompact, SubagentStop, Notification, PermissionRequest).
- Hooks for tools the runtime executes natively (R04 list).
- Importing hook files from Claude Code or Codex (possible follow-up; the protocol is already compatible so scripts can be reused by hand).
- Per-project scoping of global hooks (a matcher on `project_dir` can be done inside the script).

### User flows

1. **Add a formatter.** Settings > Hooks > "Add hook" -> a new card expands at the end of the list with Event "After tool", Matcher `op:file.replace`, Command `npx prettier --write "$GEN_FILE_PATH"` -> Save -> card collapses to a summary row; master switch is on. The agent edits a file; after the approved write the file is formatted; nothing shows in the thread when the formatter exits 0.
2. **Block a command.** Add "Before tool", matcher `operation_execute|repository_test_prepare`, command `node C:\hooks\guard.js` that reads stdin and exits 2 with a reason for a forbidden test file. The agent tries; the thread shows "Hook blocked repository_test_prepare: <reason>"; the model gets the reason and continues.
3. **Check prompts.** Add "Prompt submitted", command that exits 2 when `prompt` contains `sk-`. The user sends a message with a key; the composer keeps the text and shows "Blocked by hook Key check: Prompt contains what looks like an API key."; nothing is sent.
4. **Log turn ends.** Add "Turn ended", command `powershell -NoProfile -File C:\hooks\log.ps1`; each settled turn appends a line; nothing shows in the thread unless it fails.
5. **Test a hook.** Click "Test" on a card -> button shows a spinner -> result panel slides open with "Exit 2 - Blocked - 0.4 s" and the stderr text.
6. **Turn all off.** Master switch off -> all cards dim; no hooks run until it is turned back on.
7. **Hang.** A hook sleeps forever -> at 30 s it is killed; the thread shows "Hook <name> timed out after 30 s"; with `onError: continue` the tool proceeds.

### Error and recovery

- Hook file unreadable or invalid: hooks do not run (fail-safe: no unknown commands executed), Settings shows "Hooks could not be read. Existing hooks are kept on disk." with a Retry button; tool calls continue normally; one warning row per thread per host start: "Hooks are unavailable: the hooks file could not be read."
- Save conflict (`baseRevision` stale): "Hooks changed. Refresh before saving." (same pattern as Environment settings), card stays in edit mode with the user's input.
- Invalid matcher regex or out-of-range timeout: inline field error, Save disabled.
- Shell not found: hook error with cause "Could not start the shell" (onError applies).

## REPO_MAP (verified at the baseline SHA unless marked discovery)

| Area | Path | Verified fact |
|---|---|---|
| Host tool dispatch | `packages/core/service.ts:1925` `tool(call, ctx)`, `:1938` `admittedTool`, `:1956-1958` `execute` closure, `:1971` `toolBody` | All main/side host tool calls; `effects.invoke` only when `audit.effectsV1` or `security.authorityV1` is on, otherwise `execute()` directly |
| Runtime callback wiring | `packages/core/service.ts:295-296` | `RuntimeCallbacks.onTool` -> `Service.tool` for main and side runtimes |
| Planning children | `packages/core/planning.ts:16-29` `PlanningHooks.observeTool`, `:361` `tool`; wired at `service.ts:286` | Optional wrapper over all child tools |
| Learning dispatch | `packages/core/service.ts:298` | Separate flag-gated wrapper; **discovery in T01** whether learning tool calls should be covered (default in this plan: not covered, listed in the coverage note) |
| Effect ledger | `packages/core/tool-effects.ts:325` `ToolEffectLedger.invoke`, `:352` cached success, `:376` `await executor()`, `:264` `admitOperationDispatch` | Hooks go inside `executor` |
| Operation dispatch | `packages/core/service.ts:2183` `executeOperation(id, control)`, `:2194` admission | Approved effects run here, possibly after the preparing call returned |
| Domain operations | `packages/capabilities/index.ts:81` `handleDomainTool`, `:116-121` `file_replace_prepare` -> kind `file.replace`, `:122-129` `repository_test_prepare` -> kind `repository.test`, `:156` `executeDomainOperation`, `:161-182` atomic write + `ctx.completedWrite` | Source of `file_path` for PostToolUse |
| Tool registry and coverage note | `packages/core/tool-authority.ts:60,79-80,94,154-170` | Host tool names; documented runtime coverage gaps |
| Pi built-ins | `packages/runtime-pi/tool-definitions.ts:64` | Pi's own `bash`, `read`, `write`, `edit` etc. are reserved names; **discovery in T01**: whether Pi built-in writes reach the host |
| Contracts | `packages/contracts/index.ts:24` `RunContext`, `:31` `ToolCall`, `:32` `RuntimeEvent`, `:4` `Message` (roles `user`/`assistant`/`activity`), `:17` `Operation` | No uniform `ToolResult`; results are `unknown` |
| Prompt entry | `apps/server/server.ts:222` `POST /api/commands`; `service.ts:1043` `command`, `:1062` `commandAdmitted`, `:1173` `message.send`, `:1483` `sendMessage` | Hook point for `UserPromptSubmit` is the start of `sendMessage`, before storage/queue |
| Turn settlement | `service.ts:1779` `onRuntimeEvent`, `:1811-1812` emits `runtime.` + type, `:1791-1798` `runtime.settled` listeners, `:1906-1919` final thread state | Hook point for `Stop` |
| Activity rows | `service.ts:1830-1834` runtime activity -> persisted activity message; `apps/web/src/WorkActivity.tsx:17,34`; `apps/web/src/App.tsx:1173-1178` | Thread rendering of activity |
| Process runner | `packages/capabilities/process.ts:7` `ProcessResult`, `:14-18` `processEnvironment`, `:19` `runProcess(command,args,cwd,signal,progress,timeoutMs=120000,environment={},outputLimit=256*1024)`, `:22` spawn with `shell:false`, stdin `ignore`, `:42-48` tree kill, `:54` hard-coded progress label | Needs an optional stdin input and label for hooks |
| File-backed settings pattern | `packages/core/environment-settings.ts:23-47`; routes `apps/server/environment-routes.ts:9-14`, registered at `apps/server/workspace-routes.ts:31` | Template for the hook store and routes |
| Protected storage | `packages/core/security.ts:6` `PROTECTED_STORAGE_DIRECTORIES`, `:57` `assertNotStorage` | Add `hooks` |
| Settings shell | `apps/web/src/Settings.tsx:32` `SETTINGS_SECTIONS`, `:39` `SECTION_ICONS`, `:61` `SETTINGS_ROWS`, `:92,99` `environmentSettings?: ReactNode` injection, `:203` usage | Pattern for injecting a host-backed panel |
| List editor example | `apps/web/src/EnvironmentSettings.tsx:8,19` | Add/remove list with busy/error states |
| Settings search | `apps/web/src/settings-registry.ts:21,34`; `apps/web/src/settings-inventory.ts:3-6` | New rows need rendered ids |
| Design tokens | `DESIGN.md:41-50,64-81`; `packages/ui-shell/tokens.css:1-40,71`; `apps/web/src/appearance.css:20`; `apps/web/src/styles.css:351` | Motion names and reduced-motion handling |
| Bundled hooks (precedent, not reused) | `packages/integrations/hermes.py:65,120,128,188,255-297`; `packages/runtime-hermes/worker.py:490` | Fixed bundled hooks; post-edit failure preserves the write (same rule here) |
| Tests | `vitest.config.ts:8` (`tests/**/*.test.*`), `playwright.config.ts:4-12` (`tests/e2e`, suites in `scripts/browser-suites.ts`), `tests/environment-settings.test.ts`, `tests/tool-authority-v3.test.ts`, `tests/settings-registry.test.ts`, `tests/settings-supported.test.ts`, `tests/settings-search-filter.test.ts`, `tests/public-source.test.ts` | Conventions |
| Source manifest | `scripts/public-source-files.json` (`source`, `runtime` arrays) | Every new file is listed (`source`, plus `runtime` for shipped code) |

## DESIGN

### Data (new file `packages/contracts/hooks.ts`)

```ts
export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'] as const;
export type HookEvent = typeof HOOK_EVENTS[number];
export const hookSchema = z.strictObject({
  id: z.string().regex(/^hook_[A-Za-z0-9]{8,32}$/),
  name: z.string().max(80).default(''),
  event: z.enum(HOOK_EVENTS),
  matcher: z.string().max(200).default(''),          // validated as RegExp on save
  command: z.string().min(1).max(4000).refine(v => !v.includes('\0')),
  timeoutSeconds: z.number().int().min(1).max(120).default(30),
  onError: z.enum(['continue', 'block']).default('continue'),
  enabled: z.boolean().default(true),
});
export const hooksDocumentSchema = z.strictObject({
  version: z.literal(1), revision: z.number().int().nonnegative(),
  enabled: z.boolean(), hooks: z.array(hookSchema).max(50),
});
export interface HookRunRecord {
  hookId: string; event: HookEvent; matchKey: string | null; startedAt: string; durationMs: number;
  outcome: 'succeeded' | 'blocked' | 'failed' | 'timed_out' | 'spawn_failed' | 'cancelled';
  exitCode: number | null; reason: string | null; systemMessage: string | null;
  stdout: string; stderr: string; truncated: boolean; ignoredFields: string[];
}
export interface HooksView { revision: number; enabled: boolean; hooks: (Hook & {lastRun: HookRunRecord | null})[]; coverage: {covered: string[]; notCovered: string[]}; }
```

### Components

1. `packages/core/hook-settings.ts` `HookSettings` (store, R02): `read()`, `save({hook, baseRevision})`, `remove({id, baseRevision})`, `setEnabled({enabled, baseRevision})`, `snapshot()` (cached parsed document for the runner). Singleton per data dir like `environmentSettingsFor`.
2. `packages/core/hook-runner.ts` `HookRunner`:
   - `matching(event, matchKey): Hook[]` (enabled document, enabled hooks, matcher test; compiled RegExp cache keyed by matcher string).
   - `run(hook, payload, signal): Promise<HookRunRecord>` uses `runProcess` with the shell argv (R06), stdin = `JSON.stringify(payload) + '\n'`, timeout, output limit 64 KiB, environment overlay; parses the result per R07.
   - `pre(event: 'PreToolUse'|'UserPromptSubmit', key, payload, signal): Promise<{blocked: false} | {blocked: true, reason, record}>` (R08).
   - `post(event: 'PostToolUse', key, payload, signal): Promise<HookRunRecord[]>`.
   - `stop(payload): void` (detached queue, concurrency 4).
   - `lastRuns: Map<hookId, HookRunRecord>`; `onRecord` callback used by Service to add activity rows (R12).
3. `packages/capabilities/process.ts`: add an optional trailing `options?: {input?: string; label?: string}` parameter to `runProcess`. When `input` is set, stdin is `'pipe'`, the input is written and stdin closed (EPIPE ignored); `label` replaces the hard-coded progress label. Existing callers unchanged.
4. Service integration (`packages/core/service.ts`):
   - `admittedTool`: replace `execute` with `() => hooks.aroundTool(call.name, payloadFor(call, ctx), ctx, () => this.toolBody(...))`, keeping the existing `effects.invoke` vs direct branch (R11).
   - Planning `observeTool` wrapper at `:286`: wrap its `execute` the same way.
   - `executeOperation`: after admission and before `executeDomainOperation`, run `pre('PreToolUse', 'op:'+kind, ...)`; on block, fail the operation with `HOOK_BLOCKED` through the existing failure path; after a successful result run `post('PostToolUse', 'op:'+kind, ...)` with `file_path` from `ctx.completedWrite`, then deliver the result unchanged. A Post hook failure never changes the operation result (same rule as `hermes.py:128`).
   - `sendMessage` (`:1483`): first statement after validation: `pre('UserPromptSubmit', null, ...)`; on block throw `HarnessError('HOOK_BLOCKED', reason)` before anything is stored. Discovery in T06: confirm the receipt/HTTP error shape the composer already shows for rejected sends and reuse it.
   - `runtime.settled` handling (`:1791-1798`): call `hooks.stop({...})` once per settlement of the main thread run (not side conversations, not maintenance runs; discovery in T06 for how to distinguish, default: only runs with a user-visible thread).
5. Routes `apps/server/hook-routes.ts` registered beside `registerEnvironmentRoutes` (`workspace-routes.ts:31`).
6. Web: `apps/web/src/HookSettings.tsx` (+ `hook-settings.css`, `hooks-api.ts`), injected into `SettingsView` like `environmentSettings` (new optional prop `hookSettings?: ReactNode`), rendered when section is `hooks`.

### Control flow (Before tool)

```
runtime -> Service.tool -> admittedTool -> [effects.invoke ->] execute()
  execute() = hooks.aroundTool(key, payload, ctx, body):
     list = matching('PreToolUse', key)        // empty -> body() immediately
     r = await pre(...)                         // sequential, abort on turn cancel
     if r.blocked -> record row; throw HOOK_BLOCKED(reason)
     try { result = await body() } catch (e) { await post(... failed ...); throw e }
     await post(... succeeded, result ...)
     return result                              // unchanged
```

### Security boundaries

- Hook definitions only through authenticated host routes (R03), stored in a protected storage directory (R02, R15).
- Commands come only from the user's own Settings input; no file in a project can add or change a hook (out of scope list).
- The runner never passes secrets: environment is the allowlisted `processEnvironment()` plus R05 vars.
- Hook stdout/stderr is untrusted text: truncated, rendered as plain text, never executed or fed to the model.

### Migration and rollback

- New store file; absent file = empty document (`enabled:true`, no hooks) -> zero behavior change for existing users.
- Rollback: reverting the PR leaves `<dataDir>/hooks/hooks.json` unused on disk; no schema migration of `harness.sqlite`.

## VISUAL_DESIGN_AND_MOTION

Specified here because no front end team designs this feature; build exactly this, then send it to the front end team for review (T10). Use only existing tokens from `packages/ui-shell/tokens.css` and `DESIGN.md`; no new colors.

### Section layout (Settings > Hooks)

1. **Header row** (`.settings-row`, id `hooks-enabled`): title "Run hooks", description "Run your own commands when the agent uses tools, when you send a message, and when a turn ends." Control: the existing `.settings-switch`.
2. **Warning line** under the header: `--muted` text with a `ShieldAlert` icon (16 px): "Hooks run on your computer with your permissions. Only add commands you trust."
3. **Coverage note** (`<details>` closed by default, summary "What hooks can see"): two short lists from `HooksView.coverage` ("Covered: Gen tools, approved file writes and tests, prompts you send, turn ends." / "Not covered yet: <T01 list>").
4. **Hook list** (id `hooks-list`, `role="list"`): one card per hook, card = `.settings-card` style (existing card radius, border and background; panel inset `--ui-panel-inset`), gap `--ui-space-2` between cards.
   - **Collapsed card** (row height `--ui-row-comfortable`, 36 px): left a small event pill (text label: "Before tool" / "After tool" / "Prompt submitted" / "Turn ended", neutral pill using the existing badge style), then the name or command preview in the monospace font, truncated with ellipsis; then the matcher in `--muted` monospace (tool events only, `*` when empty); right side: last-run status (icon + text: "Ran 2 min ago", "Blocked 1 min ago", "Failed", "Timed out"; failed/timed out use the existing danger text token plus `AlertCircle` icon, blocked uses the existing warning token plus `Ban` icon), the per-hook switch, and a chevron button "Edit".
   - **Expanded card (edit)**: a two-column form grid on widths >= 640 px, one column below:
     - "Event" shared `Select` (options above), "Name (optional)" text input,
     - "Tool matcher" text input with placeholder `*` and help "Tool name or regular expression, e.g. op:file.replace or operation_execute|repository_test_prepare" (hidden for Prompt submitted / Turn ended),
     - "Command" textarea, monospace, 3 rows, auto-grows to 8 rows, `spellCheck={false}`, help "Gets the event as JSON on standard input. Exit 2 to block." (help for Post/Stop: "Gets the event as JSON on standard input.")
     - "Timeout" number input with suffix "seconds" (1 to 120),
     - "If the hook fails" `Select`: "Continue" / "Block" (only for Before tool and Prompt submitted),
     - footer buttons right-aligned: "Test", "Remove" (danger text button, asks `confirm` via the existing confirmation pattern used for archive), "Cancel", "Save" (primary).
   - **Test result panel** inside the card under the form: status line (icon + "Exit 0 - Succeeded - 0.2 s" / "Exit 2 - Blocked - 0.4 s" / "Timed out after 30 s"), then stdout and stderr blocks in monospace, max height 160 px with scroll, label "Output" / "Errors", "Not supported yet: updatedInput" line when `ignoredFields` is non-empty.
5. **"Add hook" button** below the list (secondary button with `Plus` icon). Empty state (no hooks): centered `--muted` text "No hooks yet. Add one to run a command on agent events." above the button.
6. **Master switch off**: cards get `opacity: 0.6` and a line under the header "Hooks are off. None will run." (cards remain editable).

### Thread row (work activity)

- Uses the existing WorkActivity item layout; leading icon `Webhook` (or the T07 fallback), text "Hook blocked repository_test_prepare: <reason>" / "Hook <name> failed (exit 1)" / "Hook <name> timed out after 30 s" / "Hook <name>: <systemMessage>". Output collapsed behind the existing expand affordance, monospace, max 4 KiB.

### Composer block

- When a prompt is blocked: the existing composer error line (discovery T06) shows "Blocked by hook <name>: <reason>" with the warning token and `Ban` icon; the draft stays; the error clears on the next edit.

### Motion

- Card expand/collapse: CSS `grid-template-rows: 0fr -> 1fr` on the form wrapper, plus opacity 0 -> 1, duration `var(--ui-motion-panel-enter)` (220 ms) on expand, `var(--ui-motion-panel-exit)` (180 ms) on collapse, easing `var(--ui-ease-enter)` / `var(--ui-ease-move)`; chevron rotates 0 -> 90 deg with the same duration.
- Add hook: new card inserts with `var(--ui-motion-insert)` (180 ms): opacity 0 -> 1 and `translateY(-4px)` -> 0, then opens in edit state. Remove: `var(--ui-motion-remove)` (140 ms) opacity 1 -> 0 and height collapse, then unmount.
- Test running: the Test button shows the existing inline spinner and `aria-busy="true"`; the result panel reveals with the same grid technique at `var(--ui-motion-status)` (160 ms). Never show a success animation before the host returns the run record.
- Last-run status text change: crossfade `var(--ui-motion-status)`.
- Master switch dim: opacity transition `var(--ui-motion-status)`.
- Reduced motion (`prefers-reduced-motion: reduce` or app motion Reduced/Off, using the existing selector convention in `tokens.css:71` / `appearance.css:20`): no transforms, no height animation; opacity only, at most 80 ms (DESIGN.md:79), or instant for Off.
- Focus: after Add hook, focus moves to the Event select; after Save, focus returns to the card's Edit button; after Remove, focus moves to the next card's Edit button or to "Add hook".

## EXECUTION_DAG

Tasks own disjoint files unless noted. T02-T04 can run in parallel after T01; T05 needs T02+T03; T06 needs T04+T05; T07 needs T02 (API shapes) and can run in parallel with T04-T06 against a mocked API; T08 needs T06; T09 needs T06+T07; T10 last.

### T01 Coverage and failure-path discovery (no product code kept)
- **Goal:** pin the facts this plan marks as discovery: (a) which runtimes' file writes and shell commands reach `Service.tool`/`executeOperation` (Pi built-ins, Hermes native, official MCP loopback, plug-ins, learning dispatch); (b) the existing operation dispatch failure path and approval consumption to reuse for `HOOK_BLOCKED`; (c) how `message.send` rejections reach the composer today; (d) how to tell a main-thread settlement from side/maintenance settlements; (e) lucide-react version and whether `Webhook` exists.
- **Deps:** none. **Files:** none committed. **Output:** an issue comment with the five answers (file:line), plus the final "Not covered yet" list for the coverage note.
- **Done when:** comment posted; if (a) shows that approved file writes do *not* pass `executeOperation` for the default runtime, BLOCK T06 and post the finding for a plan revision.

### T02 Contracts and hook store
- **Goal:** R01, R02, R14 (types), R17 (cache).
- **Deps:** T01.
- **Files:** new `packages/contracts/hooks.ts`, new `packages/core/hook-settings.ts`, `packages/core/security.ts` (add `'hooks'`), new `tests/hook-settings.test.ts`, `scripts/public-source-files.json` (`source` + `runtime` for the two new code files, `source` for the test).
- **Tests:** positive: empty file -> default document; save/remove/setEnabled bump revision; cache invalidated on mutation; regex matcher accepted. Negative: stale `baseRevision` -> `HOOKS_CHANGED`; invalid regex, timeout 0/121, NUL in command, 51st hook, unknown key -> rejected; symlinked or oversized file -> `HOOKS_UNAVAILABLE` and nothing runs; `assertNotStorage(<dataDir>/hooks/hooks.json)` throws.
- **Done when:** `pnpm exec vitest run tests/hook-settings.test.ts` passes and `pnpm typecheck` is clean.

### T03 Process runner input and label
- **Goal:** R06 (runner part).
- **Deps:** T01.
- **Files:** `packages/capabilities/process.ts`; tests in a new `tests/process-input.test.ts` (manifest entry).
- **Tests:** input piped and read by a child (`node -e` reading stdin); large input (2 MiB) with a child that exits without reading does not throw (EPIPE); no input -> stdin still ignored (existing callers unchanged); label used in progress; timeout still kills tree with input set.
- **Done when:** new test plus existing `runProcess` consumers' tests pass (find them with `rg runProcess tests`).

### T04 Hook runner
- **Goal:** R05, R06, R07, R08, R10, R14.
- **Deps:** T02, T03.
- **Files:** new `packages/core/hook-runner.ts`, new `tests/hook-runner.test.ts` (manifest entries).
- **Tests (use small `node -e` scripts as hook commands so they work on Windows and POSIX):** exit 0 -> succeeded; exit 2 + stderr -> blocked with reason; JSON `decision:block` and `permissionDecision:deny` -> blocked; exit 1 with onError continue/block; timeout kills and reports `timed_out`; spawn failure; invalid JSON starting with `{` -> failed; `updatedInput` -> `ignoredFields`; payload fields and env vars present; payload truncation over 1 MiB; first block stops later Pre hooks; Post runs all; Stop queue concurrency 4; master off -> zero spawns; matcher `*`, empty, regex, full-string semantics (`file` must not match `file_replace_prepare`); abort signal cancels a running hook.
- **Done when:** `pnpm exec vitest run tests/hook-runner.test.ts` passes on Linux CI and on a Windows machine (paste both outputs; the Windows run may be done in T08).

### T05 Host routes
- **Goal:** R03, R15 (route part).
- **Deps:** T02, T04 (test endpoint).
- **Files:** new `apps/server/hook-routes.ts`, `apps/server/workspace-routes.ts` (register), new `tests/hook-routes.test.ts` (manifest entries).
- **Tests:** GET/PUT/DELETE/enabled/test happy paths with `no-store`; body limits (64 KiB); stale revision 409-style error; unauthenticated request rejected like environment routes; plug-in RPC cannot reach these routes (follow the existing plug-in allow-list test pattern; discovery of the pattern in this task).
- **Done when:** tests pass.

### T06 Service integration
- **Goal:** R04, R09, R11, R12, R17 (no-hook fast path).
- **Deps:** T01, T04.
- **Files:** `packages/core/service.ts` (admittedTool, planning observeTool wrapper, executeOperation, sendMessage, settlement), new `tests/hook-service.test.ts` (manifest).
- **Tests:** Pre block on a host tool -> executor not called, model gets `HOOK_BLOCKED`, one activity row; same with ledger flags on and off; ledger-cached call does not re-run hooks; `op:file.replace` Pre block -> no write, operation failed; Post hook gets `file_path` and can modify the file; Post failure keeps the operation result; formatter rewrite then second `file_replace_prepare` with stale hash -> expected-hash error, after re-read -> succeeds (R10); prompt block -> no message stored, receipt error; Stop fires once per main settlement, not for side/maintenance; zero hooks -> no spawn and no file read per call; turn cancel aborts a running Pre hook and the tool call is cancelled.
- **Done when:** tests pass; existing `tests/tool-authority-v3.test.ts` and service tests still pass.

### T07 Settings UI, visual design and motion
- **Goal:** R13, R14 (display), R15 (warning text), R16, VISUAL_DESIGN_AND_MOTION (Settings parts).
- **Deps:** T02 (types), T05 (API; may start against a mock).
- **Files:** `apps/web/src/Settings.tsx` (section, icon, rows, `hookSettings` prop), new `apps/web/src/HookSettings.tsx`, `apps/web/src/hook-settings.css`, `apps/web/src/hooks-api.ts`, the place that passes `environmentSettings` to `SettingsView` (discovery: `rg environmentSettings= apps/web/src`), compact settings files if they mirror sections (discovery), manifest entries.
- **Tests:** `settings-registry`, `settings-supported`, `settings-search-filter` updated (search "formatter" finds Hooks); new Playwright spec `tests/e2e/hook-settings.spec.ts` registered in `scripts/browser-suites.ts`: add, edit, save, toggle, remove, master off dims, Test shows result, invalid regex disables Save, keyboard-only flow, focus rules, reduced motion has no transform; `pnpm lint` (UI guard) clean.
- **Done when:** specs pass in `pnpm test:browser --suite <suite>` and screenshots of collapsed, expanded, test-result and empty states are attached to the PR.

### T08 Thread rows and composer block message
- **Goal:** R12 rendering and the composer block line.
- **Deps:** T06.
- **Files:** `apps/web/src/WorkActivity.tsx` (hook row icon/text only if the generic activity row cannot show it; discovery), the composer error line file found in T01 (c).
- **Tests:** Playwright with a fixture host: blocked tool row, failed row, timeout row, systemMessage row, output collapsed and escaped (a `<b>` in stderr renders as text); blocked prompt keeps the draft and shows the message; Windows run of T04 tests pasted here if not done earlier.
- **Done when:** specs pass.

### T09 End-to-end check on Windows desktop
- **Goal:** prove the user flows 1-7 on the Windows desktop build.
- **Deps:** T06, T07, T08.
- **Files:** none (evidence only).
- **Steps:** build the desktop app per CONTRIBUTING.md; configure the seven flows; record a short screen recording; note results per flow in the acceptance matrix.
- **Done when:** recording and per-flow results are posted on the issue.

### T10 Front end team review (required by the maintainer)
- **Goal:** send the finished work to the front end team for review of the visual design and motion.
- **Deps:** T07, T08, T09.
- **Steps:** post on the issue and in the PR a request addressed to the front end team with screenshots (all card states, thread rows, composer block, reduced motion) and the T09 recording; apply requested changes in the same PR; record the outcome on the issue.
- **Done when:** the front end team's review result is recorded on the issue.

## VALIDATION

### Commands (planned, none executed yet)

```
pnpm install
pnpm typecheck
pnpm lint
pnpm exec vitest run tests/hook-settings.test.ts tests/process-input.test.ts tests/hook-runner.test.ts tests/hook-routes.test.ts tests/hook-service.test.ts
pnpm exec vitest run tests/settings-registry.test.ts tests/settings-supported.test.ts tests/settings-search-filter.test.ts tests/public-source.test.ts tests/tool-authority-v3.test.ts tests/environment-settings.test.ts
pnpm test:browser --suite <suite containing hook-settings.spec.ts>
pnpm test
```

### Acceptance matrix

| Req | Check | Task |
|---|---|---|
| R01 | Schema accepts valid hooks, rejects invalid regex/timeout/NUL/51st hook | T02 |
| R02 | Store round-trip, revision conflict, protected directory denies agent access | T02 |
| R03 | Routes work, `no-store`, unauthenticated and plug-in access rejected | T05 |
| R04 | Hooks fire for host tools, planning children, `op:*`; coverage note lists the T01 gaps | T01, T06, T07 |
| R05 | Payload fields and env vars present; truncation over 1 MiB | T04 |
| R06 | Shell argv per platform; tree kill on timeout (Windows and Linux) | T03, T04, T09 |
| R07 | Exit 0/2/other, JSON block/deny, ignored fields | T04 |
| R08 | Sequential order; first block stops Pre; Stop concurrency 4 | T04 |
| R09 | Blocked tool, operation and prompt behave as specified | T06 |
| R10 | Formatter rewrite then re-read edit succeeds; hooks do not trigger hooks | T06 |
| R11 | Cached ledger result does not re-run hooks; works with flags on and off | T06 |
| R12 | Thread rows for block/fail/timeout/systemMessage; quiet success shows none | T06, T08 |
| R13 | Section, rows, search terms | T07 |
| R14 | Last run shown per hook | T04, T07 |
| R15 | Warning text; no secrets in payload; output escaped | T04, T07, T08 |
| R16 | Keyboard flow, labels, aria-live, status not color-only | T07 |
| R17 | Zero hooks: no spawn, no file read per call | T06 |
| Visual/motion | Matches VISUAL_DESIGN_AND_MOTION, reduced motion verified | T07, T10 |
| Flows 1-7 | Windows desktop recording | T09 |

**Release gate:** all rows passing, CI green, front end team review recorded (T10).

## STATE

| Item | State |
|---|---|
| Research (repo + public docs) | Done (this plan) |
| Decisions | Made in this plan: global hooks only; four events with Claude Code/Codex wire names; exit 2 blocks; fail-open default with per-hook "Block" option; no model-visible output; project hook files out of scope |
| Implementation | NOT_STARTED |
| Verification | NOT_RUN (no tests executed for this plan) |
| Owners / branches | None yet |
| Risks | Coverage gaps for runtime-native tools (T01 may shrink the covered list); Windows shell quoting (`cmd /S /C`) for commands with quotes; formatter edits changing file hashes mid-turn (R10) |
| Next step | T01 discovery comment by the implementing worker |

## REFERENCES

- Claude Code hooks guide: https://code.claude.com/docs/en/hooks-guide/ (events PreToolUse, PostToolUse, UserPromptSubmit, Stop; JSON on stdin; exit 2 blocks with stderr as reason; matchers on tool name; formatter-after-edit example).
- OpenAI Codex hooks: https://learn.chatgpt.com/docs/hooks (same event names; `hooks.json` at user and trusted-project level; `permissionDecision: "deny"` or legacy `decision: "block"` or exit 2 to block; `timeout` in seconds, default 600; errors and timeouts in PreToolUse let the tool run; hooks reviewed and trusted by hash before they run; `updatedInput`/`additionalContext` supported there but out of scope here).
- Repository facts: REPO_MAP above, all at `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d`.
- `docs/progress.md` M01-M17 matrix: M02 notes native hooks/sub-effects coverage is incomplete; M03 trust/confinement off (reason project hook files are out of scope).
