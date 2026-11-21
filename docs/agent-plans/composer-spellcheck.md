# Plan: Spellcheck in the composer (opt-in, with a language choice)

> **Design ownership (batch 4).** There is no separate front end team designing this feature: this plan itself specifies the visual design and the animation (section VISUAL_DESIGN_AND_MOTION). Implementers build exactly that specification. **When implementation is finished, the implementing agent sends the finished work to the front end team for review** (task T07) and does not close this issue until that review is recorded on the issue.

## META

| Field | Value |
|---|---|
| Feature | Spellcheck in the composer: an opt-in setting ("Check spelling") with a spelling-language choice, applied to every prompt input; native red underlines and right-click corrections in the desktop app |
| Size | small (labels `feature`, `small`); one issue, no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue |
| Plan file | `docs/agent-plans/composer-spellcheck.md` (identical to this body; SHA-pinned link at the top of the issue) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified by clone) |
| Existing work | None. `gh issue list --search "spellcheck OR spelling"` and `gh pr list --search spellcheck` return nothing |
| Implementation status | NOT_STARTED. Planning only; no code written |
| Source provenance | Feature proposal batch 4, item 1 ("Spellcheck in the composer", small), approved by the maintainer; static repository research at the baseline SHA; public requests openai/codex#13895 and openai/codex#25431 |

## OBJECTIVE

**Problem.** People writing long prompts make typos and cannot see them. The desktop app turns native spelling off: the ordinary window that hosts the chat app is created with `webPreferences.spellcheck:false` (`apps/desktop/main.ts:161`), and nothing in the app lets a user turn it on. Users of a comparable desktop agent app asked first for spellcheck (openai/codex#13895: typo underlines, right-click corrections, "add to dictionary") and then for an off switch and a language control because the automatically chosen language was wrong (openai/codex#25431).

**Intended behavior.**
1. Settings > Chat gets a "Check spelling" switch, **off by default** (opt-in).
2. When it is on, every prompt input (main composer, canvas side composer, scoped conversation composer, side chat, per-agent inputs) shows the platform's native misspelling underline.
3. In the desktop app, right-clicking a misspelled word opens a native menu with up to 5 suggestions, "Add to dictionary", and the standard edit commands.
4. A "Spelling language" row (visible only when the switch is on) lets the user choose "Match system" or one specific language from the dictionaries the platform offers. On macOS, where the OS picks the language itself, the row is replaced by a one-line note.
5. Inputs that are not prose (search, model/project pickers, credentials, environment values, file search, conversation find) stay spellcheck-off in every case.

**Measurable success.** With the switch on, typing `recieving` in the main composer of the desktop app shows a native underline, right-click shows "receiving" among suggestions, choosing it replaces the word with undo (Ctrl/Cmd+Z) restoring it; with the switch off, no underline appears and the right-click behaviour equals today's baseline; the setting survives an app restart and applies to every open and detached window within one second of toggling.

## REQUIREMENTS

### In scope (each maps to tasks and acceptance rows in VALIDATION)

- **R01 Preference.** New boolean `composerSpellcheck` (default `false`) and new `spellcheckLanguage` (string language tag or `null`; `null` = "Match system"; default `null`) in the shared preferences contract, persisted in the global settings record like `composerPredictions`. Old profiles without the keys read as the defaults.
- **R02 Settings UI.** "Check spelling" switch row and conditional "Spelling language" row in the Chat section, registered and searchable (terms: `spelling spellcheck typo dictionary language`).
- **R03 Prompt inputs follow the preference.** Every prompt `<textarea>` listed in REPO_MAP gets `spellCheck={preferences.composerSpellcheck}` (explicit `true` or `false`, never left unset).
- **R04 Non-prose inputs stay off.** The six existing explicit `spellCheck={false}` sites are kept unchanged and covered by a regression test.
- **R05 Desktop engine.** Ordinary windows (`main.ts:161`) are created with `spellcheck:true` so the engine is available, and the `persist:harness` session is switched with `session.setSpellCheckerEnabled(...)`: `false` at app start until the renderer reports the stored preference, then the stored value. The embedded manual browser (`main.ts:127`, third-party pages) and the notification popup (`main.ts:226`) keep `spellcheck:false`. The startup window (`main.ts:386`) has no inputs and is untouched.
- **R06 Language.** On Windows and Linux, `spellcheckLanguage` is applied with `session.setSpellCheckerLanguages([tag])`; `null` applies the system language list that Electron would choose (implementation reads `app.getPreferredSystemLanguages()` and keeps the entries present in `session.availableSpellCheckerLanguages`, falling back to `['en-US']` when none match). On macOS the language API is not called and the UI shows the note from VISUAL_DESIGN_AND_MOTION.
- **R07 Context menu (desktop).** A `context-menu` handler on ordinary windows' `webContents` builds a native `Menu` only when `params.isEditable` is true and the spellcheck preference is on: suggestions from `params.dictionarySuggestions` (max 5) calling `webContents.replaceMisspelling`, "Add to dictionary" calling `session.addWordToSpellCheckerDictionary(params.misspelledWord)` (only when `params.misspelledWord` is non-empty), a separator, then Cut, Copy, Paste, Select All using Electron menu roles. When the preference is off, or the target is not editable, the handler does nothing (baseline behaviour).
- **R08 Renderer to main bridge.** One new narrow IPC method `DesktopBridge.setSpellcheck({enabled, language})` and one read method `DesktopBridge.spellcheckLanguages()` returning `{platformManaged:boolean, available:string[]}`. Main validates input strictly and applies to the shared `persist:harness` session (so all ordinary and detached windows update together). Plug-in windows may not call either method.
- **R09 Browser build.** Without the desktop bridge (web app in a normal browser), R03 still applies; the language row is replaced by the note "Your browser chooses the spelling language." and no context menu code runs.
- **R10 Privacy.** Spelling runs locally through the OS or Chromium spellchecker; no draft text is sent to any model or Gen service. If T01 confirms that Chromium downloads Hunspell dictionaries from Google's CDN on Windows/Linux when a language is chosen, the switch description states it (wording fixed in VISUAL_DESIGN_AND_MOTION) and nothing is downloaded while the switch is off.
- **R11 Accessibility.** The switch reuses the existing `role="switch"` control with `aria-checked`; the language Select is labelled; the conditional row is keyboard reachable in DOM order directly after the switch; reduced motion removes the reveal animation.

### Out of scope (v1)

- **Selective exclusion of inline code, paths and typed `@file` text inside a prompt.** The approved proposal said "kept off for code, paths and file mentions". Research shows the composer is one plain `<textarea>`; a textarea cannot switch spelling for a sub-range of its text, and changing the editor model would put drafts, selection, IME, slash commands, predictions and send behaviour at risk. v1 therefore: (a) keeps attached files, resources and skills as chips **outside** the input (already true: `ComposerAttachments.tsx`, `ComposerSkillBindings`), so they are never underlined; (b) keeps every non-prose input off (R04); (c) offers "Add to dictionary" for recurring technical words. Sub-range exclusion is a possible follow-up issue that requires a rich-text editor decision; do not implement it here.
- Custom (drawn) squiggles, a Gen-owned dictionary, grammar checking, autocorrect, multiple simultaneous languages in the UI (the contract stores one tag), a "remove word from dictionary" UI.
- Spellcheck in the embedded manual browser or plug-in windows.

### User flows

1. **Turn on.** Settings > Chat > "Check spelling" off -> click -> switch animates on, "Spelling language" row reveals below, preference saved; returning to the composer, misspelled words show native underlines.
2. **Correct a word (desktop).** Right-click an underlined word -> native menu -> click a suggestion -> word replaced, caret after it, draft saved through the normal `onChange` path; Ctrl/Cmd+Z restores the original word.
3. **Add a word (desktop).** Right-click `Vite` (underlined) -> "Add to dictionary" -> underline disappears everywhere in all windows.
4. **Choose a language (Windows/Linux).** "Spelling language" Select -> "Deutsch (Deutschland)" -> underlines re-evaluate in German.
5. **Turn off.** Switch off -> language row collapses; underlines disappear in all windows; right-click goes back to baseline.
6. **Restart.** Quit and reopen -> the preference is read from settings and re-applied when the first window's renderer starts.

### Error and recovery

- `setSpellcheck` rejects (invalid input, bridge unavailable): the preference still saves; Settings shows the existing row error state with "Spelling could not be applied in this window. Restart Gen to apply it." The textarea attribute still follows the preference.
- Stored `spellcheckLanguage` no longer in `available` (dictionary removed): main falls back to the system list (as `null`) and the Select shows "Match system" with the stored tag kept untouched until the user picks again.
- `spellcheckLanguages()` fails or returns an empty list: the Select shows only "Match system".

## REPO_MAP (verified at the baseline SHA unless marked discovery)

| Area | Path | Verified fact |
|---|---|---|
| Main composer input | `apps/web/src/App.tsx:431` | Controlled native `<textarea aria-label="Message">`; no `spellCheck`/`autoCorrect`/`autoCapitalize`; IME guard, send shortcut, slash commands and prediction Tab/Escape in its `onKeyDown`. `ComposerView.tsx` is only the `<form>` wrapper |
| Canvas side composer | `apps/web/src/App.tsx:461` (`SideThreadComposer`) | Separate `<textarea id="side-message-…">` |
| Other prompt inputs | `apps/web/src/ScopedConversationComposer.tsx:39`, `apps/web/src/SideChat.tsx:74`, `apps/web/src/agents-workspace/AgentsWorkspace.tsx:187` | Separate textareas; none sets `spellCheck` |
| Toolbar | `apps/web/src/ComposerToolbar.tsx` | Toolbar only; does not own the input |
| Chips outside input | `apps/web/src/ComposerAttachments.tsx`, `ComposerSkillBindings` | Resources/skills render as `.resource-chip` spans outside the textarea |
| Prediction ghost | `App.tsx` `.composer-prediction-text` | `aria-hidden`, pointer-events none; not editable |
| Existing spellCheck=false sites (keep) | `ConversationFind.tsx`, `EnvironmentSettings.tsx`, `ModelPicker.tsx`, `ProjectPicker.tsx`, `files/ProjectSearch.tsx`, `CredentialEntry.tsx` (all in `apps/web/src`) | Explicit `spellCheck={false}` |
| Desktop windows | `apps/desktop/main.ts:127` (manual browser `WebContentsView`, `persist:harness-browser`), `:161` (ordinary/detached `BrowserWindow`, `partition:'persist:harness'`), `:226` (notification popup, `gen-attention`), `:386` (startup window, no spellcheck key) | 127/161/226 set `spellcheck:false` |
| Desktop IPC | `packages/desktop-contract/index.ts` (`DesktopBridge`, `DESKTOP_CHANNELS`), `apps/desktop/preload.ts` (frozen `harnessDesktop` via `contextBridge`), `apps/desktop/main.ts` `registerIpc` (`handle(channel, action)` with `authorize(event)` and plug-in gating) | Precedent: `setTheme` -> `channels.theme` (`main.ts:239` handler), called from `apps/web/src/desktop-context.tsx` |
| Context menus | none | No `context-menu` handler, no `setSpellCheckerLanguages`, no composer `onContextMenu` |
| Electron | root `package.json` | `electron` 45.2.0 |
| Preferences contract | `packages/contracts/preferences.ts` | Strict Zod `preferencesSchema`, `DEFAULT_PREFERENCES`, `mergePreferences`, tolerant `getPreferences`/`readPreferences` (per-field fallback on old/corrupt data) |
| Settings persistence | `packages/core/service.ts:1127-1135` (`settings.update`), `packages/storage/store.ts` (SQLite global settings record) | Merges validated patch, rejects unknown keys |
| Shell preference schema | `apps/server/server.ts:52,117-118` | Derives shell preference schema from the shared shape; check when adding keys |
| Settings UI | `apps/web/src/Settings.tsx` (`preferenceRows`, `SETTINGS_ROWS`, `PreferenceControl`), `settings-registry.ts`, `settings-inventory.ts`, `settings-data.ts`, `CompactSettings.tsx`, `compact-settings-data.ts` | `composerPredictions` is the end-to-end boolean precedent (`'harness-composer-predictions'` row in section `chat`) |
| Styles | `packages/ui-shell/tokens.css` (`--ui-space-*`, `--ui-focus-ring`, `--ui-motion-popup-enter`, `--ui-ease-enter`, `--ui-motion-hover`), `apps/web/src/styles.css` (`--surface`, `--text`, `--muted`, `--border`), `apps/web/src/settings.css` (`.settings-row`, `.settings-row-copy`, `.settings-row-control`, `.settings-switch`) | Reuse; no new colours |
| UI guards | `scripts/lint-ui.ts`, `scripts/ui-guard.ts`, `scripts/ui-guard-policy.md`, `scripts/ui-overlay-legacy.json` | Native Electron `Menu` is an OS API, not a DOM overlay; never add legacy entries |
| Tests | `tests/preferences.test.ts`, `tests/settings-supported.test.ts`, `tests/settings-registry.test.ts`, `tests/settings-search-filter.test.ts`, `tests/shell-settings.test.ts`, `tests/shell-settings-bootstrap.test.ts`, `tests/desktop-preload-accounts.test.ts`; browser suites in `scripts/browser-suites.ts` (`composer-prediction`, `compact-settings`, `settings-leaf-selects`, `micro-motion`) | Precedents |
| Source manifest | `scripts/public-source-files.json` | Every new source file must be listed (CONTRIBUTING.md) |
| Discovery | Exact Electron behaviour on Windows (OS spellchecker vs Hunspell download), whether `webPreferences.spellcheck:true` plus `setSpellCheckerEnabled(false)` shows zero underlines before the renderer sync, `app.getPreferredSystemLanguages()` output format | Verified in T01, not assumed |

## DESIGN

### Data

```ts
// packages/contracts/preferences.ts (additions)
const spellcheckLanguage = z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/).max(35).nullable();
// preferencesSchema: composerSpellcheck: z.boolean(), spellcheckLanguage,
// DEFAULT_PREFERENCES: composerSpellcheck: false, spellcheckLanguage: null,
```

```ts
// packages/desktop-contract/index.ts (additions)
export interface DesktopSpellcheckState { enabled: boolean; language: string | null }
export interface DesktopSpellcheckLanguages { platformManaged: boolean; available: string[] }
// DesktopBridge:
setSpellcheck?(state: DesktopSpellcheckState): Promise<void>;
spellcheckLanguages?(): Promise<DesktopSpellcheckLanguages>;
// DESKTOP_CHANNELS: spellcheck:'harness-desktop:spellcheck', spellcheckLanguages:'harness-desktop:spellcheck-languages'
```

### Control flow

1. App start (main): after creating the `persist:harness` session and before loading the first ordinary window, call `setSpellCheckerEnabled(false)`. Window creation at `main.ts:161` changes to `spellcheck:true`.
2. Renderer start: `DesktopProvider` (or a small hook next to the theme sync in `desktop-context.tsx`) reads `preferences.composerSpellcheck` / `spellcheckLanguage` from the snapshot and calls `bridge.setSpellcheck?.(...)` once, then again on every change of either value. Only the `main` and other non-plug-in surfaces call it.
3. Main handler (`handle(channels.spellcheck, ...)`): reject plug-in windows; validate the object has exactly `enabled` (boolean) and `language` (null or tag matching the contract regex); apply `setSpellCheckerEnabled(enabled)`; if not macOS and enabled, compute the language list (R06) and call `setSpellCheckerLanguages`. Keep the last applied state in a module variable for the context menu.
4. `handle(channels.spellcheckLanguages, ...)`: returns `{platformManaged: process.platform === 'darwin', available: platformManaged ? [] : session.availableSpellCheckerLanguages}`.
5. Context menu: register once per ordinary window next to the other `native.webContents.on(...)` handlers; behaviour per R07; `Menu.buildFromTemplate(...).popup({window: native})`.
6. Settings: switch writes `{composerSpellcheck}`; Select writes `{spellcheckLanguage}` through the existing `persist`/`settings.update` path. The bridge sync in step 2 follows from the snapshot refresh, so Settings does not call the bridge directly.

### Security boundaries

- No arbitrary renderer data reaches main: strict shape and regex validation; plug-in windows denied; the handler only touches the `persist:harness` session.
- The manual browser session (`persist:harness-browser`) and notification popup are never changed.
- Dictionary additions are stored by Chromium in the user profile; no Gen storage of words.

### Migration and rollback

- Old stored settings lack the keys -> tolerant read yields defaults (off). No data migration.
- Rollback = revert the PR; stored keys become unknown stored fields, which `readPreferences` already retains harmlessly.

## VISUAL_DESIGN_AND_MOTION

Specified here because no front end team designs this feature; build exactly this, then send it to the front end team for review (T07).

### Settings > Chat rows (placed directly after "Suggest my next message")

1. **Row "Check spelling"** (`id: 'composer-spellcheck'`) using the standard `.settings-row` layout: title "Check spelling", description (`.settings-row-copy`, `--muted` colour) "Underline misspelled words in messages you write." Control: the existing `.settings-switch` (same size, colours and thumb motion as every other switch; no new CSS for it).
   - If T01 confirms dictionary downloads on Windows/Linux, append on those platforms: " The first time, Gen downloads a dictionary for your language."
2. **Row "Spelling language"** (`id: 'spellcheck-language'`), rendered only while the switch is on:
   - Windows/Linux desktop: `.settings-row` with description "Language used to check spelling." and the shared `Select` from `packages/ui-shell/Select` (same component as "Time format"), options: "Match system" (value `null`) first, then each `available` tag labelled with `new Intl.DisplayNames([navigator.language], {type:'language'}).of(tag)` followed by the tag in parentheses only when two labels collide, sorted alphabetically by label.
   - macOS desktop: no Select; the row shows only description text "macOS uses the languages set in System Settings > Keyboard > Text Input." in `--muted`.
   - Browser build: description only, "Your browser chooses the spelling language."
   - The row is visually a child of the switch row: same left edge as other rows, no extra indent, separated by the standard row divider.

### Motion

- Reveal of the "Spelling language" row when the switch turns on: height from 0 to auto and opacity 0 to 1, with `transform: translateY(-4px)` to `0`, duration `var(--ui-motion-popup-enter)`, easing `var(--ui-ease-enter)`. Collapse on switch off: reverse, same duration. Implement with the CSS `grid-template-rows: 0fr -> 1fr` technique on a wrapper (no JS height measurement); content has `overflow:hidden` during the transition.
- `prefers-reduced-motion: reduce`, or the app preference `motion` = `reduced`/`off`: no transition; the row appears and disappears instantly. Follow whatever selector the existing reduced-motion convention in `tokens.css` uses (discovery in T05; do not invent a new one).
- The switch thumb uses the existing switch transition unchanged.
- Focus: after toggling on with the keyboard, focus stays on the switch; Tab moves to the Select.

### Composer and context menu

- Underlines are the platform's native rendering: never drawn by Gen, no CSS changes to `.composer-input>textarea`.
- The context menu is the OS-native Electron menu; item labels: suggestions verbatim, "Add to dictionary", "Cut", "Copy", "Paste", "Select All" (roles give platform-localised labels where Electron provides them). When there are no suggestions for a misspelled word, the first item is a disabled "No suggestions".

## EXECUTION_DAG

Tasks are sequential owners of disjoint files unless noted. One implementing worker may run them all in one PR (small feature).

### T01 Electron behaviour spike (discovery, no product code kept)
- **Goal:** confirm on Electron 45.2.0, in a throwaway branch or scratch script: (a) a `BrowserWindow` with `spellcheck:true` and `session.setSpellCheckerEnabled(false)` set before load shows no underlines and `context-menu` `params.misspelledWord` is empty; (b) toggling `setSpellCheckerEnabled` at runtime updates existing windows without reload; (c) on Windows and Linux, whether choosing a language triggers a network dictionary download (watch with the session `webRequest` or logs) and whether Windows uses the OS spellchecker; (d) `app.getPreferredSystemLanguages()` format vs `availableSpellCheckerLanguages`.
- **Deps:** none. **Files:** none committed. **Output:** an issue comment with the four answers and the commands used.
- **Done when:** the comment is posted. If (a) or (b) is false, BLOCK T03 and post the finding; the fallback design (recreate is not acceptable) must be decided on the issue before continuing.

### T02 Preferences contract and persistence
- **Goal:** R01.
- **Deps:** none. **Files:** `packages/contracts/preferences.ts`; check `apps/server/server.ts` shell schema derivation and `packages/contracts/index.ts` snapshot settings for required additions; tests `tests/preferences.test.ts`, `tests/shell-settings-bootstrap.test.ts`.
- **Tests:** positive: defaults false/null; patch `{composerSpellcheck:true}` and `{spellcheckLanguage:'de-DE'}` merge; stored profile missing keys reads defaults. Negative: `spellcheckLanguage:'../x'`, `''`, 36+ chars, number -> rejected by patch and fall back on read.
- **Done when:** tests pass and `pnpm typecheck` is clean.

### T03 Desktop bridge, engine and context menu
- **Goal:** R05, R06, R07, R08.
- **Deps:** T01 (confirmed), T02.
- **Files:** `packages/desktop-contract/index.ts`, `apps/desktop/preload.ts`, `apps/desktop/main.ts` (line 161 `spellcheck:true`; startup `setSpellCheckerEnabled(false)`; two `handle(...)` registrations; `context-menu` handler beside the other `native.webContents.on` calls). If the menu logic is extracted into a new file (e.g. `apps/desktop/spellcheck-menu.ts`, recommended so it can be unit tested), add it to `scripts/public-source-files.json` (`source` and `runtime`).
- **Tests:** unit tests for the pure parts: input validation (accept/reject cases as T02), language list computation (system list intersect available, fallback `en-US`, macOS returns platformManaged), menu template builder (no suggestions -> disabled "No suggestions"; 8 suggestions -> 5 items; empty `misspelledWord` -> no "Add to dictionary"; preference off -> no menu). Plug-in window call is rejected (extend the existing plug-in channel allow-list test pattern).
- **Done when:** unit tests pass; `main.ts:127` and `:226` still `spellcheck:false` (assert in a test that greps or inspects the options).

### T04 Prompt inputs follow the preference
- **Goal:** R03, R04, R09 (attribute part).
- **Deps:** T02.
- **Files:** `apps/web/src/App.tsx` (main composer at 431, `SideThreadComposer` at 461), `ScopedConversationComposer.tsx`, `SideChat.tsx`, `agents-workspace/AgentsWorkspace.tsx` (thread the preference in through the props or context each already uses for `preferences`; discover per file). Renderer sync call in `apps/web/src/desktop-context.tsx` (step 2 of Control flow).
- **Tests:** Playwright (new spec in an existing suite such as `composer-prediction`, or a new suite registered in `scripts/browser-suites.ts`): each listed textarea has `spellcheck="false"` by default and `spellcheck="true"` after enabling; the six non-prose inputs keep `spellcheck="false"` in both states; typing, IME composition, slash commands, Tab prediction and send still work with the attribute on.
- **Done when:** spec passes in `pnpm test:browser --suite <suite>`.

### T05 Settings rows, visual design and motion
- **Goal:** R02, R11, and VISUAL_DESIGN_AND_MOTION.
- **Deps:** T02 (T03 for the real language list; use the bridge's optional methods so the browser build works without it).
- **Files:** `apps/web/src/Settings.tsx` (`preferenceRows`, `SETTINGS_ROWS` with terms `spelling spellcheck typo dictionary language`), compact settings (`CompactSettings.tsx`, `compact-settings-data.ts`) if they mirror Chat rows (discovery), `apps/web/src/settings.css` for the reveal wrapper only.
- **Tests:** `settings-registry`, `settings-supported`, `settings-search-filter` unit tests updated; Playwright: switch toggles `aria-checked`, language row appears/disappears, Select lists "Match system" first, search "typo" finds the row, reduced motion has zero transition duration; `pnpm lint` (UI guard) clean.
- **Done when:** tests and lint pass; screenshots of light and dark themes, both switch states, attached to the PR.

### T06 Desktop end-to-end verification
- **Goal:** prove the measurable success criteria in a real desktop build on Windows (primary, from the original requests) and on macOS or Linux where available.
- **Deps:** T03, T04, T05.
- **Steps:** build the desktop app per CONTRIBUTING.md; run VALIDATION rows A01-A12; record a short screen recording of flows 1-6.
- **Done when:** results posted on the issue with platform, build commit and recording link; any platform not tested is named as NOT_RUN.

### T07 Front end team review (required by the maintainer)
- **Goal:** send the finished work to the front end team for review.
- **Deps:** T06.
- **Steps:** open the PR as ready for review, request review from the front end team (use the team or reviewers the repo's CODEOWNERS / maintainers name for `apps/web`; if none can be identified, ask on this issue who the front end reviewers are), and post an issue comment linking the PR, the screenshots and the recording, and listing the VISUAL_DESIGN_AND_MOTION items for them to check.
- **Done when:** the review request is visible on the PR and the comment is posted; address their feedback in the same PR; do not close the issue before their review is recorded.

## VALIDATION

### Commands (planned, none executed yet)

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm exec vitest run tests/preferences.test.ts tests/settings-supported.test.ts tests/settings-registry.test.ts tests/settings-search-filter.test.ts tests/shell-settings.test.ts tests/shell-settings-bootstrap.test.ts tests/desktop-preload-accounts.test.ts --maxWorkers=1
pnpm test:browser --suite <suite chosen in T04/T05>
pnpm test
```

### Acceptance matrix

| ID | Requirement | Check | Task |
|---|---|---|---|
| A01 | R01 | Defaults off/null; old profile reads defaults; invalid tags rejected | T02 |
| A02 | R02 | Rows render in Chat, search "typo" finds them | T05 |
| A03 | R03 | All five prompt textareas have `spellcheck` equal to the preference | T04 |
| A04 | R04 | Six non-prose inputs stay `spellcheck="false"` with the preference on | T04 |
| A05 | R05 | Desktop: preference off -> no underline on `recieving`; on -> underline within 1 s, in main and a detached window | T03, T06 |
| A06 | R05 | Manual browser page and notification popup show no underline with preference on | T06 |
| A07 | R06 | Windows/Linux: choosing German underlines `recieving` and not `empfangen`; "Match system" restores the system language | T06 |
| A08 | R07 | Right-click misspelled word -> suggestions, replace works, undo restores; "Add to dictionary" removes underline in all windows | T06 |
| A09 | R07 | Preference off -> right-click behaves as baseline | T06 |
| A10 | R08 | Plug-in window call rejected; malformed payload rejected | T03 |
| A11 | R09 | Browser build: attribute follows preference; note text shown; no errors | T04, T05 |
| A12 | R10 | No dictionary network request while the preference is off (Windows/Linux) | T01, T06 |
| A13 | R11 | Keyboard: switch, then Tab to Select; reduced motion removes the transition | T05 |
| A14 | Design | Front end team review requested and recorded | T07 |
| A15 | Regression | Typing, IME, slash commands, prediction Tab/Escape, send shortcut unchanged with spellcheck on | T04 |

**Release gate:** A01-A15 pass (A07 and A12 may be NOT_RUN only on macOS); `pnpm typecheck`, `pnpm lint`, `pnpm test` green in CI; front end team review recorded.

## STATE

| Item | State |
|---|---|
| Research | Done (static, at baseline SHA) |
| Decisions | Opt-in default off; one stored language tag or "Match system"; native underlines and native menu; v1 does not exclude sub-ranges (out of scope, reason in REQUIREMENTS); manual browser and popup stay off |
| Implemented | Nothing |
| Verified | Nothing; no test in this plan has been executed |
| Risks | Electron runtime toggling behaviour (T01 gates T03); Windows dictionary download disclosure; web build behaviour change (browsers default textareas to spellcheck on, so web users see underlines disappear until they opt in; accepted for consistency with desktop and the opt-in decision) |
| Owners | None. The implementing agent claims this issue per AGENTS.md |
| Next step | T01 spike on Electron 45.2.0 |

## REFERENCES

- Request: https://github.com/openai/codex/issues/13895 (closed): asks for typo underlines (example `recieving`), right-click corrections and adding words to a local dictionary in a Windows desktop agent app; motivations: fast typing, technical words, English as a second language.
- Request: https://github.com/openai/codex/issues/25431 (open): asks for a spellcheck off switch and language control because the automatically selected language was wrong.
- Electron docs: https://www.electronjs.org/docs/latest/tutorial/spellchecker (session spellchecker APIs, `context-menu` params `misspelledWord` and `dictionarySuggestions`, macOS uses the OS spellchecker and ignores `setSpellCheckerLanguages`).
- Electron `Session` API: https://www.electronjs.org/docs/latest/api/session (`setSpellCheckerEnabled`, `setSpellCheckerLanguages`, `availableSpellCheckerLanguages`, `addWordToSpellCheckerDictionary`).
- Repository: `AGENTS.md`, `CONTRIBUTING.md`, `scripts/ui-guard-policy.md` on `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d`.
