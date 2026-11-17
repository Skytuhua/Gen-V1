# M16 Consented browser and desktop actions — handoff

## Custody

- Worktree: `C:/Users/Administrator/repos/Gen-V1-m16-v6` (independent clone, not a worktree of the fork checkout).
- Remote: `https://git-manager.devin.ai/proxy/github.com/skytuhua-org/Gen-V1` (resolves to skytuhua-org/Gen-V1).
- Branch: `agent/m16-v6`, cut at `origin/main` `f20b92c636f9ba749a2a2ac027a9e1f053574198`.
- Audit anchor: `4805af4680094d2af48ecf666688e750797e9dda` (source-inspection anchor only; not a claim of test success).
- No reset, clean, stash or ref updates performed; no account changes.

## Scope completed

- C1 contracts + pure deny tests: `packages/contracts/interactive-control.ts` (grant/action/capture/driver-registration/surface schemas and the D06/S06 constants), `packages/core/browser-consent.ts` (driver registry, consent lifecycle, grant/revoke, target revalidation, per-action authorization, surface model), `packages/core/desktop-control.ts` (serialized dispatcher: 200 ms min spacing, queue cap 16, 2 s observation freshness, generation-bound Stop).
- C2 disabled capability presentation: `apps/web/src/ControlConsentPanel.tsx` + `GET /api/threads/:id/control` + `control.request` command; the unavailable screen states no live control is active, separates Observe/Interact, names expiry and keeps Stop visible.
- G02 flags: `control.consentedBrowserV1`, `control.selectedDesktopV1` in `capability-flags.ts`, default false, host-test injection only.
- Store gained a read-only `inTransaction` accessor so host writes fold into the open command transaction (Store forbids nested commits).

## Holds (recorded reasons, not status)

- HOLD_DRIVER_SPECIFICATION: no approved driver registration exists; D02 blocks selection. C3/C4 live stages are BLOCKED and all live capture/input cases are NOT_RUN.
- HOLD_PLATFORM_PROOF: real Windows multi-monitor/focus/minimized/permission-loss acceptance (D06) must run against the installed approved driver before any live approval.
- `pnpm test` 65 failed / 4325 passed and `pnpm test:browser` environment-bound failures (missing Chrome distribution, fixture timeouts) — identical in character to the M15-recorded baseline; no M16-scope test failed.

## Tested

- `pnpm exec vitest run tests/browser-consent-v3.test.ts` — 11/0.
- `pnpm exec vitest run tests/desktop-control-v3.test.ts` — 8/0.
- `pnpm exec vitest run tests/interactive-control-decisions-v6.test.ts` — 7/0.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — exit 0.
- `pnpm test`, `pnpm test:browser` — executed to completion; failures environment-bound, none in M16 scope.

## Not tested / not run

- All live capture/input paths (S08, T04, T05, U03 live closeout, D06 real-platform matrix): NOT_RUN, phase BLOCKED. This is not completed desktop control.
- Production flags remain false; reviewerApproval remains false; publication LOCAL_ONLY.
