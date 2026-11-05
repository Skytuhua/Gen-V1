# Vespin Inbox presentation adaptation

Pinned source: ReviewStage/vespin commit `7f0bfe954a958858235b91d82293043ab5541433`. Copyright 2026 Stage Inc.; Apache-2.0. The full upstream LICENSE and NOTICE remain unchanged here.

## Retained implementation

- `inbox-presentation.tsx` selectively adapts actual `ListRow` JSX, `InboxItemRow` composition, `InboxList` wrappers, and `InboxPane`/`Subject` JSX. It retains the three-line mail row, leading unread gutter, metadata beside the above-title lead, muted/completed and unread states, native list/button semantics, list/reader layout and ordered reader content.
- `inbox-presentation.css` contains only selected upstream `list-row.css` blocks, with selectors scoped to `.agent-inbox`.
- `inbox-columns.ts` retains the upstream column selector and container-width hysteresis (enter one column below860px, split again at892px), plus35%list share.
- `provenance.json` records exact source files, raw SHA-256 values, copied/adapted source ranges and modifications. The range identifies the selected original branch; excluded branches/dependencies are listed in modifications.

`apps/web/src/InboxView.tsx` supplies validated Gen items and canonical read/unread/open callbacks. It maps the existing filters into the upstream View options/search composition. `agent-inbox.css` maps upstream design tokens and Tailwind utility layout to Gen's scoped theme; it does not add a second visual layout or backend.

No Effect, cloud/authentication, agent-launching, billing, application stores, private identities, scheduler, or backend code is copied. Gen does not invent an Inbox send/approval capability: its reading pane opens the exact canonical conversation to answer. No full package is vendored.

Focused tests verify retained row/reader markup, unread/current state semantics, shared host-free presentation and container hysteresis. Integrated visual review remains a separate gate; this adaptation does not claim pixel-identical output.
