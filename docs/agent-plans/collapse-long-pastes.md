# Feature plan: collapse long pastes into an attachment chip

## META

| Field | Value |
| --- | --- |
| Feature | Collapse long plain-text pastes in the composer into a removable "Pasted text" chip |
| Repository | `skytuhua-org/Gen-V1` |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `8fa907f378127bcfc23d71b55c53625ffc43e8da` (verified with `git rev-parse origin/main` before writing) |
| Size / labels | `feature`, `small` |
| Existing issues / PRs | None for this feature (searched open and closed issues for "paste long text chip" and "pasted text collapse": no matches). Related but distinct: [#1237](https://github.com/skytuhua-org/Gen-V1/issues/1237) paste images into the composer (open) with implementation PR [#1253](https://github.com/skytuhua-org/Gen-V1/pull/1253) (open, not merged) that also edits the textarea `onPaste`; [#1534](https://github.com/skytuhua-org/Gen-V1/issues/1534) "Collapse long prompts in the thread" (transcript display, not the composer) |
| Implementation status | Not started. This document is a plan only; no product code exists for it |
| Provenance | Researched feature proposal (batch 9, item 1) filed directly as a plan at the maintainer's request with no separate approval step; code facts below were read from the baseline SHA |
| Design ownership | There is no separate front-end design pass before implementation. This plan defines the visual design and animation itself (see DESIGN §7). The last task (T09) sends the finished work to the front-end team for review |

## OBJECTIVE

**User problem.** Pasting a long log, stack trace, file or JSON blob into the composer today inserts every line into the textarea. The composer grows to its maximum height, the typed question scrolls out of view, and editing the prompt around the paste becomes awkward. Other agents have the same complaint and have shipped the same fix: Claude Code collapses large pastes into a `[Pasted text #1 +240 lines]` token (requests and an opt-out request: [anthropics/claude-code#97209](https://github.com/anthropics/claude-code/issues/97209), [anthropics/claude-code#23134](https://github.com/anthropics/claude-code/issues/23134)); Codex renders paste "pills" ([openai/codex#59932](https://github.com/openai/codex/issues/59932)) and has a reported failure where very large pastes break the input ([openai/codex#28226](https://github.com/openai/codex/issues/28226)).

**Intended behavior.** When a plain-text paste is longer than a threshold (default: more than 40 lines or more than 4,000 characters), Gen does not insert it into the textarea. It adds a chip to the composer's attachment band that reads `Pasted text · 240 lines` and shows the first line on hover. The user can open the chip to view or edit the text, put it back into the textarea ("Insert as text"), or remove it. Pressing `Ctrl+Z` / `⌘Z` right after the paste puts the text inline instead. On send, the pasted text is serialized into the prompt in a fenced block, the same way terminal excerpts are. Chips survive reloads, named draft save/restore and the move from a new conversation to its created thread. A paste that starts with `/` is never run as a slash command. A Settings row changes the threshold or turns the behavior off.

**Measurable success.**
1. Pasting 41+ lines (or 4,001+ characters) into an empty or non-empty composer adds exactly one chip and leaves the textarea text and caret unchanged.
2. The sent prompt contains the pasted text byte-for-byte (after CRLF→LF normalization) inside a `Pasted text` block, and a composer with no chips produces a prompt identical to today's output.
3. `Ctrl+Z` immediately after the collapse leaves no chip and the text inline at the paste caret; a second `Ctrl+Z` removes the inline text.
4. A reload, a saved-draft save → restore, and sending the first message of a new conversation each keep the chips.
5. With the setting Off, paste behaves exactly as on the baseline.

## REQUIREMENTS

### In scope

| ID | Requirement |
| --- | --- |
| R1 | Collapse a plain-text paste into a chip when the setting is not Off and the normalized text has **more lines than the threshold** or **more than 4,000 characters** (UTF-16 code units, same unit the prompt limit uses). Line count = number of `\n` + 1, not counting one trailing `\n`. |
| R2 | Setting `pasteCollapse` with options Off, 20 lines, 40 lines (default), 100 lines. The 4,000-character rule applies whenever the setting is not Off. |
| R3 | The chip shows a paste icon, the label `Pasted text`, and `· N lines` (`· 1 line` for one line). Its tooltip (`title`) is the first non-empty line, truncated to 80 characters with `…`. |
| R4 | Clicking the chip opens a "Review pasted text" dialog: an editable textarea with the full text, a live `N lines · X KB` count, and buttons Cancel, Insert as text, Save. Save with empty text removes the chip. |
| R5 | The chip has a remove button (`aria-label="Remove pasted text, N lines"`). |
| R6 | "Insert as text" (dialog button) removes the chip and inserts the text into the textarea at the caret (end of the draft when the textarea has not been focused since the chip was created), using the existing `insertDraftText` caret/surrogate handling. |
| R7 | `Ctrl+Z` / `⌘Z` in the textarea immediately after a collapse (no keystroke, draft change, chip edit or blur in between) removes that chip and inserts the text at the caret where it was pasted, as an undoable edit; the next `Ctrl+Z` removes it natively. Any other input clears the "just collapsed" state, after which `Ctrl+Z` is native. |
| R8 | `Ctrl+Shift+V` / `⌘⇧V` always pastes inline (per-paste opt-out, addressing the Claude Code opt-out request). |
| R9 | A non-empty textarea selection at paste time is deleted, as a native paste would, before the chip is added. |
| R10 | On send, the prompt is `typed text`, then each pasted text in chip order, then terminal excerpts, joined with blank lines. Each paste block is `Pasted text · N lines\n<text>\nEnd pasted text`. With no chips the prompt is byte-identical to `serializeTerminalExcerpts(draft, excerpts)` on the baseline. The existing 65,536-character prompt limit covers the whole result. |
| R11 | The send button and the submit shortcut are enabled when there is at least one chip, even with an empty textarea. After a successful send the chips that were sent are cleared; chips added during the send stay. A failed send keeps the chips. |
| R12 | Chips persist in the local journal under `draft-pastes:<threadId>` (same mechanism as `draft:<threadId>` and the excerpt key), so a reload, another window of the same thread and the shared (agents workspace) composer see them. |
| R13 | Saving a named draft stores its chips; restoring it in Replace mode replaces the chips; in Insert mode it appends the saved chips after the current ones (up to the cap). |
| R14 | When the first message of a new conversation creates a thread, the `new` draft's chips move to the new thread's key along with the text. |
| R15 | Text inside a chip is never parsed as a slash command, never opens the command menu and never dispatches `/btw` or `/side`. A side question (`/btw`, `/side`) with chips present is refused with "Side questions can't include pasted text. Insert it as text or remove it." |
| R16 | Up to 8 chips per composer. A 9th long paste falls through to a native inline paste. |
| R17 | A paste larger than 100,000 UTF-8 bytes (the saved-draft text limit) is neither collapsed nor inserted; the composer shows "This paste is N KB. Gen sends at most 64 KB per message. Attach it as a file instead." |
| R18 | A chip whose own block exceeds the 65,536-character prompt limit shows a warning state (see DESIGN §7); sending shows "Prompt, pasted text and excerpts exceed the 64 KB message limit. Shorten or remove a pasted text." and keeps everything. |
| R19 | After a collapse, a polite live region announces "Pasted N lines as an attachment. Press Ctrl+Z to paste inline." (⌘ on macOS); the same hint shows in the composer caption until the next draft change or 6 seconds, whichever is first. |
| R20 | Image-only clipboard data keeps the #1237 behavior. When the clipboard has non-whitespace `text/plain`, text handling runs first (consistent with #1237 R2: text wins over images). |
| R21 | Disabled composer (`!ready`), busy or retry states: paste falls through to the baseline behavior (textarea is disabled or the paste is native); no chip is created while a send is in flight. |

### Out of scope

- Inline placeholder tokens inside the textarea (Claude Code's `[Pasted text #1]` style). v1 chips live in the attachment band and are appended after the typed text; the paste position in the sentence is not preserved. Rationale: tokens need cursor-aware atomic deletion and a second serialization path.
- Collapsing pastes into other text inputs (thread rename, settings, search, dialogs).
- Paste images (#1237), `@` mentions/resources, drag-and-drop files, terminal excerpts behavior changes.
- Converting a paste to a file attachment or upload; syntax highlighting in the dialog.
- Prompt history (up-arrow) recall of chips.
- Changing the 64 KiB message limit.

### UX, compatibility, performance, security, privacy, accessibility

- **Compatibility.** Older journal data has no `draft-pastes:` key: read as `[]`. Older preferences have no `pasteCollapse`: `readPreferences` spreads `DEFAULT_PREFERENCES`, so the default `'40'` applies (verified at `packages/contracts/preferences.ts:83-86`). Saved drafts gain an optional `pastes` field (see DESIGN §5 for the downgrade risk).
- **Performance.** Threshold check is a single pass over the clipboard string; no re-render of the textarea for collapsed pastes (that is the point). Chip list is at most 8 items. The dialog textarea mounts only when open.
- **Security.** Pasted text is untrusted user content: render as text only (React text nodes / textarea value), never as HTML/Markdown in the chip or dialog. It is never executed or parsed as a command (R15). Only `text/plain` is read; `text/html` is ignored.
- **Privacy.** Pasted text stays in the same local journal as the draft text today and is sent only when the user sends. Do not log pasted content, line counts with content, or first lines to telemetry or console.
- **Accessibility.** Chip open and remove controls are real `<button>`s with names (`Pasted text, 240 lines. Open to review`), focus-visible rings from existing tokens, keyboard reachable in tab order after the textarea's attachment band; dialog uses the existing `Modal` focus trap and returns focus to the chip (or textarea after Insert as text / removal of the last chip). Live region per R19. Animations honor reduced motion (DESIGN §7).
- **Error/recovery.** Journal write failure: keep the chip in memory, show "Pasted text could not be stored locally. Keep this tab open." (mirrors the draft error). Compare-and-swap conflicts retry 8 times then show "Pasted text changed in another window. Retry." Nothing is ever silently dropped: if a chip cannot be created, the paste falls through to native inline paste.

## REPO_MAP

Verified at `8fa907f` unless marked **discovery**.

| Path | What is there | Change |
| --- | --- | --- |
| `apps/web/src/App.tsx` | Main composer. Textarea `onPaste={prediction.dismiss}` (no other paste handling). `updateDraft` writes `draft:<target>` via `journalWrite`, or `sharedComposers.edit` for shared targets. `send()` guards on `!draft.trim() && !excerpts.length && !retry`, captures `submittedDraft`, reads excerpts with `readTerminalExcerpts`, builds `submittedPrompt = serializeTerminalExcerpts(submittedDraft, submittedExcerpts)`. `memoryPrompt` also calls `serializeTerminalExcerpts`. Side questions call `onSide(draft.trim(), …)` (line ~362). `migrateDraft(id, fallback, retireSource)` (line ~334) copies `draft:<key>` to the created thread; `draft:new` is cleared around line ~1207. onKeyDown handles `/btw`/`/side` with a regex on `draft.trim()`, then `commands.current?.keyDown`, prediction, Tab, submit | Paste handler, undo, chip state, send/serialize, side refusal, migration |
| `apps/web/src/ComposerAttachments.tsx` | Attachment band: resources plus `excerpts.map(... <TerminalExcerpt .../>)`; resource exit animation via a `data-leaving` cache that checks `reducedMotion()` (from `./task-motion`) and `data-panel-animations` | Render paste chips between resources and excerpts |
| `apps/web/src/TerminalExcerpt.tsx` | Closest existing chip: `.terminal-excerpt-chip` with an edit button opening a `Modal`, a remove button with `aria-label`, error text | Pattern for `PastedText.tsx` |
| `apps/web/src/terminal-excerpts.ts` | `terminalExcerptSchema` (zod, strict), `readTerminalExcerpts`, `serializeTerminalExcerpts` (throws when result `> 64*1024`), `excerptDraftKey`, `changeTerminalExcerpts` (journal CAS, 8 attempts), `clearAcceptedExcerpts`, `TERMINAL_EXCERPT_MAX_COUNT` | Unchanged; wrapped by the new serializer |
| `apps/web/src/terminal-excerpts.css` | Chip and modal styles | Visual reference for `pasted-text.css` |
| `apps/web/src/styles.css` | `.resource-chip` base style (line ~162); `@keyframes ui-item-in` (line ~354), `.resource-chip:not([data-leaving])` enter and `[data-leaving]` `ui-item-out` exit rules (lines ~358-359) | Add `.pasted-text-chip` to those two `:where()` motion selectors |
| `apps/web/src/composer-entry.css` | Attachment band and resource chip variants | Possibly band gap only (discovery) |
| `packages/ui-shell/tokens.css` | Motion tokens `--ui-motion-insert: 180ms`, `--ui-motion-remove: 140ms`, `--ui-ease-enter`, `--ui-ease-move`, `--ui-motion-hover: 120ms` | Use, do not change |
| `apps/web/src/saved-drafts.ts` | `savedDraftSchema` (strict; `text`, `resourceRefs`, `skills`, `excerpts`, optional `sourceContext`), `saveNamedDraft` reads `draft:`, skills, excerpts and source keys, `planDraftRestore`, `restoreSavedDraftText(owner, plan, mode, caret)` writes `draft:` + library with `journalCompareAndSwapMany`, `insertDraftText(current, text, caret)`; `SAVED_DRAFT_MAX_BYTES` text limit | Add optional `pastes`; save and restore them |
| `apps/web/src/agents-workspace/composer.ts` | Shared composer store: `ComposerState` (has `excerpts`), `ComposerSubmission {content, generation, skills, excerpts?, excerptGeneration?}`, `PendingSend` (stores `excerpts`), journal subscription to `excerptDraftKey`, `addExcerpt`, submission clears accepted excerpts | Mirror for pastes |
| `packages/contracts/preferences.ts` | `UiPreferences` and `DEFAULT_PREFERENCES` (`sendShortcut: 'enter'`, `composerPredictions: false`, …); `readPreferences` spreads defaults | Add `pasteCollapse` |
| `apps/web/src/Settings.tsx` | `SETTINGS_ROWS`; chat rows include `'send-shortcut'` with `options`/`labels`/`description` | Add `'paste-collapse'` row |
| `apps/web/src/settings-inventory.ts` | `T3_SETTINGS_ROWS`, hash-locked in `tests/shell-settings.test.ts` (sha256 + length 136) | **Do not edit** (it is an inventory of another product's settings); confirm the new row does not need to appear there (discovery in T02) |
| `tests/terminal-excerpts.test.ts`, `tests/saved-drafts.test.ts`, `tests/shell-settings.test.ts` | Unit tests to mirror / extend | Extend |
| `tests/e2e/terminal-excerpts.spec.ts` + `-fixture.tsx` + `.playwright.config.ts` + `.vite.config.ts`; `scripts/browser-suites.ts` (`suite('terminal-excerpts')`) | Browser-suite pattern | New `pasted-text` suite |
| `docs/feature-map.md` | Feature list (PR #1253 adds a row there) | Add a row |
| UI guard tests (discovery: `pnpm test:ui-guard` or the script named in `package.json`) | Static checks for numeric rendering | Render counts through strings |

Open work that overlaps: PR #1253 rewrites the same `onPaste` attribute. Whichever lands second rebases; the combined handler order is fixed in DESIGN §2.

## DESIGN

### 1. Data model (new `apps/web/src/pasted-text.ts`)

```ts
export const PASTED_TEXT_MAX_COUNT = 8;
export const PASTED_TEXT_MAX_BYTES = 100_000;          // same as SAVED_DRAFT_MAX_BYTES
export const PASTE_COLLAPSE_CHARS = 4_000;
export const pastedTextSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  text: z.string().min(1).refine(t => new TextEncoder().encode(t).length <= PASTED_TEXT_MAX_BYTES),
}).strict();
export type PastedText = z.infer<typeof pastedTextSchema>;
export const pasteDraftKey = (threadId: string) => `draft-pastes:${threadId}`;
export function readPastedTexts(value: unknown): PastedText[];       // undefined -> [], validates, max count
export function normalizePaste(text: string): string;                // \r\n and lone \r -> \n
export function countLines(text: string): number;                    // \n count + 1, minus one trailing \n
export function shouldCollapse(text: string, setting: PasteCollapse): boolean;
export function firstLine(text: string): string;                     // first non-empty line, 80 chars + …
export function serializeComposerPrompt(text: string, pastes: readonly PastedText[], excerpts: readonly TerminalExcerpt[]): string;
export async function changePastedTexts(threadId: string, update: (current: PastedText[]) => PastedText[]): Promise<void>; // CAS x8 like changeTerminalExcerpts
export async function clearAcceptedPastes(threadId: string, accepted: readonly string[]): Promise<void>;
```

Line count is derived, not stored, so editing the text in the dialog cannot leave a stale count.

### 2. Paste control flow (App.tsx textarea `onPaste`)

```
onPaste(event):
  prediction.dismiss()
  if inlineOverride (Ctrl/⌘+Shift+V keydown seen < 500 ms ago) -> clear flag; return  // native
  raw = event.clipboardData.getData('text/plain')
  if raw.trim():
    text = normalizePaste(raw)
    if bytes(text) > PASTED_TEXT_MAX_BYTES: preventDefault; setError(R17 copy); return
    if busy || retry || !shouldCollapse(text, preferences.pasteCollapse) || pastes.length >= 8: return // native
    preventDefault
    caret = input.selectionStart; if selectionStart !== selectionEnd: document.execCommand('delete')  // R9, keeps undo
    chip = {version:1, id: crypto.randomUUID(), createdAt: now, text}
    add chip (local state + changePastedTexts / sharedComposers.addPaste)
    justCollapsed = {id: chip.id, caret: input.selectionStart, draft: draftLatest.current}
    announce (R19)
    return
  // no text: #1237 image path (PR #1253 pastedImageFiles) runs here unchanged
```

The image branch from #1253 stays after the text branch. If #1253 has not merged when this lands, the text branch is the only addition.

### 3. Undo and inline override (onKeyDown, before the command menu)

- `Ctrl/⌘+Z` without Shift and `justCollapsed` set, and `draftLatest.current === justCollapsed.draft`, and the chip still exists: `preventDefault`; remove the chip; focus; `setSelectionRange(caret, caret)`; `document.execCommand('insertText', false, text)` so the browser undo stack owns the inline text; `updateDraft(input.value)` via the normal `onChange`. Fallback if `execCommand` returns `false`: `insertDraftText(draft, text, caret)` + `updateDraft` + set caret (undo stack then loses the step; acceptable fallback, covered by a unit test of the pure path).
- Any other keydown (except bare modifiers), `onChange`, chip edit/remove, or textarea blur clears `justCollapsed`.
- `Ctrl/⌘+Shift+V` keydown sets `inlineOverride = performance.now()`; consumed by the next paste.

### 4. Send and serialization

```ts
export function serializeComposerPrompt(text, pastes, excerpts) {
  const blocks = readPastedTexts(pastes).map(p => `Pasted text · ${lineLabel(countLines(p.text))}\n${p.text}\nEnd pasted text`);
  if (!blocks.length) return serializeTerminalExcerpts(text, excerpts);          // byte-identical baseline
  try { return serializeTerminalExcerpts([text.trim(), ...blocks].filter(Boolean).join('\n\n'), excerpts); }
  catch { throw Error('Prompt, pasted text and excerpts exceed the 64 KB message limit. Shorten or remove a pasted text.'); }
}
```

`lineLabel(1) = '1 line'`, otherwise `'N lines'`. Pasted text inside the block is not trimmed. `send()`: guard becomes `!draft.trim() && !excerpts.length && !pastes.length && !retry`; snapshot `submittedPastes` and the journal generation of `pasteDraftKey(key)` next to `submittedExcerptGeneration`; build `submittedPrompt = serializeComposerPrompt(submittedDraft, submittedPastes, submittedExcerpts)`; after the run is accepted, `clearAcceptedPastes(key, submittedPastes.map(p => p.id))`. `memoryPrompt` uses the same function. Side-question branch: if `pastes.length`, `setError(R15 copy)` and return before `onSide`. Every other place that tests `draft.trim()` to enable a send control (e.g. queue-after-current) also accepts `pastes.length` (discovery: `grep -n "draft.trim()" apps/web/src/App.tsx`).

Slash commands (R15): the command menu, `/btw` regex and prediction read only `draft`. Chips never write to `draft`, so pasted text can never reach them. Tests pin this.

Shared composer (`agents-workspace/composer.ts`): add `pastes` to `ComposerState`, `pastes?`/`pasteGeneration?` to `ComposerSubmission`, `pastes?` to `PendingSend` (validated with `readPastedTexts` on load like `pending.excerpts`), a journal subscription on `pasteDraftKey(identity(agent))`, and `addPaste` / `editPaste` / `removePaste` methods with the same ownership checks as `addExcerpt`; submission serializes with `serializeComposerPrompt` and clears accepted pastes.

### 5. Persistence, saved drafts, migration

- Journal key `draft-pastes:<threadId>`, value `PastedText[]`, written only through `changePastedTexts` (CAS). Subscribe for cross-window updates like the excerpt subscription.
- `savedDraftSchema` gains `pastes: z.array(pastedTextSchema).max(PASTED_TEXT_MAX_COUNT).optional()`; version stays `1`. `saveNamedDraft` reads `pasteDraftKey(threadId)` in the same `Promise.all` and includes its generation in the CAS guard list; total UTF-8 bytes of `text` + all paste texts must be ≤ `SAVED_DRAFT_MAX_BYTES`, else "This draft is too large to save. Remove a pasted text." Restore: `restoreSavedDraftText` adds the paste key to `journalCompareAndSwapMany` — Replace writes `draft.pastes ?? []`; Insert writes current + saved (new UUIDs for duplicates), refusing with "Too many pasted texts. Remove one and retry." above 8. The "has no text to restore" check accepts a record with pastes but empty text. The "Before replacing" recovery draft also keeps the replaced pastes.
- `migrateDraft`: read `draft-pastes:<key>` and write it to `draft-pastes:<id>` in the same step that copies the text; when `retireSource`, clear the source key with the text.
- **Rollback / downgrade risk.** An older build parses saved drafts with a strict schema, so a library containing a record with `pastes` fails to load in that build. Rolling back the code therefore hides saved drafts that contain chips until the user upgrades again; data is not deleted. Reviewers decide whether this is acceptable or whether the saved-draft change should first ship as a read-tolerant schema in a separate release. Journal `draft-pastes:` keys are ignored by older builds (the chips simply do not show).

### 6. Settings

`packages/contracts/preferences.ts`: `pasteCollapse: z.enum(['off', '20', '40', '100'])` (string enum to match how `SETTINGS_ROWS` options are strings) in the schema and `UiPreferences`, default `'40'`. `Settings.tsx` chat section row:

```ts
'paste-collapse': { key: 'pasteCollapse', options: ['off', '20', '40', '100'],
  labels: ['Off', 'Over 20 lines', 'Over 40 lines', 'Over 100 lines'],
  description: 'Long pastes become an attachment chip. Pastes over 4,000 characters also collapse. Ctrl+Shift+V pastes inline.' },
```

Title "Collapse long pastes", placed after `send-shortcut`. Use the same control type as `send-shortcut` (discovery: confirm the row renderer handles a 4-option string enum).

### 7. Visual design and animation (self-contained; no separate design pass)

- **Placement.** Paste chips render in the existing attachment band above the textarea, after resource chips and before terminal excerpt chips, in creation order. The band wraps like today.
- **Chip.** New `apps/web/src/pasted-text.css`, `.pasted-text-chip`: same shape as `.terminal-excerpt-chip` — inline-flex, `gap: 4px`, `border: 1px solid var(--border)`, the same radius as `.resource-chip` (6px), background `var(--surface)` (discovery: use whatever background token `.terminal-excerpt-chip` uses so the two chips match exactly), height matching resource chips, `font-size: 12px` (shell rule), `max-width: 260px`. Contents: lucide `ClipboardPaste` icon at 12px (fallback `FileText` if the installed lucide version lacks it — check `apps/web/package.json` version), `Pasted text` in `var(--text)`, then `· 240 lines` in `var(--muted)` with `font-variant-numeric: tabular-nums`; label ellipsizes, the count never wraps. Remove button: `X` icon 12px, 20×20 hit area, `quiet` button class, same as the excerpt chip.
- **States.** Hover: border to `var(--border-strong)` (or the hover token the excerpt chip uses), transition `var(--ui-motion-hover)`. Focus-visible: existing focus ring. Disabled (composer busy): `opacity: .6`, like `.resource-chip-readonly`. Over-limit (R18): `data-over-limit` → border and count in `var(--danger)` (discovery: exact danger token name in `tokens.css`), `AlertTriangle` icon replaces the paste icon, `title` "Too long to send (limit 64 KB). Edit or remove it."
- **Dialog.** Existing `Modal`, title "Review pasted text", width `min(720px, calc(100vw - 48px))`. Body: `<textarea>` in the code font (`var(--font-mono)` or the token the excerpt dialog uses), `min-height: 240px`, `max-height: 60vh`, `white-space: pre`, horizontal scroll, `spellcheck=false`. Footer: left, muted live count `240 lines · 12.3 KB`; right, `Cancel` (secondary), `Insert as text` (secondary), `Save` (primary). Escape = Cancel.
- **Caption hint (R19).** Muted text in the composer caption: "Pasted as attachment · Ctrl+Z to paste inline" (⌘Z on macOS).
- **Animation.** Enter: add `.pasted-text-chip:not([data-leaving])` to the existing `ui-item-in` rule (`opacity 0 → 1`, `translateY(4px) → 0`, `var(--ui-motion-insert)` 180ms, `var(--ui-ease-enter)`). Exit (remove, Insert as text, undo, send-clear): reuse the `data-leaving` cache pattern from `ComposerAttachments.tsx` so the chip plays `ui-item-out` for `var(--ui-motion-remove)` 140ms with `var(--ui-ease-move)`, `pointer-events: none`, then unmounts. No animation on the textarea or caption. With reduced motion (`reducedMotion()`) or `data-panel-animations="false"`, chips appear and disappear instantly (same checks the resource chip cache uses). Dialog uses the `Modal` default motion.

### 8. Error handling summary

| Case | Behavior |
| --- | --- |
| Journal write fails | Chip kept in memory; composer error "Pasted text could not be stored locally. Keep this tab open." |
| CAS conflict ×8 | "Pasted text changed in another window. Retry."; no data lost |
| Paste > 100,000 bytes | Not inserted; R17 message |
| Prompt > 65,536 chars | Send refused, chips kept; R18 message |
| 9th long paste | Native inline paste |
| Corrupt journal value | `readPastedTexts` throws → composer not ready with "Pasted text drafts could not be read." (mirrors excerpt handling at composer.ts line ~89) |
| Send fails | Chips kept; retry resends from `PendingSend.pastes` |

## EXECUTION_DAG

T01 → T02 → (T03, T04, T05 in parallel) → T06 → T07 → T08 → T09. Ownership boundaries are per file as listed; T03/T04/T05 do not share files.

### T01 — Pasted-text model and serializer
- **Goal:** pure module for schema, thresholds, line counting, serialization and journal helpers.
- **Depends on:** none.
- **Files:** new `apps/web/src/pasted-text.ts`, new `tests/pasted-text.test.ts`.
- **Steps:** implement DESIGN §1 and §4 `serializeComposerPrompt`; `changePastedTexts`/`clearAcceptedPastes` copy the structure of `changeTerminalExcerpts`/`clearAcceptedExcerpts`.
- **Tests (+):** 40 lines no collapse at `'40'`, 41 lines collapse; 4,001 chars on one line collapse; `'off'` never collapses; trailing newline not counted; CRLF normalized; `serializeComposerPrompt(t, [], e) === serializeTerminalExcerpts(t, e)` for fixtures; block format and ordering text → pastes → excerpts; pasted text not trimmed; `1 line` label. **(−):** >100,000 bytes rejected by schema; 9 items rejected; over 65,536 chars throws the R18 message; unknown keys rejected (strict).
- **Done when:** `pnpm vitest run tests/pasted-text.test.ts` (discovery: exact test command in `package.json`) passes. **Handoff:** T02 owner.

### T02 — Preference and Settings row
- **Goal:** `pasteCollapse` preference with default `'40'` and the Settings row (DESIGN §6).
- **Depends on:** T01 (for the `PasteCollapse` type, or define the type in contracts and import it in T01).
- **Files:** `packages/contracts/preferences.ts`, `apps/web/src/Settings.tsx`, `tests/shell-settings.test.ts` (only if it asserts a row list), contract tests that snapshot defaults (discovery: `grep -rn "composerPredictions" tests`).
- **Tests (+):** missing key reads `'40'`; each option persists; row renders under Chat after Send shortcut. **(−):** invalid value (`'50'`) falls back to default; `T3_SETTINGS_ROWS` hash test still passes unchanged.
- **Done when:** settings/contract tests pass. **Handoff:** T03–T05 owners.

### T03 — Chip component, dialog, styles and motion
- **Goal:** `PastedTextChip` + "Review pasted text" dialog + CSS + band rendering (DESIGN §7, R3–R6, R18).
- **Depends on:** T01.
- **Files:** new `apps/web/src/PastedText.tsx`, new `apps/web/src/pasted-text.css`, `apps/web/src/ComposerAttachments.tsx` (new props `pastes`, `onEditPaste`, `onRemovePaste`, `onInsertPaste`), `apps/web/src/styles.css` (two `:where()` selectors only).
- **Tests (+):** component test renders label/count/tooltip; dialog Save edits, empty Save removes, Insert as text calls `onInsertPaste`; remove button name; leaving animation attribute set then unmounted; reduced motion skips it. **(−):** HTML in pasted text renders as literal text; disabled state blocks actions; UI guard passes.
- **Done when:** component tests + UI guard pass; screenshot of the chip in light and dark themes captured for T09. **Handoff:** T06.

### T04 — Shared composer store support
- **Goal:** pastes in `agents-workspace/composer.ts` (DESIGN §4 last paragraph).
- **Depends on:** T01.
- **Files:** `apps/web/src/agents-workspace/composer.ts` and its tests (discovery: `ls tests | grep -i composer`).
- **Tests (+):** subscription emits pastes; submission content includes blocks; accepted pastes cleared, later ones kept; pending send reload keeps pastes. **(−):** wrong owner rejected like `addExcerpt`; corrupt value → not ready.
- **Done when:** composer store tests pass. **Handoff:** T06.

### T05 — Saved drafts and restore
- **Goal:** DESIGN §5 saved-draft changes (R13).
- **Depends on:** T01.
- **Files:** `apps/web/src/saved-drafts.ts`, `tests/saved-drafts.test.ts`, `tests/saved-drafts-suspended-audit.test.ts` if affected.
- **Tests (+):** save includes pastes; Replace restores them; Insert appends; pastes-only draft restorable; existing records without `pastes` still load. **(−):** combined size over limit refused; 9 pastes after Insert refused; concurrent paste change makes save/restore CAS fail with no partial write.
- **Done when:** saved-draft tests pass. **Handoff:** T06.

### T06 — Composer integration in App.tsx
- **Goal:** paste handler, undo, inline override, chip state, send/memory serialization, side refusal, migration, live region and caption (DESIGN §2–§5, R1, R7–R12, R14–R17, R19–R21).
- **Depends on:** T02, T03, T04, T05.
- **Files:** `apps/web/src/App.tsx` only (plus `docs/feature-map.md` row).
- **Steps:** load and subscribe to `pasteDraftKey(draftTarget)` (local) or read `sharedState.pastes` (shared); wire `ComposerAttachments` props; implement handlers; update every send-enable check; migrate in `migrateDraft`; rebase over #1253 if merged, keeping text-before-image order.
- **Tests:** covered by T07; locally run the unit suites from T01–T05 and `pnpm typecheck` (discovery: script name).
- **Done when:** typecheck and unit tests pass and manual smoke in the dev server shows a chip on a 50-line paste. **Handoff:** T07.

### T07 — Browser suite
- **Goal:** end-to-end coverage in a `pasted-text` Playwright suite modeled on `terminal-excerpts`.
- **Depends on:** T06.
- **Files:** new `tests/e2e/pasted-text.spec.ts` (+ fixture/config files only if the excerpt suite pattern requires them), `scripts/browser-suites.ts` (`suite('pasted-text')`).
- **Scenarios:** A1 50-line paste → one chip, textarea unchanged; A2 Ctrl+Z restores inline, second Ctrl+Z removes; A3 typing then Ctrl+Z is native (chip stays); A4 Ctrl+Shift+V inline; A5 dialog edit/Save/Insert as text/remove; A6 send → request body contains block, chips cleared; A7 reload keeps chips; A8 new conversation first send keeps chips on the created thread until sent; A9 saved draft save/restore; A10 paste starting `/btw` or `/plan` → chip, no command menu, sent as text; A11 setting Off → native paste; A12 >100,000 bytes → error, nothing inserted; A13 reduced motion → no animation; A14 keyboard-only: Tab to chip, Enter opens dialog, focus returns; A15 image-only paste unchanged (if #1253 merged).
- **Done when:** suite passes locally and in CI. **Handoff:** T08.

### T08 — Regression and PR
- **Goal:** full checks and a PR linked to this issue.
- **Depends on:** T07.
- **Steps:** run the repository's full unit, typecheck, lint, UI guard and browser suites per `CONTRIBUTING.md`; add new source files to `scripts/public-source-files.json` per the contribution guide; open the PR referencing this issue with test evidence and chip screenshots/recording.
- **Done when:** CI green, PR open and linked, checkpoint posted on this issue. **Handoff:** T09.

### T09 — Front-end team review
- **Goal:** send the finished work to the front-end team for review, since no design pass happened before implementation.
- **Depends on:** T08.
- **Steps:** request review from the front-end team on the PR (discovery: the team handle in `CODEOWNERS` or as named by the maintainer); include light/dark screenshots of the chip, over-limit state and dialog, a recording of paste → undo → re-paste → dialog → send, and the list of visual decisions from DESIGN §7 they should confirm or change; apply their changes and update this plan if a decision changes.
- **Done when:** front-end review is approved or its requested changes are merged; RELEASE checkpoint posted on this issue.

## VALIDATION

**Planned (none executed yet; this is a plan).**

| Level | Command / method | Expected |
| --- | --- | --- |
| Unit | `pnpm vitest run tests/pasted-text.test.ts tests/saved-drafts.test.ts tests/shell-settings.test.ts` + composer store tests (discovery: confirm runner) | All pass |
| Types/lint/UI guard | repository `typecheck`, `lint`, UI guard scripts (discovery from `package.json`) | Clean |
| Browser | `pasted-text` suite via `scripts/browser-suites.ts` (scenarios A1–A15) | All pass |
| Regression | `terminal-excerpts`, saved drafts, composer image paste (#1237) suites and existing composer tests | Unchanged results |
| Real user | Dev server: paste a 300-line log, edit in dialog, send; check the transcript prompt; reload; Settings Off | Matches R1–R21 |

**Acceptance matrix.**

| Req | Task | Check |
| --- | --- | --- |
| R1, R2 | T01, T02, T06 | T01 threshold tests; A1, A11 |
| R3, R5, R18 | T03 | component tests; T09 screenshots |
| R4, R6 | T03, T06 | A5 |
| R7 | T06 | A2, A3 |
| R8 | T06 | A4 |
| R9 | T06 | A1 variant with selection |
| R10 | T01, T06 | serializer tests; A6 |
| R11 | T04, T06 | composer store tests; A6 |
| R12 | T01, T04, T06 | A7 |
| R13 | T05 | saved-draft tests; A9 |
| R14 | T06 | A8 |
| R15 | T06 | A10 + side-refusal unit/browser check |
| R16 | T01, T06 | count tests; 9th-paste browser check |
| R17 | T01, T06 | A12 |
| R19 | T06 | live region assertion in A1 |
| R20 | T06 | A15 |
| R21 | T06 | busy-state browser check |
| Motion/a11y | T03, T07 | A13, A14 |
| Design review | T09 | front-end approval |

**Release gate:** CI green on the implementation PR, acceptance matrix all checked with evidence on this issue, front-end review approved (T09), and a reviewer decision recorded on the saved-draft downgrade risk (DESIGN §5).

## STATE

| Area | State |
| --- | --- |
| Research | Done: competitor behavior and issues (REFERENCES), code paths verified at `8fa907f` |
| Decisions | Made in this plan: chips in the attachment band (no inline tokens), thresholds Off/20/40/100 lines + 4,000 chars, block format, ordering, 8-chip cap, 100,000-byte paste cap, Ctrl+Shift+V override, side-question refusal, visual design and motion |
| Open for reviewers | Saved-draft downgrade risk (DESIGN §5); front-end confirmation of DESIGN §7 (T09) |
| Implemented / verified | Nothing; no implementation branch exists |
| Owners | None; T01 is unclaimed |
| Overlap | PR #1253 (#1237) edits the same `onPaste`; rebase order in DESIGN §2 |
| Next step | An implementing worker claims T01 on this issue and creates `apps/web/src/pasted-text.ts` with `tests/pasted-text.test.ts` |

## REFERENCES

- Claude Code: collapse long pastes request — https://github.com/anthropics/claude-code/issues/97209 (pastes shown as `[Pasted text #N +X lines]` instead of flooding the input).
- Claude Code: opt-out request — https://github.com/anthropics/claude-code/issues/23134 (users want a way to paste inline; covered by the Off setting and Ctrl+Shift+V).
- Codex: paste pills — https://github.com/openai/codex/issues/59932 (large pastes shown as removable pills in the composer).
- Codex: large paste failure — https://github.com/openai/codex/issues/28226 (very large pastes break the input; motivates R17's explicit size refusal instead of a broken composer).
- Gen-V1 #1237 paste images into the composer — https://github.com/skytuhua-org/Gen-V1/issues/1237; implementation PR #1253 — https://github.com/skytuhua-org/Gen-V1/pull/1253.
- Gen-V1 #1534 collapse long prompts in the thread (transcript, distinct) — https://github.com/skytuhua-org/Gen-V1/issues/1534.
- Code at baseline: `apps/web/src/App.tsx`, `apps/web/src/ComposerAttachments.tsx`, `apps/web/src/TerminalExcerpt.tsx`, `apps/web/src/terminal-excerpts.ts`, `apps/web/src/saved-drafts.ts`, `apps/web/src/agents-workspace/composer.ts`, `packages/contracts/preferences.ts`, `apps/web/src/Settings.tsx`, `apps/web/src/styles.css`, `packages/ui-shell/tokens.css` at https://github.com/skytuhua-org/Gen-V1/tree/8fa907f378127bcfc23d71b55c53625ffc43e8da
