# Accessibility pass: workbench dock, source workbench, background drawer

## META

- Repo: `skytuhua-org/Gen-V1`
- Plan revision: 1 (2026-11-21)
- Baseline: `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d`
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/583
- Implementation status: not started; this is a design/execution plan only. No code is written by this plan.
- Source provenance: audit of `apps/web/src/{WorkbenchPanels,SourceWorkbench,BackgroundWork,WorkbenchPanelContent,WorkbenchInputsPanel,WorkbenchOutput}.tsx`, `packages/ui-shell/{Modal,Select}.tsx`, `apps/web/src/{source-workbench,background-work,workbench-output,styles,shell}.css`, `packages/ui-shell/{tokens,controls}.css` on the baseline SHA.

## OBJECTIVE

Make the three new workspace surfaces — the workbench dock (`WorkbenchRequestPanel`, `WorkbenchRunPanel`, `WorkbenchInputsPanel`, `WorkbenchOutput`), the source-workbench modal (`SourceWorkbenchProvider`'s `WorkbenchDialog` + `WorkbenchComposer`), and the background-work pane (`BackgroundWorkView`) — fully operable keyboard-only (open, navigate, act, close), with correct focus order and focus return on close, correct roles/names verifiable by screen reader and axe-core, at WCAG 2.2 AA. Success: axe DevTools reports 0 violations on each surface; every flow below completes with keyboard alone; a screen reader announces each tab, state, error and update.

## REQUIREMENTS

In scope:

- Semantic roles/names and keyboard interaction for the two button-nav groups that behave as tab strips (`WorkbenchDialog` view nav, evidence-category filter).
- Unique accessible names for repeated buttons ("Open source" / "Remove source" chips, "Approval model" select, "Output" toggles, "Inspect retained source" buttons).
- Error announcements moved to `role="alert"`; status/refresh announcements via a live region.
- Table semantics in `WorkbenchRequestPanel` (caption + `scope="col"`).
- Initial focus and focus-return behavior on the workbench modal (open → selected tab; close → opener control), verified and test-covered.
- Fieldset naming on the human-step response form.
- Focus-visible styling consistent with the existing `:focus-visible` rule.

Out of scope (do not touch): `Modal`'s Escape/backdrop/focus-trap logic, `Select`'s popup keyboard handling, pane/split-layout chrome, any visual restyle beyond what the a11y fixes require, server routes, contracts.

Concrete keyboard-only flows that must work end to end:

1. Workbench modal: from `WorkbenchComposer`'s "Sources and evidence" button, Enter opens the dialog; focus lands on the currently selected tab; Arrow keys move across tabs and activate immediately; Tab moves into the tab panel content and through its controls; Esc closes; focus returns to "Sources and evidence".
2. Evidence filter: same tab-strip behavior inside the Evidence tab.
3. Background pane: Tab order is Refresh → work cards (Open child task, Output, Cancel) → output region controls (Refresh output) → schedules (Pause/Resume) → intake (model select, Reject, Approve). Output toggle expands and announces via `aria-expanded`; card-level actions keep or restore focus after the DOM settles.
4. Composer source chips: every chip's Open/Remove/Refresh/Keep buttons are named for their chip and reachable in DOM order.

## REPO_MAP

Verified on baseline SHA:

- `apps/web/src/SourceWorkbench.tsx` — `WorkbenchDialog` (lines 178–206): `<nav aria-label="Workbench views">` with five `aria-pressed` buttons (request, tools, run, sources, evidence). `WorkbenchComposer` (152–176): destination row, `Select` "Delivery", `role="status"`/`role="alert"` paragraphs, `workbench-source-chip` articles with generic "Open source"/"Remove source"/"Refresh source"/"Keep captured source" buttons.
- `apps/web/src/WorkbenchPanelContent.tsx` — evidence filter `<nav aria-label="Evidence categories">` with five `aria-pressed` buttons (line 36); "Available sources" `role="group"` (33); `RetainedSourceOutput`/`DescriptorSelection` (43–68).
- `apps/web/src/WorkbenchPanels.tsx` — `WorkbenchRequestPanel` (11–23): bare `<table>` (21) with six `<th>`; `WorkbenchRunPanel` (24–33): `<dl>` + `<article>` operation cards.
- `apps/web/src/WorkbenchInputsPanel.tsx` — recovery buttons and `role="status"`/`role="alert"` usage (correct already).
- `apps/web/src/WorkbenchOutput.tsx` — scrollable `role="region"` viewport `tabIndex={0}`, `role="list"`/`role="listitem"` rows with `aria-posinset`/`aria-setsize` (137–143). Already correct; keep.
- `apps/web/src/BackgroundWork.tsx` — `HumanStepCard` bare `<fieldset disabled={busy}>` (117); errors rendered as `role="status" className="error-text"` (118, 124, 158, 171, 193, 217); `IntakeSection` shared `Select aria-label="Approval model"` (225); `restoreFocus` helper (99–101); `WorkCard` `tabIndex={-1}` ref target (143).
- `packages/ui-shell/Modal.tsx` — native `<dialog>` + `showModal`, focus trap on Tab, `onCancel` → `onClose`, previous-focus restore (18–34). Keep unchanged.
- `apps/web/src/styles.css` — global `:focus-visible { outline:2px solid var(--ui-focus-ring,#808080) }` (14); `.sr-only` (44); theme tokens `--surface --text --muted --accent --danger --border --selection-bg` (3–4).
- `packages/ui-shell/tokens.css` — motion tokens `--ui-motion-hover:120ms --ui-ease-move` etc.; reduced-motion handled via `data-motion` + `prefers-reduced-motion`.
- Existing precedent: `list-navigation.ts` (`useListNavigation`) powers `Select`'s roving arrow-key list.

## DESIGN

### D1. Tab strips → real tabs (WorkbenchDialog nav, evidence filter)

Replace both `<nav>` button groups with the tabs pattern; visuals unchanged.

Markup (`WorkbenchDialog`, `SourceWorkbench.tsx` ~line 201):

```jsx
<div role="tablist" aria-label="Workbench views">
  {TABS.map(([id,label]) =>
    <button type="button" role="tab" id={`wb-tab-${id}`}
      aria-selected={tab===id} aria-controls={`wb-panel-${id}`}
      tabIndex={tab===id?0:-1}
      onClick={()=>activate(id)}
      onKeyDown={onTabKeyDown}>{label}</button>)}
</div>
<div role="tabpanel" id={`wb-panel-${tab}`} aria-labelledby={`wb-tab-${tab}`} tabIndex={0}>
```

- `TABS` = `[['request','Last request'],['tools','Tools'],['run','Run'],['sources','Sources'],['evidence','Evidence']]`.
- Automatic activation: ArrowRight/ArrowLeft move focus AND select (Home/End jump to first/last). Wraps at the ends.
- `tabIndex` roving: selected tab `0`, others `-1`.
- The `tabpanel` wrapper gets `tabIndex={0}` so keyboard users can scroll the panel with arrow keys after Tab; keep `min-width:0`.
- CSS (replace `.workbench-panel nav` rules):
  - container selector `.workbench-panel [role="tablist"] { display:flex; flex-wrap:wrap; gap:6px; }`
  - selected: `.workbench-panel [role="tab"][aria-selected="true"] { color:var(--text); background:var(--selection-bg); }` — identical to current `aria-pressed` style; delete the old selector.
  - transition on background: `transition:background-color var(--ui-motion-hover) var(--ui-ease-move)` (120ms); inside `@media (prefers-reduced-motion:reduce) { transition:none; }`.

Evidence filter (`WorkbenchPanelContent.tsx` ~line 36): same tabs pattern — `role="tablist" aria-label="Evidence categories"`, buttons `role="tab" aria-selected aria-controls`, content `role="tabpanel" tabIndex={0}`. (Not radiogroup: the region swaps content like a tab.)

Keep `persistView` calls on sources/evidence activation exactly as now.

### D2. Accessible names for repeated controls

- `WorkbenchComposer` chips: `aria-label={`Open source ${label}`}` on Open, `aria-label={`Remove source ${label}`}` on Remove, `aria-label={`Refresh source ${label}`}` / `aria-label={`Keep captured source ${label}`}` on the stale-state actions, where `label = source?.label ?? ref.source.sourceId`.
- "Inspect retained source N" buttons in `WorkbenchInputsPanel`: `aria-label={`Inspect retained source ${index+1} of input ${input.inputId}`}`.
- `IntakeSection` model select: `aria-label={`Model for approved task: ${record.proposedTask.title}`}` (per-row, not shared text).
- `WorkCard` "Output" toggle: `aria-label={`Output for ${work.title}`}` (keep existing `aria-expanded`/`aria-controls`); "Cancel": `aria-label={`Cancel ${work.title}`}`; "Open child task": `aria-label={`Open child task for ${work.title}`}`.
- `HumanStepCard` "Decline"/"Respond": `aria-label={`Decline response for ${work.title}`}` / visible text stays "Respond"/"Submitting…".

### D3. Announcements

- Errors that follow a failed action: change `role="status"` → `role="alert"` in `BackgroundWork.tsx` at the five error sites (cardError, actionError, outputError, rowError, intakeError). Keep `className="error-text"`.
- Add a visually hidden live region in `BackgroundWorkView`, after `.background-toolbar`:
  `<p className="sr-only" role="status" aria-live="polite">{announce}</p>`
  where `announce = loading && !data ? '' : data ? `Background work updated: ${works.length} work item(s), ${schedules.length} schedule(s), ${intake.records.length} intake record(s).` : ''`. Compute in the component; announce on every successful `refreshBackgroundWork` commit (i.e., derive from `data.sequence`, not on render noise: `const announce = data ? ... : ''` rendered unconditionally is sufficient because React only re-announces on text change).
- "Loading background work…" stays `role="status"`. The `role="note"` close warning stays.

### D4. Table semantics (`WorkbenchRequestPanel`)

- `<table>` → add `aria-label={tools?'Tool segments in the recorded request':'Recorded request segments'}`; every `<th>` gets `scope="col"`.
- `WorkbenchRunPanel` operation `<article>`s: add `aria-label={operation.description}` is redundant (the `<strong>` names it); leave as is.

### D5. Focus order and focus return

- Dialog open: native `showModal` focuses the first focusable element (the header Close button). Change: mark the *selected* tab button with `autoFocus` (React `autoFocus` on the `role="tab"` whose `aria-selected` is true). On each re-render only the initial mount auto-focuses; after that, focus stays where the user put it.
- Close paths (Esc, Close button, backdrop click) already return focus to the previously focused element via `Modal`'s `previous.focus()`. Verify the opener ("Sources and evidence" button, "Inspect queued source inputs" button) still receives focus; add the regression test in VALIDATION. No code change expected here.
- Busy-state focus loss: existing `restoreFocus` in `BackgroundWork.tsx` covers Cancel/Pause/Approve/Reject/Respond settle — keep. Extend one case: after `onOpenThread` navigation the pane may unmount; no restore needed there (navigation moves context intentionally).
- `WorkCard`/`ScheduleRow`/`IntakeSection`/`li` keep `tabIndex={-1}` (programmatic focus only, not in tab order). This is correct; do not put them in the Tab order.

### D6. Fieldset naming (`HumanStepCard`)

- `<fieldset disabled={busy}>` → `<fieldset disabled={busy} aria-label={`Response for ${work.title}`}>`. Copy unchanged.

### D7. Focus visibility

- Global `:focus-visible` (2px `--ui-focus-ring` outline) covers all buttons. Add `outline-offset:2px` on `.workbench-panel [role="tab"]:focus-visible` and `.workbench-source-chip button:focus-visible` so the ring isn't clipped by adjacent borders. `.workbench-output-viewport` already sets its own `outline-offset:-2px`; keep.

### D8. Reduced motion

- No new animation is introduced. The only new transition (D1 tab background, 120ms `var(--ui-ease-move)`) is wrapped in `@media (prefers-reduced-motion:reduce){ transition:none; }` matching the codebase's existing pattern. All state changes remain instantaneous. `Modal`'s existing backdrop/dialog motion is untouched and already honors `data-motion`/`prefers-reduced-motion` via `tokens.css`.

### States (all covered)

- Tab selected/unselected/hover/disabled (no disabled tabs exist); panel loading (`role="status"` text stays); empty lists; error (`role="alert"`); busy (buttons `disabled`, focus restored); dialog closed (unmounted, focus returned); pane with no data (empty text stays).

## EXECUTION_DAG

- **T01 — Tabs in WorkbenchDialog** (`SourceWorkbench.tsx`, `source-workbench.css`): implement D1 markup + keydown + `autoFocus` on selected tab + CSS swap. Done when arrow keys activate tabs and axe reports the tablist pattern.
- **T02 — Tabs in evidence filter** (`WorkbenchPanelContent.tsx`): same pattern per D1. Independent of T01.
- **T03 — Accessible names** (D2): `SourceWorkbench.tsx`, `WorkbenchInputsPanel.tsx`, `BackgroundWork.tsx`. Independent.
- **T04 — Announcements** (D3): `role="alert"` error swaps + live region in `BackgroundWorkView`. Independent.
- **T05 — Table semantics** (D4): `WorkbenchPanels.tsx`. Independent.
- **T06 — Fieldset label** (D6): `BackgroundWork.tsx`. Independent.
- **T07 — Focus-visible offsets** (D7): `source-workbench.css`. Independent.
- **T08 — a11y test file** `tests/workspace-a11y.test.tsx` (see VALIDATION): covers tab keyboard nav, focus return on close, live-region text, aria names. Depends on T01–T07.

Each task's owner edits only the files listed; no shared-state conflicts.

## VALIDATION

- `pnpm lint && pnpm typecheck` — must pass.
- New unit/component test `tests/workspace-a11y.test.tsx` (React Testing Library + existing vitest setup; jsdom):
  1. WorkbenchDialog tab strip: `getAllByRole('tab')` length 5; ArrowRight moves `aria-selected` to next; ArrowLeft wraps; Home/End; `tabpanel` labelled by active tab.
  2. Evidence filter: identical expectations for 5 categories.
  3. Modal close: render `WorkbenchDialog` through a harness that records `document.activeElement` of the opener, close via Esc, assert focus returns to the opener element.
  4. `BackgroundWorkView` fixture (component is exported and takes plain props): assert `role="status"` live region text contains counts; assert each `role="alert"` error appears; assert per-control accessible names (`Open child task for <title>` etc.); assert `aria-expanded` toggles on Output.
  5. `WorkbenchRequestPanel` table: `scope="col"` on all headers, `aria-label` present.
  6. Chip buttons: names contain the source label.
- axe: run `axe-core` (or `@axe-core/playwright` if present) over the three rendered fixtures in the test file; expect 0 violations. If axe is not already a dependency, the test asserts the roles/names directly instead — do NOT add a dependency; note it as manual verification.
- Manual/real-user check (QA): keyboard-only run-through of flows 1–4 in REQUIREMENTS in the fixture host (`node --import tsx … review-host` + Vite); screen reader pass (NVDA on Windows or VoiceOver) on the dialog and background pane; axe DevTools scan of both surfaces, 0 violations.
- Acceptance matrix: every REQUIREMENTS item ↔ at least one test or the QA pass.

## STATE

- Researched/decided: all of DESIGN; verified against baseline SHA.
- Implemented: nothing yet.
- Verified: nothing yet.
- Risks: jsdom `showModal` support — if absent in the vitest jsdom, polyfill `dialog.showModal/close` no-ops in the test or assert focus restore via the `retainFocus` path instead; flag in the PR if this happens.
- Next step: implementer picks up T01–T08 from the issue.

## REFERENCES

- Issue: https://github.com/skytuhua-org/Gen-V1/issues/583
- `AGENTS.md` (repo root) — checkpoint/release contract.
- `packages/ui-shell/list-navigation.ts` — existing roving-navigation helper (reuse `isComposing` for IME-safe key handling).
- WAI-ARAPG tabs pattern: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- Baseline: `e883ac0327c834120d89c3697dec7380a342ba4d` on `main`.
