# Frontend rebuild: recorded handoff

The original standalone review was generated locally at `evidence/frontend-review/delivery-20261030/index.html`. The bundle is not in a clean checkout. The recordings and verification below describe that historical handoff. The [published media gallery](public/media/README.md) offers separate, fixture-backed demos; it does not contain the original recordings or reproduce their live verification.

## What changed visibly

- Wider T3-style conversation, collapsible/resizable navigation, a right workspace launcher and tabs that retain the same mounted artifact. Unsupported browser/terminal/PR/device surfaces are visibly disabled.
- All 21 pinned T3 settings sections plus Diagnostics and Licenses; 341 searchable rows have working, adapted or unavailable status.
- Committed/candidate PDF rendering retains the last good page without dimming; frame starvation suspends display work rather than reporting a false processing timeout. Field navigation pans the current preview.
- Generate/style variation, multiple drawn strokes, Clear and PNG Upload share durable state and the exact approved export image. Reload recovers the signature.
- Wider progressive Q&A, concise answers, nested follow-ups, compact return-key submission and preserved exploration. Separate vertical/horizontal PR graphs, affected-cell migration updates, linked map/carousel and an anchored context inspector use the reusable registry.
- Shared motion includes field pans, question fades, branch growth, graph paths, changed cells and completion feedback. Reduced motion removes travel/stagger.

## Recordings

| Workflow | Filename in the original bundle |
| --- | --- |
| Signing: real local export | `01-signing.mp4` |
| Dark PR: vertical graph | `02-pr-dark.mp4` |
| Light PR: horizontal graph | `03-pr-light.mp4` |
| Migration: real local SQLite | `04-migration.mp4` |
| Context: labelled illustrative telemetry | `05-context.mp4` |
| Progressive Q&A | `06-faq.mp4` |
| Map/comparison | `07-map.mp4` |
| All 31 catalog components | `08-catalog.mp4` |
| Shell/settings | `09-shell.mp4` |
| Genuine GPT-6.1 Sol | `genuine-pi/10-genuine-pi-composition.mp4` |

All exports are H.264, 1920×1080, 30 fps, with a visible cursor and opening/closing holds. The compositor is sampled against wall time; unchanged/delayed frames are held, without generated intermediate frames or camera zoom. Full FFmpeg decoding and installed-Chrome playback passed for all ten files. Chapter seeking and the narrow standalone review layout passed.

The first nine use an explicit deterministic runtime through the actual application, HTTP/SSE, state store and renderer. Their external GitHub/CI/Supabase/email/phone effects are illustrative. PDF export and SQLite migration use real native approval and execution. The included PDF/database hashes match their successful receipts.

## Genuine generation and recovery

The tenth recording uses actual subscription Pi and `openai/gpt-6.1-sol` on a fresh fictional source packet. The agent discovered capabilities, imported sources, authored its composition, received a real `action.submit`, then updated the same artifact from revision 1 to 2. Reload retained both opened branches and the exact notes. Generation took 102.19 seconds; continuation took 46.72 seconds; zero model repair prompts were used. The full waits are recorded. A script URL error before any model run is preserved separately.

The local handoff included `genuine-pi/proof.json`, before/after/reload snapshots and events. This is a single genuine proof, not fresh-run reliability or the deferred pilot. The model-authored visit review is more verbose than the concise reference fixtures; presentation consistency across arbitrary prompts remains an evaluation concern.

## Verification and review

- Full unit suite: **215/215 passed**, serial, with machine-readable results in the local bundle’s `unit-tests.json`.
- Browser suites: **94 passed**, four opt-in capture skips: frontend 63, PDF 19, task interfaces 12.
- Typecheck and production build passed. Main-bundle size remains an approximately **645 kB** advisory; PDF code is lazy-loaded.
- One coherent independent review identified duplicate PNG-header admission, Settings/model propagation and signing-width issues. All three were repaired with failing-to-passing regressions. Capture verification additionally found and fixed emitted `.mjs` MIME serving.
- The batched visual pass corrected compact question submission and inspection-only evidence identities. Capture-fixture state writes were removed in favor of existing component defaults, avoiding a revision race. The missing workspace launcher was added and browser-tested; it was added after the independent review.

Earlier internal-receipt, unused reconciliation-flag and model-discovery simplifications remain preserved. This milestone adds no animation framework or production scenario-to-screen router. The recording fixture runtime is outside the production entry points.

## Remaining boundaries

User visual approval remains open. Desktop EXE packaging, external connectors, full 36-run evaluation and generated-code enablement are later milestones. Generated applications remain disabled; no hard browser memory quota is claimed. There is no certificate signing, OCR or actual email/phone delivery. Existing resource grants, exact approval, revision/lease checks, Stop authority and completed-effect recovery remain in force.
