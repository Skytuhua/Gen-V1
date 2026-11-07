# Visual contract

Last updated: 2026-11-05. The approved UX rebuild references and compact revisions supersede earlier canvas, density and motion directions. Implementation acceptance remains separate from reference approval.

The supplied Phil Pitus videos are the behavioral and visual reference. The [T3-centered milestone](docs/t3-centered-milestone.md) updates the shell within the earlier [Frontend Rebuild and Recorded UI Review](docs/frontend-rebuild-plan.md), using T3 baseline `da8cc591dadd75819ae62961da4a882767efb145`. The same local React/Pi workspace runs in the browser and the native Windows Electron owner with one supervised Node backend. The [visual workspace preview](docs/visual-workspace.md) opens the original single conversation by default, with optional splits; new desktop detachment is deferred and existing child recovery remains guarded.

Use the latest user-supplied T3 screenshot as the palette authority: pure black workspace, near-black #0F0F0F task surfaces, neutral #1F1F1F selected surfaces and fine gray borders. Light mode uses neutral white/gray equivalents. Neutral project monograms identify stable typed project ownership; separate labelled status marks communicate source-backed activity. Accent/focus colors never wash across the entire shell. Background customization preserves opaque readable content surfaces. Meaningful graph/diff colors remain. Close-X marks are red. No dashboard metric grid.

Dark is the primary theme for fresh profiles and review recordings; preserve saved Light/System choices and the original colors of documents and images.

The task's working object determines its interior structure: time intervals, reviewed passages, failing assertions, code hunks, request/response exchanges, dependencies, images, fields, records or question branches. Shared outer containment does not impose a shared task body. Avoid the universal list/sidebar/detail/button layout and repeated selected summaries. Preserve successful task-specific mechanics.

Navigation and the workspace panel belong to the stable shell. The workspace panel starts closed; narrative and composer center within the available workspace without reserving a blank right rail. Existing saved layout choices remain respected. Every inline artifact has one visible outer container and compact header, matching the composer's width and alignment, including compact, standard and wide saved presentations. Inline lists, code and diagrams grow or reflow instead of creating nested scroll areas; the chat owns scrolling. The chat-width setting controls their shared measure: Comfortable 680px, Wide 760px, Full the available conversation width. Explicit expansion, workspace and detached views retain their own sizing and the same state. Signing keeps its PDF and controls paired at 620px available width or more and stacks below that measure. Moving an artifact between conversation and workspace panes retains one renderer and the same durable state. Prepared text can open in an editable Document window, dock beside the conversation or float by dragging its header; closing it recenters the conversation and reopening restores the same draft. File saving and delivery remain separate explicit actions.

The 48-component trusted catalog supplies reusable document/question pairs, progressive nested Q&A, vertical PR histories, source-bound migration tables, linked maps, image comparison, debugging/change review, API contracts, release checks, statistics, alternative comparison, private token entry, item review, typed record editing, parameter controls, image feedback pins, supplied schedule selection and log exploration. WorkflowBoard adds a lane-and-card proposal surface, ArchitectureCanvas a layered node schematic, and TraceWaterfall a nested timing view. Choose the shape that serves the task and expose detail contextually. Answers and branches grow without replacing existing exploration or the question input. Operational status comes from source records and receipts; illustrative GitHub/CI/phone effects and fixture context telemetry are labelled accordingly.

The shell owns navigation, composer, settings, native decisions, runtime telemetry and Stop. Settings consolidates supported controls into General, Appearance, Chat & Composer, Models & Accounts, Projects & Working Copies, Source Control & Reviews, Skills & Integrations, Notifications & Usage, Browser, Keyboard Shortcuts, Data & Recovery, and About & Licenses. Historical settings inventories remain migration evidence; unavailable placeholders are not permanent product sections. Generated content owns task-specific composition within that shell.

PDF preview keeps the committed frame visible while a candidate replacement prepares, without dimming. Frame suspension is coordinated through requestAnimationFrame. Paired inline documents use a bounded viewing area, field-linked panning and Fit page for whole-page review. Navigation moves the document; typing and background regeneration retain the current focus. Wheel scrolling belongs to the chat. Multiple drawn strokes and generated/uploaded bounded canonical PNG marks share durable state with the prepared native-approved export; legacy marks remain supported.

Motion follows the approved IMG_2758 interaction rules and the token table below. Use ease-out entrances, ease-in-out moves and exits about 20% shorter. Retarget interrupted transitions from their current geometry. Send, Stop, typing and held/dragged controls respond immediately. Do not replay whole-view entrances on restore or snapshots. No routine bounce, idle animation or artificial waiting. Reduced motion removes spatial travel, staggering and shimmer; short opacity feedback may remain.

Plan may open when the current thread has a real validated plan, without taking composer focus. Preserve dismissal and collapse preferences until materially new work arrives. Project overview and optional compact Live Usage use normal-flow docks; a hidden/collapsed summary releases its space. Fixed tool splits replace floating offsets, free positioning and workspace maximize. Narrow windows allocate a bounded lower tool area while keeping chat visible. Existing native child recovery remains guarded; layout changes never replace thread or artifact ownership. Usage shows runtime-reported values, while the compact composer context popover shows conversation capacity; durable research artifacts are separate from Thread memory.

New detached native windows open on their source display, while saved surfaces restore their preferred display and bounds. Display menus, keyboard moves, disconnect rescue and reconnect restoration retain the renderer and durable drafts. Coordinates use Electron DIP, including negative monitor coordinates. [Physical multi-monitor and mixed-DPI verification remain pending](docs/native-multi-monitor.md).

Text entry and Changes/Create PR share one row. Attachments add a row only while present; the other composer controls stay in a compact footer. Preserve IME, predictions, caret, drafts, focus, voice and immediate Send/Stop. Model selection commits explicitly, retains account pinning and locks during active runs. Context and provider usage remain distinct. Newly arriving prose may reveal by grapheme; copied code and restored history stay stable. Reduced motion shows new prose immediately. Private token fields bypass conversation, drafts and persisted artifacts, expire after one hour in host memory, and never imply a connected service.

Historical recordings remain available in the [reserved-rail video index](docs/evidence/frontend-review/reserved-rail-20261030/index.html) and subsequent delivery reports linked from the README. [Delivery and provenance rules](docs/frontend-review-delivery.md) distinguish deterministic actual-app fixtures, real local operations and genuine Pi evidence. Synthetic captures of the current milestone show fixture behavior only. Final broad review, current packaging, live provider acceptance, physical display verification and user visual approval remain separate gates. Generated applications remain disabled and the full 36-run pilot is deferred.


## Approved rebuild contracts

The main Workspace stays anchored to one conversation with optional fixed, resizable tools. Dedicated All Agents, Code Review and Research workspaces can show optional chat. Custom saves user-arranged fixed splits. Named layouts never replace conversation ownership. Preserve existing working task bodies, drafts, revisions, PDF bytes/fields/signatures and explicit export protections.

All Agents uses vertical project rows, horizontally scrolling parent-chat columns and subagents nested inside their parent. Parent columns default to 460px with a 420px minimum. Keep working parent/child chat and bounded transcript history visible; completed children are read-only. No summary-card grid, large repeated header, colored side rails, empty manufactured agents or increased runtime concurrency.

Plan, Code Review and Research each have one 36px contextual toolbar and 16px outer inset. Do not repeat their visible workspace/plan title below the tab. Preserve unique document titles. Plans use expanded vertical steps with 18px separation and concurrent branches under their owning step; checks, blockers and reported versus accepted completion remain distinct.

Side-by-side chat keeps at least 420px; tools stay between 280px and min(720px, available width minus 420px minus a 6px divider). Stack tools below chat when the work area is under 706px. Stacked tool bodies keep at least 128 CSS pixels (`--ui-tool-body-min`), in addition to their actual chrome (53px workspace header; 96px Browser toolbar). Reserve 240px for chat and 6px between regions. When these minima cannot fit, the normal-flow tool/chat owner scrolls below the fixed title bar; closing tools releases their share. Do not fake native bounds, shrink type or cover another owner to fit the stack. Never cover native caption controls. Project overview and compact Live Usage belong in normal-flow docks; the entire header is an accessible disclosure, while body actions stay independent.

### Spacing, color and compact surfaces

- Shared tokens live in `packages/ui-shell/tokens.css`. Normal content inset is 16px, panels 12px, dialogs 24px, compact control text at least 8px. Intentional code/media edge-to-edge layouts declare their exception; badges use 2px vertical and 6px horizontal inset.
- Navigation highlights have a 4px gap. Selected, hovered and keyboard-focused states are visually distinct. Compact/Comfortable/Touch controls use 32/36/44px minimum rows; long text can grow a row.
- Keep dark black/near-black and neutral light equivalents from the established palette. Use stable project-color dots or monograms with editable palette/custom color; no decorative colored rails. Communicate status with text/icon as well as color.
- Thread hover cards are 304px wide with 12px inset and 8px section gaps; keep the full 16px title. Show exact thread/working-copy/project/environment/branch/model/activity and linked PR facts only when known.
- Context popovers are 328px wide with 12px inset and 34px information rows. On-demand category details are 220px. Conversation token capacity stays separate from provider quotas/reset times in Usage.
- Model pickers are 400px wide, with a 44px search area and typical two-line 54px rows that grow for long names. Use one Reasoning/value footer; no repeated selected-model name or permanent reasoning sidebar. Hover/focus never commits selection.
- Preserve reading font sizes when reducing chrome. Do not use CSS scaling or clipped labels to meet compact dimensions. Existing saved appearance choices remain; new defaults use dark, Inter, comfortable density, 6px controls and 760px chat width.

### Popup and modal rules

Use shared Popover, Select/Combobox, ActionMenu and Modal primitives. Portals belong to the trigger's owning modal/document, including an isolated plug-in frame. Menus are nonmodal; Settings, Usage, project selection and comparable blocking dialogs blur/dim the background while their content stays sharp and opaque. The shared modal backdrop uses 6px blur, with opaque reduced-transparency/unsupported-browser and forced-color fallbacks.

Place popups 8px from the trigger with 8px viewport clearance. Flip before shrinking/clamping, reserve native title chrome, and reconcile after reveal, resizing, visual-viewport/zoom and font/owner layout changes. Constrain height and expose scrolling. Keyboard/typeahead, Escape, focus restoration, IME and selected/hover/focus distinctions are required. Nested popups dismiss before their modal; only the modal owns focus trapping. Native browser content remains occluded while blocking dialogs are active.

Useful icon-only tooltips retain accessible names and hover help. Pointer dwell is 350ms; rich cards have 120ms pointer-transfer grace and stay usable under pointer/focus. Keyboard focus exposes equivalent information. No tooltip opens while dragging or embeds another menu.

The composer command menu uses a compact, opaque shared Popover with a 12px radius, 5px outer inset and 38px option rows. It opens above the caret owner with model/mode commands and paged installed-skill metadata; keep source availability visible even when no entries can load. Selection inserts an exact bound reference without sending. Preserve selected references beside the draft, allow removal, and retain both after a denied Send. Ambiguous retries retain the original command; an authenticated precommit rejection may release it for reselection. Literal slash text cannot grant skill authority. Personal pins cannot silently transfer into side or delegated sends.

### Motion tokens

| Interaction | Enter / exit or duration |
| --- | --- |
| Hover/focus color | 120ms |
| Press/release | 80ms, scale .97 without shifting layout |
| Panel and sidebar | 220/180ms; immediate drag geometry |
| Tab content | 140ms crossfade, preserve focus/scroll |
| List insert/remove | 180/140ms; 30ms stagger, maximum 150ms delay |
| Status/success | 160ms crossfade; one 240ms success pulse |
| Attachment row | 220/180ms height and opacity, present only with attachments |
| Dropdown/popover | 180/140ms, .95 scale from trigger origin |
| Toast | 200/160ms; 6 seconds visible, pause on hover/focus |
| Tooltip | 160/120ms after dwell |
| Context compaction result | 600ms after a real receipt; no fake wait |
| Reduced motion | No spatial transforms/stagger/shimmer; opacity at most 80ms |

Entrance easing: cubic-bezier(.16,1,.3,1). Move easing: cubic-bezier(.4,0,.2,1). Exits return toward their trigger. Transitions are interruptible; never tween held controls. Settings expose System/Reduced/Off motion and speed without delaying input.

### Copy review checklist

- Lead with the answer, then discriminating facts, then the next useful action.
- Remove repeated workspace headings, duplicate selected-item summaries, status disclaimers, fixture essays, persistence narration and redundant metadata lines.
- Put source/authority/budget details in contextual inspection when useful; retain actual errors, approval facts and receipts needed to decide safely.
- Never claim live activity from planned staffing, a bookmark as a read/captured source, or reported100% as accepted completion.
- Delete generated document review banners and Source and signature details presentation without changing the underlying PDF or its bindings/protections.
- Apply source-site copy decisions; never globally blacklist phrases or truncate stored answers.
- Buttons name the action. Errors name the failure and a useful recovery. Omit unknown facts rather than inventing values.

### Loading and acceptance

Startup reserves 42px native chrome in a 390x148 window: Gen mark, Opening your workspace, one actual operation line and a restrained pending indicator. Delay showing it until 150ms; do not impose a minimum wait or invent percent complete. Failures show one cause and Retry/Diagnostics.

Initial in-app loading uses structure-matched skeletons. Refresh retains content/selection; pending actions retain edits until host acknowledgment. Delayed feedback appears after150ms. Reduced motion uses static skeletons.

Required guardrails: type-aware numeric-JSX lint, primitive-only overlays, copy review, reduced-motion checks, and automatic first-visible geometry/padding assertions. Main-surface visual acceptance covers dark/light, narrow/short windows,100/125/150% actual app zoom and keyboard use. Cold-launch clipping checks run before any corrective resize. Browser fixtures do not establish packaged Windows, physical DPI/display, provider, authority or live-runtime acceptance. Record passed/failed/unverified separately.

Dedicated workspaces resolve their saved owner before mounting conversation data. All Agents uses compact navigation and Settings reads, vertical project rows, horizontal parent conversations and nested subagent transcripts. It shares one draft, reasoning, pending-send and Stop owner with ordinary conversation. Restore scroll only when a viewport mounts; progress updates preserve the current reading position. An overlapping navigation request cannot replace or roll back the accepted handoff. Settings close, resource navigation and native handoff wait for writes and their accepted metadata refresh; a failed write keeps its error available.
