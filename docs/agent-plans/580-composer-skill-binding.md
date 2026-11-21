# Composer: bind a selected skill to a message

## META

- **Feature:** skill selection → attachment to the outgoing composer message, with removal before send.
- **Repo:** `skytuhua-org/Gen-V1`
- **Plan revision:** 1 — 2026-11-21
- **Baseline:** `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified `git log -1 origin/main`)
- **Issue:** https://github.com/skytuhua-org/Gen-V1/issues/580
- **Current status:** infrastructure exists end-to-end (binding schema, journal draft persistence, chip component, `addSkill`/`removeSkill` composer actions, `message.send` skills payload, server admission in `packages/skill-invocation`). Only the selection step in `ComposerCommands` is gated off, and every send path blocks while bindings exist (`skillsBlocked`).
- **Source provenance:** code read at baseline SHA; design authored this session. No user-supplied plan.

## OBJECTIVE

A user types `/skill:` (or `/` and picks a skill row) in any composer, picks an available skill, and it attaches to the outgoing message as a removable chip. Pressing Send delivers the message with the selected skills bound (`message.send` `skills` payload). The user can remove a chip before sending. Success: selection → chip → send → chips clear on accept, in the main composer (`App.tsx`), the scoped conversation composer (`ScopedConversationComposer.tsx`), and the Agents workspace composer (`AgentsWorkspace.tsx`).

## REQUIREMENTS

**In scope**
1. Skill options in the command popover become selectable when they can actually be bound.
2. Selecting a skill removes the `/…` command token, adds a binding chip, closes the popover, and restores textarea focus/caret.
3. Chips: show name + source, remove button per chip, cap of 8, no duplicate skills, per-skill "Selected" state in the list.
4. Send is allowed while chips are present (remove the `skillsBlocked` gate and the "Selected skills are unavailable" banner).
5. All error/edge states listed under DESIGN have specified copy and behavior.

**Out of scope**
- Server admission changes (already implemented in `packages/skill-invocation`).
- Provider-scoped skills (`ref.scope.kind !== 'personal'` stays unselectable).
- Rendering bound skills on the sent message bubble, saved-draft UI changes, settings/library changes.

**Decisions (agreed, not options)**
- Chips render above the textarea via the existing `ComposerSkillBindings` group — no new attachment row or popover redesign.
- Max 8 bindings (existing `skillBindingsSchema.max(8)`); a 9th skill's row is disabled with the `limit` reason label.
- A skill already bound to the draft is shown disabled with `Selected` as its reason text; it cannot be bound twice (payload rejects duplicate references).
- Send still requires a non-empty draft or excerpts; chips alone never enable Send (`content` requires `min(1)` in `skillInvocationSendPayloadSchema`).

**UX/accessibility**
- Full keyboard support: ArrowUp/Down navigate, Enter/Tab select, Esc close (unchanged).
- `role="option"` rows get `aria-disabled` accurately; chip group keeps `role="group"`, `aria-label="Selected skills"`; remove button `aria-label="Remove skill {name}"`.
- Focus outline: `2px solid var(--ui-focus-ring)` on the chip remove button (`:focus-visible`, existing rule).
- Honors `prefers-reduced-motion` and forced-colors as specified below.

## REPO_MAP (verified at baseline)

- `apps/web/src/ComposerCommands.tsx` — popover list, `available()` (line 21) currently returns `'builtin' in option` so skills are never selectable; `choose()` only handles builtins; the "Skill selection is unavailable for this runtime" status line (line 111); `ComposerSkillBindings` chip row (lines 121–128) already renders chips + remove buttons + the "Selected skills are unavailable" banner (line 124).
- `apps/web/src/composer-commands.ts` — `commandToken`, `replaceCommandToken`, `skillBindingSchema` (`id` uuid, `name`, `source`, `ref` personal-scope only), `skillBindingsSchema` (max 8, unique ids).
- `apps/web/src/composer-skill-drafts.ts` — `useComposerSkills` (`add`/`remove` over `draft-skills:<threadId>` journal), `readSkillBindings`, `clearAcceptedSkills`, `skillDraftKey`.
- `apps/web/src/agents-workspace/composer.ts` — `addSkill`/`removeSkill` (writes journal, emits state), `submit` reads `state.skills`, `clearAcceptedSkills` on accept (line ~200), `ComposerState.skills`, `ComposerSubmission.skills`.
- `apps/web/src/App.tsx` — `skills`/`localSkills` wiring (lines 298–301), `skillsBlocked` gate (line 301, used lines 357, 449), `message.send` already sends `skills: submittedSkills.map(b => b.ref)` (line 382), `clearAcceptedSkills` after send (line 383), `ComposerSkillBindings` + `ComposerCommands` render (lines 427–428).
- `apps/web/src/ScopedConversationComposer.tsx` — `skillsBlocked` (line 36, used 37/54), bindings row + commands (line 48).
- `apps/web/src/agents-workspace/AgentsWorkspace.tsx` — `skillsBlocked` (line 184, used 185/191), bindings row + commands (line 188); parentId agents render neither (existing constraint — keep).
- `apps/web/src/composer-commands.css` — all chip/popover styles already present (`.composer-skill-bindings`, `.composer-skill-chip`, `.composer-command-option`, `-status`, `-source`, `-hint`, forced-colors block).
- `apps/web/src/skill-catalog-api.ts` — `getSkillCatalog` validates `availability` and `ref` (personal scope, sourceId/skillId match).
- `packages/contracts/skill-catalog.ts` — `SkillCatalogEntry` (`id`, `name`, `description`, `availability`, `ref`), `SkillCatalogPage.sources` (source `label`).
- `packages/contracts/skill-invocation.ts` — `skillInvocationSendPayloadSchema` (`skills` 1–8, `content` min 1).
- `packages/skill-invocation/index.ts` — server admission; throws `SKILL_RESELECT` "This skill is unavailable or changed. Select it again."
- Tests: `tests/skill-invocation.test.ts`, `tests/skill-catalog*.test.ts` (server side, unaffected); no existing web test for `ComposerCommands` — discovery: check `tests/` for a composer test harness convention before adding one.
- `packages/ui-shell/tokens.css` — motion/easing tokens; popover keyframes + reduced-motion policy.

## DESIGN

### Selection availability

Replace `available()` so an option is selectable when:

- builtin → always (unchanged), or
- `option.skill.availability.status === 'available'` AND `option.skill.ref !== null` AND `option.skill.ref.scope.kind === 'personal'` AND no existing binding has `ref.skillId === option.skill.id` AND current bindings count < 8.

Pass the current bindings into `ComposerCommands` as a new prop `skills: readonly SkillBinding[]` and a new callback `onSkill(entry: SkillCatalogEntry): void | Promise<void>`.

Non-selectable skill rows keep `aria-disabled="true"`, are skipped by arrow-key navigation and pointer activation, and show a reason in the description slot with this precedence:

1. Already bound → `Selected`
2. `availability.status === 'unavailable'` → existing `availabilityLabel[reason]` mapping (includes `limit` → `Limit reached`)
3. `ref === null` or non-personal scope → `Unavailable`
4. Bindings count === 8 → `Limit reached`

Delete the "Skill selection is unavailable for this runtime. You can still browse installed skills." status line entirely (`ComposerCommands.tsx:111`).

### Selection flow (`choose` for skill options)

1. Guard unchanged: bail if `disabled`, option not available, no token, or `element.value !== draft`.
2. `close()` the popover; clear `error`.
3. `replaceCommandToken` → `onDraft(replacement.text)`; restore focus and caret at `replacement.caret` (same rAF pattern as builtins).
4. Build `SkillBinding = {id: crypto.randomUUID(), name: entry.name, source: sources.find(s => s.id === entry.sourceId)?.label ?? entry.sourceId, ref: entry.ref}`.
5. `await onSkill(entry)` (the parent builds the binding and calls `addSkill`/`add`). On reject, show the thrown message in `composer-command-error` via the existing `setError` path.
6. No token text remains in the draft — the chip is the only residue. `/skill:` rows and plain catalog rows behave identically.

### Chip row (all existing styles, verified)

`.composer-skill-bindings`: `display:flex; flex-wrap:wrap; gap:5px; padding:5px 8px 0; max-height:88px; overflow:auto` — sits between `ComposerAttachments` and the textarea.
`.composer-skill-chip`: `inline-flex; align-items:center; gap:5px; padding:2px 4px 2px 7px; max-width:240px; font-size:12px; line-height:1.35; border:1px solid var(--border,#333); border-radius:7px; background:var(--surface,#161616)`.
- Leading `Bot` icon `size={13}` `aria-hidden`.
- Name `span` truncated (`text-overflow:ellipsis`), `title={binding.source}`.
- Remove `button`: `X` `size={12}`, `padding:3px`, `border-radius:4px`, `disabled={held||busy}` per surface.

### States

| State | Rendering |
|---|---|
| 0 bindings | Chip group unmounted (existing `if (!bindings.length && !retry) return null`). |
| 1–8 bindings | Chips in selection order, wrap to new lines, scroll past 88px. |
| 8 bindings | Popover skill rows disabled with `Limit reached`; no banner needed. |
| Send blocked reasons | Only existing gates (empty draft w/o excerpts or retry, busy, held, no model, `!skillsReady`). Skills never block send. |
| Retry | Keep the existing retry note line (line 125) verbatim. |
| `addSkill` journal write fails | `composer-command-error` shows "Selected skills could not be saved. Keep this workspace open." (message already produced by `useComposerSkills`/`composer.ts`). |
| Send rejected with `SKILL_RESELECT` | Surface the server message "This skill is unavailable or changed. Select it again." through the existing `fail(error)`/`state.error` path; chips stay put so the user can remove and retry. |

Remove `skillsBlocked` and the "Selected skills are unavailable. Remove them to send a new message without skills." banner from all three composers (`App.tsx:301,357,449`; `ScopedConversationComposer.tsx:36,37,54`; `AgentsWorkspace.tsx:184,185,191`; banner at `ComposerCommands.tsx:124`).

### Interactions

- **Remove:** chip X → `onRemove(id)` → `removeSkill`/`remove`. On removal error, the existing save-failure error shows; chip stays.
- **Re-select same skill:** after removal the row becomes selectable again (`Selected` clears because the binding is gone — derived state, no extra store).
- **Draft preserved:** bindings persist in `draft-skills:<threadId>` journal across reload; migration in `App.tsx:340–342` already copies them on thread-key changes.
- **Send accepted:** `clearAcceptedSkills` removes exactly the sent bindings (existing).
- **IME composing:** `isComposing` guards unchanged.
- **Popover behavior unchanged:** Escape, outside dismiss, pagination (`Load more skills`), `unavailableSources` footer, hint footer.

### Motion

- **Chip mount:** `@keyframes` `ui-state-in` (exists in `packages/ui-shell/feedback.css`: `from {opacity:0; transform:translateY(3px)}`) applied to `.composer-skill-chip`, duration `var(--ui-motion-status)` (160ms), easing `var(--ui-ease-enter)` `cubic-bezier(.16,1,.3,1)`, `both` fill.
- **Chip removal:** no exit animation — chip unmounts immediately (removal is rare and the row reflow must not lag; per the no-animation-for-frequent-actions rule).
- **Option select:** none — popover closes via existing `ui-popover-out` (140ms `var(--ui-ease-move)`).
- **Hover on remove X / option rows:** `background-color`/`color` transition `var(--ui-motion-hover)` (120ms) `var(--ui-ease-move)`.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce) { .composer-skill-chip { animation: none; } }` — chip appears instantly; all other motion already covered by `tokens.css`.
- **forced-colors:** existing block covers chip border; add nothing.

## EXECUTION_DAG

| ID | Task | Depends | Files | Tests | Done-when |
|---|---|---|---|---|---|
| T01 | Add `skills` + `onSkill` props to `ComposerCommands`; new `available()` and reason precedence; delete "selection unavailable" status line | — | `ComposerCommands.tsx` | updated snapshot/DOM assertions if any exist (discovery) | skill rows selectable per rules; unavailable rows labelled |
| T02 | Extend `choose` to build binding + call `onSkill` for skill options | T01 | `ComposerCommands.tsx` | manual: select adds chip, token removed, caret restored | click + Enter + `/skill:` prefix all bind |
| T03 | Wire `onSkill` in `App.tsx` (→ `localSkills.add` / `sharedComposers.addSkill`), `ScopedConversationComposer.tsx`, `AgentsWorkspace.tsx` (→ `composers.addSkill`) | T02 | the three files | typecheck | chips appear in all three surfaces |
| T04 | Remove `skillsBlocked` gates and the "Selected skills are unavailable" banner everywhere | T03 | `App.tsx`, `ScopedConversationComposer.tsx`, `AgentsWorkspace.tsx`, `ComposerCommands.tsx` | manual: send enabled with chips | `rg skillsBlocked` → 0 hits |
| T05 | Add `Selected`/`Limit reached` disabled states in list | T01 | `ComposerCommands.tsx` | manual: 9th skill + re-pick disabled | disabled reason text correct |
| T06 | Chip mount animation + reduced-motion rule in `composer-commands.css` | T03 | `composer-commands.css` | visual check + `prefers-reduced-motion` emulation | 160ms enter; instant under RM |
| T07 | Tests: extend/add a composer test covering bind, remove, duplicate, limit, disabled reasons (use the repo's existing web test harness — discovery: find how `App`/composer tests mount; if none exists for the composer, add coverage at the `skillBindingsSchema`/`available` unit level instead and record why) | T04 | `tests/` or colocated | `pnpm exec vitest run <file>` | new tests pass |
| T08 | `pnpm lint && pnpm typecheck`; update checkpoint on issue; hand to QA/reviewer | T01–T07 | — | lint clean | PR opened linking #580 |

No parallel-scope overlap: all edits are in composer-owned files; only T03 spans the three call sites but they are sequential edits by one worker.

## VALIDATION

- Setup: `pnpm install --frozen-lockfile` (already provisioned in this snapshot); `pnpm lint && pnpm typecheck`.
- Manual script (fixture host on :4317 + Vite on :5173 per environment knowledge):
  1. Type `/` → skill rows selectable; Enter binds → chip above textarea, token gone, caret in textarea.
  2. `/skill:` prefix filters and binds the same way.
  3. X on chip removes it; re-pick is allowed.
  4. Bind 8 → 9th row disabled `Limit reached`.
  5. Reopen the popover → bound skills show `Selected` and are not selectable.
  6. Send → request carries `skills`, chips clear on accept.
  7. Reload → chips persist; remove → gone.
  8. `prefers-reduced-motion` emulation → no chip animation.
- Regression: builtins (`/model`, `/plan`, `/default`) still work; empty-draft send stays disabled; unavailability labels unchanged.
- Acceptance matrix: issue criteria = selection→attach works, removal before send works, in all three composer surfaces.

## STATE

Researched + decided: all of the above. Implemented: nothing. Verified: nothing. Pending: T01–T08. Owner: `devin-a-cloud-cac599` (planning only; released after publish). Risks: (a) composer test harness may not exist → T07 fallback specified; (b) `ScopedConversationComposer` send path's `composers.submit` must pass bindings — verified it reads `state.skills` into `ComposerSubmission`. Next step: implementer claims issue #580 and executes T01.

## REFERENCES

- Issue: https://github.com/skytuhua-org/Gen-V1/issues/580
- Plan file: this document (SHA-pinned link added to the issue on publish)
- Key contracts: `packages/contracts/skill-catalog.ts`, `packages/contracts/skill-invocation.ts`, `packages/skill-invocation/index.ts`
- Motion tokens: `packages/ui-shell/tokens.css` (`--ui-motion-status` 160ms, `--ui-motion-hover` 120ms, `--ui-ease-enter` `cubic-bezier(.16,1,.3,1)`, `--ui-ease-move` `cubic-bezier(.4,0,.2,1)`)
