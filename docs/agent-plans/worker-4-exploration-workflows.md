# Worker 4. Image annotation, schedules, logs and workflows

Implement the following changes in `skytuhua-org/Gen-V1`. Refine how a user places a pin, proposes a meeting, reads a log, moves a card, explores an architecture diagram, inspects a trace and follows a running plan. Make the selected object easy to follow without losing its position, source or draft.

You own seven interfaces. Return one working branch, one individually playable MP4 for each interface and the verification results. This entire Markdown file is your instruction. Execute it in one worker session from the pinned base.

| UI | Assignment | Review video to return |
| --- | --- | --- |
| 16 | Image annotations | `16-image-annotator.mp4` |
| 17 | Schedule picker | `17-schedule-picker.mp4` |
| 18 | Log explorer | `18-log-explorer.mp4` |
| 19 | Workflow board | `19-workflow-board.mp4` |
| 20 | Architecture canvas | `20-architecture-canvas.mp4` |
| 21 | Trace waterfall | `21-trace-waterfall.mp4` |
| 28 | Task plan and progress | `28-task-plan.mp4` |

## Start from the inspected source

Use the existing authorized checkout of [skytuhua-org/Gen-V1](https://github.com/skytuhua-org/Gen-V1). The common starting commit is `26ddf4d16c2fc1196b520d8a46c5441d64d01463`. Every section below can be implemented against that commit in this branch. Use a full checkout with its workspace packages, fixtures and lockfile. From the repository root, in Bash:

```bash
set -euo pipefail
BASE_SHA=26ddf4d16c2fc1196b520d8a46c5441d64d01463
BRANCH=refine/exploration-workflows
if ! git cat-file -e "$BASE_SHA^{commit}" 2>/dev/null; then git fetch origin "$BASE_SHA"; fi
WORK_RUN=$(mktemp -d "${TMPDIR:-/tmp}/gen-v1-worker-4.XXXXXX")
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

At default speed use the repository enter curve `cubic-bezier(.16,1,.3,1)` and move curve `cubic-bezier(.4,0,.2,1)`. The per-interface instructions specify durations, distances, grouping and exceptions. Follow the existing motion-speed token. Use the live effective app and OS policy. Off is immediate. Under reduced motion remove travel and stagger. Where a section explicitly permits opacity feedback, cap it at 80 ms. If full motion is disabled mid-flight, settle to the latest state immediately. Use the existing `animateTask`, `readMotionPolicy` and `observeMotionPolicy` contracts, and a local cancellation subscription where necessary. Use only the helpers already present at the pinned commit. Keep any additional event marker inside the files you own. Keep one geometry owner. Preserve the existing interruptible spring on measured regions that use it. Reserve a final layout slot before animating its contents.

The supplied 30 fps reference shows the source of the design decisions. During frames 522–555 a slot opens for one resolution commit while earlier rows remain recognizable. During frames 593–632 the test count grows on that same row. During frames 657–678 the Merge control is available as the four validation checks finish appearing. During frames 891–917 the completion accent travels along the affected branch. Apply those relationships to the concrete objects below. Keep the camera fixed. The per-interface milliseconds are implementation targets, with no claim that the recording exposes its CSS curves.

Measure compactness inside the artifact. Keep real PDF margins, image aspect ratios, chart domains, focus rings and source gaps. Remove the specific redundant row, unused track or inherited minimum identified in the interface instructions. Keep touch targets at least 44 CSS px where the component presents coarse-pointer controls. Use the current visual language and existing tokens. Add no decorative headings, filler copy, synthetic metrics or simulated production outcomes.

## First visible generation

The original films started after the UI had settled. Implement the following first-publication details in the owned component and verify them in the new opening sequence. The host’s existing `useArtifactEntrance` marks a genuinely new artifact with `[data-entry-phase="entering"]`. In the catalog, gate the one local effect below on that marker and full effective motion. Use the existing enter curve, zero delay and an absolutely positioned, `aria-hidden`, non-interactive ornament for a new rule or tick. Where an existing mark is named, layer the effect on its artwork. Keep controls, factual content and layout immediately available. At most one treatment per numbered interface may run on first publication. Ordinary additions inside an already present artifact use the change rules in their own section.
For the host surface without an artifact ancestor, use its own event. Baseline the first loaded snapshot, then distinguish a newly published request/plan by its thread and ID, or an explicit inspector-open action. Skip the decoration when restoring the same object.

| UI | Exact first-publication treatment |
| --- | --- |
| 16 | Trace one 8 × 8 px top-left corner of the image frame over 140 ms. Use a decorative 1 px line layered on the existing edge. Place no illustrative pin on the image. A late-loading or revoked image stays on its ordinary immediate path. |
| 17 | Emphasize the first available slot’s existing time-axis mark from opacity .55 to 1 over 120 ms. Slot endpoints and durations are exact on first paint. With no available slot, leave the supplied availability message steady. |
| 18 | Reveal a 12 px segment of the first visible event’s severity rail from top to bottom over 100 ms. Keep timestamp and message anchored. Do not change the selected event or scroll position. |
| 19 | Reveal a 16 px underline beneath the first nonempty lane’s real count over 120 ms. Cards mount at their final positions. Keep card transfer motion for explicit moves. |
| 20 | Emphasize the static first in-source-order edge’s destination arrowhead from .55 to 1 opacity over 140 ms. Keep nodes and connection endpoints fixed. If no directed edge is supplied, omit the treatment. |
| 21 | Reveal the first measured span’s start tick on the time axis over 120 ms. Its bar has the true width from the first frame. Spans with unknown timing receive no invented tick. |
| 28 | On the first published plan for this thread/run, fade just the narrow joining line below the parallel branches from .55 to 1 over 140 ms if that line exists. Existing or restored plans paint directly. A check on a step remains tied to an actual change in accepted status. |

Exercise each positive opening with the delayed fixture publication in its assigned browser spec. Test the same record when already present at bootstrap, an identical republish, and app reduced/off. Count one eligible local start for the positive case and zero on the others. For an absent target, assert zero and verify the usable fallback. Cancel on first input, policy downgrade, source replacement or unmount. Clip only the decorative mark. The existing outer artifact entrance keeps its own transform.

## What the original recordings showed

Use these observations to reproduce each issue. The clips used an authored fixture on commit `4bcdc82a73a28d27d6ebe413a527389119f35292`. Each timestamp is relative to its own MP4. Recheck the behavior on the assigned source commit before editing.

| UI | Original video time | What is visible |
| --- | --- | --- |
| 16 | 00:03.3–00:03.9 | Adding a pin places a numbered marker at the image center and reveals the note editor in the adjacent rail. |
| 17 | 00:03.3–00:03.7 | The 90-minute working session is selected; selection and footer summary update in place. |
| 18 | 00:07.3–00:07.7 | Filtering for checkout-17 reduces the list while the selected error/detail remains visible. |
| 19 | 00:06.2–00:06.7 | The card moves continuously from Ready to In review and neighboring cards make room. A local-move marker and count appear. |
| 20 | 00:06.4–00:06.8 | Focus neighbors dims unrelated content while all node coordinates remain fixed. |
| 21 | 00:13.8–00:15.1 | The legacy adapter selection explicitly says timing is unavailable rather than fabricating a duration bar. |
| 28 | 00:09.4–00:10.0 | A source update changes agent/check progress while the expanded accepted step and reading position remain stable. |

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

## 16. Image annotation

### Files and existing behavior

- `apps/web/src/ExplorationTools.tsx`
- `apps/web/src/exploration-tools.css`
- `tests/e2e/exploration-ui.spec.ts`

Open `ImageAnnotator`, `AnnotationCanvas`, the `.annotation-*` rules and the existing `image pointer coordinates describe the rendered image` test. The source identity already combines grant, thread and resource ownership. The existing rail rises on selection and the empty rail includes a decorative pin icon.

### Implement

1. Keep both existing grid tracks above the existing 650 px container breakpoint. Set the gap to 12 px. Below that breakpoint put the note immediately below the image. Keep the same image wrapper, coordinate reference, intrinsic image sizing and `data-ready` gate. Replace the empty icon block with the single existing sentence `Click the image or add a pin.` in the rail, padding 4 px 0. Keep the rail present in both empty and selected states.

2. Keep the marker hit box at least 32×32 CSS px on pointer and 44×44 on coarse pointer while its visual face stays 26×26. Set the Feedback textarea to three rows, 72 px minimum height, vertical resize and full available width. Align the existing `Pin N` heading and delete button on one row. Grow the textarea from its actual content using `field-sizing:content` where supported and the three intrinsic rows as fallback. Pin creation must leave the measured image rectangle within 1 CSS px of its pre-click rectangle at a fixed viewport.

3. Carry the exact generated pin ID and input cause through the existing local `add` handler. Blank-image click uses the existing normalized, clamped coordinates. Add pin uses the existing center coordinates. Record a one-shot pointer claim before writing the store. On the first render containing that ID, animate only the new marker artwork from scale .92 to 1 for 160 ms, center origin. Remove the present `.annotation-pin[aria-pressed=true]` scale(1.14) transform. Keep the positioned button's `translate(-50%,-50%)` fixed and render its numbered face on a separate inner span. No effect for hydration, keyboard Add pin, reselection, or restored IDs. Consume and clear the claim once.

4. Replace this component’s `useSelectionMotion(value.selectedId)` call. Pointer selection changes `aria-pressed`, title and note immediately. Use 120 ms color on the selected pin and 120 ms opacity .85 to 1 on note content, leaving the textarea mounted across note typing. Retain one textarea and its selection range through unrelated renders. Keep Arrow increments .01 and Shift+Arrow increments .05. Neither causes travel or replay.

5. Delete immediately using a fresh `read()`. Focus the first remaining pin in source order, otherwise Add pin, with `preventScroll:true` after commit. Keep the limit of 32, blank-note validation, 800-character note limit, bounded payload and grant-revocation behavior. Cancel local decoration on deletion, source identity change, unmount or policy change. Reduced/off creation and selection settle immediately.

### Verify

- [ ] Extend the existing image-coordinate test. Capture image and stage DOMRects, click at 25% width and 75% height, type `Move caption`, press Shift+Right on the selected pin and compare stored ≈.30/.75 within pointer rounding. Assert width/height and page scroll stay within 1 CSS px. Verify `Pin feedback` keeps the same DOM identity/caret through an unrelated host publish.

- [ ] Create a second pin, delete it and then delete the survivor. Assert focus returns first to Pin 1 and then Add pin. Reload before removal in a separate fixture and assert restored pins have no running scale animation. Retain the existing revoke/renew/cross-thread cases. At 390×844 assert the note is below the image and neither clips.

```bash
pnpm exec playwright test --config tests/e2e/clarity-schedule-logs.playwright.config.ts tests/e2e/exploration-ui.spec.ts --grep 'image|Image|pin|Pin'
```


## 17. Schedule picker

### Files and existing behavior

- `apps/web/src/ExplorationTools.tsx`
- `apps/web/src/exploration-tools.css`
- `tests/e2e/exploration-ui.spec.ts`

Open `SchedulePicker`, `scheduleLayout`, `slotTime`, `slotDuration` and the existing exact-window/reload and unavailable-slot tests. The interval band currently applies a geometry transition. The row is a native button with option semantics and roving keyboard focus.

### Implement

1. Keep day grouping from the supplied timezone and sort order. Set `.schedule-day` top spacing to 16 px except first (0). Set option padding to 8 px and internal gap to 6 px. Keep title and availability on the first line, and time range plus duration on one flex row with wrap. The `.schedule-interval-ruler` is 24 px tall. Set the absolute band top to 2 px, height 20 px. Use 44 px minimum button height on coarse pointers. Keep the existing narrow single-column fallback.

2. Use the same exact start/end/span computation for labels, inclusive group ruler and band. Set percentage left and width from supplied timestamps in the same render. Remove CSS left/width/min-width decoration that can overstate short intervals. Use no positional animation on initial load, source change, filter or selection. Keep pointer hit area on the option, independent of bar width.

3. Pass explicit cause through `choose`. For a pointer activation on a different available ID, set selection and visible date first. Run a 120 ms border/background response on that option and 100 ms opacity reveal on its single heading check. Keep any selected band glyph static. A keyboard-activated click (detail zero), navigation key, restore or identical re-selection renders final state immediately. Leave unavailable options disabled.

4. Preserve latest-store validation in `submit`. If the selected ID disappears, keep the existing `The selected window is no longer supplied. Choose another.` notice. If it becomes unavailable, keep the distinct unavailable notice, disable proposal in that commit and do not pick a replacement automatically. Keep exact UTC offsets, timezone and user-chosen ID in the existing proposal. Cancel transient effects on retraction, unmount, reduced/off or theme change.

### Verify

- [ ] Extend the existing Design review fixture. Choose the option, reload, submit and assert exactly the existing four-field {slotId,start,end,timeZone} payload. Publish a change to both endpoints and read rendered bar and ruler on the next committed frame. Width and left must equal timestamp-derived ratios within 1 CSS px, with no geometry animations.

- [ ] Exercise Home, End and arrows across the disabled Already occupied option. Assert one focused selectable option, immediate final check and no pointer accent. Make the selected slot unavailable, then remove it. Confirm proposal is disabled and no new action was sent. Use 390×844 for wrapped subject and duration. The option hit height must remain at least 44 CSS px with touch emulation.

```bash
pnpm exec playwright test --config tests/e2e/clarity-schedule-logs.playwright.config.ts tests/e2e/exploration-ui.spec.ts --grep 'schedule|slot|window|narrow reduced'
```


## 18. Log explorer

### Files and existing behavior

- `apps/web/src/ExplorationTools.tsx`
- `apps/web/src/exploration-tools.css`
- `tests/e2e/exploration-ui.spec.ts`

Open `LogExplorer` and its call to `useSelectionMotion(selected?.id)`. The selected payload is mounted conditionally in its keyed event row. `scroll` owns the local event list and Follow is available only in an expanded artifact. Read the existing suppliedLogs fixture and log filter/append tests.

### Implement

1. Keep one toolbar grouping search, level filters and expanded-mode Follow control. Use flex-wrap with an 8 px gap on narrow containers. Keep a single listbox. Set `.log-event` min-height 36 px, 44 px for coarse pointers, with height auto for multiline messages. Respect the existing narrow severity/message column gap. Use existing count heading. Retain readable second-line stream and correlation metadata inside the selected event.

2. Replace the application of `useSelectionMotion` in LogExplorer with immediate conditional detail rendering. Remove the 190 ms rising effect from the payload. For a pointer change to a different valid event only, apply 120 ms selected-row border/background emphasis. Keyboard selection, filter changes, append, restore and repeated selection produce no decoration. Keep event elements keyed by supplied ID.

3. Make the existing correlation value in the selected detail a button when a correlationId exists. Its accessible name is `Filter by correlation <id>` where `<id>` is the supplied correlation ID. Activation sets the existing query field to that exact ID using `save` and immediately recomputes the existing search predicate. Keep the entire raw payload behind the native Event details disclosure. Do not fetch related events.

4. If saved.selectedId exists and is absent from the accepted filtered set, render one local role=status message. Use `Selected event is hidden by the current filters.` if the source still contains it, otherwise `This event is no longer supplied. Select another event.` Keep the action disabled. In submit, re-read source, query, levels and selected ID from the store and reapply the same filtering predicate to that latest event. Dispatch only if it is still visible and belongs to that source. Preserve automatic first selection only when no explicit ID was saved.

5. Retain Follow scroll-to-bottom only when explicitly enabled in expanded mode. Preserve manual cancellation on wheel, touch, scrolling away or keyboard navigation. Appending new events with Follow inactive preserves the reader’s current visible row and offset. Mark cause only on event selection. Unmount, source removal or effective motion-policy change cancels its decoration.

### Verify

- [ ] Extend the suppliedLogs tests. Select `error: The payment worker exited`, open Event details and assert checkout.mjs:42, apply its correlation filter and compare the query and filtered count to source. Change filters until chosen ID is excluded and assert disabled action plus the hidden explanation. Remove that event and assert the separate source-removal explanation.

- [ ] Append ten uniquely identified events at the end while reading an older selected event with Follow off. Assert the selected ID is unchanged, its bounding-box top shifts by ≤1 CSS px and one detail exists. Test 20 ArrowDown/ArrowUp selections and assert no detail travel or delayed selection. Activate Follow, then wheel away and repeat the append. Restore filters and selection through reload.

```bash
pnpm exec playwright test --config tests/e2e/clarity-schedule-logs.playwright.config.ts tests/e2e/exploration-ui.spec.ts --grep 'log|Log'
```


## 19. Workflow board

### Files and existing behavior

- `apps/web/src/WorkObjects.tsx`
- `apps/web/src/work-objects.css`
- `tests/e2e/work-objects.spec.ts`

Open `WorkflowBoard`, `useBoardMotion`, `boardDraftMatchesSource`, `boardProposal` and the board test cases. At the pinned source, a revision or placement change reruns the same spring logic. The presented position can come from an editable draft or from the newly supplied source.

### Implement

1. Set `.workflow-lane` min-height to 128 px, `.workflow-lane-cards` min-height to 82 px and selected detail padding to 12 px. Keep the 82 px empty drop area, existing 170 px minimum inline lane track, source lane ordering and overflow/stack handling. Put title and Move to on one wrapping row, detail below. The footer continues reporting local proposals.

2. Change the local `move` signature to receive `(cardId, laneId, cause)`. Return before effects/store writes when the target lane already contains the card or the source is stale. Use `pointer` for a validated native drop and `keyboard` for Alt+Arrow. For the shared Select, capture pointer down and key down in its local wrapper, including portal-bubbled activation. Consume the last local cause at onValueChange. An unmatched or programmatic cause settles immediately. Do not change the shared Select.

3. Replace the accumulating board spring array with one local transfer owner keyed by card ID and one pending move record containing revision, expected destination and old on-screen rectangles. Capture visual rectangles of visible keyed cards immediately before committing the local pointer move, including transforms still on screen. Cancel active board effects and clear their transforms. After commit remeasure destination rectangles without transforms. If sourceRevision and requested placement match, animate each surviving, visible moved card/sibling from old−new x/y to zero for 220 ms using cubic-bezier(.4,0,.2,1). Skip deltas ≤1 px, offscreen rectangles and identical IDs/positions. Pointer dragging itself stays native. On rapid reversal start from the current visible rectangle.

4. Keyboard move, initial paint, source reload, stale-source detection, reset and remote revision all settle effects immediately. Inflight policy or visibility change must cancel animations and clear transforms even if there is no next move. Restore selected card focus with preventScroll. Integrate only the existing board draft, previous checkpoint and latest-source proposal. Keep `Moved locally` and exact `Send move proposal` copy and never acknowledge a source move from a local drop.

### Verify

- [ ] Extend the existing real pointer drop and keyboard move cases. Use the supplied `Keep retries ordered` card. Compare its first and last rendered rectangles on a pointer transfer. Verify the destination parent and the previous position on the first moving frame. Reverse during active motion. The first position after reversal must be within 1 CSS px of the sampled interrupted position. Its end transform is identity.

- [ ] Perform Alt+Right and inspect the first committed frame. The selected card has focus, no card transform is active, exactly one local move is shown, and the explicit submit payload contains `sourceRevision:'board-7'`, card `retry`, `ready` → `review`. Publish `board-8` while a pointer transfer is moving. Check cancellation, unchanged source, disabled stale submission and recoverable Reset to source. In both policy cases named `app … settles active board motion and preserves keyboard focus`, press Alt+Right and assert no running transform on the first committed frame. Start the in-flight cancellation test with a real pointer drop under full motion, pause the transfer via its Animation handle and sample computed transform. Change app policy to reduced/off, then assert identity and zero active transfers plus focus preservation. Returning to full must not replay it. Replace the existing inline-style nonempty assertion because a WAAPI transform is not an inline style.

```bash
pnpm exec playwright test --config tests/e2e/generated-selects.playwright.config.ts --project=generated-controls tests/e2e/work-objects.spec.ts --grep 'board|Board'
```


## 20. Architecture canvas

### Files and existing behavior

- `apps/web/src/WorkObjects.tsx`
- `apps/web/src/work-objects.css`
- `tests/e2e/work-objects.spec.ts`

Open `ArchitectureCanvas`, `architectureLayout`, `useSelectionHalo` and the finite-perimeter/replacement policy browser tests. Keep this local helper in WorkObjects.tsx. Apply the same backward-compatible signature to the trace caller in section 21 of this prompt.

### Implement

1. Extend local `useSelectionHalo`’s returned handler with `durationMs: number = 360` as its second argument. Keep current per-owner cancellation, theme/policy observer, one disposable inert perimeter element and cleanup. Use 140 ms for architecture, 120 ms for the trace caller and the 360 ms default for every caller that omits the duration. Keep the same 1 px perimeter and token color. Changing duration must not change node dimensions. Use opacity 0 to .65 at 35% then zero on this outline.

2. Route architecture node and connected-node button activation through one local selection function taking node ID and explicit pointer/keyboard cause. Commit source selection and revision using the existing save path. Only a different ID chosen by pointer gets the 140 ms perimeter response. On reselect, still refresh explicit inspection revision after a source update, without replaying the pulse. Remove halo calls from arrow/Home/End navigation. Keyboard activation and neighbor focus update instantly. For keyboard detail opening pass animate=false to the existing MotionRegion. Keep one measured detail region.

3. Leave layout input dependent only on topology and available width. At wide widths retain the connection list beside the selected description. Use a 16 px detail gap and 12 px top padding. Stack copy then connections under the existing narrow container breakpoint. Render the current opposite node label as button text. In its second line use `Outgoing · <edge label>` or `Incoming · <edge label>`. With no label use `Outgoing connection` or `Incoming connection`. Use the edge’s real from/to values. Render `No supplied connections.` when empty.

4. Keep the Focus neighbors mode and the real directed SVG paths with marker endpoints. Preserve state on theme changes. If the selected node disappears hide its detail. If only revision changes keep the detail readable and submitted action disabled until deliberate re-selection of a current node. Clearing or toggling neighbor focus cannot authorize submission. Reduced/off skips the perimeter and conditional CSS transitions.

### Verify

- [ ] Select `Bounded parser` in the existing architecture fixture. Snapshot all node rectangles before/after selecting and after Focus neighbors. An unchanged viewport/topology means maximum difference 1 CSS px per coordinate. For every connected button, compute expected label and direction from suppliedGraph.edges. Click one and verify selected node/pressed state and its different list.

- [ ] Retain the existing shared perimeter disposal tests and update the architecture expectation for 140 ms. Update the current replacement test that calls element.click() on the same node after pausing a halo. This detail-zero activation is a programmatic/keyboard-like reselect. Expect no new halo. For the replacement case use real pointer clicks on Bounded parser then Draft queue, pause the first a fraction into its effect, assert the first Animation.playState becomes idle and only the newest perimeter remains. Retain the unmount disposal check. Keyboard navigate, restore/reload, switch policy mid-play and unmount. No stale overlay is left. Publish a newer revision with the same IDs, verify disabled submit until inspecting a node again, then verify existing exact sourceRevision/nodeId payload.

```bash
pnpm exec playwright test --config tests/e2e/generated-selects.playwright.config.ts --project=generated-controls tests/e2e/work-objects.spec.ts --grep 'architecture|halo|perimeter'
```


## 21. Trace waterfall

### Files and existing behavior

- `apps/web/src/WorkObjects.tsx`
- `apps/web/src/work-objects.css`
- `tests/e2e/work-objects.spec.ts`

Open `TraceWaterfall`, `traceLayout` and `useSelectionHalo` in WorkObjects. The same layout model supplies the ruler and span tracks. Keyboard selection currently routes through the shared halo. Use the same local duration argument implemented in section 20 of this prompt.

### Implement

1. Set pointer row min-height to 40 px and coarse pointer min-height to 44 px on the row, actual treeitem and `.trace-track`. Replace the existing 47 px `.trace-track` minimum so the grid child cannot enlarge its parent. Set detail top gap to 12 px. Keep tabular durations. With an active query or status filter set heading caption to `<visible-count> of <source-total> spans`, counting included ancestors. With neither filter keep `<total> supplied spans`. Preserve unknown-timing rows and the existing patterned `Timing unavailable` label.

2. Keep the existing traceLayout range, zoom, row set and shared label/track-width calculation. Render start, duration, position, precision labels and ruler atomically from each source snapshot. Never tween their left/width or numeric text. Use a marker at the exact supplied start for an actual zero-duration span. Keep its timing label zero and make the marker 2 px wide. For a positive supplied duration use its computed track width, including fractions below 2 px. Remove the two 1 px side borders from positive spans. Draw their outline with an inset box shadow so it cannot impose a 2 px minimum. If either required time is absent, show the existing unavailable treatment.

3. Separate pointer versus keyboard activation in the local select path. Apply the local useSelectionHalo perimeter helper to the selected bar with 120 ms duration for a new ID on pointer activation. A span with no bar gets equivalent local status-color emphasis on its status dot. Remove the pulse from arrows, Home, End, zoom, filter, restore and reselect. Use the existing MotionRegion as the sole detail-height owner, animate=false for keyboard/restore. Preserve the single tree Tab entry, parent-child arrows and explicit pointer collapse semantics.

4. When the same source span changes status, compare old and new status by span ID. Give its label a single 120 ms opacity accent only if it is visible and its status actually changed. Do not render any authority from a local filter. Retain stored revision validation in `submit`. On policy change cancel selection and status effects. Use immediate updates for reduced/off.

5. Retain the current reader anchor on source appends. With the same active tree and existing selected span, preserve focus and its viewport y offset when source data changes before it. Adjust the closest actual scroll owner by the measured offset delta immediately after render, only if native anchoring did not already restore it. Manual filter, collapse, zoom and keyboard traversal use their own intended focus/scroll behavior.

### Verify

- [ ] Run the existing exact-origin and fractional timing cases. Add one zero-duration and one unknown-duration span to the fixture in the test. For a single-line fixture row measure the row, treeitem and track with `getBoundingClientRect().height`. Each must be 40 ± 1 CSS px on desktop and 44 ± 1 CSS px with a coarse pointer. Supply an additional positive duration whose computed bar is between 0 and 2 px. Assert that its width matches the shared scale within 0.1 CSS px. Verify the zero-duration fixture represents 0 ms at exact start, second displays Timing unavailable and no numeric bar. With the recorded five-span scene and Error filter assert `2 of 5 spans` when only one error and its ancestor remain.

- [ ] Extend the filtered descendants case. Select the child, append a different span in a new source revision and assert focus/ID and y offset within 1 CSS px after commit. The selection cannot submit against the newer revision without reselecting. Test pointer pulse, instant arrow traversal and 390 px/44 px coarse-pointer interaction. Preserve the validated numeric zoom and exact ruler/track alignment.

```bash
pnpm exec playwright test --config tests/e2e/generated-selects.playwright.config.ts --project=generated-controls tests/e2e/work-objects.spec.ts --grep 'trace|Trace|halo|perimeter'
```


## 28. Task plan and agent progress

### Files and existing behavior

- `apps/web/src/PlanStatus.tsx`
- `apps/web/src/plan-timeline/TimelineRows.tsx`
- `apps/web/src/plan-timeline/timeline.css`
- `tests/e2e/plan-timeline.spec.ts`

Read the live owner/revision fences in PlanStatus, TimelineStep/AgentLane and the `ReadingPosition` class. `plan-status.css` imports the timeline stylesheet. The existing plan intentionally uses `MotionRegion animate={false}` for agent and step details. Plan counts come from accepted normalized plan data.

### Implement

1. Set `.plan-branches>.plan-agents` to `align-items:start`. Keep its current auto-fit/minmax tracks, agent ordering, border spanning the whole branch group and join after the grid. In the existing ≤520 px container rule set .plan-fact margin-bottom to 8 px and .plan-steps gap to 14 px. Leave each row’s available width, text size and focus targets intact. Allow height to grow with source text. No equal-height cards.

2. Keep the existing normalized completed/accepted count and aria-valuenow/valuetext. Replace width interpolation with a full-width fill using transform-origin:left center and scaleX(percent/100). Apply the final transform immediately on mount/restore/revision correction/thread change. For a new accepted status transition within the same owner, begin a single 160 ms decorative scale interpolation from the current visible progress to the new value. Preserve the exact textual count from the first committed frame. Reversal samples the computed current scale before canceling the previous effect. Reduced/off commits scale and text together immediately.

3. In the keyed step row keep its previous owner/step ID and accepted-or-completed classification. On the first committed render establish a baseline. On pending/running/review/blocked → accepted/completed for the same step, show a single 120 ms local check opacity .6 to 1 on the existing .plan-step-node. A second snapshot, a re-render with new facts, an accepted→completed label change and initial mount already completed all stay quiet. Do not add status effects to every subagent card. Clear on owner change, unmount, reduced/off or visibility loss.

4. Preserve `props.open('step',step.id,step.status)`, manual collapse state and existing stable step/agent keys. Do not derive expanded state from the animation. Keep `ReadingPosition` before/after capture and its updateKey. Jump to current is an explicit user command with immediate scroll/focus and no decoration delay. Preserve last valid plan when the next plan is malformed.

### Verify

- [ ] Extend existing `desktop parallel branches and join`. Use one agent with a short description and a second agent with enough task/facts to span at least three more lines. When the agents share a row, their tops must match within 1 CSS px and shorter bottom is above the taller bottom by at least one full text line. Join top is ≥ tallest bottom. At 280 px pane and 200% zoom assert both source agent IDs remain readable in source order, no horizontal page overflow, no clipped transcript operations.

- [ ] Using `window.planFixture.update` and timelineSnapshot, capture .plan-completion, one step DOM handle, its focus, expanded state and visible anchor y. Publish a newer step completion, repeated snapshot, stale revision, then switch threads and restore. Expect the exact current count each time, at most one accent for a newly completed transition, the earlier expanded choice preserved and anchor displacement ≤1 CSS px. Exercise Jump to current with keyboard. Keep existing invalid-plan, nested-agent, active-thread and replan regressions.

```bash
pnpm exec playwright test --config playwright.config.ts tests/e2e/plan-timeline.spec.ts
```


## Record the review videos

Produce seven continuous dark-theme MP4s. After the scoped tests pass, commit your tracked changes on the working branch. Create the capture checkout with the following commands. When repeating a take, use a fresh capture output directory.

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

Record that SHA. Place all temporary recorder sources under its `scripts/` using the prefix `local-w4-`. Return the private recorder copies with the evidence in this project. Keep them untracked.

| Film | Recorder scene ID | Checked-in scene / subtree |
| --- | --- | --- |
| UI-16 | image-annotator | image-work/annotate |
| UI-17 | schedule-picker | time-offered/root |
| UI-18 | log-explorer | investigation-latency/logs |
| UI-19 | workflow-board | work-objects/board |
| UI-20 | architecture-canvas | work-objects/architecture |
| UI-21 | trace-waterfall | work-objects/trace |
| UI-28 | task-plan | host |

When the original archive is available, use the three TypeScript sources in `Gen-V1-UI-review/recording-scripts/` from the review ZIP. Map generative-review-scenes.ts, record-generative-review.ts and record-generative-adjacent.ts to `local-w4-scenes.ts`, `local-w4-catalog.ts` and `local-w4-host.ts`; fix the relative scenes import. The catalog’s archived recording begins after generation. In its private copy preserve `const initialArtifact=snapshot.artifacts[0]`, set `if (!stills) snapshot.artifacts=[]` before returning the fixture host and keep its existing `publishInitial` helper, wait for the composer textbox named `Message` and assert the page has zero `.artifact` elements, start `recordWindow`, wait 500 ms, then call `host.publishInitial()`. Move artifact, PDF, image, signature and scroll readiness checks after that call. For task-plan, hold back its plan data row at startup; restore and publish it 500 ms after recordWindow starts. For the host copy read OUTPUT from process.env.CAPTURE_OUT and set PORT to 6284; remove the legacy machine path, and stamp the measured git SHA in both manifests. [Original review ZIP](https://chatgpt.com/library?file_id=libfile_e853efaba1cc819188bc47299ccb1228&account_id=personal)

For a source-only session, copy the tracked `scripts/record-task-design.ts` to `scripts/local-w4-catalog.ts`. It already implements publication after capture starts, source-backed controls, PDF/PNG grants, fixture HTTP/SSE and a real Vite App. Replace fixed port 5465 throughout this private copy with 6214. Keep its browser setup, `installFixture`, resource routes and video stop/cleanup. In its scene list clone each mapped entry from `taskDesignScenes()`, set its ID to the recorder scene ID above, and copy only elements reachable recursively through each element’s children from its assigned root (root means scene.spec.root). Replace the full-catalog assertions with per-film checks for the assigned subject. Implement the ordered interactions from this prompt. Preserve fixture action handlers by testing the original source scene ID after the display ID changes. For task-plan import timelinePlan from tests/e2e/plan-timeline-fixture.ts. Set a working task-thread with runId “run-a” and epoch 1. Publish a plan:task-thread data record of provenance harness:plan and revision 1 after recording starts, then in the next revision update the same `build` step from status `working`, state `running` to status `completed`, state `accepted`. Publish and replay the unchanged step once. Keep the owner, run, step and epoch stable. Use the real App region named “Task plan: Improve the workspace”. In the source-only route copy the Vite/browser setup and capture loop into `scripts/local-w4-host.ts`, read `CAPTURE_OUT`, and serve the selected host scene at port 6284.

Before starting the video, put the insertion point in the visible conversation area. Observe the first nonempty published frame with an IntersectionObserver or a sampled DOMRect. Require it to intersect the viewport when its entrance begins. An offscreen entrance followed by an automatic scroll fails the opening. Scroll only for later chapters where the task requires it.

From the root of the disposable capture worktree, initialize a fresh capture directory after creating your private recorder files.

```bash
export CAPTURE_OUT
CAPTURE_OUT=$(mktemp -d "$EVIDENCE/capture.XXXXXX")
```

For both paths, record exactly 500 ms of the ready host before the first fixture publication. In the source-only path, change the tracked seed’s initial 900 ms hold in its private copy to 500 ms. For the host-scene command, read the output directory from `CAPTURE_OUT`. Use per-scene assertions and guard only optional data. An absent required control, empty clip or missing chapter must cause a failing exit. Discard the old minimum total-length padding in the archive and use the 900 ms hold after the actual final result. For a rapid reversal, use raw Playwright input as soon as the first effect is running, ahead of any reading dwell or chapter screenshot. Do not change product timing to make the recording easier.

Run these commands from that worktree. The archived catalog recorder accepts `--port`. In the source-only catalog recorder, replace the fixed server port and origin as directed above before launching.

```bash
pnpm exec tsx scripts/local-w4-catalog.ts --theme dark --port 6214 --scenes image-annotator,schedule-picker,log-explorer,workflow-board,architecture-canvas,trace-waterfall --output "$CAPTURE_OUT/catalog"
pnpm exec tsx scripts/local-w4-host.ts --scene task-plan
```

For either recorder path, update the action sequence to include every implementation section’s film steps. Keep the 1920×1080, 30 fps, real-time compositor recording running through every required action and interruption. Log elapsed event times, wait for observable results, then hold the final stable state for 900 ms. Keep action timing independent of screenshot delays. Package the numbered names below after both the scene assertions and stream validation pass. Save any diagnostic takes separately. Log codec, size, duration, fps, SHA-256 and action timestamps. Decode each complete file with `ffmpeg -v error -i "$film" -f null -`. Inspect opening, changing and settled frames; reject empty or pre-settled openings, element clipping, wrong subject, or a missing action.

### Exact chapters and filenames

| Deliverable | Required action order after the opening |
| --- | --- |
| `16-image-annotator.mp4` | Click at 25% width, 75% height. Type “Move caption”, press Shift+ArrowRight, add a second pin and delete only that pin. Submit Pin 1’s feedback and confirm the fixture received its coordinates and note. Then delete Pin 1 and show focus returning to Add pin. |
| `17-schedule-picker.mp4` | Select the 90-minute Working session, select a different available slot and return. Submit its exact interval. Publish changed endpoints for the same slot ID, show the new interval, then publish that it is unavailable and verify the disabled proposal. |
| `18-log-explorer.mp4` | Select Quantity assertion failed, inspect Event details and filter by checkout-17. While reading that older row append a matching event and confirm the original row stays put. In expanded view enable Follow, append, then wheel away. Verify Follow turns off. |
| `19-workflow-board.mp4` | Move the selected card to In review, reverse it, propose the move again and submit. Publish source acceptance as a separate event. Keep the same card ID. |
| `20-architecture-canvas.mp4` | Select Bounded parser, focus neighbors, restore all, inspect Resource store. Show supplied connection and direction without moving nodes. |
| `21-trace-waterfall.mp4` | Select Parse document, filter Error, restore all, select Legacy adapter. Show source duration, visible ancestor and unknown timing. |
| `28-task-plan.mp4` | Open parallel details, focus an expanded branch, and publish the same build step moving from working/running to completed/accepted. Replay identical values. Keep details and reading position, then explicitly invoke Jump to current by keyboard. |

### Produce the final numbered files

The recorder may emit an unnumbered filename or one ending in `-recording.mp4`. Run this from the verified capture worktree on a successful attempt. It reads each recorder's actual output manifest, copies only the 7 assigned files into a new directory for this attempt, decodes them and writes their metadata. Use that directory for the per-file links.

```bash
python3 - "$CAPTURE_OUT" <<'PYFILMS'
import hashlib, json, shutil, subprocess, sys
from fractions import Fraction
from pathlib import Path

root = Path(sys.argv[1]).resolve()
filenames = {
    "image-annotator": "16-image-annotator.mp4",
    "schedule-picker": "17-schedule-picker.mp4",
    "log-explorer": "18-log-explorer.mp4",
    "workflow-board": "19-workflow-board.mp4",
    "architecture-canvas": "20-architecture-canvas.mp4",
    "trace-waterfall": "21-trace-waterfall.mp4",
    "task-plan": "28-task-plan.mp4"
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

## Deliver your branch and 7 videos

Run `pnpm typecheck`, `pnpm lint` and `git diff --check`. Compare changed and untracked product paths against the file lists above. Stage explicit source/test paths and commit the verified changes before capturing. On the final branch commit also run `git diff --check "$BASE_SHA" HEAD` and record the full result of `git rev-parse HEAD`. If all required behavior was present at baseline, use the verified existing SHA. Record videos from that exact commit in the separate capture worktree. Preserve every diagnostic retry in a separate evidence directory.

Return the 7 numbered MP4s listed at the top as individual attachments or direct per-file links. In the evidence directory write `review.md` with one row per clip containing its filename, UI, tested SHA, fixture provenance, chapter timestamps, exact verified outcome and any remaining failure. Include `manifest.json` with filename, SHA-256, byte length, codec, resolution, frame rate, duration and visible component names per file. Include the private recorder sources there for reproduction. Use `ffprobe -v error -show_streams -show_format -of json` on every film, verify H.264, 1920 × 1080 and 30 fps, decode each to EOF, then watch each once at normal speed. Reject footage whose new object is already settled on its first visible frame unless its specified behavior is immediate. Fix a missed interaction or unreadable capture and re-record only the affected film.

In your final response give the branch name, base and result SHAs, changed tracked paths, exact executed checks with pass counts, and links to the videos and review. Identify any inaccessible runtime, skipped gate or unmeasured property explicitly. Fixture recordings demonstrate renderer behavior under the stated source inputs. Report live-model outcomes only when exercised on the real host. Link a local patch when the owner cannot access the branch. Your assignment is complete independently. If a combined commit has already landed through the normal repository workflow, you may rerun your own checks and clips there and label them with that new exact SHA. Branch captures always carry their actual branch SHA.
