# Plan: Export and import settings

## META
- Feature: Settings → Data & Recovery gets a **Settings file** row with **Export…** and **Import…**. Export writes the user's portable preferences (theme, appearance, keyboard shortcuts, composer, diff, notification and thread-list choices) to a versioned JSON file. Import reads such a file, shows a preview of exactly which settings will change, applies them in one write, and offers Undo. A second PC or a reinstall is set up in one step.
- Repo: skytuhua-org/Gen-V1
- Plan revision: r1, 2026-11-21 (UTC)
- Baseline: `main` @ `8fa907f378127bcfc23d71b55c53625ffc43e8da` (verified with `git log -1` on a fresh clone)
- Size label: `feature` + `small`
- Existing issues/PRs: none match. Searched open and closed issues for "export settings", "import settings", "preferences export", "settings import": no match (only unrelated #1058, #1343, #1481, #1393, #1191, #1468, #1284, #1322, #1389). Not in feature-proposal batches 1–8, not an existing `feature` issue, and not in the M01–M17 matrix in `docs/progress.md` (M14 imports session history, not preferences; M17 paired-device read sync is a held foundation, not settings sync).
- Implementation status: NOT_STARTED. Filed as a plan only; implementation needs a worker to claim this issue under AGENTS.md.
- Source provenance: reading the repository at the baseline SHA (file:line references below are at that SHA), plus the external sources in REFERENCES.
- **Design owner:** there is no separate front-end design team for this work, so this plan defines the visual design and animation itself (DESIGN → Visual design and motion). The last task (T07) sends the finished work to the front-end team for review.

## OBJECTIVE
**User problem.** Gen stores about 50 UI preferences (fonts, sizes, accent, motion, rebindable shortcuts, send shortcut, diff layout and colours, notification delivery and quiet hours, confirmations…) in the local SQLite store (`packages/storage/store.ts`, entity `settings/global`). Someone who installs Gen on a second PC, reinstalls Windows, or resets their data directory has to redo every choice by hand. Users of similar tools ask for a portable profile export/import (Codex #31130) and for one look applied everywhere (Claude Code #110883). Settings today has no preferences file: the "Workspace diagnostics" row only shows counts with a **Refresh settings** button (`apps/web/src/Settings.tsx:173`), and "Move browser drafts" (`DraftTransfer.tsx`) transfers drafts, not preferences.

**Intended behaviour.**
1. Settings → Data & Recovery → **Settings file** row: **Export…** saves `gen-settings-YYYY-MM-DD.json` (desktop: native Save dialog; browser: download).
2. **Import…** opens a file picker for a `.json` file. Gen validates it and opens an **Import settings** preview listing every setting that would change (name, current value → new value), the number already matching, and any entries it will ignore and why.
3. **Apply N changes** writes them in one settings update; Gen re-renders with the new look and shortcuts immediately. A toast "Imported N settings" offers **Undo**; the row also shows **Undo import** until Settings closes.
4. The file never contains accounts, tokens, secrets, model/account selections, project paths, project IDs, browser start URL, background image, learning/skill settings or unknown stored fields.

**Measurable success.**
- Export on PC A, import on fresh PC B → every exported key on B equals A (round-trip test over all portable keys).
- Exported file contains only the allowlisted keys (test asserts the exact key set) and is under 8 KiB for default settings.
- Importing a file with a bad value, unknown key or newer version never writes a partial or invalid preference; the user sees why.
- Undo after import restores the previous values of the changed keys in one write.

## REQUIREMENTS
### In scope
- R1. Row `settings-transfer` "Settings file" in the `maintenance` section (Data & Recovery), searchable (inventory row), available in desktop and browser builds.
- R2. Export builds a versioned JSON envelope from an explicit allowlist (DESIGN → File format); never from `getPreferences()` spread or `SettingsData`.
- R3. Desktop export uses a native Save dialog through a new guarded download path modelled on project-memory export (`apps/desktop/memory-export.ts:54–115`); the browser build downloads via Blob + anchor (precedent `apps/web/src/project-memory-api.ts:105–110`).
- R4. Import reads a user-picked file through a hidden `<input type="file" accept="application/json,.json">` in both builds (precedent `DraftTransfer.tsx:12`), size limit 64 KiB.
- R5. Import validates the envelope and each preference key individually against the existing preference schema; invalid or non-portable entries are skipped and listed, never written.
- R6. Preview modal (shared `Modal` from `packages/ui-shell/Modal.tsx`) shows changed settings with human labels and formatted values, unchanged count, ignored entries; Apply is disabled when nothing changes.
- R7. Apply sends one `settings.update` command with `{theme?, preferences: patch}` (existing bulk merge in `packages/core/service.ts:1127–1135`), through the Settings `persist`/`settingsOperation` path so close/navigation waits for it.
- R8. Undo: toast action plus an in-row **Undo import** button, writing the inverse patch in one command; keys changed by the user after the import are not reverted (DESIGN → Undo).
- R9. Errors are shown inline in the row (`role="alert"`) with exact copy (UX below); the file input is reset so the same file can be picked again.

### Out of scope
- Cloud or account sync, automatic sync between PCs, paired-device sync (M17).
- Exporting workspace layout, panel geometry, floating windows, model favourites, drafts or any other localStorage/IndexedDB state (inventoried in REPO_MAP; none are UI preferences).
- Exporting `browserStartUrl`, `backgroundImage`, `projectColors`, `fontSize` (legacy), `learningEnabled`, `learningApproval`, `learningInterval`, `skillCurator`, `modelId`, `selectedAccounts`.
- Partial import (checkboxes per setting). v1 applies all listed changes or none.
- Export/import from the command line or a deep link.
- A "Reset all settings to defaults" action.

### Decisions (agreed for this plan) vs options
- Decided: explicit allowlist `PORTABLE_PREFERENCE_KEYS` (DESIGN) plus `theme`. Rationale per exclusion: `browserStartUrl` can carry private query strings and internal hosts; `backgroundImage` is personal imagery up to ~2.8 MB; `projectColors` keys are project/plugin identities that do not exist on another PC; `learning*`/`skillCurator` change agent behaviour, not UI; `fontSize` is a legacy seed.
- Decided: `backgroundStyle: "image"` is exported as `"solid"` (the image itself is not exported, so importing `image` would show no image). Recorded in the file as-is; no special flag.
- Decided: file format id `"gen.settings"`, `version: 1`. Import refuses `version > 1` ("made by a newer version of Gen") and any other `format`.
- Decided: unknown keys and non-portable known keys in `preferences` are ignored with a notice; invalid values for portable keys are skipped with a notice. The rest still imports.
- Decided: keybindings are imported per member (each of the six is its own preview row). If an imported chord collides with another resulting chord, all colliding members are skipped and listed ("Shortcut conflicts with …"). DISCOVERY in T01: reuse any existing conflict check from the Shortcut settings/`keyboard-bindings.ts`; if none exists, compare normalized chord strings in the new module.
- Decided: one write for apply and one for undo; no new server route.
- Decided: Undo lives for the life of the Settings view (in-row button) and 10 s in the toast; it is not persisted across restarts.
- Option (not chosen): merging into an existing generic "save file" desktop IPC. None exists at baseline (`main.ts` has only error message boxes and the memory-export download guard), so a narrow settings-specific channel is added instead.

### UX copy (exact)
- Row title "Settings file". Description: "Save your appearance, shortcuts, composer, diff and notification choices to a file, or load them on another PC. Accounts, keys and project paths are never included."
- Buttons: "Export…", "Import…", "Undo import" (only after an import in this Settings session).
- Export success status: "Settings saved to file." (desktop saved) / "Settings file downloaded." (browser) / nothing on cancel.
- Modal title: "Import settings". Subtitle: "From {fileName} · exported {localized date} · Gen {appVersion}" (omit missing parts).
- Section headers in modal: "Will change ({n})", "Already the same ({n})" (collapsed `<details>`), "Ignored ({n})".
- Ignored reasons: "Not a portable setting", "Unknown setting", "Invalid value", "Shortcut conflicts with {label}".
- Primary button: "Apply {n} changes" (singular "Apply 1 change"); secondary "Cancel". Zero changes: body text "Your settings already match this file." and only a "Close" button.
- Toast: "Imported {n} settings" with action "Undo"; after undo: toast "Import undone".
- Errors: "This file isn't a Gen settings file.", "This file was made by a newer version of Gen. Update Gen to import it.", "Choose a settings file no larger than 64 KB.", "Couldn't read this file.", "Couldn't apply the imported settings. Nothing was changed." (+ server message in `title`), "Couldn't undo the import."

### Accessibility, privacy, compatibility
- All controls are native buttons; modal uses the shared `Modal` (focus trap, Escape, focus restore). Change list is a `<table>` with `<th scope="col">` headers "Setting", "Current", "New"; colour swatches have text values too. Status messages `role="status"`, errors `role="alert"`.
- File content is parsed with `JSON.parse` only; no code evaluation; strings are rendered as text.
- Browser-build notifications: importing `threadNotifications` still stores the value; delivery availability is unchanged (existing behaviour).
- Font names are Windows fonts (Consolas, Cascadia Code); Gen is Windows-first so no remapping.

## REPO_MAP (verified at baseline)
- `packages/contracts/preferences.ts:30–77`: strict Zod `preferencesSchema`, defaults (`:59–72`), `PreferencePatch` (`:58`), private `patchSchema` = `preferencesSchema.partial().extend({keybindings: keybindings.partial().optional()}).strict()` (`:73`), `mergePreferences(current, patch)` (`:74–77`), `getPreferences(settings)` → private tolerant `readPreferences` that **re-spreads unknown stored fields** (`:78–111`). No version field. Keybindings: `search, newThread, toggleSidebar, toggleRightPanel, openSettings, stop` (strings 1–80).
- Theme lives outside preferences: `Snapshot.settings.theme: "light"|"dark"|"system"` (`packages/contracts/index.ts:23`), validated in `service.ts:1130`.
- Write path: `settings.update` accepts only `theme`, `modelId`, `preferences`; merges preferences, rejects invalid with `INVALID_INPUT` (`packages/core/service.ts:1127–1135`). Client `command()` in `apps/web/src/api.ts:115–124`. Settings `persist({preferences})` with `settingsOperation` (`Settings.tsx:140–150`), editor handoff `settings-writes` (`Settings.tsx:101`), `apps/web/src/settings-operations.ts`.
- Settings UI: sections at `Settings.tsx:32–40`; inventory `SETTINGS_ROWS` (`:61–80`, `row(id, label, section, terms)`); row rendering switch (`:172–173`); row markup `section.settings-row` / `.settings-row-copy` / `.settings-row-control`. Registry `apps/web/src/settings-registry.ts` (`PLATFORM_OVERRIDES` empty at baseline). `settings-data.ts` (`SettingsData` contains account/project/resource metadata: must not be serialized).
- Precedents: `apps/web/src/DraftTransfer.tsx` (Blob download + hidden file input + status/error/report); `apps/web/src/project-memory-api.ts:105–110` (browser download returns `{status:'started'}`).
- Desktop: `packages/desktop-contract/index.ts:51` channel `harness-desktop:memory-export`; `apps/desktop/preload.ts:14–15,28` exposes `exportProjectMemory`; `apps/desktop/main.ts:121–122,241`; `apps/desktop/memory-export.ts:54–115` installs a `will-download` guard that **denies any download without an owned permit**, so a plain Blob download from the renderer will not work in desktop.
- UI primitives: `packages/ui-shell/Toast.tsx:6–48` (`toast(message,{tone, action:{label,onClick}, durationMs})`, default 6000 ms, max 3); `packages/ui-shell/Modal.tsx`; tokens `packages/ui-shell/tokens.css:1–82` (durations hover 120, press 80, panel 220/180, popup 180/140, toast 200/160; reduced/off policies); `apps/web/src/useAppearance.ts:18–38` (motion data attributes, zeroed durations for `off`).
- UI guard: `scripts/ui-guard-policy.md:7–17` forbids ad-hoc dialogs/overlays outside shared primitives (use `Modal`); `scripts/ui-overlay-legacy.json` must not grow; `pnpm lint` / `pnpm test:ui-guard`.
- Out-of-band browser state (excluded, for reference): `harness:shell-layout:v1`, `harness:floating:*`, `harness:model-favorites:v1`, `harness:side-selected:*`, plan/plugin/document/terminal keys, IndexedDB `generative-harness-journal`.
- Tests: `tests/preferences.test.ts`, `tests/preferences-appearance.test.ts`, `tests/preferences-presentation.test.ts`, `tests/project-color-preferences.test.ts`, `tests/settings-supported.test.ts`, `tests/settings-registry.test.ts`, `tests/settings-search-filter.test.ts`, `tests/settings-operations.test.ts`, `tests/compact-settings.test.ts`, `tests/keyboard-bindings.test.ts`, `tests/ui-guard.test.ts`; Playwright `tests/e2e/settings-controls.spec.ts`, `tests/e2e/compact-settings.spec.ts` (+ configs `tests/e2e/compact-settings.playwright.config.ts`, `settings-leaf-selects.playwright.config.ts`, Chrome channel). Desktop memory-export tests: DISCOVERY (T01: `grep -rln memory-export tests`).
- App version: root `package.json` `"version": "0.6.5"`. DISCOVERY in T01: the existing way the web app reads the app version (About section); if none, omit `appVersion`.

## DESIGN
### File format (v1)
```json
{
  "format": "gen.settings",
  "version": 1,
  "exportedAt": "2026-11-21T18:00:00.000Z",
  "appVersion": "0.6.5",
  "theme": "dark",
  "preferences": {
    "density": "comfortable",
    "keybindings": { "search": "Ctrl+K", "newThread": "Ctrl+Shift+O", "toggleSidebar": "Ctrl+B", "toggleRightPanel": "Ctrl+Shift+B", "openSettings": "Ctrl+Comma", "stop": "Escape" }
  }
}
```
- Pretty-printed with 2-space indent and a trailing newline, keys in `PORTABLE_PREFERENCE_KEYS` order.
- `PORTABLE_PREFERENCE_KEYS` (grouped for preview ordering):
  - Appearance: `density, uiFontSize, chatFontSize, codeFontSize, controlRadius, customAccent, appearanceAccent, backgroundStyle, backgroundOpacity, interfaceFont, promptFont, codeFont, contrast, chatWidth, motion, motionSpeed, motionDuration, panelAnimations, timeFormat, wordWrap`
  - Chat & composer: `sendShortcut, composerPredictions, showComposerContext, showThreadDetails`
  - Threads & projects: `projectGrouping, projectOrder, showWorkingSection, archiveConfirmation, deleteConfirmation, unpinConfirmation`
  - Diffs: `diffLayout, hideWhitespace, diffDefaultExpanded, diffColors`
  - Notifications & usage: `threadNotifications, inAppNotifications, notificationVolume, notificationPreview, notificationQuietHours, showUsageFooter`
  - Keyboard: `keybindings` (all six members)
- Test T02 asserts `PORTABLE ∪ EXCLUDED` equals every key of `preferencesSchema.shape`, so a new preference added later fails the test until someone classifies it.

### Contract module `packages/contracts/settings-transfer.ts` (new)
```ts
export const SETTINGS_FILE_FORMAT = 'gen.settings';
export const SETTINGS_FILE_VERSION = 1;
export const SETTINGS_FILE_LIMIT = 64 * 1024;
export const PORTABLE_PREFERENCE_KEYS: readonly (keyof UiPreferences)[];
export const EXCLUDED_PREFERENCE_KEYS: readonly (keyof UiPreferences)[]; // browserStartUrl, backgroundImage, projectColors, fontSize, learningEnabled, learningApproval, learningInterval, skillCurator
export type Theme = 'light' | 'dark' | 'system';
export interface SettingsFileV1 { format: 'gen.settings'; version: 1; exportedAt: string; appVersion?: string; theme?: Theme; preferences: Partial<UiPreferences> }
export function buildSettingsFile(input: { theme: Theme; preferences: UiPreferences; now: Date; appVersion?: string }): string;
export type ImportIssue = { key: string; reason: 'not-portable' | 'unknown' | 'invalid' | 'conflict'; conflictWith?: string };
export type ParsedSettingsFile =
  | { ok: true; exportedAt?: string; appVersion?: string; theme?: Theme; patch: PreferencePatch; issues: ImportIssue[] }
  | { ok: false; error: 'not-settings-file' | 'newer-version' | 'too-large' | 'unreadable' };
export function parseSettingsFile(text: string): ParsedSettingsFile;
export type SettingChange = { key: string; group: string; before: unknown; after: unknown }; // key is 'theme', a preference key, or 'keybindings.<member>'
export function diffSettings(current: { theme: Theme; preferences: UiPreferences }, parsed: Extract<ParsedSettingsFile,{ok:true}>): { changes: SettingChange[]; unchanged: number };
export function patchFromChanges(changes: SettingChange[], side: 'before' | 'after'): { theme?: Theme; preferences: PreferencePatch };
```
- `buildSettingsFile` reads only allowlisted keys from the passed preferences (never spreads), maps `backgroundStyle: 'image'` → `'solid'`, and copies the six keybinding members explicitly.
- `parseSettingsFile`: length > `SETTINGS_FILE_LIMIT` → `too-large`; `JSON.parse` failure → `unreadable`; not a plain object or `format !== 'gen.settings'` → `not-settings-file`; `version` not a positive integer → `not-settings-file`; `version > 1` → `newer-version`. `theme` is accepted only if one of the three values, else issue `invalid` on `theme`. For each `preferences` entry: in `EXCLUDED` → `not-portable`; not a schema key → `unknown`; validate `{[key]: value}` with the exported patch validator (export a `parsePreferencePatch` from `preferences.ts` wrapping the private `patchSchema`) → failure `invalid`. `keybindings` validated per member (unknown member → `unknown` as `keybindings.<m>`). `backgroundStyle: 'image'` in an imported file → issue `invalid` (no image travels with the file). Top-level keys other than the six envelope fields are ignored silently.
- Conflict check runs after merging imported keybindings over current ones: any two members with the same normalized chord (case-insensitive, `+`-separated, modifiers sorted) → skip the imported members involved, issue `conflict` with the other member's label.
- `diffSettings` compares with deep equality (quiet hours object, keybinding members individually) and produces changes in `PORTABLE_PREFERENCE_KEYS` group order, theme first.

### Labels and value formatting (web, `apps/web/src/settings-transfer-labels.ts`, new)
- Map each portable key and `theme`, `keybindings.<member>` to a label. Reuse the visible Settings row labels where the row exists in `SETTINGS_ROWS`/`AppearanceSettings`; DISCOVERY in T01 lists them. Fallback labels are written by the implementer in sentence case.
- Values: booleans "On"/"Off"; enums title-cased from the existing `Select` option labels where available; numbers with units (px for font sizes, ms for `motionDuration`, % for volume/opacity); hex colours as swatch + `#RRGGBB`; `null` accent "Default"; quiet hours "22:00–08:00, on/off"; chords via the existing shortcut display helper if one exists (DISCOVERY), else the raw string.

### Data/control flow
```
Export…  → SettingsTransfer: buildSettingsFile({theme:data.settings.theme, preferences:getPreferences(data.settings), now, appVersion})
         → desktop?.exportSettings ? desktop.exportSettings(text, filename) : browser Blob download
Import…  → <input type=file> → file.size>LIMIT? error : parseSettingsFile(await file.text())
         → ok? diffSettings(current, parsed) → open preview Modal
Apply    → before = patchFromChanges(changes,'before'); after = patchFromChanges(changes,'after')
         → persist({theme?: after.theme, preferences: after.preferences})   // one settings.update
         → success: lastImport = {before, after}; toast('Imported N settings', {action:{label:'Undo', onClick: undo}, durationMs:10000})
         → failure: keep modal open, inline alert "Couldn't apply…"; nothing written (server transaction)
Undo     → current = fresh preferences; restore only keys whose current value deep-equals after[key]
         → persist(restore) → toast('Import undone'); clear lastImport. Skipped keys listed in row status: "Kept {n} settings you changed after importing."
```
- `persist` must accept `theme` together with `preferences`. DISCOVERY in T01: `persist` at `Settings.tsx:140–150` currently takes `{preferences}`; Appearance saves theme separately (`Settings.tsx:199`). If `persist` cannot send both in one command, extend it to pass the whole `settings.update` payload (the server already accepts both).

### Desktop export channel
- `packages/desktop-contract/index.ts`: channel `settingsExport: 'harness-desktop:settings-export'`; bridge `exportSettings?(serialized: string, filename: string): Promise<{status: 'saved' | 'cancelled'}>`; parser `parseSettingsExportRequest` (strict record, `serialized` string ≤ `SETTINGS_FILE_LIMIT` that `parseSettingsFile` accepts, `filename` matching `/^gen-settings-\d{4}-\d{2}-\d{2}\.json$/`).
- `apps/desktop/main.ts`: handler accepts only the `main` surface (reject plugin callers like other channels), then performs a guarded download exactly like memory export: register an owned permit, set `DownloadItem.setSaveDialogOptions({title:'Export settings', defaultPath: filename, filters:[{name:'JSON', extensions:['json']}], properties:['showOverwriteConfirmation']})`, resolve `saved`/`cancelled`, reject on failure. DISCOVERY in T01: whether `createMemoryExportDownloads` can be parameterized (title, permit kind) without weakening its checks; if yes, generalize it with memory export unchanged and its tests green; if not, add `apps/desktop/settings-export.ts` mirroring it.
- `apps/desktop/preload.ts`: expose `exportSettings`.

### Security boundaries
- Export never reads `SettingsData`, accounts, skills, projects, resources or localStorage.
- Import never sends a key outside `PORTABLE_PREFERENCE_KEYS` ∪ `theme`; the server re-validates via `mergePreferences` regardless.
- Desktop channel: main surface only; filename pattern fixed; payload revalidated in main before writing.

### Rollback
- Feature is additive: one row, one contract module, one desktop channel. Removing it leaves stored preferences untouched. No migration.

### Visual design and motion
- Row: standard `settings-row` card in Data & Recovery, placed directly above "Move browser drafts". Controls right-aligned in `settings-row-control`: "Export…" and "Import…" as `secondary` buttons with lucide `Download` / `Upload` icons (16 px, `aria-hidden`), 8 px gap; "Undo import" appears as a `quiet` button with `Undo2` icon after a successful import. Status/error text sits under the description in the row's muted / error text styles.
- Modal: shared `Modal`, width 560 px (max 92vw), max body height 60vh with internal scroll. Header: title + subtitle in muted text 12 px. "Will change" table: three columns (Setting 40%, Current 30%, New 30%), 36 px rows (existing row-height token), 1 px separators in the existing border token, group sub-headings (e.g. "Appearance") as 11 px uppercase muted labels. The "New" cell uses the regular text colour with a 2 px left accent bar in the accent token; "Current" is muted. Colour values show a 12 px rounded swatch before the hex. "Already the same" is a collapsed `<details>`; "Ignored" uses the warning text token with lucide `AlertTriangle` 14 px and one line per entry (`label — reason`). Footer: Cancel (secondary) left of Apply (primary), right-aligned.
- Light, dark and high-contrast themes use only existing tokens; no new colours.
- Motion: modal open/close uses the shared `Modal` motion (popup 180/140 ms tokens) unchanged. Rows in "Will change" fade in with a 4 px upward translate, 120 ms `ease-out`, staggered 15 ms per row capped at 10 rows (later rows appear with row 10). After Apply, the app re-renders with new appearance; the "Undo import" button fades in over the hover duration token (120 ms). The toast uses the existing toast motion. Under `prefers-reduced-motion: reduce` or Gen motion `reduced`: no translate or stagger, opacity only at the press duration (80 ms); motion `off`: no animation (durations are zeroed by `useAppearance`). No motion on first render of the row. All durations come from tokens/CSS variables so motion speed scaling applies.

## EXECUTION_DAG
| ID | Goal | Depends | Files | Done when |
|---|---|---|---|---|
| T01 | Discovery: answer every DISCOVERY item | — | read-only | Checkpoint lists each answer with file:line; plan revised first if a design change is needed |
| T02 | Contract module + `parsePreferencePatch` export | T01 | `packages/contracts/settings-transfer.ts` (new), `packages/contracts/preferences.ts`, `tests/settings-transfer.test.ts` (new), `scripts/public-source-files.json` | Unit tests pass |
| T03 | Desktop export channel | T02 | `packages/desktop-contract/index.ts`, `apps/desktop/main.ts`, `apps/desktop/preload.ts`, `apps/desktop/memory-export.ts` or new `apps/desktop/settings-export.ts`, desktop tests | Desktop tests pass, memory-export tests unchanged and green |
| T04 | Settings row, preview modal, apply/undo, labels, CSS/motion | T02 | `apps/web/src/SettingsTransfer.tsx` (new), `apps/web/src/settings-transfer-labels.ts` (new), `apps/web/src/Settings.tsx`, settings CSS file next to existing settings styles (DISCOVERY), `scripts/public-source-files.json` | Component tests pass, lint and ui-guard clean |
| T05 | Registry/search + browser e2e | T04 | `apps/web/src/Settings.tsx` inventory, `tests/settings-registry.test.ts`, `tests/settings-search-filter.test.ts`, `tests/e2e/settings-transfer.spec.ts` (new, run under the compact-settings or settings-leaf-selects config per T01) | E2E passes in Chrome channel |
| T06 | Installed desktop verification | T03, T04, T05 | none (evidence) | Acceptance matrix A1–A11 recorded on the issue |
| T07 | Hand-off to the front-end team | T06 | none | Front-end review requested with PR, screenshots, recording |

T03 and T04 can run in parallel after T02 (no shared files). T05 follows T04 (same `Settings.tsx`).

### T01 — Discovery
- Answer: (a) can `createMemoryExportDownloads` be parameterized safely; (b) existing keybinding conflict check or chord normalizer; (c) existing shortcut display helper; (d) visible labels for each portable key (Settings rows, `AppearanceSettings`, `NotificationSettings`); (e) how the web app reads the app version; (f) whether `persist` can send theme + preferences in one command; (g) which CSS file holds `settings-row` styles; (h) which Playwright config owns new settings specs (`scripts/browser-suites.ts:39,62`); (i) desktop memory-export test file names.
- Negative check: `grep -rn "gen.settings\|settings-export\|exportSettings" apps packages scripts tests` returns nothing at baseline.
- Output: checkpoint comment; update this plan (new revision) if an answer changes the design.

### T02 — Contract module
- Implement DESIGN → Contract module exactly. Export `parsePreferencePatch(value: unknown): PreferencePatch` from `preferences.ts` (wraps `patchSchema.parse`).
- Add the new file to `scripts/public-source-files.json` (alphabetical).
- Tests `tests/settings-transfer.test.ts`:
  - Classification: `PORTABLE ∪ EXCLUDED` = all schema keys, disjoint.
  - Build: defaults produce exactly the allowlisted key set; unknown stored fields (inject via `getPreferences({preferences:{zzz:1}})`) are absent; `browserStartUrl`, `backgroundImage`, `projectColors`, learning keys absent even when set; `backgroundStyle:'image'` → `'solid'`; output ends with `\n`; size < 8 KiB.
  - Round trip: build → parse → diff against defaults yields every changed key; `patchFromChanges(after)` merged with `mergePreferences` equals the source for all portable keys.
  - Parse errors: >64 KiB → `too-large`; `{` → `unreadable`; `[]`, `null`, wrong format, version `"1"`/0/-1 → `not-settings-file`; version 2 → `newer-version`.
  - Issues: excluded key → `not-portable`; `zzz` → `unknown`; `uiFontSize: 99` → `invalid`; `keybindings.foo` → `unknown`; `theme:'blue'` → `invalid`; imported `backgroundStyle:'image'` → `invalid`; two members set to `Ctrl+K` → both `conflict`, other keys still in patch.
  - Prototype safety: `{"preferences":{"__proto__":{"x":1}}}` yields an `unknown` issue and no pollution.

### T03 — Desktop export channel
- Implement DESIGN → Desktop export channel.
- Tests (extend the desktop memory-export / host-controls tests per T01): request parser accepts valid input and rejects bad filename, oversize, non-settings payload, extra keys; plugin caller rejected; Save dialog options exact; cancel → `cancelled`; interrupted → reject; an unrelated download is still denied by the guard; memory export still works.

### T04 — Settings UI
- New `SettingsTransfer` component rendered from `Settings.tsx` for row id `settings-transfer` with the copy, layout, states and motion in REQUIREMENTS/DESIGN. Uses `useDesktop()` for `exportSettings`; browser fallback Blob + anchor + revoke after 1000 ms.
- Preview modal uses shared `Modal` only (no ad-hoc overlay). Apply uses `persist` (or the extended version from T01f) so `settings-writes` handoff waits for it.
- Undo implementation per DESIGN; `lastImport` state is component state (cleared on unmount).
- Tests (component, Vitest + existing web test setup): export calls bridge with exact filename and the built text; browser path creates a download; cancel shows no status; file too large / unreadable / not settings / newer version → exact error copy and nothing persisted; valid file → modal lists changes in order with formatted values, unchanged count, ignored entries; zero-change file → "Close" only; Apply → exactly one `settings.update` with the patch; apply failure → modal stays, alert shown; Undo via toast and via row button → one write with restore patch; user edits a key after import → Undo keeps it and shows "Kept 1 setting…"; same file can be picked twice (input reset); keyboard-only flow; reduced motion has no translate (class or style assertion).
- `pnpm lint` and `pnpm test:ui-guard` clean; `scripts/ui-overlay-legacy.json` unchanged.

### T05 — Registry, search, e2e
- Inventory: `row('settings-transfer', 'Settings file', 'maintenance', 'export import backup restore preferences profile transfer move another pc reinstall json')`, placed before `harness-draft-transfer`.
- Update `tests/settings-registry.test.ts` / `tests/settings-search-filter.test.ts` / `tests/settings-supported.test.ts` if they enumerate rows; searching "export settings", "backup", "import" reveals the row.
- E2E `tests/e2e/settings-transfer.spec.ts`: change accent + send shortcut + one keybinding → Export (capture download) → reset fixture → Import the file → preview shows the three changes → Apply → UI reflects accent, Settings shows new values → Undo → values restored. Also: import a fixture with `projectColors` and `zzz` → listed under Ignored and not written.

### T06 — Installed desktop verification
- On a Windows x64 installed build (`pnpm desktop:package`): run the acceptance matrix; native Save dialog appears with the default name; cancel works; unrelated downloads still blocked. Capture screenshots of the row (idle, after import), the preview modal (changes + ignored, zero changes) and an error, in light, dark and high contrast; record a short clip of the modal row animation and reduced-motion behaviour. Post evidence on this issue in a checkpoint.

### T07 — Hand-off
- **Send the finished work (PR link, screenshots, recording) to the front-end team for review** of the visual design and animation; address their feedback before marking DONE.

## VALIDATION
- Setup: Node ≥ 24.10.0, pnpm 10.30.3 (`package.json`); `pnpm install`; `pnpm build:widgets`.
- Unit: `pnpm exec vitest run tests/settings-transfer.test.ts tests/preferences.test.ts tests/settings-registry.test.ts tests/settings-search-filter.test.ts tests/settings-supported.test.ts tests/settings-operations.test.ts tests/keyboard-bindings.test.ts --maxWorkers=1` plus the desktop test files from T01(i); full `pnpm test:no-lease` (or `pnpm test` on Windows).
- Static: `pnpm typecheck`, `pnpm lint`, `pnpm test:ui-guard`.
- Browser: `pnpm test:browser --suite <suite from T01(h)>` (Chrome channel).
- Desktop: installed Windows build, manual matrix.
- Acceptance matrix:

| # | Check | Req | Task |
|---|---|---|---|
| A1 | Row "Settings file" in Data & Recovery on desktop and browser; found by search "export settings" | R1 | T04, T05 |
| A2 | Exported file has exactly the allowlisted keys + theme, no secrets/paths/IDs/URL/image/unknown fields | R2 | T02 |
| A3 | Desktop export opens native Save dialog with `gen-settings-YYYY-MM-DD.json`; cancel is silent; unrelated downloads still denied | R3 | T03, T06 |
| A4 | Browser export downloads the file | R3 | T04, T05 |
| A5 | Oversize, non-JSON, wrong format, newer version → exact errors, nothing written | R4, R5, R9 | T02, T04 |
| A6 | Invalid / unknown / excluded / conflicting entries listed under Ignored and not written; the rest imports | R5 | T02, T05 |
| A7 | Preview lists every change with labels and formatted values; zero-change file shows Close only | R6 | T04 |
| A8 | Apply = one `settings.update`; appearance and shortcuts take effect immediately; failure writes nothing | R7 | T04, T05 |
| A9 | Undo (toast and row) restores changed keys in one write and keeps later user edits | R8 | T04, T05 |
| A10 | Keyboard and screen-reader flow; reduced/off motion honoured; three themes correct | UX | T04, T06 |
| A11 | Round trip PC A → PC B reproduces all portable settings | Success | T02, T06 |
| A12 | Front-end team review requested with evidence | Design | T07 |

- Executed so far: none (plan only). Every check above is PLANNED.
- Release gate: A1–A11 PASS, CI green, A12 requested.

## STATE
- Researched/decided: everything above. Implemented: nothing. Verified: nothing.
- Owners/branches: none. This plan file lands through a docs-only PR.
- Risks: desktop download guard reuse (T01a/T03) must not weaken memory-export checks; label coverage for ~45 keys is tedious but mechanical; future preferences must be classified (enforced by the T02 classification test); `persist` may need a small extension to send theme with preferences (T01f).
- Next step: a worker claims this issue and runs T01.

## REFERENCES
- Codex request, portable profile export/import: https://github.com/openai/codex/issues/31130
- Claude Code request, one theme across surfaces: https://github.com/anthropics/claude-code/issues/110883
- Electron `DownloadItem.setSaveDialogOptions`: https://www.electronjs.org/docs/latest/api/download-item#downloaditemsetsavedialogoptionsoptions
- Baseline code: https://github.com/skytuhua-org/Gen-V1/tree/8fa907f378127bcfc23d71b55c53625ffc43e8da (`packages/contracts/preferences.ts`, `packages/core/service.ts`, `apps/web/src/Settings.tsx`, `apps/web/src/DraftTransfer.tsx`, `apps/desktop/memory-export.ts`, `packages/desktop-contract/index.ts`, `packages/ui-shell/Modal.tsx`, `packages/ui-shell/Toast.tsx`, `packages/ui-shell/tokens.css`)
- Repository rules: `AGENTS.md` (plan publication and checkpoint contract), `CONTRIBUTING.md`, `scripts/ui-guard-policy.md`.
