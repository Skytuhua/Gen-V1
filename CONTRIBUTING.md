# Contributing to Gen V1

Last updated: 2026-11-01.

Start with [getting started](docs/getting-started.md) and the [architecture guide](docs/architecture.md). Gen V1 is a Windows x64 beta. Repository access does not change the terms in [LICENSE](LICENSE); third-party notices continue to apply.

## Propose a focused change

For a bug, include the application version, Windows/Node/Python versions, a minimal reproduction and expected behavior. Use synthetic or redacted examples. For a substantial feature, explain the user problem and proposed scope in an issue before adding a new subsystem.

Keep changes small and preserve unrelated work. Prefer existing components, contracts and coordinators. Changes involving cancellation, account selection, drafts, approvals or recovery need explicit ownership/error-path coverage.

Do not publish credentials, raw profiles, personal conversations or unredacted traces. Follow [SECURITY.md](SECURITY.md) for sensitive findings.

## Local checks

```powershell
pnpm exec playwright install chromium
pnpm typecheck
pnpm build
pnpm test --maxWorkers=1
```

The full suite includes browser checks against the built interface, so build it before running the tests.

For a focused unit run after the widget assets have been built:

```powershell
pnpm build:widgets
pnpm exec vitest run tests/composer-prediction.test.ts --maxWorkers=1
```

Browser tests use Playwright Chromium:

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

Use the matching scoped Playwright configuration for a particular surface. Keep output in an ignored directory and disable tracing/video unless needed for investigation. Freeze edits before final browser verification so hot reload does not invalidate observations.

Original Hermes checks run separately from Vitest:

```powershell
py -3.14 -I -S -B tests/hermes_source_contract.py -v
py -3.14 -I -S -B tests/hermes_source_worker.py -v
py -3.14 -I -S -B tests/hermes_atomic_controls.py -v
```

These require the isolated pinned Python dependencies in the setup guide. Source custody tests must pass before repackaging retained upstream files. Keep upstream changes separate from wrapper/application changes and retain the original notices and provenance.

## Pull requests

Describe the problem, resulting behavior and relevant verification. Include screenshots for visible changes, identifying sample data or scripted behavior. Record skipped checks and remaining acceptance gates. A passing mock, model list or `/health` response is not live authenticated task verification.

Never include generated installers, `node_modules`, credentials, profile databases or raw test output in a source commit. Release binaries belong in release assets, with hashes and verification notes.

Maintainers review correctness, simplicity, accessibility, ownership and recovery behavior. No response-time or merge guarantee is implied.
