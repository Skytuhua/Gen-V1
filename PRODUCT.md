# Gen V1

<!-- impeccable:product-schema 1 -->

Last updated: 2026-11-16.

## Platform
web

Windows Electron packages the same React frontend and Node/Hermes backend.

## Stack
React, TypeScript, Vite, Node, SQLite, original Hermes Agent, native subscription adapters and json-render; Electron packages the application with pinned Node and isolated Python sidecars.

## Users
A single local Windows user working with an agent across code, documents, data, research, planning and unfamiliar tasks.

## Product Purpose
The conversation is the workspace. The agent creates and evolves interactive task applications, receives meaningful actions through them, and continues real work.

## Capabilities and Constraints
Source identity: 0.6.5 is an unreleased visual workspace preview, not evidence of installed-Windows upgrade acceptance. `GENERATED_APPS_ENABLED = true` in `packages/core/widgets.ts` gates generated-app discovery, creation and artifact mounting. **Support level (supported vs preview): pending owner decision.**

Fresh profiles use the canonical conversation plane and existing model controls. Conversations can float inside the application, return to the main area, or dock into directional splits. Sidebar selection respects the main conversation owner. Each conversation retains one mounted body and shared composer while its placement changes; drafts, caret and scroll position remain with that owner. The compact protected right overview combines project, agent, schedule availability and plan summary. A detailed area uses the same canonical plan; automatic publication preserves composer focus and narrow chat visibility. Appearance and project colors carry meaning without replacing labels. Prepared documents retain their identity and entered values. One thread owns one durable task and original Hermes session, bound to a specific account. Trusted structured composition has 48 components, including workflow boards, architecture schematics and trace waterfalls. Generated-code applications execute in opaque workers with schema, message and watchdog limits after actual-host acceptance; no hard operating-system memory quota is claimed. Preserve edits, evidence, actions and recovery. Conversation detachment uses in-app floating panes. Existing native children retain their guarded recovery and durable object identities. Code Review, Research, Custom and Visuals are retired workspace choices; saved records and compatible readers remain preserved. Generic plug-in placement remains available.

Keep routine context small through a concise capability index, paged schema discovery, metadata-first inspection and explicit revision-pinned source reads. Thread memory retains at most 12 brief notes, 768 UTF-8 bytes each and 4 KiB total, visible and editable by the user. Notes support continuity across sessions and compaction; they never replace source evidence, resource grants or approval.

Settings keeps all twelve sections reachable through desktop navigation or a narrow-window section picker. Settings uses compact spacing with readable text and larger touch targets. Navigation labels, surfaces and controls stay neutral. Keyboard focus uses a neutral indicator; search does not frame whole sections and the composer has no focus glow. Small status marks use color only with a clear source-backed meaning and an accompanying text label. A saved credential is labelled "Saved, not verified"; only authenticated status is labelled "Signed in". Advanced environment controls and exact account-bound terminal instructions remain available in disclosures. Settings uses a provider list and one selected account detail. Desktop sign-in monitoring survives closing Settings; an active flow keeps its account identity, and model invalidation follows the affected account. Readiness probes belong to the selected detail and can be cancelled independently of sign-in.

Nine connection IDs are implemented: ChatGPT / Codex, legacy Codex, GitHub Copilot and xAI OAuth; Claude and Gemini official runtimes; Cursor SDK browser login; and Kimi Code/OpenCode Go dedicated plan keys. Earlier live sign-in/task acceptance covers the owned OpenAI route; this repair does not extend account-specific live acceptance. Other account entitlement and inference remain unverified. API-key billing fallback remains disabled. Optional composer predictions use the selected account/model in an independently owned tool-free session, stay outside the draft until accepted and are off by default. See [the connection inventory](docs/subscription-connections.md) and [verification scope](docs/2026-11-01-product-completion.md).

## Brand Commitments
The six supplied Phil Pitus videos guide conversation proportions, composer, cards, typography, neutral palettes and contextual controls. Keep T3-style thread navigation around the conversation. The user's later motion direction is expressive, responsive and subtly springy. No green-tinted application background.

## Evidence on Hand
Six supplied recordings and an inspected T3 screenshot. Research details live in docs/reference-videos.md. The clips show behavior, not proof of generated code or external execution.

## Product Principles
- Task interfaces belong inside the conversation and retain identity.
- New categories do not require a new fixed application screen.
- User state is preserved independently of model context.
- Displayed facts and execution outcomes have sources.
