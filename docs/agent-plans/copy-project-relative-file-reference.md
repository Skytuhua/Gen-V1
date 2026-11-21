# Copy a project-relative file reference

## META

| Field | Value |
| --- | --- |
| Repository | [skytuhua-org/Gen-V1](https://github.com/skytuhua-org/Gen-V1) |
| Revision | r1 · 2026-11-21 |
| Baseline | [main at `e883ac0327c834120d89c3697dec7380a342ba4d`](https://github.com/skytuhua-org/Gen-V1/tree/e883ac0327c834120d89c3697dec7380a342ba4d) |
| Related work | Existing Project search: [UI #124](https://github.com/skytuhua-org/Gen-V1/pull/124), [endpoint #129](https://github.com/skytuhua-org/Gen-V1/pull/129), [debounced input #210](https://github.com/skytuhua-org/Gen-V1/pull/210), [browser regression coverage #348](https://github.com/skytuhua-org/Gen-V1/pull/348). [Composer file mentions #1242](https://github.com/skytuhua-org/Gen-V1/issues/1242) is separate, not a dependency. No matching plan issue or implementation PR was found at drafting. |
| Status | Small feature; plan only. Existing browse/search/preview code inspected; implementation and product verification not started. |
| Provenance | Feature research batch 6, item 2: copy a relative path from the Files preview, or a line-qualified reference from the current text match. [VS Code “Copy Relative Path”](https://code.visualstudio.com/updates/v1_26#_copy-relative-path) is precedent for the relative-only copy action; adding a line based on Gen's verified preview is this plan's design, not a claim about VS Code. |

## OBJECTIVE

When reviewing code or filing a ticket, a user should be able to paste a short reference to the file they just opened, without typing it, sharing their machine's checkout path, or guessing a line from a stale search result. From an accepted Project Files preview it takes one action to write the reference. Example: open `src/reader.ts` from the file list and copy `src/reader.ts`; open a current search hit on line 12 of that same file and copy `src/reader.ts:12`. The reference is plain text, not a hyperlink or immutable revision.

## REQUIREMENTS

The accepted scope is the two copy flows above. The following decisions specify this revision; do not defer visual design or animation to a separate design step.

| ID | Requirement |
| --- | --- |
| R1 | In the Project Files preview, copy exactly the selected file's project/working-copy-root-relative slash-separated path. Browse mode and a filename hit use path only. The path is not relative to the open subfolder; binary and empty files with accepted reads also qualify for path-only copy. Preserve case, ordinary spaces and Unicode. No markup, URL encoding, trailing newline, column, root label or absolute path. |
| R2 | For the last opened text-search hit, append its 1-based line only while it is verified in the current preview: selected path and match path agree, digests agree, the completed read is non-binary text, and the matching line is eligible for the existing visible highlight. A stale, invalid or out-of-bounds hit falls back to path only on an accepted read. Never infer a line from a snippet, caret, current query, or previous selection. |
| R3 | No copy action for no selection, pending/refreshing preview, failed preview, inactive owner, or Granted Files, even when a failed refresh retains visible content. Directory/project/thread changes cannot leak the old reference. A same-path refresh or result reselection must not reuse the old read's eligibility while the replacement read is pending. |
| R4 | One always-visible (when available), keyboard- and touch-operable icon action in the existing preview header, with mode-specific accessible names, same-size success feedback, no focus move on copy, and no motion when motion is reduced/off. Keep existing preview, search, and download interactions. |
| R5 | Clipboard only on explicit activation; never copy automatically or make a network call. A successful write announces “Copied”; rejected or unavailable clipboard gets “Copy failed. Try again.” with no success indication and the action remains retryable. Late completion must not show feedback on a different target. |
| R6 | Treat raw file identity separately from its escaped display. Offer copy only for an ordinary relative single-line path: nonempty slash-delimited segments, no empty/`.`/`..` segments, backslash, colon, ASCII control characters (including DEL), or Unicode line/paragraph separators. Do not rewrite a disallowed path into a different filename; preserve existing read/display behavior for such entries. |

Out of scope: action on search-result rows or folder breadcrumbs; copying an arbitrary selected preview line, search snippet, checksum, column or checkout ID; path links that open an editor; composer mentions; changes to grants, search protocol, renderer permissions, persistence, telemetry or filesystem APIs. No new setting, capability flag, or dependency.

## REPO_MAP

| Verified surface at baseline | Evidence and use |
| --- | --- |
| [`FilesView.tsx`](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/files/FilesView.tsx) | Shared project/granted layout. Selected header has a filename and optional Download. `displayFilePath` is presentation only; opening a file focuses the File content region. |
| [`ProjectFiles.tsx`](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/files/ProjectFiles.tsx) and [`useFilesRead.ts`](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/files/useFilesRead.ts) | Project owner remounts on base/query changes. Reader owns selected entry, selected match, digest comparison, preview highlight, and refresh. Hook fences late reads by key/generation, but same-key refresh and error can retain the last accepted value. |
| [`ProjectSearch.tsx`](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/files/ProjectSearch.tsx), [adapter](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/files/project-search-api.ts), [contract](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/packages/contracts/project-search.ts) | Search supplies path/text as distinct match kinds, nullable line/column, and SHA-256. Adapter verifies response ownership; result activation already passes a typed match to the reader. No changes expected here. |
| [`GrantedFiles.tsx`](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/files/GrantedFiles.tsx) | Uses shared layout with a grant selector, independently scoped reads and optional download. Does not pass a copy target. |
| [`CopyButton.tsx`](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/CopyButton.tsx), [`files.css`](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/files/files.css), [app styles](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/styles.css) | Existing Clipboard API wrapper has a 1.6 s check icon, live status, error toast, and a generation check. Existing compact icon metrics and motion/focus tokens should be reused. [`App.tsx`](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/apps/web/src/App.tsx) mounts the app toaster. |
| [Files reading specs](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/tests/e2e/files-reading.spec.ts), [Project search specs](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/tests/e2e/project-search.spec.ts) | Real React views with synthetic read/search adapters: browse, granted, stale digest, denied/late reads, owner changes, responsive/focus, control-character paths, and CRLF/CR/LF. Use these fixtures, not live provider data. |

## DESIGN

### Ownership and data flow

1. In `ProjectFilesReader`, derive the copy target as a pure render value, not stored state. It is absent unless the owner is active, a project file is selected, and the current selection's read has successfully settled. Verify that no cached `preview.value` is treated as accepted when `preview.pending` or `preview.error` is set. Reuse the existing read owner. If necessary, mark a manual refresh pending in the same update as its retry counter in `useFilesRead` (same key only, retaining content); preserve cancellation, error and grant semantics. Do not wait for an async effect to invalidate an old same-path match on refresh, retry, or reselection.
2. Take the raw `selected.path`, not `selected.name`, the breadcrumb or `displayFilePath(selected.path)`. Validate the single-line relative shape in R6 locally, without importing filesystem APIs or changing the search/path contract. Do not normalize, trim, decode, escape or reconstruct it. Do not touch file reads for a disallowed copy target.
3. Use the exact same predicate for the line suffix and visible highlight on a settled read: selected match of kind text, same path, case-insensitive SHA-256 equality, non-binary nonempty text, and positive safe integer line in the existing newline-aware parts. Reuse the CRLF/CR/LF splitting and line-index check instead of recomputing from DOM text. Existing stale/missing-line messaging stays. “Current” means the selected hit in the visible preview, not the latest draft query: changing the search field alone does not select a different file or line; clearing/replacing the preview selection or changing owners does. Search-result activity must never itself copy anything.
4. Pass a small optional `{ text, label }` copy target to `FilesView`, with a project-source guard at the render site. Mode table defines the entire clipboard payload. Use the existing `CopyButton`. If needed, add a backwards-compatible optional error-message prop for the Files action, keeping all other copy surfaces' existing fallback. Keep clipboard interaction in the renderer: no IPC, permission query/prompt of our own, network fallback or legacy clipboard hack. An already-dispatched write cannot be cancelled; scope guarding prevents stale UI feedback, not the OS write initiated by the user.

| State | Accessible name / initial title | Clipboard |
| --- | --- | --- |
| Settled browse, filename hit, stale/out-of-bounds text hit, binary or empty file | Copy relative path | `docs/Guide notes.md` |
| Settled current text hit, line 12 | Copy file reference | `docs/Guide notes.md:12` |
| Unselected, inactive, pending, failed, granted, or unusable path | No control | No write |

### Visual design, motion and recovery

- Put the copy control in the trailing slot of the existing header, outside the scrolling preview content. Use the existing compact icon-button geometry and 14 px Copy/Check glyphs; no new badge, popover, row action, toast on success, or hover-only reveal. Give the filename the flexible ellipsis slot and keep the action fixed-size so long filenames, narrow panes and zoom do not clip the control. Do not restyle the shared Download link.
- Reuse muted foreground at rest, standard hover/pressed colors and the visible `:focus-visible` ring in both themes. Keep the native button in the header's normal tab order (before the preview body), with Enter/Space activating exactly once. Icon is decorative; the action's accessible name remains stable during its confirmation. Do not scroll or move focus when copy finishes. A new selection uses the existing preview-focus behavior; do not focus the new copy button automatically.
- Swap to the same-size Check icon and title “Copied” only on a successful write, with the existing polite status and 1.6 s reset. Keep the icon swap instant and use only existing tokenized hover/press transitions; no slide, scale, or fade for the success swap and no layout shift. Honor OS reduced motion and the app's reduced/off settings. Never surface a stale success or error after path, line or owner changes; use generation cleanup on action changes/unmount and test same-payload owner changes.
- If permission is denied or the API is unavailable, announce the Files-specific error via the existing toast host, leave focus on the copy control, and allow the same user to retry. Failure never changes the selected file or reads again. Rollback is a frontend revert; no data or configuration migration.

## EXECUTION_DAG

This is sequential to keep write ownership clear. Before T01 the implementing agent reads the canonical issue, pinned plan and journal, claims the scope and follows [the checkpoint/release rules](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/AGENTS.md). Keep checkpoints and evidence on that issue. Do not perform these tasks as part of publishing this plan.

| Task | Prerequisite / owned files | Steps, checks and done-when / handoff |
| --- | --- | --- |
| T01 — Derive the reference | Current main plus scope claim. Own `ProjectFiles.tsx` and `useFilesRead.ts` only if same-key invalidation needs a hook change. | Trace browse/select/refresh/retry/owner paths. Derive the optional target from accepted data, R6 validation and the shared line predicate; connect it to the optional view prop in T02. Check positive path and text cases and negative stale/hash mismatch, out-of-range, invalid path, pending and failed read decisions during local review. Done when the reader has one preview-bound decision and no duplicated or stale line computation. Hand the prop shape and decision cases to T02; typecheck the pair after T02 lands. |
| T02 — Add accessible copy UI | T01 design/data output. Own `FilesView.tsx`, `files.css`, and any backwards-compatible `CopyButton.tsx` change. | Render the project-only trailing button with the exact labels, confirmation and failure copy above. Preserve Download, filename ellipsis, focus, and shared Clipboard API generation behavior. Run typecheck with T01; inspect keyboard activation on a project fixture and absence on a granted fixture; review the copy control at wide and narrow widths. Done when both payload modes, retry and reduced motion are wired with no new layout or grant behavior. Hand the integrated diff to T03. |
| T03 — Prove behavior and regressions | T02 integrated. Own `tests/e2e/files-reading.spec.ts`, `tests/e2e/project-search.spec.ts`, and corresponding fixture entry points only as needed for toast hosts or synthetic cases. | Add the R1–R6 tests listed below. Assert the clipboard value and call count, not just the icon; for race cases use held promises/requests. Verify a synthetic rejection then retry and check that existing browse/search/grant suites still pass. Attach redacted evidence and exact commands/results to the implementation PR/journal. Done when acceptance checks A1–A6 pass or any remaining real-environment gate is explicitly blocked with evidence. Hand the PR and evidence to T04. |
| T04 — Send finished work for front-end review | T03 and implementation PR, with evidence and any remaining gates named. No product edits; own review handoff only. | Send the finished work to the front end team for review: link the implementation PR and tested commit, canonical plan, and wide/narrow, keyboard and reduced-motion evidence. Ask them to review the specified UI and behavior, not to supply a design. If no recipient is reachable, record the requested review as pending on the issue with the precise missing recipient; do not claim approval. Done when the review handoff is on the issue and receipt or pending state is explicit. Keep normal review/merge gates and release ownership. |

## VALIDATION

Planned, not run for this publication. Use synthetic project files and mocked search results, no live agent/provider sign-in. From the repo root follow [source setup](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/docs/getting-started.md) (Node ≥ 24.10, pnpm 10.30.3); then:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm typecheck
pnpm exec playwright test -c tests/e2e/files-reading.playwright.config.ts --project=files-reading
pnpm exec playwright test -c tests/e2e/project-search.playwright.config.ts
```

Use the existing fixture configs, with free loopback ports; grant clipboard read/write on the isolated Chromium context for positive checks (see the [workbench precedent](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/tests/e2e/workbench.spec.ts)). For deterministic unavailable, rejection, pending and late-write tests, stub only the clipboard API in that fixture. Register the existing `Toaster` in the relevant synthetic fixture if needed to assert the error path. Seed a known clipboard value for “no write” cases and inspect write count. Add an installed Windows desktop smoke verification for real clipboard compatibility: paste a synthetic nested path and a line reference into a disposable editor, test keyboard activation, and repeat one narrow/responsive and reduced-motion check. Record the environment and exact outputs, not real project content.

| Check | Maps to | Required observable evidence |
| --- | --- | --- |
| A1 | R1 → T01–T03 | Nested file opened from a subfolder and a filename hit both write the exact slash-separated path from the project root; preserve spaces, case and Unicode. Accepted empty/binary previews write only the path. |
| A2 | R2 → T01–T03 | A fresh text hit writes exactly path plus line, not column; CRLF and lone CR agree with the visible highlight. Selecting another hit in that file updates the suffix when the read settles. Stale digest/missing line and returning to browse selection use path only. Editing a query without opening a hit cannot replace the preview's match. |
| A3 | R3 → T01–T03 | No copy control before selection, during held reads or same-path refresh, after a failed read retaining old content, during deactivation, after owner changes, or on granted files. A late old read cannot restore a reference; retry restores the correct control without changing existing preview focus or grant Download. |
| A4 | R4 → T02–T04 | Tab reaches the correctly named control in both modes; Enter and Space each write once. Header action remains visible and filename can ellipsize at wide and collapsed-pane widths (include a long name at 375 CSS px and 200% zoom). Focus ring and legibility survive light/dark, OS reduced motion and app motion off. Check swap stays at the same position and size, announces once and resets without focus movement. |
| A5 | R5 → T02–T04 | Clipboard writes only when invoked; no app request, path telemetry or auto-copy. Rejected/absent clipboard shows only the retryable toast, then success when retried. A deferred success/rejection from a previous file, line or owner does not affect the current UI, including when the new owner would produce the same payload. |
| A6 | R6 → T01–T03 | Synthetic malformed, absolute, control-bearing and traversal-shaped values cannot be copied. Existing accepted special-name preview still uses the exact read target and escaped display; do not change path handling outside clipboard eligibility. |

Release gate: A1–A6 and repository checks on the implementation PR, Windows desktop smoke evidence or an explicitly tracked Windows verification blocker, and documented front-end review handoff. Do not call fixture results installed verification or a requested review an approval.

## STATE

- Researched and decided: narrow renderer-only change, one adaptive header button, relative raw paths and digest-bound lines. No runtime files changed or tests executed at plan baseline.
- Not started: T01–T04. No implementation owner, branch, PR, or failed implementation attempt. Publication PR (linked on the issue) is documentation only; normal reviewer ownership and merge protections apply.
- Risks: retained old data on same-path refresh; focus or layout changes in shared Files header; browser/desktop clipboard rejection; filenames that cannot be represented safely as a single line. Guard and verify these rather than broadening permissions or scope.
- Next: assign an implementing agent through the canonical issue, then have it verify baseline drift and claim T01 before changing source. If the existing preview no longer proves alignment with the selected match, block the line mode rather than copying a guessed number.

## REFERENCES

- [VS Code July 2018 release notes — Copy Relative Path](https://code.visualstudio.com/updates/v1_26#_copy-relative-path): plain project-relative copy provides a precedent; this plan intentionally adds only a verified preview line suffix.
- [Gen V1 progress matrix](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/docs/progress.md): search and file preview are existing surfaces; this plan neither turns on a milestone flag nor depends on code-intelligence rollout.
- [Gen V1 agent instructions](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/AGENTS.md) and [contribution guidance](https://github.com/skytuhua-org/Gen-V1/blob/e883ac0327c834120d89c3697dec7380a342ba4d/CONTRIBUTING.md): canonical issue and revision custody, execution evidence, and review policy.
