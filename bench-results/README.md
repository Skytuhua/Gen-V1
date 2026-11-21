# Startup benchmark results

`pnpm bench:startup` (scripts/bench-startup.ts) writes one `<sha>-<timestamp>.json`
per run and prints a p50/p95/mean table. Files in this directory are ignored except
this README, the `.gitignore`, and committed `baseline-*.json` snapshots.

## Metrics

| Metric | What it samples |
| --- | --- |
| `host_boot_ms` | `node --import tsx apps/server/main.ts` spawn to first `/api/bootstrap` 200 (the desktop sidecar shape; `--bundle` uses `dist/host/main.mjs` when built). Fresh empty profile per run. |
| `snapshot_serialize_ms` | 20 `GET /api/snapshot` reads on a seeded store via the real session cookie. Includes warm reads answered by the server's per-sequence JSON cache. |
| `store_snapshot_ms` | In-process `Store.snapshot()` on the seeded database; isolates query+JSON.parse cost from HTTP and `JSON.stringify`. |
| `first_render_ms` | Chromium `goto` to first `[data-thread-id]` row on a seeded workspace; requires `pnpm build`. Records `first-contentful-paint` inside the run note. |
| `split_interaction_ms` | `split-workspace.pane.split`/`pane.resize` command response plus two painted frames, driven in-page against the app's own session. |

## Seeded store

`seedStore()` writes a synthetic profile through `Store.internal('bench.seed', …)`:
200 threads × 50 messages (10,000 message entities) plus the thread entities, no
artifacts, requests, resources or accounts. Sizes are recorded in each run's
`seed` block; keep this paragraph and the `SEED_*` constants in sync.

## Notes

- Numbers are host-relative. Compare runs on the same machine and Node version;
  the JSON records `sha`, `node` and `platform` for that reason.
- `--check` enforces the `BUDGETS` table in scripts/bench-startup.ts. Budgets are
  set from the committed `baseline-*.json` (issue #1057) — until then the flag is
  a no-op so CI cannot fail on unseeded values.
