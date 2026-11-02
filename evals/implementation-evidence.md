Implementation verification, 2026-10-29 (local Windows, Node 24.14.0).

- `pnpm test`: exit 0, 5 test files, 56 tests passed. Capabilities-owned suite: 23 tests.
- `pnpm exec tsc --noEmit --pretty false`: exit 0, no diagnostics.
- Actual CLI entry-point smoke is in `tests/capabilities.test.ts`: disposable fixture creation exit 0; unexecuted evaluation exit 2 with `status:"pending"`, `expected:36`, `aggregate:null`, mandatory novel gate pending. It creates no model responses.
- Real local evidence covers Git conflict/status/diff/log, exact file hashes and stale-source rejection, approval/thread/write resolver checks, SQLite updates/counts/rollback/migration/integrity/version, PDF text/fields/fill/typed and drawn mark export and preserved existing outputs, read-only file/DB/PDF reconciliation, and actual node-test pass/failure exits.
- The Windows cancellation test spawns an actual test descendant process, cancels the prepared test, observes cancellation and verifies that the descendant PID no longer exists.
- Surface tests cover all 24 schemas/examples, opaque UUID resource IDs, Disclosure/table retained-state props, unknown props/types, unsafe image URLs, expression objects, dangling references, cycles/unreachable content, 200-node acceptance, depth-12 acceptance, and byte-limit rejection across valid individual props including multibyte text.
- Node's experimental SQLite warnings are retained in test output.

No live authenticated model run or novel-app interaction review was performed. No visual/native UI acceptance or 36-run pilot pass is claimed. The held-out allocation is 3 coding / 3 research-data / 2 documents / 2 planning / 2 novel-apps, sealed by `b44f476e974f0e0f3a44da6b62ed13ce5c4036f9d8bd58aa0ff38025d0a04275`. All model-dependent acceptance remains pending.

Handoff: [tool APIs and limits](../packages/capabilities/README.md), [frontend props and bindings](../packages/ui-catalog/README.md), [evaluation workflow](README.md). External SQLite tools require Node >=24.10 with an authorizer and deliberately reject active WAL/journal databases. PDF visual marks have no certificate; no OCR/email capability is advertised. Root must preserve `OPERATION_OUTCOME_UNKNOWN` as unknown and use read-only reconciliation, never automatic retry.

Only the assigned implementation paths were edited. No dependencies, root configuration, staging, commits or delegated descendants were created.
