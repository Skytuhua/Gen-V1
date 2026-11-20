<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1118 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: Worker-1 documents/graph/decisions — seven UIs (01 PDF preview, 02 signature pad, 03 relationship graph, 04 map/place, 09 image compare, 25 document editor, 27 planning question) + composition examples + 24 live trials + 7 MP4s.
- Repo: skytuhua-org/Gen-V1. Plan rev 1, 2026-11-20.
- Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified); pinned implementation base `26ddf4d16c2fc1196b520d8a46c5441d64d01463`.
- Branch: `refine/documents-graph-decisions` local HEAD ~`983aec64`+ (per checkpoint 007; T25 committed after — confirm `git rev-parse HEAD` in worker worktree).
- Status: **in progress** by `devin-web-31a5aa` (checkpoints 001–007). DONE+verified: T01 doc preview (5d7d7ea7), T02 signature (cd74080c), T03 graph (badf065f), T04 map (00365168), T09 image compare (983aec64), T25 document editor (committed after CP007). **This plan covers remaining scope only: UI-27, composition examples, live trials, MP4s, PR, merge.**
- Provenance: canonical assignment (issue body + PLAN 2/2 comment) + checkpoints 004–007.

### OBJECTIVE
Finish Worker-1 assignment: planning-question receipt, three composition examples, 24 live trials, seven review films, PR, merge. Success: canonical plan fully delivered; PR merged; verified-on-main.

### DESIGN — remaining scope, exact spec (zero implementer design decisions)

All layout, spacing, labels, states, code shape and data contracts below are verbatim from the canonical assignment; the implementer makes no design choices.

### REQUIREMENTS

#### T27 — Planning question receipt (files: `apps/web/src/App.tsx`, `PlanningQuestion.tsx`, `planning-question.css`, `tests/e2e/planning-ui.spec.ts`)
1. One local filter in App.tsx used for BOTH the update-detection list AND the per-thread render: `visibleInputRequest(item,threadId) => item.threadId===threadId && (item.status==='pending' || (item.status==='accepted' && !!item.presentation))`. Gate/attention and pending-work counts stay filtered to pending only; withdrawn/superseded render nothing.
2. Pending ordinary input requests unchanged. Stable outer key from threadId+requestId; keep the pending responseSchema-derived reset so schema changes drop conflicting drafts. Record submitted title/response in a transient owner-scoped in-memory ref ONLY after `request.respond` resolves; validate `result.request` against same request id/thread + accepted status + incremented revision. Order: after `command()` resolves → record handoff → then `journalCompareAndSwap`/refresh; later refresh failure is post-acknowledgment error — no re-submit. Pre-snapshot acknowledged state renders `Submitted` + exact submitted value, duplicate submit disabled; snapshot with accepted status renders authoritative receipt and discards handoff. Refresh failure after ack keeps `Submitted` + inline refresh-status action calling only `refresh()`. Capture monotonic owner generation + threadId + id + pending revision at submit; recheck before every async write; discard late replies on owner change/unmount/withdraw/supersede; clear transient state on those transitions. If Continue/another control held focus when the body went inert → focus new receipt heading `tabIndex=-1 preventScroll:true`; never steal focus moved elsewhere. Mount/restore goes straight to authoritative view.
3. `PlanningAnswerReceipt` in PlanningQuestion.tsx — props `{title:string, prompt:string, answer:string|null, state:'submitted'|'accepted'}`. Heading = request title; show nonempty trimmed prompt below if it differs, using existing Markdown component (prompt only). Known option id → its source label; custom/unknown string → exact submitted text, plain text `white-space:pre-wrap`; empty/malformed authoritative response → `Response unavailable`. State text: `Answer accepted` / `Submitted`. No run-finished/approval/delivery claims.
4. Exact styling: 12px padding, 8px inline gap, 4px text-stack gap, 14px state mark; no fixed height, no clamp on custom answers; ~64–88px target for short answer+title; inherited task font; single subtle border; persistent neutral status icon on restored accepted requests. Only pending/Submitted→accepted transition gets the 90ms check + 160ms status response (action immediately final); one polite announcement via status span — never announce the whole historical answer each render.
5. Transition: pending form collapses inside same owner via single shared MotionRegion with sibling receipt already visible; keyboard/reduced/off = immediate replace; unmount inert form after closure (untabbable, unsubmittable). Existing MotionRegion for explanation/example details; direct keyboard expansion; 120ms check/color response only on new pointer choice. Custom input focuses on mount (callback ref + preventScroll). Preserve IME composition handling, single-flight command, schema validation, withdraw, detail-request. Rejected response → original editable form + preserved draft.
   Verification: `pnpm exec playwright test --config tests/e2e/floating.playwright.config.ts tests/e2e/planning-ui.spec.ts`; scenarios per canonical §27 (pending→Submitted→Answer accepted, two questions/threads/nonplanning/withdrawn/superseded isolation, custom multiline across reload, unknown option string, missing response fallback, rejection keeps draft, ack+refresh-failure single handoff, no respond replays, IME Enter, 390×844 wrap+focus).

#### COMPOSITION — three examples (files: `packages/ui-catalog/composition-examples.ts`, `packages/runtime-pi/presentation-policy.ts`, `tests/task-composition.test.ts`)
Append after `document-signing`, in this order, via existing `node()` helper, copying every key/value:
| id | root/elements |
| --- | --- |
| `document-edit` — "Edit the supplied handoff text in place and keep its draft attached to the source." | root `handoff` = Document{dataBinding:handoffText, editableStateKey:handoffDraft, presentation:window, title:'Handoff', linkLabel:'Edit handoff'} — components: Document |
| `preferences-single` — "Collect one delivery preference and note in the same decision, with one explicit submission." | root `prefs` = Form{actionId:submitPreference, submitLabel:'Submit preference', payloadFromState:{method:method,note:note}, children:[method,note]}; `method` = Select{stateKey:method,label:'Delivery',options:[{label:'In conversation',value:'chat'},{label:'Download',value:'download'}]}; `note` = Input{stateKey:note,label:'Review note',inputType:'textarea'} — components: Form,Select,Input |
| `image-feedback` — "Attach feedback to points on the supplied image and keep each note with its source pin." | root `pins` = ImageAnnotator{resourceId:'source-image-grant',alt:'Delivery screen',stateKey:imageNotes,actionId:sendFeedback,actionLabel:'Send feedback'} — components: ImageAnnotator |
PRESENTATION_POLICY edits (exact strings): in Visual grammar paragraph replace the sentence beginning "Keep explanation in conversation" with "Keep decision-critical identity such as a short commit hash beside its object. Put secondary identifiers, full logs and supporting evidence in inspection." In the discovery paragraph append "Use a single column for one decision. Add a second column only for two useful peers. Size a source preview from its own content and move current-state copy forward when the object advances." Keep grants, state-key stability, native permission handling, progressive discovery, held-out prompt separation.
Tests in task-composition.test.ts — one named test per pair: document-edit uses one Document with editableStateKey vs signing includes DocumentPreview+SignaturePad; preferences-single has one Form with one submit action and no Grid vs kit-comparison contains Comparison; image-feedback single annotation object vs export = Image+ParameterControls in one Split. Validate all three with validateSurface, assert root types/state keys/ordered element types, validate component names against CAPABILITIES, exercise discoverCapabilities for Document/Select/ImageAnnotator (new example within existing two-entry bound; absent on cheap index and non-matching pages). Commands: `pnpm exec vitest run tests/task-composition.test.ts tests/copy-clarity.test.ts tests/proactive-presentation.test.ts; pnpm typecheck; pnpm lint`.

#### TRIALS — 24 live trials
12 case pairs (T,R,I,D,P,G × primary+second wording), 24 fresh threads in one disposable project, 2 messages each, table order. Per canonical plan §Synthetic datasets + §Trials: `pnpm fixtures:create "$EVIDENCE/live/fixtures"`, generated 960×600 PNG via the embedded Playwright script (SHA-256 recorded), file grants read-only through normal host flow; authenticated `GET /api/threads/{threadId}/snapshot` before/after each send; screenshots+snapshots after first result, control interaction, continuation; 120s per-trial cutoff → Pending. Scoring: 5 criteria per trial + 6 cross-pair comparisons (T,R,I,D,P,G primary-control distinction). Live pass = 24/24 passes + 6 distinct comparisons; unavailable model/host → mark Pending with named prerequisite and still finish fixture recordings + branch handoff.

#### MP4s — seven review films
One individually playable MP4 per interface (01,02,03,04,09,25,27 named per assignment table), 1920×1080 30fps h264, decode-to-EOF verified, recorded against final branch HEAD; attach to this issue + manifest.

#### PR + merge
Push branch; open PR → main from `refine/documents-graph-decisions` listing per-UI results, trial matrix, film links, known environmental flakes (graph-popovers zoom + image-compare drag specs flaky on Linux VM at base — verified pre-existing, document not block); CI green + review → merge → verified-on-main checkpoint.

### REPO_MAP (verified)
- `apps/web/src/App.tsx` — InputDecision ~L148, conversation change ~L809, filter ~L1161, render map ~L1180 (locate by symbol).
- `packages/contracts/index.ts` `InputRequest`{threadId,id,revision,title,prompt,status,response,presentation}; `packages/core/service.ts` `acceptRequest` stores status accepted/revision+1/response+presentation, returns `{request,inputId}`.
- `apps/web/src/PlanningQuestion.tsx`, `planning-question.css`, `journal.ts` (draft recovery only), `MotionRegion` shared.
- `packages/ui-catalog/composition-examples.ts`, `packages/core/discovery.ts` `discoverCapabilities` (max-2 examples, mechanics filter, compact-index, offset pagination, 12,000-byte policy ceiling), `packages/runtime-pi/presentation-policy.ts`, `tests/task-composition.test.ts`, `tests/copy-clarity.test.ts`, `tests/proactive-presentation.test.ts`.
- Trial infra: `evals/runner.ts` snapshot contract, `pnpm dev` host (5173/4317), `pnpm fixtures:create`, `tests/e2e/floating.playwright.config.ts`, `tests/e2e/planning-ui.spec.ts`.

### EXECUTION_DAG
- **T27a — Receipt implementation** per spec above. Deps: none. Done-when: spec file cases pass.
- **T27b — planning-ui.spec.ts cases.** Deps T27a. Canonical §27 verification scenarios 1–3 all green.
- **COMP — composition examples + policy + tests.** Deps none (parallel with T27). Done-when: vitest trio + typecheck + lint pass, discovery bound verified.
- **TRIALS — 24 live trials.** Deps T27a+COMP landed on branch (model output reflects new examples). Done-when: matrix + comparisons written, or Pending w/ prerequisite.
- **FILMS — 7 MP4s + manifest.** Deps T27a (all UIs final). Done-when: each decodes to EOF.
- **PR — push + open PR.** Deps T27b+COMP(+TRIALS best-effort)+FILMS.
- **MERGE — CI + review + merge + main verify.** Deps PR.

### VALIDATION
- Executed (per checkpoints): UI-01..04,09,25 suites green; graph-popovers zoom + image-compare drag flakes pre-existing environmental at base.
- Planned: T27 spec, composition trio, trials matrix, film decodes, PR CI, post-merge `pnpm typecheck`+`pnpm lint`+owned specs.

### STATE
- DONE: T01,T02,T03,T04,T09,T25 committed on branch (unpushed at CP007 — push at final delivery).
- Pending: T27, COMPOSITION, TRIALS, MP4s, PR, merge.
- Risks: live-trial host/model availability unverified → Pending path defined; two known environmental spec flakes; branch unpushed — push before any handoff (else HANDOFF_INCOMPLETE).
- Exact next step: implement T27 per spec (worker `devin-web-31a5aa` continues; this plan confirms remaining scope, no reassignment).

### REFERENCES
- Canonical plan: issue body manifest + PLAN 2/2 comment + `docs/agent-plans/` Worker-1 file (PR #1119); checkpoints 001–007 (issuecomment-7035009460, -7035405987, -7036044443, -7036487605, -7036956828 + latest).
- Branch: `refine/documents-graph-decisions` @ ~983aec64+.
- File attachment: `.md` upload unavailable via `gh`; plan lives in issue body (HANDOFF_COMPLETE).

