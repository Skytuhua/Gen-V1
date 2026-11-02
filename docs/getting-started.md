# Getting started

Last updated: 2026-11-01.

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
git clone https://github.com/Skytuhua/Gen-V1.git
cd Gen-V1
pnpm install --frozen-lockfile
py -3.14 -m pip install --no-cache-dir --no-compile --target .harness-hermes-python-deps -r third-party/hermes-agent/runtime-requirements.txt
```

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

1. Open **Settings → Providers**.
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

Optional host settings are `HARNESS_PORT` and `HARNESS_WIDGET_PORT`. Desktop development uses `HARNESS_DESKTOP_PORT` and `HARNESS_DESKTOP_WIDGET_PORT`. Keep the two ports distinct. Vite's proxy expects the default backend port unless you deliberately update its configuration.

## Build a Windows installer

```powershell
pnpm desktop:package
```

Packaging verifies the pinned source/dependency manifests, stages the selected Python runtime and creates an unsigned per-user Windows x64 installer under `dist/desktop-release-<version>/`. It preserves existing release directories. To use a fresh output root:

```powershell
pnpm desktop:package --output-root .harness-release-output
```

Check [the Gen V1 beta release](https://github.com/Skytuhua/Gen-V1/releases/tag/v0.6.1) for available assets and verification notes. Source builds do not imply that an installer upgrade or every provider account has been tested.

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
