# Flaky test report — 2026-11-19

Scope: root-cause read of the known Browser tests flake tracked in
[issue #993](https://github.com/skytuhua-org/Gen-V1/issues/993). No code or
tests were changed.

## Results

| Test | Failure rate | Likely cause |
| --- | --- | --- |
| `tests/e2e/tool-effects-host.spec.ts:12` — "approved file replacement exposes its durable ledger receipt through the actual host" | 8 of the last 11 red main runs (≈8/38 ≈ 21% of completed main CI runs, Nov 18–19) | `HostFixture.close()` never settles; two candidate waits identified inside it (below) |

## Failure signature

CI run [44613472925](https://github.com/skytuhua-org/Gen-V1/actions/runs/44613472925)
(also 44598154959, 44587001582, 44560112666):

```
Test timeout of 60000ms exceeded.
Tearing down "host" exceeded the test timeout of 60000ms.
page.goto: Target page, context or browser has been closed
    at openHost (tests/host-fixture.ts:221) via tests/e2e/tool-effects-host.spec.ts:72
```

## Verified hang location

The test reaches `page.goto('about:blank')` at spec line 67 (done at ~7.1s in
the trace), then calls `host.restart()` at line 68, which awaits
`HostFixture.close()` (`tests/host-fixture.ts:196-199` → `185-195`).

- The run's `host-observations.json` records exactly **one** runtime generation
  (`runtimeDeliveries` = 2: `start` + `followUp`, both `succeeded`), so the
  restart never reached `start()` — the stall is inside `close()`.
- The fixture teardown also exceeds its timeout because `close()` returns the
  same shared `this.closing` promise (`tests/host-fixture.ts:189`), confirming
  the first `close()` call is the one that never settles.

## Close-step analysis (`tests/host-fixture.ts:189-194`)

`close()` awaits four steps in order: `host.close()` → `widgets.close()` →
`service.dispose()` → `store.close()`. Assessment of each:

1. **`store.close()`** — `packages/storage/store.ts:266` is a synchronous
   `db.close()`. **Eliminated**; it cannot hang.

2. **`widgets.close()`** — `apps/server/server.ts:369-` (`buildWidgetServer`)
   is a plain Fastify server with no hijacked or streaming routes, and this
   spec never mounts a widget iframe. Would only stall on a stray live socket.
   **Low likelihood.**

3. **`host.close()`** — plausible. `apps/server/server.ts`:
   - Both SSE routes are hijacked: `/api/events` (`server.ts:279-286`) and
     `/api/agents/events` (`agent-inventory-routes.ts:40-78`).
   - Each is released in a `preClose` hook: `destroyEventStreams`
     (`server.ts:362-366`, `event-stream.ts:9-13`) and
     `agent-inventory-routes.ts:79`. All `onClose` hooks are trivial.
   - **Residual race:** `preClose` runs while the HTTP server is still
     accepting connections. A request that reaches `registerEventStream`
     (`event-stream.ts:18-30`) *after* `destroyEventStreams` has cleared the
     `streams` map registers a stream that is never destroyed — its socket
     stays open and `server.close()` waits on it indefinitely. There is no
     "registry closed" guard; `registerEventStream` only checks whether the
     response itself is already closed.

4. **`service.dispose()`** — plausible. `packages/core/service.ts:2343-2350`:
   - `backgroundWork.drain` is bounded to 5 s
     (`contracts/background-work.ts:22`); `intake.drain` is a bounded loop
     (`external-intake.ts:347-352`); `predictions.dispose` cannot block here
     because no slot forms for the non-connection `fixture/*` model
     (`composer-prediction.ts:56-57`); `planning`, `agentWork`, `sideRuntime`,
     `learning` only await live owners/batches — none exist in this spec.
   - **`await Promise.allSettled([...this.pending])` (`service.ts:2348`) is
     the only genuinely unbounded await in the close path.** `this.pending`
     collects every `background()` task: `deliverOutbox` chains
     (`service.ts:1576` → `1603` → `admit`), compaction tails
     (`service.ts:569`), memory/library commands, and `cancelRun` chains
     (`service.ts:1748`). `deliverInputs` itself can recurse after
     `cancelComposerPredictions()` (`service.ts:1614`) and after
     request-context settlement (`service.ts:1727`). If any such task is
     in-flight and unbounded when `dispose()` snapshots `this.pending`,
     `dispose()` waits on it forever — and a late `deliverOutbox` enqueue
     (`queueMicrotask` at `service.ts:300`) can repopulate `this.pending`
     between the snapshot and settle.

## Ranked likely causes

1. **`service.dispose()` waiting on `this.pending`** — an in-flight
   `background()` delivery/compaction/cancel chain with no bound
   (`packages/core/service.ts:2348`, enqueued at `300`, `569`, `1236`,
   `1574`, `1748`). Best fit for a hang that outlasts both the 60 s test
   timeout and the 60 s teardown timeout while all bounded drains complete.
2. **`host.close()` waiting on a re-registered SSE socket** — the
   `preClose` → `server.close()` window lets a late `/api/events` request add
   a stream after `destroyEventStreams` ran
   (`apps/server/server.ts:362-366` + `apps/server/event-stream.ts:18-30`).
3. **`widgets.close()` waiting on a stray socket** — same mechanism class,
   far less surface (`apps/server/server.ts:369`).

## Reproduction notes

- Platform: the flake appears only on the `windows-latest` **Browser tests**
  job. Local Linux reruns cannot reach the restart path — they fail earlier
  at `CAPABILITY_DENIED` from the Linux path guard (a known, separate
  Linux-only failure also seen on PR #950's verification run).
- The merged diagnostics in `tests/host-fixture.ts` (PR #950) record
  `HOST_FIXTURE_CLOSE_PENDING` after 10 s per close step and write
  `closeStages` into `host-observations.json`; the next Windows failure
  names the exact step and (for `host.close`) the open-socket count.
  Issue #993's completion criteria depend on that evidence.

## Recommended next steps

1. Read `closeStages`/`HOST_FIXTURE_CLOSE_PENDING` from the first post-#950
   Windows failure to pick between `host.close` and `service.dispose`.
2. If `service.dispose`: add a bound or a close-time cancel for `this.pending`
   tasks (e.g. abort before awaiting, or bound `deliverInputs` recursion).
3. If `host.close`: mark the `streams` registry closed during `preClose` and
   reject `registerEventStream` callers that arrive after it, so late SSE
   registrations cannot survive the map clear.
