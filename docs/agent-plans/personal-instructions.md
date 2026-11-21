# Plan: Personal instructions for every project

## META

| Field | Value |
|---|---|
| Feature | One Settings box, stored as a personal `AGENTS.md` in Gen's own storage folder, whose text Gen applies to every main thread in every project, before (lower precedence than) project instructions |
| Size | small (labels `feature`, `small`); no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue (number assigned at creation; the plan file link at the top of the body is SHA-pinned) |
| Plan file | `docs/agent-plans/personal-instructions.md` (identical to the issue body below the file link) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified with `git ls-remote origin refs/heads/main` on 2026-11-21) |
| Related work | No existing issue or PR for personal, global, user-level or custom instructions (searched issues for "instructions AGENTS.md global", and the `feature` label list). `docs/progress.md` M01–M17 has no such milestone. Related but different: project instruction admission (`packages/core/approved-project-context.ts`, part of M04, only active behind the off-by-default `context.compilerV1` flag), "Thread title instructions" (T3 inventory row only, not a model instruction), the skill catalog's personal skill roots (`packages/skill-catalog/adapters.ts`). |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Researched feature proposal batch 5, item 4: "Personal instructions for every project (S): A settings box (backed by a home-folder AGENTS.md) applied to all projects before project AGENTS.md. Sources: https://learn.chatgpt.com/docs/agent-configuration/agents-md.md, https://kirill-markin.com/articles/codex-rules-for-ai/. Repo area: packages/core/approved-project-context.ts (project roots only), settings-inventory.ts." The repository owner (Leonardo) asked on 2026-11-21 that researched features be filed directly as plan issues with a detailed .md, with no approval step, and delegated every other decision. Repository facts below were read at the baseline SHA. Decisions marked **DECIDED** were made by the planner; options not taken are recorded. |

**Design and animation ownership.** There is no separate front end team designing this feature: **this plan specifies the visual design and animation** (DESIGN §6–§7), and implementers build exactly that. Leonardo asked that the finished work then be **sent to the front end team for review**: task T07 does that, and the issue is not complete until their review is recorded.

## OBJECTIVE

**User problem.** People who use coding agents keep the same personal working rules for every repository: "answer in British English", "prefer pnpm", "never commit without asking", "write tests first". Codex reads a personal `~/.codex/AGENTS.md` (global scope) before each project's `AGENTS.md` and concatenates them, root to leaf, with later (more specific) files taking precedence. Gen V1 has no personal layer: the only instruction files it admits are `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` inside explicitly granted project roots, and only when `context.compilerV1` is on. The Pi runtime even disables native agents-file discovery (`getAgentsFiles: () => ({ agentsFiles: [] })` in `packages/runtime-pi/tool-definitions.ts`). So a user must copy their rules into every project or retype them in every thread.

**Intended behavior.**
1. Settings → Chat & Composer has a **Personal instructions** card: an on/off switch, a multi-line editor, a byte counter, Save and Revert buttons, and (desktop only) "Open file" and "Show in folder".
2. Saved text is written to `<Gen data folder>/personal-instructions/AGENTS.md`. Editing that file in any editor has the same effect as saving in Settings.
3. When the switch is on and the text is not empty, every new run of a main thread (any project, or no project) receives the text in its system prompt, framed as personal instructions, placed **after** Gen's host prompt and **before** any approved project instructions, with the precedence rule "host policy > user's message in this thread > project instructions > personal instructions".
4. Changes apply from the next run start of each thread; an already running turn keeps the text it started with.
5. The Context inspector (when `context.compilerV1` is on) lists the personal instructions source with its size and digest, next to approved project instructions.

**Measurable success.**
1. With text "Always answer in French." saved and switched on, a new thread in project A and a new thread in project B both receive the framed block in their system prompt (unit T03 for each runtime adapter that builds a system prompt; browser T06 checks the inspector entry).
2. Switching off, or saving empty text, removes the block from the next run start; no file read happens while off (unit T03).
3. Text over 16 KiB UTF-8, invalid UTF-8, text containing NUL, or text with an include/hook directive is refused on save with a specific message and is excluded (with a recorded reason) when found in a hand-edited file (unit T02).
4. A thread's granted resources can never reach the personal instructions file (unit T02 negative test through `resolveGrant`).
5. No regression in the suites listed in VALIDATION (project-instructions host/custody, preferences, settings registry/search/supported, Hermes runtime, UI guard).

## REQUIREMENTS

### In scope

- R01 Storage: one UTF-8 file `personal-instructions/AGENTS.md` under the store data folder (`Store.dataDir`, `packages/storage/store.ts:56`; on Windows the default is `%LOCALAPPDATA%\GenerativeHarness`, see `packages/runtime-pi/login.ts:89`). The folder name `personal-instructions` is added to `PROTECTED_STORAGE_DIRECTORIES` (`packages/core/security.ts:6`) so no resource grant, file tool or project root can read or write it.
- R02 Preference `personalInstructionsEnabled: boolean`, default `true`, in `packages/contracts/preferences.ts` (schema, `DEFAULT_PREFERENCES`), saved through the existing `settings.update` command. An absent file or empty text means "no personal instructions" regardless of the switch.
- R03 Limits and validation (shared by save and by reading a hand-edited file): at most 16 384 UTF-8 bytes; strict UTF-8 decode (`TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`, as `approved-project-context.ts` does); no NUL; the same unsupported-directive rule as project instructions (the `unsupportedDirective` regex in `approved-project-context.ts`, to be exported and reused, not copied); line endings normalised to `\n` on save; trailing whitespace of the whole text trimmed on save; empty after trim means delete the file.
- R04 Host API: `GET /api/personal-instructions` returns `{ text, digest, bytes, updatedAt, status }` where status is `OK | ABSENT | EXCLUDED` with `reason` (`SOURCE_TOO_LARGE | SOURCE_NOT_TEXT | UNSUPPORTED_DIRECTIVE | UNAVAILABLE_SOURCE`); new command `instructions.personal.update` with `{ text, baseDigest }` (baseDigest = digest the editor loaded, `null` when absent) that writes atomically (temp file + rename in the same folder) and fails with `STALE_INPUT`-style conflict (DISCOVERY X2 for the exact error code) when the file changed since load.
- R05 Injection: at each run **start** of a main thread (not side questions, not model-only purposes such as prediction, titles, memory extraction or compaction summaries), the host reads the file once (only when R02 is on), validates it (R03), and passes `personalInstructions: { text, digest }` on `StartRun`. Every system-prompt builder appends the framed block (DESIGN §3) directly after `hostSystemPrompt(...)` output, before project instruction text. Follow-ups inside an active run keep the captured value.
- R06 Delegates (agent work, `thread.kind === 'delegate'`) receive the same block as their parent's latest run start (they serve the same user); side threads (`sideParentId`) do not.
- R07 Precedence text inside the block (DESIGN §3) states: host policy and the current user message win over project instructions, which win over these personal instructions. The project header in `approved-project-context.ts` (`HEADER`, `PRECEDENCE`) gains one sentence: "Project instructions take precedence over the user's personal instructions." No other change to project admission.
- R08 Context visibility: when `context.compilerV1` is on, request custody gets a source `{ id: 'personal-instructions', category: 'INSTRUCTION', contentRef: 'sha256:<digest>', inclusionReason: 'User personal instructions from Settings; lower precedence than project instructions' }` inserted after `host-guidance` and before `approved-project-instructions` (`packages/core/service.ts` around line 1701); `packages/core/host-context-projection.ts` adds the same source; the Context inspector shows a "Personal instructions" section (DESIGN §6.4).
- R09 Settings UI exactly as DESIGN §6, searchable by "personal instructions global AGENTS.md custom rules always every project".
- R10 Desktop "Open file" opens the file in the default editor (creating it empty first if absent) and "Show in folder" reveals it, through the existing desktop bridge if it has such calls (DISCOVERY X4); hidden in the browser build.
- R11 External edits: the Settings card re-reads the file when the Settings view gains focus or the window regains focus, and shows a "Changed on disk" notice with Reload when the loaded digest differs and the editor has unsaved edits (no silent overwrite).
- R12 Accessibility: labelled controls, live byte counter announced politely at 90% and over the limit, error text tied with `aria-describedby`, full keyboard use, Ctrl+S saves while the editor has focus, Esc in the editor does nothing special (Settings' own Esc behaviour is kept).

### Out of scope (v1)

- Importing or reading `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md` or other tools' personal files (possible later as an "Import" button; recorded so nobody adds silent cross-tool reading).
- Per-project overrides of personal instructions, multiple named instruction sets, or per-thread toggles.
- Includes, `@file` references, hooks (refused by R03, same as project files).
- Changing how project instructions are discovered or the `context.compilerV1` gate.
- Applying text to side questions and model-only helper calls.
- Syncing across machines.

### Decisions (DECIDED by planner)

- D1 **File in Gen's data folder, not `%USERPROFILE%`.** Options: (a) `~/.gen/AGENTS.md`; (b) `<dataDir>/personal-instructions/AGENTS.md`. Chose (b): it is inside storage already protected from grants (R01), follows the app's data location and per-machine profile, and keeps the agent from editing its own instructions. The pitch's "home-folder AGENTS.md" is met in spirit: a plain file the user can open and edit; "Show in folder" makes it findable.
- D2 **System prompt, not per-turn guidance.** Options: (a) prepend to the per-turn `guidance` user text; (b) carry on `StartRun` and append to the system prompt like `memory`. Chose (b): every runtime already builds its system prompt from `hostSystemPrompt(memory)` (`claude.ts:49`, `gemini.ts:64`, `cursor.ts:118`, `runtime-hermes/settings.ts:17`, `runtime-hermes/index.ts:284`), Hermes appends project text after it, so order "host, personal, project" falls out naturally and costs no tokens per turn.
- D3 **Not gated by `context.compilerV1`.** Personal instructions are host-owned text, not a grant-bound read, so they do not need the compiler's custody machinery; only the inspector/custody metadata (R08) depends on the flag.
- D4 **16 KiB limit.** Codex caps combined project docs at 32 KiB by default; project admission here allows 64 KiB of framed text. 16 KiB keeps personal text well below project budgets.
- D5 **Default on.** The switch only matters once text exists, and an empty file means nothing is sent.
- D6 **Settings section: Chat & Composer** (`['chat', 'Chat & Composer']` in `SETTINGS_SECTIONS`, `apps/web/src/Settings.tsx:32`), first row of that section, because it shapes what the agent says.

### Compatibility, performance, security, privacy

- Existing settings blobs without `personalInstructionsEnabled` read as `true` via `readPreferences` defaults; no migration.
- One small file read per main-thread run start when on; no read when off; no watcher process.
- The text is user-authored and private; it never leaves the machine except inside model requests the user starts; it is not logged (log digest and byte count only).
- Instructions cannot widen grants or tool authority; the framed block says so.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Path | What is there / what changes |
|---|---|
| `packages/core/approved-project-context.ts` | Project instruction admission: `FILENAMES`, `LIMITS` (64 KiB), `PRECEDENCE`, `HEADER`, `unsupportedDirective`, strict UTF-8 decode. Change: export `unsupportedDirective` (or a `isUnsupportedInstructionText` helper); add one precedence sentence (R07). |
| `packages/core/security.ts:6` | `PROTECTED_STORAGE_DIRECTORIES`; `assertNotStorage` (line 57) refuses grants into these. Change: add `'personal-instructions'`. |
| `packages/storage/store.ts:56` | `this.dataDir = realpathSync(dataDir)`. Read only. |
| new `packages/core/personal-instructions.ts` | Read/validate/write service (DESIGN §2). |
| `packages/contracts/index.ts:34` | `StartRun`. Change: add `personalInstructions?: { text: string; digest: string }`. |
| `packages/contracts/preferences.ts` | `preferencesSchema`, `DEFAULT_PREFERENCES`, `readPreferences`. Change: add `personalInstructionsEnabled`. |
| `packages/core/service.ts` | `settings.update` (line 1127); run start builds `input: StartRun` (around line 1677, `memory: taskMemoryContext(...)`); request custody sources (line 1701); compaction path (line 693). Change: capture personal instructions at run start (R05/R06), custody source (R08), new `instructions.personal.update` command. |
| `packages/runtime-pi/tool-definitions.ts:80` | `hostSystemPrompt(memory?)`; `createHostResourceLoader` (line 84) whose `getSystemPrompt` calls `hostSystemPrompt()` without memory (line 93). Change: new helper `withPersonalInstructions(systemPrompt, personal)` exported here, used by every builder. DISCOVERY X1: how Pi gets memory into its prompt, and where to pass personal text for Pi. |
| `packages/runtime-official/claude.ts:49`, `gemini.ts:64`, `cursor.ts:118`, `index.ts:108,194` | System prompt built from `hostSystemPrompt(context.memory)`; `context()` copies `snapshot.memory`. Change: pass `personalInstructions` through `context()` and wrap. |
| `packages/runtime-hermes/index.ts:284`, `settings.ts:17` | `projectContextSystemPrompt(input, captured.systemPrompt ?? hostSystemPrompt(input.memory))`. Change: personal block inserted between host prompt and project text. Follow-up (line 303) keeps captured value. |
| `packages/runtime/project-context.ts` | Appends project text to system prompt. Unchanged except it now receives the already-wrapped prompt. |
| `packages/core/host-context-projection.ts:18–19` | Adds `approved-project-instructions` and `thread-memory` sources. Change: add `personal-instructions` (R08). |
| `apps/server/shell-read-routes.ts:12` | Pattern for GET routes (`/api/shell/settings`). Change: add `GET /api/personal-instructions` (or in the route file that owns settings; DISCOVERY X2). |
| `apps/web/src/Settings.tsx` | `SETTINGS_SECTIONS`, `SETTINGS_ROWS`, `customRows`, `details(item)` switch, custom row rendering (line ~200). Change: new custom row `harness-personal-instructions` in `chat` rendering `<PersonalInstructionsCard/>`. |
| new `apps/web/src/PersonalInstructionsCard.tsx`, new `apps/web/src/personal-instructions.css` | The card (DESIGN §6–§7). |
| `apps/web/src/settings.css:19–26` | Row styles (`.settings-row`, 14px/600 headings, 13px muted copy, `var(--border)`, `var(--text)`, `var(--muted)`). Reused tokens. |
| `apps/web/src/ContextInspector.tsx:222` | "Approved project instructions" section. Change: add "Personal instructions" section above it. |
| `apps/web/src/settings-inventory.ts` | T3 inventory; has no personal-instructions row. Unchanged (the T3 list is pinned upstream text). |
| Tests: `tests/project-instructions-host.test.ts`, `tests/project-instructions-custody.test.ts`, `tests/preferences.test.ts`, `tests/settings-registry.test.ts`, `tests/settings-search-filter.test.ts`, `tests/settings-supported.test.ts`, `tests/hermes-runtime.test.ts`, `tests/runtime-request-helpers.test.ts`, `tests/e2e/usage-context.spec.ts` | Existing suites to extend or keep green. |

DISCOVERY items (resolve in T01, record answers in the T01 checkpoint):
- X1 Pi runtime: find how `input.memory` reaches the Pi system prompt (`packages/runtime-pi/worker.ts:64` passes `input.memory` to `createHostResourceLoader`, yet `getSystemPrompt` ignores it); add personal text on the same path that memory actually uses, or record that Pi has no system-prompt path and inject through the same mechanism as memory.
- X2 Exact error code for a stale save (search `HarnessError('` codes such as `INPUT_CHANGED`, `STALE_*` in `service.ts`) and the server file where commands and GET routes for settings are registered.
- X3 Whether `cursor.ts` / `claude.ts` re-send the system prompt on resume of an existing session; if a provider keeps the first system prompt for a resumed session, record that personal changes apply to new sessions for that provider and show that in the card's help text.
- X4 Desktop bridge calls to open a path and reveal it in Explorer (`apps/desktop`, `packages/desktop-contract`); if absent, add two narrowly scoped calls that only accept the personal instructions path.

## DESIGN

### 1. Data

```ts
// packages/contracts/index.ts (StartRun)
personalInstructions?: { text: string; digest: string }   // digest = sha256 hex of text

// packages/contracts/personal-instructions.ts (new)
export const PERSONAL_INSTRUCTIONS_MAX_BYTES = 16 * 1024;
export type PersonalInstructionsStatus = 'OK' | 'ABSENT' | 'EXCLUDED';
export type PersonalInstructionsExclusion = 'SOURCE_TOO_LARGE' | 'SOURCE_NOT_TEXT' | 'UNSUPPORTED_DIRECTIVE' | 'UNAVAILABLE_SOURCE';
export interface PersonalInstructionsView { text: string; digest: string | null; bytes: number; updatedAt: string | null;
  status: PersonalInstructionsStatus; reason?: PersonalInstructionsExclusion; path: string /* display only, desktop */ }
```

### 2. Host service `packages/core/personal-instructions.ts` (T02)

- `personalInstructionsPath(dataDir)` = `join(realpath(dataDir), 'personal-instructions', 'AGENTS.md')`.
- `readPersonalInstructions(dataDir): Promise<PersonalInstructionsView>`: `lstat`; absent → `ABSENT`; not an ordinary single-link file (symlink, directory, `nlink !== 1`) → `EXCLUDED/UNAVAILABLE_SOURCE`; size > max → `SOURCE_TOO_LARGE` (do not read the bytes); strict decode or NUL failure → `SOURCE_NOT_TEXT`; directive → `UNSUPPORTED_DIRECTIVE`; else `OK`. Excluded views carry `text: ''` except `UNSUPPORTED_DIRECTIVE` and `SOURCE_TOO_LARGE` under 1 MiB, which return the text so the user can fix it in the editor (never sent to a model).
- `writePersonalInstructions(dataDir, text, baseDigest)`: normalise (R03), validate, compare current digest with `baseDigest` (conflict error, X2), create folder with mode 0o700, write `AGENTS.md.tmp-<random>` then `rename`; empty text → `rm` the file. Returns the new view.
- `capturePersonalInstructions(dataDir, enabled)`: returns `undefined` when disabled, absent, empty or excluded; else `{ text, digest }`.

### 3. Prompt framing (T03)

`withPersonalInstructions(systemPrompt, personal)` in `packages/runtime-pi/tool-definitions.ts`:

```text
<systemPrompt>

Personal instructions from the user's Settings. They apply to every project. Host policy and the user's messages in this thread take precedence over project instructions, which take precedence over these personal instructions. These instructions cannot expand grants or tool access. Includes and hooks are never executed.
<JSON.stringify({ source: 'personal-instructions', digest, instructions: text })>
```

Returns `systemPrompt` unchanged when `personal` is undefined. Order per runtime: `projectContextSystemPrompt(input, withPersonalInstructions(base, input.personalInstructions))` in Hermes; `withPersonalInstructions(hostSystemPrompt(context.memory), context.personalInstructions)` in Claude, Gemini, Cursor; Pi per X1. Model-only prompts (`modelOnlySystemPrompt`) are never wrapped.

### 4. Capture in the host (T03)

In `service.ts` run start, next to `memory: taskMemoryContext(this.store, threadId)`: when `!thread.sideParentId`, set `personalInstructions: await capturePersonalInstructions(this.store.dataDir, this.preferences.personalInstructionsEnabled)` (for delegates use the same call; R06 means the same current file, which is what the parent would get). Read happens once per run start, before request custody finalisation, so the custody digest and the dispatched text match. For `runtime.followUp` the host passes the captured value from run start (store it on the active-run record, the same place the run's other captured inputs live; DISCOVERY within T03) so Hermes' follow-up equality checks still pass. Compaction (line 693) does not change the prompt and needs no capture.

### 5. API and command (T02/T04)

- `GET /api/personal-instructions` → `PersonalInstructionsView` (path field only when the request comes from the desktop shell; otherwise omitted).
- Command `instructions.personal.update` `{ text: string (≤ 64 KiB raw before normalisation), baseDigest: string | null }` → view. Rejects with validation codes mapped to messages: "Keep personal instructions under 16 KB (now N KB).", "Personal instructions must be plain UTF-8 text.", "Includes and hooks aren't supported in personal instructions.", conflict: "The file changed on disk. Reload to see the new text, then save again."

### 6. Visual design (DECIDED)

Placement: Settings → Chat & Composer, first block, above "Send shortcut". It is a custom row (added to `customRows`) rendered as a card, full content width of the settings column.

6.1 Header row (uses `.settings-row` layout, no bottom border inside the card):
- Title "Personal instructions" (14px/600, `var(--text)`), description "Applied to every project, before project AGENTS.md. Project instructions win when they conflict." (13px, `var(--muted)`, max 60ch).
- Right: the existing switch (`button.settings-switch`, `role="switch"`, `aria-label="Use personal instructions"`) bound to `personalInstructionsEnabled`.

6.2 Editor:
- `<textarea>` id `personal-instructions-editor`, `aria-label="Personal instructions"`, placeholder "e.g. Answer in British English. Prefer pnpm. Ask before committing.", monospace via the code font variable used by code blocks (reuse the variable `settings.css`/`markdown.css` use for code; DISCOVERY inside T04), 13px, line-height 1.55, padding 10px 12px, min-height 168px (≈ 8 lines), max-height 420px then internal scroll, `resize: vertical`, width 100%, radius = control radius token, 1px `var(--border)` border, background the input background token used by Settings inputs.
- Focus: 2px focus ring using the app's focus ring token (same as other Settings inputs; do not invent a colour).
- When the switch is off: editor stays editable, opacity .72 on the editor only, and a 12px muted line under it: "Off. Saved text is kept but not sent."

6.3 Footer row (flex, space-between, 8px top margin):
- Left: byte counter "1.2 KB of 16 KB" (12px, tabular numerals, `var(--muted)`); at ≥ 90% it uses the warning text token; over the limit it uses the danger text token and reads "18.4 KB of 16 KB · too long".
- Right, in order: (desktop only) ghost buttons "Open file" and "Show in folder"; then "Revert" (secondary, disabled when clean) and "Save" (primary, disabled when clean, over limit or saving; label "Saving…" while pending). Buttons use the existing button primitives from `packages/ui-shell` used elsewhere in Settings.
- Status line under the footer (12px): "Saved" with a check icon (lucide `Check`, 14px) after success; error text in danger token with `role="alert"` on failure; "Changed on disk." + link-style "Reload" button when R11 triggers.
- Excluded file (status `EXCLUDED`): a 12px danger line above the editor: "Not applied: <reason in words>. Fix the text and save."

6.4 Context inspector: new `<section aria-label="Personal instructions">` above "Approved project instructions", one line "Personal instructions · 1.2 KB · sha256 3f9a…c21b (first 4 and last 4 hex)" using the same `.context-categories-note` styles as the project section.

6.5 Layout limits: at settings column widths below 520px the footer wraps: counter on its own line, buttons right-aligned below. No horizontal scroll at 320px. Light, dark and high-contrast themes use tokens only (no literal colours).

### 7. Animation (DECIDED)

- "Saved" status: fades in over 160ms (opacity 0→1, translateY 2px→0, `ease-out`), stays 2s, fades out over 200ms. Uses the app motion duration variables so `prefers-reduced-motion`, Settings motion "reduced"/"off" and `motionSpeed` apply; with reduced/off it appears and disappears without transition.
- Counter colour change: 120ms colour transition (none when reduced).
- Off-state opacity change on the editor: 160ms opacity transition (none when reduced).
- "Changed on disk" notice: same fade as "Saved", no auto-hide.
- No layout animation of the textarea height; nothing loops.

### 8. Error, cancel, rollback

- Read failure at run start → treat as absent for that run, log digest-free warning "personal instructions unavailable: <reason>", never block the run.
- Save is atomic; a crash leaves either old or new file (temp files with the `.tmp-` prefix are deleted on next save).
- Rollback: switching off stops sending immediately for new runs; reverting the PR leaves an inert file in storage (documented in T07).

## EXECUTION_DAG

Ownership boundaries: T02 owns `packages/core/personal-instructions.ts`, `packages/contracts/personal-instructions.ts`, `security.ts` line, `approved-project-context.ts` export; T03 owns runtime adapters, `StartRun`, `service.ts` run-start capture and custody source, `host-context-projection.ts`; T04 owns server route/command registration and preferences; T05 owns web files. T03, T04 depend on T02; T05 depends on T04; T06 on T03+T05; T07 last.

### T01 — Verify assumptions and resolve DISCOVERY X1–X4
- Goal: confirm every REPO_MAP fact at current main, answer X1–X4.
- Deps: none. Steps: rebase on main; re-read the listed lines; grep as described in X1–X4; post a checkpoint with answers.
- Tests: none (read-only). Done when: checkpoint lists each X answer with file:line. Handoff: T02 worker.

### T02 — Storage service, validation, protection
- Goal: DESIGN §1–§2, R01, R03.
- Deps: T01. Edits: new `packages/core/personal-instructions.ts`, new `packages/contracts/personal-instructions.ts`, export directive check from `approved-project-context.ts`, add `'personal-instructions'` to `PROTECTED_STORAGE_DIRECTORIES`.
- Tests (new `tests/personal-instructions.test.ts`): positive: write then read round-trip, CRLF→LF, trim, empty deletes file, digest stable; negative: >16 KiB refused, invalid UTF-8, NUL, `!include`/`@./x`/`pre_tool_hook:` refused, symlink file excluded `UNAVAILABLE_SOURCE`, stale `baseDigest` conflict, `resolveGrant` / `assertNotStorage` refuses a grant whose root or path is the personal folder.
- Done when: tests pass, `pnpm typecheck` passes. Handoff: T03, T04.

### T03 — Capture and inject into every runtime
- Goal: R05–R08, DESIGN §3–§4.
- Deps: T02. Edits: `StartRun` field; `withPersonalInstructions` in `tool-definitions.ts`; Claude, Gemini, Cursor, Hermes (start, settings, follow-up), Pi per X1; `service.ts` capture + custody source; `host-context-projection.ts`; precedence sentence in `approved-project-context.ts`.
- Tests: extend `tests/runtime-request-helpers.test.ts` (wrap order and no-op), `tests/hermes-runtime.test.ts` (system prompt = host + personal + project; follow-up keeps captured digest), `tests/project-instructions-host.test.ts` (custody source order host-guidance, personal-instructions, approved-project-instructions; flag-off path still injects personal but no custody source), a service test that side threads and model-only purposes get no block and that disabled preference does not read the file (spy on fs).
- Done when: those pass plus existing project-instructions suites. Handoff: T06.

### T04 — Preference, route and command
- Goal: R02, R04, DESIGN §5.
- Deps: T02. Edits: `preferences.ts` (schema + default), server GET route and `instructions.personal.update` command (location per X2), command type in contracts.
- Tests: `tests/preferences.test.ts` default true and round-trip; server/service test for GET shapes (ABSENT, OK, EXCLUDED) and update errors.
- Done when: tests pass. Handoff: T05.

### T05 — Settings card, inspector section, visual design and animation
- Goal: R09–R12, DESIGN §6–§7.
- Deps: T04 (and T03 for the inspector data). Edits: `Settings.tsx` (row `harness-personal-instructions` in `chat`, search terms from R09, `customRows`, render), new `PersonalInstructionsCard.tsx` + `personal-instructions.css`, `ContextInspector.tsx` section, desktop bridge calls per X4.
- Tests: component tests for counter thresholds, Save/Revert enablement, Ctrl+S, conflict notice, excluded banner; `tests/settings-registry.test.ts`, `settings-search-filter.test.ts`, `settings-supported.test.ts` updated for the new row; `pnpm test:ui-guard` and `pnpm lint` clean.
- Done when: tests pass and screenshots in light, dark, high contrast at 1280px and 360px wide are attached to the PR.

### T06 — Browser coverage
- Goal: end-to-end proof of success criteria 1–3.
- Deps: T03, T05. Edits: new Playwright spec under `tests/e2e/` (follow `usage-context.spec.ts` fixture patterns): save text, start runs in two projects with the fixture runtime, assert the captured system prompt (fixture hook) contains the block in both; switch off → next run lacks it; oversize text shows the error and Save is disabled; inspector shows the entry with `context.compilerV1` enabled in the fixture.
- Done when: `pnpm test:e2e` passes for the new spec and existing usage-context spec.

### T07 — Docs, PR and front end team review
- Goal: document and hand off.
- Deps: T01–T06. Edits: short user section in `docs/getting-started.md` (or the doc that covers Settings; find with grep) describing the box, file location, precedence and limits; add new docs to `scripts/public-source-files.json` if required by the docs link check.
- Steps: open the implementation PR linked to this issue; post the final checkpoint; **send the finished work to the front end team for review** (link the PR and the T05 screenshots, ask them to review visual design and animation against DESIGN §6–§7); record their verdict on this issue; then RELEASE.
- Done when: PR open with green CI, front end team review recorded on this issue.

## VALIDATION

### Commands (planned; none executed by this planning session)

```bash
pnpm install
pnpm typecheck
pnpm vitest run tests/personal-instructions.test.ts tests/project-instructions-host.test.ts tests/project-instructions-custody.test.ts tests/runtime-request-helpers.test.ts tests/hermes-runtime.test.ts tests/preferences.test.ts tests/settings-registry.test.ts tests/settings-search-filter.test.ts tests/settings-supported.test.ts
pnpm test:ui-guard
pnpm lint
pnpm check:docs-links
pnpm test:e2e   # new spec + tests/e2e/usage-context.spec.ts
```

Real-user check (Windows desktop build): save "Always end replies with the word OK." in Settings, start threads in two different projects, confirm both replies follow it; add a project `AGENTS.md` saying "Never end replies with OK." and confirm the project rule wins; switch off and confirm the next run ignores the text.

### Acceptance matrix

| Req | Task | Check |
|---|---|---|
| R01 | T02 | file path test; `assertNotStorage` negative test |
| R02 | T04 | preferences default/round-trip test |
| R03 | T02 | validation tests (size, UTF-8, NUL, directives, normalisation) |
| R04 | T02, T04 | GET shapes and update/conflict tests |
| R05 | T03 | runtime wrap tests; follow-up keeps captured value; flag-off injection |
| R06 | T03 | side thread gets nothing; delegate gets block |
| R07 | T03 | framed text and project header sentence asserted |
| R08 | T03, T05 | custody source order test; inspector section test; e2e |
| R09 | T05 | settings registry/search tests |
| R10 | T05 | desktop bridge call test (X4) |
| R11 | T05 | conflict notice component test |
| R12 | T05 | a11y assertions (labels, aria-describedby, live counter), keyboard test |
| Visual/animation §6–§7 | T05, T07 | screenshots + reduced-motion check + front end team review |
| Success 1–3 | T06 | e2e spec |

Release gate: all listed commands green, real-user check recorded on the issue, front end team review recorded.

## STATE

- Researched and decided: everything in this plan (r1).
- Implemented: nothing. Verified: nothing. No branches or owners yet.
- Risks: a provider that ignores system prompt changes on resume (X3); Pi prompt path unknown (X1); users pasting secrets into personal instructions (mitigated: stays local, never logged, help text says it is sent to the model with every run).
- Next step: an implementing worker claims T01 on this issue per AGENTS.md and posts the X1–X4 answers.

## REFERENCES

- Codex AGENTS.md guide: https://learn.chatgpt.com/docs/agent-configuration/agents-md.md — Codex reads a global file from its home folder (`~/.codex/AGENTS.md`, or an override file) and then project files from the repository root down to the working folder, concatenated in that order so later, more specific files take precedence; combined size is capped by a configurable byte limit (32 KiB default).
- "Codex rules for AI" write-up: https://kirill-markin.com/articles/codex-rules-for-ai/ — practical example of keeping personal rules in the global `AGENTS.md` and project specifics in repository files.
- Repository: `packages/core/approved-project-context.ts`, `packages/core/security.ts`, `packages/runtime-pi/tool-definitions.ts`, `packages/runtime-hermes/index.ts`, `packages/runtime-official/claude.ts`, `apps/web/src/Settings.tsx`, `apps/web/src/ContextInspector.tsx` at `e883ac0327c834120d89c3697dec7380a342ba4d`.
