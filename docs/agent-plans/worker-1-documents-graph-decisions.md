# Worker 1. Documents, graph, maps and planning decisions

Implement the following changes in `skytuhua-org/Gen-V1`. Make a PDF land on its selected field, let signature ink resolve in place, anchor progress to the actual graph node, link a map pin to its place, fit comparisons to their image pair, preserve the editor through docking and leave an accepted answer beside its question. You also own the model composition examples and their live evaluation.

You own seven interfaces. Return one working branch, one individually playable MP4 for each interface and the verification results. This entire Markdown file is your instruction. Execute it in one worker session from the pinned base.

| UI | Assignment | Review video to return |
| --- | --- | --- |
| 01 | PDF document preview | `01-document-preview.mp4` |
| 02 | Signature controls | `02-signature-pad.mp4` |
| 03 | PR history and conflict graph | `03-relationship-graph.mp4` |
| 04 | Map and place selection | `04-map-view.mp4` |
| 09 | Before and after image comparison | `09-image-compare.mp4` |
| 25 | Document editor and source bundle | `25-document-editor.mp4` |
| 27 | Planning questions | `27-planning-question.mp4` |

## Start from the inspected source

Use the existing authorized checkout of [skytuhua-org/Gen-V1](https://github.com/skytuhua-org/Gen-V1). The common starting commit is `26ddf4d16c2fc1196b520d8a46c5441d64d01463`. Every section below can be implemented against that commit in this branch. Use a full checkout with its workspace packages, fixtures and lockfile. From the repository root, in Bash:

```bash
set -euo pipefail
BASE_SHA=26ddf4d16c2fc1196b520d8a46c5441d64d01463
BRANCH=refine/documents-graph-decisions
if ! git cat-file -e "$BASE_SHA^{commit}" 2>/dev/null; then git fetch origin "$BASE_SHA"; fi
WORK_RUN=$(mktemp -d "${TMPDIR:-/tmp}/gen-v1-worker-1.XXXXXX")
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
| 01 | On the toolbar, reveal a 14 px underline beneath the page fraction from left to right over 120 ms. The PDF canvas and active-field coordinates stay final. An asynchronously decoded page paints directly into its reserved rectangle. |
| 02 | Trace the existing signature well’s top-left corner over 140 ms, using an 8 × 8 px, 1 px border over the final border. The first generated signature displays as soon as it is ready. Reserve the ink reveal for an explicit style change. |
| 03 | Reveal the first existing branch label’s small color key from opacity .6 to 1 over 100 ms. Draw all true edges and positions at their committed geometry. Reserve row title, progress and branch completion feedback for later source publications. |
| 04 | Reveal the 16 px rule below the selected place index from left to right over 120 ms. The pin, card and supplied routes share their final selection from the first frame. |
| 09 | Fade just the overlay divider grip from .65 to 1 over 120 ms when the authorized image pair is ready at publication. Its percentage and hit target are final. A split view or late decode uses immediate final appearance. |
| 25 | Reveal the existing `FileText` icon in `.document-window-launcher .document-heading` from .65 to 1 opacity over 120 ms. Keep the title, source drawer and button hit area settled. |
| 27 | At first arrival of a pending planning request, reveal a 12 px rule under the question title over 120 ms. Restore an already-pending request at rest. Keep active input, custom answer and subsequent accepted receipt under their own state rules. |

Exercise each positive opening with the delayed fixture publication in its assigned browser spec. Test the same record when already present at bootstrap, an identical republish, and app reduced/off. Count one eligible local start for the positive case and zero on the others. For an absent target, assert zero and verify the usable fallback. Cancel on first input, policy downgrade, source replacement or unmount. Clip only the decorative mark. The existing outer artifact entrance keeps its own transform.

## What the original recordings showed

Use these observations to reproduce each issue. The clips used an authored fixture on commit `4bcdc82a73a28d27d6ebe413a527389119f35292`. Each timestamp is relative to its own MP4. Recheck the behavior on the assigned source commit before editing.

| UI | Original video time | What is visible |
| --- | --- | --- |
| 01 | 12.212–14.329 s | Both full-resolution chapter frames show the oversized document heading at the top of the viewport, with the bound Name field outside the visible viewport. The source fixture declares activeFieldStateKey step, step Name, Name mapped to name, and name Alex Morgan. This is a retained captured outcome, not just an intermediate zoom frame; it needs targeted reproduction. |
| 02 | 3.375–4.125 s | Another style clears the signature and then reveals the replacement from left to right. The visible replacement is appreciably slower than ordinary control feedback. |
| 03 | 5.000–5.500 s | A new conflict-resolution row arrives and shifts the existing rows while connected paths follow. This continuity is a strength. |
| 04 | 7.125–7.625 s | Expanding details adds address information and increases the artifact height. Night was already selected, so this clip does not establish a palette transition. |
| 09 | 5.500–6.125 s | Split mode shrinks each image to half width while keeping the original tall stage. This creates large internal letterbox bands. |
| 25 | 00:06.7–00:07.3 | Dock changes to a floating editor while preserving the draft; the placement change is abrupt. |
| 27 | 00:15.0–00:15.5 | After submission, the whole question region disappears. |

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

## 01. PDF document preview

### Observed behavior and target

Video 01 ends its focus operation with a magnified heading and the bound Name field outside the viewport at 12.212 and 14.329 s. The settled initial fixture has a bound Name field. Keep document pixels, navigation, highlight, and available controls aligned through an explicit page/focus sequence.

### Files you may edit for this interface

- `apps/web/src/DocumentPreview.tsx`
- `apps/web/src/document-preview.css`
- `apps/web/src/frontend-fidelity.css`
- `tests/e2e/document-preview.spec.ts`
- `tests/e2e/signing-fidelity.spec.ts`

### Inspect before editing

- `DocumentPreview` owns `selectedPage`, `displayedFit`, `factor`, `appliedNavigation`, staged raster replacement, and `documentNavigation(view)`. Inspect these together.
- `tests/e2e/document-preview-fixture.ts` supplies actual PDF form annotations. `tests/e2e/signing-motion.spec.ts` protects export continuity and interruption. `apps/web/src/registry.tsx` only registers the preview and its pair.

### Implement in order

- [ ] **1.** Before editing, extend `tests/e2e/document-preview.spec.ts` beside “focused Name and Email preserve their left prefix” using its real `workspace()`, `fixtureHost` and `createSigningPdfFixture()` setup. Start with Name active and `name='Alex Morgan'`. Save the starting canvas, paper, viewport, field and toolbar client rectangles. Click Next PDF page, Previous PDF page, Fit PDF page, Focus active PDF field in that order. Wait on page/field identity and settled geometry, not a fixed timeout. Capture the final rectangles, `scrollLeft/Top`, page dimensions and active binding. Check visibility using scenario 1.

- [ ] **2.** Use one toolbar in normal layout flow with 36 px minimum height. Move paging controls from the footer into it beside a tabular `page / pages` label, the supplied title, `Fit page` and existing focus/zoom/open/download controls. Keep exact existing accessible action names. Show the active bound field name beside the focus icon, truncate its visual label before hiding controls, and retain its full accessible name/description. Wrap controls to a second 36 px row when they exceed the available inline size. Keep existing grant-gated source links. Render activity/error information in one compact status slot; keep the resting `Draft preview · Page x of y` announcement accessible without a second visible paging row.

- [ ] **3.** Give the preview root three layout tracks: toolbar, `minmax(0,1fr)` viewport, and intrinsic status. In `frontend-fidelity.css` remove the inline override's absolute `inset:0` from this preview scroller. Keep the local outer height bound, canvas intrinsic aspect, viewport padding of 14 px, and the existing inline scroll containment. Replace the current 96 px vertical subtraction with actual available height minus the two 14 px insets, clamped to a positive value. Use the scroller’s actual client dimensions after toolbar allocation for PDF fit calculations. Keep the current max-height, overflow and overflow-wrap rules on .document-preview-failure p, including the recent 6.4em limit. Remove the old hover-only opacity rules from the toolbar. Shrink only the preview’s internal margins, never crop the supplied paper.

- [ ] **4.** Commit the final raster-backed paper dimensions, `frame.width * factor` and `frame.height * factor`, before deriving a new field target. Remove the 420 ms paper width/height tween for explicit page/fit/focus intent. Preserve the atomic verified-export handoff and its previous authorized raster until the candidate commits. If baseline evidence shows focus fails only while an old raster/identity is retained, fix that guard as well: match current source grant, selected page and navigation intent before allowing the target to publish. Do not recalculate/claim the viewport from ordinary draft updates.

- [ ] **5.** Use the committed paper’s offset in the scrollable content: `paper.left - viewport.left + scrollLeft` and the corresponding top. Convert the bound PDF rectangle via the committed PDF.js viewport and add the paper offset. For an axis with rectangle extent ≤ client extent minus 28 px, center that axis. For a wider/taller rectangle, align its leading edge to 14 px. Clamp scroll on each axis to `[0, scrollExtent-clientExtent]`. Send these coordinates to the existing `documentNavigation` owner once per explicit navigation. Preserve the existing over-wide left-prefix behavior. Use the same committed coordinates/scale for the highlight overlay. Preserve .document-preview-footer and its accessible status so existing artifact-style assertions still read the PDF page.

- [ ] **6.** Keep the editing/default behavior when a real active bound field exists. Use fit-page for inspection with no valid bound field or explicit Fit. Focus is an explicit command: set focused state true and retarget the active bound field even when invoked again. Preserve real paging boundaries. Use an intent serial for explicit reruns of the same action; retain cancellation on user wheel, scrollbar/pointer, keyboard scroll, identity changes and unmount. Pointer focus uses the existing interruptible scroll. Keyboard activation and effective reduced/off jump directly to the final position. Subscribe via `observeMotionPolicy` so mid-flight changes settle in the same owner.

- [ ] **7.** At successful pointer focus arrival, animate only the active field outline opacity .65 → 1 over 120 ms with `--ui-ease-enter`. Mount the final field geometry immediately. Disable travel and emphasis for reduced/off, keyboard, restoration, unavailable fields and ordinary updates. On revoked resource or lost export continuity clear unauthorized old pixels and overlays immediately.

### Verification scenarios

1. Name landing: for a field that fits, assert all four sides within the viewport minus 14 px, allowing 1 CSS px measurement tolerance and physical scroll bounds. For an over-wide field assert the left prefix and its actual ink are visible with that clearance. Check both the recorded action order and Fit → Next → Previous → Focus at 1440×1000 and 390×844. Record the previously failed frame and final field frame.

2. During a pointer focus trip, issue wheel input. Record settled post-wheel scroll. Publish an unrelated form change and wait for the committed raster. Assert the scroll owner does not reclaim the viewport. Interrupt a second focus with Fit and verify the full paper is visible. Under keyboard and reduced/off, read the final target after the committed raster without travel.

3. In the existing “page fit reveals the entire PDF” signing-fidelity test, replace the 34/32 px checks for floating chrome with >=13 px within the actual scroller on all sides plus an assertion that the toolbar bottom is at or above the viewport top. Retain the single canvas/single fetch and width↔page behavior assertions. Keep existing tests for denied/revoked grants, preserved canvas identity, stale candidate rejection and keyboard ink passing. At 760 px artifact width hover elsewhere and verify all toolbar controls remain reachable. Inspect the lowest zoom, last page and long filename.

### Run these checks from the checkout root

```bash
pnpm exec playwright test --config tests/e2e/pdf.playwright.config.ts tests/e2e/document-preview.spec.ts
pnpm exec playwright test --config playwright.config.ts tests/e2e/signing-motion.spec.ts
pnpm exec playwright test --config tests/e2e/fidelity.playwright.config.ts tests/e2e/signing-fidelity.spec.ts -g "page fit reveals"
pnpm exec playwright test --config tests/e2e/smooth-pdf.playwright.config.ts tests/e2e/document-smoothness.spec.ts
```

### Evidence to retain

Attach the measured rectangles and before/after Name-focus shots, list the sequence that reproduced the original failure, and identify the causal source line(s) from that run. Include verification evidence for interruption and export continuity.

## 02. Signature pad

### Observed behavior and target

Video 02 demonstrates a generated signature, style switching, freehand input and undo. Make the ink itself communicate a deliberate style replacement. The result must preserve the existing saved PNG and all direct drawing mechanics.

### Files you may edit for this interface

- `apps/web/src/SignaturePad.tsx`
- `apps/web/src/document-preview.css`
- `tests/e2e/signing-fidelity.spec.ts`

### Inspect before editing

- `SignaturePad` imports shared `document-preview.css`. Edit the existing signature selectors in that stylesheet. Scope every new rule to this signature component. `apps/web/src/signature-assets.tsx` supplies `preview`, `save`, `get` and preparation journaling. 
- `generate` builds one canonical 960×320 PNG and computes nontransparent ink bounds. `queueGenerate` owns the 250 ms name debounce. `revealGenerated` currently runs a 550 ms effect. `signingFixture` in the owned browser spec serves real image bytes.

### Implement in order

- [ ] **1.** Start from the existing browser case “signature modes share one well”. Preserve its one-visible-image checks, legacy typed/drawn contrast cases, and canonical bytes. Add a test called `UI-02 explicit style replaces one ready ink asset` using `signingFixture(page, undefined, {step:'signature', name:'Alex Morgan'})`. Count calls to `Element.prototype.animate` on the signature preview and observe visible preview source and intrinsic decoded width across animation frames.

- [ ] **2.** In `generate` assign an explicit invocation reason: `'initial' | 'name-edit' | 'style-pointer' | 'style-keyboard'`. Initial source generation uses initial, the 250 ms debounce uses name-edit, and the style button distinguishes real pointer activation from keyboard. Increment a local operation serial for each invocation. Store a reveal intent only for style-pointer, current nonempty normalized name and the current editing owner. Use the same canonical PNG produced by `generate` in the existing asset write. Do not create a second signature asset.

- [ ] **3.** Separate the candidate image decode from the single visible preview. For a style replacement with the same owner and name, keep the last authorized displayed URL while a detached `Image` decodes the replacement URL. Commit the candidate only while the owning state key, current mode, normalized name, serial and source identity still match. Swap the URL on the existing visible image, then perform a single ink reveal. If a journal-backed pending URL resolves to the same committed asset, treat it as the same generation and consume the reveal once. Never retain an old preview across clear, source/owner change, lost access or replacement by another input mode. Preserve existing typed and drawn previews.

- [ ] **4.** Replace the 550 ms animation with a 240 ms linear left-to-right reveal on `.signature-image-preview` using the existing measured ink bounds and contained image rectangle. Opacity .85 → 1. Keep the image’s final geometry for all frames. Add a maximum 140 ms pointer-only mode indicator handoff, bounded inside the existing mode group. Set the requested mode and make its controls usable synchronously. Reuse the same well aspect ratio, minimum height and tool slot for all modes. Use local CSS only; do not move the drawing baseline or scale the canvas.

- [ ] **5.** Invalidate obsolete decodes and cancel the previous animation on subsequent style click, name edit, owner change, entry to Draw/Upload, clear or unmount. When only effective motion policy changes to reduced/off, cancel the decoration but allow the latest authorized candidate to finish decoding and commit it immediately without a reveal. On keyboard, reduced/off, restoration, first generation, edited name and upload, show the real ready result immediately. Preserve source errors and `Retry signature upload`. On decode failure, leave the preceding authorized same-name style visible with the existing error and never acknowledge a failed replacement. Do not change PNG size limits, font data, draw/undo serialization, journal preparation, submit enablement or export bytes.

### Verification scenarios

1. With generated ink visible, click Another style and delay the replacement decode using an in-page gate on the detached candidate. Before releasing, observe one visible valid previous mark. After release, exactly one visible new mark, one reveal and different canonical asset. Switch to Draw halfway through and release a stale decode. The canvas remains active and no old image appears.

2. Enter a new name faster than 250 ms per keystroke, then wait for the final canonical result. Confirm zero style reveals and correct final name/asset. Check pointer editing, keyboard style activation, reduced, off and restored snapshot. Switching Generate → Draw → Upload retains the well’s bounding height to 1 px.

3. Draw two strokes, undo once and clear. Compare surviving stored stroke points before and after undo. Test keyboard drawing and a delayed upload interrupted by switching mode. Capture the generated replacement and an immediate freehand stroke.

### Run these checks from the checkout root

```bash
pnpm exec playwright test --config tests/e2e/fidelity.playwright.config.ts tests/e2e/signing-fidelity.spec.ts
pnpm exec playwright test --config tests/e2e/pdf.playwright.config.ts tests/e2e/document-preview.spec.ts -g 'Generate styles|drawn and keyboard marks|pending canonical PNG'
```

### Evidence to retain

Deliver the one-mark replacement recording, 1 px well-stability measurement and passing identity, interruption and canonical-resource tests.

## 03. Relationship graph

### Observed behavior and target

The reference inserts history with attached paths, reveals a label on the new row, reports counts beside active work, and completes the affected feature branch. Video 03 already preserves node/edge continuity and uses simulated published graph states. Add the missing treatments inside this renderer.

### Files you may edit for this interface

- `apps/web/src/RelationshipGraph.tsx`
- `apps/web/src/relationship-graph.css`
- `packages/ui-catalog/workflow.ts`
- `scripts/review-pr.ts`
- `tests/task-interface.test.ts`
- `tests/e2e/graph-fidelity.spec.ts`

### Inspect before editing

- Read `useGraphGeometry`, `checkView`, `mergePulse`, `previousSummary`, `nodeTone`, and `graphPath`. Read `readMotionPolicy` and `observeMotionPolicy`. All graph coordinates share the sample written by `paint`.
- Read `scripts/review-pr.ts` `graphData` and `graphSpec` for author-supplied topology and simulated counts. `tests/e2e/graph-popovers.spec.ts` protects anchored evidence. The footer action remains the child supplied by the spec.

### Implement in order

- [ ] **1.** Extend `relationshipData` node in `workflow.ts` with an optional strict `progress` discriminated union. Indeterminate is exactly `{mode:'indeterminate',label:string}`. Determinate is exactly `{mode:'determinate',label:string,completed:number,total:number}`. Label is nonempty with maximum 200 characters. Require finite integers, completed ≥ 0, total > 0 and completed ≤ total. Apply the object-level refinement after forming the strict union. Reject extra keys. Omission preserves all old literals and bindings. Add positive and negative `safeParse` cases to the owned Vitest file.

- [ ] **2.** Modify only `graphData` in the review fixture: in resolving phase with a resolution node and a reported completed count, set `resolution.progress={mode:'determinate',label:'Tests',completed,total:42}` on that node; the source fixture already uses 42 as its total. For the resolving phase before that node exists, attach `{mode:'indeterminate',label:'Resolving conflicts'}` to the existing merge endpoint. Preserve the fixture’s supplied summary and the other phases. Record these as synthetic publications; production counts come only from the typed record.

- [ ] **3.** Render progress as an inline tabular count next to its own node label and a 2 px underline inside its own content cell. For determinate show `{label} · {completed}/{total}` and set the fill fraction to completed/total in the same commit. Expose a semantic span with role=progressbar with its actual integer min/max/now and source label; use a single accessible description of the count. For indeterminate display the supplied label and static running mark with no numeric ARIA value or percent. Keep fixed-height graph rows, physical dot/edge centers and text truncation. In compact schematic points, retain the dot geometry and put full progress in the anchored node detail. Footer remains bound to the supplied summary. Inspection selection never determines a global progress count.

- [ ] **4.** Replace the local OS-only listener in `useGraphGeometry` with `readMotionPolicy()` at start and `observeMotionPolicy` during the operative transition. On reduced/off or document hide, execute its existing finish routine once, paint the exact final target and zero velocities. Preserve retargeting from current samples and the 900 ms safety cutoff. Release the subscription on completion, early return, new target and unmount. Never animate an outer row, graph path or dot on a second position clock.

- [ ] **5.** Limit horizontal schematic height to actual rows of geometry. After calculating positions and label centers, take the maximum of the last node center plus its rendered outward label/marker extent and last branch label bottom, then add a 24 px bottom allowance. Use existing lane/column wrap coordinates and row measures. Cache observed extents on element/font/width changes; do not measure layout in the per-frame spring. Preserve vertically stacked 390 px wrapping and the non-schematic vertical log. Retain short hashes on commit rows and leave full excerpts in inspection.

- [ ] **6.** Track seen node IDs within the mounted graph owner, initialized from its first valid accepted snapshot. On each later source publication, reveal only the inner `.task-node-title` of a previously unseen ID with a nonempty human-readable label, duration 180 ms, softness 2 px → 0, opacity .75 → 1. Never substitute letters. Changes to status, revision, label of an existing ID, short hash or tooltip only update text. Restoration and first publication mark IDs seen without a second inner entrance. Do not detach prior rows. A geometry insertion and title reveal own different elements/properties.

- [ ] **7.** Replace unbounded check delays with 0, 30, 70, 100 ms for distinct newly inserted checks, all later checks sharing 100 ms. Each check opacity .75 → 1 for 140 ms, thus ≤240 ms overall. Baseline the initial snapshot. Use check label plus occurrence ordinal within that label as identity (the schema permits repeated labels); if duplicate labels reorder ambiguously, commit them immediately. Existing checks update status without replay. Keep usable action controls outside the check animation; making unavailable/outgoing content inert is immediate.

- [ ] **8.** Build the pulse target from a real transition into merged. Seed newly merged nodes comparing previous and current status. Starting at each seed, follow incoming non-prospective edges backwards along its supplied feature lane or the connected incoming feature lane explicitly supplied by blue/purple node tone or a blue/purple branch label. Walk only edges connected to those seed(s), preserving directed continuity. Stop at a change to neutral/main/teal predecessors, an ambiguous fork of different candidate feature lanes, or a visited ID. Include the final edge from the feature lane into the accepted merge endpoint. For missing or ambiguous ownership pulse only the unambiguous changed node and confirmed summary. Do not select every purple node or trust branch names. Remove blanket blue-to-purple mapping on unrelated lanes. A color emphasis on dot/edge/summary uses 240 ms, with offsets 0/20/40/60 ms by distance capped at 60; total ≤300 ms. Never restart from a repeated merged snapshot. Full policy only. Off/reduced settle immediately and release timers/animations.

- [ ] **9.** Remove the default transform rise on a changed graph summary. Commit the new summary text immediately; use a single 160 ms opacity response for a changed nonmerged summary and the completion response for an accepted merge. Preserve conflict evidence, all declared action semantics, graph inspection/Escape and user-selected node ID.

### Verification scenarios

1. Add a browser case to the `network()` fixture. Capture the base row DOM handle, insert a resolution node at an unused ID with progress 1/42, then 42/42 and another unrelated row. Verify same base element, correct accessible values, unchanged footer unless supplied summary changes, only the new title receives a reveal. Toggle app reduced/off mid-insertion and check path endpoints coincide with node centers within 1 CSS px when settled.

2. Publish four checks and an actionable child. Click/focus as soon as the child is enabled; all check groups must complete within the specified adjusted timing without gating controls. Replay the snapshot twice and assert zero new-check or completion animations. Add an unrelated purple feature node/edge outside the seeded component. On merged publication its style and running animation count stay unchanged. Verify the source-identified feature branch and accepted merge endpoint are emphasized.

3. Exercise invalid/partial/omitted progress, two independently reporting nodes, indeterminate with no total, keyboard inspection, disabled app motion and narrow horizontal labels. Preserve the already-passing anchored-popover and vertical graph cases.

### Run these checks from the checkout root

```bash
pnpm exec vitest run tests/task-interface.test.ts
pnpm exec playwright test --config tests/e2e/fidelity.playwright.config.ts tests/e2e/graph-fidelity.spec.ts
pnpm exec playwright test --config tests/e2e/graph-popovers.playwright.config.ts
```

### Evidence to retain

Attach a labeled creation → progress → checks → merge sequence and the exact published progress fixture. Include geometric attachment and unaffected-branch assertions in the graph results.

## 04. Map and place selection

### Observed behavior and target

A distant pin currently triggers carousel travel, and expanding address details can move navigation below the result. Keep the exact selected point and card visibly connected while making frequent navigation immediate.

### Files you may edit for this interface

- `apps/web/src/MapView.tsx`
- `apps/web/src/map-view.css`
- `tests/e2e/map-theme.spec.ts`

### Inspect before editing

- `mapData` in `packages/ui-catalog/workflow.ts` supplies point ID, label, x/y, category, address, detail, routes and source. It has no structured walking-duration field. Inspect the supplied label/category/detail as authored. Read-only `scripts/review-fixtures.ts` `MAP_DATA` contains illustrative places.
- `MapView` owns `choose`, `selectionIntent`, `userScrolling`, `finishScroll`, `aligned`, theme state, keyed point buttons and the inert carousel cards. `frontend-fidelity.css` overrides inline carousel overflow; preserve conversation vertical scroll ownership. In map-view.css override only the inline carousel with .artifact[data-artifact-inline=true] .task-map .task-map-carousel {overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;overscroll-behavior-y:auto} so native horizontal swipe works. Keep scrollbar-width:none.

### Implement in order

- [ ] **1.** Create one shared metadata/control row immediately below the map and above the carousel detail. From left to right render selected category (fallback `Place`), `index + 1 / total` with tabular digits, Previous place, Next place. Keep title in the selected card, then `Place details` with the exact supplied address and detail. Carry any source-authored walking time in its existing field verbatim. Do not infer minutes from coordinates, text parsing or the presence of a walking route. Remove duplicated dot/count presentations. Place optional feedback action after the stable row without reparenting its control on selection.

- [ ] **2.** Set row gap 8 px and vertical margin 8 px. On narrow widths let the metadata wrap, keep the two navigator buttons together, and keep at least 44×44 px hit regions on coarse pointers. Keep paper/terrain/night controls, current signaled source, map viewport and SVG projection. Always position pin x/y and routes from valid supplied coordinates. Do not claim provider geolocation, arrival duration or live routing. Existing invalid-source handling must still suppress selection.

- [ ] **3.** Change `choose(next)` to accept an explicit origin `pin | previous | next | keyboard`. Selecting a pin commits the matching stateKey and aligns the carousel instantly, even for a distant index. Pointer Previous/Next alone requests native smooth scrolling to the adjacent card; wraparound from last→first or first→last aligns instantly to avoid sweeping across intermediate cards. Native swipes retain direct tracking via existing `userScrolling` handling. Keyboard on buttons and ArrowLeft/Right, Home/End in the focused carousel update the exact bounded/wrapped target instantly and suppress default competing page scroll. Restore, data updates, resized widths and theme changes never request smooth scrolling.

- [ ] **4.** Use a 120 ms local outline/color response on a pointer-selected pin. Reveal its label from at most 3 px below and opacity .8 → 1 over 160 ms. In the aligned card only the newly selected text uses 120 ms opacity .8 → 1. Keyboard, restore, reduced/off and swipe tracking update synchronously without travel or decoration. During an active native programmatic scroll, a new pin click, manual user scroll or effective motion-policy change cancels old movement and applies the latest selection. Resize observer realigns only on genuine width change.

- [ ] **5.** Remove the unconditional route-entry animation on `.task-map-route`. Baseline initial route IDs/ordered point-pair keys per artifact. For a newly supplied adjacent pair in an accepted route draw a single 180 ms accent over just that segment using the existing route stroke. For a whole new route ID animate its new segments simultaneously as one group. Duplicate, restored, coordinate-only, removed or reordered preexisting point-pairs commit with no reveal. Keep the persistent complete polyline as factual geometry. New segments must not relocate the viewport. No full map theme/route redraw effects.

### Verification scenarios

1. Use the existing `taskFixture`/`serveTaskFixture` pattern. Supply four distinct points with IDs and normalized coordinates plus one walking route. Click the farthest pin; in the layout commit assert the selected region is that card, `scrollLeft ≈ index × clientWidth` within 1 px, and no smooth intermediate card traversed. Check a manual swipe and pointer Next, keyboard Enter on Previous, keyboard End/Home and resized width. Save selected pin coordinates and popup focus before/after.

2. Capture the metadata row and both navigation buttons’ coordinates. Expand Place details on a long address and assert the navigator remains within 1 CSS px. With three identical snapshots and a theme change, check existing route animation start count stays zero. Append exactly one source segment; count one local reveal under full and none under reduced/off. Removing the selected point uses the renderer's valid fallback ID.

3. With one valid remaining point, show that selected card, count 1 / 1, no actionable Previous/Next and no movement. With zero or invalid points render the existing unavailable message and no navigation. Disable Previous/Next when points.length === 1. Preserve explicit saved map style through shell theme changes, feedback payload ownership, and disabled feedback while pending.

### Run these checks from the checkout root

```bash
pnpm exec playwright test --config playwright.config.ts tests/e2e/map-theme.spec.ts
pnpm exec vitest run tests/task-interface.test.ts
pnpm exec playwright test --config tests/e2e/task-interface.playwright.config.ts tests/e2e/task-interface.spec.ts -g map
pnpm exec playwright test --config tests/e2e/micro-motion.playwright.config.ts tests/e2e/shared-smoothness.spec.ts -g "restored map selection"
```

### Evidence to retain

Provide a pin-to-card capture, an adjacent navigation capture, and before/after button coordinates for expanding place details.

## 09. Image comparison

### Observed behavior and target

Video 09 keeps an overlay-sized stage and a disabled percentage control in split mode. With its 960×600 pair and 720 px inner width, the natural side-by-side height is 225 px. Both images must remain complete and undistorted.

### Files you may edit for this interface

- `apps/web/src/ImageCompare.tsx`
- `apps/web/src/image-compare.css`
- `packages/ui-catalog/image-compare.ts`
- `tests/e2e/image-compare.spec.ts`

### Inspect before editing

- `ImageCompare` validates grants, computes the pair identity and holds `readView`. `ImagePair` owns `applyGeometry`, `sizes`, the divider drag, grant-bound image nodes and retry. Inspect the existing tests for denied replacement, different sizes, lost pointer capture and restored comparison.
- Read `packages/ui-catalog/image-compare.ts` for supported props, `apps/web/src/motion-policy.ts` and `motion-spring.ts` for current subscriptions. Upgrade only the local geometry owner in ImagePair.

### Implement in order

- [ ] **1.** After both images decode, compute intrinsic ratios `r0=w0/h0` and `r1=w1/h1`. For available inner width W use `Hoverlay=min(cap,max(W/r0,W/r1))` and `Hsplit=min(cap,max(W/(2*r0),W/(2*r1)))`. Use `cap=min(540px,70dvh)` in each mode. Use equal half-width panes with no layout gap, so the exact fixture expectation is 225 px for W=720. Retain `object-fit:contain` and the existing different-size note. Where aspects differ, the shorter image is centered; do not crop or distort either image.

- [ ] **2.** Retain a 200 px minimum only for loading/error placeholders. Remove the loaded 200 px minimum including the ≤520 px rule and the unconditional 1.6 aspect ratio when the pair is ready. Keep before/after labels outside moving image wrappers as stable text. Only overlay renders the comparison-position row. In overlay loading/error the range remains disabled. In split mode omit its entire row and hide the divider from hit-testing and visibility. Preserve mode selector labels, current grant handling and unavailable copy.

- [ ] **3.** Use one local 220 ms eased mode transfer. Commit destination mode, control availability and ARIA immediately. Sample current shares/left/clip and current stage height before switching. Animate from those values to overlay `(pane width=100%,after left=0, before clip-right=100-percent)` or split `(50%,50%,0)` plus the destination stage height. Drive the properties from one normalized animation progress using the move curve `cubic-bezier(.4,0,.2,1)`. Evaluate via a single local animation clock, with no independent CSS height tween and no second spring. Use one read phase per switch/resize and cached dimensions through the animation. A second mode command samples the in-flight state and retargets. Leave `object-fit:contain` active at every frame. Final styles must equal the measured target.

- [ ] **4.** Honor pointer, keyboard and source identity explicitly. Pointer mode changes animate under full policy. Mode changes by keyboard, restoration, preferred reduced/off, size change during an active transfer, or document hidden immediately settle to the latest target, releasing frame handles/subscriptions. The range and captured divider always use actual pointer or keyboard percentage in the current frame; if an overlay drag starts during a mode transfer, settle geometry before interpreting coordinates. Honor primary pointer ID, capture loss and cancellation.

- [ ] **5.** Keep percent across mode changes of the same authorized pair. Document and write the extended state as {percent:number,mode:"overlay"|"split",pairKey?:string}. pairKey is the lowercase SHA-256 hex digest of the UTF-8 bytes of the existing JSON.stringify(grants.map(g => [g.id,g.threadId,g.path,g.identity ?? null])) comparison key. Compute the digest outside render on grant-key change and retain its result only for that same key. During this asynchronous digest show an unbound legacy record immediately for the initial owner, or show the 50/overlay default for a bound record until it matches. If a user changes view before the digest resolves, keep the latest change in owner-scoped memory and persist with the digest on resolution. Clear a pending write on owner change. On digest failure keep local interaction usable, do not persist new unbound data and do not reuse a possibly mismatched bound record. Update the saved-state description in packages/ui-catalog/image-compare.ts. This field contains no raw path, and never grants media access. For backward compatibility accept legacy `{percent,mode}` for the currently authorized pair on first load; bind it to that pair on the next real user view change. Within a mounted artifact, invalidate a legacy unbound view on a changed pair and use 50/overlay. A bound view from another pair uses 50/overlay immediately; write pair ownership only through the existing safe state path. If the grant vanishes or changes, clear old decoded pixels immediately. A new authorized image pair becomes visible only when both loads succeed. Retry, remount and grant changes invalidate all old animation/decode callbacks. Use a direct ready commit without an extra crossfade.

### Verification scenarios

1. Extend the existing PNG fixture in the owned browser spec to accept exact 960×600 pair dimensions. In a 720 px inner stage, record both loaded img handles. Switch to Side by side and assert stage height 225±1 px, no slider or divider in the accessibility tree, both image handles identical and no additional image fetch. At other widths assert the formula from measured W, viewport and natural ratios. With unequal source sizes assert both images are visible and undistorted.

2. Switch to split, reverse to overlay during the transfer, and start a drag. Assert no jump back to the first start rectangle, range updates with actual input and no lingering clock. Replay with reduced/off, keyboard mode activation and policy changes halfway through. Verify stored percent on return to overlay for the same pair. Bound records and legacy unbound records from another in-session pair cannot inherit its view.

3. Revoke one grant during the transfer, then hold a replacement image or return an error. Assert zero old visible pixels, existing status/errors, one retry path and no late prior response. Keep the existing saved state, narrow viewport and pointer-capture tests.

### Run these checks from the checkout root

```bash
pnpm exec playwright test --config tests/e2e/smooth-pdf.playwright.config.ts tests/e2e/image-compare.spec.ts
```

### Evidence to retain

Attach both settled modes at equal width, the measured W/H/ratios, the reversal trace, and the grant-replacement check. Capture both source images with their original labels.

## 25. Document editor

### Observed behavior and target

In video 25 the delivery handoff opens at about 3.4 s and floats around 6.7 s. The draft survives, but the placement switch is abrupt. Preserve actual editing continuity while giving a deliberate dock/float command a short position transition.

### Files you may edit for this interface

- `apps/web/src/DocumentWindow.tsx`
- `apps/web/src/document-window.css`
- `tests/e2e/document-window.spec.ts`

### Inspect before editing

- Read `WindowDocument`, `portalRoot`, `place`, `move`, `close`, `sourceHash`, `saveDraft`, `rememberView` and the existing dock/float button. The editable element is `textarea.document-text-editor` in the owning artifact’s portal.
- `scripts/task-design-scenes.ts` authors the delivery document. A supplied `linkLabel` wins. In your private capture fixture, set the sample link label to `Edit handoff` and update the recording locator to match it. Preserve authored alternate labels in ordinary fixtures and existing callers.

### Implement in order

- [ ] **1.** Build one compact launcher row containing the supplied title, a draft indicator only when a valid local draft belongs to this source, and its button. Display the owning `scope.saveStatus` when supplied, otherwise `Draft retained locally` only when a real local draft exists. Default editable launcher copy to `Edit document` and read-only copy to `Open document`. A nonempty authored `linkLabel` takes precedence. Keep source details as their existing following sibling in the task composition. Do not create another source drawer or additional persistent state.

- [ ] **2.** Retain an 8 px launcher gap, natural wrapping of title, and a stable 36 px minimum button (44 px on coarse pointers). Keep the current 380 px desktop dock up to 1799 px. At ≥1800 px set desktop dock width to 420 px, change its matching workarea padding from 400 to 440 px, the floating rail right offset from 412 to 452 px, and the combined plan/dock padding from 800 to 840 px. Scope these desktop values to the web docked window, preserving the existing native-owner geometry. Preserve ≤1100 px dock overlay and ≤700 px viewport-bounded full-width rules. Keep floating width 440 px and height `min(640px, calc(100dvh - 110px))` above the mobile breakpoint. Do not add resize handles.

- [ ] **3.** Implement pointer-only position transfer within `WindowDocument`. Before the toolbar Float/Dock action, read the visible shell DOMRect including any active translation. Cancel old placement effect immediately after reading. Remember the old origin in a ref tied to this owner, commit existing `place(next)` and final dimensions, then in a layout effect after placement read the resting destination rect. Animate transform `translate(old.left-new.left, old.top-new.top)` → `translate(0,0)` for 220 ms using `--ui-ease-move`. Never temporally scale the text or animate width/height. Change opening animation to translate/opacity only, removing its current scale(.99). Commit actual workspace reservation once.

- [ ] **4.** Skip placement animation for native owner, keyboard activation, programmatic restoration, width ≤700 px, reduced/off, or when the visible focused editing region would cross outside usable viewport during the displacement. While the textarea is the active element, compute its bounding rectangle in both the old and final position. If either rectangle crosses any viewport edge, snap directly. On pointer reactivation sample current visual origin and retarget. On typing, focus into textarea, drag start, resize, Escape, hidden owner, unmount or policy change, cancel to the final shell state. A direct drag only uses the existing `move` path with no delayed follower.

- [ ] **5.** Keep the same `createPortal` target, window DOM node and editor through dock/float. Capture textarea scrollTop and selection start/end/direction before final geometry changes, restoring only to the same connected editor if the browser changed them. Do not replace its value, call `saveDraft` during placement, or force focus away from the user’s selected control. Editing, select/copy, Escape, source-revocation and reopen keep current behavior. Never display a draft belonging to another source. New source content keeps the existing `New source available` affordance.

### Verification scenarios

1. Extend the existing `open(page)` fixture. Fill multiline text, save its selection range and scrollTop, retain handles to editor and shell, then click Float → Dock and reverse a second transition midway. Compare DOM identity, value, selection direction and scrollTop within 1 px. Assert at most one visible editor and no transform matrix scale components different from 1. Observe actual settled dock geometry at 1920 and 1440.

2. At 390 px under reduced motion toggle by keyboard, press Escape, assert focus on the original launcher, reopen, and check the retained exact draft and reading position. Start a pointer drag mid-transfer; the panel follows pointer and no previous animation snaps it back. Verify automatic resize and native-owner cases avoid the web position transition.

3. Publish newer source while editing; verify retained text and explicit adoption behavior. Remove a grant and assert stale content disappears. Repeat with a foreign draft, zero content, a long title and explicit authored Open handoff label.

### Run these checks from the checkout root

```bash
pnpm exec playwright test --config playwright.config.ts tests/e2e/document-window.spec.ts
```

### Evidence to retain

Provide one dock/float reversal capture, selector/scroll comparisons, wide/narrow geometry and unchanged handling of renewed source or revoked access.

## 27. Planning question

### Observed behavior and target

Video 27 removes the question at about 15.0 s and leaves no evidence of the chosen answer beside the composer. Give each accepted planning request a compact, readable receipt bound to the original thread and request.

### Files you may edit for this interface

- `apps/web/src/App.tsx`
- `apps/web/src/PlanningQuestion.tsx`
- `apps/web/src/planning-question.css`
- `tests/e2e/planning-ui.spec.ts`

### Inspect before editing

- Current checked revision: `App.tsx` `InputDecision` around line 148, active conversation change signature around 809, per-conversation filter around 1161 and rendering map around 1180. Locate by symbols to accommodate unrelated line shifts.
- `packages/contracts/index.ts` `InputRequest` stores `threadId`, `id`, `revision`, `title`, `prompt`, `status`, `response` and `presentation`. `packages/core/service.ts` `acceptRequest` validates and stores `status:'accepted',revision+1,response` plus original presentation, returning `{request:next,inputId}` inside the command receipt. `apps/web/src/journal.ts` is draft recovery only.

### Implement in order

- [ ] **1.** Define one local filter `visibleInputRequest(item,threadId)` in App.tsx and use it for BOTH the active conversation’s update-detection list and the per-thread content render. Use this exact predicate: `item.threadId===threadId && (item.status==='pending' || (item.status==='accepted' && !!item.presentation))`. Leave unrelated gate/attention and pending-work counts filtered to pending. Withdrawn and superseded records do not render receipts.

- [ ] **2.** Keep pending ordinary input requests unchanged. For a planning decision, use a stable outer key derived from threadId and requestId, and retain the current pending responseSchema-derived reset inside the editable form so incompatible schema changes drop conflicting local drafts. Record the submitted question/title and response in a transient in-memory owner-scoped ref/state only after `request.respond` returns successfully. Validate any result.request against the same request ID/thread and accepted response/revision before using it. Once command() resolves, record the submitted handoff before running journalCompareAndSwap or refresh; treat later journal/refresh failures as post-acknowledgment errors and disable repeated submission. When the command acknowledges before the snapshot, render `Submitted` with the exact submitted value in place of the pending body and disable duplicate submit. When the snapshot contains accepted status, render the authoritative receipt and discard the handoff. A refresh failure after acknowledged submission retains Submitted plus an inline refresh-status action that calls only `refresh()`; never submit again to recover. Capture a monotonically increasing owner generation plus threadId, id and pending revision at submission. Recheck before every async state write. Discard late replies after owner change, unmount, withdrawal or supersession. Clear transient state on those transitions. If Continue or another question control held focus when that body became inert, focus the new receipt heading with tabIndex=-1 and preventScroll:true; do not steal focus already moved outside the question. Mount/restoration goes directly to the authoritative view.

- [ ] **3.** Render a compact semantic component `PlanningAnswerReceipt` in PlanningQuestion.tsx. Props: `title:string`, `prompt:string`, `answer:string | null`, `state:'submitted'|'accepted'`. Heading uses the request title. Show a distinct nonempty prompt below it if different after trimming; use the existing Markdown component for the prompt only. For a known option ID show its source label as the answer; for custom/unknown string show the exact submitted text using plain text with `white-space:pre-wrap`. Empty/malformed authoritative response uses `Response unavailable`. Accepted state text is `Answer accepted`; interim text is `Submitted`. Nothing here emits run-finished, operation approval or delivery claims. Keep existing permission boundaries for examples and resources.

- [ ] **4.** Use 12 px padding, 8 px inline gap, 4 px text-stack gap and a 14 px state mark. Do not set fixed height or clamp custom answers. Aim for 64–88 px for a short answer and title. Use the inherited task font and a single subtle border. Place a persistent neutral status icon on restored accepted requests. Only a matching transition from pending/Submitted into confirmed accepted uses the 90 ms check/160 ms status response, action immediately final. Make one polite announcement for the transition, with a status span for the changed state; do not announce the entire historical answer on each render.

- [ ] **5.** Transition the pending form into the receipt inside the same owner. Keep incoming receipt accessible immediately; make old controls inert in that commit. Use a single shared MotionRegion for the collapsing outgoing form, with a sibling receipt already visible. On keyboard/reduced/off replace it immediately. Unmount the obsolete inert form after closure; its fields cannot be tabbed or submitted a second time. Use the existing `MotionRegion` for explanation/example details, with direct keyboard expansion, no repeated paragraph entry and a 120 ms check/color response only on a new pointer choice. Custom input focuses on mount (use the callback ref and preventScroll). Preserve IME and single-flight command handling. A rejected response shows the existing editable form and keeps its draft. Preserve schema validation, withdraw and detail-request semantics.

### Verification scenarios

1. Use `question(snapshot)` and the existing Focused repair fixture. Check `Focused repair`, submit, hold the next refresh, acknowledge once and observe Submitted. Publish the same request ID, status accepted, revision incremented and response `focused`. Expect its exact question, `Focused repair` and `Answer accepted`, no enabled Continue/Withdraw, and exactly one request.respond command. Reload and switch threads in both directions. Each visible receipt comes from that thread’s accepted record.

2. Simulate two planning questions in one thread plus another thread, an accepted ordinary nonplanning input, a withdrawn and a superseded request. No duplicate form/receipt, no receipt for other thread or nonplanning records. An accepted custom multiline answer remains exact across reload. Exercise accepted with unknown option string and accepted with missing response; preserve the string or show the fallback respectively.

3. Test command rejection and uncertain refresh separately. Rejection leaves the original editable choice/errors. Acknowledgment followed by refresh failure has one Submitted handoff and Refresh status invokes no extra respond. Repeated accepted snapshots do not replay success. IME composition Enter sends no command; after completion a single explicit submit sends once. At 390×844 long text wraps and keyboard focus remains visible.

### Run these checks from the checkout root

```bash
pnpm exec playwright test --config tests/e2e/floating.playwright.config.ts tests/e2e/planning-ui.spec.ts
```

### Evidence to retain

Attach pending → Submitted → Answer accepted frames, an accepted reload, the synthetic command count, and failed-submission evidence. The receipt’s persisted authority is InputRequest itself.

## Make the model choose a task-specific working surface

Preserve the three existing time, review and investigation example pairs. Add exactly three examples for editing a document, choosing a delivery preference and annotating an image.

### Files you may edit for composition

- `packages/ui-catalog/composition-examples.ts`
- `packages/runtime-pi/presentation-policy.ts`
- `tests/task-composition.test.ts`

### Implementation and tests

1. Read COMPOSITION_EXAMPLES, discoverCapabilities in packages/core/discovery.ts, the strict catalog schemas, PRESENTATION_POLICY, tests/task-composition.test.ts and tests/copy-clarity.test.ts. Existing discovery filters by requested mechanics and returns at most two examples. Preserve ordering of existing examples, compact-index behavior, offset pagination, and the 12,000-byte presentation-policy ceiling checked by the test.
2. Append three CompositionExample objects after document-signing in exactly the following order. Use the existing node() helper. Copy every key and value from the table. 'children' below is an ordered list of element IDs, outside props.
 
   | ID and purpose | Root and elements | components |
   | --- | --- | --- |
   | document-edit · “Edit the supplied handoff text in place and keep its draft attached to the source.” | root handoff. handoff = Document with dataBinding handoffText, editableStateKey handoffDraft, presentation window, title Handoff, linkLabel Edit handoff. | Document |
   | preferences-single · “Collect one delivery preference and note in the same decision, with one explicit submission.” | root prefs. prefs = Form with actionId submitPreference, submitLabel Submit preference, payloadFromState mapping method to method and note to note, children method,note. method = Select with stateKey method, label Delivery, options with label In conversation and value chat, label Download and value download. note = Input with stateKey note, label Review note, inputType textarea. | Form, Select, Input |
   | image-feedback · “Attach feedback to points on the supplied image and keep each note with its source pin.” | root pins. pins = ImageAnnotator with resourceId source-image-grant, alt Delivery screen, stateKey imageNotes, actionId sendFeedback, actionLabel Send feedback. | ImageAnnotator |

3. In the Visual grammar paragraph of PRESENTATION_POLICY replace the sentence beginning “Keep explanation in conversation” with “Keep decision-critical identity such as a short commit hash beside its object. Put secondary identifiers, full logs and supporting evidence in inspection.” In the discovery paragraph append “Use a single column for one decision. Add a second column only for two useful peers. Size a source preview from its own content and move current-state copy forward when the object advances.” These instructions apply to composition. Keep grants, state-key stability, native permission handling, progressive discovery and held-out prompt separation intact.
4. In task-composition.test.ts add a named test for each pair below. Validate all three additions with validateSurface, assert exact root types and state keys, and compare their actual ordered element types. For the document pair, edit uses one Document with editableStateKey and signing includes DocumentPreview and SignaturePad. For preferences versus comparison, preferences contains one Form with one submit action and no Grid, while kit-comparison contains Comparison. For feedback versus export, feedback uses the single image annotation object and export contains the original Image and ParameterControls pair in one Split. Validate each new component name against CAPABILITIES.
5. Exercise discoverCapabilities with exact details queries for Document, Select and ImageAnnotator and verify the new matching example appears within the existing two-entry bound. Verify its absence on cheap index requests and when the corresponding requested page contains no matching component. Keep current tests for SchedulePicker (two results). Existing example placeholders are examples only. No production task keyword classifier, new schema, permission, or global preference is required.
6. Run these targeted commands. Verify the policy-size assertion and record the three discovery example IDs in your results.

```bash
pnpm exec vitest run tests/task-composition.test.ts tests/copy-clarity.test.ts tests/proactive-presentation.test.ts
pnpm typecheck
pnpm lint
```

Pass when all three new arrangements validate, the old search/index guarantees pass, and one request for a single decision returns a usable one-column example. Measure actual model output using the live trials included below.

## Verify that real requests generate different working interfaces

Run the 12 cases in the following table first with their primary wording, then with their second wording, in table order. Use 24 fresh threads in one disposable project, two messages per thread. This is a separate test from the repository's `pnpm eval`, which exercises a different set of prompts. Keep the table and expected answers out of production prompts, examples and routing code.

1. Use your own clean worktree at the commit under test and a new external evidence directory for each attempt. Save the full commit, date, browser version, model ID and an exact copy of the case table there. On the supported host, launch `pnpm dev` in a separate shell and wait for its frontend (default `http://127.0.0.1:5173`) and backend (default `http://127.0.0.1:4317`). Confirm its actual HTTP loopback origin and that the selected provider/model is available in the picker. Use the configured account. Keep credentials and session cookies out of deliverables. If live model access is unavailable, mark the live result **Pending**, name the missing prerequisite, and finish your fixture recordings, implementation tests and branch handoff independently.
2. Run `mkdir -p "$EVIDENCE/live"` and `export UI_PNG="$EVIDENCE/live/source-image.png"`. From the repository root run `pnpm fixtures:create "$EVIDENCE/live/fixtures"`, with the destination set to a new child of your evidence directory. Grant its actual `editable.pdf` read-only to D2. Create one original 960 × 600 PNG for both G1 and G2. Run the following from the repository root using the Chromium installation used by its Playwright tests. Set `UI_PNG` to the new absolute output filename before running the JavaScript with `node --input-type=module`. Use the same PNG bytes as a read-only file grant in all four image trials. Record SHA-256 of both files. Other cases receive only their specified text.

```js
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#18202b;color:white;font:20px Arial,sans-serif}header,button{position:absolute;padding:12px 20px}header{inset:24px 24px auto;background:#293747}button{right:48px;bottom:45px;width:176px;height:60px;background:#45678a;color:white;border:0;font:inherit}</style><header>Delivery preview</header><button>Review export</button>`);
  await writeFile(process.env.UI_PNG, await page.screenshot({ type: "png" }), { flag: "wx" });
} finally {
  await browser.close();
}
```

3. In the actual composer send the case dataset, one newline, then the exact initial wording. Use the matching source group, excluding its evaluator instructions. In both P1 trials use the exact display name `Studio · monthly review by the accessibility and localization groups` in the dataset. Retain the same option ID throughout. The continuation’s “Studio” refers to that same option. Keep the two quoted user messages verbatim. In I2 leave unknown timings absent. Apply no other schedule fixture mutations to these trials. Grant the generated files through the normal host flow before the initial send in the relevant threads. Keep the first grant bound throughout its thread.
4. Before each send, save the same thread's sequence, assistant message IDs, artifact IDs and relevant data revisions using the authenticated `GET /api/threads/{threadId}/snapshot` contract in `evals/runner.ts`. After each send, require a later sequence, a new assistant message ID in that thread, the selected model ID, a populated session path and the case-specific observable result. Save a viewport screenshot and snapshot after the first result, after the specified control interaction is accepted, and after the continuation. Send the continuation in the same thread even if the requested first control is missing, recording that failure. After 120 seconds without a settled outcome, stop only that trial's active run and mark unavailable evidence Pending. Judge model-produced text without the required working object as Fail.
5. Use the exact action, values and outcome in each table row. For D2, verify the review note in the review artifact and the name and visual mark on the original granted form. No signature or note field exists in the fixture PDF. For G1, place the first pin at the button center (image point 824,525). If the continuation opens a placement control, place the second at image point 96,60. A generated second pin is acceptable anywhere in the top-left quadrant. Verify distinct pin IDs, the unchanged first normalized position (tolerance one source pixel per axis), its exact note, and the same image grant. For D1 retain the typed draft, for R1 retain the note on passage B, and for P1 verify the same selected option after its price changes.
6. Write one row per trial with thread, model, artifact identity, revisions, five individual Pass/Fail/Pending results and relative evidence filenames. Score (1) requested task object leads and its first control works, (2) source values, units and unknowns are accurate, (3) the content has no duplicate task heading or empty peer panel, (4) the prescribed action changes the intended source-linked object, and (5) the continuation updates the same artifact ID and retains the applicable accepted user input. Give the observed value or state for each judgment. Add six comparisons (T, R, I, D, P, G) identifying the two cases' actual primary controls and how each serves its distinct task. A live pass requires all 24 complete passes and all six distinct task comparisons. Keep earlier attempts if rerunning on a corrected commit.

## Synthetic datasets for the live trials

**Schedule/visit (T1,T2).** “All times are America/Los_Angeles, February 4, 2027. Fern Studio, 40 Pine St, opens 09:00, closes 12:00. Fig Studio, 48 Pine St, opens 10:00, closes 14:00. The schematic positions are Fern (20,30), Fig (70,50) in a 100 by 100 frame. Walking between them takes 8 minutes. Offered meetings are 09:00–09:30 at Fern, 10:15–11:45 at Fig, and 11:00–11:30 at Fern. Nothing is booked.”

**Review (R1,R2).** “Draft A: ‘A failed payment deletes the cart.’ Draft B: ‘A failed payment keeps items in the cart.’ Product requirement: a failed payment keeps all cart items. The proposed patch in cart.ts changes if (failed) clearCart(); to if (succeeded) clearCart();. checkout.test.ts adds expect(cart.items).toHaveLength(2) after a failed charge. This is a proposed patch. Tests have not run.”

**Investigation (I1,I2).** “Checkout quantity assertion failed: quantity.test.ts:12, price 3, quantity 4, expected 12, actual 3. The empty-cart test passed, expected 0 and actual 0. Supplied request trace in milliseconds: checkout starts at 0 and lasts 220; parse starts at 10 and lasts 25; store starts at 50 and lasts 160; adapter has no timing data. Two measured response-time samples are 180 ms and 220 ms.”

**Document (D1,D2).** “Handoff text: ‘Review the service agreement. The renewal notice is 30 days.’ The proposed replacement is ‘Review the service agreement. The renewal notice is 45 days.’ The separate granted form contains fullName, consent and role fields. No file has been signed, exported or delivered.” Grant the real disposable editable.pdf to D2 only. D1 receives the supplied text directly.

**Decisions (P1,P2).** “Basic costs 8 dollars per month and includes 5 exports. Studio costs 16 dollars per month and includes 20 exports. Both include PNG. The team expects 12 exports per month. Delivery preferences are In conversation or Download. An optional review note is supported.”

**Image (G1,G2).** “The supplied image is an original 960 × 600 screenshot, with a button near the lower right. Available export proposal controls are width 640–1920 in 160 px steps, current 960, and quality 50–100 in steps of 5, current 85. No processed export has been generated.” Attach the same original PNG from step 2 above to both cases.

## Trials

| ID | Primary wording | Second wording | First control interaction and retained evidence | Exact continuation | Pass evidence |
| --- | --- | --- | --- | --- | --- |
| T1 | Help me choose one offered meeting time. | Put the available appointment windows in front of me so I can pick one. | Select the 10:15 Fig interval. Retain 90-minute duration and timezone. | The 09:00 slot has been withdrawn. Update my choices. | Time selection leads, remaining 10:15 choice is intact, 09:00 is unavailable or removed, no booking claim or unnecessary map. |
| T2 | Plan a visit to both studios around these windows. | Help me match a studio stop to a meeting while visiting both locations. | Select Fig, inspect its location and the 10:15 interval. | Fig now closes at 12:30. Update the visit. | Selected place and offered time each remain discoverable. Source-based location and schedule are related. Fig hours update, walking time stays 8 minutes, no invented route or booking. |
| R1 | Help me review the wording of these two statements. | Put the copy in a form where I can decide which wording to keep. | Attach “Matches requirement” to B, choose B. | The approved term is “basket” instead of “cart”. Update the wording under review. | Actual passages and related decisions shown. B's stable identity and local note survive. No testing or code action appears as the primary task. |
| R2 | Review the proposed code change and its test alongside the requirement. | Let me inspect the patch that keeps items after a failed charge. | Inspect cart.ts and then the test change. Enter the review note “Check failed charge.” | A reviewer also requests coverage of an empty basket. Add that requirement to this review. | Actual code diff and test intent visible, note retained, added requirement clearly pending, tests remain unrun. |
| I1 | Diagnose the failing quantity test and show the failing evidence. | Which assertion broke, and what was the mismatch? Give me an inspectable view. | Select quantity.test.ts and inspect 12 versus 3. | The source now reports the empty-cart test as not run. Update the check list. | Failure dominates, source location and mismatch are exact, selected failure stays in place, unrelated state becomes not run. |
| I2 | Show what explains the slow checkout request. | Help me inspect where the 220 milliseconds went. | Inspect store and its 160 ms span. | The source reports a new request total of 240 ms and a store duration of 180 ms. Update the trace. | Duration geometry and units agree, adapter remains unknown, selected span retains identity, no suggestion a diagnostic test ran. |
| D1 | Let me edit the handoff wording. | Open the handoff as an editable draft so I can revise the renewal notice. | Type “Review with Mia” at the end. Record caret and draft. | The source owner proposes 45 days. Keep my draft available while showing that source change. | Editable text is primary. Local edit remains available. Source and draft remain distinguishable through continuation. |
| D2 | Prepare this granted form for a visual signature. | Put the disposable PDF and the signing controls together for review. | Fill fullName with “Alex Morgan” and create the visual mark. | Change the review note to “awaiting review” and keep my filled name and mark. | Real granted PDF and signing work are connected, name and mark survive, request remains preparation. |
| P1 | Compare the two plans against our 12-export requirement. | Show which plan fits our monthly exports and what we would pay. | Select Studio and inspect the shared format criterion. | Studio now costs 18 dollars a month. Update the comparison. | Side-by-side criteria/amounts retain exact units, Studio selection persists at new price, Basic still has 5 exports. |
| P2 | Let me set a delivery preference and review note. | Give me the smallest useful form for choosing delivery and leaving a note. | Select Download, type “Check the draft”. | Add “Send for review” as an available delivery choice. | Content-sized choices, one relevant submission action, selected Download and typed note survive new option. |
| G1 | Let me mark the lower-right button and attach feedback to it. | I need to pin a review note on the supplied screenshot. | Pin the button and type “Increase label spacing”. | Add a second review point near the top left and retain my first note. | Original image, normalized pin and note are retained. Require a distinct second pin in the top-left quadrant. If the model opens a point-placement control, use it in that quadrant, then verify two distinct pin IDs, the same grant, and the unchanged first coordinate and note. No invented replacement image. |
| G2 | Help me propose a new width and quality for this screenshot. | Show the original next to controls for preparing export settings. | Set width to 1600 and quality to 90. | The new allowed upper width is 1760. Update the proposal controls. | Same undistorted source, selected 1600/90 retained, only proposal changes, no processed/exported result claim. |

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

Record that SHA. Place all temporary recorder sources under its `scripts/` using the prefix `local-w1-`. Return the private recorder copies with the evidence in this project. Keep them untracked.

| Film | Recorder scene ID | Checked-in scene / subtree |
| --- | --- | --- |
| UI-01 | document-preview | document/pdf |
| UI-02 | signature-pad | document/mark |
| UI-03 | relationship-graph | pr-dark/root |
| UI-04 | map-view | time-visits/places |
| UI-09 | image-compare | image-work/comparison |
| UI-25 | document-editor | delivery/root |
| UI-27 | planning-question | host |

When the original archive is available, use the three TypeScript sources in `Gen-V1-UI-review/recording-scripts/` from the review ZIP. Map generative-review-scenes.ts, record-generative-review.ts and record-generative-adjacent.ts to `local-w1-scenes.ts`, `local-w1-catalog.ts` and `local-w1-host.ts`; fix the relative scenes import. The catalog’s archived recording begins after generation. In its private copy preserve `const initialArtifact=snapshot.artifacts[0]`, set `if (!stills) snapshot.artifacts=[]` before returning the fixture host and keep its existing `publishInitial` helper, wait for the composer textbox named `Message` and assert the page has zero `.artifact` elements, start `recordWindow`, wait 500 ms, then call `host.publishInitial()`. Move artifact, PDF, image, signature and scroll readiness checks after that call. For planning-question, withhold snapshot.requests until 500 ms after recordWindow starts, then restore and publish. For the host copy read OUTPUT from process.env.CAPTURE_OUT and set PORT to 6281; remove the legacy machine path, and stamp the measured git SHA in both manifests. [Original review ZIP](https://chatgpt.com/library?file_id=libfile_e853efaba1cc819188bc47299ccb1228&account_id=personal)

For a source-only session, copy the tracked `scripts/record-task-design.ts` to `scripts/local-w1-catalog.ts`. It already implements publication after capture starts, source-backed controls, PDF/PNG grants, fixture HTTP/SSE and a real Vite App. Replace fixed port 5465 throughout this private copy with 6211. Keep its browser setup, `installFixture`, resource routes and video stop/cleanup. In its scene list clone each mapped entry from `taskDesignScenes()`, set its ID to the recorder scene ID above, and copy only elements reachable recursively through each element’s children from its assigned root (root means scene.spec.root). Replace the full-catalog assertions with per-film checks for the assigned subject. Implement the ordered interactions from this prompt. Preserve fixture action handlers by testing the original source scene ID after the display ID changes. For document-editor keep only handoff and sources beneath delivery. Keep the checked-in synthetic PDF, paired PNG content routes and upload handler. For planning-question use the full-App request setup, command interception and response publications in tests/e2e/planning-ui.spec.ts. Remove the pending request from the first snapshot, restore it and call host.publish() after recording begins. In the source-only route copy the Vite/browser setup and capture loop into `scripts/local-w1-host.ts`, read `CAPTURE_OUT`, and serve the selected host scene at port 6281.

Before starting the video, put the insertion point in the visible conversation area. Observe the first nonempty published frame with an IntersectionObserver or a sampled DOMRect. Require it to intersect the viewport when its entrance begins. An offscreen entrance followed by an automatic scroll fails the opening. Scroll only for later chapters where the task requires it.

From the root of the disposable capture worktree, initialize a fresh capture directory after creating your private recorder files.

```bash
export CAPTURE_OUT
CAPTURE_OUT=$(mktemp -d "$EVIDENCE/capture.XXXXXX")
```

For both paths, record exactly 500 ms of the ready host before the first fixture publication. In the source-only path, change the tracked seed’s initial 900 ms hold in its private copy to 500 ms. For the host-scene command, read the output directory from `CAPTURE_OUT`. Use per-scene assertions and guard only optional data. An absent required control, empty clip or missing chapter must cause a failing exit. Discard the old minimum total-length padding in the archive and use the 900 ms hold after the actual final result. For a rapid reversal, use raw Playwright input as soon as the first effect is running, ahead of any reading dwell or chapter screenshot. Do not change product timing to make the recording easier.

Run these commands from that worktree. The archived catalog recorder accepts `--port`. In the source-only catalog recorder, replace the fixed server port and origin as directed above before launching.

```bash
pnpm exec tsx scripts/local-w1-catalog.ts --theme dark --port 6211 --scenes document-preview,signature-pad,relationship-graph,map-view,image-compare,document-editor --output "$CAPTURE_OUT/catalog"
pnpm exec tsx scripts/local-w1-host.ts --scene planning-question
```

For either recorder path, update the action sequence to include every implementation section’s film steps. Keep the 1920×1080, 30 fps, real-time compositor recording running through every required action and interruption. Log elapsed event times, wait for observable results, then hold the final stable state for 900 ms. Keep action timing independent of screenshot delays. Package the numbered names below after both the scene assertions and stream validation pass. Save any diagnostic takes separately. Log codec, size, duration, fps, SHA-256 and action timestamps. Decode each complete file with `ffmpeg -v error -i "$film" -f null -`. Inspect opening, changing and settled frames; reject empty or pre-settled openings, element clipping, wrong subject, or a missing action.

### Exact chapters and filenames

| Deliverable | Required action order after the opening |
| --- | --- |
| `01-document-preview.mp4` | Next page → previous page → Fit page → Focus Name. Show all field edges or the leading prefix for an over-wide field. Start a second reframe, interrupt with the wheel, and show that its scroll position holds. |
| `02-signature-pad.mp4` | Another style with real ink ready, switch to Draw, draw two distinct strokes, undo one. Reselect the generated style and verify prior data. |
| `03-relationship-graph.mp4` | Publish the preparing, checking and conflicted graph states. Inspect the conflict. Resolve, publish a partial count and then 42/42 for the same node. Show the four checks and enabled Merge. Publish accepted merge and repeat that snapshot. The affected branch settles once. |
| `04-map-view.mp4` | Select Fern & Fig, open details, use Next and Previous, restore the selected place. Show the matching pin and card together. |
| `09-image-compare.mp4` | Drag divider, select Side by side, reverse toward Overlay during transfer. Restore the saved compatible pair and position. |
| `25-document-editor.mp4` | Launch via the fixture-authored “Edit handoff”, edit the text, float, dock, close, reopen and show the same saved draft. Open the source bundle. |
| `27-planning-question.mp4` | Choose option, inspect explanation and example, add alternative, submit. Show accepted question/answer, reload, and verify same receipt. |

For the request in film 27, save the submitted response on the same request/thread with status accepted and the next revision. Return the fixture shape `{request: next, inputId}` used by `acceptRequest` and publish it. Reload and verify the same receipt. For film 25 set the source-authored link label to `Edit handoff` in the private recording fixture only.

### Produce the final numbered files

The recorder may emit an unnumbered filename or one ending in `-recording.mp4`. Run this from the verified capture worktree on a successful attempt. It reads each recorder's actual output manifest, copies only the 7 assigned files into a new directory for this attempt, decodes them and writes their metadata. Use that directory for the per-file links.

```bash
python3 - "$CAPTURE_OUT" <<'PYFILMS'
import hashlib, json, shutil, subprocess, sys
from fractions import Fraction
from pathlib import Path

root = Path(sys.argv[1]).resolve()
filenames = {
    "document-preview": "01-document-preview.mp4",
    "signature-pad": "02-signature-pad.mp4",
    "relationship-graph": "03-relationship-graph.mp4",
    "map-view": "04-map-view.mp4",
    "image-compare": "09-image-compare.mp4",
    "document-editor": "25-document-editor.mp4",
    "planning-question": "27-planning-question.mp4"
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
