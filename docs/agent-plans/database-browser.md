# Plan: Database browser (connect, browse schema, read-only agent queries, approved writes)

> **Design ownership (batch 3).** There is no separate front end team designing this feature: this plan itself specifies the visual design and the animation (section VISUAL_DESIGN_AND_MOTION). Implementers build exactly that specification. **When implementation is finished, the implementing agent hands the finished work to the front end team for review** (task T12) and does not close the issue until that review is acknowledged and its requested changes are resolved.

## META

| Field | Value |
|---|---|
| Feature | Database browser: connect a SQLite file, PostgreSQL or MySQL database, browse its schema, run read-only queries (by the user in a panel and by the agent as a tool) into a results data grid, and make writes only through prepared operations the user approves |
| Size | large (labels `feature`, `large`); three linked sub-issues own disjoint task ranges (see EXECUTION_DAG, "Sub-issues") |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue (parent); sub-issues link back here |
| Plan file | `docs/agent-plans/database-browser.md` (identical to this issue body) |
| Plan revision | r1, 2026-11-21 (UTC) |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified with `git rev-parse origin/main` on a fresh clone, 2026-11-21) |
| Related work | No issue or PR for a database browser, Postgres or MySQL connectors (searched issues/PRs for "database", "postgres", "mysql", "sql client"; only unrelated M03 advisory-database and SQLite-migration items such as #1056/#1292 matched). Sibling batch 3 features are planned in their own issues; item 6 "Edit files by hand" may add a code editor dependency (CodeMirror/Monaco) — this plan deliberately does **not** depend on it (D9). |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Approved for planning by the repository owner (Leonardo) on 2026-11-21 from researched feature proposal batch 3, item 8: "Database browser (L): Connect Postgres, MySQL or SQLite, browse the schema and let the agent run read-only queries into Gen's data grid, with writes needing approval." Owner instruction for batch 3: no front end team designs these, so the plan specifies visual design and animation; the implementing agent must give the finished work to the front end team for review. All repository facts were read by static inspection of the baseline SHA. Decisions marked **DECIDED** were made by the planner (the owner delegates non-approval decisions); options not taken are recorded. No code was built or tested while planning. |

### Correction to the proposal

The proposal said "the repo has no database connectors". In fact **SQLite already works for agents, without a UI**: a thread can grant a SQLite file (`resource.grant` kind `database`, `apps/web/src/App.tsx:250`), `database_inspect` reads schema/integrity/counts/bounded rows of one table, and `database_prepare` prepares DML/migrations that run only through an approved operation (`packages/capabilities/database.ts`, `sqlite-worker.mjs`, `index.ts:131–139,197–201`). Missing: a user-facing browser, free-form read-only queries, PostgreSQL/MySQL, credential storage, and approvals started from grid edits. This plan builds on the SQLite machinery (D1).

## OBJECTIVE

**User problem.** Developers using Gen on a project with a database have to leave Gen for a SQL client (DBeaver, TablePlus, psql) to look at data, and the agent cannot see real data to reason about bugs or migrations except through the narrow `database_inspect` table dump for local SQLite files. New tools pair SQL clients with agents: Tusk (https://usetusk.app/), Tabularis (https://tabularis.dev/), PgVoyager (https://github.com/thelinuxer/pgvoyager).

**Intended behavior.** With the capability flag on:
1. In Settings > Skills & Integrations > Databases, the user adds a connection: SQLite (file path), PostgreSQL or MySQL (host, port, database, user, password, TLS mode). The password is stored as a host secret and never shown again, never sent to a model, never logged.
2. The user attaches a connection to a thread (from the panel or the composer resource menu). Attachment is read-only by default; "Allow approved changes" makes it writable for prepared operations only.
3. A **Database** workspace panel shows a schema tree (schemas → tables/views → columns, keys, indexes), a SQL editor and a results grid. Clicking a table previews its first 100 rows. Ctrl/Cmd+Enter runs the editor's SQL **read-only**.
4. The agent gets tools `database_schema` and `database_query` (read-only, bounded) for attached connections; results are published as `DataRecord`s with provenance and render in the thread as a compact results grid card that opens in the panel.
5. Writes (agent-proposed statements, or cell edits the user makes in the grid of a table with a primary key) become a prepared `database.*` operation shown in an approval card with the exact SQL, parameters and expected row counts. Nothing writes until the user approves; execution runs in one transaction and rolls back on any count mismatch.

**Measurable success.**
1. A user can add a SQLite connection and see its table rows in ≤ 4 interactions after opening Settings (T11 browser test).
2. Read-only enforcement: every statement in the negative corpus (A07) is rejected or fails inside a read-only transaction on all three engines, and the target data is byte/row-identical afterwards (T11).
3. A 1,000-row × 20-column result renders its first frame in < 150 ms scripting time and scrolls at ≥ 50 fps on the CI browser (virtualized grid, T11 perf test).
4. No password or connection string with password appears in any snapshot, event, log, DataRecord, model prompt or error (T11 redaction test greps all of them).
5. All acceptance rows A01–A30 pass; existing `tests/capabilities.test.ts`, `tests/tool-authority-v3.test.ts`, `tests/interactions-catalog.test.ts`, `tests/host-capability-flags.test.ts` still pass; with the flag off, behavior is identical to baseline.

## REQUIREMENTS

### In scope (each maps to tasks and acceptance rows in VALIDATION)

- **R01 Engines.** SQLite (local file), PostgreSQL ≥ 12, MySQL ≥ 8.0 (MariaDB ≥ 10.6 best-effort, not gated). SQLite reuses the existing snapshot/guarded worker path.
- **R02 Connections.** Profile-level saved connections with fields: `label` (1–80 chars), `engine`, SQLite `path` (absolute; granted via the same canonicalisation and `assertNotStorage` as `resource.grant`, `packages/core/service.ts:1218–1223`, `packages/core/security.ts:45–70`), network `host`, `port` (default 5432/3306), `database`, `user`, `tls` (`disable` | `prefer` | `require` | `verify-full`; default `prefer` for localhost, `require` otherwise), password (secret). Create, edit (password optional on edit = keep), delete, "Test connection".
- **R03 Thread attachment.** A connection is usable only by threads it is attached to; attachment records `writable` (default false). Detaching immediately denies further tool calls and panel queries for that thread. Side conversations and delegate/child threads cannot attach and can only query if the parent attachment exists and the actor role is `run` (same roles as `database_inspect`, `packages/core/tool-authority.ts:75`).
- **R04 Schema browse.** Schemas, tables, views, columns (name, type, nullable, default, PK), foreign keys, indexes, approximate row counts where cheap (Postgres `pg_class.reltuples`, MySQL `information_schema.TABLES.TABLE_ROWS`, SQLite exact `COUNT(*)` only when the table is opened). Bounded to 2,000 objects; truncation is shown.
- **R05 Read-only queries (user).** The panel editor runs one statement read-only with a row limit (100 default; 500; 1,000 max) and a timeout (default 15 s, max 30 s). Results show columns with engine type names, row count, elapsed ms, and "truncated" when the limit or the 8 MiB serialized budget is hit.
- **R06 Read-only queries (agent).** Tool `database_query` with the same enforcement and limits; result published through `publishData` as a `DataRecord` (same as `database_inspect`, `packages/capabilities/index.ts:131–134`) and returned to the model as a bounded JSON summary (≤ 200 rows inline, the rest referenced by data id).
- **R07 Read-only enforcement is engine-level, not regex-level.** SQLite read-only open + allow-list authorizer; PostgreSQL `BEGIN TRANSACTION READ ONLY` + `statement_timeout` + `ROLLBACK`, extended protocol; MySQL `START TRANSACTION READ ONLY` + `MAX_EXECUTION_TIME` + `ROLLBACK`, `multipleStatements:false` (details in DESIGN). The leading-verb allowlist is defense in depth only (D4).
- **R08 Writes need approval.** Agent writes use `database_prepare` extended to connection targets; grid edits produce the same prepared operation; execution only via the existing approved-operation path (`operation_execute`; `executeDomainOperation` requires `approved`, `running`, same thread, `packages/capabilities/index.ts:141–143`) and a writable attachment.
- **R09 Write safety.** Exact `expectedChanges` per DML statement; one transaction, rollback on any mismatch (existing SQLite contract). PostgreSQL `migration` mode allows DDL (transactional); MySQL DML-only (D7). Precondition `schemaDigest` of touched tables, re-checked inside the execution transaction → `PRECONDITION_FAILED`.
- **R10 Grid edits.** Cells are editable only when the result has a proven single-table source with a primary key (DESIGN `source.table`) and the attachment is writable. Drafts accumulate; "Review changes (n)" builds one parameterized `UPDATE … WHERE <pk> = ?` per edited row with `expectedChanges:1` and shows the approval card. Grid insert/delete out of scope in v1.
- **R11 Results in the thread.** Agent query results render as a "Query result" card in the thread (first 20 rows, column headers, row count, "Open in Database panel"). The panel opens the same `DataRecord` read-only; re-running it executes a new read-only query.
- **R12 Secrets.** Passwords go through the host secret mechanism used for integration secrets (`packages/core/secret-references.ts`; UI precedent `IntegrationSecretReferences.tsx`; exact storage found in T01), are resolved only inside the gateway, and every error/progress string passes through `createSecretRedactor`.
- **R13 Explicit data to models.** Results reach the model only from the agent's own visible `database_query`/`database_schema` calls, or when the user clicks "Send to chat" on panel results (D10).
- **R14 Flag.** Everything is behind new host capability flag `data.databaseBrowserV1`, default **false** (`packages/core/capability-flags.ts`). Flag off: no Settings section, no panel kind, commands/routes reject with `CAPABILITY_DENIED`, new tools not offered, `database_prepare` keeps its baseline SQLite-only schema.
- **R15 Bounds.** Rows ≤ 1,000; columns ≤ 200; display cell text ≤ 4 KiB ("Show full value" reads the stored DataRecord, ≤ 1 MiB); binary as `<bytes 1.2 KB>` + 64-byte hex preview; result ≤ 8 MiB serialized; bigint/decimal as strings, dates as ISO 8601 with the engine type name kept.
- **R16 Timeouts and cancel.** Hard timeout on every request; Cancel while running (PG `pg_cancel_backend`/client cancel, MySQL `KILL QUERY` on a second connection, SQLite worker terminate); a cancelled write is `OPERATION_OUTCOME_UNKNOWN`.
- **R17 Connection lifecycle.** No persistent pools in v1: one short-lived connection per request (open → run → close), max 2 concurrent requests per connection, queue beyond that (D6). Connect timeout 10 s.
- **R18 Accessibility.** WAI-ARIA tree (arrows, Home/End, typeahead) and grid (roving cell focus, PageUp/Down, Ctrl+Home/End, Enter/F2 edit, Escape cancel); labelled editor; polite live region for run/result/error; icon-only buttons have names and 350 ms tooltips.
- **R19 Errors.** Specific messages with one recovery (DESIGN.md copy rules) for connect refused/timeout, auth, TLS, unknown database, read-only violation ("This query tries to change data. Queries here are read-only; ask the agent to prepare a change for approval."), timeout, syntax error with position, flag off, detached attachment, `PRECONDITION_FAILED`. SQL text and grid drafts are never lost.
- **R20 Platforms.** Windows x64 packaged desktop (supported beta) and Linux dev. Pure-JS drivers only (no native modules, D3).
- **R21 Licensing.** New runtime deps are permissively licensed, pinned to exact versions like the rest of `package.json`, and recorded in `THIRD_PARTY_NOTICES.md` per `CONTRIBUTING.md`.
- **R22 Visual design and motion** exactly as specified in VISUAL_DESIGN_AND_MOTION (light/dark, densities, reduced motion).
- **R23 Front end review handoff.** Finished work is handed to the front end team for review before the issue can close (T12).

### Out of scope (v1)

- SQL Server, Oracle, MongoDB/Redis/other non-SQL stores, cloud-specific auth (AWS IAM, Azure AD tokens), SSH tunnels (follow-up candidate; users can run their own tunnel to localhost).
- ER diagram view, query history sync, saved query library (local per-connection history of the last 50 statements is in scope only as editor recall, see T07), autocomplete beyond table/column name completion, explain-plan visualisation, data export to CSV beyond copying a selection (copy-as-TSV is in scope).
- Grid row insert/delete, multi-table edits, edits on views or tables without a primary key.
- MySQL DDL/migrations; long-running transactions spanning several approvals.
- Sharing connections across Windows user profiles or with paired remote devices (M17).

### Decisions (DECIDED) and options not taken

| ID | Decision | Options not taken (why) |
|---|---|---|
| D1 | Build on the existing SQLite grant/tools/operation path; add a "connection" target for network engines and Settings-added SQLite files | Replacing `database_inspect`/`database_prepare` (breaks agents and `scripts/review-host.ts:157–165`); per-engine tool families (duplicated authority rows) |
| D2 | Profile-level saved connections + per-thread attachments | Per-thread connections only (re-enter credentials per thread); global access for all threads (violates grant scoping used everywhere else) |
| D3 | Pure-JS drivers `pg` (MIT) and `mysql2` (MIT), exact pinned; `pg@8.23.1` is already transitive in `pnpm-lock.yaml` (T01 decides whether to pin it) | Native drivers (`pg-native` needs Windows build tooling); ORMs |
| D4 | Engine-level read-only transactions/authorizer are the security boundary; verb allowlist is only a fast pre-check | Regex/AST "is it a SELECT" check only (bypassable via functions, CTEs with DML in Postgres `WITH ... DELETE`, comments); a SQL parser dependency (large, dialect gaps) |
| D5 | Agent tools `database_schema` and `database_query` are READ/READ_RETRYABLE, approval none, actor role `run` — same class as `database_inspect` | Requiring approval per read query (too much friction; reads are bounded and visible) |
| D6 | Short-lived connection per request, ≤ 2 concurrent per connection | Persistent pools (idle sockets, credential lifetime, harder cancellation) — revisit if T11 perf shows connect cost dominates |
| D7 | MySQL DML-only for writes in v1 | MySQL DDL (implicit commit makes rollback-on-mismatch impossible) |
| D8 | New flag `data.databaseBrowserV1` in a new flag set `DATA_FLAG_KEYS` | Reusing `ui.sourceWorkbenchV1` (unrelated M15 scope) |
| D9 | SQL editor = styled `<textarea>` with line gutter, tab handling and table/column completion on the shared Popover; no editor dependency | CodeMirror/Monaco (sibling feature 6 may add one; T07 may adopt it behind the same component interface as a recorded deviation) |
| D10 | Panel query results reach the model only via explicit "Send to chat" | Auto-sharing panel results with the agent (privacy surprise) |
| D11 | New virtualized `QueryResultGrid` (panel) + catalog card `QueryResult` (thread); reuse `EditableTable`'s draft/"Review changes" pattern | Reusing `EditableTable` itself (≤ 8 columns × 50 rows by contract, `packages/ui-catalog/interactions.ts:51`) |
| D12 | Grid edits produce parameterized `UPDATE ... WHERE <pk> = ?` statements with `expectedChanges:1` each | Free-form "write mode" in the editor (bypasses the prepare/approve flow) |

### UX flows

1. **Add a connection.** Settings > Skills & Integrations > Databases > "Add database" → engine (SQLite / PostgreSQL / MySQL) → fields → "Test connection" ("Connected · PostgreSQL 16.2 · 12 ms" or the specific error) → "Save". The row shows engine icon, label, `host/database` or file name, "Used by 2 threads".
2. **Attach to a thread.** Database panel launcher or composer "+" > "Database…" → pick a saved connection → "Allow approved changes" (off by default) → "Attach"; the panel opens with the schema tree.
3. **Browse.** Expand `public` → `orders` → see columns with type and key badges. Click `orders` → grid shows first 100 rows (`SELECT * FROM "public"."orders" LIMIT 100`, the generated SQL is placed in the editor so the user can refine it).
4. **Query.** Type SQL → Ctrl/Cmd+Enter → grid shows results; status line "100 rows · 34 ms · limit 100". Running a write statement shows the read-only violation error.
5. **Agent query.** "Which customers have unpaid invoices older than 30 days?" → agent calls `database_schema`, then `database_query` → thread shows the tool activity and a "Query result" card (20-row preview) → "Open in Database panel".
6. **Agent write.** User asks "Mark those invoices as overdue" → agent calls `database_prepare` with `UPDATE ... WHERE id = ANY($1)` and `expectedChanges: 17` → approval card shows engine, connection label, SQL, params, expected count → "Approve and run" → result "17 rows changed" or "Rolled back: statement 1 changed 18 rows, expected 17".
7. **Grid edit.** On a writable attachment, double-click a cell (or Enter/F2) → edit → Enter commits the draft (cell shows changed tint) → "Review changes (3)" in the grid footer → approval card as in flow 6 → approve → grid refreshes those rows.
8. **Send to chat.** Select rows → "Send to chat" → composer gets a quoted data attachment chip "orders · 12 rows" that the user can remove before sending.

## VISUAL_DESIGN_AND_MOTION

This section is normative. It uses only existing shared tokens from `packages/ui-shell/tokens.css` (names verified at baseline: `--ui-content-inset`, `--ui-panel-inset`, `--ui-control-inset`, `--ui-dialog-inset`, `--ui-space-1/2/3/4/6`, `--ui-row-compact`, `--ui-row-comfortable`, `--ui-row-touch`, `--ui-focus-ring`, `--ui-nav-gap`, `--ui-popup-gap`, `--ui-motion-hover`, `--ui-motion-press`, `--ui-motion-panel-enter`, `--ui-motion-panel-exit`, `--ui-motion-tab`, `--ui-motion-insert`, `--ui-motion-remove`, `--ui-motion-stagger`, `--ui-motion-status`, `--ui-motion-success`, `--ui-motion-popup-enter`, `--ui-motion-popup-exit`, `--ui-motion-tooltip-enter`, `--ui-motion-tooltip-exit`, `--ui-tooltip-dwell`, `--ui-ease-enter`, `--ui-ease-move`) and the existing colour tokens of the theme (surface, raised surface, border, text, muted text, accent, semantic status colours). T01 records the exact colour token names; **no new colour values, fonts, radii or durations are introduced** — every value below maps to an existing token or to a DESIGN.md rule. Shared primitives only: `Select`, Popover, ActionMenu, Modal (`packages/ui-shell`), lucide icons (already a dependency).

### Layout: Database panel (workspace tool panel)

```
┌ toolbar 36px ──────────────────────────────────────────────────────────────┐
│ [DB icon] [Connection Select ▾]  [Read only | Changes need approval]  ⟳  ⋯ │
├ schema 240px ─────┬─ editor (default 160px, min 96px, resizable) ──────────┤
│ 🔍 Filter tables  │ 1 │ SELECT * FROM "public"."orders" LIMIT 100          │
│ ▾ public          │ 2 │                                                    │
│   ▾ orders   1.2k │───┴───────────────────────── [Limit 100 ▾] [▶ Run] ──│
│     id  int4  PK  ├─ results ──────────────────────────────────────────────┤
│     total numeric │  #  │ id  │ customer_id │ total   │ status  │ created… │
│   ▸ customers     │  1  │ 101 │ 7           │ 12.50   │ paid    │ 2026-…   │
│ ▸ audit           │  …                                                      │
│                   ├─ status line 28px ─────────────────────────────────────┤
│                   │ 100 rows · 34 ms · limit 100        [Send to chat] [⧉] │
└───────────────────┴────────────────────────────────────────────────────────┘
```

- **Toolbar**: one 36px contextual toolbar, 16px outer inset, no repeated title (DESIGN.md). Left: `Database` icon 16px, connection `Select` ("shop-dev · PostgreSQL"), access badge (2px/6px inset) reading "Read only" (neutral muted) or "Changes need approval" (accent outline) — text, not colour alone. Right: Refresh schema (`RefreshCw`), overflow ActionMenu (Detach, Connection settings, Copy connection label).
- **Schema pane**: 240px default, 200–360px via a 6px divider (immediate drag geometry). 32px filter input (12px inset). Tree rows `--ui-row-compact/comfortable/touch`; 16px indent per level; 14px chevron and icons (`Table2`, `Eye` view, `Key` PK, `Link` FK, `ListOrdered` index); muted monospace type names; right-aligned muted tabular approx counts (`1.2k`). Selected/hover/focus distinct; focus uses `--ui-focus-ring`.
- **Editor**: monospace at the existing code size, 40px muted line gutter, 12px inset, raised surface, 1px border, focus ring. Run bar right-aligned under it: limit `Select` (100/500/1,000) and primary `Run` (`Play`, hint "Ctrl+Enter"); while running it becomes `Cancel` (`Square`) at the same width.
- **Results grid**: sticky 32px header (name + engine type in muted monospace at badge size); rows 28/32/44px by density; 44px muted row-number gutter; column width clamp(content) 80–320px, header-edge resize (min 48px); numbers right-aligned tabular; `NULL` italic muted; long text ellipsis + full value tooltip; binary `<bytes 1.2 KB>` muted. Focused cell: 2px inset focus ring; range: theme selection token; draft cell: low-emphasis attention tint + 6px corner dot + `aria-description="Changed, not saved"`; read-only columns (PK, generated) show a 12px `Lock` in the header.
- **Status line**: 28px, muted text: "`n` rows · `t` ms · limit `L`" (+ " · truncated" in attention colour with text) ; right side: "Send to chat" (quiet button) and Copy (`Copy` icon, copies selection as TSV). When grid drafts exist the right side shows "Review changes (n)" primary button and "Discard" quiet button.
- **Empty states** (copy rule "lead with the answer"): no attachment → centered 320px column: "Attach a database to this thread" + primary "Attach database" + quiet "Add a connection in Settings"; no rows → in-grid "No rows" muted; schema empty → "No tables in this database".
- **Errors**: inline error block between editor and grid, full width, 12px inset, semantic danger text colour with `CircleAlert` icon, engine message in monospace, caret position "line 2, column 14" when available, and one recovery action button where relevant ("Retry", "Edit connection", "Reattach"). Never a toast for query errors.
- **Narrow layouts**: under 560px panel width the schema pane collapses into a 36px "Tables" toggle that opens the tree as a Popover (8px from trigger, flip before shrink; DESIGN.md popup rules); editor min 96px, grid min `--ui-tool-body-min` (128px).

### Layout: Settings > Databases

- Section inside Skills & Integrations (Settings categories in DESIGN.md). List rows 54px (two lines: label; muted engine · host/database or file name · "Used by n threads"), 12px inset, row actions in an ActionMenu (Edit, Test, Delete). "Add database" primary button top-right of the section.
- Connection dialog: shared Modal, 24px dialog inset, width 520px. Engine segmented control at top (three options, 36px). Fields in one column, 8px gaps, labels above inputs. Password field type password with "Saved" placeholder when editing ("Leave empty to keep the saved password"). "Test connection" quiet button shows inline result line under the buttons (success: `CircleCheck` + "Connected · PostgreSQL 16.2 · 12 ms"; failure: danger text with cause). Footer: Cancel (quiet), Save (primary). Delete confirmation uses Modal with the count of attached threads.

### Layout: in-thread cards

- **Query result card** (`QueryResult` catalog component): standard artifact card width of the conversation column; header row: `Database` icon, connection label, "· n rows"; body: the SQL in a 2-line clamped monospace block (expand on click), then a mini grid (first 20 rows, max 8 visible columns, horizontal scroll), footer "Open in Database panel" quiet button. Uses the same grid cell rules as the panel.
- **Approval card** for `database.*` operations on connections: extends the existing operation approval presentation (`OperationExecutionReview.tsx` + the thread's operation card). Shows: engine + connection label + "writable" badge; each statement as monospace block with its parameters table (name/index, value) and "Expected: 17 rows"; schema digest short hash muted; buttons "Approve and run" (primary) / "Reject" (quiet). For grid edits, statements are additionally shown as a before → after table (column, old value struck through muted, new value).

### Motion (all values from DESIGN.md "Motion tokens"; easing `--ui-ease-enter` for entrances, `--ui-ease-move` for moves; exits ~20% shorter)

| Interaction | Motion |
|---|---|
| Panel open/close | Panel token 220/180 ms (`--ui-motion-panel-enter/exit`); divider drag is immediate geometry |
| Schema tree expand/collapse | Children height + opacity 180/140 ms (`--ui-motion-insert/remove`), chevron rotates 90° in the same time; 30 ms stagger capped at 150 ms (`--ui-motion-stagger`) only when ≤ 10 rows appear, else no stagger |
| Hover/focus colour on rows, cells, buttons | 120 ms (`--ui-motion-hover`) |
| Button press | 80 ms scale .97 (`--ui-motion-press`) without layout shift |
| Run → running | `Run`/`Cancel` crossfade 160 ms (`--ui-motion-status`); after 150 ms without a result a 2px indeterminate line fades in (120 ms) at the top of the results; no fake percent or minimum time |
| Results replace | Grid body 140 ms crossfade (`--ui-motion-tab`), widths and scroll kept when columns are unchanged; never per-row stagger |
| Status line update | 160 ms crossfade (`--ui-motion-status`) |
| Successful write | Changed cells clear their tint with one 240 ms success pulse (`--ui-motion-success`); status "17 rows changed" |
| Error block | Height + opacity 220/180 ms (attachment-row token values), focus is not moved; announced via live region |
| Draft cell change | Background tint transitions 120 ms |
| Completion popover, Select, ActionMenu, Tables popover | Popover token 180/140 ms, .95 scale from trigger origin (`--ui-motion-popup-enter/exit`) |
| Tooltips | 350 ms dwell (`--ui-tooltip-dwell`), 160/120 ms |
| Query result card insert in thread | List insert 180 ms (`--ui-motion-insert`) like other artifacts; not replayed on restore or snapshot |
| Approval card resolve | Status crossfade 160 ms; one 240 ms success pulse on "Applied" |
| Reduced motion (setting or `prefers-reduced-motion`) | No transforms, stagger, scale or moving progress line (static "Running…"); opacity ≤ 80 ms |

Rules: transitions are interruptible and retarget from current geometry; held controls (divider, column resize) never tween; no idle animation, bounce or shimmer; initial loads use structure-matched static skeletons (schema: 6 tree-row skeletons; grid: header + 8 row skeletons) appearing only after 150 ms.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Area | Location | Fact |
|---|---|---|
| SQLite domain tools | `packages/capabilities/database.ts` | `validateStatements` (one statement, no comments, DML/DDL verb allowlist, `expectedChanges` required for DML, denies ATTACH/PRAGMA…); `databaseJob` snapshots to an exclusive temp file for inspect/prepare and re-hashes the source; execute pins DB + exclusive empty journal; `runWorker` 30 s timeout, cancel → `CANCELLED` (read) / `OPERATION_OUTCOME_UNKNOWN` (execute) |
| SQLite worker | `packages/capabilities/sqlite-worker.mjs` | `node:sqlite` `DatabaseSync`, readOnly unless execute; `setAuthorizer` required (Node ≥ 24.10) with a deny-list; modes inspect/prepare/execute; 8 MiB serialized row budget; execute = `BEGIN IMMEDIATE`, count checks, `integrity_check`, `foreign_key_check`, `COMMIT` |
| Dispatch | `packages/capabilities/index.ts:131–143,197–201,244–247` | `database_inspect` → `publish(ctx, result, provenance)`; `database_prepare` → `ctx.prepareOperation("database.<mode>", args, [resourceId], {resourceVersion}, description)`; execution requires `approved`, `running`, same thread; reconcile |
| Schemas | `packages/capabilities/schemas.ts:19–20,37–38`; `README.md` | arg schemas (`statements` ≤ 100, sql ≤ 32,000, params ≤ 200) and descriptions; README documents the contract |
| Authority | `packages/core/tool-authority.ts:40–90` | `CLASSIFICATION` rows `[name,risk,replay,roles,binding,approval]`: `database_inspect` READ/run/none, `database_prepare` WORKSPACE_WRITE/domain-prepare/operation, `operation_execute` HOST_EXECUTE/operation; non-READ without approval path rejected |
| Progressive tools | `packages/core/context-progressive-tools.ts:16` | `deferredReads` includes `database_inspect` |
| Host tool metadata | `packages/runtime-pi/tool-definitions.ts:41` | shared metadata for all runtimes; DISCOVERY (T01): where `DOMAIN_TOOLS` merge and how flags gate tool lists |
| Grants | `packages/contracts/index.ts:17–18`; `packages/core/service.ts:1218–1223`; `packages/core/security.ts:45–70` | `ResourceGrant.kind` has `"database"`; `resource.grant` canonicalises, `assertNotStorage`, records dev/ino; `resolveGrant` denies writes on read-only grants and replaced roots |
| Operation | `packages/contracts/index.ts:17` | `{id,threadId,revision,kind,description,args,resourceIds,preconditions,status,approved,result?,error?}` |
| Approval UI | `apps/web/src/OperationExecutionReview.tsx`, `OperationProjectTrust.tsx`; `packages/core/operation-project-trust.ts` | advisory review per kind (`repository.test`); DISCOVERY (T01): where approve/reject renders |
| Records grid | `apps/web/src/InteractionTools.tsx:84–96`; `packages/ui-catalog/interactions.ts:9,51` | `EditableTable`: typed drafts, ≤ 8 columns × 50 rows, "Review changes" submits through the broker; mutations need native approval |
| Motion helpers | `apps/web/src/task-motion.ts` | `animateTask`, `MotionRegion`, `reducedMotion` |
| Tokens / rules | `packages/ui-shell/tokens.css`; `DESIGN.md` | token names in VISUAL_DESIGN_AND_MOTION; spacing, popup, motion, copy, loading rules |
| Flags | `packages/core/capability-flags.ts` | host-owned, default false, unknown keys reject; `*_FLAG_KEYS`, `CapabilityFlagKey`, `hostDefinitions` |
| Secrets | `packages/core/secret-references.ts:11–161`; `packages/contracts/integration-secrets.ts`; `apps/web/src/IntegrationSecretReferences.tsx` | `SecretReferenceLedger`, `createSecretRedactor`; DISCOVERY (T01): persistence and registering a new secret kind |
| Integrations | `packages/integrations/index.ts`, `manifest.ts:15` | bundled tool integrations + MCP stdio client; not used for DB drivers (D1) |
| Connections UI | `apps/web/src/Connections.tsx` | model-account status rows (visual precedent only) |
| Settings inventory | `apps/web/src/settings-inventory.ts:114–120` | rows `[id,label,category,keywords]` |
| Panels | `apps/web/src/WorkspaceSurfaceBody.tsx:46–74`; `workspace-native.ts:12`; `workspace-canvas-layout.ts:138` | kinds files/diff/output/usage/notes/context/terminal/pull-request/linked-pull-requests; DISCOVERY (T01): kind contract + launcher |
| Commands / routes / store | `apps/web/src/api.ts:115–124`; `apps/server/workspace-routes.ts:25,47`; `packages/storage/store.ts` | CSRF-authenticated `/api/commands` with receipts; route hook pattern; JSON `entities(kind,id,thread_id,body)` |
| Tests / fixtures | `tests/capabilities.test.ts:130–193`, `tool-authority-v3.test.ts`, `interactions-catalog.test.ts`, `host-capability-flags.test.ts`, `path-access.test.ts:198`; `scripts/create-fixtures.ts` | suites to extend; SQLite fixture exists; DISCOVERY (T01): Playwright spec dir (`playwright.config.ts`) |
| Deps | `package.json`; `pnpm-lock.yaml:4293` | no direct DB drivers; `pg@8.23.1` transitive (via `drizzle-orm`); no `mysql2` |

## DESIGN

### Architecture

- Settings UI → commands → `DatabaseConnectionService` (`packages/core/database-connections.ts`): entities `databaseConnection` (profile) and `databaseAttachment` (thread); password in the secret ledger.
- Panel UI → `/api/threads/:id/databases/…` routes, and agent tools → `DatabaseGateway` (`packages/capabilities/database-gateway.ts`) with `SqliteAdapter` (existing `databaseJob` + new `query` worker mode), `PostgresAdapter` (`pg`), `MysqlAdapter` (`mysql2`).
- Prepared `database.transaction|migration` operation → user approval → `executeDomainOperation` → adapter execute.

### Contracts (new file `packages/contracts/database.ts`, Zod 4, strict objects)

```ts
export const DATABASE_LIMITS = { maxRows: 1000, defaultRows: 100, maxColumns: 200, maxSerializedBytes: 8 * 1024 * 1024,
  maxCellDisplayBytes: 4096, maxCellFullBytes: 1024 * 1024, maxSchemaObjects: 2000, defaultTimeoutMs: 15_000, maxTimeoutMs: 30_000,
  connectTimeoutMs: 10_000, maxConcurrentPerConnection: 2, maxSqlChars: 32_000, maxHistory: 50 } as const;
export const databaseEngineSchema = z.enum(['sqlite', 'postgres', 'mysql']);
export const databaseTlsSchema = z.enum(['disable', 'prefer', 'require', 'verify-full']);
export const databaseConnectionV1Schema = z.strictObject({
  id: z.string().uuid(), version: z.literal(1), label: z.string().min(1).max(80), engine: databaseEngineSchema,
  sqlite: z.strictObject({ path: z.string().min(1).max(4096), identity: z.strictObject({ dev: z.string(), ino: z.string() }) }).optional(),
  network: z.strictObject({ host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535), database: z.string().min(1).max(128),
    user: z.string().min(1).max(128), tls: databaseTlsSchema, secretRefId: z.string().min(1).max(200) }).optional(),
  createdAt: z.string(), updatedAt: z.string() }).refine(c => (c.engine === 'sqlite') === Boolean(c.sqlite) && (c.engine !== 'sqlite') === Boolean(c.network));
export const databaseAttachmentV1Schema = z.strictObject({ id: z.string().uuid(), version: z.literal(1), threadId: z.string(),
  connectionId: z.string().uuid(), writable: z.boolean(), createdAt: z.string() });
export const databaseTargetSchema = z.union([
  z.strictObject({ resourceId: z.string().min(1).max(200), path: z.string().max(1024).optional() }), // existing SQLite grant
  z.strictObject({ attachmentId: z.string().uuid() }) ]);                                            // new connection attachment
export const databaseColumnSchema = z.strictObject({ name: z.string(), type: z.string(), nullable: z.boolean().optional(), primaryKey: z.boolean().optional() });
export const databaseCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null(),
  z.strictObject({ kind: z.literal('bytes'), length: z.number().int(), sha256: z.string(), previewHex: z.string().max(128) }),
  z.strictObject({ kind: z.literal('truncated'), preview: z.string(), length: z.number().int() })]);
export const databaseQueryResultV1Schema = z.strictObject({ version: z.literal(1), engine: databaseEngineSchema, connectionLabel: z.string(),
  sqlSha256: z.string(), columns: z.array(databaseColumnSchema).max(200), rows: z.array(z.array(databaseCellSchema)).max(1000),
  rowCount: z.number().int(), truncated: z.boolean(), truncatedReason: z.enum(['limit', 'bytes', 'columns']).optional(),
  elapsedMs: z.number().int(), executedAt: z.string(), source: z.strictObject({ table: z.strictObject({ schema: z.string().optional(), name: z.string(),
    primaryKey: z.array(z.string()) }).optional() }).optional() });
export const databaseSchemaV1Schema = z.strictObject({ version: z.literal(1), engine: databaseEngineSchema, serverVersion: z.string().optional(),
  schemas: z.array(z.strictObject({ name: z.string(), objects: z.array(z.strictObject({ kind: z.enum(['table', 'view']), name: z.string(),
    approxRows: z.number().nullable(), columns: z.array(databaseColumnSchema), foreignKeys: z.array(z.strictObject({ columns: z.array(z.string()),
    references: z.strictObject({ schema: z.string().optional(), table: z.string(), columns: z.array(z.string()) }) })),
    indexes: z.array(z.strictObject({ name: z.string(), columns: z.array(z.string()), unique: z.boolean() })) })) })),
  truncated: z.boolean(), digest: z.string() });
```

`source.table` is set only when the host generated the query (table preview) or a single-table `SELECT * FROM <t> [WHERE …] [ORDER BY …] [LIMIT n]` is proven by the adapter's own describe step (PG: `RowDescription` `tableID`/`columnID` all from one table and all PK columns present; MySQL: field `orgTable`/`orgName` all from one table and PK present; SQLite: `sqlite3_column_table_name` is not exposed by `node:sqlite` → SQLite edits only from host-generated table previews). Edits are allowed only when `source.table` is present.

### Commands, routes and tools

| Surface | Name | Payload / args | Notes |
|---|---|---|---|
| Command | `database.connection.create` | `{label, engine, sqlite?:{path}, network?:{host,port,database,user,tls,password}}` | password → secret ledger, never stored in the entity; SQLite path canonicalised + `assertNotStorage` |
| Command | `database.connection.update` | `{id, …same, password?}` | omitted password keeps the secret |
| Command | `database.connection.delete` | `{id}` | deletes secret and all attachments; open panels show "Connection removed" |
| Command | `database.connection.test` | `{id}` or unsaved `{engine,…,password}` | returns `{ok, serverVersion?, elapsedMs, error?}` |
| Command | `database.attach` / `database.detach` | `{threadId via command, connectionId, writable}` / `{attachmentId}` | rejects side/delegate threads (`SIDE_CHAT_READ_ONLY`/`CAPABILITY_DENIED`) |
| Route | `GET /api/threads/:threadId/databases/:attachmentId/schema` | — | returns `databaseSchemaV1`; cached per attachment for 30 s, Refresh bypasses |
| Route | `POST /api/threads/:threadId/databases/:attachmentId/query` | `{sql, limit, timeoutMs, requestId}` | read-only; result stored as a thread `DataRecord` (kind `data`, provenance `database-query`) and returned |
| Route | `POST …/query/:requestId/cancel` | — | cancels running query |
| Route | `POST /api/threads/:threadId/databases/:attachmentId/edits/prepare` | `{dataId, edits:[{rowIndex, column, value}]}` | builds statements (D12) and calls the same prepare path as `database_prepare`; returns operation id |
| Tool | `database_schema` | `{target}` | READ; returns bounded schema JSON (objects summarised beyond 300 tables: names only) |
| Tool | `database_query` | `{target, sql, params?, limit?:1..1000, timeoutMs?:1000..30000}` | READ; publishes DataRecord; returns `{dataId, columns, rows ≤200, rowCount, truncated, elapsedMs}` |
| Tool | `database_prepare` (extended) | existing args **or** `{attachmentId, mode, statements}` | connection target allowed only with flag on; MySQL `migration` → `INVALID_SQL` |

Routes reuse the host/origin/cookie/CSRF hooks of the existing route modules (`apps/server/workspace-routes.ts:25`). All routes and commands check `data.databaseBrowserV1` first.

### Read-only query execution per engine

- **SQLite** (`sqlite-worker.mjs` new mode `query`): same snapshot path as `inspect` (copy to exclusive temp file, re-hash source after). Open `readOnly:true`; `setAuthorizer` with an **allow-list**: `SQLITE_SELECT`, `SQLITE_READ`, `SQLITE_FUNCTION` (minus `load_extension`, `readfile`, `writefile`, `edit`, `fts3_tokenizer`), `SQLITE_RECURSIVE`; deny everything else. Prepare → `stmt.columns()` for names/declared types → iterate with the 8 MiB budget and row limit (`iterate()` + early break). Timeout via worker terminate.
- **PostgreSQL** (`pg` `Client`, `connectionTimeoutMillis: 10000`, `statement_timeout` also passed as a client option, `application_name: 'gen-database-browser'`, TLS per `tls` with `verify-full` using system CAs): `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` → `SET LOCAL statement_timeout = <ms>` → `SET LOCAL idle_in_transaction_session_timeout = <ms+5000>` → run the user SQL with the extended protocol (`client.query({text, values, rowMode:'array'})`, which rejects multiple statements) with a `Query` submittable that stops accumulating after `limit+1` rows or the byte budget (no extra cursor dependency), then `ROLLBACK`. Postgres rejects writes, `nextval`, `COPY FROM`, DDL inside a read-only transaction ("cannot execute … in a read-only transaction"). Residual risk: functions declared to write via `dblink`/untrusted languages — documented, and the Settings dialog recommends a read-only database role (help text).
- **MySQL** (`mysql2` `createConnection`, `multipleStatements:false`, `connectTimeout: 10000`, `supportBigNumbers:true`, `bigNumberStrings:true`, `dateStrings:true`, TLS per mode): `SET SESSION MAX_EXECUTION_TIME = <ms>` → `START TRANSACTION READ ONLY` → query with `rowsAsArray:true` streaming (`connection.query(...).stream()`) and stop at limit+1/bytes → `ROLLBACK`. Note MySQL `MAX_EXECUTION_TIME` only applies to SELECT; the host timer additionally issues `KILL QUERY` on a second connection.
- **Pre-check (all engines)**: trim, strip one trailing `;`, reject if empty, > 32,000 chars, or containing another `;` outside quotes/comments (simple tokenizer that understands `'…'`, `"…"`, `` `…` ``, `$tag$…$tag$`, `--`, `/* */`); leading keyword (after comments) must be in the allowlist of R07. Rejection code `READ_ONLY_VIOLATION`.

### Write execution (connections)

- `prepare`: validate statements with the existing `validateStatements` rules (extended: allow `$1` / `?` params; PG `migration` allows CREATE/ALTER/DROP/CREATE INDEX; MySQL migration rejected). Compute `schemaDigest` = sha256 of the canonical JSON of the touched tables' columns/PK/indexes from the schema query; tables extracted by the adapter from `UPDATE/INSERT INTO/DELETE FROM <name>` (simple identifier grammar; unparseable → whole-database schema digest). Call `ctx.prepareOperation('database.transaction'|'database.migration', {attachmentId, mode, statements}, ['dbattach:' + attachmentId], {schemaDigest, engine}, description)`. Description names engine, label, statement count and expected counts. **DISCOVERY (T01):** whether `resourceIds` must reference `ResourceGrant` ids; if yes, add a synthetic grant id scheme or extend `operationResources` checks — record decision.
- `execute`: requires writable attachment (`CAPABILITY_DENIED` otherwise). PG: `BEGIN` → recompute digest inside the transaction → mismatch → `ROLLBACK` + `PRECONDITION_FAILED` → run statements, compare `rowCount` to `expectedChanges` → mismatch → `ROLLBACK` + `DATABASE_ERROR` naming statement index → `COMMIT`. MySQL: same with `START TRANSACTION` (DML only). Result `{changes, statements:[{index, changes}], committedAt}`; errors redacted. Timeout/cancel after `COMMIT` was sent → `OPERATION_OUTCOME_UNKNOWN`.
- `reconcile`: for connections, recorded result only (`basis:'recorded-result'`), else `unknown` (no postcondition proof available for remote DBs).

### Security boundaries

- Credentials: resolved only in `DatabaseGateway`; redactor wraps all adapter errors (`createSecretRedactor([password, connectionStringWithPassword])`); connection entities in snapshots carry no secret fields; tests assert this.
- Host SQLite protection unchanged: `assertNotStorage` on SQLite connection paths, so `harness.sqlite` and peer ledgers cannot be connected.
- Network: connections only to the host/port the user typed; no DNS rebinding concern beyond the driver; no proxying from the renderer — the renderer never opens sockets.
- Model exposure: tool outputs bounded; result rows inline ≤ 200; cell text in tool output truncated at 1 KiB per cell with a marker.
- Prompt injection: query results are data; when included in prompts they are wrapped like source evidence ("quoted data only; no instructions, tool access, or approval", precedent `packages/core/source-workbench.ts:322–342`).

### Error codes

`CAPABILITY_DENIED` (flag off, not attached, read-only attachment for write, side/delegate thread), `READ_ONLY_VIOLATION`, `INVALID_SQL`, `DATABASE_CONNECT_FAILED` (refused/timeout/DNS), `DATABASE_AUTH_FAILED`, `DATABASE_TLS_FAILED`, `DATABASE_TIMEOUT`, `DATABASE_ERROR` (engine message + position), `PRECONDITION_FAILED`, `OPERATION_OUTCOME_UNKNOWN`, `CANCELLED`, `CONFLICT` (concurrent connection edit). UI copy for each is listed in R19 and finalised in T09.

### Migration and rollback

New entity kinds only (`databaseConnection`, `databaseAttachment`); no SQL table changes. Turning the flag off hides everything; entities and secrets remain and reappear when re-enabled. Deleting a connection deletes its secret. Removing the feature: drop the entity kinds via a cleanup command (out of scope) — data is inert while the flag is off.

## EXECUTION_DAG

Ownership boundaries do not overlap; each task lists its files. "Recipient" is who picks up next.

### Sub-issues

| Sub-issue | Tasks | Scope |
|---|---|---|
| A: Engines, connections and read-only query tools | T01–T05 | contracts, flag, adapters, connection service, routes, agent tools |
| B: Database panel, results grid, visual design and motion | T06–T09 | Settings section, panel, grid, catalog card, CSS/motion |
| C: Approved writes, tests, docs and front end review | T10–T12 | write path + grid edits, full validation, docs, front end handoff |

### Tasks

**T01 — Discovery and baseline record.** Deps: none. Owner boundary: read-only; posts one discovery comment on the parent issue.
Steps: (1) Record `git rev-parse origin/main`. (2) Record with file:line: secret persistence/registration (`secret-references.ts` callers); where prepared-operation approve/reject UI renders; where `DOMAIN_TOOLS` merge into host tools and how flags gate tool lists; panel-kind contract type and launcher; Playwright `testDir`; theme colour token names (surface, raised, border, text, muted, accent, danger, warning, success, selection); whether `Operation.resourceIds` must be grant ids (`packages/capabilities/index.ts:138–140`). (3) Pick exact `pg` 8.x / `mysql2` 3.x versions ≥ 30 days old; confirm MIT, no native code, transitive deps. (4) Confirm `node:sqlite` `StatementSync.columns()`/`iterate()` on Node ≥ 24.10.
Done when: a comment lists each finding with file:line and any plan deviation; if a finding contradicts this plan, revise the plan (REVISIONS rule) before T02. Tests: none. Recipient: T02/T06 owners.

**T02 — Contracts and flag.** Deps: T01. Files: new `packages/contracts/database.ts` (schemas above); `packages/core/capability-flags.ts` (add `DATA_FLAG_KEYS = ["data.databaseBrowserV1"] as const`, type, union member, `hostDefinitions` entry `{key:"data.databaseBrowserV1", owner:"data", description:"Database connections, schema browser, read-only queries and approved writes."}`); new `tests/database-contracts.test.ts`.
Tests: positive parse of each schema; negatives: sqlite engine with network block, port 0, label 81 chars, rows 1001, unknown keys; flag registry test in `tests/host-capability-flags.test.ts` (default false, unknown key rejects).
Done when: `pnpm typecheck` and the two test files pass. Recipient: T03, T04, T06.

**T03 — Engine adapters and gateway.** Deps: T02. Files: `package.json` (+`pg`, `mysql2` exact versions), `pnpm-lock.yaml`, `THIRD_PARTY_NOTICES.md`; new `packages/capabilities/database-gateway.ts` (interface `DatabaseAdapter { test(); schema(); query(sql, params, limit, timeoutMs, signal); prepareWrite(); executeWrite() }`, concurrency limiter ≤ 2 per connection, redaction, cell normalisation per R15); new `packages/capabilities/database-postgres.ts`, `database-mysql.ts`, `database-sqlite.ts` (wraps existing `databaseJob`); `packages/capabilities/sqlite-worker.mjs` (new `query` mode with allow-list authorizer, `columns()`); new `packages/capabilities/sql-precheck.ts` (tokenizer + verb allowlist).
Tests (`tests/database-gateway.test.ts`): SQLite always (fixture DB via existing fixture helper or created in test temp dir): select, limit+truncation, byte budget truncation, bytes/truncated cells, timeout, cancel, every A07 negative statement rejected and file hash unchanged. PG/MySQL: same suite behind env `GEN_TEST_POSTGRES_URL` / `GEN_TEST_MYSQL_URL` (skipped with explicit `SKIP` reason when absent; CI job proposal in T11). Precheck unit tests for quotes, dollar-quotes, comments, trailing semicolon.
Done when: SQLite suite passes locally; PG/MySQL suites pass against local containers (`docker run postgres:16`, `mysql:8.4`) on the implementer's machine with commands recorded. Recipient: T04, T05.

**T04 — Connection service, secrets and routes.** Deps: T02, T03. Files: new `packages/core/database-connections.ts` (commands of DESIGN table; entities `databaseConnection`, `databaseAttachment`; secret storage per T01 finding; side/delegate thread checks consistent with existing side-thread allow-list in `packages/core/service.ts`); `packages/core/service.ts` (dispatch new command types, include attachments — not secrets — in the snapshot or a dedicated read route, per T01); new `apps/server/database-routes.ts` + registration in `apps/server/server.ts`; DataRecord publication for panel queries.
Tests (`tests/database-connections.test.ts`): create/update/delete/test; password absent from snapshot/event/entity JSON; attach/detach; detach denies queries; side thread denied; flag off → `CAPABILITY_DENIED` for every command/route; SQLite path into harness storage denied; CSRF/origin rejection on routes (copy pattern of existing route tests).
Done when: tests pass, `pnpm typecheck`, `pnpm build`. Recipient: T05, T07.

**T05 — Agent tools.** Deps: T03, T04. Files: `packages/capabilities/schemas.ts` (add `database_schema`, `database_query`; extend `database_prepare` with the attachment target union — only accepted when the flag is on, enforced in the handler), `packages/capabilities/index.ts` (handlers, publish, prepare), `packages/core/tool-authority.ts` (rows `["database_schema","READ","READ_RETRYABLE",RUN,"read","none"]`, `["database_query","READ","READ_RETRYABLE",RUN,"read","none"]`), `packages/core/context-progressive-tools.ts` (add both to `deferredReads`), tool list gating per T01, `packages/capabilities/README.md` (tool table + semantics).
Tests: extend `tests/capabilities.test.ts` (schema/query on SQLite grant and on attachment; `database_prepare` attachment target → prepared operation with `schemaDigest`); `tests/tool-authority-v3.test.ts` (registry includes new rows; registration invariants hold); flag off → tools absent/denied; tool output bounded (≤ 200 rows, 1 KiB cells).
Done when: tests pass; a scripted runtime transcript (existing test harness) shows a `database_query` call producing a DataRecord. Recipient: T08, T10.

**T06 — Settings: Databases section and connection dialog.** Deps: T02 (contracts), T04 (commands; may start against contract types with mocked commands). Files: new `apps/web/src/DatabaseSettings.tsx`, `apps/web/src/database-settings.css`; `apps/web/src/Settings.tsx` (mount in Skills & Integrations when flag on); `apps/web/src/settings-inventory.ts` (row `["databases","Databases","<integrations category id from T01>","database sql postgres postgresql mysql sqlite connection query schema"]`); new `apps/web/src/database-api.ts`.
Done when: flows 1 and delete work against the host; visual spec of "Settings > Databases" met; keyboard-only operable; no password echoed. Tests in T11. Recipient: T07.

**T07 — Database panel: schema tree, editor, run/cancel.** Deps: T04, T06 (api module). Files: new `apps/web/src/database/DatabasePanel.tsx`, `SchemaTree.tsx`, `SqlEditor.tsx` (textarea + gutter + completion Popover from schema names; history recall Alt+ArrowUp/Down of the last 50 statements per connection kept in local UI state storage per T01's preference-storage finding), `database-panel.css`; panel-kind registration (`apps/web/src/WorkspaceSurfaceBody.tsx`, `workspace-native.ts`, `workspace-canvas-layout.ts`, contract type per T01); composer resource menu entry "Database…" (file per T01).
Done when: flows 2–4 work; narrow layout behavior; empty/error states per spec. Recipient: T08, T09.

**T08 — Results grid and in-thread card.** Deps: T05 (DataRecord shape), T07 (panel host). Files: new `apps/web/src/database/QueryResultGrid.tsx` (virtualized rows: render only visible rows + 10 overscan, fixed row height per density; column virtualization above 30 columns; ARIA grid; copy TSV; column resize; draft-edit mode API used by T10), `query-result-grid.css`; new catalog component `QueryResult` in `packages/ui-catalog` (schema + registry entry, following `INTERACTION_REGISTRY` pattern in `apps/web/src/InteractionTools.tsx:118`) and its renderer; "Open in Database panel" and "Send to chat" (composer quoted data attachment; mechanism per T01 — `sourceRefs` precedent in `packages/core/service.ts` send pipeline).
Done when: flows 5 and 8 work; perf target 3 met in a local measurement. Recipient: T09, T10.

**T09 — Visual design and motion conformance.** Deps: T06, T07, T08. Files: the CSS files above, `apps/web/src/task-motion.ts` reuse only (no new motion helper unless T01 finds none fits); copy strings.
Steps: implement every row of VISUAL_DESIGN_AND_MOTION; verify tokens only (no literal colours/durations — add a check to `pnpm lint:ui` if its rule set supports token enforcement, else a focused vitest that greps the new CSS for `#`, `rgb(`, `ms` literals); reduced-motion paths; dark/light; 100/125/150% zoom; Compact/Comfortable/Touch densities.
Done when: screenshots for each state (list in VALIDATION evidence) captured with `pnpm capture:ui` or Playwright, attached to the issue; `pnpm lint` and `pnpm test:ui-guard` pass. Recipient: T12.

**T10 — Approved writes and grid edits.** Deps: T05, T08. Files: `packages/capabilities/index.ts` (execute/reconcile for attachment targets), adapters' `prepareWrite/executeWrite`; `apps/server/database-routes.ts` (`edits/prepare`); `QueryResultGrid.tsx` edit mode + footer actions; approval card rendering for `database.*` connection operations (file per T01, `OperationExecutionReview.tsx` if it is the right owner).
Tests: prepare → approve → execute success on SQLite connection and (env-gated) PG/MySQL; count mismatch rolls back (row data unchanged); schema change between prepare and execute → `PRECONDITION_FAILED`; read-only attachment → `CAPABILITY_DENIED`; MySQL migration rejected; table without PK → edit controls disabled with tooltip "Editing needs a primary key"; cancel during execute → `OPERATION_OUTCOME_UNKNOWN`.
Done when: flows 6–7 work end to end. Recipient: T11.

**T11 — Validation suite.** Deps: T05, T09, T10. Files: new Playwright spec `database-browser.spec.ts` in the spec directory found in T01; redaction test `tests/database-redaction.test.ts`; perf test; optional CI proposal: a Linux job with `services: postgres:16, mysql:8.4` setting the env URLs (proposed in the PR, not merged without maintainer approval since CI is Windows-pinned per #1213).
Done when: acceptance matrix rows all have recorded evidence (PASS/FAIL/SKIP with reason). Recipient: T12.

**T12 — Docs, release and front end team review handoff.** Deps: T09, T11. Files: new `docs/database-browser.md` (user guide: connecting, read-only guarantees and their limits, recommended read-only DB role, approvals); `docs/feature-map.md` and `docs/progress.md` entries if those docs track flags (per T01); `scripts/public-source-files.json` entries for new files per CONTRIBUTING source-manifest rules.
Steps: (1) Post a HANDOFF checkpoint on this issue with `RECIPIENT=front-end-team`: PR + commit SHA, how to enable the flag locally, the VALIDATION visual evidence (dark + light), one recording of flows 1–7 plus reduced motion, and any deviations from VISUAL_DESIGN_AND_MOTION with reasons. (2) Ask the front end team to review visual design and motion against this plan. (3) Stay `HANDOFF_PENDING` until they ACK; apply requested changes on the same (or a linked) PR, re-request review, record their approval comment link. (4) Post the RELEASE checkpoint.
Done when: front end team review approval is recorded on the issue and all acceptance rows PASS or have maintainer-accepted SKIPs. Recipient: maintainer for merge.

### Requirement → task → acceptance map

| Req | Tasks | Acceptance |
|---|---|---|
| R01 | T03 | A01–A03 |
| R02 | T04, T06 | A04, A05 |
| R03 | T04, T05 | A06, A20 |
| R04 | T03, T05, T07 | A08 |
| R05 | T03, T07 | A09 |
| R06 | T05, T08 | A10 |
| R07 | T03 | A07 |
| R08, R09 | T10 | A11–A14 |
| R10 | T08, T10 | A15 |
| R11 | T08 | A16 |
| R12 | T04 | A17 |
| R13 | T08 | A18 |
| R14 | T02, T04, T05, T06 | A19 |
| R15 | T03, T08 | A21 |
| R16 | T03, T07, T10 | A22 |
| R17 | T03 | A23 |
| R18 | T07, T08, T09 | A24 |
| R19 | T03, T04, T07, T09 | A25 |
| R20 | T03, T11 | A26 |
| R21 | T03 | A27 |
| R22 | T09 | A28, A29 |
| R23 | T12 | A30 |

## VALIDATION

### Setup

```
pnpm install
pnpm exec playwright install chromium
pnpm typecheck && pnpm build
pnpm test --maxWorkers=1
# focused
pnpm exec vitest run tests/database-contracts.test.ts tests/database-gateway.test.ts tests/database-connections.test.ts tests/database-redaction.test.ts tests/capabilities.test.ts tests/tool-authority-v3.test.ts tests/host-capability-flags.test.ts --maxWorkers=1
# engines (optional, local)
docker run -d --name gen-pg -e POSTGRES_PASSWORD=gen -p 55432:5432 postgres:16
docker run -d --name gen-my -e MYSQL_ROOT_PASSWORD=gen -e MYSQL_DATABASE=gen -p 53306:3306 mysql:8.4
GEN_TEST_POSTGRES_URL=postgres://postgres:gen@127.0.0.1:55432/postgres GEN_TEST_MYSQL_URL=mysql://root:gen@127.0.0.1:53306/gen pnpm exec vitest run tests/database-gateway.test.ts --maxWorkers=1
pnpm test:e2e   # includes database-browser spec
pnpm lint && pnpm test:ui-guard && pnpm check:docs-links
```

Fixtures: each engine seeded with `customers(id PK, name, email)`, `orders(id PK, customer_id FK, total numeric, status text, created_at timestamp, blob bytea/blob)` 1,200 rows, a view `paid_orders`, a table without PK `audit_log`, one 10 KiB text cell, one 2 MiB blob row.

### Acceptance matrix (planned; nothing executed yet)

| ID | Check | Level |
|---|---|---|
| A01 | SQLite connection: test, schema, query | unit + e2e |
| A02 | PostgreSQL: test (version string), schema incl. FK/indexes, query | integration (env-gated) |
| A03 | MySQL: same | integration (env-gated) |
| A04 | Create/edit/delete connection; edit without password keeps secret; delete removes secret and attachments | unit |
| A05 | Test connection errors map to `DATABASE_CONNECT_FAILED`/`AUTH_FAILED`/`TLS_FAILED` with UI copy | unit + e2e |
| A06 | Unattached thread / detached attachment → `CAPABILITY_DENIED` for tools and routes | unit |
| A07 | Negative corpus rejected or fails read-only and data unchanged: `INSERT…`, `UPDATE…`, `DELETE…`, `DROP TABLE…`, `CREATE TABLE…`, `WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d` (PG), `SELECT nextval('s')` (PG), `SELECT * FROM orders; DELETE FROM orders`, `/*x*/DELETE FROM orders`, `ATTACH DATABASE…` (SQLite), `PRAGMA writable_schema=1`, `SELECT load_extension('x')`, `COPY orders FROM '/tmp/x'` (PG), `SELECT … INTO OUTFILE` (MySQL), `CALL proc()`, `SET GLOBAL…`, `LOCK TABLES…`, `GRANT…`; SQLite file hash identical; PG/MySQL row counts and checksums identical | unit + integration |
| A08 | Schema bounded at 2,000 objects with `truncated:true`; approx counts shown | unit |
| A09 | Panel query: limit 100/500/1000, truncation by limit and by 8 MiB bytes, elapsed ms shown | e2e |
| A10 | Agent `database_query` publishes DataRecord, output ≤ 200 rows, cells ≤ 1 KiB | unit |
| A11 | Approved write executes and returns counts | unit + integration |
| A12 | Count mismatch → rollback, data unchanged | unit + integration |
| A13 | Schema changed after prepare → `PRECONDITION_FAILED`, nothing written | unit + integration |
| A14 | Read-only attachment / MySQL migration / unapproved operation rejected | unit |
| A15 | Grid edit on PK table → approval with before/after → applied; no-PK table and views not editable | e2e |
| A16 | Query result card renders 20-row preview and opens the panel with the same data | e2e |
| A17 | Password never in snapshot, events, store JSON, DataRecords, prompts, logs, errors (grep all outputs in test) | unit |
| A18 | Panel results not in the model prompt unless "Send to chat"; with it, quoted-data wrapper present | unit |
| A19 | Flag off: no Settings section, no panel kind, commands/routes/tools denied or absent, `database_prepare` baseline schema | unit + e2e |
| A20 | Side/delegate thread cannot attach; child cannot query | unit |
| A21 | Bytes/truncated cell representations; bigint/decimal strings; ISO dates | unit |
| A22 | Cancel running read (all engines) → `CANCELLED` within 2 s; cancel during write → `OPERATION_OUTCOME_UNKNOWN` | unit + integration |
| A23 | Third concurrent request per connection queues; connect timeout 10 s | unit |
| A24 | Keyboard-only: tree, grid navigation and edit, editor run/cancel, dialogs; axe scan clean for the panel and dialog | e2e |
| A25 | Each R19 error shows its copy and recovery action; drafts and SQL kept | e2e |
| A26 | Packaged Windows x64 smoke: SQLite and PG connections work in the desktop build | real-user (Windows) |
| A27 | Licenses recorded; versions exact-pinned | review |
| A28 | Visual spec: dimensions, tokens only, dark/light, 100/125/150% zoom, three densities, narrow layout | e2e screenshots + review |
| A29 | Motion: durations/easing per table; reduced motion removes transforms/stagger; no replay on restore | e2e + recording |
| A30 | Front end team review requested with evidence and approval recorded on the issue | review |

**Visual evidence to capture (T09/T12):** Settings list (empty, 2 connections), connection dialog (each engine, test success, test failure), panel (no attachment, schema loading skeleton, tree expanded, query running, results, truncated, error, read-only violation, narrow layout), grid edit drafts, approval card (agent write, grid edit), query result card in thread — each in dark and light; plus one recording of flows 1–7 and one with reduced motion.

**Release gate:** all A01–A25, A27–A30 PASS; A02/A03/A26 PASS or explicitly accepted SKIP by the maintainer with reason; flag stays default false until the maintainer enables it.

## STATE

| Item | State |
|---|---|
| Research and decisions | DONE (this plan, r1) |
| Implementation | NOT_STARTED (T01–T12) |
| Verification | NOT_RUN (no tests executed while planning) |
| Owners/branches | none yet; plan docs PR on branch `devin/database-browser-plan` |
| Risks | PG side-effecting functions via extensions (`dblink`, untrusted PLs) are not blocked by read-only transactions → documented + read-only role advice; MySQL `MAX_EXECUTION_TIME` covers SELECT only → host `KILL QUERY`; `node:sqlite` lacks column-origin metadata → SQLite edits only from table previews; secret storage and `Operation.resourceIds` semantics pending T01; Windows-pinned CI → PG/MySQL tests env-gated |
| Exact next step | T01 discovery comment on this issue by the first implementing worker |

## REFERENCES

- Proposal source: researched feature proposal batch 3, item 8 (content reproduced in META/OBJECTIVE; approved by Leonardo 2026-11-21).
- Comparable tools: Tusk https://usetusk.app/ · Tabularis https://tabularis.dev/ · PgVoyager https://github.com/thelinuxer/pgvoyager
- Read-only transactions: PostgreSQL `SET TRANSACTION` docs https://www.postgresql.org/docs/current/sql-set-transaction.html · MySQL `START TRANSACTION READ ONLY` https://dev.mysql.com/doc/refman/8.4/en/commit.html · MySQL `MAX_EXECUTION_TIME` https://dev.mysql.com/doc/refman/8.4/en/optimizer-hints.html
- Drivers: node-postgres https://node-postgres.com/ · mysql2 https://sidorares.github.io/node-mysql2/docs
- SQLite authorizer: Node `node:sqlite` docs https://nodejs.org/api/sqlite.html · SQLite action codes https://www.sqlite.org/c3ref/c_alter_table.html
- ARIA patterns: tree https://www.w3.org/WAI/ARIA/apg/patterns/treeview/ · grid https://www.w3.org/WAI/ARIA/apg/patterns/grid/
- Repository: `AGENTS.md` (plan, checkpoint, handoff and release contracts), `CONTRIBUTING.md`, `DESIGN.md`, files in REPO_MAP at baseline `e883ac0327c834120d89c3697dec7380a342ba4d`.
