# Plan: Reusable prompt snippets in the composer

> **Design ownership (batch 6).** There is no separate front end team designing this feature: this plan itself specifies visual design and animation in VISUAL_DESIGN_AND_MOTION. Implementers build that specification. **When implementation is finished, the implementing agent sends the finished work to the front end team for review** (T08). Do not close the issue until that review and required corrections are recorded.

## META

| Field | Value |
|---|---|
| Feature | Reusable prompt snippets: explicitly curated named plain text, inserted at the cursor in editable conversations |
| Batch / size | Batch 6, item 3; medium; labels `feature`, `medium`; one parent issue |
| Repo | `skytuhua-org/Gen-V1` |
| Canonical issue | This issue (no earlier matching issue found; #1397 and #1295 are related, not this feature). |
| Plan file | `docs/agent-plans/prompt-snippets.md` (identical to this body; SHA-pinned link and docs PR at the top of the issue) |
| Revision | r1, 2026-11-21 |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d`; clone HEAD verified |
| Existing work | [#1397](https://github.com/skytuhua-org/Gen-V1/issues/1397) prompt history, open; overlapping [PR #1466](https://github.com/skytuhua-org/Gen-V1/pull/1466), open/unmerged at research time, head `c0c3ebf05685bda2d3037421e64d9d3a728d43f9`. [#1295](https://github.com/skytuhua-org/Gen-V1/issues/1295) starter prompts, open. Saved Drafts already supports rich owner-bound restore/insert. |
| Implementation status | NOT_STARTED. Plan only: no application edits, tests, commits, pushes, PRs or issue writes. |
| Provenance | Maintainer's fixed batch-6 scope; static baseline inspection; section layout of the #1397 plan; VS Code prompt-files documentation fetched via curl; Codex #39437 and Gen related issue/PR metadata/comments via authenticated GitHub API. |
| Ownership | Planning author published this issue and the docs PR; implementation unassigned. |

## OBJECTIVE

**Problem.** Users repeat instructions across unrelated conversations. Saved Drafts can insert text but retains profile/account/thread/project/working-copy ownership and rich context. Widening that ownership would risk carrying authority into unrelated work. Prompt history automatically recalls sent prompts; starter prompts are product-authored. Neither is a user-curated reusable text library.

**Behavior.** Add **Snippets** beside Saved drafts in each editable ordinary conversation composer. Search and insert an authored snippet at the remembered caret, replacing only an explicit selection, never implicitly replacing the draft or sending. Create/edit/rename/delete in a manage view; save current selection through an explicit review/Save flow. `/snippets` opens the same picker. Library is local and profile-wide, independent of thread/account/project/copy, and contains no grants, tool settings or skills.

**Measurable success.** Draft `Before AFTER`, caret before `AFTER`, body `check tests ` produces `Before check tests AFTER`; selecting only `AFTER` produces `Before check tests `. Caret follows inserted body; metadata unchanged; zero send calls. Cancel preserves text/range. A snippet created in A is usable in B with a different account/project/copy, and its rename appears in another same-profile window without reload. Separate profile storage sees no records. Saved drafts/history never populate the library automatically.

**Prior art accurately bounded.** VS Code documents reusable standalone Markdown prompt files manually invoked as slash commands, workspace scope and user-profile scope across workspaces. Its current page says prompt files run only in the deprecated Local harness and recommends skills for new workflows; richer configuration and sync are not adopted here. Codex #39437 is an **open request**, not shipped-product evidence: composer `+` favorites, save/pin/insert/rename/reorder/edit/delete, optional device sync and multi-skill favorites. Gen borrows deliberate reuse/discovery, excludes skill bundles, pinning/reordering, files and cloud sync.

## REQUIREMENTS

### In scope (each maps to tasks and acceptance rows in VALIDATION)

**R01 — Curated text only.** Only explicit Save creates records. No ingestion from sent messages, Saved Drafts, starter prompts, clipboard or tools. Bodies containing `/skill:foo`, `@file`, Markdown/HTML or paths are inert text on insertion: no grants, resource resolution, tool/account/model settings or skill-binding metadata. Strict schema rejects rich metadata. Later explicit sending still follows normal admission checks.

**R02 — Profile-wide local persistence.** Use existing browser journal with explicit profile key, not thread/account/project keys or a new server route. Follow verified Saved Draft convention: origin identity inside browser/Electron storage partition. Same profile means same partition and origin, not another browser/device/OS user or changed dev port. Account switching neither clears nor filters library. No whole-library payload in snapshots, history or model requests.

**R03 — Limits and validation.** 100 records/profile; Name trimmed/NFC, 1–80 Unicode code points, no controls/newlines; Body 1–20,000 UTF-16 units, non-whitespace, no NUL; serialized library ≤2,000,000 UTF-8 bytes. Preserve valid body whitespace/newlines after ordinary textarea normalization. Unique names by trimmed NFC + locale-independent lowercase; self-rename/case changes allowed. Same body/different names allowed. No truncation, eviction, expiry or automatic deduplication. Counters/inline validation; enforce bounds on both load and save.

**R04 — Management.** Picker has New snippet and Manage snippets; native Modal offers searchable list, New, Edit and Delete. Edit Name is rename; editor has Name/Body. Save closes only after atomic durable commit. Dirty Cancel/close asks discard confirmation. Delete confirms name, Cancel initial focus. Failures/conflicts retain fields. Closing management does not insert; deletion never changes already inserted text. No generic Settings tab required.

**R05 — Exact insertion, never send.** Capture textarea text, start/end/direction and owner epoch before focus leaves. Revalidate current owner/text/range/editability; compute prefix + body + suffix; collapse caret after body. Full-draft replacement is possible only through the user's explicit full selection, never a Replace draft action. Preserve rich draft metadata. Use normal owner edit callback, dismiss prediction/history mode, resize normally, restore focus after overlays close. Consume picker Enter; no ensureThread, send/submit, account/tool calls from snippet insertion.

**R06 — Editable conversation coverage.** Wire App's Composer and ScopedConversationComposer, including no-thread/new-task state; one shared feature UI/contract. Read-only/archive/detached/pending transfer/closing/unmount/epoch/preparation/retry custody changes invalidate captures. Working alone is not read-only if next draft remains editable. Recheck before edit/refocus. Audit other ordinary conversation surfaces in T01; never find a target with global DOM queries. Non-conversation terminal/search/settings fields are excluded.

**R07 — Save selection.** “Save selection as snippet” seeds only captured non-whitespace selected text; Name empty; explicit review/Save; no cut/clear/send. No selection: disabled with “Select text in the composer first”. Oversized selection may open editor with validation but must be shortened before Save, not silently truncated. Support backward selection and Tab/Shift+Tab focus changes. Changed owner/text invalidates capture and asks reselection; do not substitute whole-draft capture.

**R08 — Toolbar/slash discovery.** Snippets stays distinct from Saved drafts; `/snippets` is a builtin, not a skill. Existing parser recognizes invocation. Leave token intact while picker/management open and on cancel. On successful slash insertion only, replace precisely the recognized invocation span using existing token-helper delimiter semantics; surrounding text unchanged. Hint “Choose text to replace /snippets”. New/Manage never consumes token. Literal inserted slash text must not dispatch a command or bind skills.

**R09 — Search/states.** Local case-insensitive normalized literal substring search across Name/Body; sort normalized name ascending, ID tie-break. All ≤100 filtered records scroll, no pagination/network/regex/usage writes. Empty: “No snippets yet. Save text you reuse across conversations.” New available. No matches: “No snippets match your search.” Clear search/creation available. Loading/error distinct from empty; stale results not insertable. Query resets per open.

**R10 — Keyboard/accessibility.** Tab reaches named actions; no new global shortcut (avoid history Ctrl+R, search Ctrl+K, stop Escape). Slash arrows/Enter provide accelerator. Picker initial focus Search; Up/Down active result, Enter insert, Escape close; Home/End navigate results only in result-navigation context, not editing search. Dialog + combobox/listbox semantics, no nested buttons inside options. IME/composition/keyCode229 owns keys. Outside picker preserve native undo, send/multiline/prediction keys. Restore original range on cancel, new caret on insert, safe control if owner gone. Polite announcements name action, never full body. Screen reader/forced-color/touch checks required.

**R11 — Undo.** Prefer proven native textarea undo/redo on supported Chromium/Electron; setRangeText or feature detection alone proves nothing. Exactly one owner update. If native path unreliable, provide bounded explicit Undo insertion for last insert, restoring prior text/range only while owner/post-text/revision match. Any later edit, insertion, send, transfer or unmount invalidates fallback. Never undo unrelated typing/metadata or hijack general Ctrl/Cmd+Z on fallback. Transient receipt in memory only.

**R12 — Windows/conflicts.** Reuse journal local subscription/BroadcastChannel; durable refresh at open/focus/visibility recovery catches missed events. Mutations generation-CAS, no blind whole-array overwrite or automatic stale retry. Dirty editor survives remote updates with “Snippets changed in another window. Review and save again.” Changed/deleted selected record disarms insert until refresh/reselection. No resurrection after delete. Channel contains keys/generations, not body.

**R13 — Honest recovery.** Announce Save only after durable commit. Unsupported version/wrong profile/corruption/quota/IDB/read/write failure is error, never empty overwrite or “saved for session”. Preserve raw bytes/form; Retry, no automatic reset/salvage. Insertion requires validated current generation. Rejected pre-edit owner leaves draft intact; failure persisting an accepted edit retains visible text and ordinary owner recovery warning, never repeats insertion automatically.

**R14 — Privacy/performance.** No body in logs/analytics/channel/URL/issue evidence/settings telemetry; synthetic fixtures. React text/pre-wrap, no HTML/Markdown execution, templates/includes/variables. Bound payload before expensive processing; direct key lookup, no bulk journal scan. Load on demand, local search; target 100-record render/search <100ms on documented reference hardware (measure, do not claim now). Warn “Stored locally in this profile. Do not save secrets.” No automatic secret trimming.

**R15 — Regression/review.** Preserve Saved Draft ownership/rich restore, slash model/mode/skills, history and prediction. Pure/browser tests cover normal/empty/error/conflict, both owners, undo, no-send, window sync, keyboard/motion/narrow layout. T08 sends finished implementation to front end team for recorded verdict. Mock browser coverage is not live host/packaged verification; PR existence is not merged/verified-on-main evidence.

### Out of scope (v1)

- History ingestion/ranking/Up-arrow (#1397/#1466); product starter prompt redesign (#1295).
- Saved Draft widening/migration; rich context, grants, skill bundles, tool/account/model settings or source custody changes.
- `.prompt.md` import/export, YAML, executable frontmatter, arguments/templates, file includes/watchers, slash-per-snippet namespace, filesystem/server routes.
- Cloud/device/team sharing, export UI, pin/reorder/tags/folders/favorites, AI suggestions. Existing journal backups are not a new supported snippet export contract.
- Global shortcut/rebindable preference, rich-editor replacement, broad ComposerView refactor. Terminal/adjunct side editors excluded unless T01 proves they are ordinary editable conversation owners.

### User flows

1. **Create:** Snippets → empty state → New → Name “Review tests”, Body “List missing tests for the changed behavior.” → Save awaits storage → list entry. Composer unchanged; reopen/relaunch preserves library.
2. **Reuse:** Thread B/different account/project/copy → place caret within draft → search `tests` → Enter. Exact splice/caret, metadata unchanged, zero send. Repeat with selected text/multiline body.
3. **Selection:** Highlight one sentence backward/forward → Tab to Snippets → Save selection → exact Body, blank Name → explicit Save. Composer unchanged; choose insertion separately later.
4. **Slash:** Parser-supported `/snippets` → builtin → same picker; token remains until successful insert. Cancel/New/Manage retain token; insertion replaces token span only. Subsequent normal Send is separate.
5. **Maintain:** Manage/Edit changes Name/Body and order; old inserted text stays. Delete confirms and commits; Cancel keeps record. Dirty close asks discard; no background overwrite.
6. **Concurrency:** A/B load generation g; A saves; B list refreshes but dirty form remains. B reviews latest, explicitly arms/retries own edits. Deleted ID cannot be overwritten; Save as new requires new ID/unique name.
7. **Undo:** Cancel restores old range; insert then native undo/redo is one step. Forced fallback Undo insertion restores only while unchanged; typing invalidates it rather than deleting new work.

### Error and recovery

| Condition | Response / recovery | Preserve |
|---|---|---|
| Invalid fields/count/bytes | Inline linked explanation/counters; focus first invalid on submit; Save disabled; shorten/delete manually | Existing library, draft, form |
| Load/version/corruption | ErrorState + Retry; no Reset or misleading empty success | Raw stored value |
| CAS false/remote delete | Refresh list, retain fields, explicit review/retry; missing ID only explicit new copy | Other window commit; no resurrection |
| Durable write rejected | Keep editor open, Retry, no saved announcement/count increment | Fields and old library |
| Target/text/range changed | “Conversation or draft changed. Close snippets and choose an insertion point again.” | New owner and metadata |
| Selected record changed | Refresh preview, disarm Enter until reselection; deleted unavailable | Draft |
| Draft persistence after edit fails | Existing owner warning; keep visible inserted text, no repeated insert | Recovery custody |
| Composition / Escape | IME owns key; later Escape closes only active layer, not stop/send | Composition/running agent |
| Missed channel | Actual durable refresh on open/focus; conflict instead of cached overwrite | Latest durable library |

## REPO_MAP (verified at the baseline SHA unless marked discovery)

| Path / symbols | Verified role / change boundary |
|---|---|
| `apps/web/src/App.tsx`, `function Composer`, `updateDraft`, `input`, `draftLatest` | Controlled Message textarea; updateDraft dismisses prediction and delegates sharedComposers.edit or journalWrite; leading toolbar slot contains Saved drafts/Attach. SavedDraft owner profileId uses window.location.origin. Add snippet UI through owner callback, not direct draft:* writes. |
| `apps/web/src/ComposerView.tsx`, `ComposerView` | Presentation-only form wrapper; keep it free of storage/draft ownership. |
| `apps/web/src/ScopedConversationComposer.tsx`, `ScopedConversationComposer` | SharedAgentComposers, state.draft, composers.edit; held includes readOnly/archive/detached/pending/closing; local scope/epoch fence. Snippets independent of optional savedDraftOwner. |
| `apps/web/src/agents-workspace/composer.ts` | Shared owner imported by both paths. Exact edit acceptance/prepare/retry contract and caller audit are T01 discovery, not an invented new API. |
| `apps/web/src/ComposerToolbar.tsx` | Shared toolbar, App supplies leading slot. Scoped actions have separate layout. |
| `apps/web/src/SavedDrafts.tsx`, `SavedDrafts`, `SavedDraftsOwner` | Existing Popover/Modal and guarded async actions, caret capture, focus-after-native-modal layout effect. Copy interaction patterns, not rich restore behavior. |
| `apps/web/src/saved-drafts.ts`, `SavedDraftOwner`, `savedDraftOwnerKey`, `restoreSavedDraftText` | Strict profile/account/thread/project/workingCopy owner; references/skills/excerpts/source context and journal-CAS restore. Do not reuse schema/restore for snippets. |
| `apps/web/src/journal.ts`, `journalReadRecord`, `journalCompareAndSwap`, `journalSubscribe` | IDB generative-harness-journal v1/entries; cached reads, generation CAS, local subscriptions, harness:journal-changes:v1 channel. journalWrite stages localStorage harness:journal-pending:* recovery; CAS publishes after durable commit. New library uses CAS. |
| `apps/web/src/ComposerCommands.tsx`, `ComposerCommandsHandle.keyDown`; `composer-commands.ts`, `commandToken`, `replaceCommandToken` | Builtins model/plan/default, skill catalog, selection/IME navigation and token replacement. Add deferred snippets callback. Exact token delimiter semantics T03 discovery. |
| `apps/web/src/keyboard-bindings.ts`, `KEYBOARD_BINDINGS`, `shortcutKeys`, `ariaKeyShortcuts` | Registry owns canonical chords/formatting; no new global binding planned. Reconcile popup documentation with registry tests if required. |
| `packages/contracts/preferences.ts`, `preferencesSchema`, `UiPreferences`, `mergePreferences` | Strict presentation/keybindings/sendShortcut/composerPredictions schema, not arbitrary text library. No apps/web/src/preferences.ts exists. |
| `packages/core/service.ts`, settings.update; `packages/storage/store.ts`, `Store` | Service reads/writes settings/global via Store; dataDir constructor. Preferences service-backed, not arbitrary browser localStorage. Avoid snippet payload in shell settings/snapshots. |
| `apps/web/src/api.ts`, `getShellSettings`; `apps/server/server.ts` | Existing /api/shell-settings reader/server validates preference fields; no new route required. |
| `apps/desktop/main.ts` | Desktop userData/sessionData profile root, ordinary BrowserWindow partition persist:harness. Origin/partition isolation, not new portable profile UUID or account identity. |
| `packages/ui-shell/Popover.tsx`, `Popover`; `Modal.tsx`, `Modal`; `Feedback.tsx`, `ErrorState` | Shared positioning/portal/exit retention/native modality/focus/error primitives. |
| `packages/ui-shell/tokens.css`, `controls.css`; `apps/web/src/styles.css`, `saved-drafts.css`, `composer-commands.css` | Existing tokens and closest menu/library visual patterns. New snippet classes below are proposed, not baseline CSS. |
| `tests/saved-drafts.test.ts`, `saved-drafts-suspended-audit.test.ts`, `composer-commands.test.ts`, `keyboard-bindings.test.ts` | Identified focused regression paths; no executed results claimed. |
| `tests/e2e/saved-drafts.spec.ts`, `saved-drafts-fixture.tsx`, `saved-drafts.vite.config.ts`, `saved-drafts.playwright.config.ts` | Existing App/shared-owner synthetic fixture pattern and scoped browser config. Create separate snippet fixture, do not silently alter saved-draft evidence. |
| `tests/e2e/composer-commands.spec.ts`, `composer-prediction.spec.ts`; `scripts/browser-suites.ts`, `scripts/test-browser.ts` | Scoped regression specs and browser suite registry/--suite runner. |
| `scripts/public-source-files.json`, `CONTRIBUTING.md`, `.github/pull_request_template.md`, `package.json` | Source manifest, scope/evidence requirements and verified root commands. |

**Proposed paths, not baseline facts:** apps/web/src/prompt-snippets.ts (schema/store/search), snippet-insertion.ts (range/native adapter), useSnippetInsertion.ts (capture/fence/undo), PromptSnippets.tsx (picker/manage), prompt-snippets.css; tests/prompt-snippets.test.ts, tests/snippet-insertion.test.ts and tests/e2e/prompt-snippets.* fixture/config/spec family. T01 checks collisions; no server/contracts addition expected.

**Integration status:** API-read #1466 file list overlaps App.tsx, ScopedConversationComposer.tsx, keyboard-bindings.ts, browser registry/manifest and adds history hook/model/search/CSS/tests. Its journal reports mocked results/review handoff; these are upstream claims, not rerun here. Not merged in baseline. #1295 body specifies four starter prompts filling composer/focus/caret end and setup card; linked implementation state not exhaustively traced. T01 refreshes both before shared edits.

## DESIGN

### Data

**D01 — Journal over preferences.** Strict service preferences are delivered through settings/global/shell snapshots. Snippets are local authored text requiring CAS; journal already persists draft-adjacent text and notifies windows. Add a namespaced record, no database-version change/server route/contracts extension. localStorage staging is journal implementation detail, not a second snippet store.

**D02 — Identity.** Production profileId=window.location.origin within storage partition, following App SavedDraft convention; independent of SavedDraftOwner availability. Synthetic tests can supply profiles. No promise across dev ports/browsers/devices/layout profiles. T01 checks newer main for stable profile ID; if found, revise full plan/migration before silently changing keys.

Proposed new schema (JournalRecord supplies generation, not duplicated revision):

```ts
type PromptSnippet = {
  id: string;        // immutable crypto.randomUUID()
  name: string;      // trimmed/NFC, 1–80 code points
  body: string;      // exact plain text, 1–20,000 UTF-16 units
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime, explicit edit only
};
type PromptSnippetLibrary = {
  version: 1;
  profileId: string;
  records: PromptSnippet[]; // <=100, unique IDs and normalized names
};
// key: 'prompt-snippets:v1:' + JSON.stringify([profileId])
```

Use strict zod (existing dependency); reject extra metadata, invalid IDs/dates, duplicate IDs/names, wrong profile/version and all R03 limits. Measure aggregate with TextEncoder, not string.length. Name controls rejected; body NUL rejected to avoid native-edit discrepancies, tabs/newlines allowed. Normalize names/search, never body. One normalization/sort helper, no writes on reads/search/use. Suggested new exports: snippetLibraryKey, parseSnippetLibrary, loadSnippetLibrary, createSnippet, updateSnippet, deleteSnippet, subscribeSnippetLibrary, filterSnippets. Missing record alone returns empty library. CRUD validates entire proposed value then journalCompareAndSwap(expectedGeneration); false=conflict, thrown read/write error=error. Delete last entry writes valid empty library to retain generation. Timestamps not conflict authority; no stale auto-merge.

**Freshness gap explicitly scoped.** journalReadRecord prefers memory, so repeated calls are not durable refresh. T02 must test missed-event recovery. If no safe refresh API exists on integration baseline, add narrowly scoped proposed journalRefreshRecord in journal.ts: durable read with existing generation reconciliation, respects pending/staged/failed local writes, no downgrade/clearing draft recovery. This is the only anticipated shared journal edit, needs regressions/review. Do not claim cache-only read catches missed broadcasts. If this requires broad recovery redesign, BLOCK for revised design instead of improvising.

### Control flow

**D03 — Explicit owner boundary.** PromptSnippets receives profileId, input ref, target signature/epoch, current editable predicate and owner edit callback, not submit/ensureThread/account/full SavedDraftOwner. Capture `{element,targetSignature,text,start,end,direction,draftRevision}` on textarea selection/input/keyup/pointer-up; retain valid capture for keyboard Tab, pointerdown captures before blur. Never overwrite it with zero offsets from another control. Without valid capture, focus owned textarea and request insertion-point selection rather than guessing start/end. Owner change clears capture/receipt; future editors need explicit adapters, not global querySelector.

States CLOSED→LOADING→READY/EMPTY/ERROR; per-open query/active ID. Manage closes picker and opens one native Modal; edit/delete/conflict/discard are subviews, not stacked modals. Return focus to prior row or Search on Back; no inserts during authoring. Remote generation change preserves dirty form/query but clears active insert until reselection. Error/loading cannot activate stale options.

Insertion transaction:
1. Consume activation synchronously; reject IME/held/disconnected/stale capture. Read latest validated record/generation; any await demands owner/text fence recheck. Changed record refreshes/disarms, never silently inserts new text.
2. Pure splice checks integer UTF-16 bounds/order/exact captured text. Toolbar uses captured range; slash uses validated parser invocation range. Preserve prefix/suffix and metadata; no body command parsing.
3. Close overlays and let native modal cleanup commit, then focus owned textarea. Final owner/text recheck immediately before DOM edit, no async gap between check and splice.
4. Preferred native insert-text path must preserve one-step undo/redo and controlled React state with exactly one normal onChange/owner edit. Deprecated document.execCommand('insertText',false,body) is a candidate for Chromium, not a browser guarantee. T03 proves it; synthetic InputEvent/setRangeText alone does not create native undo.
5. If unsupported/unreliable, computed splice/setRangeText + one owner callback and post-commit caret, with explicit guarded Undo insertion receipt. Force both paths in tests. If a native attempt changes unexpected text, stop/error, do not splice fallback again onto unknown text.
6. Respect actual async owner acceptance discovered T01; surface rejected edits. Announce inserted name after expected visible result. If persistence fails after acceptance retain visible draft/owner warning; never replay automatically. No library mutation on use.

**D04 — Deferred slash handoff.** Add snippets builtin and proposed onSnippets(invocation) callback. Branch dismisses own menu signature and skips ordinary onDraft(replaceCommandToken)/mode dispatch. Original token survives picker/management/cancel; success replaces exact validated span with existing delimiter semantics. Literal programmatically inserted `/...` must not reopen/execute command until subsequent user edit. T03 verifies parser-supported positions; do not invent token boundaries.

**D05 — Key/history precedence.** Picker-focused keys stop propagation after composition check. Outside it keep existing textarea IME/side-command/slash/prediction/send precedence. No new global chord; Up/Ctrl+R/Tab belong to existing behavior while closed. After #1466 integration, insertion is a normal explicit draft edit that exits history browsing and dismisses prediction. Preferred merge order: history lands, snippets rebases and reruns combined regression. If still open, coordinate shared hunks/authorized integration branch; do not copy history code or claim it exists on main.

**D06 — Conflict review.** Editor stores base record/generation; remote refresh updates list, not fields. Conflict shows latest plain text alongside retained edits. “Use my edits” arms explicit Save against reviewed latest generation; another conflict repeats. Missing original ID disables overwrite; “Save as new snippet” creates UUID after unique-name/count validation. Delete confirmation carries generation; stale delete returns to list, never deletes unseen edit automatically.

**D07 — Undo.** Native insert must be one undo step between surrounding typing, including slash span replacement. Fallback in-memory before/after text/range + target revision allows one Undo insertion while unchanged, no timer. Any later edit/send/transfer/unmount invalidates; no general undo manager or persisted history. Undo uses same owner callback and restores original range without metadata/library changes.

### Security boundaries

- Profile key + strict profile match and browser partition isolate local data; not encryption or a new host authorization boundary. No real secrets in fixtures/evidence.
- No SavedDraft schema/object spreads; no grants/skills/settings carried. Existing metadata is preserved by text-only owner edit, not serialized into library.
- Literal HTML, paths, mentions and slash text render as React text/pre-wrap, never execute/resolve. Later explicit Send uses existing runtime admission, no automatic approvals.
- No body in channel/analytics/console/search URLs or errors. Direct bounded key lookup, no journal-wide text scans. Only supplied textarea can be modified.

### Migration and rollback

No migration/ingestion from drafts/history/starters. Missing record initializes in memory; first explicit Save writes. Existing journal DB v1 unchanged. Unknown snippet version/corrupt bytes are read-only error until separately reviewed migration; no Reset/partial salvage. Rollback removes feature entrypoints/files but leaves namespaced data and ordinary inserted draft text untouched; no DB downgrade or pending-recovery deletion. Additive freshness helper preserves old clients. Requirement changes require complete issue body + source revision r2+, append-only affected-task journal, not a progress comment alone.

## VISUAL_DESIGN_AND_MOTION

### Snippets in the composer

Visible **Snippets**, type=button, existing `.quiet` plus proposed `.prompt-snippets-trigger`; after Saved drafts/before Attach in App, after optional Saved drafts in scoped actions. Remains available without SavedDraftOwner. Font 12px/min-height `--ui-row-compact` (32px), adapt existing comfortable/touch 36/44px density conventions. Wrap toolbar at narrow widths, retain label. Tooltip “Insert reusable text at the cursor”; disabled reason reflects actual custody. aria-haspopup=dialog, expanded/controls. Empty library not disabled, no count badge.

Keep textarea/.composer appearance (styles.css surface/control-border, 15px radius) unchanged. No snippet metadata chip. Fallback caption “Inserted [name] · Undo insertion”, 12px muted, quiet named button; one receipt/live region, visual ellipsis but full accessible name. No animation over draft text.

### Snippets popover and management view

**Picker.** Existing Popover, closest owned form anchor, above/start, width400px, measured height≤420px; primitive clamps to viewport with `--ui-popup-gutter`8px. Fit 320px viewport/200% zoom without horizontal scroll. Proposed `.prompt-snippets-popover` mirrors saved-drafts-popover: `--ui-panel-inset`12px padding, `--surface`/`--text`, 1px `--border`, `var(--control-radius,8px)`, `--elevation`. Inherit layer `--ui-popup-layer`80, no bespoke z-index/positioning.

Header h2 “Snippets”14px/600. Full-width Search label/input placeholder “Search names and text…”, 8px gap (`--ui-space-2`); helper “Text only · Local to this profile”12px `--muted`. Reuse input styles (control-border, 9px11px padding, user radius overrides). Combobox controls listbox; one option per record, no nested action buttons. Name13px/500, body two-line preview12px/1.5 muted, overflow-wrap:anywhere; full name accessible. Row≥52px with 8px12px padding, divider border. Active selection-bg/selection-border/selection-ink, hover hover token; focus outline independent of color. Instant nearest active-row scrolling, no per-arrow smooth motion. Announce result count, not full body.

Footer divider/8px top padding, wrapping New snippet / Save selection as snippet / Manage snippets; existing secondary/quiet classes. Selection-disabled explanation adjacent. Hint “Enter inserts · Esc closes” or slash replacement hint. Empty state16px vertical padding/exact R09 copy/New; no-matches Clear search; loading status “Loading snippets…”; ErrorState Retry, never stale interactive rows.

**Manage.** Existing Modal/native dialog; proposed `.prompt-snippets-dialog` width min(640px,100vw−32px), max-height calc(100dvh−50px), scrollable content, `--ui-dialog-inset`24px; no stacked native modals. Header “Manage snippets” + close. Local/privacy description, “N of100 snippets”, Search/New. Rows name/one-line preview plus separate Edit/Delete buttons with record name in accessible labels. Narrow single column/actions wrap; recovery/footer always reachable. Danger styling only destructive action, not entire list.

**Editor.** “New snippet”/“Edit snippet”; Name input/code-point counter N/80; Body textarea N/20,000 UTF-16 counter, plain-text explanation, minimum8 rows/about176px, vertical resize/scroll inside dialog, inherited prompt font. Initial focus Name; saving selection leaves it empty. Validation danger token + linked IDs, alert after interaction/submit. Actions right: Cancel secondary/Save snippet primary, gap8px; Saving… disabled while awaiting commit, no close/success until durable. Dirty-close subview: “Discard changes?” Keep editing initial focus/Discard. Retain form after error.

Delete: “Delete ‘[name]’?”; “This removes it from this profile's snippet library. Text already inserted in drafts is kept.” No full sensitive body. Cancel initial focus; after delete focus next surviving Edit or New. Conflict banner/subview shows latest plain pre-wrap plus retained form; Use my edits and Save as new when applicable; long text scrolls, recovery controls not pushed offscreen.

**Motion.** Reuse primitives, no second animation layer. Default picker enter180ms `--ui-motion-popup-enter`/`--ui-ease-enter` cubic-bezier(.16,1,.3,1), opacity0→1 with primitive above-side translateY4px/scale.98→identity; exit140ms `--ui-motion-popup-exit`/`--ui-ease-move` cubic-bezier(.4,0,.2,1). Popover retains exit; Modal uses controls.css/backdrop policy. Hover120ms `--ui-motion-hover`, press80ms `--ui-motion-press`; existing control transforms only. Results/filtering/text splice immediate, no stagger/typewriter/height tween. Undo receipt may fade160ms `--ui-motion-status`; invalid receipt disappears immediately.

OS reduced or app data-motion=reduced: opacity-only80ms press token, no transforms/backdrop transitions. Motion off/panelAnimations=false: no feature animations/transitions. Honor motionSpeed through existing presentation tokens, not double JS multiplication. T06 verifies actual app selectors; feature-local rule only if new child not covered, no global motion changes. Forced-colors uses Canvas/CanvasText and Highlight/HighlightText, explicit border/focus outline. Never remove outline without equivalent. All tokens above verified in tokens.css/styles.css; snippet classes are new proposals.

## EXECUTION_DAG

All tasks **NOT_STARTED**. Graph T01→(T02,T03)→T04→T05→T06→T07→T08. T02/T03 may parallelize only distinct files after agreed props. T04 owns App/new UI; T05 scoped wiring after stable handoff; T06 CSS/accessibility after release of JSX scope. Serialize journal/ComposerCommands/manifest edits. Workers read complete canonical issue/source/journal, claim scope, publish durable milestone/error checkpoints and RELEASE on stop. This document does not itself authorize implementation.

### T01 Baseline, ownership and integration contract

- **Goal/deps:** Accepted plan and authorized claim; no code. Refresh main, related work and actual owner/edit contracts.
- **Files/steps:** Read both composers/all scoped callers (rg), agents-workspace/composer.ts edit/prepare/retry, commandToken helpers, journal CAS/cache/channel, App/desktop profile identity. Inventory ordinary editable targets/exclusions and all held/epoch gates. Refresh #1466/#1397 journal/files and #1295 linked layout work. Check proposed filenames/collisions and documented environment versions.
- **Inputs/outputs/ownership:** r1+baseline→surface inventory, exact async owner acceptance, feature props, native-undo experiment outline, merge order/current SHAs. Investigation only; no silent new controller API. If stable profile ID appeared, revise schema/migration plan first.
- **Tests:** Static trace proves each target gate; disprove assumption cached reread is durable; parser boundary/Unicode/whitespace audit; identify target error rejection vs post-edit persistence.
- **Done when:** Issue has verified props/coverage/merge-order and resolved unknowns or BLOCKED affected tasks. No implementation verified claim.
- **Handoff:** T02 storage/freshness; T03 owner/range/command; T04 final props/upstream status. Durable SHA references and explicit recipient ACK, then release research scope.

### T02 Validated profile library and concurrency

- **Goal/deps:** T01; schema/limits/search/store independent of composer draft edits.
- **Files/steps:** New prompt-snippets.ts + tests/prompt-snippets.test.ts, source manifest entries; existing journal CAS/subscriptions. If required, narrow journalRefreshRecord plus existing journal regressions discovered by imports, serialized shared-file ownership. No prefs/contracts/server edits.
- **Inputs/outputs:** profile/unknown record/expected generation→strict library or validation/conflict/storage result. Enforce R03/D01-D02, direct key, durable refresh, no writes on read/use/search, delete-final empty record. Proper unsubscribe.
- **Tests positive:** CRUD/reload/self-rename, same body distinct names, Unicode/multiline, limits exactly, normalization/order, profile keys, local notification. Empty/error: missing valid empty; wrong profile/version/extra rich fields/duplicates/cap+1/body NUL/whitespace/UTF8 bytes reject unchanged. CAS/delete race no resurrection; write/read throw retains data; missed broadcast fresh read does not downgrade pending/failed journal work.
- **Done when:** Focused unit tests pass, no-write and retained-raw-byte assertions, source manifest valid, channel contains no body; journal helper regressions if changed.
- **Handoff:** T04 stable functions/types/error results; T07 corrupt/quota/conflict fixtures and freshness test hook. Publish exact commands and commit-pinned code, release library scope.

### T03 Selection insertion, undo and slash handoff

- **Goal/deps:** T01; pure splice/owner-safe adapter/hook and deferred slash contract; no management UI.
- **Files/steps:** New snippet-insertion.ts/useSnippetInsertion.ts, tests/snippet-insertion.test.ts; minimal ComposerCommands.tsx and composer-commands.test.ts edits; helper extraction in composer-commands.ts only if necessary. Manifest sources. Coordinate isolated browser/native undo fixture with T07; no global chord.
- **Inputs/outputs:** Explicit textarea/text/range/owner fence/body or parser invocation→one accepted edit/new caret/guarded undo or stale error. Token consumption deferred, programmatic command signature dismissed.
- **Tests positive:** Empty/start/middle/end, forward/backward/full selection, emoji/multiline, exact text/caret, exactly one owner update, native one-step undo/redo, forced fallback restore/range. Negative: invalid/stale range/text/epoch, disconnect/read-only/IME, owner changes across awaits, pre-edit reject/post-edit persistence error, undo after later edit/send invalid. Zero send/grant/skill calls; slash cancel/manage unchanged, accepted exact-span only, existing model/mode/skills unaffected.
- **Done when:** Pure tests and supported-browser native/fallback experiment output recorded; controlled-state/native undo not assumed. If native fails select safe explicit fallback, record limitation before wiring.
- **Handoff:** T04/T05 stable capture/edit/undo and onSnippets callback; T07 reproducible native/fallback/ownership tests. Shared API widening requires revised plan, not invented method.

### T04 Main composer picker and authoring management

- **Goal/deps:** T02+T03, T01 merge order; complete shared UI + main/new-task wiring.
- **Files/steps:** New PromptSnippets.tsx, App.tsx leading slot/updateDraft/custody predicates; source manifest. Shared Popover/Modal/ErrorState, loading/search/listbox/new/manage/edit/delete/conflict/discard/save-selection. Initial feature classes handed to T06. ComposerView stays presentational.
- **Inputs/outputs:** Store+insertion contract→main/new-thread use without ensureThread or full SavedDraftOwner. Every awaited action rechecks latest owner; picker keys cannot submit/stop.
- **Tests:** Create/rename/edit/delete/reopen, save-selection exact and no-selection disabled, empty/no-matches/loading/errors/quota/conflict fields retained, exact splice/caret/cancel, no sends; account/thread changes reuse library, no-thread insert doesn't create thread. Saved drafts untouched.
- **Done when:** All authoring actions await durability, focus after native close deterministic, no-thread/context-loading behavior honest; retained forms and draft errors covered.
- **Handoff:** T05 final props/example; T06 DOM/classes/state matrix; T07 actual component fixture. Release App/JSX scope only with current SHA/outstanding errors recorded.

### T05 Scoped conversation parity and upstream reconciliation

- **Goal/deps:** T04+T03; every T01-audited scoped conversation uses same feature; reconcile chosen history baseline.
- **Files/steps:** ScopedConversationComposer.tsx, audited callers only if necessary; App hunk only after T04 release. Profile independent of optional savedDraftOwner, actual shared owner edit acceptance, held/ready/retry/epoch predicates. Do not disable editable next draft merely for working.
- **Inputs/outputs:** Stable props→main/scoped parity, explicit surface coverage. No invented snapshot/controller API; unexpected shared changes require revised design.
- **Tests:** Main/scoped range/slash/selection/undo; read-only/archive/detached/pending/closing/epoch during await blocks; working editable allowed, retry payload protected; no metadata changes/refocus new owner. Integrated history exits on insert, prediction dismisses, Ctrl+R/Up/Down still work normally.
- **Done when:** Inventory has test/evidence or explicit exclusion per surface; focused owner custody regressions pass. Mock parity not claimed as live verification.
- **Handoff:** T06/T07 target fixtures/current upstream SHAs/remaining live checks, release scoped wiring scope.

### T06 Visual, motion and accessible interaction finish

- **Goal/deps:** T04+T05; implement VISUAL_DESIGN_AND_MOTION, not defer design to another team.
- **Files/steps:** New prompt-snippets.css/manifest; coordinated PromptSnippets.tsx labels/semantics/focus. Existing tokens/controls, no global token changes/custom overlays. Verify real presentation selectors/density/user radius.
- **Inputs/outputs:** Functional UI→specified states/responsive styling/accessible keyboard flow.
- **Tests:** Light/dark1440×900/420×800/320px+200% zoom, compact/comfortable/touch, long Unicode/20k body; empty/loading/error/conflict/delete/dirty-close/disabled. Keyboard focus/IME/native modal, screen reader labels/live region, forced colors. Full/reduced/off animation/exit inspection; screenshot interactive states, not merely build/page load.
- **Done when:** No clipping/inaccessible recovery, correct durations/easing, no spatial reduced/off motion, no accidental send. Save persistent synthetic screenshots/animation evidence and explicit visually unverified states.
- **Handoff:** T07 frozen UI SHA + state/evidence matrix; T08 receives through final bundle. Fix feature-local findings, no incidental global restyle.

### T07 Browser integration, regressions and release evidence

- **Goal/deps:** T06; prove acceptance, prepare authorized reviewed implementation PR/evidence.
- **Inputs/outputs:** Frozen T06 build and synthetic fixture contracts → reproducible acceptance results, durable evidence bundle and explicit release-blocker list; T07 owns only tests/registry/evidence, coordinates any feature fix with its source owner.
- **Files/steps:** Proposed tests/e2e/prompt-snippets.spec.ts, -fixture.tsx, .vite.config.ts, .playwright.config.ts; follow saved-drafts pattern, verify free port, register scripts/browser-suites.ts/source manifest. Fixture uses actual feature/both real owner paths, real IDB/channel, synthetic records and controllable errors/held transitions, no fake passing insertion stub.
- **Tests positive:** CRUD/reload, cross-context reuse/profile isolation, exact splice/range/native+fallback undo, selection/slash, no-send and metadata snapshots, two-page sync, 100-record measured search/render. Negative: malformed/oversize/version, blocked IDB/quota/CAS, concurrent edit/delete/missed channel and no BroadcastChannel, stale owner during read, IME, all custody gates, undo invalidation.
- **Regression:** Commands in VALIDATION, actual changed journal/shared-owner tests; saved-drafts/slash/prediction browser suites; history mandatory once integrated. Reproduce failures on base before calling unrelated; never weaken tests to pass.
- **Done when:** Every R row passed or explicitly release-BLOCKED; versions/commands/counts, performance and screenshots/traces persisted. Designated Windows verifier repeats packaged create/relaunch/cross-window/insert/undo/transfer smoke. Mock/Linux tests do not prove live host/OS persistence. PR/CI/review states distinct, no secret/generated output committed.
- **Handoff:** T08 gets pinned implementation PR/SHA, acceptance table/artifacts/upstream state, remaining risks, exact review flow. Publish checkpoint/RELEASE; receiver ACK required.

### T08 Front end team review (required by the maintainer)

- **Goal/deps:** T07 complete; final task sends finished work to front end team, not unspecified design request.
- **Files/steps:** Review actual pinned build/PR against visual spec and flows; record named verdict on canonical issue/PR. No scope expansion. If no separate team handle, coordinator routes authorized front-end reviewer pool and records recipient/ACK, not automatic acceptance. Corrections return to implementing worker, impacted checks/evidence rerun.
- **Inputs/outputs:** Final PR/test/screenshot bundle→accepted verdict or actionable fixes.
- **Tests:** Reviewer performs prefix/suffix selection insertion/cancel/no-send; examines empty/edit/delete/conflict, main/scoped, focus after modal, keyboard/IME/undo, narrow/dark/density/forced-color and full/reduced/off. Build or static screenshot alone insufficient.
- **Done when:** Verdict/corrections recorded, CI/review gates addressed; normal authorized merge only. Record merge SHA separately, post-merge focused smoke before verified-on-main claim; issue closure only if authorized and all acceptance met.
- **Handoff:** Maintainer/release coordinator receives final matrix/verdict, merged/unmerged state and residual platform checks. Final issue act RELEASE OWNER=NONE, clear own assignee/in-progress claim without clearing another worker's scope.

## VALIDATION

### Commands (planned, none executed yet)

Future implementation checks, **not results of planning**. Root package.json specifies pnpm10.30.3/Node≥24.10.0; follow docs/getting-started.md for platform prerequisites. New test paths/suite names valid only after creation/registration. Existing scripts verified: typecheck=tsc --noEmit, lint=tsx scripts/lint-ui.ts --check, build=node scripts/build.mjs, test:browser=node --import tsx scripts/test-browser.ts; test builds credential lease/widgets before Vitest.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build:widgets
pnpm exec vitest run tests/prompt-snippets.test.ts tests/snippet-insertion.test.ts --maxWorkers=1
pnpm exec vitest run tests/saved-drafts.test.ts tests/saved-drafts-suspended-audit.test.ts tests/composer-commands.test.ts tests/keyboard-bindings.test.ts --maxWorkers=1
pnpm typecheck
pnpm lint
pnpm build
pnpm test:ui-guard
pnpm test:browser --suite prompt-snippets --list
pnpm test:browser --suite prompt-snippets
pnpm test:browser --suite saved-drafts
pnpm test:browser --suite composer-commands
pnpm test:browser --suite composer-prediction
pnpm check:docs-links
```

T01/T02 discover exact existing journal/shared-owner tests by imports, append focused paths and record actual command; no invented test filename. After #1466 actually integrated, mandatory `pnpm exec vitest run tests/prompt-history.test.ts --maxWorkers=1` and `pnpm test:browser --suite prompt-history` (absent at baseline). Run source-manifest checks per CONTRIBUTING, discovering exact test command. Full pnpm test/test:e2e are broader required CI/release checks, not substitutes for focused interaction evidence.

Freeze edits before visual verification. Two same-profile windows=two pages same context/origin; isolated profile=separate browser context, also test synthetic profile keys. Count/intercept sends, no real model invocation. Assert exact text/range and metadata before/after. Real IDB/CAS/channel for integration, not only mocks. Windows packaged smoke: create/relaunch/two windows/range insert/undo/transfer with synthetic data; report live host/OS checks separately from fixture.

Bundle commit/PR, OS/Node/pnpm/browser, commands/counts, synthetic seed/size, screenshots theme/viewport/state/motion, conflict/owner-race/undo traces, no-send assertions, measured performance and skips. Persistent ignored local evidence plus approved durable review artifacts; private/expired paths alone are not remote handoff. Never inherit another PR's claimed PASS as independent evidence.

### Acceptance matrix

| R | Tasks | Positive evidence | Empty/error/negative evidence |
|---|---|---|---|
| R01 | T02,T03,T04,T07 | Explicit Save one strict text record, literal slash/HTML/path | No auto-ingest/rich metadata, zero grant/skill/settings/send calls |
| R02 | T01,T02,T04,T05,T07 | A→B account/project/copy reuse/relaunch | Separate partition/profile empty, no new route/snapshot body |
| R03 | T02,T04,T07 | Boundary count/name/body/bytes valid, exact body whitespace | Cap+1/duplicate/empty/corrupt rejects unchanged, no eviction |
| R04 | T02,T04,T06,T07 | CRUD/rename sort/focus next | Cancel/discard/delete cancel/error retained; old inserted text intact |
| R05 | T03,T04,T05,T07 | Exact prefix+body+suffix/caret/metadata | No send/ensureThread/implicit replace; stale capture blocked |
| R06 | T01,T03,T05,T07 | Main/new/scoped and working editable next draft | Held/retry/epoch/unmount gates; other input untouched |
| R07 | T03,T04,T05,T07 | Forward/backward selected text seed, explicit Save | No selection disabled, stale/oversize not truncated/substituted |
| R08 | T03,T04,T05,T07 | Toolbar/slash same picker/token-only success | Cancel/manage preserve token; literal slash inert; other commands pass |
| R09 | T02,T04,T06,T07 | Name/body literal search/alpha order/scroll | Distinct empty/no-match/loading/error, no network or stale activation |
| R10 | T03,T04,T05,T06,T07,T08 | Keys/focus/labels/active descendant/touch/forced colors | IME owns229; popup never sends/stops; closed picker leaves keys |
| R11 | T03,T04,T05,T07 | Native one-step undo/redo; forced fallback restore/range | Later edit/send/transfer invalidates fallback, unrelated work intact |
| R12 | T02,T04,T07 | Two-page commit sync/missed-event durable refresh | Stale edit/delete CAS/no resurrection, dirty form retained, no body channel |
| R13 | T02,T03,T04,T07 | Retry/latest/awaited Save/visible accepted edit | Corrupt/version/blocked/quota not empty/saved; raw bytes preserved |
| R14 | T02,T03,T06,T07 | Text rendering/local search/bounded measured100-record latency | No execution/telemetry/URL/secret evidence; oversized load bounded |
| R15 | T01,T05,T07,T08 | Regressions/integrated history/artifacts/named verdict | Skips/mock/live explicit; no close/main claim before gates |

Release requires all rows supported by checks/review, not just queued CI. Custody/storage/conflict/no-send failures block. Native/fallback and full/reduced/off both exercised. Performance misses require measured fix or accepted full plan revision; Windows/live persistence cannot be inferred from Linux mocks.

## STATE

- **Researched/decided:** Static baseline/template, composer and Saved Draft boundaries, journal CAS/channel/cache, preferences service storage, desktop partition, CSS/motion tokens/root scripts inspected; related issue/PR bodies/file list/history journal and external sources read. D01–D07/R01–R15 are chosen v1 design, not existing implementation.
- **Implemented/verified:** None; T01–T08 NOT_STARTED. No feature/unit/browser/live/visual/performance checks executed. Native undo, full surface audit, shared-owner acceptance and fresh-read integration remain explicit tasks. No application/manifest/config edits, commit/push/PR/issue writes.
- **Risks:** #1466 open composer/key overlap, mandatory merge order; #1295 linked implementation not exhaustively audited; inert skill-like text, CAS/cache stale forms, native undo reliability, origin/partition identity not portable UUID.
- **Artifacts/owner:** This issue body plus the SHA-pinned `docs/agent-plans/prompt-snippets.md` in the docs PR linked at the top; implementation unassigned.
- **Unfinished/blocked:** No implementation attempted or test failures claimed. Full shared-owner/caller/parser/platform audit deferred T01. Initial web preferences.ts assumption disproved; actual schema/storage mapped above.
- **Next:** Repo reviewers review and merge the docs PR. Then an authorized worker ACKs plan/issue/SHA and starts T01; remaining gates T02–T08, Windows/live smoke, CI/review/merge/post-merge verification/authorized closure.

## REFERENCES

1. [VS Code prompt files](https://code.visualstudio.com/docs/agent-customization/prompt-files), curl-read2026-11-21: manual reusable Markdown/slash invocation; workspace/user-profile scopes; current Local harness limitation/deprecation, skills recommendation. Mutable source; no claim of Gen format compatibility.
2. [Codex #39437](https://github.com/openai/codex/issues/39437), API-read2026-11-21, open request “Codex Desktop: add saved prompt favorites to the composer + menu”: save/pin/insert/rename/reorder/edit/delete, optional sync/multiple skills. Requested, not shipped. Gen excludes authority-bearing bundles/device sync/pinning.
3. [Gen #1397](https://github.com/skytuhua-org/Gen-V1/issues/1397), [#1466](https://github.com/skytuhua-org/Gen-V1/pull/1466), [file list](https://github.com/skytuhua-org/Gen-V1/pull/1466/files), head c0c3ebf05685bda2d3037421e64d9d3a728d43f9 open/unmerged at research. [Upstream checkpoint](https://github.com/skytuhua-org/Gen-V1/issues/1397#issuecomment-7061194953) reports author's tests/remaining platform gates, not independently rerun evidence.
4. [Starter prompts #1295](https://github.com/skytuhua-org/Gen-V1/issues/1295), open/body-read: hero/four composer-filling starter prompts/setup card; not user CRUD. Shared-layout integration discovery T01.
5. [Verified baseline tree](https://github.com/skytuhua-org/Gen-V1/tree/e883ac0327c834120d89c3697dec7380a342ba4d) applies to all REPO_MAP paths. Key sources: [App](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/App.tsx), [journal](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/journal.ts), [Saved Draft schema](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/saved-drafts.ts), [preferences](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/packages/contracts/preferences.ts), [UI tokens](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/packages/ui-shell/tokens.css).
6. [AGENTS](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/AGENTS.md), [contributing](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/CONTRIBUTING.md), [root scripts](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/package.json): complete issue/source/readback, source manifest, focused tests/evidence, journal claims/RELEASE and review protections remain required at execution/publication.
7. The [#1397 plan](https://github.com/skytuhua-org/Gen-V1/issues/1397) was used for section order and task shape only. This source contains all snippet decisions, flows, contracts, design, tasks and tests itself; no private chat is required by the receiver.
