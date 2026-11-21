# Plan: Project model and reasoning defaults

## META

| Field | Value |
|---|---|
| Feature | Each project can set a default model and reasoning level that new threads in that project start with; an explicit choice in the composer still overrides it for that thread |
| Size | medium (labels `feature`, `medium`); no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue (number assigned at creation; the plan file link at the top of the body is SHA-pinned) |
| Plan file | `docs/agent-plans/project-model-defaults.md` (identical to the issue body below the file link) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified with `git ls-remote origin refs/heads/main` on 2026-11-21) |
| Related work | No issue or PR for per-project model or reasoning defaults (searched issues and PRs, open and closed, for "project default model", "reasoning default", "Project model", and PR titles with "default model" / "reasoning"). Related, merged: [#15 compact model picker with reasoning footer](https://github.com/skytuhua-org/Gen-V1/pull/15), [#137 picker, provider rail, favorites, reasoning](https://github.com/skytuhua-org/Gen-V1/pull/137), [#344 reasoning picker in Research QA](https://github.com/skytuhua-org/Gen-V1/pull/344). Related, open: [#1135 model picker popover overlaps sidebar](https://github.com/skytuhua-org/Gen-V1/issues/1135), [PR #1199 shared popover/menu motion contract](https://github.com/skytuhua-org/Gen-V1/pull/1199). `docs/progress.md` M11 mentions `models.newTaskProfilesV1` (off, approved profile mapping absent, not verified); it is not a per-project model default and this plan does not depend on it. |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Researched feature proposal batch 6, item 5: "Project model and reasoning defaults (Medium): Set a default model and reasoning level for new threads in each project while keeping the composer's per-thread override." Scope check from the proposal: "Gen has a global new-conversation default, model favorites, and an account/model binding for established threads. Store the project override in Gen, not in executable or checked-in repo settings; an explicit composer choice wins for that new thread. Validate against the currently selected account's eligible catalog, visibly ask for a choice when invalid, and do not change existing bindings or silently switch accounts." Sources: [openai/codex#36163](https://github.com/openai/codex/issues/36163), [Claude Code settings](https://code.claude.com/docs/en/settings), [Claude Code settings reference](https://code.claude.com/docs/en/settings-reference). The repository owner (Leonardo) asked on 2026-11-21 that researched features be filed directly as plan issues with a detailed .md, with no approval step, and delegated every other decision. Repository facts were read at the baseline SHA. Decisions marked **DECIDED** were made by the planner. |

**Design and animation ownership.** There is no separate front end team designing this feature: **this plan specifies the visual design and animation** (DESIGN §6–§7), and implementers build exactly that. Leonardo asked that the finished work then be **sent to the front end team for review**: task T08 does that, and the issue is not complete until their review is recorded.

## OBJECTIVE

**User problem.** People work in several projects with different needs: a large refactor repository where they always want the strongest model on high reasoning, and a docs repository where a fast model on low reasoning is enough. Gen V1 has one global "Default model" (Settings → Providers, "New conversations only.") and no saved reasoning default at all; the reasoning choice lives only in the composer's local journal (`thinking:<owner>`). Worse, choosing a model in the main composer also rewrites the global default (`updateModel` in `apps/web/src/App.tsx:856` calls `settings.update({modelId})`), so switching between projects means re-picking model and reasoning on almost every new thread. Codex users asked for exactly this ([openai/codex#36163](https://github.com/openai/codex/issues/36163)): project `model` and `model_reasoning_effort` as defaults for new tasks, with the composer picker as a per-task override that must not snap back and must not rewrite the project setting. Claude Code resolves `model` / `effortLevel` per scope (user < project < local < command line) and treats a lower-level model value as a starting default, not a lock.

**Intended behavior.**
1. The project context card (right panel, `ProjectContextCard`) gets a **New thread defaults** row. Opening it shows a Model select and a Reasoning select filled from the current new-task catalog, plus Save and "Use global default".
2. Saved values are stored in Gen's own settings (`settings/global` preferences, keyed by project identity like project colors), never in the repository or any executable file.
3. A new, still unsent thread in that project (or a new thread created by picking that project) starts with the project's model and reasoning when the model is in the eligible catalog for the currently selected accounts. The composer picker shows that the value came from the project.
4. If the user picks another model or reasoning in the composer for that thread, that choice wins for that thread, is not reverted, and changes neither the project default nor the global default.
5. If the project's saved model is not eligible with the currently selected accounts (signed out, other account selected, model withdrawn), the composer does **not** silently fall back: it shows an inline notice asking the user to choose a model, and Send stays disabled until they do. Gen never switches the selected account.
6. Established threads (bound account/model after first send) are never changed by project defaults.

**Measurable success.**
1. With project A default = model X / "high" and project B default = model Y / "Model default", a new thread in A shows X + High and its first send carries `modelId: X, thinkingLevel: 'high'`; a new thread in B carries `modelId: Y, thinkingLevel: null` (unit T03, browser T07).
2. Choosing model Z in the composer of a new A thread sends Z, does not change `preferences.projectModelDefaults` and does not change `settings.modelId` (unit T03/T05, browser T07).
3. With A's model X not in the eligible catalog, the composer shows the notice, the model trigger shows "Choose a model", Send is disabled, and `selectedAccounts` is unchanged (browser T07).
4. An established thread in A keeps its bound model after A's default changes (browser T07).
5. Projects without a default behave exactly as today, including the main composer writing the global default (regression tests in T05/T07).

## REQUIREMENTS

### In scope

- R01 Storage: new preference `projectModelDefaults: Record<projectKey, { modelId: string; thinkingLevel: string | null }>` in `packages/contracts/preferences.ts` (`preferencesSchema`, `DEFAULT_PREFERENCES` = `{}`, copied in the defaults-clone code next to `projectColors` at line 88). Keys use the same exact-identity format and validator as `projectColors` (`projectColorKey` in `apps/web/src/project-colors.ts:6`, contract refine at `preferences.ts:19`); export that key schema under a neutral name (`projectIdentityKeySchema`) and reuse it, do not copy it. `modelId` 1–200 chars (same bound as `settings.modelId` in `settings.update`), `thinkingLevel` null or 1–40 chars matching `/^[a-z0-9_-]+$/i`. At most 200 entries. Saved through the existing `settings.update` command with `{ preferences: { projectModelDefaults } }`; no new route.
- R02 Only local-authority and plugin-authority project identities already accepted by the key validator are allowed. Nothing is written to the project folder, `.gen`, `AGENTS.md`, or any file the agent can read or execute.
- R03 Resolution for an **unbound** thread or draft (`hasPinnedAccount` false, `App.tsx:114`) with a `projectId`, applied in this order (DESIGN §3): explicit composer choice for this owner > project default (when eligible) > global `settings.modelId` (when eligible) > first advertised model (existing behaviour). Reasoning: explicit composer choice (existing `thinkingEdited` ref / journal value written by `chooseThinking`) > project default `thinkingLevel` when the resolved model advertises it > `''` ("Default").
- R04 Explicit choice provenance: the main composer, the canvas composer (`CanvasThread`, `App.tsx:463–478`) and `ScopedConversationComposer` record a per-owner "explicit model choice" flag when the user picks a model in the picker (not when the resolver sets one). Stored in the journal under `modelChoice:<owner>` (value: chosen model id) and migrated with the draft in `migrateDraft` (`App.tsx:334–339`) like `thinking:<owner>`.
- R05 Global default write: when the active owner's project has a project default, a composer model pick does **not** call `settings.update({modelId})`; it only sets the thread's local model state and R04 flag. When there is no project default for the owner's project (or no project), behaviour is unchanged (the pick still writes the global default). **DECIDED** to keep today's global write in that case to avoid a regression for users who rely on it.
- R06 Eligibility: a project default is eligible only when `modelId` is in the catalog the composer already loads for the unbound owner (`loadModels`, `App.tsx:663–714`, which uses the selected accounts). A reasoning value is used only when the resolved model's `thinkingLevels` contains it; otherwise reasoning falls back to `''` and the composer shows the reasoning notice (DESIGN §6.3).
- R07 Invalid default: when the project default model is not eligible, resolution returns `{ modelId: '', source: 'project-unavailable' }` (no silent fallback to the global default or first model). The existing `unavailable` check (`App.tsx:308`, `!models.some(model => model.id === modelId)`) then blocks sending; T01 verifies that `unavailable` disables Send (DISCOVERY X1). The notice offers "Choose model" (opens the picker) and "Edit project defaults" (opens the project card row).
- R08 Never touches accounts or bindings: no code path in this feature calls `account.select`, writes `selectedAccounts`, or changes `thread.accountId` / `thread.modelId` of a thread for which `hasPinnedAccount` is true. Server side, `message.send` keeps validating the model against the bound/selected catalog (`packages/core/service.ts:1496–1508`, `MODEL_UNAVAILABLE`), which stays the final guard.
- R09 Project change before first send: when an untouched thread is moved to another project (`pickProject` → `workspace.project.connect` with `threadId`, `App.tsx:572–585`) or a new thread is created by picking a project, the resolver re-runs for the new project unless R04's explicit flag is set.
- R10 Project card editor (DESIGN §6.1–§6.2): Model select from the unbound new-task catalog (same fetch as Settings' `loadNewTaskModels`, `apps/web/src/Settings.tsx:109–123`), Reasoning select from the selected model's `thinkingLevels` plus "Model default", Save, "Use global default" (deletes the entry). Saved value that is not in the current catalog stays visible as "<model id> (unavailable)" and can be changed or removed.
- R11 Settings search and copy: `settings-inventory.ts` row `default-model` description becomes "New conversations only. Projects can set their own default in the project panel." and a new row `project-model-defaults` (section `projects`, title "Project model defaults", terms "model reasoning effort default per project new thread") whose target opens a short explanatory row in Settings → Projects with a list of projects that have a default (name, model, reasoning, "Remove" button). Editing is done only from the project card (one editor; **DECIDED**).
- R12 Accessibility: labelled selects (`aria-label="Default model for <project>"`, "Default reasoning for <project>"), status text for save in a polite live region, notice in the composer with `role="status"` (not `alert`; it is not an error the user caused), keyboard only operation, focus returns to the row button after Save/Close.
- R13 Pruning: on save from the project card, entries whose key does not match any project in the current workspace envelope (`GET /api/workspace`) are dropped in the same write; a project rename does not change its key (keys use ids).

### Out of scope (v1)

- Reading `.codex/config.toml`, `.claude/settings.json` or any repository file for defaults (rejected: the proposal requires Gen-side storage and no executable or checked-in settings).
- Locking a project to a model (Codex's "authoritative" mode), allow/deny model lists, or per-project account selection.
- A saved global reasoning default (separate feature; this plan only adds project-level reasoning).
- Changing models of established threads, side threads (`sideParentId`), delegates, prediction, title or memory model purposes.
- Server-side default resolution on `thread.create` (the client resolves; the server only validates on send). Recorded so nobody adds a second resolver.
- Syncing defaults across machines.

### Decisions (DECIDED by planner)

- D1 Storage in preferences keyed by project identity (like `projectColors`), not a new SQLite table or project entity field: `projectSummarySchema` in `packages/contracts/workspace.ts:54–58` is strict and shared by many readers; preferences already round-trip through `settings.update` with validation (`packages/core/service.ts:1127–1135`). Rejected: new `/api/projects/:projectId/actions` action (more surface, same result).
- D2 Client-side resolution in one pure function `resolveNewThreadModel` (new `apps/web/src/project-model-defaults.ts`) used by all three composer paths, so the paths cannot drift.
- D3 Invalid project default blocks sending with a visible ask instead of falling back (proposal requirement "visibly ask for a choice when invalid").
- D4 Explicit pick in a project with a default does not write the global default (R05); without a project default, the existing write stays.
- D5 Editor lives in the project card only; Settings lists and removes (R11).

### Compatibility, performance, security, privacy

- Old builds reading a newer preferences blob: `preferencesSchema` is strict; T01 confirms how `getPreferences` treats unknown keys from a newer build (DISCOVERY X2, see `tests/settings-supported.test.ts:20–30` "supported preference migrations preserving future-owned values"). The feature must follow whatever mechanism that test covers for future-owned keys.
- No extra network calls in the composer: the resolver uses the catalog and snapshot already loaded. The project card editor fetches the new-task catalog only when the row is opened.
- Model ids are not secrets but are user configuration; they stay in local storage and are not sent to models or logs. `tests/shell-settings-bootstrap.test.ts:12–20` ("no private model id leak") must keep passing: the new map must not be added to the shell bootstrap payload unless that test's rules allow it (T02 checks).
- Reduced motion and "off" motion settings apply to every animation in DESIGN §7.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Area | File / identifier | Fact |
|---|---|---|
| Model contract | `packages/contracts/index.ts:2` `ModelInfo` | `{ id, provider, name, thinkingLevels?: string[] }`; `thinkingLevels` is the source of valid reasoning values. |
| Settings contract | `packages/contracts/index.ts:23` `Snapshot.settings` | `theme`, `modelId: string \| null`, `selectedAccounts?`, `preferences?`. No reasoning default. |
| Thread / run | `packages/contracts/index.ts:3` `Thread`, `:34` `StartRun` | `thinkingLevel?: string \| null`, nullable `modelId`, optional nullable `accountId`. |
| Preferences | `packages/contracts/preferences.ts:19` key refine, `:52` `projectColors` (≤200), `:67` defaults, `:88` defaults clone | Pattern to copy for `projectModelDefaults`. |
| Settings write | `packages/core/service.ts:1127–1135` `settings.update` | Merges `theme`, `modelId`, `preferences` into `settings/global`; invalid preferences → `INVALID_INPUT`. Does not validate catalog membership. |
| Storage | `packages/storage/store.ts:54–72`, `:145` | `harness.sqlite` generic JSON entities; settings at kind `settings`, id `global`. |
| Settings UI | `apps/web/src/Settings.tsx:66` row `default-model`, `:109–123` `loadNewTaskModels`, `:140–146` `persist`, `:190–191` saving/saved status | Unbound catalog fetch and save-status pattern to reuse. |
| Settings inventory | `apps/web/src/settings-inventory.ts:14` (default-model terms), `SETTINGS_ROWS` | Add row `project-model-defaults`. |
| Composer (main) | `apps/web/src/App.tsx:256–273` `Composer` (keyed `thread?.id ?? 'new'`), `:308` `unavailable`, `:309` clear unsupported reasoning, `:334–339` `migrateDraft`, `:368–382` send, `:445` toolbar wiring and scope hint | Reasoning provenance via `thinkingEdited` ref + `journalRead('thinking:'+key)`; no model-choice provenance. |
| Model loading | `apps/web/src/App.tsx:650–714` `modelThread`, `modelBinding`, `loadModels`, `acceptedModel`, owner-change effect | Unbound preference: owner model, then global, then first advertised. Insert project default here (T03). |
| Global write | `apps/web/src/App.tsx:856` `updateModel`, `:1186` main composer wiring | Composer pick writes `settings.modelId`. |
| Canvas composer | `apps/web/src/App.tsx:463–478` `CanvasThread` | Own model state, plain `setModelId` (no global write). |
| Scoped composer | `apps/web/src/ScopedConversationComposer.tsx:20–37,53–54` | Initial `context.owner.modelId`; catalog reconcile. |
| Side composer | `apps/web/src/App.tsx:456–461` `SideThreadComposer` | Out of scope (inherits parent). |
| Picker | `apps/web/src/ModelPicker.tsx:9–15` props, `:25–46` selection/reasoning, `:50–51` choose, `:87` trigger; `ComposerToolbar.tsx:8–15,48,83` | Controlled view; add an optional `source` prop for the provenance caption. |
| Favorites | `apps/web/src/ModelPicker.tsx:19–23` `harness:model-favorites:v1` | Orthogonal; must not change. |
| Journal | `apps/web/src/journal.ts:117–160` | IndexedDB `generative-harness-journal`; `journalRead`, `journalWrite`, `journalCompareAndSwap`. |
| Project picking | `apps/web/src/App.tsx:572–585` `pickProject`, `:763–784` `createThread`/`ensureThread` | Creates or re-associates unbound thread with a project. |
| Project colors | `apps/web/src/App.tsx:588–593` `saveProjectColor`; `apps/web/src/project-colors.ts:6` `projectColorKey`; `AppearanceSettings.tsx:88–89` | Read-modify-write pattern for a keyed preference map. |
| Project card | `apps/web/src/ProjectContextSurface.tsx` (`ProjectContextCard` keyed by thread/project), `apps/web/src/ProjectContextCard.tsx:23–38` (`expanded` state, `run`, busy/error), `apps/web/src/project-context.css` (`.project-context-row`, `.project-context-detail`, `.project-plan-expansion` grid-rows transition) | Place the new row and its expanding form here. |
| Accounts | `packages/core/accounts.ts:80–83` `account.select`; `packages/core/service.ts:537–551` `binding`/`assertBinding`, `:852–885` `models` | Selection is per provider; bound threads keep account. |
| Send guard | `packages/core/service.ts:1496–1508` | `MODEL_UNAVAILABLE`, invalid effort `INVALID_INPUT`. |
| Tokens | `packages/ui-shell/tokens.css:1–40,52–70`; `apps/web/src/styles.css:3–22`; `apps/web/src/settings.css:19–27,84–85,98`; `apps/web/src/motion-policy.ts`; `appearance.css:17–18` | Spacing, focus ring, `--ui-ease-enter`, hover 120ms, popup enter/exit 180/140ms, `data-motion` off/reduced. |
| Select / Toast | `packages/ui-shell/Select.tsx:7–23`, `packages/ui-shell/Toast.tsx` | Use `Select`; no toast (inline status like Settings). |
| Tests | `tests/thinking-level.test.ts`, `tests/accounts.test.ts`, `tests/model-discovery.test.ts`, `tests/settings-supported.test.ts`, `tests/settings-registry.test.ts`, `tests/shell-settings-bootstrap.test.ts`, `tests/project-color-preferences.test.ts`; e2e `compact-model-picker.spec.ts`, `model-composer-refinement.spec.ts`, `subscription-accounts.spec.ts`, `compact-settings.spec.ts`, `model-picker.spec.ts`, `composer-motion.spec.ts` | Existing coverage to extend; browser suites in `scripts/browser-suites.ts:26,53,59,62`. |
| DISCOVERY X1 | `App.tsx` send button | Confirm `unavailable` disables Send for the main, canvas and scoped composers. |
| DISCOVERY X2 | `getPreferences` / `mergePreferences` | How a strict schema treats unknown future keys (see settings-supported test). |
| DISCOVERY X3 | `ScopedConversationComposer` owner | Whether it can host an unbound project thread; if not, it only needs R04 recording. |
| DISCOVERY X4 | Settings Projects section render | Where `project-overview` row renders, to place the R11 list. |

## DESIGN

### 1. Data

```ts
// packages/contracts/preferences.ts
export const projectIdentityKeySchema = /* existing projectColorKey refine, renamed and exported */;
export const projectModelDefaultSchema = z.strictObject({
  modelId: z.string().min(1).max(200),
  thinkingLevel: z.string().regex(/^[a-z0-9_-]+$/i).min(1).max(40).nullable(),
});
// in preferencesSchema:
projectModelDefaults: z.record(projectIdentityKeySchema, projectModelDefaultSchema)
  .refine(value => Object.keys(value).length <= 200, 'Keep at most 200 project model defaults.'),
// DEFAULT_PREFERENCES.projectModelDefaults = {}
```

`projectColors` keeps using the same key schema (rename only, behaviour identical).

### 2. Resolver (`apps/web/src/project-model-defaults.ts`, T03)

```ts
export type ModelSource = 'explicit' | 'project' | 'project-unavailable' | 'global' | 'first' | 'bound';
export interface ResolvedModel { modelId: string; thinkingLevel: string; source: ModelSource; reasoningDropped: boolean }
export function resolveNewThreadModel(input: {
  bound: boolean; boundModelId?: string | null;      // hasPinnedAccount + thread.modelId
  explicitModelId?: string | null;                   // journal modelChoice:<owner>
  explicitThinking?: string | null;                  // journal thinking:<owner> when thinkingEdited
  project?: { modelId: string; thinkingLevel: string | null } | null;
  globalModelId?: string | null;
  catalog: ModelInfo[];
}): ResolvedModel
```

Rules:
1. `bound` → `{ modelId: boundModelId ?? '', source: 'bound' }` (unchanged path; resolver must not alter it).
2. `explicitModelId` in catalog → explicit; thinking = explicitThinking when advertised, else `''`.
3. `project` set: in catalog → `source: 'project'`, thinking = explicitThinking ?? project.thinkingLevel when advertised, else `''` with `reasoningDropped: true`; not in catalog → `{ modelId: '', thinkingLevel: '', source: 'project-unavailable' }`.
4. Else global in catalog → `global`; else first advertised → `first`; empty catalog → `{ modelId: '', source: 'first' }`.

Pure, no I/O, unit-tested exhaustively.

### 3. Wiring (T04, T05)

- `loadModels` (main): for an unbound owner, read the owner's project key from the thread (`projectId` + authority from the workspace envelope or project context), look up `preferences.projectModelDefaults`, read `modelChoice:<owner>` once, call the resolver, set `modelId` and pass `source` down. The existing `acceptedModel` effect that follows global changes must skip owners whose source is `project`, `project-unavailable` or `explicit`.
- Composer reasoning: when resolver source is `project` and `thinkingEdited.current` is false, set `thinkingLevel` from the resolver **after** the journal read resolves (journal value wins only if it was an explicit edit; T04 changes `chooseThinking` to write `{ level, explicit: true }`, or a separate key `thinkingExplicit:<owner>`; pick one in T01 and record it).
- Picker `onModelChange` (App.tsx:445): write `modelChoice:<owner>`; then call `setModelId`. Main composer passes a setter that skips the global write when the owner's project has a default (R05).
- `migrateDraft`: also copy `modelChoice:new` → `modelChoice:<threadId>` and delete the source key.
- Project change (R09): `ProjectContextCard` key already changes with `[thread.id, thread.projectId]`; the model owner effect (`App.tsx:707–714`) must also re-run on `thread.projectId` change for unbound owners.
- Canvas and scoped composers call the same resolver with their own catalogs.

### 4. Project card editor (T06)

- `ProjectContextCard` gets new optional props: `modelDefault?: { modelId: string; thinkingLevel: string | null } | null`, `onSaveModelDefault?: (value | null) => Promise<void>`, `loadDefaultCatalog?: (signal: AbortSignal) => Promise<ModelInfo[]>`. `ProjectContextSurface` supplies them from preferences and a save function modelled on `saveProjectColor` (read snapshot, `mergePreferences`, prune per R13, `settings.update`, `refresh`).
- Shown only for local-authority projects with a connected context (`connected` true) on main threads (same condition as `memoryTarget` in `ProjectContextSurface`).
- Save concurrency: read-modify-write from a fresh `getSnapshot()` immediately before writing (same as `saveProjectColor`); last write wins (acceptable for a single-user preference, as for colors).

### 5. Errors and recovery

- Catalog fetch fails in the editor → selects disabled, inline danger text "Couldn't load models. Try again." with a Retry button; saved value still shown.
- Save fails → inline danger text with the error message; form keeps the edited values.
- Corrupt journal values (`modelChoice:*` not a string) → treated as absent.
- Rollback: removing the preference key (or reverting the PR) restores today's behaviour; stored entries are ignored by older code if X2 confirms tolerance, otherwise T02 adds the key to the future-owned list.

### 6. Visual design (DECIDED)

6.1 Project card row (in the overview section, after the branch/Changes rows, before scripts):
- `button.project-context-row` with lucide `SlidersHorizontal` 16px icon, label "New thread defaults", right-aligned `<small>` summary: "<model name> · <Reasoning label>" (e.g. "GPT-5.6 · High"), "Global default" when unset, or "<model id> · unavailable" in `var(--danger)` when the saved model is not in the catalog. `ChevronDown` 13px like the branch row; `aria-expanded`.
- Summary text truncates with ellipsis; full text in `title`.

6.2 Expanded form (`.project-context-detail`, same spacing: padding 6px 0 9px, gap 9px):
- Label "Model" (11px muted, existing label style; 12px under `.project-context-card` as in line 11 of the CSS) + `Select` full width, options grouped by provider in the same order as the picker; first option "Global default" (value empty).
- Label "Reasoning" + `Select`: "Model default" then the model's `thinkingLevels` in advertised order, title-cased. Disabled with helper text "This model has no reasoning levels." when the list is empty, or when Model = Global default.
- Helper `<p>` (11px muted): "New threads in this project start with these. You can still change them in the composer for one thread. Stored in Gen, not in the project."
- Buttons row (flex, gap 8px): `button.secondary` "Save" (disabled when unchanged or saving; "Saving…" while pending), `button.quiet` "Use global default" (shown only when an entry exists).
- Status line 11px: "Saved" with lucide `Check` 12px in `var(--success)`; errors in `var(--danger)` with `role="alert"`.
- At card widths below 260px, the buttons wrap to two lines; selects stay full width; no horizontal scroll at 240px.

6.3 Composer:
- Model picker trigger: when source is `project`, a 6px round dot in the project's color (`projectColor(...)`) sits before the model name, and the trigger `title`/`aria-description` reads "Project default for <project>". When source is `explicit` or `global`, no dot.
- Picker panel footer (existing scope hint position, `modelScopeHint`): "Project default · applies to this thread only when changed." when source is `project`; unchanged text otherwise.
- Unavailable notice (`project-unavailable`): a one-line bar directly above the composer toolbar, full composer width, 8px 12px padding, 12px text, background `var(--hover)`, 1px `var(--border)` top border, lucide `AlertTriangle` 14px in `var(--warning-fg)` (defined for light and dark in `apps/web/src/styles.css:5–6`), text "<project>'s default model isn't available with your selected accounts. Choose a model to send." followed by two link-style buttons "Choose model" (focuses and opens the picker via `modelPickerRef`) and "Edit project defaults" (opens the right panel project card with the row expanded). Model trigger label "Choose a model".
- Reasoning dropped (`reasoningDropped`): same bar style, info icon `Info` in `var(--muted)`, text "<Model> doesn't offer <level> reasoning, so it uses the model default." with a close button (×, `aria-label="Dismiss"`); dismissed per owner for the session.
- Light, dark and high-contrast themes use tokens only; no literal colours except the project color dot, which already comes from preferences.

6.4 Settings → Projects (R11): row "Project model defaults" with description "Set these from each project's panel." Below it a compact list (`.settings-card-row` like project colors): project name (strong), "<model> · <reasoning>" muted, quiet "Remove" button (`RotateCcw` 13px, `aria-label="Remove model default for <project>"`). Empty state: "No project defaults yet."

### 7. Animation (DECIDED)

- Project card form expand/collapse: reuse the `.project-plan-expansion` grid-rows pattern (`grid-template-rows 0fr→1fr`, `var(--panel-motion, var(--ui-motion-panel-enter))`, `var(--ui-ease-enter)`); no new duration variables.
- Chevron rotates 0→180° over `var(--ui-motion-hover)` (120ms).
- "Saved" status: fade in 160ms (opacity 0→1, translateY 2px→0, `--ui-ease-enter`), stays 2s, fades out over the toast exit token (160ms).
- Composer notice bar: enters with opacity 0→1 and translateY 4px→0 over the popup enter token (180ms), exits over the popup exit token (140ms) when the user chooses a model; no height animation of the composer (bar reserves its space instantly to avoid layout jumps while typing).
- Project color dot: no animation; when the source changes from `project` to `explicit` the dot fades out over 120ms.
- With `data-motion="off"` or "reduced" and `prefers-reduced-motion: reduce`, all of the above become instant except opacity fades ≤120ms under "reduced" (matches `appearance.css:17–18`). Nothing loops.

## EXECUTION_DAG

Ownership boundaries: T02 owns `packages/contracts/preferences.ts` and its tests; T03 owns the new `apps/web/src/project-model-defaults.ts` and its unit tests; T04 owns main composer wiring in `apps/web/src/App.tsx` (`Composer`, `loadModels`, `updateModel`, `migrateDraft`) and `ModelPicker.tsx`/`ComposerToolbar.tsx` provenance props; T05 owns `CanvasThread` and `ScopedConversationComposer` wiring; T06 owns `ProjectContextCard.tsx`, `ProjectContextSurface.tsx`, `project-context.css`, Settings list and inventory; T07 owns new e2e specs. T03 depends on T02; T04, T06 on T03; T05 on T04; T07 on T05+T06; T08 last.

### T01 — Verify assumptions and resolve DISCOVERY X1–X4
- Goal: confirm every REPO_MAP fact at current main; answer X1–X4; choose the reasoning-provenance storage (DESIGN §3: extend `thinking:<owner>` value or add `thinkingExplicit:<owner>`) and record it.
- Deps: none. Steps: rebase on main; re-read listed lines; trace Send disabled state; read `getPreferences`/`mergePreferences` and `tests/settings-supported.test.ts`; locate Settings Projects render; post checkpoint with answers (file:line).
- Tests: none (read-only). Done when: checkpoint lists X1–X4 answers and the provenance choice. Handoff: T02.

### T02 — Preference contract
- Goal: R01, R02, DESIGN §1.
- Deps: T01. Edits: `packages/contracts/preferences.ts` (export `projectIdentityKeySchema`, add schema, default, defaults clone), any future-key handling found in X2.
- Tests: extend `tests/project-color-preferences.test.ts` (colors unchanged after rename) and add `tests/project-model-defaults-preferences.test.ts`: positive round-trip via `mergePreferences`; negative: bad key, 201 entries, empty `modelId`, 201-char id, `thinkingLevel` with spaces, extra field; `settings.update` with invalid map → `INVALID_INPUT` (service test); `tests/shell-settings-bootstrap.test.ts` still passes.
- Done when: tests and `pnpm typecheck` pass. Handoff: T03.

### T03 — Resolver
- Goal: R03, R06, R07, DESIGN §2.
- Deps: T02. Edits: new `apps/web/src/project-model-defaults.ts` (`resolveNewThreadModel`, `projectModelDefaultFor(preferences, authority, projectId)`).
- Tests (new `tests/project-model-defaults.test.ts`): bound ignores everything; explicit beats project; project beats global; project unavailable gives `project-unavailable` with empty id (does **not** return global); reasoning advertised vs not (`reasoningDropped`); project `thinkingLevel: null` → `''`; explicit thinking beats project thinking; no project → existing order; empty catalog.
- Done when: tests pass. Handoff: T04, T06.

### T04 — Main composer wiring and picker provenance
- Goal: R03–R05, R07, R09, DESIGN §3, §6.3 (main composer part), §7 composer parts.
- Deps: T03. Edits: `App.tsx` (`loadModels`, owner effect deps include `projectId`, `acceptedModel` skip, `Composer` reasoning init, `onModelChange` journal write, setter without global write when project default exists, `migrateDraft`, notice bar), `ModelPicker.tsx` (optional `source` and `projectColor` props, trigger dot, "Choose a model" label), `ComposerToolbar.tsx` (forward props, scope hint text), CSS in `model-picker.css` / composer CSS for dot and notice bar.
- Tests: unit tests for the main setter (global write skipped with project default, kept without); `tests/thinking-level.test.ts` unchanged and passing; component test for the notice bar actions; `pnpm test:ui-guard`, `pnpm lint`.
- Done when: tests pass; manual check in dev build of success 1–3 noted in checkpoint. Handoff: T05.

### T05 — Canvas and scoped composers
- Goal: same resolution in `CanvasThread` and `ScopedConversationComposer` (per X3).
- Deps: T04. Edits: `App.tsx` `CanvasThread`, `ScopedConversationComposer.tsx`.
- Tests: unit/component tests that a canvas unbound project thread starts with the project default and that a pick does not write global settings (already true) or the project map; bound canvas thread unchanged.
- Done when: tests pass. Handoff: T07.

### T06 — Project card editor, Settings list and search
- Goal: R10–R13, DESIGN §4, §6.1–§6.2, §6.4, §7 card parts.
- Deps: T03. Edits: `ProjectContextCard.tsx`, `ProjectContextSurface.tsx`, `project-context.css`, `Settings.tsx` (Projects list per X4), `settings-inventory.ts`.
- Tests: component tests (row summary for set/unset/unavailable; reasoning options follow model; Save disabled when clean; "Use global default" deletes entry; prune of unknown keys; catalog error with Retry); `tests/settings-registry.test.ts`, `tests/settings-search-filter.test.ts` (search "reasoning per project" finds the row), `tests/settings-supported.test.ts`; `pnpm test:ui-guard`, `pnpm lint`.
- Done when: tests pass; screenshots in light, dark, high contrast, card width 240px and 360px, attached to the PR. Handoff: T07.

### T07 — Browser coverage
- Goal: success criteria 1–5 end to end with fixtures.
- Deps: T05, T06. Edits: new `tests/e2e/project-model-defaults.spec.ts` registered in the `compact-model-picker` suite in `scripts/browser-suites.ts` (follow `subscription-accounts.spec.ts` fixtures for multiple catalogs/accounts).
- Cases: set defaults in two projects, new thread in each shows and sends them (assert command payload); explicit pick wins and leaves both maps unchanged; account switch making the model ineligible shows notice and disables Send, `selectedAccounts` unchanged; established thread unaffected after default change; project without default keeps global-write behaviour; keyboard-only editor; reduced motion (`data-motion="reduced"`) has no transform transitions.
- Done when: `pnpm test:browser --suite compact-model-picker` passes, plus `compact-settings` and `model-picker` suites.

### T08 — Docs, PR and front end team review
- Goal: document and hand off.
- Deps: T01–T07. Edits: short user section in the doc that covers model selection or Settings (find with `grep -ril "default model" docs/`), describing project defaults, precedence, the unavailable notice and that values are stored in Gen; add new docs to `scripts/public-source-files.json` if the docs check requires it.
- Steps: open the implementation PR linked to this issue; post the final checkpoint; **send the finished work to the front end team for review** (link the PR and T06 screenshots and a short recording of the composer notice, ask them to review visual design and animation against DESIGN §6–§7); record their verdict on this issue; then RELEASE.
- Done when: PR open with green CI, front end team review recorded on this issue.

## VALIDATION

### Commands (planned; none executed by this planning session)

```bash
pnpm install
pnpm typecheck
pnpm exec vitest run tests/project-model-defaults.test.ts tests/project-model-defaults-preferences.test.ts tests/project-color-preferences.test.ts tests/thinking-level.test.ts tests/accounts.test.ts tests/model-discovery.test.ts tests/settings-supported.test.ts tests/settings-registry.test.ts tests/settings-search-filter.test.ts tests/shell-settings-bootstrap.test.ts --maxWorkers=1
pnpm test:ui-guard
pnpm lint
pnpm check:docs-links
pnpm build
pnpm exec playwright install chromium
pnpm test:browser --suite compact-model-picker
pnpm test:browser --suite compact-settings
pnpm test:browser --suite model-picker
pnpm test:browser --suite micro-motion
```

Real-user check (desktop build, two signed-in providers or two models from one): set project A to a strong model on high and project B to a fast model on "Model default"; start a thread in each and confirm the run uses them (thread details show the model); in an A thread pick another model and confirm the next new A thread still starts with A's default and Settings → Default model is unchanged; sign out of A's provider and confirm the notice appears and nothing switches accounts.

### Acceptance matrix

| Req | Task | Check |
|---|---|---|
| R01, R02 | T02 | preference schema tests; no repo file written (e2e asserts project folder unchanged) |
| R03 | T03, T04 | resolver tests; e2e new thread per project |
| R04 | T04, T05 | journal `modelChoice` tests; migrate draft test |
| R05 | T04 | global-write skip/keep tests; e2e |
| R06 | T03 | catalog/thinking eligibility tests |
| R07 | T03, T04, T07 | `project-unavailable` test; e2e Send disabled + notice |
| R08 | T04, T07 | e2e `selectedAccounts` and bound thread unchanged; `tests/accounts.test.ts` passes |
| R09 | T04 | project switch re-resolve test |
| R10 | T06 | card component tests |
| R11 | T06 | settings registry/search tests |
| R12 | T06, T07 | a11y assertions, keyboard e2e |
| R13 | T06 | prune test |
| Visual/animation §6–§7 | T04, T06, T08 | screenshots, reduced-motion e2e, front end team review |
| Success 1–5 | T07 | e2e spec |

Release gate: all commands green, real-user check recorded on the issue, front end team review recorded.

## STATE

- Researched and decided: everything in this plan (r1).
- Implemented: nothing. Verified: nothing. No branches or owners yet.
- Risks: the main composer's coupled global write (R05) changes perceived behaviour inside projects with a default (mitigated by the provenance caption and docs); strict preferences schema and older builds (X2); three composer paths drifting (mitigated by D2 single resolver); account discovery races while resolving (existing owner/context fences in `loadModels` must wrap the resolver call).
- Next step: an implementing worker claims T01 on this issue per AGENTS.md and posts the X1–X4 answers.

## REFERENCES

- [openai/codex#36163](https://github.com/openai/codex/issues/36163) (open): asks that project `model` and `model_reasoning_effort` be defaults for new tasks, that an explicit composer choice override them for the current task or thread, that the override not rewrite project configuration, and reports the bug where the picker snaps back to the project value.
- [Claude Code settings: files and precedence](https://code.claude.com/docs/en/settings): settings resolve from the highest scope that sets a key (managed > command line > local project > shared project > user); a lower-scope `model` is a starting default, and `/model` and `/effort` change the current session only.
- [Claude Code settings reference](https://code.claude.com/docs/en/settings-reference): `model` and `effortLevel` keys and their per-session overrides (`--model`, `--effort`).
- Repository files at `e883ac0327c834120d89c3697dec7380a342ba4d`: `packages/contracts/preferences.ts`, `packages/contracts/index.ts`, `packages/core/service.ts`, `packages/core/accounts.ts`, `apps/web/src/App.tsx`, `apps/web/src/ModelPicker.tsx`, `apps/web/src/ComposerToolbar.tsx`, `apps/web/src/ScopedConversationComposer.tsx`, `apps/web/src/ProjectContextCard.tsx`, `apps/web/src/ProjectContextSurface.tsx`, `apps/web/src/project-context.css`, `apps/web/src/Settings.tsx`, `apps/web/src/settings-inventory.ts`, `apps/web/src/project-colors.ts`, `apps/web/src/journal.ts`, `packages/ui-shell/tokens.css`, `scripts/browser-suites.ts`.
