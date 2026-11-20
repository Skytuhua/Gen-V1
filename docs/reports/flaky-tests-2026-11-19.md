# Flaky test report — 2026-11-19

Scope: `main` (26ddf4d1). Method: full `npx vitest run` (529 files, ~6 500
assertions) executed 3 times with the JSON reporter; per-assertion failure sets
diffed across runs. Timing- and process-sensitive files then rerun in
isolation 50 times each. No source or test file was changed.

## Suite-level result

All 293 failing assertions were **identical in every run** — zero cross-run
variance. Every failure is a deterministic environment limitation of this
Linux VM (unavailable linux-path-guard broker → `CAPABILITY_DENIED`, missing
Playwright `headless_shell` binary, no hermes worker runtime, no desktop
host), which fails the same way on a clean `main`. Isolation reruns:

| Test file | Isolated reruns | Observed failures |
|---|---|---|
| tests/agent-work-v3.test.ts | 50 | 0 |
| tests/background-contract-decisions-v6.test.ts | 50 | 0 |
| tests/background-work-v3.test.ts | 50 | 0 |

No test is nondeterministically flaky *on this VM*. The entries below are
flake-prone defects found by reading the tests and the code they touch, plus
two flakes already observed in CI. Sorted by likelihood of intermittent
failure under CI load.

## Findings

### 1. `freePort()` bind-release-reuse race (port reuse / process timing)

Files and lines:

- `tests/desktop-host.test.ts:119` — helper; ports picked at lines 129, 150
- `tests/hermes-host.test.ts:11` — helper; ports picked at line 14
- `tests/project-memory-maintenance-host.test.ts:16-19` — helper; line 35

Each helper does `listen(0)` → reads the port → `close()` → hands the number
to a child/host that binds it seconds later. In that window any parallel
worker or process can take the port; the launch then reports `harness.error`
instead of `harness.ready` and the test fails with "Desktop host reported a
startup error before harness.ready" (`tests/desktop-host-ipc.ts:13`). The
`while (widgetPort === port)` dedup guards only within one test, not across
workers.

Reproduction evidence (standalone script, same pattern): stealing the
released port yields `EADDRINUSE`; 2 000 rapid `freePort()` calls re-issued a
previously returned port 262 times (≈13%) — the kernel readily re-hands
released ephemeral ports, so the race window is real on busy CI hosts. CI
history corroborates: `cadad555` — "retrigger CI (flaky hermes-service 60s
timeout, widget-isolation spawn failure)".

### 2. `hermes-service` 60 s timeout (CI-observed flake)

File: `tests/hermes-service.test.ts` — worker/service startup path.

Commit `cadad555` ("M01: retrigger CI") names this exact test file's 60 s
timeout as a known CI flake. The suite spawns a real hermes worker; under
load the startup/ready handshake can outlast the test's 60 s budget. On this
VM the file fails deterministically for unrelated environment reasons
(`CAPABILITY_DENIED` from linux-path-guard), so the timeout could not be
reproduced or measured here.

### 3. `widget-isolation` spawn failure (CI-observed flake)

File: `tests/widget-isolation.test.ts` — trusted-receiver spawn tests.

Named alongside the hermes timeout in `cadad555`. The spawn-based tests
launch the production `tsx` loader and browser frame — a multi-process
startup susceptible to the same startup-budget flake. 16 of 22 tests are
skipped on this VM (no Playwright binary), so the failure could not be
reproduced locally.

### 4. Unbounded spin-wait (test-order / load hang)

File: `tests/agent-work-v3.test.ts:360`

```ts
while (!f.coordinator.inspect(spec.workId)) await new Promise(resolve => setTimeout(resolve, 5));
```

The poll has no timeout of its own; if `admit()` stalls under CPU
contention, the loop spins until the vitest test timeout kills the test —
indistinguishable from a real hang. 50/50 isolated runs passed; risk is
load-dependent, not deterministic.

### 5. Fixed-name tmpdir fixtures (shared state across workers)

Files and lines:

- `tests/official-runtime-storage.test.ts:12` — `join(tmpdir(), 'official-profile-fixture')`
- `tests/verification-executor.test.ts:25` — `join(tmpdir(), 'backend-owned-test-profile')`
- `tests/credential-store.test.ts:34` — `join(tmpdir(), 'never-opened-credential.json')`

Unlike the `mkdtemp` convention used elsewhere, these fixed paths collide if
two workers or leftover state from a killed run touch them — stale files can
leak between runs. Currently each is used by a single file, so the collision
risk is low but nonzero.

### 6. Tight real-timer sleeps (timing margins)

Files and lines:

- `tests/background-work-v3.test.ts:45` (20 ms), `:217` (50 ms), `:474`/`:496` (300 ms)
- `tests/background-contract-decisions-v6.test.ts:40` (10 ms), `:48` (40 ms), `:208` (20 ms)

These assert ordering/state after fixed `setTimeout` delays on the real
clock; a loaded CI machine can delay the timer past the asserted boundary.
All passed 50/50 isolated on this (idle) VM, so the margins hold locally but
remain the standard flake vector for this suite.

## Summary

| Rank | Issue | Type | Observed local rate | Evidence |
|---|---|---|---|---|
| 1 | `freePort()` TOCTOU port race | port reuse | 0 (repro via script: EADDRINUSE) | tests/desktop-host.test.ts:119, hermes-host.test.ts:11, project-memory-maintenance-host.test.ts:16; `cadad555` |
| 2 | hermes-service 60 s timeout | startup budget | n/a (env-limited) | `cadad555` |
| 3 | widget-isolation spawn failure | process spawn | n/a (env-limited) | `cadad555` |
| 4 | unbounded 5 ms poll | test-order/load | 0/50 | agent-work-v3.test.ts:360 |
| 5 | fixed tmpdir fixture names | shared state | 0 | official-runtime-storage.test.ts:12 et al. |
| 6 | real-timer sleep assertions | timing margin | 0/150 | background-work-v3.test.ts:45 et al. |

Deterministic environment failures (293 assertions) are tracked separately
from flakiness: they fail on every run and are out of scope here.
