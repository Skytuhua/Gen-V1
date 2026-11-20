# Worker 3. Shared motion, forms, charts and context

Implement the following changes in `skytuhua-org/Gen-V1`. Refine how published content and tabs appear. Then make review queues, editable records, parameter proposals, nested answers, source tables, charts, forms and context usage respond to their own data. You own the shared motion, tab and registry edits used in this prompt.

You own eight interfaces. Return one working branch, one individually playable MP4 for each interface and the verification results. This entire Markdown file is your instruction. Execute it in one worker session from the pinned base.

| UI | Assignment | Review video to return |
| --- | --- | --- |
| 13 | Item review queue | `13-review-queue.mp4` |
| 14 | Editable records | `14-editable-table.mp4` |
| 15 | Parameter controls | `15-parameter-controls.mp4` |
| 22 | Nested questions and answers | `22-faq-disclosure.mp4` |
| 23 | Source tables and migration inspection | `23-source-tables.mp4` |
| 24 | Bar, line and scatter charts | `24-chart-variants.mp4` |
| 26 | Contextual forms and choices | `26-form-controls.mp4` |
| 29 | Context usage inspector | `29-context-inspector.mp4` |

## Start from the inspected source

Use the existing authorized checkout of [skytuhua-org/Gen-V1](https://github.com/skytuhua-org/Gen-V1). The common starting commit is `26ddf4d16c2fc1196b520d8a46c5441d64d01463`. Every section below can be implemented against that commit in this branch. Use a full checkout with its workspace packages, fixtures and lockfile. From the repository root, in Bash:

```bash
set -euo pipefail
BASE_SHA=26ddf4d16c2fc1196b520d8a46c5441d64d01463
BRANCH=refine/forms-charts-motion
if ! git cat-file -e "$BASE_SHA^{commit}" 2>/dev/null; then git fetch origin "$BASE_SHA"; fi
WORK_RUN=$(mktemp -d "${TMPDIR:-/tmp}/gen-v1-worker-3.XXXXXX")
export WORK_RUN BASE_SHA BRANCH
export EVIDENCE="$WORK_RUN/evidence"
mkdir -p "$EVIDENCE"
git worktree add -b "$BRANCH" "$WORK_RUN/src" "$BASE_SHA"
cd "$WORK_RUN/src"
git rev-parse HEAD > "$EVIDENCE/base-sha.txt"
test "$(git rev-parse HEAD)" = "$BASE_SHA"
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

Use Node 24.10.0 or later with the repository’s pnpm 10.30.3. If resuming, reopen your existing branch/worktree and evidence directory and verify the base is its ancestor. Run the repository setup in `docs/getting-started.md` for native prerequisites. Browser suites that set `channel: 'chrome'` require branded Chrome. In your disposable environment, if launching that channel fails, run `pnpm exec playwright install chrome` and retry. On Windows, suites configured with `msedge` require the Edge channel. Launch that channel once and provision it in the disposable VM if missing. Capture requires `ffmpeg` and `ffprobe` on PATH.

The file lists under the implementation sections are the complete tracked edit scope. Read any other named source or test as needed. Put temporary recording code in a separate disposable checkout and return it with your evidence. Keep review MP4s and generated evidence outside the source tree.

## Interaction rules

Use real component and entity identity. Separate first publication, changed source data, pointer intent, keyboard activation and restored state. Baseline the first committed record. Run a source effect only on the entity and fields that actually changed. An identical snapshot, theme switch, remount of an existing artifact or unrelated revision must preserve the resting state. Compare pending intent with the owner and expected target ID, consume it once and discard it on interruption. Classify native button clicks with `event.detail > 0` as pointer. Treat keyboard and assistive activation as immediate.

Commit the true value, accessible name, action availability and focus in the first applicable frame. Decorate that committed state. Keep text editable and selectable, and preserve field node, caret, selection, scroll, grants and request identity. Direct drawing, dragging and keyboard navigation track input immediately. When reversing a pointer-triggered animation, sample its visible geometry or opacity before cancelling it. Clean up unfinished effects, observers and callbacks when the owner changes, policy changes or the surface unmounts.

At default speed use the repository enter curve `cubic-bezier(.16,1,.3,1)` and move curve `cubic-bezier(.4,0,.2,1)`. The per-interface instructions specify durations, distances, grouping and exceptions. Follow the existing motion-speed token. Use the live effective app and OS policy. Off is immediate. Under reduced motion remove travel and stagger. Where a section explicitly permits opacity feedback, cap it at 80 ms. If full motion is disabled mid-flight, settle to the latest state immediately. Use the existing `animateTask`, `readMotionPolicy` and `observeMotionPolicy` contracts, and a local cancellation subscription where necessary. Keep one geometry owner. Preserve the existing interruptible spring on measured regions that use it. Reserve a final layout slot before animating its contents.

The supplied 30 fps reference shows the source of the design decisions. During frames 522–555 a slot opens for one resolution commit while earlier rows remain recognizable. During frames 593–632 the test count grows on that same row. During frames 657–678 the Merge control is available as the four validation checks finish appearing. During frames 891–917 the completion accent travels along the affected branch. Apply those relationships to the concrete objects below. Keep the camera fixed. The per-interface milliseconds are implementation targets, with no claim that the recording exposes its CSS curves.

Measure compactness inside the artifact. Keep real PDF margins, image aspect ratios, chart domains, focus rings and source gaps. Remove the specific redundant row, unused track or inherited minimum identified in the interface instructions. Keep touch targets at least 44 CSS px where the component presents coarse-pointer controls. Use the current visual language and existing tokens. Add no decorative headings, filler copy, synthetic metrics or simulated production outcomes.

## First visible generation

The original films started after the UI had settled. Implement the following first-publication details in the owned component and verify them in the new opening sequence. The host’s existing `useArtifactEntrance` marks a genuinely new artifact with `[data-entry-phase="entering"]`. In the catalog, gate the one local effect below on that marker and full effective motion. Use the existing enter curve, zero delay and an absolutely positioned, `aria-hidden`, non-interactive ornament for a new rule or tick. Where an existing mark is named, layer the effect on its artwork. Keep controls, factual content and layout immediately available. At most one treatment per numbered interface may run on first publication. Ordinary additions inside an already present artifact use the change rules in their own section.
For the host surface without an artifact ancestor, use its own event. Baseline the first loaded snapshot, then distinguish a newly published request/plan by its thread and ID, or an explicit inspector-open action. Skip the decoration when restoring the same object.

| UI | Exact first-publication treatment |
| --- | --- |
| 13 | Bring the current item’s narrow position rule from .5 to 1 opacity over 120 ms. Item text and response controls occupy final positions. An empty queue stays still. |
| 14 | Reveal a 16 px underline under the first editable column heading over 120 ms. Row values, input slots and edit highlights stay final. Show no proposed-change treatment before an edit. |
| 15 | Reveal a 14 px tick beneath the first parameter label over 100 ms. Leave the source image, editable values and proposal summary at their intrinsic geometry. Display the summary only when a proposal exists. |
| 22 | Show one 100 ms opacity rise (.65 to 1) on the first top-level question’s existing disclosure chevron. Leave subsequent questions, open state and answer content steady. |
| 23 | Draw a 16 px rule under the first visible source column heading over 120 ms. Leave the cells and controls at full contrast. Reserve cell-change feedback for accepted value changes. |
| 24 | Reveal only the first labeled tick mark on the chart’s existing axis from .5 opacity to 1 over 120 ms. Maintain final scale, data coordinates and point visibility. A chart with no plottable observations has no tick treatment. |
| 26 | Reveal a 12 px underline beneath the label for the delivery choice group over 100 ms. First paint includes all enabled choices and editable values. A preselected option is already readable. |
| 29 | Opening the inspector is the generation event for this host surface. Use the pointer-triggered anchored popover from section 29. Its header, segments, actions and current measurement are ready on the first frame. Keyboard opening and reopening a restored record must never replay a compaction receipt. |

Exercise each positive opening with the delayed fixture publication in its assigned browser spec. Test the same record when already present at bootstrap, an identical republish, and app reduced/off. Count one eligible local start for the positive case and zero on the others. For an absent target, assert zero and verify the usable fallback. Cancel on first input, policy downgrade, source replacement or unmount. Clip only the decorative mark. The existing outer artifact entrance keeps its own transform.

## What the original recordings showed

Use these observations to reproduce each issue. The clips used an authored fixture on commit `4bcdc82a73a28d27d6ebe413a527389119f35292`. Each timestamp is relative to its own MP4. Recheck the behavior on the assigned source commit before editing.

| UI | Original video time | What is visible |
| --- | --- | --- |
| 13 | 6.625–7.125 s | Next changes Public signature to Empty basket. Material enters horizontally and the changing content height moves surrounding controls. |
| 14 | 7.875–8.375 s | The submit button changes to Sending then returns to Review changes. Its label width changes; the two edited cells remain proposals. |
| 15 | 3.884–6.750 s | The retained full-resolution chapter shows the left image stretched vertically to the much taller controls column. |
| 22 | 00:04.1–00:05.3 | Answer content appears and a related-question placeholder resolves to a follow-up row. |
| 23 | 00:07.1–00:08.4 | Switching to users dims the panel briefly; source updates then reveal changed values. |
| 24 | 00:03.5–00:04.8 | View chart data expands a tall pretty-printed JSON block for only five records; chart context scrolls upward. |
| 26 | 00:01.7 | The artifact has two equal columns: a populated form on the left and only a short step instruction/navigation on the right. |
| 29 | 00:11.6–00:12.1 | The fixture publishes 34K/200K and a changed category breakdown; the display updates from the source. |

## Verify each interface

1. Before editing, open the named renderer, selector, fixture, and existing tests. Trigger the recorded sequence and save the relevant pre-change screenshot or measured failure. If the pinned version already passes a requirement, record the passing assertion and make only the remaining changes.
2. Run the existing baseline cases using the Playwright configuration stated under the interface. Add the new regression tests in the assigned spec. Repeat the filtered command with `--list` to confirm each new case is collected, run it on pre-fix code, implement the change and run the listed checks again. Repeat your direct interaction. Zero discovered tests, a missing browser or a port error cannot establish a pass. Capture both sides of a decisive transition. When testing mid-flight, wait for the actual active effect or geometry phase, reverse immediately, and assert the final state. Do not rely on an arbitrary sleep to prove causality.
3. Exercise the primary flow at 1440 × 1000 in dark/full motion, at 390 × 844 with light/touch input, at 640 CSS px of measured artifact width, and at native 200% browser zoom. Record the zoomed viewport width and device-pixel ratio. Check the case with keyboard, app reduced, app full with OS reduced, and app off. Interrupt at least one active effect with a policy switch. On a representative long, missing or failed source record, verify wrapping, focus, data identity and continued action access.
4. Run in a separate VM/container so the repository’s fixed browser ports remain isolated. If the four sessions share one POSIX host, put the following function in each worker shell and prefix every browser-test, recorder and browser-based visual-check command with `ui_browser`. It serializes only browser processes that share that host. On native Windows, use an isolated worker VM for browser runs.

```bash
ui_browser() {
  python3 - "$@" <<'PYLOCK'
import fcntl, os, subprocess, sys
with open(f"/tmp/gen-v1-ui-browser-{os.getuid()}.lock", "a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    raise SystemExit(subprocess.call(sys.argv[1:]))
PYLOCK
}
```

5. Install the required browser and run the targeted commands as written inside your worktree. Reuse a passing full-suite run for sections using that same suite on the same commit. Keep actual exit codes, collected/passed counts, console/page errors, screenshots, and source fixtures. Re-run affected checks after any later change. A baseline failure needs the command, base SHA and original failure signature. Keep distinct evidence for keyboard, restoration, grant revocation, repeated updates and cancellation wherever specified.

## Shared motion and tabs

Implement this section first in your own checkout. Keep effect bookkeeping local to the active component. Controls remain usable and presented values update on the first committed frame.

### Owned files

- `apps/web/src/task-motion.tsx`
- `apps/web/src/task-motion.css`
- `apps/web/src/registry.tsx`
- `tests/e2e/tabs-identity.spec.ts`
- `tests/e2e/generative-refinement.spec.ts` (new)
- `scripts/browser-suites.ts`
- `scripts/public-source-files.json`

### Event cause API

Add this named export to `apps/web/src/task-motion.tsx`. Import `useMemo` from React alongside the existing hooks.

```ts
export type TaskEffectCause =
  | 'publication' | 'source-update' | 'pointer' | 'keyboard' | 'restore';

export function useTaskEffectCause(): {
  mark(cause: TaskEffectCause): void;
  take(): TaskEffectCause;
} {
  const nextCause = useRef<TaskEffectCause>('restore');
  return useMemo(() => ({
    mark(cause: TaskEffectCause) {
      nextCause.current = cause;
    },
    take(): TaskEffectCause {
      const cause = nextCause.current;
      nextCause.current = 'restore';
      return cause;
    },
  }), []);
}
```

Use one hook instance per independently selectable control. Mark immediately before a synchronous, value-changing update. An owner with asynchronous external updates also tracks the expected target ID. Consume the cause once on the matching committed ID. Clear it on abandonment, owner or mismatched ID change. Use native click `detail > 0` for pointer and `detail === 0` for keyboard or assistive activation. An unchanged selection produces no effect. Never carry a pointer intent across an awaited host response.

### Implement and test

1. Register `tests/e2e/generative-refinement.spec.ts` exactly once in the sorted unique `source` list of `scripts/public-source-files.json`. Preserve its `runtime` list. Add the test to `rootBrowserSpecs` once. Use the existing public-source test below to check registration.
2. Read the existing `animateTask`, `useArtifactEntrance`, `MotionRegion`, `motion-policy.ts` and the registry’s `Tabs` before editing. Keep all hooks above conditional returns. Preserve the duplicate-label alert, saved-label fallback, mounted visited panels, roving tab indices, tab status slots and operation footer. Keep the two existing Tabs fixture inputs for the regression tests.

3. In animateTask retain the current public arguments, return type and finish/cancel cleanup. When any running full-motion effect sees effective policy become reduced or off, settle it immediately, including an opacity-only animation. An effect started under reduced may use opacity only, capped at 80 ms, and must settle when policy switches to off. Retain existing caller completion semantics for temporary shells. Keep static styles at the committed final value.
4. In Tabs use one channel for intentional tab selection. Preserve the button elements and panel subtrees. Add a ref for the actual tablist, a ref for the one decorative indicator, and a local pending target label. Store old indicator viewport rect before an actual pointer selection. Classify native keyboard/AT activation and direct arrow handlers as instant. A click on the already active tab clears pending intent. On accepted change place the indicator at the new active button's bottom, using its actual rectangle relative to the tablist, including scroll offsets. Use an aria-hidden, pointer-events:none span after all buttons. Use querySelectorAll('[role="tab"]') for indexed focus, so the indicator cannot become a roving focus target.
5. Style the indicator at 2 px high with currentColor in the selected tab's text color, absolute position and transform-origin:left center. It must occupy no layout width. Scope any replacement of the old selected bottom border to this tablist with its working indicator, maintaining a transparent 2 px reservation if the existing button requires it. After setting final left/top/width, use a single FLIP transform from the sampled old rect (translation and relative width) to identity for 140 ms with movement easing cubic-bezier(.4,0,.2,1). If either dimension is zero, rows wrap onto a different line, cause is keyboard/restore/source, or policy is reduced/off, paint final position immediately. Cancel old transforms when the selection changes. On pointer reversal sample the currently painted indicator before canceling.
6. Use one ResizeObserver for the tablist and active button to recompute the static final rect after a text wrap or font/viewport size change. Track the active button by label. On resize or nearest horizontal tablist scrolling cancel travel and settle to the measured rect. Remove subscriptions on unmount. Remove the .task-tab-panel:not([hidden]) fade. Remove its keyframes only when rg confirms no other rule references them. Existing outer width, chart/table mechanics, body position and focused button stay stable.
7. Add tests to tabs-identity.spec.ts using its existing two-input fixture. Start on Preview, enter text in its input, pointer-click Details, verify active panel immediately, and sample the indicator versus the active button at settle (within 1 CSS px). Verify both original input nodes survive the round trip. ArrowRight, Home, End and repeated identical snapshots never animate a panel or a traveling indicator. Update a source status in the inactive tab using host.setInput plus host.publish. Current selection, draft and indicator geometry remain correct. Include reduced mid-flight, nested tablists (two instances), a narrow wrap case and a zero-width hidden parent that becomes visible. Each control must resolve its own ref.
8. In the new generative-refinement.spec.ts use taskFixture/serveTaskFixture and the publication instrumentation in artifact-settle.spec.ts. Bootstrap without the artifact, publish its existing id by the same update path as the host, and observe a real .artifact-body entrance. Start also with that artifact present at bootstrap in a second context and verify restore has no entry effect. Republish three times, update an unrelated record, and switch presentation theme after first publication. An unchanged artifact must not re-enter. Exercise interaction during entrance, toggle app off mid-effect, and assert the final input stays mounted and editable. Include an isolated opacity-only full-effect case toggled to reduced while running to verify step 3. Reuse existing app/fixture helpers and the test-side WAAPI interception pattern. No test hook in production.

Run the following focused checks after the edits.

```bash
pnpm exec playwright test --config tests/e2e/tabs-identity.playwright.config.ts tests/e2e/tabs-identity.spec.ts
pnpm exec playwright test --config playwright.config.ts tests/e2e/generative-refinement.spec.ts
pnpm exec playwright test --config tests/e2e/artifact-settle.playwright.config.ts tests/e2e/artifact-settle.spec.ts
pnpm exec vitest run tests/public-source.test.ts tests/motion-policy.test.ts tests/motion-spring.test.ts tests/content-motion.test.ts
```

## 13. Review queue

### Owned files

- `apps/web/src/InteractionTools.tsx`
- `apps/web/src/interaction-tools.css`
- `tests/e2e/interaction-tools.spec.ts`
- `tests/e2e/task-reviewing.spec.ts`

### Baseline and source

The audited recording is `13-review-queue.mp4`. At 3.875 s, request changes is selected and a comment is entered for the current item.

Read ReviewQueue, ReviewMaterial, reviewValue and the state branch saved.items. Read `task-reviewing.spec.ts` and existing interruption tests in interaction-tools.spec.ts. The top rail replaces pagination currently beneath the comment. The supplied source Diff lives outside this component.

### Implementation

1. Render the working group in this order: the stable review header, a rail with Item N of M, selected item title and Previous item/Next item buttons, the review body, existing compact item-index nav, and the footer. Use one visible title in the new rail with a stable ID. Give the article that accessible name through aria-labelledby. Put the active title in a flexible text column with wrapping below its first line while pinning both nav buttons to the top edge. Keep the item position and action edges in the same coordinates across items. When content width is <500px put position + controls on the first rail line and the title on the next. Put the article and .review-decisions plus .review-comment inside .review-item-detail. Keep `<nav aria-label="Review items">` below this detail.

2. Use a CSS container rule at inner width 716px or greater for .review-item-detail: minmax(400px,1fr) 300px and gap 16px, aligned to start, no tall shared minimum. Keep content order material then response. Below 716px stack with 12px gap. Preserve 54px minimum comment, 2 textarea rows, accessible radios and 44px touch actions. Keep existing .review-queue overrides more specific than .artifact inline sticky styling, use position:static. Long evidence wraps.

3. Pass the cause from concrete Previous/Next and item-index activation into the material owner, compute signed direction from old/new data order. Pointer replaces only the visible article with opacity .8→1 and translateX(+6px for forward, -6px for back)→0 over 180ms, ease-enter, no overshoot. If a previous animation is running or paused, sample its current opacity and transform before cancellation and use both as the first keyframe on reversal. A source removal fallback, validation jump, restore, same ID rerender, keyboard activation or programmatic click with detail=0 uses immediate final content. Do not remount the textarea or radios. Update the aria-label, code, index and accessible text immediately. Use 120ms decision color feedback for deliberate pointer choices and no delayed radio state.

4. Keep saved.items keyed by source item ID, never array index. Persist drafts and selectedId through reload. Reordered items retain their own drafts, absent items are excluded from submission. Same ID with revised evidence retains that item's decision/comment. Keep the typed decision validator, 2,000-character limit, required revise comment, current validation messages, and exact reviews payload. Set the footer's live readiness text to “Review submitted” once await action.run returns true for the submitted entries, leaving the button mounted and re-enabled with its authored label. Invalidate the receipt on edit, source item changes or later submit. Only show it if the submitted IDs, decisions and comments still match current data and there has been no intervening edit. On failure keep the draft and error.

5. Set article travel absent for reduced/off. In full mode focus/pointer input in the article settles its current entrance. Direct typing and native controls never wait. On a keyboard-triggered change of item keep focus at the invoking control if still enabled. If it becomes disabled at first/last item move to the opposite enabled pagination button with preventScroll. Do not duplicate the adjacent source diff.

### Browser acceptance

1. In task-reviewing.spec.ts update “review puts the supplied material before its compact navigation and decisions” to test both container layouts. At an explicitly set inner width of 720px assert evidence ends at or before the response column and their tops coincide within 1px. At 600px assert decisions are beneath material. In both measure Previous/Next boxes, navigate across a deliberately much longer evidence string and assert x/y stability ≤1px. Keep nav after work region, accessible item title and textarea height checks.

2. Update the two motion cases in interaction-tools.spec.ts. DOM .click() with detail=0 is an instant activation and keeps existing textbox focus. Its expected animation count is zero. Add a separate actual Playwright click for pointer motion. For interrupted retargeting, pause animation at 70ms, store computed transform/opacity, dispatch pointer-equivalent click detail:1 without advancing time, and verify the reversal first keyframe equals that live pose and ends at zero. Full policy yields one article animation per actual switch. Reduced/off and repeated snapshots yield zero. Preserve the comment node identity test.

3. With the real two-item fixture enter Request changes plus a comment on Public signature, Next, Accept on Empty basket, Previous. Check exact comment recovery. Reorder supplied items and verify the same IDs collect the same decisions. Hold then accept submit, assert one review envelope, one “Review submitted” announcement and zero operation.approve. Run the existing missing-comment, reload, pending-button identity, source diff, and reduced-motion tests.

### Run

```bash
pnpm exec playwright test --config tests/e2e/clarity-review-parameters.playwright.config.ts
```

## 14. Editable table

### Owned files

- `apps/web/src/InteractionTools.tsx`
- `apps/web/src/interaction-tools.css`
- `tests/e2e/interaction-tools.spec.ts`

### Baseline and source

The audited recording is `14-editable-table.mp4`. At 2.875 s, quantity changes from 4 to 6 and Was 4 appears beneath the input. Row space is already reserved.

Read EditableTable, FieldControl, typedInteractionValue, and the existing state shape values[stateKey].edits[rowId][columnId]. The existing delivery test uses `INTERACTION_REVIEW_DATA.EditableTable`. Consult the two lower-priority narrow layout overrides in interaction-tools.css before changing row spacing.

### Implementation

1. Use the existing stable rowId/columnId keys and computed edited predicate. Keep numeric draft strings (including temporarily invalid minus signs), booleans, nulls, and option ID/label conversions intact. Keep the read-only cell and unedited .editable-original markup behavior. Original-value labels mount only for dirty cells. Preserve the existing desktop 64px cell space and narrow 67px editable field minimum. Use 14px heading/footer gaps. Keep the touch targets and ≤640px card layout. Maintain exactly one field DOM element per cell and the authored accessible labels.

2. Use clean→dirty as the animation event, not each value. Set a stable data-edited marker. Use a scoped CSS transition on the affected field border/background: 120ms when entering the dirty state, 100ms on return to the supplied value. For a local first edit reveal mounted Was text from .65→1 over 80ms. Values are immediately readable. Zero effects for dirty→dirty, read-only cells, identical snapshots or restored draft. Gate an explicit animation-enabled attribute for delta/active input at the actual owning field. First mount/restore and unrelated source reconciliation are static. On a programmatic source apply clear the dirty marker immediately when Object.is(typed.value,source) becomes true. Do not add a whole-row tint or row-height animation.

3. Keep submit validation and reconstruction of typed changes from latest store. On submit capture the ordered [{rowId,columnId,value}] values from that invocation, derive the count there, then await action.run. Store an ephemeral acknowledged receipt bound to that submitted proposal and invalidated on any next edit or changed source/identity. If the result is false, show existing error and retain all edits. Reject any late result after a newer edit, even if later text matches an earlier draft. A true result shows singular “1 change sent for review” or plural “N changes sent for review”, without overwriting the source. Unrelated identical snapshots leave it present. A separate accepted source update owns applied values.

4. Use one stable footer action element and one live region. Reserve intrinsic button width with a CSS grid containing the authored label, Sending… and an invisible max-width placeholder built from the maximum eligible cells in the current schema and correct pluralized acknowledgment. Overlay the one readable visible label, aria-hide all sizing spans and allow wrapping to available width at narrow sizes. On acknowledged submit replace visible text with the exact receipt for 120ms opacity and 90ms local check. Disable repeats for that exact acknowledged/unchanged proposal. Next edit re-enables valid submit. Failed submit stays retryable. Keep click, focus and selection immediate. Use reduced ≤80ms opacity or off instant.

### Browser acceptance

1. Extend “editable records use compact typed columns with aligned draft and previous-value areas” and “delivery fixture keeps every narrow typed field visible…” in interaction-tools.spec.ts. In the delivery fixture fill Prints · Quantity from 4 to 6, select Prints · Priority = Urgent. Assert Was 4/Was Normal, exactly two dirty cells, and unchanged row boundary/other control rectangles within 1px. Fill quantity 7 then 6: original metadata is stable, no replay on further keystrokes. Restore 4: metadata disappears only for Quantity. Remaining Priority retains its proposal.

2. Add “a table acknowledgment belongs only to the submitted changes”. Delay an action.submit response. Check button width in idle, Sending… and receipt states, difference ≤1px. For the two-cell submission assert the exact typed changes for prints/quantity/6 and prints/priority/urgent, one “2 changes sent for review”, original source values unchanged and no automatic operation approval. Submit and then edit again before response in a fresh fixture: stale receipt stays absent. Reject with a host error and verify the same draft values remain retryable.

3. Publish source reorder while maintaining reference to the input DOM node and caret. Verify identity of edited cell and correct source Was value. Keep existing invalid draft, false/null, numeric step and read-only tests. At 390px and explicit 320px content width all fields meet existing bounds. Reduced and off produce exact text with no row movement or delayed editing.

### Run

```bash
pnpm exec playwright test --config tests/e2e/clarity-review-parameters.playwright.config.ts
```

## 15. Image export parameters

### Owned files

- `apps/web/src/InteractionTools.tsx`
- `apps/web/src/interaction-tools.css`
- `apps/web/src/registry.tsx`
- `tests/e2e/task-reviewing.spec.ts`

### Baseline and source

The audited recording is `15-parameter-controls.mp4`. At 3.125 s, typing Width 1920 opens a Current 1600 to Proposed 1920 summary. While the summary grows, the image becomes taller and the surrounding artifact scroll position changes.

Read Split, childTypes, Image and DocumentPair in registry.tsx. Read ParameterControls, FieldControl and ParameterProposal in InteractionTools.tsx, .surface-split and .surface-image in `apps/web/src/styles.css`, and the image-work Split with ratio .56 in `scripts/task-design-scenes.ts`. The source image has a 960:600 intrinsic ratio. Exercise the actual Image + ParameterControls pair.

### Implementation

1. In Split detect exactly two direct children with one Image and one ParameterControls, using the existing childTypes lookup. Preserve authored DOM order at wide widths, authored ratio clamped to current .1–.9 bounds, and the existing DocumentPair branch. Return one full-width container .parameter-preview-pair with container-type:inline-size, inside it a .surface-split.parameter-preview-columns with two grid children. Wrap only the Image child in `<figure className="parameter-source-figure">`. Preserve the original child React keys using the existing element.children IDs, .surface-image rendering, alt text, resource route and fallback. No invented caption or export preview. Leave other Split combinations under their existing behavior.

2. Define scoped styles in interaction-tools.css. Wide inner width ≥600px uses grid columns minmax(0,var(--source-fr)) minmax(280px,var(--controls-fr)) for Image-first. Mirror tracks if authored controls-first. Compute source/control fr from the declared ratio associated with that child. Use 16px gap, align-items:start. At <600px set one column and explicit visual order image then controls. The Image has no tab stop so this does not reverse keyboard navigation. Use selectors on the nested grid sufficiently specific to handle the global max-width:700px !important fallback. Set the figure margin:0, width:100%, min-width:0, align-self:start. Its img is display:block, width:100%, height:auto, max-width:100%, object-fit:contain. Obtain ratio from intrinsic pixels, never proposal Width/Quality.

3. Keep FieldControl numeric text drafts and slider events immediate. Keep Reset’s existing .focus({preventScroll:true}). Move the changes counter into an always-allocated single-line slot in the existing controls header so the first change never inserts a header above the inputs. If the outer artifact already owns the same title and the header would contain only the count, put this count after the proposal and before the footer action so it cannot displace the controls. If actionId is absent, render the same footer count slot without an action. Reserve 16px line height in whichever count location is used. Show the exact 1 change / N changes copy for nonzero counts and an empty aria-hidden spacer for zero. Do not add a duplicate title.

4. Inside ParameterProposal retain one MotionRegion plus the current retained content. Layout each changed parameter closely as its label, Current, Proposed, and Reset, wrapping into two lines when the row cannot fit inside the existing narrow control column. Keep nonempty content through the outgoing inert state. Pair geometry changes with just one .85→1 opacity handoff of 120ms on the first local 0→nonzero transition. Start the opacity handoff on the local edit or reopen event. Multiple keystrokes, revisions and restoration do not repeat it. No fixed-duration height or global Split animation. Reduced settles region immediately and uses ≤80ms local opacity. Off settles instantly. A denied image request never leaves a synthetic success preview. Existing validation, error messages and source data stay truthful.

### Browser acceptance

1. In task-reviewing.spec.ts add “an export proposal cannot stretch its source image”. Use taskFixture with exactly the two-child authored split, dataBinding data, stateKey draft, actionId ask, root artifact with before-image resource. After serveTaskFixture, route **/api/resources/before-image/content to a known 960×600 SVG fixture with explicit width, height and viewBox (test-only fixed rectangle). Wait for naturalWidth=960 and naturalHeight=600. At 1440×1000 and 700px pair width record image/Width control/conversation-scroll rects and scrollTop. Focus Width, then modify its value to 1920 and assert focus, image x/y/width/height at start, mid-spring and settlement are within 1px, and abs(renderedHeight-renderedWidth*600/960) ≤1px. Set the visible anchor so no native scroll is needed before measuring.

2. Click Reset Width. Expect focus on Width, value 1600, inert closing region, finite final height 0, retained image src, identical pixel geometry and no jump in scrollTop. During a second opening reverse with Reset, then enter 1920 again. Sample consecutive heights and verify continuation from the displayed value (no reset to fully closed mid-reversal). Keep source input.width=1600 until a separate setInput/publish. Run the existing malformed, failed submission and reset tests.

3. At 390px, and separately with the desktop viewport plus 500px pair, prove image bottom ≤ first control top, each visible element inside pair within 1px, exact natural aspect. Repeat reduced/off with no moving proposal height. Include a simple ordinary two-child Split without an image/parameters pair to assert its structure has no new pairing wrapper.

### Run

```bash
pnpm exec playwright test --config tests/e2e/clarity-review-parameters.playwright.config.ts
```

## 22. Progressive questions and follow-ups

### Owned files

- `apps/web/src/TaskDisclosure.tsx`
- `apps/web/src/task-interface.css`
- `apps/web/src/task-motion.css`
- `tests/e2e/task-interface.spec.ts`

### Baseline and source

In `22-faq-disclosure.mp4` at 3.4–5.3 s the pending answer and related-question placeholder resolve. At 7.7–8.3 s the nested question opens. Preserve the first branch when the second top-level question opens.

Open `Disclosure`, `FollowupBranch`, `IncomingAnswer` and `MotionRegion`. Disclosure already uses two regions with separate geometry, one for the answer and one for its branch. `.disclosure-children>.disclosure-node` currently applies unconditional child animation with nth-child delays.

### Implementation

1. Scope the child layout to `.disclosure-children` only. Indent 12 px, add one 1 px inline-start border using the existing border token, 8 px gap, minimum nested-row button height 36 px and 44 px for coarse pointers. Remove the nested row’s duplicated outer border/background, keep the button focus ring and expanded state. Make the empty branch take zero height and show no rule.

2. Record pointer or keyboard cause in the existing trigger. Set actual open state immediately. For full pointer activation rotate the trailing chevron over 140 ms with the movement easing cubic-bezier(.4,0,.2,1). For keyboard activation, instant restore and reduced/off, commit its final rotation immediately. Pass the cause-derived animate flag into both existing MotionRegions. Keep the two siblings’ independent coverage, one for each rectangle, without animating the same height twice. Keep mounted controls, aria-controls, aria-expanded and the local/store stateKey selection logic.

3. In task-motion.css delete the unconditional child entrance and associated nth-child stagger rules for these disclosures. Snapshot direct child DOM identities while this parent is open and settled. On a newly inserted real direct child after an independent source publication, reveal only the new child from opacity 0 to 1 and translateY(4px) to 0 over 180 ms with --ui-ease-enter if the parent is settled with no pending/resolving handoff. Initial mount, restored/opened children, reopens, parent motion and pending-to-real replacements use immediate child content. A repeat snapshot never replays a child.

4. Keep existing IncomingAnswer and its paragraph/sentence ownership. A source append renders the new text once. Preserve request deduplication and the retry action. On pending follow-up resolution keep the new real row interactive in normal flow and remove the outgoing visual overlay over 180 ms with opacity from its measured current value to zero. It is inert, pointer-events:none and aria-hidden after resolution. Keep existing measured positioning. A reversal, new pending cycle, unmount or policy change removes the old owned overlay. Reduced/off removes it immediately.

5. Separate genuine followup request/branch pending from opening a completed answer. On a load error preserve the actual supplied error and existing Try again action. Reopening a ready item sends no new action and never retypes existing text.

### Browser acceptance

1. Extend the existing `progressive Q&A keeps branches, edit identity and focus` case. Hold the destination note DOM handle, type a value, open a branch, append an answer sentence, replace its pending follow-up with a real node and publish the same data again. Assert exactly one focusable new button, no duplicate submission, same input DOM/value/caret and no replay for prior sentences.

2. Close while the placeholder exits, reopen with keyboard, and immediately tab into the real answer. Assert no hidden focus targets, no delayed interactive row, no lingering placeholder, no duplicate role=status announcement. Existing pending/retry case must still issue only the original request and one explicit retry.

### Run

```bash
pnpm exec playwright test --config tests/e2e/task-interface.playwright.config.ts tests/e2e/task-interface.spec.ts --grep 'progressive|pending question|nested composition'
```

## 23. Migration tables

### Owned files

- `apps/web/src/TaskTable.tsx`
- `apps/web/src/task-table.css`
- `scripts/task-design-scenes.ts`
- `tests/e2e/operational-motion.spec.ts`

### Baseline and source

In `23-source-tables.mp4` at 4.2–4.7 s cell values change alongside reported progress. At 7.1–8.4 s the entire Users panel dims when selected. The changed cell should carry the acknowledgment.

Read Table’s accepted-cell effect, `visibleBounds`, the column geometry effect, `TaskTableControls` and `migration` construction in `taskDesignScenes`. Read the existing accepted-cell and declared-sweep test. The shared Tabs implementation above owns the tab indicator and panel visibility.

### Implementation

1. In the migration composition in task-design-scenes.ts, after populating its nodes, set root.children to `['outcome','schema','progress','tables','summary','sqlDetails']` and remove `'progress'` from summary.children. Keep the same progress node and its max, status/evidence/SQL bindings and actual accepted counts. Keep the two disclosure titles `Migration evidence` and `SQL and approval details` for accessible navigation. In the review-scene projection removing schema and chart, the order becomes outcome, progress, table, evidence, SQL. No database action is introduced.

2. Preserve 34 px desktop rows and the existing before → after text and accessible changed status, including a genuine null. In the accepted-cell layout effect replace the 400 ms background and translating text/temporary overlaid old value with one 240 ms cell-background accent. Use existing success token at 0%, 12%, 0% at offsets 0, .35, 1 respectively. Text and numeric geometry are final at commit. Delete dead overlay bookkeeping and the CSS used solely by that removed overlay. Keep the independent declared active-row sweep and existing viewport cap of 200 animated cells.

3. Use stable source identity, row ID and column key. Establish a baseline on mount and source-identity change without animation. For each accepted new snapshot, compare prior cell value and meaningful change status/before to the latest state. A revision or tooltip/title text alone cannot trigger a highlight. Visible existing cells require an actual value/status/before change. A newly supplied row explicitly marked added can highlight its newly accepted status. Mark hidden-cell signatures as observed so that filters, scrolling, tab activation and replayed revisions never generate a delayed accent.

4. Source and accessibility values change immediately in every motion mode. Under reduced/off keep the existing static before/after and change marker and skip this accent. Preserve resize/reorder handling, checkbox state, manual-scroll Follow cancellation and the existing stable table/column identity behavior. Use the Tabs behavior implemented in this prompt. Leave the table panel in its final position.

### Browser acceptance

1. In `accepted cell values reveal with the change highlight...` replace the old assertion that .task-table-value animates. Using the same fixture, publish `NULL` → `studio`, assert text is at its final position in the first committed frame and only cell background animates. Publish a second revision changing activeRowId but identical value/change metadata. Sweep moves to the requested row. Zero replay on that cell.

2. Publish the same value while its tab is hidden, return with ArrowRight then ArrowLeft, and assert immediate visible content, no panel fade/no delayed highlight. Reorder with keyboard, resize with pointer and change selected rows, verifying the same header/input remains mounted. Preserve the existing column geometry test and expanded Follow takeover test.

### Run

```bash
pnpm exec playwright test --config playwright.config.ts tests/e2e/operational-motion.spec.ts --grep 'accepted cell|column geometry'
pnpm exec playwright test --config tests/e2e/task-interface.playwright.config.ts tests/e2e/task-interface.spec.ts --grep 'expanded table'
pnpm exec vitest run tests/task-table-controls.test.ts
```

## 24. Chart variants and source data

### Owned files

- `apps/web/src/registry.tsx`
- `apps/web/src/styles.css`
- `packages/ui-catalog/index.ts`
- `tests/e2e/chart-coordinates.spec.ts`

### Baseline and source

The audited recording is `24-chart-variants.mp4`. At 00:03.5–00:04.8, view chart data expands a tall pretty-printed JSON block for only five records. Chart context scrolls upward.

Read Chart and the registry aliases in registry.tsx, strict Chart props in packages/ui-catalog/index.ts, chart CSS in styles.css and all tests in chart-coordinates.spec.ts. Data rows for the numbered scene are Mon 8, Tue 13, Wed 10, Thu 18 and Fri 16. Existing coordinate tests intentionally pin 30…570 x and 30…210 y, extreme signed values, categorical spacing and original raw records. Use the shared Tabs implementation above.

### Implementation

1. Add optional xLabel, yLabel and yUnit to the existing strict Chart schema, using bounded nonempty strings up to 80 characters for labels and 32 for units. Existing specs without them remain valid. When building your chart-variants recording fixture, supply xLabel "Day" and yLabel "Reviews" on each of its three Chart nodes. Set the same labels in the browser acceptance fixture. For any other chart without labels capitalize the first character of its supplied xKey/yKey. Render yUnit only if supplied, in header parentheses and axis legend. Do not guess units from the title. Keep the BarChart registry alias behavior.

2. For y, accept finite numbers and nonblank numeric strings convertible to finite numbers. Treat null, undefined, booleans, objects, blank text, nonnumeric strings, NaN and infinities as missing. Preserve the entire raw record unchanged. Build displayed row records with original position, x label and exact y or null. Compute y domain using only finite y, including zero as in existing signed tests. Keep the overflow-safe fraction and the original numericX rule for scatter. Missing y retains its original x slot. Render no mark for missing y and break a line into separate contiguous polyline runs there. Display “Unavailable” in that table cell. All missing renders the compact status “No numeric values supplied.” with the table/raw data accessible. Empty array still renders the existing no-data state only.

3. Retain original geometry 600×250 for line/scatter and plot bounds. Add a separate, aligned HTML y-scale column to the left of SVG without changing tested SVG coordinates. Put tick labels in a grid tied to y=30/120/210 in the SVG's 250-unit viewBox. Use axis positions high, midpoint and low on nonflat domains. Compute midpoint as low/2 + high/2 to avoid overflow. For identical min/max render one numeric label at the actual mapped baseline (y=210). If the exact string for a tick is more than 8 characters use scientific notation with three significant digits. Keep the exact source values in the table and selected datum label. At the recorded desktop width use a flex row with a 64px label column and a drawing rectangle of aspect-ratio:600/250. Cap the rectangle at 576px wide and 240px high, shrink both together at constrained widths. Size the SVG to that exact rectangle with its default preserveAspectRatio. Give the adjacent scale column the rectangle's actual height and position its labels at 12%, 48%, 84% of that height, centered on each tick. Keep the plot aligned with the table. For bars retain original positive-domain geometry and value labels. For a signed bar series map 0 and every finite value into the 135…525px bar interval on the existing signed domain, draw from min(position(0),position(y)) with absolute endpoint difference, and draw a zero rule. Keep missing values as text without a zero-width factual bar.

4. Replace primary details/pre with a View chart data button, aria-expanded, aria-controls, and one MotionRegion for the contents. Pointer toggles use its existing geometry spring, keyboard/restore commit immediately. First-level content is a two-column semantic table with scope=col/row, accessible caption, supplied or derived headers, 32px header and 30px minimum body rows. For five short rows, total table height ≤210px. Wrap long source labels. Use a bounded table viewport max-height:320px with keyboard-accessible local scrolling only when content exceeds the bound. Follow with a separate collapsed native details/summary labeled “Raw data”, containing exact JSON.stringify(data,null,2), selectable pre and “Copy raw data” button. Attempt navigator.clipboard.writeText on explicit click. Successful copy says “Copied” and failure says “Select the raw data to copy.” Render both as a polite local status. Opening data retains trigger focus and scroll anchor. Direct readout and data access work with motion off.

5. Make displayed line/scatter points and bars reachable by keyboard as one roving inspect control per chart. Use the existing ShellSelect imported by registry.tsx, with options keyed by String(originalRowIndex) for valid y and labels combining exact x and y. Give its trigger accessible name “Inspect chart value” and keep it beside the table trigger. Selection change or pointer selection on a mark sets the same datum identity and exposes the exact value with supplied units in a compact readout. Use no tooltip-only dependency. Preserve raw ordering, legitimate zero, duplicate x, and signed values. A unique typed x value is the only local change-pulse key, paired with artifact/chart identity. Compare previous vs next nonmissing y by that key. Use 120ms outline/color only for an actually changed existing mark, zero movement. On ambiguous duplicate x use static data updates without pulse. Source reorder retains selected value when its typed x is unique. Clear selection on ambiguity or disappearance. First publication/restore/same snapshot or tab revisit never replays point or bar drawing. Reduced uses static highlight. Off is immediate.

### Browser acceptance

1. In chart-coordinates.spec.ts widen Row to `{x:string|number; y?:unknown}`. Preserve the chart helper’s first four parameters. Add a fifth parameter `labels:{xLabel?:string;yLabel?:string;yUnit?:string}={}` and spread labels after title in the test spec’s Chart props. Save the value returned by await serveTaskFixture as host and return host after verifying .chart is visible. Existing callers can keep ignoring it. Pass transported missing values as absent properties, null, blank strings, nonnumeric strings or string infinities. Native NaN and numeric infinity cannot survive the JSON transport and must never be asserted as raw records. Update rawRows to open View chart data, inspect semantic table rows before opening Raw data, then compare the original parsed array exactly. Set className="chart-x-label" on x-axis labels and use .chart-x-label in the geometry helper. Preserve all pre-existing finite coordinate and positive bar width assertions. For contiguous line runs, preserve the original single polyline. Replace the prior invalid/nonfinite-at-zero test with missing marks: for x=0,1,2,3 and y='not numeric','Infinity','-Infinity','5', show only the 5 at x=570,y=30, three unavailable cells, zero fabricated marks.

2. Add “chart source table has five compact rows and accessible scale and values”. Supply the five recorded rows and Day/Reviews labels. Assert first-level table height ≤210px, all five exact values visible, Raw data initially closed, x/y headers exact, and local trigger y stable within 1px before/after disclosure at 700px artifact width. Activate an option by keyboard and a mark by pointer. Assert matching visible readout. Run line and scatter with numeric y ticks including 0 and 18, and yUnit from a second fixture. Verify clipboard success with stubbed navigator.clipboard and rejection with manual selection fallback.

3. Add partial and all-missing fixtures. Verify line breaks across a middle null, no mark for blanks or null, preserved original x spacing, and exact raw input. All-null still exposes rows. Add -5/0/5 signed bars and confirm the first bar lies left of zero. A single finite zero stays at baseline. Keep the existing extreme finite case. Narrow 390px and zoom 200% keep the raw/table triggers and exact values reachable. Use the returned host to setInput("series", rows) and await host.publish() on a fixture with x A,B,C and y 2,4,6. Change B to 5 and count one highlight on B, none on A/C. Republish the same rows and assert no second highlight. Select B, reorder the rows to C,B,A, then duplicate B. Verify the readout first remains on B and then clears on ambiguity. Revisit Bar/Line/Scatter with the Tabs implementation above: no chart-wide fade or redraw on selection.

### Run

```bash
pnpm exec playwright test --config tests/e2e/chart-coordinates.playwright.config.ts
```

## 26. Delivery preferences

### Owned files

- `scripts/review-fixtures.ts`
- `apps/web/src/task-interface.tsx`
- `apps/web/src/task-interface.css`
- `tests/e2e/task-interface.spec.ts`

### Baseline and source

In `26-form-controls.mp4` at 3.3–6.3 s the left side contains the working form while the right side is mostly empty. At 11.9–12.4 s the right side reveals just one Continue review button.

Open catalogSpec in scripts/review-fixtures.ts, registry Layout/Form (read only), ChoiceList and Steps, and the form-controls scene in your recording instructions. The baseline projects catalogSpec's controls subtree. The original upper-level Grid pairs the whole Delivery panel with a mostly empty step panel. One remaining Grid must represent actual useful peers.

### Implementation

1. In catalogSpec change `controls` to `node('Stack',{gap:'sm'},['controlPanel','stepPanel'])`. Use `controlPanel: node('Panel',{},['choice','input','preferences','form'])`. Add `preferences: node('Grid',{columns:2,gap:'sm'},['select','toggle'])`. Keep the existing delivery legend and remove redundant panel heading. Retain `choice`, `input`, `select`, `toggle`, `form`, `stepPanel`, `stepOne` and `stepTwo` IDs, their existing state keys, labels, payload and action IDs. The outer stack spans its available width, including note and step navigation. The inner Grid has two actual fields and uses the existing narrow responsive grid behavior. Leave all other catalogSpec tabs alone.

2. Keep `Save choice` as a secondary form action and `Continue review` as the primary command when its step is visible. Avoid adding a catalog property: target the .surface-section containing the direct task-choices and later direct standalone .surface-form, then style only that form's direct submit with the existing secondary surface/border/text token values. Use the existing button class styles as the source of those tokens. Scope its width to max-content, minimum target 32 px desktop/44 px coarse touch. Keep the native form submit and command validation.

3. For the delivery panel’s direct ChoiceList, flow radio options across a wrapping row with 8 px gaps. Keep the legend and accessible native inputs. Use 120 ms border/color feedback only for a different pointer-selected choice. Keyboard/restore use final state. Restrict the two-peer Grid to one column in this composed panel when its own content container is below 440 px wide, via a container query on this panel and a direct-child .surface-layout with explicit columns. This covers narrow desktop panes in addition to existing viewport media rules. No changes to the global Grid renderer.

4. In Steps, attach input cause to actual Back/Next/step-marker activation and consume it in the existing effect. For full-motion pointer navigation run 180 ms incoming X from ±4 px to 0 and 100 ms outgoing X from 0 to ∓2 px with direction based on indices, overlapping. Keep the one existing measured height spring and current opacity on reversal. Capture current transform matrix X and opacity before canceling. Retarget from actual visual offsets for interrupted panels. Keep noncurrent controls inert/aria-hidden immediately. Use instant focus and final height for keyboard/restore/reduced/off, including a policy change mid-flight.

5. Keep all fields and step panels keyed to existing identity. Do not clear notes, toggle values or density on navigation. Put focus on the active step marker after navigation only when the previously focused navigation control has been removed or disabled. Otherwise retain its current focus. Preserve IME suppression, one action per deliberate submit and current local draft semantics.

### Browser acceptance

1. Add a named case `delivery preferences fill the task width and retain field identity` to the existing task-interface spec. Render the actual controls subtree from catalogSpec('agreement','before-image') through taskFixture/serveTaskFixture, root='controls'. Include only elements reachable from that root by following children, preserving IDs. Before serving, set snapshot.artifacts[0].actions.inspect={kind:'agent'}. Start with delivery='download',density='comfortable',enabled=false,catalogStep='one'. Record the Review note handle, choose Review, type `Keep source`, choose Compact and toggle Keep selection on reload. At desktop compare note and step-nav widths with outer stack content, tolerance 1 px allowing its measured internal panel padding. Ensure settings have two nonempty peers. At a 390 px viewport and 430 px panel, both grid children occupy successive rows.

2. Use Save choice and assert the existing payload contains the current delivery and note once. Advance with pointer and reverse rapidly. Only current step descendants are tabbable. Advance again with keyboard, activate Continue review and verify one additional command, no step translation, same note handle/draft. Re-publish an unrelated input while the note is focused. Retain caret and value. Keep existing collector-visible Grid, Panel, Steps, Form, Input, Select, Toggle, Button, ChoiceList, Text.

### Run

```bash
pnpm exec playwright test --config tests/e2e/task-interface.playwright.config.ts tests/e2e/task-interface.spec.ts --grep 'delivery preferences fill the task width|progressive|pending question'
```

## 29. Context inspector

### Owned files

- `apps/web/src/ContextInspector.tsx`
- `apps/web/src/ContextMeter.tsx`
- `apps/web/src/context-inspector.css`
- `tests/e2e/usage-context.spec.ts`
- `tests/e2e/operational-motion.spec.ts`

### Baseline and source

In `29-context-inspector.mp4` at 1.8–2.3 s six categories sit above an unused band. At 8.9–9.4 s compaction becomes busy. The new counts arrive at 11.6–12.1 s.

Open `ContextSession`, `ownedCompaction`, `acceptedCompaction`, `contextSegments`, `Category` and shared `Popover`. ContextSession currently composes a numeric height from 282/200 px plus flag increments. The shared placement engine already clamps numeric bounds to the visual viewport and deals with portal zoom. Keep that contract and its overlay/focus behavior.

### Implementation

1. Keep the dialog width 328 px, padding 12 px, section gap 12 px, direct header/body/footer DOM order and two-column category grid. Give the body one natural-flow inner div around all its content. Register that div with a callback ref so measurement begins after the Popover portal actually mounts. Maintain local numeric requested height with 200 px initial estimate. Once mounted use layout-time measurement of intrinsic body content plus real top/bottom padding, border, visible header/nav/footer and flex gaps. Use CSS pixel block sizes (offsetHeight/client CSS values or untransformed ResizeObserver border-box size). Exclude portal transform/zoom from the sum. Round up the total once and update state only when it changes. Use the inner body’s intrinsic height even when the outer scroll body is clamped.

2. Observe the inner content and each current fixed band using ResizeObserver. Reattach on optional nav/band changes. Content wrapping, font load and evidence expansion must trigger a new measure. Disconnect observers on close/identity change. The body remains flex:1,min-height:0,overflow:auto. Header/footer remain nonshrinking. Use a single visible content tree with immediate size updates. Feed the requested size to the existing Popover, which owns available-space clamping/repositioning. At normal desktop size the six-category baseline is approximately 210–225 px. Authoritative acceptance is measured natural content with ≤2 CSS px unused body space when unconstrained.

3. Replace per-Category 120 ms hover/focus timers with one group-owned active-category state and one cancellable dwell timer in ContextMeter. Start first pointer hover after 200 ms. While one category is open, pointer transfer directly to another category inside the same grid switches immediately. Moving through grid whitespace retains this warm state until the pointer leaves the grid. Pointer entry animation is opacity .85 to 1 over 125 ms. Keyboard focus opens immediately with no entrance; Escape closes the nearest shown tooltip and keeps focus on its button. Suppress reopen until next focus or a fresh pointer entry after that Escape. Keep PageUp/PageDown scrolling and tooltip descriptions. Track focused ID and hovered ID separately. Give keyboard focus priority until keyboard blur. On grid pointer leave discard hover ID and its timer. Retain the focused tooltip only if a keyboard-focused ID remains. On focus leaving the group clear the focused ID. If the pointer remains inside, continue its existing hover state and timer. Clear both on owner change/unmount.

4. Remove the .context-measurement-accepted .context-segment width transition. Every source update shows exact validated absolute values, proportions, unknown fields and partial-breakdown copy together. During compaction hold the last valid reported counts already displayed until fresh valid source data arrives. Restore unknown state on thread/session ownership change, revoked evidence or an explicit invalid source report. No predicted freed count. Respect existing pending/failed/cancelled copy and current command gates.

5. Only a new matching accepted receipt from acceptedCompaction can trigger one local 160 ms footer opacity/color acknowledgment. Use receipt ID per owned run/session and establish the initial ID as baseline so reopening never replays it. Keep all ID/run/session/epoch checks and numeric receipt reconciliation for Freed N. Shorten the existing 600 ms local receipt flag timer to 160 ms. No minimum busy dwell. Reduced/off ends existing motion and suppresses shimmer, entrance and receipt travel. Avoid modifying shared Popover.

### Browser acceptance

1. In `usage-context.spec.ts` add `six reported categories fit intrinsically and long evidence stays within the viewport`. Reuse the existing `/usage-context` fixture. Call `update(page,'categories')` (6000/10000, six categories), then click `Inspect context`. At 1440×1000 and 390×844 compare .context-inspector-body.clientHeight with the inner natural height. The difference is at most 2 CSS px with no vertical clipping. At 390×300 call the existing fixture action `request-compaction-many` and select the Compaction tab, open Retained constraint references and activate Show 2 more references to make content taller than the viewport. Assert body.scrollHeight > body.clientHeight, shell fits the viewport margin, and the footer is fully visible while its body scrollTop changes.

2. Extend the existing test `reported categories reveal token/share/subitems on focus after dwell; IME and nested Escape work`. Rename it `reported categories open immediately on focus and after dwell on first pointer hover`. Install the Playwright clock before navigation. Freeze after fixture readiness. Hover Tools & MCP and advance to 199 ms: tooltip absent. Advance 1 ms: 500 tokens and Reported tool instructions appear. Hover the adjacent Skills button without leaving the grid: the new tooltip is visible immediately. Move outside, focus Tools & MCP by keyboard, press composing Escape then plain Escape, then Escape again. Preserve the existing nested Escape and restored focus assertions.

3. In the existing accepted-receipt test use the fixture actions `foreign`, `unmeasured`, `accepted` and `restart` for authority coverage. For the pulse count start a separate fresh fixture with `categories` and use `accepted` directly twice. Both accepted snapshots carry the same ID `receipt-one`. Before=8000, after=4000 and window=10000. Verify exactly one local footer acknowledgment, never a width transition, and `Freed 4K tokens` matches real receipt data. Retain existing tests for a decrease with no receipt, invalid category measurements, focus and Escape. Update the existing test titled “accepted transition uses reference timing. Reduced motion suppresses travel and sweep”. Replace the asserted 600 ms segment animation, 0.6 s transition and 0.24 s footer duration with zero animated factual widths, exact first-frame proportions and 0.16 s footer acknowledgment. Keep its reduced-policy checks. Retain the temporary .context-measurement-accepted marker for the 160 ms acknowledgment window, without a width transition, so the existing invalidating-a-receipt test still verifies immediate cancellation. Run the context-compact smoke suite unchanged.

### Run

```bash
pnpm exec playwright test --config tests/e2e/usage-context.playwright.config.ts tests/e2e/usage-context.spec.ts --grep 'categories|segments|receipt|accepted transition|pending sweep|category|six reported'
pnpm exec playwright test --config tests/e2e/frontend-refinement.playwright.config.ts tests/e2e/context-compact.spec.ts
pnpm exec playwright test --config playwright.config.ts tests/e2e/operational-motion.spec.ts --grep 'context|token decrease'
```

## Record the review videos

Produce eight continuous dark-theme MP4s. After the scoped tests pass, commit your tracked changes on the working branch. Create the capture checkout with the following commands. When repeating a take, use a fresh capture output directory.

```bash
RESULT_SHA=$(git rev-parse HEAD)
git worktree add --detach "$WORK_RUN/capture-src" "$RESULT_SHA"
cd "$WORK_RUN/capture-src"
test "$(git rev-parse HEAD)" = "$RESULT_SHA"
test -z "$(git status --porcelain)"
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
ffmpeg -version
ffprobe -version
```

Record that SHA. Place all temporary recorder sources under its `scripts/` using the prefix `local-w3-`. Return the private recorder copies with the evidence in this project. Keep them untracked.

| Film | Recorder scene ID | Checked-in scene / subtree |
| --- | --- | --- |
| UI-13 | review-queue | review-patch/root |
| UI-14 | editable-table | records/root |
| UI-15 | parameter-controls | image-work/adjust |
| UI-22 | faq-disclosure | questions/root |
| UI-23 | source-tables | migration/root |
| UI-24 | chart-variants | migration/root |
| UI-26 | form-controls | catalogSpec/controls |
| UI-29 | context-inspector | host |

When the original archive is available, use the three TypeScript sources in `Gen-V1-UI-review/recording-scripts/` from the review ZIP. Map generative-review-scenes.ts, record-generative-review.ts and record-generative-adjacent.ts to `local-w3-scenes.ts`, `local-w3-catalog.ts` and `local-w3-host.ts`; fix the relative scenes import. The catalog’s archived recording begins after generation. In its private copy preserve `const initialArtifact=snapshot.artifacts[0]`, set `if (!stills) snapshot.artifacts=[]` before returning the fixture host and keep its existing `publishInitial` helper, wait for the composer textbox named `Message` and assert the page has zero `.artifact` elements, start `recordWindow`, wait 500 ms, then call `host.publishInitial()`. Move artifact, PDF, image, signature and scroll readiness checks after that call. Replace the archived run.compact mock and 34k assertion with the current owner-bound compaction request, receipt and verified totals in the Context inspector assignment. For the host copy read OUTPUT from process.env.CAPTURE_OUT and set PORT to 6283; remove the legacy machine path, and stamp the measured git SHA in both manifests. [Original review ZIP](https://chatgpt.com/library?file_id=libfile_e853efaba1cc819188bc47299ccb1228&account_id=personal)

For a source-only session, copy the tracked `scripts/record-task-design.ts` to `scripts/local-w3-catalog.ts`. It already implements publication after capture starts, source-backed controls, PDF/PNG grants, fixture HTTP/SSE and a real Vite App. Replace fixed port 5465 throughout this private copy with 6213. Keep its browser setup, `installFixture`, resource routes and video stop/cleanup. In its scene list clone each mapped entry from `taskDesignScenes()`, set its ID to the recorder scene ID above, and copy only elements reachable recursively through each element’s children from its assigned root (root means scene.spec.root). Replace the full-catalog assertions with per-film checks for the assigned subject. Implement the ordered interactions from this prompt. Preserve fixture action handlers by testing the original source scene ID after the display ID changes. For source-tables remove schema from root and chart from summary. Use Tabs with Bar, Line and Scatter reading chartRows = Mon/8, Tue/13, Wed/10, Thu/18, Fri/16. Form starts at controls in scripts/review-fixtures.ts catalogSpec("agreement","before-image"). For context use the App’s context indicator and EMPTY_USAGE with a task-thread owner, reported categories and a fixture-owned session. Take the accepted payload from `tests/e2e/usage-context-fixture.tsx` and its assertions from `tests/e2e/usage-context.spec.ts`. In the full app open the actual `Inspect context usage` button. Use the valid owner, session and receipt for this fixture. Capture starts with the inspector closed. For the positive 160 ms receipt test override the suite’s reduced-motion default with `page.emulateMedia({ reducedMotion: "no-preference" })` before navigation. Run reduced/off cases separately. In the source-only route copy the Vite/browser setup and capture loop into `scripts/local-w3-host.ts`, read `CAPTURE_OUT`, and serve the selected host scene at port 6283.

Before starting the video, put the insertion point in the visible conversation area. Observe the first nonempty published frame with an IntersectionObserver or a sampled DOMRect. Require it to intersect the viewport when its entrance begins. An offscreen entrance followed by an automatic scroll fails the opening. Scroll only for later chapters where the task requires it.

From the root of the disposable capture worktree, initialize a fresh capture directory after creating your private recorder files.

```bash
export CAPTURE_OUT
CAPTURE_OUT=$(mktemp -d "$EVIDENCE/capture.XXXXXX")
```

For both paths, record exactly 500 ms of the ready host before the first fixture publication (or before opening the context inspector). In the source-only path, change the tracked seed’s initial 900 ms hold in its private copy to 500 ms. For the host-scene command, read the output directory from `CAPTURE_OUT`. Use per-scene assertions and guard only optional data. An absent required control, empty clip or missing chapter must cause a failing exit. Discard the old minimum total-length padding in the archive and use the 900 ms hold after the actual final result. For a rapid reversal, use raw Playwright input as soon as the first effect is running, ahead of any reading dwell or chapter screenshot. Do not change product timing to make the recording easier.

Run these commands from that worktree. The archived catalog recorder accepts `--port`. In the source-only catalog recorder, replace the fixed server port and origin as directed above before launching.

```bash
pnpm exec tsx scripts/local-w3-catalog.ts --theme dark --port 6213 --scenes review-queue,editable-table,parameter-controls,faq-disclosure,source-tables,chart-variants,form-controls --output "$CAPTURE_OUT/catalog"
pnpm exec tsx scripts/local-w3-host.ts --scene context-inspector
```

For either recorder path, update the action sequence to include every implementation section’s film steps. Keep the 1920×1080, 30 fps, real-time compositor recording running through every required action and interruption. Log elapsed event times, wait for observable results, then hold the final stable state for 900 ms. Keep action timing independent of screenshot delays. Package the numbered names below after both the scene assertions and stream validation pass. Save any diagnostic takes separately. Log codec, size, duration, fps, SHA-256 and action timestamps. Decode each complete file with `ffmpeg -v error -i "$film" -f null -`. Inspect opening, changing and settled frames; reject empty or pre-settled openings, element clipping, wrong subject, or a missing action.

### Exact chapters and filenames

| Deliverable | Required action order after the opening |
| --- | --- |
| `13-review-queue.mp4` | Navigate forward/back while retaining a per-item comment, enter a decision, submit review, capture acknowledged result. |
| `14-editable-table.mp4` | Change Quantity and Priority, reset one, submit the other, retain original versus proposed values through acknowledgment. |
| `15-parameter-controls.mp4` | Edit Width, verify image retains its intrinsic rect, add/reset proposal, then immediately edit again. Keep focus in the expected input. |
| `22-faq-disclosure.mp4` | Open retry question, publish answer plus follow-up, open nested answer, toggle it rapidly, leave earlier branch visible. |
| `23-source-tables.mp4` | Visit each original table, publish actual changes, revisit an old tab, open migration evidence and SQL. Show exact before/after and avoid repeated cell pulse. |
| `24-chart-variants.mp4` | Open compact table and secondary raw data, change Bar to Line to Scatter and back. Publish a missing observation, verify accessible exact data and scales. |
| `26-form-controls.mp4` | Choose delivery, type note, set density and retain-selection, submit preference. Move Next then Back, verify same state. Exercise Continue review in its actual step. |
| `29-context-inspector.mp4` | Begin with the inspector closed. Open usage, hover category A then adjacent B, keyboard-focus a detail and compact. Publish a fixture-shaped accepted receipt and changed measurement. Reopen. In a separate test, update only the count and verify no acknowledgment accent. |

For film 24 use Mon–Fri and 8, 13, 10, 18, 16 with xLabel `Day` and yLabel `Reviews`. Leave yUnit absent for a count. Use the modeled successful receipt and a separate count-only update from section 29. Identify both as simulated host data.

### Produce the final numbered files

The recorder may emit an unnumbered filename or one ending in `-recording.mp4`. Run this from the verified capture worktree on a successful attempt. It reads each recorder's actual output manifest, copies only the 8 assigned files into a new directory for this attempt, decodes them and writes their metadata. Use that directory for the per-file links.

```bash
python3 - "$CAPTURE_OUT" <<'PYFILMS'
import hashlib, json, shutil, subprocess, sys
from fractions import Fraction
from pathlib import Path

root = Path(sys.argv[1]).resolve()
filenames = {
    "review-queue": "13-review-queue.mp4",
    "editable-table": "14-editable-table.mp4",
    "parameter-controls": "15-parameter-controls.mp4",
    "faq-disclosure": "22-faq-disclosure.mp4",
    "source-tables": "23-source-tables.mp4",
    "chart-variants": "24-chart-variants.mp4",
    "form-controls": "26-form-controls.mp4",
    "context-inspector": "29-context-inspector.mp4"
}
rows = {}
for manifest in sorted(root.rglob("manifest*.json")):
    for item in json.loads(manifest.read_text(encoding="utf-8")).get("captures", []):
        scene = item.get("scene")
        if scene not in filenames:
            continue
        if scene in rows or item.get("failed") or item.get("browserErrors"):
            raise SystemExit(f"Duplicate or failed capture for {scene} in {manifest}")
        rows[scene] = (manifest.parent / item["video"], item)
if rows.keys() != filenames.keys():
    raise SystemExit(f"Missing captures: {sorted(filenames.keys() - rows.keys())}")

output = root / "videos"
output.mkdir(exist_ok=False)
sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
records = []
for scene, name in filenames.items():
    source, item = rows[scene]
    if not item.get("chapters"):
        raise SystemExit(f"Missing chapters for {scene}")
    dest = output / name
    shutil.copyfile(source, dest)
    info = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(dest)
    ]))
    video = next(stream for stream in info["streams"] if stream["codec_type"] == "video")
    if (video["codec_name"], video["width"], video["height"], Fraction(video["avg_frame_rate"])) != ("h264", 1920, 1080, 30):
        raise SystemExit(f"Unexpected stream in {name}")
    subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(dest), "-f", "null", "-"], check=True)
    with dest.open("rb") as file:
        digest = hashlib.file_digest(file, "sha256").hexdigest()
    records.append(dict(filename=name, scene=scene, source_sha=sha, sha256=digest,
                        bytes=dest.stat().st_size, codec=video["codec_name"], width=video["width"],
                        height=video["height"], fps=30, duration_s=float(info["format"]["duration"]),
                        chapters=item["chapters"], observations=item.get("observations", []),
                        fixture="Real renderer with authored input and simulated host updates"))
(output / "manifest.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
print(output)
PYFILMS
```

Use Python 3.11 or later for this snippet. Return links to the final numbered files. Keep the raw manifests and chapter images alongside the video directory so relative evidence references can be resolved.

## Deliver your branch and 8 videos

Run `pnpm typecheck`, `pnpm lint` and `git diff --check`. Compare changed and untracked product paths against the file lists above. Stage explicit source/test paths and commit the verified changes before capturing. On the final branch commit also run `git diff --check "$BASE_SHA" HEAD` and record the full result of `git rev-parse HEAD`. If all required behavior was present at baseline, use the verified existing SHA. Record videos from that exact commit in the separate capture worktree. Preserve every diagnostic retry in a separate evidence directory.

Return the 8 numbered MP4s listed at the top as individual attachments or direct per-file links. In the evidence directory write `review.md` with one row per clip containing its filename, UI, tested SHA, fixture provenance, chapter timestamps, exact verified outcome and any remaining failure. Include `manifest.json` with filename, SHA-256, byte length, codec, resolution, frame rate, duration and visible component names per file. Include the private recorder sources there for reproduction. Use `ffprobe -v error -show_streams -show_format -of json` on every film, verify H.264, 1920 × 1080 and 30 fps, decode each to EOF, then watch each once at normal speed. Reject footage whose new object is already settled on its first visible frame unless its specified behavior is immediate. Fix a missed interaction or unreadable capture and re-record only the affected film.

In your final response give the branch name, base and result SHAs, changed tracked paths, exact executed checks with pass counts, and links to the videos and review. Identify any inaccessible runtime, skipped gate or unmeasured property explicitly. Fixture recordings demonstrate renderer behavior under the stated source inputs. Report live-model outcomes only when exercised on the real host. Link a local patch when the owner cannot access the branch. Your assignment is complete independently. If a combined commit has already landed through the normal repository workflow, you may rerun your own checks and clips there and label them with that new exact SHA. Branch captures always carry their actual branch SHA.
