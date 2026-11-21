# Plan: Line numbers and line wrap in project Files

> **Design ownership (batch 9).** No separate front end team designs this feature. This plan specifies the visual design and the animation itself (section VISUAL_DESIGN_AND_MOTION), and implementers build exactly that. **When implementation is finished, the implementing agent sends the finished work to the front end team for review** (task T07). The implementation issue stays open until that review is recorded on it.

## META

| Field | Value |
|---|---|
| Feature | Line numbers and line wrap in project Files |
| Size | small; labels `feature`, `small`; one implementation issue, no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `8fa907f378127bcfc23d71b55c53625ffc43e8da`, verified with `git rev-parse HEAD`; all local source line citations below refer to this SHA |
| Plan file | `docs/agent-plans/project-files-line-numbers-wrap.md` |
| Canonical issue / publication | The GitHub issue labeled `feature` + `small` that carries this plan in its body is canonical. This file is the identical versioned copy, added by a focused docs-only PR (with its `scripts/public-source-files.json` entry); the issue links it at a SHA-pinned URL because GitHub issues cannot take `.md` attachments through the API. |
| Existing work | Editing [#1344](https://github.com/skytuhua-org/Gen-V1/issues/1344), open implementation [PR #1512](https://github.com/skytuhua-org/Gen-V1/pull/1512); image plan [#1585](https://github.com/skytuhua-org/Gen-V1/issues/1585), open docs [PR #1588](https://github.com/skytuhua-org/Gen-V1/pull/1588); Markdown plan [#1583](https://github.com/skytuhua-org/Gen-V1/issues/1583), open docs [PR #1589](https://github.com/skytuhua-org/Gen-V1/pull/1589). These are coordination dependencies, not permission to implement their features. |
| Implementation status | NOT_STARTED. Planning only; no feature code written or runtime behavior verified. |
| Provenance | Feature proposal batch 9 item 6, filed under the maintainer's standing instruction; requested scope and external reports below; baseline code inspection; authenticated `gh api` PR inspection. Structure follows the full image-preview issue plan. Decisions explicitly marked DECIDED are this plan's executable design, not existing behavior. |

## OBJECTIVE

People inspecting a source file need stable source-line coordinates, control of long lines, and a fast way to reach a known line without leaving Files. Today the text preview is a bare `<pre>` and only Project Search can highlight one line. Add a non-copying numbered gutter, a pane-local `Wrap` toggle initially following `Code line wrap`, and rebindable Ctrl+G `Go to line`. Search results must reveal exactly the same numbered logical line, even with wrapping and mixed line endings.

Success means every logical line in a successfully read text file has an aligned number, soft wraps do not invent source lines, copying never includes gutter numbers or navigation chrome, and a valid line request reveals the correct text and number without blank viewport ranges. The existing 1 MiB authorized read cap remains unchanged. External reports motivate regression scenarios, not claims that Gen has Codex's defects.

## REQUIREMENTS

- **R01 Logical lines.** Number source lines starting at 1. LF, CRLF and bare CR each delimit one logical line; preserve consecutive blank lines and the trailing empty line after a final separator. Empty text has one empty line numbered `1`, with `Empty text file` outside the copyable text. No numbers for soft-wrap continuations. No editing or syntax-highlighting requirement.
- **R02 Bounded rendering.** Virtualize text rows and gutter together, consistent with the existing 1 MiB cap. No full-file DOM row list; no independent gutter scrolling. Initial viewport, fast scroll, resize, hide/show and repeat navigation must paint complete visible ranges. Do not raise the host cap or introduce additional file reads for numbering.
- **R03 Copy.** Gutter is decorative (`aria-hidden`, `user-select: none`); source text is selectable. Copying across logical lines yields only the selected source text including original separators, never numbers, spacer content or controls. Select-all while the text viewport owns focus selects the entire file, not merely mounted rows; copy of that selection returns the complete source string, including offscreen lines. Do not intercept copy elsewhere.
- **R04 Wrap.** Exact button text `Wrap`, accessible name `Wrap lines`, `aria-pressed` reflecting the effective value. Unoverridden panes follow live `Code line wrap`; first click sets an independent local override. Retain that override while selecting files and refreshing within that pane. Reset on pane owner remount (base/query change), not persisted to disk or global preferences. Other panes remain independent. Wrap off uses horizontal scrolling; wrap on fits available text width and breaks otherwise unbreakable long tokens. Keep logical line at the top anchored across toggles/resizes.
- **R05 Go to line.** Button and popover title `Go to line`; input label `Line number`; helper `Line 1 to N`; submit `Go`; close control `Cancel`. Default Ctrl+G, rebindable through Settings and listed under Workspace in KeyboardReference as `Go to line`. Accept a signed base-10 integer with optional outer whitespace, clamp to 1..N, reveal centrally and highlight the actual resulting numbered line. Reject blank, fractional, exponent, nonnumeric and unsafe-integer input with `Enter a whole line number.` Keep the popover open, focus the input and announce the error. Do not silently coerce invalid input to line 1.
- **R06 Focus and scope.** Activate the shortcut only for the active project text preview when focus is within that pane (including its popover), not composer, terminal, search-query input, other panes, hidden/inert UI, or during IME composition. Prevent default only when handled. Enter submits; Escape/Cancel/outside dismissal closes without changing the current target. Opening selects the current target number or top visible logical line. Successful Go returns focus to the text viewport; cancellation restores the opener when still connected. Use the existing platform chord matcher and shortcut formatter, including its macOS modifier convention.
- **R07 Search.** Preserve `Matching line N`, SHA freshness checks, changed-file and missing-line messages. Fresh text matches use the shared logical-line reveal/highlight path; same-file repeated matches must work. Stale or unavailable search targets are not clamped to unrelated content. Latest successful Go or fresh search jump owns one active highlight; ordinary scrolling does not change that target. A file/owner change clears it.
- **R08 States and safety.** Preserve skeleton, retry, binary message, checksum, stale-response fencing and authorization. Controls are absent for binary, absent content and failed first reads; empty text supports line 1. During pending replacement reads do not navigate old content. Navigation dialog closes on selection/owner change or deactivation. Render text only, never interpret HTML; no new host route, network call, permission or telemetry.
- **R09 Accessibility and visual quality.** Follow VISUAL_DESIGN_AND_MOTION including light/dark/high-contrast, keyboard focus, reduced motion, 200% zoom and narrow panes. Expose a labelled focusable text region, not an editable textbox. Announce `Line N of M` on successful navigation; do not announce gutter rows individually. Selection must remain usable with assistive technology and virtualization.
- **R10 Integration and delivery.** Coordinate shared preview files with #1344/#1512, #1585/#1588 and #1583/#1589. Keep editing, saving, image rendering and rendered Markdown out of scope. Source-mode text in those features should share this renderer after integration. Final implementation handoff goes to the front end team for review, not a request that they design the feature.

### Explicit exclusions

No write API, editor, dirty/draft/save state, clickable gutter breakpoint controls, multi-cursor, line-range URL format, new file-reference routing, persisted per-file wrap preference, image preview, Markdown rendering, changes to granted Files, or global replacement of code-block wrapping. Tests use synthetic files; no private worktree content in evidence.

## REPO_MAP

Verified at the baseline, not proposed APIs:

| Area | Evidence and implication |
|---|---|
| Project text preview | `apps/web/src/files/ProjectFiles.tsx:19–23` ProjectFile payload; `:31–46` keyed reader and pane state; `:66–85` authorized read; `:87–116` SHA guard and captured-separator splitting; `:147–186` binary/empty/text/mark/checksum branches. `:195–198` clears search state on folder navigation. |
| Search reveal | `ProjectFiles.tsx:92–104` scrolls mounted mark with `scrollIntoView` and computes `(line - 1) * 2`; `:126–143` receives ProjectSearch match, refreshes a same-path preview and opens it; `:151–164` preserves stale/missing/Matching line messages. Replace DOM-mark dependence with a virtual renderer reveal operation. |
| Files styling | `apps/web/src/files/files.css:186–202` scroll container and 12px/1.65 monospace `<pre>`, `white-space: pre`, max-content width; `:390–394` matching-line selection tokens; `:279–303` narrow layout. No gutter exists in this baseline text branch. |
| Appearance | `apps/web/src/useAppearance.ts:26–35` sets each shell's `data-word-wrap`; `:37–38` motion durations. `apps/web/src/App.tsx:1148` also renders the shell dataset from preferences. `apps/web/src/Settings.tsx:64` indexes `word-wrap` / `Code line wrap`; the actual switch is `apps/web/src/AppearanceSettings.tsx:75`. |
| Preferences | `packages/contracts/preferences.ts:31–33` keybinding schema, `:54` wordWrap, `:69–71` defaults (wordWrap true), `:73–76` partial update/merge. A new rebindable preference needs schema/default coverage, not just a hardcoded registry chord. |
| Keyboard | `apps/web/src/keyboard-bindings.ts:8–24` registry contract, `:26–50` existing entries, `:52` preference-driven Settings rows, `:89–111` chord lookup/reference helpers. `apps/web/src/KeyboardReference.tsx:6` reads live keybindings. `apps/web/src/shell-layout.ts:23` matches platform shortcuts. |
| Popover primitive | `packages/ui-shell/Popover.tsx:7–23` verified anchor, initialFocus, width/height, dismissal contract; `:46–75` portal placement/resize. Use this, not new absolute overlay positioning. |
| Host boundary | `packages/workspace/tools.ts:204` file() performs guarded worktree read with `readBoundFile(target, 1024*1024)` and returns text/binary/hash. Over-limit reads fail; they are not a silently truncated prefix. |
| Regression tests | `tests/e2e/shared-panels.spec.ts` has existing Files preview/navigation and late-response tests; `tests/e2e/project-search.spec.ts:122,154,182,201,287,316` cover matched-line opening, keyboard, IME, errors, owner change and deactivation. `tests/keyboard-bindings.test.ts`, `tests/preferences.test.ts` cover registry and preferences. |
| Guards / commands | `package.json` has `lint`, `test:ui-guard`, `check:docs-links`, typecheck/build. `scripts/lint-ui.ts` invokes overlay policy. `scripts/browser-suites.ts:77,82` registers project-search/shared-panels with their existing Playwright configs. `scripts/public-source.ts` validates the manifest on import; `tests/public-source.test.ts` asserts sorted/unique source and runtime subset. |

### Related work inspected through gh api

- PR #1512 is **open, not merged**, head `439df044e5d34394100e1fb9d77ff30388d9a49b`. Its new `CodeEditor.tsx` already calls `lineNumbers()`, `highlightActiveLine()`, `highlightActiveLineGutter()` and uses `EditorView.lineWrapping` in a compartment. It imports and installs `searchKeymap`; it has a readOnly prop. It also adds `ProjectFileEditor.tsx` and touches ProjectFiles, files.css and keyboard-bindings. These capabilities are not in baseline main.
- **Binding conflict:** baseline registry and searched application/package/test source contain no explicit Ctrl+G binding. However #1512 installs CodeMirror `searchKeymap`, whose upstream implementation binds `Mod-g` to findNext (and `Mod-Alt-g` to gotoLine). Its lock diff pins `@codemirror/search` 6.7.2. The upstream default-branch source was inspected; exact packaged 6.7.2 behavior must be verified in T01 before claiming the installed conflict proven. Do not claim Ctrl+G is globally free after editing lands.
- PR #1588 is **open, not merged**, head `029310a3d6545b9caf2ad241c9afe1e4d68206e0`; #1589 is **open, not merged**, head `961c66e731b689703ef532b4d3866f62d84f3c74`. Both are docs plans, not working image/Markdown preview implementations. #1589's changed files are its plan and public-source manifest. Read the canonical issue bodies when implementation starts; their later implementation work can alter routing.
- Search was limited to open issue title/keyword queries plus the named related issues/PRs; it does not establish the absence of all possible concurrent work. Refresh ownership and PR state in T01.

## DESIGN

### DECIDED decisions

- **D1 Renderer boundary.** Extract a project-only read-only text surface (proposed `apps/web/src/files/ProjectTextPreview.tsx`, not an existing file). ProjectFiles owns reads, SHA/search provenance and pane lifetime; the renderer owns logical lines, viewport, selection, wrap and line reveal. Keep FilesView's generic/granted behavior unchanged unless adding a narrow optional toolbar slot is necessary after inspecting it.
- **D2 Virtualization.** If #1512 lands first, reuse its CodeMirror gutter/viewport machinery through a shared read-only configuration, not a second adjacent gutter and not the manual-edit lifecycle. If it has not landed, T01 must coordinate a shared renderer prerequisite with that owner or implement the self-contained row virtualizer described below. Do not import files or dependencies from an unmerged PR, silently add CodeMirror to this baseline, or wait indefinitely for an unrelated feature. This explicit fallback keeps delivery independent.
- **D3 Fallback virtualizer.** Parse source once into records containing start/end offsets and separator length; text remains authoritative. Use one scroll container, a height-prefix index, top/bottom spacers and overscanned visible rows (one viewport above/below). Each row contains nonselectable gutter plus selectable text. No-wrap height is the measured line height; wrapped heights are measured with ResizeObserver, initially estimated and corrected while anchoring the top logical line plus intra-line offset. Binary-search cumulative heights for visible range; recalculate on width/font/zoom/wrap changes. Never replace missing rows with blank visible spacers. A single extremely long wrapped line may occupy many visual rows but remains one logical row and number.
- **D4 Selection model.** The virtual renderer tracks selection endpoints as source offsets, restores them across viewport changes, and serializes selected source slices to clipboard `text/plain`. Select-all uses [0, text.length]. Pointer drag across viewport edges must autoscroll and extend offscreen selection. Preserve exact newline characters, tabs, spaces and Unicode; do not reconstruct copied text from DOM rows. If sharing CodeMirror, prove equivalent full-document selection/copy semantics with its configured separators, especially mixed/bare CR; do not normalize the file just to fit the renderer. Add no clipboard permission request. This is a release gate, not an optional fallback to viewport-only copying.
- **D5 Wrap source.** Proposed state `boolean | null` means local override or inherit. Prefer passing the existing live preference from the owning workspace; trace that prop path in T01. If this requires broad shell changes, observe only the closest owning `.app-shell` `data-word-wrap` attribute, clean up on unmount and treat absent data as the verified default true. Never read another shell's setting or mutate the global preference from Wrap. No new persisted wrap schema.
- **D6 Navigation contract.** Proposed renderer operation `revealLine(line, origin)` resolves a 1-based logical row after layout, scrolls it into view without smooth scrolling, then highlights it. Go validates/clamps; search validates SHA and bounds without clamping before calling it. Key a pending reveal to owner/path/hash/request sequence; discard on deactivation, replacement or error. Apply after virtual measurements, not `line * constantHeight`. Re-anchor after correction, including first/last row. Highlight lasts until next successful target or file change, not a timed flash.
- **D7 Shortcut.** Proposed registry id `files.go-to-line`, preference key `filesGoToLine`, label `Go to line`, Workspace scope, default `Ctrl+G`. Add schema/default/merge tests and use `chordFor` plus `matchesShortcut` with live preferences. Existing stored settings acquire the default through current preference parsing; no DB migration. Do not install a global listener that steals terminal/editor input. If editor reuse activates CodeMirror's default Mod-g, remove/override that binding in read-only Files via a highest-priority live preference keymap; editing keeps its own documented behavior outside this scope. Rebinding must disable the old chord in this reader.
- **D8 Error and lifecycle.** Invalid entry changes no scroll/highlight. Clamp valid low/high integers and announce the resulting line. New selection clears navigation/measurements/selection and closes the popover before a replacement read; refresh fences stale requests using useFilesRead. Keep prior hash and stale-search handling in ProjectFiles. No automatic retry loop, read escalation or write pathway.
- **D9 Coordination / rebase.** Claim exact preview/keyboard scopes on the canonical issue before implementation and notify related owners. Rebase on current main before touching shared branches and again after any of #1512, image or Markdown implementations merge. Re-read their full issues and diff shared files; retain editor state and image routing, do not paste this baseline's ternary over them. If editing lands first reuse its gutter; if this lands first offer the project text renderer to the editing owner. Image views get no text controls; SVG Source can use them. Markdown rendered mode gets no source-line gutter; a search line jump selects Source before revealing the source line. Coordinate that source-mode transition with #1583, do not implement Markdown here. Rerun focused preview/search/keyboard suites after each integration rebase. Never treat a docs-plan merge as feature availability.
- **D10 Rollback.** No server or storage migration. Revert the reader integration/shortcut registry and default together if needed, retaining unrelated editing/image/Markdown work. Old preference records remain readable; test unknown-field retention with the existing merge path. Do not roll back related features to recover this one.

### Data/control flow

Authorized file read → accepted owner/path/hash payload → text records and viewport → aligned number/text rows. Live global wrap + local override → effective wrap → remeasure and preserve logical anchor. Search match → SHA/bounds guard → pending shared reveal. Local shortcut/button → popover → strict parse/clamp → shared reveal → status/focus. File change/deactivation cancels pending reveal and dismisses the popover. No shared contracts change except the necessary rebindable preference entry; no route or ProjectSearchAdapter schema changes.

## VISUAL_DESIGN_AND_MOTION

Concrete design, not a request for another team to choose it:

- Keep the existing Files header/file name/checksum hierarchy. Place a compact text toolbar immediately above source content, right aligned: `Wrap` then `Go to line`. 8px gap, 8px vertical padding, existing `--files-inset` horizontal inset, controls minimum 32px high (44px in touch density), 12px interface text. At narrow widths allow toolbar wrapping without truncating labels or pushing file content beyond the pane.
- Retain source typography `12px / 1.65 var(--font-mono, monospace)`, tab size 2 from `files.css:192–202`. Gutter uses identical font/line height, tabular numerals, right alignment, 8px inner padding and 1px right border. Width is `max(4ch, digits(totalLines) * 1ch + 16px)` plus border; calculate from logical line count, not visible count. Text starts 12px after the divider. Gutter remains at the left when text scrolls horizontally and numbers align to the first visual row, never vertical center of a wrapped row.
- Verified tokens: `styles.css:3–4` defines light/dark `--surface` (#fff/#0f0f0f), `--subtle` (#f5f5f5/#171717), `--text` (#202020/#e6e6e6), `--muted` (#666666/#a0a0a0), `--border` (#e5e5e5/#282828), `--control-border` (#878787/#707070), `--selection-bg` (#ededed/#1f1f1f), `--selection-border` (#a3a3a3/#737373), `--selection-ink` (var(--text)), `--danger`, `--elevation`. Use variables, not hardcoded theme copies. Existing high contrast overrides muted/border in `shell.css:80–81` must remain effective.
- Text background `--surface`; gutter `--subtle`, numbers `--muted`, divider `--border`. Active logical line fills text and number cell with `--selection-bg`, text `--selection-ink`, inset 1px `--selection-border`. Retain `.files-matching-line` as the target styling hook where compatible with virtualization; highlight the full logical row including empty lines. Wrap pressed uses the same selection fill/border; inactive controls use surface/text/control-border. Keyboard focus is a 2px `--ui-focus-ring` with existing #808080 fallback as in `files.css:386–388`. Forced colors uses system Highlight outline; never color alone for pressed/focus state.
- `Go to line` opens a shared Popover anchored to its toolbar button, bottom/end aligned and viewport-clamped. Desired width 240px, max width viewport minus 24px, content height determined by normal flow (nominal 164px, allow errors to expand and clamp/scroll at small viewport height). 12px padding, 8px gaps, 1px control-border, existing control radius token and elevation. Title 13px weight 550; labelled input full width, 32px minimum height, monospace entered number. Helper 12px muted below; error 12px danger with live announcement. Footer right aligns `Cancel` and `Go` separated by 8px. Use a form; no placeholder-only label, no spinner arrows required, inputMode numeric with strict parser.
- Popover entrance opacity 0→1 and translateY(-4px)→0 over `--ui-motion-popup-enter` (180ms default), exit opacity 1→0 over `--ui-motion-popup-exit` (140ms default), easing `cubic-bezier(0.2, 0, 0, 1)`. Hover background uses `--ui-motion-hover` (120ms), same easing. Timings are already generated in useAppearance, respect motion speed/off. With `prefers-reduced-motion: reduce`, app motion off or panel animations disabled, remove transforms/transitions and present the final state immediately. No animated row heights, wrap reflow, scrolling or flashing target highlight. Focus/target updates must never wait for animation completion.

## EXECUTION_DAG

All tasks below are planned, not executed. T01 → T02 → T03 → T04 → T05 → T06 → T07. Keep one implementation owner for shared preview files; tests can be delegated only after the renderer/navigation contract is committed and ownership recorded. Do not parallelize edits to ProjectFiles/files.css/keyboard registry with related workers.

### T01 — Refresh baseline, ownership and integration choice

- Dependencies/inputs: full canonical plan r1, current main, related issue journals and PR diffs. Claim scope and acknowledge handoff on the same issue.
- Steps/files: inspect current ProjectFiles, FilesView, useFilesRead and live preference ownership; refresh #1512/#1588/#1589 and any replacement implementation PRs through gh api. Verify installed CodeMirror 6.7.2 search keymap if applicable. Choose D2's deterministic landed-editor or independent fallback path; record shared-file ownership and rebase order.
- Output/boundary: updated verified path map and implementation journal, no feature changes. Any discovered incompatible shared contract blocks only affected work and requires a full plan revision, not an invented API.
- Tests: positive trace of text read and fresh search dispatch; negative check for another Ctrl+G handler/editor default and inactive-pane dispatch. Run no unrelated feature suite.
- Done-when/handoff: current SHA, exact renderer reuse decision, conflict resolution and commands recorded; send to T02 implementer. Existing dependencies may not be described as landed unless merged.

### T02 — Logical lines, bounded viewport and copy

- Depends T01. Inputs: accepted source string/hash and chosen renderer. Output: proposed ProjectTextPreview.tsx plus focused pure helpers/tests (proposed `tests/project-text-preview.test.ts`, add new paths to manifest), or a shared read-only renderer factored from landed CodeEditor without edit lifecycle.
- Steps: implement separator offsets, height index, visible range/overscan, measured wrapped rows and source-offset selection per D3/D4. Integrate ProjectFiles text branch; retain binary/empty/checksum and useFilesRead fencing. Scope only renderer/necessary preview styles and tests.
- Positive tests: LF/CRLF/CR/mixed, tabs, Unicode, blank/final lines, viewport beginning/middle/end, offscreen selection and full copy near cap. Negative tests: empty input, zero-height hidden pane, stale source replacement and giant unbroken line; no number or spacer in clipboard.
- Done-when: bounded rendered row count independent of newline count, no visible blank ranges after fast scroll, exact selected source copy, empty line 1. Hand off a committed renderer contract to T03.

### T03 — Pane wrap and visual styling

- Depends T02. Inputs: live owning-shell wordWrap and renderer. Edit ProjectFiles/proposed renderer/files.css only; use optional narrow FilesView hook only if T01 proves necessary. Output: inherit/override wrap state and concrete visual design.
- Steps: implement R04 lifetime, toolbar, sticky gutter and row anchoring; observe/clean up relevant preference/resize state. Preserve no-wrap horizontal scrolling and wrap-on unbroken-token containment.
- Positive tests: true/false global default, live inherited changes, local override across file/refresh, independent second pane, narrow width and resize. Negative: override must not write global settings; owner remount resets; hidden→visible never blanks rows.
- Done-when: toggle aria-pressed and actual geometry agree; source coordinates/copy unchanged by wrap. Handoff to T04 with stable text viewport and toolbar anchor.

### T04 — Rebindable Go to line and Search integration

- Depends T03. Edit renderer/ProjectFiles, keyboard-bindings.ts, packages/contracts/preferences.ts, existing preference/keyboard tests; proposed local popover subcomponent if needed, admitted in manifest. Use shared Popover; inspect its current dismissal/focus behavior rather than duplicating it.
- Steps: add preference/registry/default and strict integer parser; scope live shortcut, form/error/cancel/focus flow, shared reveal/status/highlight. Replace old mark-only scroll path with SHA-guarded search reveal; preserve exact stale/missing messages. If sharing editor, neutralize its conflicting read-only default Mod-g and test old/new chord after rebinding.
- Positive tests: Go 1/middle/last, low/high clamp, repeated same-file search with wrap on/off, new binding/reference. Negative: invalid/unsafe values, IME, composer/terminal/search input, inactive pane, pending read, binary, stale SHA, out-of-bounds search, dismissal after owner change.
- Done-when: highlighted text and visible gutter number match request; no unrelated shortcut consumed; status/focus meet R05–R08. Handoff to T05 with all interactions implemented.

### T05 — Regression and visual evidence

- Depends T04. Extend `tests/e2e/shared-panels.spec.ts` and `tests/e2e/project-search.spec.ts` using existing route fixtures; extend tests/keyboard-bindings.test.ts and tests/preferences.test.ts as needed. Avoid new browser suite registration unless unavoidable.
- Steps: cover all acceptance rows below including clipboard across virtual boundaries, changed-file race and focus. Run scoped commands in VALIDATION once after final edits. Render the actual surface with synthetic numbered fixtures, inspect gutter alignment and target text (not just DOM existence), and capture light/dark wrap off/on, narrow popover/error, high contrast/reduced-motion and blank-line/search states.
- Negative checks: move rapidly from first to last line, resize while wrapped, deactivate/reactivate, cancel/error path, no screenshots with real private source. Real clipboard and keyboard selection should be exercised, not merely a mocked copy helper.
- Done-when: commands/counts and screenshot paths or durable redacted artifacts recorded; all R01–R09 pass. Any unavailable Windows/manual/assistive check remains explicitly pending. Hand off failures to implementation owner, otherwise T06.

### T06 — Integration, documentation and release gate

- Depends T05. Inputs: verified branch/evidence and fresh related-work state. Files: minimal user-facing shortcut documentation if an existing relevant document is discovered; plan/journal, public-source manifest and PR template. No unrelated docs rewrites.
- Steps: rebase shared-file changes after newly landed preview/editor work, rerun affected commands, update full plan revision if contracts changed. Prepare focused reviewed implementation PR with issue link, test outputs, evidence, rollback notes and remaining checks. Run manifest/docs checks for added files. Keep issue open.
- Positive tests: fresh integration still satisfies numbered Source/search/wrap behavior. Negative: image/rendered Markdown and editing controls not accidentally replaced; no write route introduced. Check clean status and only intended staged files before authorized commit/push.
- Done-when: CI/reviews distinguished from local results, requirement matrix complete, no acceptance gap hidden by passing build. Send finished implementation/evidence to T07, not a design question.

### T07 — LAST: front end team review handoff

- Depends T06. Recipient: front end team; implementing agent remains responsible for fixes. Input: finished implementation PR/SHA, full plan revision, requirement matrix, test logs and synthetic visual evidence.
- Steps: post explicit request to review the finished visual/interactions/accessibility/motion against this plan, with first executable review actions: open synthetic multiline file, toggle Wrap, Ctrl+G to line 100, compare gutter/text and copy. Record ACK and review outcome on the canonical issue. Publish release checkpoint clearing ownership/assignee/in-progress labels when pausing or handing off.
- Positive acceptance: team records approval or actionable findings; implementer fixes findings and reruns only affected checks, attaching replacement evidence. Negative: no reviewer ACK or unresolved findings means HANDOFF_PENDING, not DONE; never substitute a queued review for approval.
- Done-when: front end review recorded, findings resolved, CI/maintainer merge gates separately satisfied. Closure only when authorized; merged and verified-on-main are distinct later ledger states. This is the final task, not a delegation of visual design.

## VALIDATION

### Reproducible setup and planned commands

Use Node >=24.10.0, pnpm 10.30.3; follow `docs/getting-started.md`, `pnpm install --frozen-lockfile`, `pnpm exec playwright install chromium`. Windows remains the accepted native desktop target; Linux browser mocks are not Windows desktop verification. Use no provider credentials for synthetic fixtures. Run from repo root after freezing edits:

```sh
pnpm typecheck
pnpm build
pnpm exec vitest run tests/project-text-preview.test.ts tests/keyboard-bindings.test.ts tests/preferences.test.ts --maxWorkers=1
pnpm exec playwright test --config tests/e2e/shared-panels.playwright.config.ts
pnpm exec playwright test --config tests/e2e/project-search.playwright.config.ts --output .harness-project-search-results
pnpm test:ui-guard
pnpm lint
pnpm exec vitest run tests/public-source.test.ts --maxWorkers=1
pnpm check:docs-links
```

The proposed unit path must be created by T02 or replaced by the actual landed shared renderer's focused test path in a full plan revision; it does not exist at baseline. Existing Playwright configs run Vite/route mocks; build success is not visual evidence. Keep traces/screenshots in ignored persistent repository evidence directories, redact and publish only safe artifacts with commit-pinned links in the issue journal. The project-search config defaults to temporary output; the command above overrides it for durable local investigation. Never label route-mocked browser evidence as live host authorization coverage.

### Fixtures and requirement → task → acceptance matrix

| Requirement | Tasks | Observable acceptance check |
|---|---|---|
| R01 | T02,T05 | Compare numbered rows/text against synthetic LF, CRLF, CR, mixed, consecutive blanks and trailing newline fixtures; empty input shows line 1; wrap continuation adds no number. |
| R02 | T02,T05 | Near-1-MiB many-short-lines fixture has bounded mounted rows; first/middle/last and rapid scroll/resize/hide-show paint all visible source, no blank gutters/text. Over-cap existing host error remains, no extra reads. |
| R03 | T02,T05 | Select partial multiline text, drag beyond virtual window and Select All; clipboard equals exact original slice/string including mixed separators and Unicode, never numbers/chrome; copy in composer unaffected. |
| R04 | T03,T05 | Global true/false defaults, live inherited preference, per-pane override/file refresh and owner-remount reset; measure no-wrap horizontal overflow and wrap containment/anchor preservation. |
| R05 | T04,T05 | Go 1, middle, last, 0, negative and N+1 lands/highlights correct number; blank, 1.5, 1e2, letters and unsafe integer stay open with exact error; rebind and shortcut reference show live chord. |
| R06 | T04,T05 | Keyboard-only open/submit/cancel and focus restore; no action from terminal/composer/search query/inactive pane or composing event; no swallowed old chord after rebind. |
| R07 | T04,T05 | Fresh search LF/CRLF/CR and deep wrapped line matches gutter/text, repeated same-file jumps succeed; stale hash and missing line show existing messages without jumping elsewhere. |
| R08 | T02,T04,T05 | Binary, empty, loading, error/retry, read replacement and owner races preserve correct content/checksum; pending reveal discarded; text containing HTML is displayed inert. |
| R09 | T03,T04,T05 | Actual screenshots and keyboard/assistive checks at narrow/200% zoom, light/dark/high contrast and reduced motion; full row and number align, status announces only navigation, dialog remains viewport-contained. |
| R10 | T01,T06,T07 | Current related PR state/rebase captured; source-mode integration does not replace editing/images/Markdown; finished front end review ACK and findings resolution recorded. |

### Planned evidence and release gate

Capture source fixture content/hash, viewport/theme/wrap/motion settings, target requested/resulting line, command exit/counts, PR CI URLs and reviewer outcome. Manual Windows smoke: Files selection, wrap, Ctrl+G/rebind and Project Search line jump using a synthetic authorized project; record platform/version. Screen-reader check must verify text discovery beyond the virtual window and nonannouncing gutter; failure blocks release, not waived because row count is bounded. No elapsed-time performance budget has been measured; bounded rows/no cap expansion and responsive visible scrolling are the v1 gate, with measured timings reported rather than fabricated thresholds.

Feature release requires every matrix row, passing scoped regressions/guards, integrated shared preview branches, front end review and normal maintainer merge gates. Queued CI, successful build and issue publication individually prove none of the user interactions. Rollback uses D10.

### Actually executed in this planning step

Baseline source inspection, named issue/PR API inspection, open issue keyword/title search and upstream CodeMirror keymap inspection only. Manifest and docs checks executed: `pnpm exec vitest run tests/public-source.test.ts --maxWorkers=1` (13/13 passed) and `pnpm check:docs-links` (0 broken); no runtime, browser, visual, unit feature or native Windows tests have been executed for this proposed feature. Tooling used: Node v24.22.2, pnpm 10.30.3.

## STATE

- Researched/decided: baseline paths, text cap and search routing verified; D1–D10 and visual/motion design specified. T01–T07 all NOT_STARTED; no implementation owner claimed by this local planning step.
- Implemented: only this plan and its manifest entry (docs-only PR). Feature code, unit fixtures and browser scenarios remain unwritten.
- Verified: static source and API facts above only. Runtime feature, copy fidelity, virtualization, visual appearance, assistive technology and Windows behavior are NOT_VERIFIED. Upstream Mod-g mapping is verified at upstream default branch, not yet the exact pinned package bytes.
- Risks: custom virtualized selection/wrapped measurement can exceed the perceived small size; D2 reuse is preferred when landed, and D3/D4 must not be reduced to nonvirtual/full-DOM or broken copying to preserve a size estimate. Shared preview branches and indirect editor shortcut defaults require active coordination. Escalate a changed scope/size before implementation if acceptance cannot fit.
- Current source: baseline `main` @ `8fa907f378127bcfc23d71b55c53625ffc43e8da`. The only changed paths are this Markdown file and `scripts/public-source-files.json`, in the docs PR linked from the issue. No implementation branch or feature CI exists.
- Exact next step: an implementing agent reads this whole issue (and comments), claims scope on it per AGENTS.md, and starts T01 against current main with a refreshed related-PR journal. The docs PR stays with repository reviewers; merging it is not a prerequisite for T01.

## REFERENCES

- [Verified baseline tree](https://github.com/skytuhua-org/Gen-V1/tree/8fa907f378127bcfc23d71b55c53625ffc43e8da); source citations in REPO_MAP are paths at that SHA, not current floating main.
- [ProjectFiles baseline source](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/apps/web/src/files/ProjectFiles.tsx#L87-L186); [Files CSS](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/apps/web/src/files/files.css#L186-L202); [appearance dataset](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/apps/web/src/useAppearance.ts#L26-L38).
- [#34524: always-wrapped Codex file viewer](https://github.com/openai/codex/issues/34524): report concerns plain full-file code preview, not review diffs/Markdown; long lines always soft-wrap with no control. Basis for explicit Wrap and source-line continuity, not proof of Gen behavior.
- [#30805: wrong-line references](https://github.com/openai/codex/issues/30805): Windows local and SSH-to-WSL viewer opens right file but scrolls far from requested line. Basis for verifying actual highlighted text and numbered target, not just nonzero scroll offset.
- [#46784: blank source lines](https://github.com/openai/codex/issues/46784): macOS report of intact source lines leaving blank layout slots after view transitions. Basis for viewport paint/rapid transition regression; underlying Codex cause is not established by this plan.
- [Manual editing issue #1344](https://github.com/skytuhua-org/Gen-V1/issues/1344), [PR #1512 inspected head](https://github.com/skytuhua-org/Gen-V1/tree/439df044e5d34394100e1fb9d77ff30388d9a49b); its gutter/read-only/wrap/search keymap capabilities and conflict caveat are preserved in REPO_MAP.
- [Upstream searchKeymap source](https://github.com/codemirror/search/blob/main/src/search.ts): Mod-g=findNext and Mod-Alt-g=gotoLine; this is upstream current source, not a pinned-package verification. T01 must verify the PR's installed 6.7.2 bytes.
- [Image canonical plan #1585](https://github.com/skytuhua-org/Gen-V1/issues/1585), [docs PR #1588](https://github.com/skytuhua-org/Gen-V1/pull/1588); [Markdown canonical plan #1583](https://github.com/skytuhua-org/Gen-V1/issues/1583), [docs PR #1589](https://github.com/skytuhua-org/Gen-V1/pull/1589). Their full bodies remain required integration context; essential shared-preview/source-mode rules are restated in D9.
- Repository policy: `AGENTS.md` (complete-plan publication, ownership and release checkpoints), `CONTRIBUTING.md` (focused checks/public manifest), `.github/pull_request_template.md`, `docs/getting-started.md` (tooling/browser/native setup). No private chat or inaccessible attachment is needed to interpret this plan.
