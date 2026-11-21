# Getting started

Last updated: 2026-11-15.

Gen V1 runs a local backend and a Windows desktop or browser interface. Model requests go to the provider you connect; local application storage is not a hosted service.

## Requirements

| Requirement | Development target |
| --- | --- |
| Operating system | Windows x64; native packaging and verification target this platform |
| Node.js | 24.10.0 or newer |
| pnpm | 10.30.3, as pinned by `packageManager` |
| Python | CPython 3.14 with pip; Windows packaging requires x64 |
| Provider | Your own supported subscription, native account or dedicated plan key |

The packaged desktop build includes Node, Python and native runtime assets. Source development requires the tools above separately. Linux and macOS are not accepted desktop targets for this release.

## Install development dependencies

From PowerShell:

```powershell
git clone https://github.com/skytuhua-org/Gen-V1.git
cd Gen-V1
pnpm install --frozen-lockfile
pnpm build:credential-lease
py -3.14 -m pip install --no-cache-dir --no-compile --target .harness-hermes-python-deps -r third-party/hermes-agent/runtime-requirements.txt
```

The Windows credential lease helper requires Visual Studio C++ Build Tools (x64). Build it before starting the desktop or browser from source when using protected credentials. The packaged desktop build includes the helper.

Python dependencies are installed into the repository's ignored, isolated target. The worker starts with `-I -S -B` and adds the admitted source/dependency paths explicitly. See [the Hermes runtime notes](../third-party/hermes-agent/README.md) for the dependency lock and packaging requirements.

If you use an installed Python executable without the Windows `py` launcher, set its absolute path before starting or packaging:

```powershell
$env:HARNESS_HERMES_PYTHON = 'C:\Path\To\Python314\python.exe'
```

## Start the application

For the native desktop:

```powershell
pnpm desktop:dev
```

For browser development:

```powershell
pnpm dev
```

Open `http://127.0.0.1:5173`. This starts Vite, the backend on `127.0.0.1:4317` and the generated-app receiver on `localhost:4318`.

To serve a built browser interface:

```powershell
pnpm build
pnpm start
```

Open `http://127.0.0.1:4317`. The host binds to loopback; remote/multi-user hosting is not an accepted deployment mode.

## Connect a provider

1. Open **Settings → Models & Accounts**.
2. Add a local account label, then choose **Connect** for that account.
3. Complete the provider's native browser or console flow.
4. Check connection readiness, refresh models and choose an available model.

| Connection | Sign-in mechanism |
| --- | --- |
| ChatGPT / Codex | Pi subscription OAuth; `openai` is the current route and `openai-codex` remains a legacy route |
| GitHub Copilot / xAI | Pi browser/device-code OAuth |
| Claude | Official Claude Code native sign-in |
| Gemini | Official Gemini CLI Google-account sign-in |
| Cursor | Official Cursor SDK browser sign-in; preview integration |
| Kimi Code / OpenCode Go | A dedicated membership/workspace key entered privately in the console |

On desktop, the app opens the sign-in console. Browser users run the command shown in Settings from this checkout. For example, the legacy/default Claude profile uses:

```powershell
pnpm agent:login --provider claude-code
```

For a named account, use the exact saved ID displayed by the app:

```powershell
pnpm agent:login --provider claude-code --account-id SAVED_ID
```

Do not pass secrets as command arguments. A local account label is not authenticated identity. Readiness may mean only that a credential is configured; access, entitlement and model availability still come from the provider.

Each saved account has a separate app profile. Gen V1 does not automatically adopt an existing external CLI login. Changing the default affects new tasks; existing tasks retain their account. Bound Claude profiles currently require a new local account for reconnect because staged reconnect is unsupported. Pi/Gemini identity and Claude immutable-subject information are unavailable through the installed APIs.

Only OpenAI has genuine live acceptance recorded for the preceding milestone. [The connection reference](subscription-connections.md) contains provider-specific constraints and earlier evidence; [the acceptance report](2026-11-01-product-completion.md) separates live and scripted checks.

## Data and profiles

The default backend directory remains `%LOCALAPPDATA%\GenerativeHarness`. The desktop's separate window/session profile remains `%APPDATA%\GenerativeHarnessDesktop`. These legacy names preserve existing installations after the Gen V1 rename.

For an isolated development profile, set the same directory before both sign-in and startup:

```powershell
$env:HARNESS_DATA_DIR = Join-Path $env:LOCALAPPDATA 'GenV1-Development'
pnpm agent:login --provider openai
pnpm desktop:dev
```

The directory contains credentials, conversations, attachments, skill files, state and receipts. Keep it out of Git and take backups with the application fully closed. Do not delete profile guards or copy credentials between account folders to clear a blocked connection.

Optional host settings are `HARNESS_PORT` and `HARNESS_WIDGET_PORT`. Desktop development uses `HARNESS_DESKTOP_PORT` and `HARNESS_DESKTOP_WIDGET_PORT`. Keep the two ports distinct. Vite's development proxy uses the same `HARNESS_PORT` as the backend. Set it before starting `pnpm dev`.

### Host capability activation

The finite capability registry defaults to false. A trusted operator can enable a selected capability before starting the host through `HARNESS_FLAG_<KEY>`, replacing punctuation and camel-case boundaries with underscores and using uppercase. Only the exact values `1` and `true` enable a flag. The host captures this configuration before constructing its runtime and Service; changes require a host restart. UI preferences, agent tools and plugins cannot set these flags.

For an enabled project-memory review build:

```powershell
$env:HARNESS_FLAG_MEMORY_PROJECT_V1 = '1'
$env:HARNESS_FLAG_UI_SOURCE_WORKBENCH_V1 = '1'
$env:HARNESS_FLAG_CONTEXT_COMPILER_V1 = '1'
pnpm desktop:dev
```

Project memory still requires explicit project opt-in and selected source conversations. The source-workbench flag allows explicit captured FILE sources; it does not scan the project. External recall, precompute, deferred tools and loss-aware compaction each retain their separate flags and proof requirements. Embedders can supply a finite `capabilityFlags` map to `launchHost`; unknown keys reject, and concurrent hosts in one process must use the same configuration.

## Build a Windows installer

The desktop packager also requires the ignored runtime inputs; a Node dependency
install alone does not supply them. Prepare `.harness-hermes-python-deps/` from
the pinned Hermes requirements above, `.harness-integrations-python-deps/` from
[the integration lock](../third-party/integrations/PYTHON_LOCK.json), and
`.harness-tool-bundles/{git,gh}/` to match
[the tool archive and file manifest](../third-party/git-tools/manifest.json).
The integration lock records each distribution's wheel URL/hash and the exact
installed file inventory. Tool archives must match their recorded release hashes
before extraction. A reviewed offline runtime payload can supply these same
inputs. Packaging verifies them and refuses a mismatch; do not regenerate the
locks to admit a different local installation. None of these inputs requires a
private plug-in checkout, profile, account or credential.

### Exact v1 mode

When `HARNESS_INTEGRATION_WHEELS` is absent, packaging retains the original exact
v1 comparison. Every admitted installed file, including each `RECORD`, must match
the original inventory and hash. A regression-test dependency cache is not
automatically an exact packaging payload: direct wheel installations can add
`REQUESTED`/`direct_url.json` metadata, and pip's Windows launcher metadata can
change installed `RECORD` bytes.

```powershell
pnpm desktop:package
```

Packaging verifies the pinned source/dependency manifests, stages the selected Python runtime and creates an unsigned per-user Windows x64 installer under `dist/desktop-release-<version>/`. It preserves existing release directories. To use a fresh output root:

```powershell
pnpm desktop:package --output-root .harness-release-output
```

### Explicit canonical RECORD mode

Set `HARNESS_INTEGRATION_WHEELS` to an **absolute directory containing the 91
already-declared wheel archives** to select `wheel-canonical-record-v2` at build
time. Use the archive filenames from the lock's `sourceUrl` entries and verify
every `wheelSha256`. The **Stage pinned integration wheels for canonical
packaging** step in [Windows CI](../.github/workflows/ci.yml) downloads exactly
those URLs into a new temporary directory, rejects duplicate filenames, verifies
the archive hashes and passes that directory to the package step. It does not
select new versions or replace the lock. The installed dependency directory is
still required.

For a locally staged archive directory:

```powershell
$env:HARNESS_INTEGRATION_WHEELS = (Resolve-Path -LiteralPath 'C:\BuildInputs\integration-wheels').Path
pnpm desktop:package --output-root .harness-canonical-release-output
```

The packager uses the same validated CPython 3.14 Windows x64 installation selected
for Hermes, including `HARNESS_HERMES_PYTHON` when supplied. Its standard-library
projection helper runs with `-I -S -B`, reads the pinned archives without executing
wheel code, and authenticates each file's distribution ownership. The original
`PYTHON_LOCK.json` remains unchanged. All **7,324 non-RECORD file hashes** remain
mandatory; only the 91 installed RECORD files receive deterministic replacements.
Additional `REQUESTED` and `direct_url.json` files under known distribution
metadata directories are excluded from the package. A changed or undeclared
runtime file still fails preflight. The helper does not rewrite the installed
dependency cache.

The staged and packaged host contains the original lock plus
`third-party/integrations/PYTHON_INSTALLATION_V2.json`. This generated manifest
records mode/version, the original lock digest, authenticated wheel identities
and the exact relative file inventory with sizes and hashes. The release
`build-manifest.json` records the selected mode and generated manifest digest.
CI preserves the staged v2 manifest alongside its build and installed-verifier
receipts when those files exist, including after a later packaging failure.
Unset `HARNESS_INTEGRATION_WHEELS` to return to the unchanged exact v1 mode.

These are build instructions. They do not establish a successful Windows package,
installation or retained-memory verification; those results require their own
executed receipts.

Check [the Gen V1 beta release](https://github.com/skytuhua-org/Gen-V1/releases/tag/v0.6.1) for available assets and verification notes. Source builds do not imply that an installer upgrade or every provider account has been tested.

## Run the checks

The full regression suite needs local runtime inputs beyond `pnpm install`.
Install the isolated Hermes requirements above, then prepare
`.harness-integrations-python-deps/` using the **Install pinned Python test
dependencies** step in [the CI toolchain action](../.github/actions/setup/action.yml).
That step installs the exact wheels from the integration lock and checks their
hashes. Run it from the repository root using your Python 3.14 executable.
When adapting the CI step locally, use a writable temporary directory in place
of the runner-only `$env:RUNNER_TEMP`.

```powershell
pnpm exec playwright install chromium
pnpm typecheck
pnpm test --maxWorkers=1
pnpm test:e2e
```

Playwright's Chromium install covers the suites that use its bundled browser.
The full browser suite also needs Google Chrome and Microsoft Edge installed
for the configurations that explicitly select those channels. The Chromium
download does not install those branded browsers.

The browser command builds the application and runs each spec with its assigned
fixture server. The Memory fixture, actual-app and journal modes run separately.
Results are retained in a new `test-results/browser/run-*` directory for each
invocation. A failed suite stops the command with a nonzero exit status.

To inspect the selected tests without starting a browser, or to rerun one suite:

```powershell
pnpm exec tsx scripts/test-browser.ts --list
pnpm test:e2e --suite terminal-read
```

The selected configurations retain their browser channels, viewports and
deadlines. Install the browser required by each configuration before running it.
The suite list in `scripts/browser-suites.ts` is checked against every spec file;
adding a spec requires assigning its fixture configuration there.

### Agents grid UI evidence

The populated-grid evidence spec
`tests/e2e/agents-workspace-evidence.spec.ts` runs inside the `agents-workspace`
browser suite on Microsoft Edge. It writes metrics JSON and screenshots to the
directory named by `AGENTSUI_EVIDENCE_DIR` (default
`test-results/agents-workspace-evidence`), labelled by
`AGENTSUI_EVIDENCE_LABEL` (default `after`). Capture it manually with:

```powershell
$env:AGENTSUI_EVIDENCE_DIR = 'test-results/evidence'
$env:AGENTSUI_EVIDENCE_LABEL = 'after'
pnpm exec playwright test --config tests/e2e/agents-workspace.playwright.config.ts tests/e2e/agents-workspace-evidence.spec.ts --reporter=list
```

For a before/after comparison, run it once per checkout with matching
`AGENTSUI_EVIDENCE_LABEL` values and compare the emitted files. The spec uses
synthetic API fixtures only.

## Common startup issues

| Symptom | What to check |
| --- | --- |
| Isolated Hermes dependencies are missing | Run the pinned Python `--target` installation above from the repository root. |
| Python cannot start | Confirm CPython 3.14 is installed, or set `HARNESS_HERMES_PYTHON` to its executable. |
| Profile or port is already owned | Close the instance that owns it, or choose a different development profile and ports. |
| No models appear | Complete sign-in in the same profile, check readiness and explicitly refresh models. |
| A task is interrupted | Inspect the task state and use **Resume**. Saved effects and receipts must be reviewed before repeating work. |
| Connection cleanup is unconfirmed | Keep the blocked state and investigate native shutdown; retrying must not release a live owner. |

For reproducible bugs, follow [CONTRIBUTING.md](../CONTRIBUTING.md). For sensitive findings, follow [SECURITY.md](../SECURITY.md).
