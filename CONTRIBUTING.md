# Contributing to Gen V1

Thanks for helping improve Gen V1. Clear bug reports, documentation fixes and thoughtful feedback are useful contributions, even without a code change.

Gen V1 is a private Windows x64 beta. Coordinate source contributions with the maintainer before starting. Repository access and this guide do not grant additional rights: first-party code remains unlicensed for redistribution under [LICENSE](LICENSE). [Third-party licenses and notices](THIRD_PARTY_NOTICES.md) continue to apply.

## Ways to help

- Report a reproducible bug with a small, redacted example.
- Point out a confusing setup step, broken link or missing explanation.
- Share accessibility or usability feedback, including the task you were trying to complete.
- Confirm whether an existing issue still occurs on a named version, using sample data.
- Suggest a focused improvement and explain the problem it would solve.

Use the matching [issue form](https://github.com/Skytuhua/Gen-V1/issues/new/choose). Search existing issues first; a useful reproduction or clarification can help more than a duplicate report. For sensitive findings, follow [SECURITY.md](SECURITY.md) instead of posting details in an issue.

## Your first contribution

1. Open or join an issue describing the problem. Agree on scope with the maintainer before changing source, especially for a new feature or subsystem.
2. Follow [getting started](docs/getting-started.md) for the supported tools and dependency setup. The [architecture guide](docs/architecture.md) explains how the parts fit together.
3. Create a branch from the current `main`, for example `git switch -c docs/clarify-setup` or `git switch -c fix/composer-focus`.
4. Make one focused change. Keep unrelated edits and generated output out of the pull request.
5. Run the checks relevant to your change below, then open a pull request linking the issue. Explain the problem, resulting behavior and verification.

For a bug, include the application version, Windows/Node/Python versions where relevant, a minimal reproduction and expected behavior. You do not need to diagnose the cause before reporting it.

## Find your way around

| Directory | What lives here |
| --- | --- |
| [apps/web](apps/web) | React interface, task views and settings |
| [apps/desktop](apps/desktop) | Electron windows and desktop lifecycle |
| [apps/server](apps/server) | Local host, HTTP endpoints and application startup |
| [packages](packages) | Core behavior, storage, runtimes and shared UI |
| [tests](tests) | Unit, browser and Python checks |
| [docs](docs) | Setup, architecture and verification notes |
| [third-party](third-party) | Retained upstream source, manifests and licenses |

Keep changes small and preserve unrelated work. Prefer existing components, contracts and coordinators. Changes involving cancellation, account selection, drafts, approvals or recovery need explicit ownership/error-path coverage.

## Local checks

Run commands from the repository root after completing source setup. For documentation-only changes, review wording, links and formatting; application tests are usually unnecessary. For code changes, start with a focused test, then run the relevant broader checks:

```powershell
pnpm exec playwright install chromium
pnpm typecheck
pnpm build
pnpm test --maxWorkers=1
```

Some tests inspect or exercise the built interface, so build it before running the full suite. `pnpm test` builds widget assets automatically.

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

Use the matching scoped Playwright configuration for a particular surface. Keep output in an ignored directory and review traces before sharing them. Freeze edits before final browser verification so hot reload does not invalidate observations.

Original Hermes checks run separately from Vitest:

```powershell
py -3.14 -I -S -B tests/hermes_source_contract.py -v
py -3.14 -I -S -B tests/hermes_source_worker.py -v
py -3.14 -I -S -B tests/hermes_atomic_controls.py -v
```

These require the isolated pinned Python dependencies in the setup guide. Source custody tests must pass before repackaging retained upstream files. Keep upstream changes separate from wrapper/application changes and retain the original notices and provenance.

## Screenshots and shared evidence

Use synthetic or redacted examples. For visible changes, include a screenshot or short recording cropped to the relevant area. Remove credentials, account identifiers, private paths and personal conversations from images and logs. Do not attach application profiles or raw traces.

Add a short caption with the version, what the image demonstrates and whether it uses sample data or scripted behavior. Describe what you actually verified: a passing mock, model list or `/health` response is not live authenticated task verification.

## Pull requests and review

Use the pull request template to describe the problem, resulting behavior and relevant verification. Link the issue and record skipped checks or remaining acceptance gates. A draft PR is welcome when you need feedback on an approach.

Never include generated installers, `node_modules`, credentials, profile databases or raw test output in a source commit. Release binaries belong in release assets, with hashes and verification notes.

Maintainers review correctness, simplicity, accessibility, ownership and recovery behavior. They may ask for a smaller scope, a reproduction or another check. Update the same branch when responding, and explain any feedback you need help with. Review timing varies, and submitting a PR does not guarantee a merge.
