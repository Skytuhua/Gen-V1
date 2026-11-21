# Plan: Empty "Assistant" rows in All Agents transcript previews

## META
- Feature: All Agents transcript preview — skip or label artifact-only messages
- Repo: skytuhua-org/Gen-V1 — plan rev 1, 2026-11-21 (design fully specified — implementer makes no design choices)
- Baseline: main @ 4ca1134ae1e4f354064457cb5664b545712da4a9
- Status: planning complete, implementation NOT started
- Source: manual QA of built app served by `scripts/review-host.ts` on :4317 (fixture thread "Explore the component catalog")
- Dedupe: checked #1299 (All Agents card redesign — layout only, does not address empty preview rows), #1139 (sidebar rows only), #1383 (empty states — zero-agent/zero-filter, unrelated). No existing issue covers this.

## OBJECTIVE
In the All Agents view, an agent card's transcript preview renders one `<article>` per message including messages whose content is empty (artifact/tool-only turns). On the fixture, the preview shows "user / show me the catalog" followed by two rows that contain only the word "Assistant" and a blank body — dead space that reads as a rendering bug. Success: the preview never shows a role label with an empty body; every preview row carries content or a clear placeholder.

## REQUIREMENTS
- A transcript message whose `content` is empty or whitespace-only MUST NOT render a bare "assistant"/"user" role row.
- The fix applies to the preview transcript inside each agent card in All Agents (`agents-workspace/AgentsWorkspace.tsx`) and to the same rendering path if it is shared with the expanded transcript, so behavior stays consistent.
- Empty messages still exist in history — they are labeled, not deleted, so "Load earlier messages" and gap logic keep working off the same `state.messages` array (no array mutation; filter/label at render only).
- a11y: `role="log"` container keeps its label; placeholder text must be real text (screen readers announce it).
- Compact and comfortable densities both covered; light and dark themes verified.
- No new design tokens; reuse `var(--muted)` and existing classes.

## REPO_MAP
- `apps/web/src/agents-workspace/AgentsWorkspace.tsx:170` — message map renders `<article className={agents-message agents-message-${role}}><span className="agents-message-role">{role}</span><Markdown text={message.content}/></article>` for every message, verified.
- `apps/web/src/agents-workspace/agents-workspace.css:41-46` — `.agents-message`, `.agents-message-role` styles, verified.
- `AgentMessageRow` shape comes from `agents-workspace/agent-work-api.ts` — discovery: whether messages carry an artifact/kind field usable for a smarter label ("Shared a card"). If not, use the generic placeholder below.
- `packages/widgets` / artifact rendering — discovery only: do not render artifacts in the preview; the conversation view is the full surface.

## DESIGN SPEC (exact values — no design choices left)

Replace the per-message `<article>` render in `AgentsWorkspace.tsx:170` with:

1. Compute `const text = message.content?.trim() ?? ''` per message.
2. When `text.length > 0`: render exactly as today (role span + `<Markdown text={message.content}/>`).
3. When `text.length === 0`: render
   `<article className="agents-message agents-message-{role}"><span className="agents-message-role">{message.role}</span><p className="agents-message-empty">Shared a result card — open the conversation to view</p></article>`
   (exact copy string above; do not paraphrase).
4. New CSS in `agents-workspace.css` next to `.agents-message-role`:
   `.agents-message-empty { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }`
5. Density: no density-specific overrides needed — the row inherits `.agents-message` padding (`16px` bottom, `12px` compact).
6. States: hover/focus — none (preview rows are not interactive; unchanged). Motion: none added; rows appear/disappear with the existing list update path, no new animation.
7. a11y: `agents-message-role` already `text-transform: capitalize`; the placeholder is plain text read after the role, e.g. "assistant Shared a result card — open the conversation to view". Acceptable.
8. Optional refinement IF `AgentMessageRow` exposes an artifact/kind/type field (discovery): use `Shared a {kind} card — open the conversation to view` with kind lowercased; otherwise keep the generic copy. Record which was used in the PR.

## EXECUTION_DAG
- T01: Confirm `AgentMessageRow` fields (artifact/kind present?) in `agent-work-api.ts` / contracts; pick generic vs kind-aware copy per DESIGN step 8. Done when: chosen copy string recorded.
- T02: Edit `AgentsWorkspace.tsx` message render + add `.agents-message-empty` rule in `agents-workspace.css`. Done when: fixture card preview shows placeholder instead of empty rows; text messages unchanged.
- T03: Test — rebuild (`pnpm build`), restart review host on :4317, open All Agents: the "Explore the component catalog" card shows "user / show me the catalog" + two rows reading "assistant Shared a result card — open the conversation to view". Screenshot light + compact. Done when: screenshot attached to PR.
- T04: Regression — `pnpm lint && pnpm typecheck`; vitest on touched files if a test exists. Done when: clean or pre-existing failures only.

## VALIDATION
- Manual: fixture host :4317, All Agents view, light + dark, compact + comfortable densities.
- Automated: `pnpm lint`, `pnpm typecheck` (no new errors).
- Acceptance matrix: (a) no bare role rows, (b) placeholder copy exact, (c) Load earlier/gaps unchanged, (d) no new tokens, (e) lint/typecheck clean.

## STATE
- Researched: DOM + code paths verified on Linux fixture host.
- Pending: T01–T04, unowned.
- Next step: claim, run T01.

## REFERENCES
- Fixture host: `scripts/review-host.ts` (`openReviewHost`, port 4317).
- Related: #1299 (card layout), #1139 (sidebar rows), #1383 (empty states) — none overlap.
