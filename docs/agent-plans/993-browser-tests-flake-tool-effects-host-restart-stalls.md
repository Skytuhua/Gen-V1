# Browser tests flake: tool-effects-host restart stalls in HostFixture.close() — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/993
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Browser tests flake: tool-effects-host restart stalls in HostFixture.close(). Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
## Requested outcome
Main CI **Browser tests** stops failing on root-suite `tests/e2e/tool-effects-host.spec.ts:12` ("approved file replacement exposes its durable ledger receipt through the actual host").

## Evidence
- Fails in 8 of the 11 red main runs among the last 38 completed main CI runs (Nov 18–19), e.g. [44613472925](https://github.com/skytuhua-org/Gen-V1/actions/runs/44613472925), [44598154959](https://github.com/skytuhua-org/Gen-V1/actions/runs/44598154959), [44587001582](https://github.com/skytuhua-org/Gen-V1/actions/runs/44587001582), [44560112666](https://github.com/skytuhua-org/Gen-V1/actions/runs/44560112666).
- Signature: `Test timeout of 60000ms exceeded` → `Tearing down "host" exceeded the test timeout` → `page.goto: Target page, context or browser has been closed` at `tests/host-fixture.ts:221` (openHost, spec line 72).
- Trace (run 44613472925): `about:blank` done at 7.1s, then the test is stuck in `host.restart()` → `HostFixture.close()` until teardown; `host-observations.json` shows only one runtime generation (restarted host never reached `start()`). Which close step hangs (host.close / widgets.close / service.dispose) is not yet known.
- Not #702: no shell-micro-motion/shared-smoothness spec failed in these runs.

## Scope
1. Diagnostics: record close-step timings (PR #950, test-only).
2. Once a Windows failure names the step: fix in tests if fixture-caused; if `host.close` hangs on open sockets in product server shutdown, route to Gen Runtime via Chief of Staff instead.

## Completion criteria
- The hanging close step is identified from a Windows CI artifact/log.
- Root cause fixed (or product bug handed off), and tool-effects-host passes on main across subsequent runs.

## REPO_MAP
Verified at baseline unless marked discovery:
- `tests/host-fixture.ts` — HostFixture.close() where teardown stalls (line ~221 openHost)
- `tests/e2e/tool-effects-host.spec.ts` — root-suite spec failing at line 12
- `docs/reports/flaky-tests-2026-11-19.md` — prior investigation predicting the close stall

## DESIGN
Fix HostFixture.close() so a stalled host shutdown cannot eat the test timeout: bound each close stage, then force-close. Harness only.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Instrument/locate which close stage (host.close vs socket drain) exceeds the timeout; reproduce per the trace | NONE | stall stage identified with evidence |
| T02 | Bound the offending stage and force-release; verify spec teardown completes | T01 | 8-of-11 failure signature gone in repeated local runs |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #993; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #993: https://github.com/skytuhua-org/Gen-V1/issues/993
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
