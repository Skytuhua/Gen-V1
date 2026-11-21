<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1104 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: remove `any` casts in `packages/runtime-official/`
- Repo: `skytuhua-org/Gen-V1`; plan revision 1, 2026-11-20
- Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified `git rev-parse HEAD`)
- Issue: #1104. Source provenance: reviewer `devin-a-cloud-51c9e2`, read-only inspection.
- Current status: NOT_STARTED. Verified on baseline: only **5** hits remain — `gemini.ts`, `gemini-native-history.ts`, `cursor.ts`, `cursor-worker.ts`, `history-command.ts`, `claude.ts` are already clean on main (issue text predates that cleanup).

### OBJECTIVE
`rg -n "as any|: any\b" packages/runtime-official` → 0 non-test hits, `pnpm typecheck` passes, zero behavior changes. Success is mechanical: every hit below replaced by the exact type given.

### REQUIREMENTS
- In scope: the 5 sites listed in CAST_SITES. `packages/runtime-official/` only.
- Out of scope: other packages, apps/web, behavior changes, new dependencies, refactors.
- Adjacent edits required for typecheck: typing the `AcpConnection.update` param and `request()` result forces exact-shape updates at the `gemini.ts` call sites listed in DESIGN; those edits are casts to named interfaces, not `any`.
- No runtime/behavior change: every replacement must preserve the existing guards and thrown `HarnessError` codes verbatim.

### REPO_MAP (verified on baseline)
- `packages/runtime-official/acp.ts` — `AcpConnection`: NDJSON JSON-RPC transport over `ChildProcess`. Callers: `packages/runtime-official/gemini.ts:88` (constructor `update` callback), `:114,:167,:172,:174,:186,:189` (`request` calls).
- `packages/runtime-official/gemini-headless.ts` — stream-JSON frame loop in `execute()` (~lines 36–95); `usage` consumed at `:95` as `usage?.input_tokens`/`usage?.output_tokens` via `finite()`.
- `packages/runtime-official/gemini.ts` — `GeminiConfigOption` type at `:25`; `advertisedModels(response: { configOptions?: unknown; models?: { availableModels?: unknown } })` at `:27`.
- `finite()` from `./internal.ts` accepts `unknown` (verify at implementation: `rg -n "export function finite" packages/runtime-official/internal.ts`).
- Test coverage: `tests/official-native-boundaries.test.ts` touches this package (verify scope at implementation).

### CAST_SITES (verified on baseline `7ef0710c`)
| # | File:line | Current code |
|---|---|---|
| 1 | `packages/runtime-official/acp.ts:9` | `resolve(value: any): void` in `pending` map |
| 2 | `packages/runtime-official/acp.ts:10` | `update: (method: string, params: any) => void` |
| 3 | `packages/runtime-official/acp.ts:34` | `private accept(message: any): void` |
| 4 | `packages/runtime-official/gemini-headless.ts:44` | `let usage: any;` |
| 5 | `packages/runtime-official/gemini-headless.ts:48` | `const accept = (frame: any) => {` |

### DESIGN — exact code shape

**acp.ts** — add above `class AcpConnection`:
```ts
interface AcpMessage {
  jsonrpc?: string; id?: number; method?: string;
  params?: unknown; result?: unknown;
  error?: { code?: number; message?: unknown };
}
function isAcpMessage(value: unknown): value is AcpMessage {
  return typeof value === 'object' && value !== null;
}
```
- Site 1 → `resolve(value: unknown): void`.
- Site 2 → `update: (method: string, params: unknown) => void`.
- Site 3 → `private accept(message: unknown): void {` then, before the `message.jsonrpc` check, insert `if (!isAcpMessage(message)) throw new Error('Invalid ACP message.');` (preserve the existing `!message || message.jsonrpc !== '2.0'` check order by folding: `if (!isAcpMessage(message) || message.jsonrpc !== '2.0') throw new Error('Invalid ACP message.');`). Guard the pending lookup with `typeof message.id === 'number'` (already implied by `pending.get`; make it explicit so `id` narrows to `number`).
- Also change `request(method, params, timeout): Promise<any>` → `request<T = unknown>(method: string, params: unknown, timeout = 30_000): Promise<T>` — the map's `resolve(value: unknown)` accepts the promise resolver by method-bivariance; `pending.resolve(message.result)` needs no cast since `resolve` takes `unknown`. (The literal `Promise<any>` is not a gate hit, but it is the same explicit-`any` this issue removes; the generic keeps every call site precise with no `as`.)

**gemini.ts** — required by the two signature changes above (no `any` added):
- Callback at `:88`: parameter `params` is now `unknown`. First statement inside the callback becomes
  ```ts
  const p = params as { sessionId?: unknown; update?: { sessionUpdate?: unknown; availableCommands?: { name?: unknown }[]; content?: { type?: unknown; text?: unknown }; used?: unknown; size?: unknown } };
  ```
  then replace `params.sessionId`→`p.sessionId`, `const update = params.update`→`const update = p.update`; all downstream `update.*` accesses already narrow on `unknown`/optional fields (`typeof update.sessionUpdate !== 'string'`, `update.content?.type === 'text'`, `finite(update.used)`).
- `:114` → `rpc.request<AcpPromptResult>('session/prompt', …)`; add `interface AcpPromptResult { stopReason?: string; usage?: { inputTokens?: number; outputTokens?: number } }`.
- `:167` → `rpc.request<AcpInitializeResult>('initialize', …)`; add `interface AcpInitializeResult { protocolVersion?: number; agentCapabilities?: { mcpCapabilities?: { http?: boolean }; loadSession?: boolean }; authMethods?: { id?: unknown }[] }`.
- `:172` → `rpc.request<unknown>('authenticate', …)`.
- `:174` → `rpc.request<AcpSessionResult>(sessionId ? 'session/load' : 'session/new', …)`; add `interface AcpSessionResult { sessionId?: string; configOptions?: unknown; models?: { availableModels?: unknown } }` (matches `advertisedModels` parameter shape).
- `:186` → `rpc.request<AcpSetConfigResult>('session/set_config_option', …)`; add `interface AcpSetConfigResult { configOptions?: GeminiConfigOption[] }`; then drop the cast at `:187` → `selected.configOptions?.find(option => option.id === advertised.configId)`.
- `:189` → `rpc.request<unknown>('session/set_model', …)`.

**gemini-headless.ts** — add before `execute` (or top of file, near imports):
```ts
interface GeminiStreamFrame {
  type?: string; session_id?: string; model?: string;
  role?: string; content?: unknown; tool_name?: unknown;
  status?: string; stats?: { input_tokens?: number; output_tokens?: number };
}
```
- Site 4 → `let usage: { input_tokens?: number; output_tokens?: number } | undefined;` (`usage = frame.stats` then assigns cleanly; `usage?.input_tokens`/`output_tokens` at `:95` unchanged).
- Site 5 → `const accept = (frame: GeminiStreamFrame) => {` and change the call to `accept(JSON.parse(line) as GeminiStreamFrame)`. Two downstream guards adjust so narrowing still holds with identical semantics:
  - `if (frame.type === 'tool_use')`: `allowed.has(frame.tool_name)` → `typeof frame.tool_name !== 'string' || !allowed.has(frame.tool_name)` (undefined/other non-strings were never in `allowed`; identical outcome).
  - `if (frame.type === 'result')`: `!['success','error'].includes(frame.status)` → `frame.status !== 'success' && frame.status !== 'error'` (narrows `status` for the `status = frame.status` assignment; identical outcome).
- `frame.session_id`, `frame.model`, `frame.role`, `frame.content` comparisons and `typeof` guards are already compatible with the optional-field shape; no other edits.

**Control/data flow:** unchanged. `accept`/`request` signatures only narrow; thrown errors, ordering, timeouts, byte caps and retry paths are untouched. No migration, no schema change.

### EXECUTION_DAG
- T01 (no deps): Apply the acp.ts edits (sites 1–3 + generic `request<T>`). Done when `rg` shows 0 hits in acp.ts and the file compiles standalone.
- T02 (deps T01): Apply the gemini.ts call-site edits (param cast + six `request<T>` type args + drop the `:187` cast). Done when `pnpm typecheck` has no new errors in gemini.ts.
- T03 (no deps, parallel with T01/T02): Apply the gemini-headless.ts edits (interface + sites 4–5 + two guard rewrites + parse cast). Done when `rg` shows 0 hits in gemini-headless.ts.
- T04 (deps T01–T03): Run `rg -n "as any|: any\b" packages/runtime-official` → expect 0 hits; `pnpm typecheck` → PASS; `pnpm lint` → PASS; `pnpm exec vitest run tests/official-native-boundaries.test.ts --maxWorkers=1` → PASS (or record env-gated failure with baseline comparison). Done when all four pass and no `any` remains.
- T05 (deps T04): Branch `fix/runtime-official-any-casts` from current main, one commit, PR to `main` with `Closes #1104`, post PR-checkpoint comment on this issue. Handoff recipient: maintainer.

### VALIDATION
- Negative test: `rg -n "as any|: any\b" packages/runtime-official` returns nothing.
- Positive: `pnpm typecheck`, `pnpm lint` pass; focused vitest listed in T04 passes or shows only pre-existing env-gated failures (compare against the same test on unmodified `main`).
- Behavior preservation evidence: `git diff` contains only type annotations, the `isAcpMessage`/`typeof`/`!==`-style guard rewrites listed above, and the `as GeminiStreamFrame`/`as {…}` parse/params casts — no logic reordering, no changed string literals or error codes.
- Acceptance matrix = Done-when bullets from the issue + diff-review checklist in the PR.

### STATE
Researched + decided (this plan); implementation NOT_STARTED. Risks: (a) `resolve(value: unknown)` bivariance assumption — fallback if `strictFunctionTypes` rejects it: keep `resolve` as `(value: never) => void` is NOT allowed; instead type the map as `Map<number, { resolve(value: unknown): void; … }>` and store `resolve` wrapped: `this.pending.set(id, { resolve: (v: unknown) => resolve(v as T), reject, timer })` — pick whichever compiles; both are semantically identical. (b) `frame.status` narrowing — use the `!==` rewrite exactly as specified. Next step: T01.

### REFERENCES
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1104
- Baseline `7ef0710c`; verified hit list from `rg -n "as any|: any\b" packages/runtime-official` (5 hits, reproduced above).
- Parallel already-merged example of this same pattern: widgets `any` removal (PR #1043).

