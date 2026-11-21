# UI acceptance repair evidence

PR #896 restores the saved layouts available before the split-workspace shell upgrade and repairs two secondary-surface regressions. These are synthetic browser fixtures, not live accounts, projects or conversations. The six PNGs total less than 350 KiB. No profiles, traces, account identifiers, credentials or machine paths are included.

The earlier ignored UI-completion evidence directory and acceptance-plan progress ledger were not present on the verification machine. Their original ledger and captures could not be recovered. This folder is a newly generated, deliberately small replacement, not a claim to reproduce the missing historical run. It lives under `docs/review-evidence` because `docs/evidence` is ignored by the repository.

## Captures

| Capture | Caption and source |
| --- | --- |
| [Saved layouts, dark](saved-layouts-dark.png) | Restored chooser with synthetic saved arrangements and recovery rows; `saved-layout-chooser.spec.ts`. |
| [Saved layouts, light](saved-layouts-light.png) | The same restored chooser in the light theme; `saved-layout-chooser.spec.ts`. |
| [Inbox, narrow](inbox-dark-narrow.png) | Synthetic Inbox at 320 px, with its Completed filter open; `inbox-controls.spec.ts`. |
| [Floating model picker](floating-model-picker.png) | `/model` opens the model chooser from a compact floating conversation without the full toolbar; `chat-view-modes.spec.ts`. |
| [Docked model picker](docked-model-picker.png) | The same command opens the model chooser in a compact docked conversation; `chat-view-modes.spec.ts`. |
| [Detached Files and Diff](detached-files-and-diff.png) | The initial Files tab remains selectable after adding Diff to an empty saved tab list; `desktop-surfaces.spec.ts`. |

## Reproduction

With repository dependencies and the browser installed, from the repository root:

```sh
node --import tsx scripts/test-browser.ts --suite saved-layout-chooser
node --import tsx scripts/test-browser.ts --suite inbox-controls
node --import tsx scripts/test-browser.ts --suite chat-view-modes
node --import tsx scripts/test-browser.ts --suite desktop-surfaces
pnpm test:e2e
pnpm lint
pnpm typecheck
pnpm test:ui-guard
pnpm exec vitest run tests/public-source.test.ts --maxWorkers=1
```

The detached-workspace regression is covered by the `desktop-surfaces` test that initializes an empty saved tab list, opens detached Files, adds Diff, then selects Files again. Compact model-picker tests cover both floating and docked `/model` commands, token removal, Escape dismissal and focus return.

Full-suite verification results and remaining environment/baseline failures are recorded in the accompanying [verification ledger](verification.md). Browser fixtures are not native Edge evidence or owner visual sign-off.
