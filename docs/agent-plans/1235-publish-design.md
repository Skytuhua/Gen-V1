# Design and animation spec: Commit, push and PR from a thread (issue #1235, task T09)

## META
- Feature: visual design and motion spec for the thread "Publish" flow — review sheet, step progress, in-thread PR card, recovery.
- Repo: skytuhua-org/Gen-V1
- Spec revision: r1, 2026-11-21 (UTC)
- Baseline: `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52`
- Implementation plan: `docs/agent-plans/thread-publish-pr.md @ 5c18b5e` (issue #1235), task T09
- Status: DESIGN ONLY. Implementers build exactly what is written here; this file is the complete design decision record — no open choices.
- Source provenance: `DESIGN.md` (visual contract, motion tokens), `packages/ui-shell/tokens.css`, `apps/web/src/shell.css`, `apps/web/src/workspace-tools.css`, `apps/web/src/WorkspaceSurfaceBody.tsx` (PullRequestsBody, prJournalSchema, checkSummary), `apps/web/src/ComposerToolbar.tsx`, `apps/web/src/ProjectContextCard.tsx`.

## OBJECTIVE
The user reviews exactly what will be published and approves once. The sheet reads as a review, not a form: content first, one action. After approval, progress is honest per step and the result is a small PR card inside the thread. The feature is behind `workspace.publishV1` (off by default); when off, zero visual change.

Measurable: the review fits in one screen at 100% zoom on the default 760px chat width; every state named in this spec renders identically to the tokens it cites.

## SHARED DECISIONS
- All values use existing tokens and classes. No new color, shadow, radius or duration is introduced. New CSS goes in `apps/web/src/publish.css`, scoped under `.publish-*`.
- Surfaces: `--surface`, border `--border`, text `--text`, secondary text `--muted`, mono `--font-mono`, selection `--selection-bg`, success `--ok`, warning `--warning`/`--warning-bg`, error `--danger`.
- Radius: cards and panels 10px; small inline chips/inputs 4px (existing pattern in workspace-tools.css); badges 4px.
- Type: sheet title 14px/600, section heads 13px/600, body 13px/1.5, notes 12px `--muted`, mono facts 11px `--font-mono`.
- Spacing: dialog inset `--ui-dialog-inset` (24px); section gaps 12px (`--ui-panel-inset`); row gaps 8px.
- Mode: Operate. Compact, dense, no decoration (per DESIGN.md and S's compact preference).

## 1. Composer chip (entry point)
- Existing `.composer-pr` chip keeps its position and size. Label changes only when the flag is on and the thread has a writable managed copy: icon `GitBranch` (unchanged) + text `Publish PR`.
- `aria-label="Publish draft PR"`, `title="Review and publish these changes to GitHub"`. When `working` (active run), chip stays enabled-looking but `title="Wait for the active run to finish"` and `disabled` — identical to today.
- When flag off or no managed copy: byte-for-byte current behavior (inserts prompt text, label "Create PR").

## 2. Publish review sheet
- Shared Modal primitive: `<dialog class="ui-modal publish-review">`, `width: min(560px, calc(100vw - 32px))`, `max-height: calc(100dvh - 64px)`, inset 24px, radius 12px, `--border`, backdrop `var(--ui-modal-scrim)` + `blur(6px)` (already global on `dialog:modal::backdrop`).
- Header: `.ui-modal-header` — title `Review and publish` (14px/600) at top; below it one `--muted` 12px line: `<branch name> → <base branch>` (mono for branch names). Close button top-right, `aria-label="Close"`, 32px target.
- Body (`display:grid; gap:12px`), in order:
  1. **Files** — head row: `Files to publish` (13px/600) + right-aligned count `<n> selected`. List inside `border:1px solid --border; border-radius:8px; max-height:220px; overflow:auto`. Rows 32px (`--ui-row-compact`), `padding:6px 10px`, separated by `1px --border` like `.pr-check-list`. Each row: 16px checkbox (`accent-color: var(--control-accent,current)` is NOT allowed — use default checkbox or shared control; unchecked = excluded), mono path truncated middle-ellipsis, then right-aligned `+added` (`--ok`) `−removed` (`--danger`) 12px, and `untracked` badge (2px/6px padding, 4px radius, 11px, `--muted` border) for new files.
  2. **Commit message** — label `Commit message`; single-line input, 36px, mono 12px, prefilled (thread title, 72 chars max).
  3. **Base branch** — label `Base branch`; single-line input 36px mono, prefilled from `defaultBranch`. When fallback `main` is used, note under field (12px `--muted`): `Default branch could not be read — check this before publishing.`
  4. **Pull request** — label; Title input 36px (prefilled, 200 max), Description textarea `min-height:90px` 13px (prefilled template, 64000 max).
  5. Inline `GitHubSignIn` region appears under the header (not in body order) when `GITHUB_AUTH_REQUIRED`.
- Errors: banner above footer, `border:1px solid --border; border-radius:8px; padding:8px 10px; background:var(--warning-bg); font-size:12px; line-height:1.5`. Copy verbatim:
  - `GitHub sign-in required.` → renders `GitHubSignIn` instead of fields.
  - `This repository has no GitHub remote.` (`GITHUB_REMOTE_REQUIRED`)
  - `This working copy is read-only.` (`PROJECT_READ_ONLY`)
  - `The working copy changed. Review it again.` (`REVISION_CHANGED` — sheet reloads draft behind the dialog, fields refresh)
  - `The GitHub branch changed. Refresh and review again.` (push rejected)
  - `The result is unclear. Check what happened before retrying.` (`UNCERTAIN`)
- Footer: right-aligned `Cancel` (secondary) + primary `Commit, push and open draft PR`. Primary disabled while any field is empty or busy; shows `aria-busy` while running.
- Empty tree edge: when there are no changed files but the branch is ahead of base, the Files section shows one 32px row `Nothing to commit — the branch will be pushed as-is.` (12px `--muted`).

## 3. Step progress (during execution)
- On approve, body replaces with a step list (`role="status"`), same `gap:8px`, three steps:
  1. `Commit changes`
  2. `Push and open draft PR`
  3. `Link pull request to thread`
- Each step row: 20px status mark + 13px label + 12px `--muted` detail (receipt text once known, e.g. `c0ffee1` or `#421`).
- Marks: pending = 14px empty circle `--border` border; running = 14px spinner `border:2px solid --border; border-top-color:var(--muted); border-radius:50%; animation:spin .8s linear infinite`; confirmed = 14px filled `--ok` circle with white check (8px); not-applied = 14px circle with `--muted` dash; uncertain = 14px `--warning` circle with `!`; failed = `--danger` circle with `×`.
- Detail under uncertain/failed step adds one `--muted` line naming the recovery action.
- Footer while running: `Cancel` becomes `Close` (dialog stays; operation continues server-side); primary is replaced by nothing — the step list is the action surface.

## 4. In-thread PR card (after success)
- `.publish-pr-card`: renders in the thread (placement per T01; fallback = composer dock above task actions). `border:1px solid --border; border-radius:10px; padding:12px; display:grid; gap:8px; font-size:13px`, width = composer width (matches inline artifact rule: one container, chat measure).
- Row 1: `GitPullRequestDraft` 16px icon (`--muted`) + `#<n>` mono + title (600, truncated 1 line) + right-aligned `Draft` badge (2px/6px, 4px radius, 11px, `--muted` border — neutral, not purple).
- Row 2 (checks): summary text identical to `checkSummary` output (`2 passed · 1 running`, 12px `--muted`) + the same 7px-dot list from `.pr-check-list` capped at 4 rows (rest behind `+N more`).
- Row 3 (actions): `View on GitHub` (link-style button, opens URL), `Refresh checks` (secondary button, `aria-busy` while fetching), `Open in Pull request panel` (secondary).
- States: `Refresh checks` disabled while no checks endpoint; checks area shows `No checks reported yet.` when empty; error = `Checks could not be read.` (12px, `--warning-bg` banner 8px/10px).
- Card persists via stored link (not animation). Auto-refresh every 30s up to 30 min, only while visible — no visual difference on refresh; check rows update via the 180/140ms insert/remove motion.

## 5. Recovery state
- Reopening a thread with an unfinished operation shows the same PR card shell with a `--warning-bg` banner: `Publishing stopped at <step>.` + buttons `Check what happened` then `Continue from <next step>` (the second rendered only once inspection returns confirmed/not-applied on the predecessor). Completed card = section 4.

## 6. Motion (all from the token table — names, not new values)
- Sheet open/close: dialog appears instantly (no size tween); content uses popover enter `180ms var(--ui-ease-enter)` opacity + 4px translate.
- File list insert/remove on select/deselect: opacity only, `120ms` (hover/focus token — rows never reorder, only checkbox state changes).
- Draft load: structure-matched skeleton rows (3 file rows + field blocks) after 150ms delay; static under reduced motion.
- Step transitions: status crossfade `160ms`; each confirmed step emits the single `240ms` success pulse on its mark only. Steps appear all at once — no stagger.
- PR card entering the thread: list-insert `180ms var(--ui-ease-enter)` opacity + 4px translate, exactly once (not on reload/restore — "do not replay whole-view entrances on restore").
- Check list updates: insert/remove `180/140ms`, stagger `30ms`, max `150ms` delay.
- Buttons: press `80ms` scale .97 (shared control behavior); hover `120ms`.
- Reduced motion (`[data-motion="reduced"|"off"]` and `prefers-reduced-motion`): no translate, no stagger, no spinner rotation (static `--muted` half-ring or hourglass glyph), no success pulse — state change shown as opacity ≤80ms. Skeleton rows are static.

## 7. Copy (verbatim)
- Chip: `Publish PR`
- Sheet title: `Review and publish`; subtitle: `{branch} → {base}`
- Sections: `Files to publish` · `Commit message` · `Base branch` · `Pull request`
- Primary: `Commit, push and open draft PR`; secondary: `Cancel` / `Close`
- Steps: `Commit changes` · `Push and open draft PR` · `Link pull request to thread`
- Card: badge `Draft`; links `View on GitHub` · `Refresh checks` · `Open in Pull request panel`; empty checks `No checks reported yet.`
- Recovery: `Publishing stopped at {step}.` · `Check what happened` · `Continue from {step}`

## 8. Accessibility
- Sheet: focus trapped in modal; focus lands on commit-message input; Escape cancels unless an operation is running (then it only closes the dialog). Checkbox rows are real `<label>` + `<input type="checkbox">` with the path as accessible name.
- Step list `role="status"`; each step `aria-label` includes its state (`Commit changes — running`).
- Card: checks summary is plain text (readable by screen reader), color dots are `aria-hidden` decoration.
- All interactive targets ≥32px; keyboard path: chip → dialog fields → approve; card buttons tabbable.
- Status communicated by text + icon, never color alone (DESIGN.md rule).

## REPO_MAP
| Path | Use |
|---|---|
| `apps/web/src/PublishReview.tsx` (new) | sheet + step progress; classes `.publish-*` |
| `apps/web/src/ThreadPullRequestCard.tsx` (new) | `.publish-pr-card` |
| `apps/web/src/publish.css` (new) | all new CSS, tokens only |
| `apps/web/src/WorkspaceSurfaceBody.tsx` | reuse `checkSummary`, `prJournalSchema` pattern |
| `apps/web/src/ComposerToolbar.tsx` | chip label/props |
| `packages/ui-shell/tokens.css`, `apps/web/src/workspace-tools.css` | tokens and `.pr-check-list` patterns |

## VALIDATION
- `pnpm lint && pnpm typecheck`; Playwright spec `tests/e2e/publish-thread.spec.ts` (from T06–T08) asserts: sheet layout tokens, all copy strings, step states, card rows, reduced-motion computed styles (no transform/animation-duration >80ms), keyboard-only flow.
- Visual check at 760px/Comfortable/Full chat widths, dark + light, 100/125/150% zoom.

## STATE
- Spec r1 complete. No implementation. Next: implementer applies this spec on the issue's T06–T08 structure (task T09), then T10 verification.

## REFERENCES
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1235
- Implementation plan: `docs/agent-plans/thread-publish-pr.md`
- Visual contract: `DESIGN.md` (motion token table, popup/modal rules, spacing/color rules)
