# M15 draft metadata and transfer integration

## Scope and outcome

This change preserves the existing composer journal as the only active text owner. Source selections are kept in the existing M15 companion, named saves retain typed source metadata, and backup import commits a prompt with its source companions atomically.

Product files: `apps/web/src/draft-transfer.ts`, `apps/web/src/saved-drafts.ts`, and `apps/web/src/SavedDrafts.tsx`.

Behavioral coverage: `tests/source-draft-transfer-v3.test.ts`, the added source metadata case in `tests/e2e/saved-drafts.spec.ts`, and the existing saved-draft, transfer, journal, and recovery suites.

## Ownership and data contract

The canonical companion key is `source-context:` followed by the URI-encoded conversation, project, and working-copy IDs, separated by colons. All three components are present; null project or working-copy values become empty components. Contract identifiers cannot be empty, so the null representation is unambiguous.

Transfer validation parses the complete logical owner, reconstructs the canonical key, and requires exact equality. It then uses `parseSourceDraftMetadata` to enforce the M15 strict metadata contract. This rejects a second `text` field, unknown fields, more than eight references, duplicate capture IDs, and any reference whose conversation, project, or working-copy owner differs from the companion owner. The owning host remains responsible for source retention, freshness, grants, and accepted-send validation. A restored reference supplies no authority.

Named draft version 1 has an optional `sourceContext` field. Its contents are the source draft ID, exact logical owner, revision, source references, send mode, and conflict state. The schema validates the field against the same recovery parser and requires its logical owner to match the saved draft's thread, project, and working-copy fields. Existing records without `sourceContext` remain readable; existing text, excerpt, lifetime, and per-thread quota limits remain in force.

## Backup behavior

Ordinary text/decision/artifact/skill backups retain transfer format version 1. Exports containing source companions use transfer format version 2. An older importer rejects that version before writing any text, preventing a misleading partial restore that drops unrecognized source metadata. The current importer accepts both versions.

The backup still has at most 500 records and is at most 2 MiB. It contains source identities and capture references, not another copy of canonical text or source bytes. Existing reference lookup sends only bounded journal keys to the host.

A source-only export includes an explicit empty text snapshot without creating a local text record. Import requires the text record and groups it with all companions for that conversation, independent of their order in the backup. An invalid companion blocks its whole group. A local prompt or source companion retains the whole group. The import uses one `journalCompareAndSwapMany` transaction, so a changed generation or failed source write cannot leave imported text behind by itself.

Legacy text-only import also retains the local prompt when a source companion already exists for that conversation. The recovery helper additionally initializes missing canonical text to the empty string atomically with the first source companion. This makes a concurrent first source selection and legacy text import compete on the same text generation, avoiding an orphan-companion race without a second index.

## Named save and text-only restore

Named save reads text, skill bindings, excerpts, and the exact source companion. It checks every observed generation, including an absent companion, in the same transaction as the library write. A source-only draft can be saved. A source change arriving during the save rejects the operation and preserves the active draft.

Named restoration keeps its existing text-only behavior. It leaves active attachments, excerpts, skills, source selections, and send mode unchanged. The UI states this explicitly, lists source counts and saved delivery mode, and exposes readonly source metadata containing the capture ID, source identity, owner, and revision. These identities remain inspectable after the active selection is removed and after a reload.

Replacing nonempty text creates the existing recovery record, now including the current source metadata. The restore plan retains the source generation and checks it before committing that recovery record and the replacement text. A concurrent source edit therefore cannot cause a recovery copy to claim the wrong source selection.

## Recorded verification

All command receipts and bounded logs are under `docs/implementation/v3/m15-logs/`. Failed attempts are retained unchanged.

| Evidence ID | Observed result | Purpose |
| --- | --- | --- |
| `draft-context-red` | 18 failed, 1 passed; exit 1 | Reproduced dropped metadata, source-only save rejection, non-atomic import, missing source generation checks, and incomplete recovery copies. |
| `draft-context-green-01` | 86 passed across six files; exit 0 | New behavior plus existing saved-draft, transfer, journal, and recovery contracts. |
| `draft-transfer-version-red` | 2 failed, 19 skipped; exit 1 | Reproduced version 1 exports that older clients could partially import, and missing version 2 support. |
| `draft-context-green-02` | 89 passed across six files; exit 0 | Format version fence, legacy compatibility, all source metadata cases, and the recovery helper's first-companion race fix. |
| `saved-source-ui-01` | 1 failed; exit 1 | Browser bundle was blocked by the then-incomplete workbench output schema exports; source metadata UI assertions did not run. |
| `saved-source-ui-02` | 1 passed; exit 0 | Real SavedDrafts UI, reload, source-only metadata inspection, current-selection and delivery-mode preservation. |
| `draft-context-types-01` | Exit 2 | Found two implicit-any parameters in the new browser test. |
| `draft-context-types-02` | Exit 0 | Full repository `tsc --noEmit --pretty false` after explicit callback types. |
| `saved-drafts-browser-full-01` | 27 failed; exit 1 | Existing tests searched for the obsolete exact trigger name `Drafts`; the actual main and candidate trigger is `Saved drafts`. Early selector timeouts exhausted the unchanged 300-second fixture-server lifetime, causing connection errors in later cases. No behavioral pass is claimed for this attempt. |
| `saved-drafts-browser-full-02` | 22 passed, 5 failed; exit 1 | Four existing assertions exposed modal errors rendered as status messages instead of alerts. The skill-only case lost its input when a concurrent App update triggered Vite hot replacement, recorded in its browser trace. |
| `saved-drafts-browser-full-03` | 25 passed, 2 failed; exit 1 | Modal alert checks passed. The restore case reproduced lost focus after successful text replacement. The quota/corrupt case was interrupted by hot invalidation of shared UI modules during its reload. |
| `saved-drafts-focus-reload-01` | 2 passed; exit 0 | Rechecked successful replace/insert focus and the quota/corrupt reload path after the committed-close focus fix and a stable source window. |
| `saved-drafts-browser-full-04` | 27 passed; exit 0 | Complete registered saved-drafts suite, including all 26 existing cases and the new source-only metadata case. Declared default Chromium configuration and all behavioral assertions retained. |

The browser success result is retained at `docs/implementation/v3/m15-artifacts/saved-source-ui-02-results.json`. The prior failed result remains at `saved-source-ui-results.json` in the same directory.

The full registered `saved-drafts` suite uses its declared Playwright configuration with the installed default Chromium, without a browser-channel adapter. Its first result is retained byte for byte at `docs/implementation/v3/m15-artifacts/saved-drafts-browser-full-01-results.json` (SHA-256 `8c02fad4ed672df6e61046b29afc5dfbb5a87df45d0838bb72f802258469de3f`). Five trigger selectors were then aligned with the existing accessible button name. Restore, keyboard, focus, alert, ownership, quota, expiry, and corruption assertions were retained.

The second full result is retained at `docs/implementation/v3/m15-artifacts/saved-drafts-browser-full-02-results.json` (SHA-256 `a50f284850b145bc3d036a63d6f970807de008aeee12895a5c28a5c115c9db07`). Rejected concurrent restore, failed quota save, full-list save, and thread-capacity save already preserved their records, but their modal error messages lacked the alert role required by the existing accessibility tests. The modal error role was corrected to `alert`; loading remains `status`.

The third full result is retained at `docs/implementation/v3/m15-artifacts/saved-drafts-browser-full-03-results.json` (SHA-256 `3de427dd28d62499d50a55eebf79436480898553c92617e5844f8d4e679b1aaa`). Its restore trace contains no hot updates. Focus was scheduled in an animation frame immediately after the asynchronous close request, which did not guarantee that React had committed the native modal closure. The component now records the requested focus destination and caret, then restores them in a layout effect after the closed state commits. The quota/reload trace records eleven module update or invalidation events, including the fixture, and is retained separately from the focus trace. The complete second-attempt HMR trace, both third-attempt traces, and extracted update-event summaries are under `m15-artifacts/`.

The final complete run passed all 27 cases from `2026-11-15T22:18:36.185Z` to `2026-11-15T22:21:20.015Z`. Its receipt is `m15-logs/saved-drafts-browser-full-04.json`, with log SHA-256 `cd43ce0eea5e91a11bbaa254eaa905b242f5c5ff6e78441c709474ed6da60d15`. The exact Playwright result is `m15-artifacts/saved-drafts-browser-full-04-results.json`; the adjacent summary records its digest and each retained screenshot's original path, artifact path, digest, and size. The focused correction result remains at `m15-artifacts/saved-drafts-focus-reload-01-results.json`.

The independent full Vitest audit is retained in `m15-artifacts/full-vitest-01-audit-summary.json`. It separates new M15 tests, changed existing test files, related contracts, observed error signatures, unhandled errors, and the two introduced integration regressions. The original run remains failed. Subsequent reader-route composition and public export corrections link to their own passing receipts rather than replacing those failures. That run overlapped source edits and is not a verification of the final source cut.

The clean main browser baseline is documented separately in `M15-browser-baseline.md`: 79 passed, 33 failed, 1 skipped, exit 1, at `399cde39ff4ee82272c7a7700944325c44b36070`. Its full results and exact failure names are retained. This integration's focused passes do not establish full candidate regression parity or platform activation approval.
