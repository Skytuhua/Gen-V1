<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1106 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: `.env.example` for local app configuration
- Repo: skytuhua-org/Gen-V1 · Plan rev: 1 (2026-11-20)
- Baseline: `main` @ `7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified `git rev-parse origin/main`)
- Issue: #1106 (open, unclaimed, no PRs) · Source provenance: fresh review by devin-a-cloud-9c41e2
- Current implementation status: not started. `.gitignore` line 17 already contains `!.env.example`, so the file commits cleanly.

### OBJECTIVE
A new contributor cannot tell which environment variables the host, server and desktop apps read. Add one committed `.env.example` that enumerates every `process.env.<NAME>` read under `apps/` with a one-line comment each, so `cp .env.example .env` documents local configuration. Success: file exists on a branch, every `apps/` env read is covered or an omission is justified in the PR.

### REQUIREMENTS
- In scope: single new file `.env.example` at repo root; names + comments only, no values beyond safe defaults/none.
- Out of scope: code changes, `.env` itself, docs edits, test-only fixture vars not needed to run the app (`HARNESS_DESKTOP_TEST_DATA_DIR` is listed but marked optional/test).
- Enumerated below is the verified inventory: every `process.env` read under `apps/` and `packages/` was grep'd; `import.meta.env` has zero reads under `apps/` and `packages/`.

### REPO_MAP (verified on baseline SHA)
- `apps/server/host.ts:46-53` — reads `HARNESS_DATA_DIR`, `HARNESS_PORT` (default 4317), `HARNESS_WIDGET_PORT` (default 4318), `HARNESS_DEV` (`'1'` enables dev mode), `HARNESS_DESKTOP_LAUNCH_TOKEN`, `HARNESS_PLUGIN_DIR`, `LOCALAPPDATA`.
- `apps/server/main.ts:17,53` — `HARNESS_DESKTOP_LAUNCH_TOKEN` (32–128 hex, validated), `HARNESS_DESKTOP_TEST_DATA_DIR` (startup diagnostic line).
- `apps/server/workspace-routes.ts:152` — `SystemRoot` (Windows explorer launcher).
- `apps/server/hermes-service.ts:43` — passes `process.env` into `evaluateExecution` (no named keys).
- `apps/server/code-intelligence-routes.ts:76` — `options.env ?? process.env` (no named keys).
- `apps/desktop/main.ts:35,56-58,65,353` — `HARNESS_DESKTOP_TEST_DATA_DIR`, `HARNESS_DESKTOP_HOST_ROOT`, `HARNESS_DESKTOP_NODE_PATH`, `HARNESS_DATA_DIR`, `HARNESS_DESKTOP_PORT` (default 4317), `HARNESS_DESKTOP_WIDGET_PORT` (default 4318), `HARNESS_PLUGIN_DIR`, `LOCALAPPDATA`; writes `HARNESS_PORT`, `HARNESS_WIDGET_PORT`, `HARNESS_DESKTOP_LAUNCH_TOKEN`, `HARNESS_DEV` for the child; deletes `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`.
- `apps/desktop/auth-launcher.ts:64,70` — `SystemRoot`.
- `packages/runtime-hermes/acp-server.ts:82` — `HARNESS_HERMES_BROKER_URL`, `HARNESS_HERMES_JOB_KEY`, `HARNESS_HERMES_MODEL_ID`.
- `packages/runtime-hermes/client.ts:26` — child env allowlist `['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','COMSPEC','SYSTEMDRIVE','OS','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS','LANG','LC_ALL']`.
- `packages/runtime-login/index.ts:30`, `packages/runtime-pi/login.ts:89` — `HARNESS_DATA_DIR`, `LOCALAPPDATA`.
- `packages/runtime-pi/index.ts:63` — `WORKER_ENV` passthrough list (platform vars incl. proxies `HTTP(S)_PROXY`, `NO_PROXY`, `ALL_PROXY`, `NODE_EXTRA_CA_CERTS`).
- `packages/runtime-official/environment.ts:33` — passthrough `['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','LANG','LC_ALL','TERM']` + sets `HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TMP/TEMP/TMPDIR/XDG_*`, `NO_COLOR`, provider vars (`CLAUDE_CONFIG_DIR`, `GEMINI_CLI_HOME`, …) for child runtimes — child-side, not host config.
- `packages/integrations/index.ts:85,87` — passthrough `['SystemRoot','WINDIR','COMSPEC','TEMP','TMP','PATH']` + sets `HOME/USERPROFILE/APPDATA/LOCALAPPDATA/XDG_CONFIG_HOME/PYTHON_*`, `PROMPTFOO_*`, `GRAPHIFY_*`, `IMPECCABLE_BIN` for the sandboxed child — child-side.
- `packages/integrations/promptfoo-provider.mjs:6` — `HARNESS_PROMPTFOO_BRIDGE_URL`, `HARNESS_PROMPTFOO_BRIDGE_TOKEN`.
- `packages/plugins/installation.ts:16` — `HARNESS_DESKTOP_HOST_ROOT` (Electron dependency manifest).
- `packages/capabilities/process.ts:9,11,16,41` — `HARNESS_BUNDLED_GIT`, `HARNESS_PACKAGED` (`'1'` + missing bundled git → CAPABILITY_DENIED), platform list.
- `packages/core/host-flags.ts:52-59` — `HARNESS_FLAG_<NAME>` channel: only literal `1`/`true` enables. Registry (lines 11-41): `security.projectTrustV1`, `security.secretRefsV1`, `security.executionProfilesV1`, `verification.workflowV1`, `coding.intelligenceV1`, `coding.renameV1`, `coding.debuggerV1` → env names `HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1`, `HARNESS_FLAG_SECURITY_SECRET_REFS_V1`, `HARNESS_FLAG_SECURITY_EXECUTION_PROFILES_V1`, `HARNESS_FLAG_VERIFICATION_WORKFLOW_V1`, `HARNESS_FLAG_CODING_INTELLIGENCE_V1`, `HARNESS_FLAG_CODING_RENAME_V1`, `HARNESS_FLAG_CODING_DEBUGGER_V1`.
- `packages/storage/secret-codec.ts:13`, `packages/core/file-access.ts:46` — `SystemRoot` (PowerShell path).
- `packages/workspace/terminal.ts:25` — `COMSPEC` (Windows) / `SHELL` (POSIX) for interactive terminals.
- `.gitignore:17` — `!.env.example` (explicit allow).

### DESIGN
One new file, repo root: `.env.example`. Grouped into three sections with `#` comments; every line commented out so copying the file never changes behavior. Exact content:

```
# Gen-V1 host (apps/server)
# Data directory for threads, projects, and receipts.
# Default: %LOCALAPPDATA%\GenerativeHarness (Windows) / ~/.GenerativeHarness fallback via homedir().
#HARNESS_DATA_DIR=
# Host HTTP port (default 4317) and widget server port (default 4318).
#HARNESS_PORT=4317
#HARNESS_WIDGET_PORT=4318
# Dev mode for the host; '1' enables.
#HARNESS_DEV=0
# Plugin directory (default %LOCALAPPDATA%\GenV1\plugins).
#HARNESS_PLUGIN_DIR=
# Packaged-install markers. Only set in packaged builds.
#HARNESS_PACKAGED=
#HARNESS_BUNDLED_GIT=

# Gen-V1 desktop (apps/desktop)
# Launch token the desktop app passes to the spawned host; 32-128 hex chars when set.
#HARNESS_DESKTOP_LAUNCH_TOKEN=
# Overrides for the spawned host ports (defaults 4317 / 4318).
#HARNESS_DESKTOP_PORT=4317
#HARNESS_DESKTOP_WIDGET_PORT=4318
# Packaged desktop only: host root and bundled node path.
#HARNESS_DESKTOP_HOST_ROOT=
#HARNESS_DESKTOP_NODE_PATH=
# Test/diagnostic: writes an extra startup line on backend failure (desktop tests).
#HARNESS_DESKTOP_TEST_DATA_DIR=

# Hermes runtime (packages/runtime-hermes)
# Broker the ACP server connects to plus the job key and model id.
#HARNESS_HERMES_BROKER_URL=
#HARNESS_HERMES_JOB_KEY=
#HARNESS_HERMES_MODEL_ID=
#HARNESS_HERMES_PYTHON=

# Promptfoo eval bridge (packages/integrations)
#HARNESS_PROMPTFOO_BRIDGE_URL=
#HARNESS_PROMPTFOO_BRIDGE_TOKEN=

# Host feature flags — only the literal values 1 or true enable a flag.
#HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1=
#HARNESS_FLAG_SECURITY_SECRET_REFS_V1=
#HARNESS_FLAG_SECURITY_EXECUTION_PROFILES_V1=
#HARNESS_FLAG_VERIFICATION_WORKFLOW_V1=
#HARNESS_FLAG_CODING_INTELLIGENCE_V1=
#HARNESS_FLAG_CODING_RENAME_V1=
#HARNESS_FLAG_CODING_DEBUGGER_V1=

# Platform-provided (the OS sets these; listed for completeness, normally left unset).
# Windows: SystemRoot, WINDIR, COMSPEC, PATHEXT, LOCALAPPDATA, APPDATA, USERPROFILE
# POSIX: SHELL, HOME, LANG, LC_ALL, TERM
# Terminal/app passthrough: PATH, TEMP, TMP, TMPDIR
# Worker subprocess passthrough also honors HTTP_PROXY, HTTPS_PROXY, NO_PROXY, ALL_PROXY (and lowercase), NODE_EXTRA_CA_CERTS.
```

Intentional omissions (state in PR): `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS` are deleted by `apps/desktop/main.ts`, not read as config; child-runtime vars set programmatically (`HOME`, `XDG_*`, `CLAUDE_CONFIG_DIR`, `GEMINI_CLI_HOME`, `PYTHON_*`, `PROMPTFOO_*`, `GRAPHIFY_*`, `IMPECCABLE_BIN`) are written by the apps, not read; `HARNESS_DESKTOP_TEST_DATA_DIR` is included above but marked test/diagnostic per the issue's fixture caveat.

### EXECUTION_DAG
- T01 — Branch `devin/<ts>-env-example` from `main@7ef0710`. Deps: none. Done when branch exists locally.
- T02 — Write `.env.example` with the exact content above. Files: new `.env.example`. Done when `git status` shows only `.env.example` untracked.
- T03 — Re-run `rg -o 'process\.env\.[A-Za-z_][A-Za-z0-9_]*' apps -r '$1' | sort -u` and `rg 'process\.env\[' apps` and confirm every name appears in the file or is a listed omission. Done when the diff of the two sets is only the documented omissions.
- T04 — `pnpm typecheck` and `git diff --check` (no code changed, so no functional tests needed). Done when both pass.
- T05 — Commit, push, open PR to `main` referencing #1106; PR body states omissions and why. Done when PR exists and CI is green/queued.

### VALIDATION
- Executed during planning (on baseline): `rg -o 'process\.env\.[A-Za-z_][A-Za-z0-9_]*' apps packages -r '$1' | sort -u` → 20 names; `rg 'import\.meta\.env' apps packages` → no reads; `grep env.example .gitignore` → `!.env.example` at line 17.
- Planned: T03 coverage re-check, `pnpm typecheck`, `git diff --check`, PR CI.
- Acceptance matrix: file present at root (T02); full `apps/` coverage (T03); no secrets/values (review); `pnpm build` unaffected (T04).

### STATE
- Researched/decided: env inventory verified on `main@7ef0710`; file content fully specified.
- Implemented: nothing. Verified: nothing.
- Risks: none beyond listing a var that later gets renamed — mitigate by deriving comments from the call sites above.
- Next step: T01 (claim + branch).

### REFERENCES
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1106
- Call-site lines cited in REPO_MAP; `.gitignore` line 17.

