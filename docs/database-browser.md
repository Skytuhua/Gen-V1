# Database browser

Connect a SQLite file, PostgreSQL or MySQL database, browse its schema, run
read-only queries into a results grid, and make writes only through prepared
operations you approve. Everything is behind the `data.databaseBrowserV1`
capability flag — off by default.

## Connecting

Settings → Skills & Integrations → Databases → **Add connection**:

- **SQLite** — a file path on the host running Gen. The path is canonicalised
  and verified as a regular file; the workspace storage root is always denied.
- **PostgreSQL / MySQL** — host, port, database, user, password and TLS mode
  (`disable` / `require` / `verify-full`).

The password is stored as a host secret (`dbconn:<id>`) and never appears in
records, snapshots, events, logs, model prompts or error output. Use **Test** to
probe the connection before saving; **Update** without a new password keeps the
stored one.

> Recommended: create a dedicated database role with `SELECT` (and, if you plan
> to approve writes, `INSERT`/`UPDATE`/`DELETE`) on the tables you expose. The
> read-only guarantees below are enforcement inside Gen; a least-privilege DB
> user is the second layer.

## Attaching to a thread

From the Database panel (or the composer resource menu) attach a connection.
Attachments are **read-only by default**; enable "Allow approved changes" to
permit prepared writes. Detaching removes the grant for that thread.

## Browsing and querying

The schema tree lists schemas → tables/views → columns, keys and indexes
(cached 30 s; the refresh button bypasses the cache). Clicking a table fills
the editor; Ctrl/Cmd+Enter or **Run** executes the SQL.

Read-only guarantees and their limits:

- Statements go through a keyword precheck (INSERT/UPDATE/DELETE/DDL/PRAGMA/
  ATTACH etc. rejected) **and** run inside a driver-level read-only transaction
  on PostgreSQL/MySQL; SQLite runs a worker-side read-only check.
- Results are bounded: at most 1,000 rows and the configured byte/column caps
  (`DATABASE_LIMITS`); truncation is marked on the result.
- The precheck is a SQL-text heuristic — a least-privilege role is still the
  defence of last resort for exotic dialect constructs.

## Writes (approval required)

Two entry points produce the same `database.transaction` operation:

- **Grid edits** — on a single-table `SELECT` over a table **with a primary
  key**, enable **Edit**, change cells, then **Review changes**. Gen produces
  one parameterized `UPDATE … WHERE <pk> = ?` per edited row with
  `expectedChanges: 1`. Tables without a primary key, views, joins and
  non-SELECT results are not editable (the Edit button explains why).
- **Agent-proposed statements** — the agent prepares DML via the same path.

The approval card shows the exact SQL, parameters and expected row counts.
Execution runs in one transaction; if any row count mismatches or the schema
digest changed since preparation, everything rolls back. SQLite writes go
through the existing `databaseJob` execute lane with the schema digest as the
resource version; PostgreSQL/MySQL go through the adapter `executeWrite`
(BEGIN → in-transaction schema re-check → per-statement count check → COMMIT).
MySQL attachments accept DML transactions only — migrations are rejected at
prepare time with `CAPABILITY_DENIED`.

## Agent tools

`database_schema` and `database_query` (read-only, bounded) run on attached
connections in the same thread. Results publish as `DataRecord`s with
`database-query` provenance and render as compact cards that open the panel.

## Environment

- `GEN_TEST_POSTGRES_URL` / `GEN_TEST_MYSQL_URL` — enable the env-gated
  PG/MySQL adapter tests.
- Flags: `data.databaseBrowserV1` gates every route, tool and setting row.
