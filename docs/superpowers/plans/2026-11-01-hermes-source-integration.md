# Original Hermes Source Implementation Plan

> **For agentic workers:** Use the existing native collaboration workflow with explicit file ownership and tests first. Parent obtains independent reviews before final acceptance.

**Goal:** Execute original Hermes source for the harness's learning and skill system instead of the previous TypeScript approximation.

**Architecture:** Pinned upstream Python engine → original ACP client → small Node model-only transport → existing account-aware runtime. Hermes owns skill packages/ledger; the existing Store projects UI metadata.

**Tech Stack:** Existing TypeScript/React/Node/SQLite adapters plus pinned Python 3.14 and Hermes runtime dependencies. No additional agent framework or scheduler.

**Spec:** `docs/superpowers/specs/2026-11-01-hermes-source-integration.md`.

## Global constraints

- Vendor upstream bytes unchanged with source hashes/licenses; keep compatibility code outside the vendored tree.
- No fake AIAgent, rewritten source algorithms, duplicate writable skill store or hidden provider fallback.
- Preserve account/epoch/grant/approval/receipt/draft authority. No global credential/profile access or lazy installation.
- Cleanup requested earlier is deferred. Use trace-free focused browser checks and bounded artifacts.

## Review focus

- Native tool calls cannot escape the text-only transport or execute an effect twice.
- Stop/close/foreground preemption must await all owned Python/ACP/native descendants.
- Actual model usage must survive the ACP client's unmeasured zero counters.
- Legacy bodies, history, proposals, disabled/protected flags and drafts survive canonical-store migration.
- A second host cannot recover or execute against an already-owned profile.

### Task 1: Original source and Python worker

- [x] Vendor the reviewed runtime closure, original tools/prompts/tests and required data with exact blob/SHA-256 custody.
- [x] Pin isolated Python/dependencies; exercise actual source modules under an app-owned home with no lazy installs.
- [x] Implement the worker protocol and original provider registration; test real AIAgent/tool/review execution against a scripted ACP transport.

### Task 2: Host/runtime integration

- [x] Add the owned model-only ACP server and keep native host tools disabled/denied across all nine routes.
- [x] Connect the original agent runtime, receipts, events, follow-ups, cancellation, history and usage to Service.
- [x] Replace custom writable learning/skill behavior with the source adapter and migrate/project existing UI data.

### Task 3: Confirmed quality fixes

- [x] Add exclusive profile ownership before recovery and truthful side-owner shutdown failure.
- [x] Exclude archived bodies from active snapshots while preserving restoration.
- [x] Refuse existing release destinations and support one explicit packaging output root.

### Task 4: Verification and delivery

- [x] Run source-conformance and host-boundary tests, all-nine routing and appropriate UI/native checks.
- [x] Resolve independent code/security findings and publish source-reuse, quality comparison and exact proof boundaries.
- [x] Commit the coherent verified change; leave any genuinely unmet capability explicit rather than claiming parity.

Acceptance: 982/982 current regression tests, 9/9 functional browser checks with tracing off, 4/4 atomic-control and 5/5 source-custody/parser checks, TypeScript and web/desktop shell builds passed. Actual selected-model text, original `/learn`/approval and fresh-session reuse passed. Full relocated Python assets were verified and removed after the check. No new installer was built. The linked integration report records the exact proof limits and remaining product gates.
