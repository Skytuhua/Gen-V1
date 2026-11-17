# M16 Consented browser and desktop actions — handoff

## Custody

- Worktree: `C:/Users/Administrator/repos/Gen-V1-m16-v6` (independent clone, not a worktree of the fork checkout).
- Remote: `https://git-manager.devin.ai/proxy/github.com/skytuhua-org/Gen-V1` (resolves to skytuhua-org/Gen-V1).
- Branch: `agent/m16-v6`, cut at `origin/main` `f20b92c636f9ba749a2a2ac027a9e1f053574198`.
- Audit anchor: `4805af4680094d2af48ecf666688e750797e9dda` (source-inspection anchor only; not a claim of test success).
- No reset, clean, stash or ref updates performed; no account changes.

## R01 verbatim records (recorded on the candidate before this follow-up commit)

```text
$ git rev-parse --show-toplevel
C:/Users/Administrator/repos/Gen-V1-m16-v6
$ git remote -v
origin	https://git-manager.devin.ai/proxy/github.com/skytuhua-org/Gen-V1 (fetch)
origin	https://git-manager.devin.ai/proxy/github.com/skytuhua-org/Gen-V1 (push)
$ git branch --show-current
agent/m16-v6
$ git worktree list --porcelain
worktree C:/Users/Administrator/repos/Gen-V1-m16-v6
HEAD 4fc0196e4a0087c7a50467c2c9ef3068547be9f4
branch refs/heads/agent/m16-v6
$ git status --porcelain
 M apps/web/src/ControlConsentPanel.tsx
 M packages/contracts/interactive-control.ts
 M packages/core/browser-consent.ts
 M packages/core/desktop-control.ts
 M packages/core/service.ts
 M tests/browser-consent-v3.test.ts
 M tests/desktop-control-v3.test.ts
 M tests/interactive-control-decisions-v6.test.ts
 ?? docs/implementation/v6/M16/ updated evidence files (this commit)
```

Preflight, before the first landing, HEAD was `f20b92c636f9ba749a2a2ac027a9e1f053574198` and `git status --porcelain` was empty; the same remote/branch/worktree values applied.

## Scope completed

- C1 contracts + pure deny tests: `packages/contracts/interactive-control.ts` (grant/action/capture/driver-registration/surface schemas, the D06/S06 constants and the D05/S07 `classifyControlAction` pure function), `packages/core/browser-consent.ts` (driver registry, consent lifecycle, grant/revoke with target-kind/mode consistency, live-record target revalidation, per-action authorization, host `stop`, surface model), `packages/core/desktop-control.ts` (serialized dispatcher: 200 ms min spacing, queue cap 16, 2 s observation freshness, generation-bound Stop, effect classification and consent allowlist at the input boundary).
- C2 disabled capability presentation: `apps/web/src/ControlConsentPanel.tsx` + `GET /api/threads/:id/control` + `control.request` and `control.stop` commands; the unavailable screen states no live control is active, separates Observe/Interact, names expiry and keeps Stop visible — and the active-state Stop is bound to `control.stop` through the real command path.
- G02 flags: `control.consentedBrowserV1`, `control.selectedDesktopV1` in `capability-flags.ts`, default false, host-test injection only.
- Store gained a read-only `inTransaction` accessor so host writes fold into the open command transaction (Store forbids nested commits).

## Holds (recorded reasons, not status)

- HOLD_DRIVER_SPECIFICATION: no approved driver registration exists; D02 blocks selection. C3/C4 live stages are BLOCKED and all live capture/input cases are NOT_RUN.
- HOLD_PLATFORM_PROOF: real Windows multi-monitor/focus/minimized/permission-loss acceptance (D06) must run against the installed approved driver before any live approval.
- `pnpm test` 57 failed / 4338 passed and `pnpm test:browser` environment-bound failures (missing Chrome distribution, fixture timeouts) — identical in character to the M15-recorded baseline; no M16-scope test failed.

## Tested

- `pnpm exec vitest run tests/browser-consent-v3.test.ts` — 13/0.
- `pnpm exec vitest run tests/desktop-control-v3.test.ts` — 10/0.
- `pnpm exec vitest run tests/interactive-control-decisions-v6.test.ts` — 8/0.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — exit 0.
- `pnpm test` — 57 failed / 4338 passed, all environment-bound, none in M16 scope.
- `pnpm test:browser` — 313 failed + 14 timed out / 1433 passed / 5 skipped across 78 suites, all environment-bound (missing Chrome distribution, fixture hosts, native brokers); no M16-scope spec exists in the suite. See bounded log.

## Not tested / not run

- All live capture/input paths (S08, T04, T05, U03 live closeout, D06 real-platform matrix): NOT_RUN, phase BLOCKED. This is not completed desktop control.
- Production flags remain false; reviewerApproval remains false; publication LOCAL_ONLY.
