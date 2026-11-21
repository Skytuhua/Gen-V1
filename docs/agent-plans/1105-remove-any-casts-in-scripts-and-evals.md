<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1105 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: remove `any` casts in `scripts/` and `evals/`
- Repo: `skytuhua-org/Gen-V1`; plan revision 1, 2026-11-20
- Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified `git rev-parse HEAD`)
- Issue: #1105. Source provenance: reviewer `devin-a-cloud-51c9e2`, read-only inspection.
- Current status: an implementer (`devin-a-cloud-403c18`) already opened PR #1129 for this scope; **the fixes are not on main yet** — 6 rg hits remain on baseline. This plan is the independent spec the fix must satisfy; if #1129 merges first, verify it against CAST_SITES and close.

### OBJECTIVE
`rg -n "as any|: any\b" scripts evals` → 0 non-test hits, `pnpm typecheck` passes, zero behavior changes.

### REQUIREMENTS
- In scope: the 6 sites in CAST_SITES across `scripts/verify-subscription-accounts.ts`, `evals/runner.ts`, `scripts/integration_python_projection.py`.
- Out of scope: anything outside `scripts/` and `evals/`; behavior changes; new dependencies.
- `scripts/integration_python_projection.py:136` is a **literal-gate false positive**: `any(...)` is Python's builtin, not a type cast. The gate is literal text, so the accepted fix is restructuring (below) — not declaring it exempt.

### REPO_MAP (verified on baseline)
- `evals/runner.ts` — `request()` helper at ~`:47–53` returns `await response.json() as any`; callers apply their own casts at `:56` (`as { models: ModelInfo[]; error?: string }`), `:63`/`:71` (`as Snapshot`). `observeCase` at `:93` uses `operations` typed `Operation[]` from `packages/contracts/index.ts:17` where `result?: unknown`.
- `scripts/verify-subscription-accounts.ts` — `BackendDiagnostic` type at `:123`; `app.evaluate` callbacks at `:32`, `:40`, `:86` read/write `globalThis.__accountBackendDiagnostics`; `:41` uses `(process as any)._getActiveHandles()`.
- `scripts/integration_python_projection.py` — `:136` `"truncated": any(len(rows) > 100 ...)` inside a dict literal.
- Tests: `tests/capabilities.test.ts`, `tests/eval-gates.test.ts` cover this area (focused run per VALIDATION).

### CAST_SITES (verified on baseline `7ef0710c`)
| # | File:line | Current code |
|---|---|---|
| 1 | `evals/runner.ts:27` | `const value = await response.json() as any;` |
| 2 | `evals/runner.ts:80` | `(o.result as any)?.exitCode` … `(o.result as any).exitCode` (two casts on one line) |
| 3 | `scripts/integration_python_projection.py:136` | `"truncated": any(len(rows) > 100 for rows in (added, missing, changed))` |
| 4 | `scripts/verify-subscription-accounts.ts:32` | `(globalThis as any).__accountBackendDiagnostics` |
| 5 | `scripts/verify-subscription-accounts.ts:40` | `(globalThis as any).__accountBackendDiagnostics=diagnostics` |
| 6 | `scripts/verify-subscription-accounts.ts:41` | `(process as any)._getActiveHandles() as any[]` |
| 7 | `scripts/verify-subscription-accounts.ts:86` | `(globalThis as any).__accountBackendDiagnostics` |

### DESIGN — exact code shape

**evals/runner.ts**
- Site 1 → `const value: unknown = await response.json();`. `request()` then returns `Promise<unknown>`; all existing call-site `as` casts (`as { models… }`, `as Snapshot`) continue to compile. Two call sites need added precise casts (both inside this file, allowed):
  - `const bootstrap = await request("/api/bootstrap") as { csrfToken: string };` — `csrf = bootstrap.csrfToken;` unchanged.
  - `const receipt = await command("thread.create", …) as { result?: { id?: string } };` — `receipt.result?.id` unchanged. (`command()` returns `request(...)` ⇒ `Promise<unknown>`; cast at the call site.)
- Site 2 → replace the two casts with one structural type: `o.result as { exitCode?: unknown }` in both positions. Exact line:
  ```ts
  if (id === "actual-test-failure") { pass = operations.some(o => o.kind === "repository.test" && typeof (o.result as { exitCode?: unknown } | null)?.exitCode === "number" && ((o.result as { exitCode?: unknown } | null)?.exitCode ?? 0) !== 0); evidence = `…unchanged…`; }
  ```
  (equivalent form allowed: hoist `const exitCode = (o.result as { exitCode?: unknown } | null | undefined)?.exitCode;` inside `some()`; identical semantics — `Operation.result?: unknown` per contracts `:17`.)

**scripts/integration_python_projection.py**
- Site 3 → hoist above the dict: `truncated = any(len(rows) > 100 for rows in (added, missing, changed))`, then `"truncated": truncated` in the literal. Output byte-identical; `rg` gate goes to 0 because the literal `: any` sequence disappears.

**scripts/verify-subscription-accounts.ts** — add near `BackendDiagnostic` (`:123`):
```ts
interface DiagnosticsGlobal { __accountBackendDiagnostics?: unknown[] }
interface ChildProcessLike {
  pid?: unknown; spawnargs?: unknown;
  stderr?: { on(event: string, listener: (bytes: Buffer) => void): void } | null;
  once(event: string, listener: (code: number | null, signal: string | null) => void): void;
}
```
- Sites 4, 7 → `(globalThis as DiagnosticsGlobal).__accountBackendDiagnostics` (outer `as BackendDiagnostic[]` cast on the `evaluate` result stays — precise, not `any`).
- Site 5 → `(globalThis as DiagnosticsGlobal).__accountBackendDiagnostics = diagnostics;` (`diagnostics` is `unknown[]`; `BackendDiagnostic[]` entries are pushed into it, so the `unknown[]` member type is exact).
- Site 6 → 
  ```ts
  const handles = (process as NodeJS.Process & { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
  for (const child of handles) {
    if (typeof child !== 'object' || child === null) continue;
    const proc = child as ChildProcessLike;
    if (!Number.isSafeInteger(proc.pid) || !Array.isArray(proc.spawnargs) || !proc.spawnargs.some((arg: unknown) => typeof arg === 'string' && arg.replaceAll('\\','/').endsWith('/apps/server/main.ts'))) continue;
    const entry: { pid: number; stderr: string; exitCode?: number | null; signal?: string | null } = { pid: proc.pid as number, stderr: '' };
    diagnostics.push(entry);
    proc.stderr?.on('data', (bytes: Buffer) => { entry.stderr = (entry.stderr + String(bytes)).slice(-24000); });
    proc.once('exit', (code: number | null, signal: string | null) => { entry.exitCode = code; entry.signal = signal; });
  }
  ```
  — identical guard order and side effects to the current loop body.

**Control/data flow:** unchanged. No migrations, no schema changes.

### EXECUTION_DAG
- T01 (no deps): evals/runner.ts — site 1 (`as unknown`), add the `bootstrap` and `receipt` call-site casts, site 2 (exitCode structural casts). Done when `rg` → 0 hits in evals/ and file typechecks.
- T02 (no deps): scripts/verify-subscription-accounts.ts — add `DiagnosticsGlobal`/`ChildProcessLike`, apply sites 4–7 as specified. Done when `rg` → 0 hits in the file and it typechecks.
- T03 (no deps): scripts/integration_python_projection.py — hoist `truncated` variable. Done when `rg -n "as any|: any\b" scripts evals` → 0 hits and `python3 -c "import ast; ast.parse(open('scripts/integration_python_projection.py').read())"` parses.
- T04 (deps T01–T03): `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm exec vitest run tests/capabilities.test.ts tests/eval-gates.test.ts --maxWorkers=1` PASS (or record env-gated failures vs same tests on unmodified main).
- T05 (deps T04): branch `fix/scripts-evals-any-casts`, one commit, PR to `main` with `Closes #1105`, post PR checkpoint. Recipient: maintainer. **Note:** PR #1129 already implements this scope — if it merges first, T01–T05 collapse to verification only.

### VALIDATION
- `rg -n "as any|: any\b" scripts evals` → empty.
- `pnpm typecheck` PASS; `pnpm lint` PASS.
- Focused tests in T04 pass or fail identically on unmodified `main` (env-gated failures documented, not counted).
- Diff review: type annotations, guard/type-narrowing rewrites and the Python hoist only; no changed error strings, ordering or side effects.
- Acceptance = issue Done-when + this diff checklist.

### STATE
Researched + decided; implementation exists as PR #1129 (open) by another worker — verify against CAST_SITES on merge or implement T01–T05 if it stalls. Next step: check PR #1129 diff against this plan; if merged, done-when is already met on main.

### REFERENCES
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1105; PR #1129.
- Baseline `7ef0710c`; hit list reproduced from `rg -n "as any|: any\b" scripts evals`.
- `Operation.result?: unknown` — `packages/contracts/index.ts:17`.

