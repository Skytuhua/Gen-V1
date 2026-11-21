# Plan: Sign the Windows installer (Azure Artifact Signing)

## META

| Field | Value |
|---|---|
| Feature | Sign the Windows installer: no more "Unknown publisher" warning |
| Size | small (labels `feature`, `small`) |
| Repo | skytuhua-org/Gen-V1 |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52` (verified by clone on 2026-11-21) |
| Related work | #1003 (closed): draft release workflow, which left an unsigned signing hook; PR #942 implemented it |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Approved by the repository owner (Leonardo) from a researched feature proposal on 2026-11-21. Repository facts below were read from the baseline SHA. electron-builder / electron-updater facts were read from the published npm tarballs `app-builder-lib@26.18.0` and `electron-updater@6.8.11` (the versions pinned in `package.json`). Azure facts come from Microsoft's public Artifact Signing documentation and are marked "verify at setup" where they can change. |

**Design and animation ownership.** This feature has almost no UI. Wherever it does touch something a user sees (any update-failure wording, README/download-page trust copy, release-notes text about SmartScreen), the **animation and visual design are defined by Leonardo's separate front-end team**. This plan covers behavior, data, configuration and wiring only. Implementers must not invent new visual treatment or motion; use existing copy patterns and leave visual/animation decisions to that team.

## OBJECTIVE

**Problem.** Gen V1 ships an unsigned Windows x64 NSIS installer (`Gen-V1-Setup-<version>-win-x64.exe`). Windows shows "Unknown publisher" in the download/run security prompt and SmartScreen's "Windows protected your PC" dialog, and the release notes tell users to expect that warning (`CHANGELOG.md` line ~31, `docs/public/release-notes.md` line ~40). This hurts trust and installs.

**Intended behavior.** Release builds produced by `.github/workflows/release.yml` are Authenticode-signed (SHA-256, RFC 3161 timestamped) with a publicly trusted certificate from **Azure Artifact Signing** (Microsoft's managed code-signing service, formerly "Trusted Signing"), using the owner's Azure account. Signed artifacts: the installer, the uninstaller, and the app executable `Gen V1.exe`. Windows then shows the validated organization name as publisher.

**Measurable success.**
1. `Get-AuthenticodeSignature` on the released installer and on the installed `Gen V1.exe` returns `Status = Valid`, signer subject CN equals the configured publisher name, and a timestamp certificate is present.
2. Running the downloaded installer (with Mark-of-the-Web) shows the publisher name, not "Unknown publisher".
3. `latest.yml`/`beta.yml` sha512 and the `.blockmap` match the **signed** installer bytes.
4. A signed build's `app-update.yml` contains `publisherName`, so electron-updater rejects later updates not signed by the same publisher.
5. Builds without signing configuration (local dev, `ci.yml` installed-memory lane) behave exactly as today.

**Not promised.** SmartScreen *reputation* is earned per file/publisher over time. A brand-new signed publisher can still see a SmartScreen reputation prompt for early downloads; it will show the real publisher name instead of "Unknown publisher". Since 2024, EV certificates no longer grant instant reputation either, so no certificate type avoids this. Success criterion 2 is about the publisher name, not about zero SmartScreen prompts.

## REQUIREMENTS

### In scope
- R1. Opt-in signing mode in the electron-builder config used by `scripts/package-desktop.ts` (`desktopBuilderConfig` in `scripts/desktop-assets.ts`), driven only by environment variables. No secret values in the repo.
- R2. Signing happens **during** electron-builder packaging, before blockmap, feed checksums and `build-manifest.json` are written (an existing rule in `docs/releasing.md` and the comment in `release.yml`). Never sign after checksums exist.
- R3. Sign `Gen V1.exe`, the NSIS uninstaller and the installer. This needs `signAndEditExecutable` to be enabled in signing mode (see DESIGN D2).
- R4. Fail closed: in signing mode, missing or invalid credentials or config fail the build (`forceCodeSigning: true`). The release workflow cannot silently produce an unsigned build once signing is turned on.
- R5. The release workflow verifies signatures and checksum consistency before staging assets.
- R6. Azure credentials live only in a protected GitHub Environment used by the release `build` job. The `publish` job never receives them.
- R7. Updater continuity: existing unsigned 0.6.5 installs can update to a signed build. Signed installs reject updates not signed by the same publisher.
- R8. Owner runbook for the Azure setup, plus updated release docs.
- R9. Release-time wording updates ("unsigned prerelease", SmartScreen notes) happen only when a signed release is actually published. The front-end team owns any visual treatment of that copy.

### Out of scope
- Implementing anything in this planning issue. Publishing releases, pushing tags and merging stay owner actions.
- `ci.yml` and the shared setup action (QA-owned, per #1003). The CI packaging lane stays unsigned.
- Signing bundled third-party binaries (Node, Git, gh, Python) under `resources/host` or `resources/node`. Upstream already signs those it publishes. Re-signing is not required to remove "Unknown publisher" from the installer. Recorded as a possible follow-up.
- macOS/Linux signing, MSIX/Store distribution, EV/HSM certificates, self-signed certificates.
- Any UI, animation or visual change (front-end team).

### Decisions (taken)
- D-A. **Provider: Azure Artifact Signing** via electron-builder 26.18.0's built-in `win.azureSignOptions`, which runs the `TrustedSigning` PowerShell module (`Install-Module -Name TrustedSigning -MinimumVersion 0.5.0`, then `Invoke-TrustedSigning`; verified in `app-builder-lib/out/codeSign/windowsSignAzureManager.js`). Reasons: the owner has an Azure account, the cost is low and the keys are managed by Microsoft. It needs no builder upgrade. `signtoolOptions` and `azureSignOptions` cannot both be set (`windowsCodeSign.js` rejects that).
- D-B. **Auth: Entra ID app registration with a client secret**, read by the module's environment credential (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`). The electron-builder docs reference Azure `EnvironmentCredential`. GitHub OIDC (federated credential, no long-lived secret) is preferred long-term but unverified with this module, so it is follow-up task T08, not the default.
- D-C. **Opt-in switch** `HARNESS_WINDOWS_SIGNING=azure`. Unset means today's unsigned config, unchanged. Any other value throws (same pattern as `HARNESS_RELEASE_CHANNEL`).
- D-D. **Release workflow signs both channels** (stable and prerelease) once T01 and T03 land. Unsigned release builds are no longer possible from `release.yml`.
- D-E. **Timestamp server**: the electron-builder default `http://timestamp.acs.microsoft.com`, SHA256 file and timestamp digests. Artifact Signing certificates are short-lived (about 3 days), so timestamping is mandatory for signatures to stay valid.

## REPO_MAP (verified at baseline SHA)

| Path | Relevant content |
|---|---|
| `package.json` | `electron-builder` 26.18.0 (devDependency), `electron-updater` 6.8.11; scripts `desktop:package`, `typecheck` (`tsc --noEmit`), `test` (`pnpm build:credential-lease && pnpm build:widgets && vitest run`) |
| `scripts/desktop-assets.ts` (~line 116) | `desktopBuilderConfig(dist, channel=process.env.HARNESS_RELEASE_CHANNEL)` returns the builder config: `appId:'local.generativeharness.desktop'`, `productName:'Gen V1'`, `forceCodeSigning:false`, `publish:[{provider:'github',owner:'skytuhua-org',repo:'Gen-V1',releaseType:'release',channel}]`, `win:{target:[{target:'nsis',arch:['x64']}],signAndEditExecutable:false}`, `nsis:{artifactName:'Gen-V1-Setup-${version}-win-x64.exe',oneClick:true,perMachine:false,allowElevation:false,packElevateHelper:false,...}` |
| `scripts/package-desktop.ts` (line 43) | Calls `build({publish:'never', projectDir, config:{...config, afterPack}})`. `afterPack` verifies packaged runtime payloads. |
| `tests/desktop-packaging.test.ts` (lines ~74–130) | Asserts builder config shape, channels and the NSIS options above. |
| `.github/workflows/release.yml` | `build` job (windows-latest, `contents: read`): validates identity, stages wheels and git tools, runs `pnpm desktop:package --output-root .harness-release-package`, then a no-op **"Signing hook (unsigned placeholder)"** step whose comment names `WINDOWS_CSC_LINK`/`WINDOWS_CSC_KEY_PASSWORD`, then stages `Gen-V1-Setup-<v>-win-x64.exe`, `.blockmap`, `latest.yml`/`beta.yml` and `build-manifest.json` from `.harness-release-package/desktop-release-<version>`. A separate `publish` job (`contents: write`) uploads to a draft release with `gh api` only. |
| `tests/release-workflow.test.ts` | Reads `release.yml` as text and asserts its structure. It has no signing assertions today. |
| `docs/releasing.md` ("Signing hook" section) | Says builds are unsigned and that future signing must happen during packaging before blockmap/feed/manifest. Names `WINDOWS_CSC_LINK`/`WINDOWS_CSC_KEY_PASSWORD`, which this plan replaces with Azure variables. |
| `apps/desktop/updater.ts` | `createDesktopUpdater`: stable channel, no downgrades, no auto-download. Any `downloadUpdate()` rejection or unverified download calls `failure()`, which publishes `{state:'failed', message:'The update could not be verified. Gen will keep the current version.'}`. |
| `tests/desktop-updater.test.ts` | Unit tests for the updater state machine. |
| `.github/workflows/ci.yml` (line ~293) | `pnpm desktop:package --output-root .harness-installed-package` (unsigned CI lane, out of scope). |
| `README.md` line ~76, `docs/public/getting-started.md` line ~9, `docs/public/release-notes.md` lines ~30/40, `CHANGELOG.md` lines ~21/31, `docs/getting-started.md` line ~159 | "unsigned" / SmartScreen wording, updated at release time (T07). |

Verified electron-builder / electron-updater behavior (from the pinned tarballs):
- `signAndEditExecutable:false` skips **both** resource editing and signing of the app exe (`winPackager.js` ~line 240). The installer and uninstaller are still passed to `signIf` by `NsisTarget.js` (~lines 409, 486). `forceCodeSigning:true` together with `signAndEditExecutable:false` throws `InvalidConfigurationError`.
- `azureSignOptions` fields: `publisherName` (required), `endpoint`, `certificateProfileName`, `codeSigningAccountName`, optional `fileDigest` (SHA256), `timestampRfc3161` (default `http://timestamp.acs.microsoft.com`), `timestampDigest` (SHA256), plus verbatim extra `Invoke-TrustedSigning` arguments.
- `PublishManager.js` ~line 202 writes `publisherName` into `app-update.yml` when `win.verifyUpdateCodeSignature !== false` (the default). The Azure manager returns `azureSignOptions.publisherName` as the computed publisher.
- `electron-updater` `NsisUpdater.verifySignature`: if `app-update.yml` has no `publisherName`, verification is skipped (so unsigned 0.6.5 installs accept a signed update). Otherwise a mismatch throws `ERR_UPDATER_INVALID_SIGNATURE` before install, and the CN-only match logs a warning asking for the full DN.

Discovery (not verified, the implementer confirms):
- The exact unpacked directory under `.harness-release-package/desktop-release-<version>/` that holds `Gen V1.exe` (electron-builder normally uses `win-unpacked/`).
- Whether rcedit resource editing (enabled with `signAndEditExecutable`) changes any runtime assumption checked by `scripts/verify-installed-desktop.ts` or `afterPack`. It should not, because `afterPack` runs before signing and checks resources only.
- Whether the Microsoft rename to "Artifact Signing" changed the PowerShell module name or the role name. electron-builder 26.18.0 still calls `TrustedSigning` / `Invoke-TrustedSigning`.

## DESIGN

### D1. Configuration contract (environment)

| Name | Kind | Where set | Meaning |
|---|---|---|---|
| `HARNESS_WINDOWS_SIGNING` | env | release `build` job | `azure` turns signing on; unset means unsigned (today); anything else throws `HARNESS_WINDOWS_SIGNING must be azure or unset.` |
| `HARNESS_AZURE_SIGNING_ENDPOINT` | Environment variable (not secret) | GitHub Environment `windows-signing` | Regional endpoint, e.g. `https://eus.codesigning.azure.net/` |
| `HARNESS_AZURE_SIGNING_ACCOUNT` | variable | same | Artifact Signing account name |
| `HARNESS_AZURE_SIGNING_PROFILE` | variable | same | Certificate profile name |
| `HARNESS_WINDOWS_PUBLISHER_NAME` | variable | same | Exact certificate subject CN (the validated organization name) |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | **secrets** | same | Entra ID app registration that holds the signer role on the certificate profile |

### D2. Builder config shape in signing mode
`desktopBuilderConfig(dist, channel, signing=process.env.HARNESS_WINDOWS_SIGNING)`:
- `signing === undefined`: returns exactly today's object (all existing tests stay green unchanged).
- `signing === 'azure'`: requires the four `HARNESS_AZURE_*`/`HARNESS_WINDOWS_PUBLISHER_NAME` variables to be non-empty. Otherwise it throws a message naming the missing variable(s), never their values. It returns the same object with:
  ```ts
  forceCodeSigning: true,
  win: {
    target: [{target:'nsis', arch:['x64']}],
    signAndEditExecutable: true,
    azureSignOptions: {
      publisherName: process.env.HARNESS_WINDOWS_PUBLISHER_NAME,
      endpoint: process.env.HARNESS_AZURE_SIGNING_ENDPOINT,
      codeSigningAccountName: process.env.HARNESS_AZURE_SIGNING_ACCOUNT,
      certificateProfileName: process.env.HARNESS_AZURE_SIGNING_PROFILE,
    },
  },
  ```
  `verifyUpdateCodeSignature` stays at its default (true), so `publisherName` lands in `app-update.yml`.
- The `AZURE_*` credentials are **not** read by repo code. The PowerShell module reads them from the environment.

### D3. Release workflow flow
1. `build` job gains `environment: windows-signing` (with required reviewers set by the owner) so its secrets are released only to approved runs on `main` or `v*` tags. The existing job-level ref gate stays.
2. The "Package the production Windows installer" step gets `env:` with `HARNESS_WINDOWS_SIGNING: azure`, the four `vars.*` and the three `secrets.*`.
3. The placeholder "Signing hook (unsigned placeholder)" step is **replaced** by "Verify Authenticode signatures and feed checksums" (pwsh, `$ErrorActionPreference='Stop'`):
   - For the installer and the unpacked `Gen V1.exe`, run `Get-AuthenticodeSignature`. Require `Status -eq 'Valid'`, require that `SignerCertificate.Subject` contains `CN=<publisher>`, and require `TimeStamperCertificate -ne $null`. Otherwise throw `Unsigned or invalid release artifact: <name>`.
   - Compute the base64 SHA-512 of the installer and require it to equal `sha512` in the channel feed (`latest.yml`/`beta.yml`). Otherwise throw `Feed checksum does not match the signed installer`.
   - Output only names, statuses and thumbprints, never secret values.
4. The `publish` job is unchanged and receives no signing secrets.
5. Remove the `WINDOWS_CSC_LINK`/`WINDOWS_CSC_KEY_PASSWORD` comment.

### D4. Updater behavior and states
| Installed build | Update candidate | Result |
|---|---|---|
| unsigned (0.6.5, no `publisherName` in `app-update.yml`) | signed | accepted (verification skipped by electron-updater) |
| signed | signed by the same publisher CN | accepted |
| signed | unsigned or a different publisher | `ERR_UPDATER_INVALID_SIGNATURE` → `downloadUpdate()` rejects → existing `failure()` → state `failed`, current version kept |

Risk: if the validated publisher name ever changes (organization rename), every signed install rejects updates. Record this in the runbook. Mitigation: `publisherName` may be an array that lists the old and new names for one transition release.

### D5. Security boundaries
- Secrets live only in the GitHub Environment. They are exposed to the `build` job, which runs repository code (`pnpm desktop:package`). This is acceptable because the job is gated to `main` and `v*` tags, needs Environment approval, and `v*` tags are protected per `docs/releasing.md`.
- Least privilege: the app registration has only the certificate profile signer role (Microsoft names it "Artifact Signing Certificate Profile Signer", formerly "Trusted Signing Certificate Profile Signer"; verify at setup) on that one profile.
- Rotate the client secret at least yearly (runbook). Revoking the app registration stops signing immediately.

### D6. Error, retry and rollback
- A signing failure fails the build before any artifact upload. Rerun the workflow after fixing config. Nothing is published.
- A timestamp server outage also fails the build. Rerun later. Never fall back to unsigned.
- Rollback: revert the workflow/config PR. Already-published signed releases stay valid because they are timestamped.

### D7. Owner setup (Leonardo, Azure account)
1. Have an Azure subscription and register the resource provider `Microsoft.CodeSigning`.
2. Create an **Artifact Signing account** in a supported region and pick the **Basic** SKU (Microsoft lists about US$9.99/month for 5,000 signatures; verify current pricing).
3. Complete **identity validation** for **Public Trust** as an Organization. Microsoft documents eligibility for organizations in the USA, Canada, the EU and the UK with verifiable business history, and for individual developers in the USA and Canada; verify at setup. Validation can take days and is the long pole.
4. Create a **Public Trust certificate profile** bound to the validated identity. Record the subject CN exactly (this becomes `HARNESS_WINDOWS_PUBLISHER_NAME`).
5. Create an Entra ID app registration with a client secret. Assign it the certificate-profile signer role on that profile only.
6. In GitHub `skytuhua-org/Gen-V1` → Settings → Environments, create `windows-signing`. Restrict it to `main` and `v*` tags, add yourself as a required reviewer, add the 3 secrets and 4 variables from D1.

## EXECUTION_DAG

Dependencies: T01 → T06; T02 → T03 → T06; T04 is independent; T05 → T06; T06 → T07. T08 is an optional follow-up after T06.

### T01: Provision Azure Artifact Signing (owner: Leonardo)
- Goal: complete D7 steps 1–6.
- Inputs: Azure account. Outputs: values for D1 stored in the GitHub Environment, and the publisher CN told to the implementer (it is not secret).
- Done when: the Environment `windows-signing` exists with all 7 entries, and identity validation shows Completed in the Azure portal.
- Negative check: the app registration has no roles beyond the signer role on that profile.
- Handoff: comment on this issue "T01 done, publisher CN = …" (no secret values).

### T02: Signing mode in the builder config
- Files: `scripts/desktop-assets.ts` (`desktopBuilderConfig`), `tests/desktop-packaging.test.ts`. Touch no other file.
- Steps: implement D1/D2 exactly. Read `process.env` at call time (as the channel does). Keep the unsigned return value deep-equal to today's.
- Positive tests:
  - With `HARNESS_WINDOWS_SIGNING` unset, the existing assertions all pass and `win` equals `{target:[{target:'nsis',arch:['x64']}],signAndEditExecutable:false}` with `forceCodeSigning:false`.
  - With `azure` and all four variables stubbed (`vi.stubEnv`), `forceCodeSigning===true`, `win.signAndEditExecutable===true`, and `win.azureSignOptions` equals the four mapped values with no `signtoolOptions` key.
- Negative tests:
  - `HARNESS_WINDOWS_SIGNING='signtool'`, `''` or `'Azure'` throws `HARNESS_WINDOWS_SIGNING must be azure or unset.`
  - `azure` with any one variable missing throws an error naming that variable. The error text contains no other variable's value.
- Commands: `pnpm vitest run tests/desktop-packaging.test.ts`, `pnpm typecheck`.
- Done when: both commands pass, and the PR links this issue.

### T03: Release workflow wiring and verification step
- Prereq: T02 merged (or stacked on it).
- Files: `.github/workflows/release.yml`, `tests/release-workflow.test.ts`.
- Steps: implement D3 (Environment on `build`, env on the package step, replace the placeholder step with the verification step, delete the `WINDOWS_CSC_*` comment). Keep every existing gate, permission and pinned action SHA unchanged.
- Tests (text assertions on the YAML, following the file's existing style):
  - The `build` job declares `environment: windows-signing`.
  - The package step sets `HARNESS_WINDOWS_SIGNING: azure` and references `secrets.AZURE_CLIENT_SECRET`, `secrets.AZURE_CLIENT_ID`, `secrets.AZURE_TENANT_ID` and the 4 `vars.HARNESS_*`.
  - The `publish` job contains no `AZURE_` or `HARNESS_AZURE` reference.
  - The verification step appears after packaging and before "Stage release assets", and contains `Get-AuthenticodeSignature`, `'Valid'`, `TimeStamperCertificate` and the feed sha512 comparison.
  - The string `Signing hook (unsigned placeholder)` is absent.
- Commands: `pnpm vitest run tests/release-workflow.test.ts`.
- Done when: tests pass. Do **not** trigger the workflow (that is T06).

### T04: Updater signature-mismatch regression test
- Files: `tests/desktop-updater.test.ts` only. `apps/desktop/updater.ts` should need no change; if it does, stop and report on this issue.
- Test: make a fake updater whose `downloadUpdate()` rejects with `Object.assign(Error('not signed'),{code:'ERR_UPDATER_INVALID_SIGNATURE'})`. Then check that `status().state==='failed'` with the existing message, and that `installAfterClose` returns false and never calls the fake's install method.
- Command: `pnpm vitest run tests/desktop-updater.test.ts`.
- Done when: the test passes.

### T05: Release documentation and owner runbook
- Files: `docs/releasing.md` only.
- Steps: rewrite the "Signing hook" section as "Signing". Cover: the provider, D1 table, D7 runbook, the verification step, the D4 updater table, the publisher-rename risk, secret rotation, failure/rerun guidance, and the fact that the CI lane stays unsigned. Update the intro sentence "signing is not yet configured" to say signing activates once the Environment exists.
- Check: `node scripts/check-doc-links.mjs` (used by `docs-links.yml`; confirm the exact invocation in that workflow).
- Done when: the docs link check passes and the section has no `WINDOWS_CSC` mention.

### T06: Live signed draft dry run (needs T01, T03, T05)
- Owner: an implementer with a Windows machine; the owner approves the Environment run.
- Steps:
  1. Run "Draft desktop release" manually on `main` with `channel=prerelease`. Approve the Environment.
  2. Confirm the build log shows `Invoke-TrustedSigning` for `Gen V1.exe`, the uninstaller and the installer, and that the verification step passed.
  3. Download the draft's installer in a browser on a clean Windows 10/11 VM (so MOTW is set). Open it, confirm the publisher name is shown and "Unknown publisher" is absent, and screenshot that.
  4. Install, then run `Get-AuthenticodeSignature "$env:LOCALAPPDATA\Programs\<install dir>\Gen V1.exe"` and confirm `Valid`. Confirm `resources\app-update.yml` contains `publisherName`.
  5. Updater continuity: install unsigned 0.6.5, point it at the signed feed (or wait for the draft to be published by the owner) and confirm the update is offered and accepted.
- **Do not publish the draft.** Delete it afterward unless the owner asks to keep it.
- Done when: evidence (log excerpt, screenshot, PowerShell output) is posted on this issue.

### T07: Release-time wording (after the owner publishes the first signed release)
- Files: `README.md` (~76), `docs/public/getting-started.md` (~9), `docs/public/release-notes.md` (~30, ~40), `CHANGELOG.md` (new entry), `docs/getting-started.md` (~159, which states that *local* packaging is unsigned; keep that true).
- Steps: replace "unsigned" claims only for releases that are actually signed, and replace the SmartScreen note with "signed by <publisher>; SmartScreen may still ask for confirmation while reputation builds". Wording and any visual presentation are reviewed by the front-end team.
- Done when: the docs link check passes and the owner approves the wording.

### T08 (optional follow-up): OIDC instead of a client secret
- Investigate whether the `TrustedSigning` module accepts a GitHub OIDC federated credential (for example via `azure/login` plus Azure CLI credential, or the `AZURE_FEDERATED_TOKEN_FILE` env credential). If yes, plan the switch and remove `AZURE_CLIENT_SECRET`. Separate issue.

Parallel ownership: T02, T03, T04 and T05 touch disjoint files. T03 depends on T02's env names only.

## VALIDATION

Setup: `pnpm install` per `CONTRIBUTING.md`, at repo root.

| Level | Command / action | Expected |
|---|---|---|
| Unit | `pnpm vitest run tests/desktop-packaging.test.ts tests/release-workflow.test.ts tests/desktop-updater.test.ts` | all pass |
| Types | `pnpm typecheck` | pass |
| Full suite (regression) | `pnpm test` | pass (note any known flakes on the PR) |
| Docs | docs link check per `docs-links.yml` | pass |
| CI | PR checks green; the unsigned CI packaging lane is unchanged and still passes | green |
| Live | T06 steps 1–5 | publisher shown, signatures Valid with timestamp, feed sha512 matches, updater accepts |

Acceptance matrix:

| Req | Task | Check |
|---|---|---|
| R1 | T02 | unit tests for the env contract |
| R2 | T03, T06 | step order test, feed sha512 check |
| R3 | T02, T06 | `signAndEditExecutable` test, `Get-AuthenticodeSignature` on exe/installer |
| R4 | T02, T03 | negative env tests, `forceCodeSigning`, verification step throws |
| R5 | T03 | YAML tests, live log |
| R6 | T03 | `publish` job has no AZURE refs; Environment gate |
| R7 | T04, T06 | updater unit test, live update from 0.6.5 |
| R8 | T05 | docs section |
| R9 | T07 | wording review by the owner and front-end team |

Release gate: T01–T06 done with evidence before the owner publishes the first signed release. Tests executed so far: **none** (planning only).

## STATE
- Researched/decided: provider, auth, env contract, workflow design, updater behavior (from the pinned library source).
- Implemented: nothing. Verified: nothing at runtime.
- Pending: T01 (owner Azure setup and identity validation, the longest step), then T02–T07.
- Risks: identity-validation eligibility or delays; publisher-name changes breaking updates (D4); SmartScreen reputation prompts persisting early on; the `TrustedSigning` module needing NuGet/PSGallery on the runner (electron-builder installs it at build time); the module or role rename after Microsoft's Artifact Signing rebrand.
- Exact next step: the owner does T01. In parallel, an implementer takes T02 (and T04/T05), each in its own PR linked here.

## REFERENCES
- Microsoft Artifact Signing (formerly Trusted Signing) overview and quickstart: https://learn.microsoft.com/azure/trusted-signing/
- Pricing: https://azure.microsoft.com/pricing/details/trusted-signing/
- electron-builder Windows code signing (azureSignOptions): https://www.electron.build/code-signing-win
- electron-builder `WindowsAzureSigningConfiguration`: `app-builder-lib@26.18.0` `out/options/winOptions.d.ts`
- electron-updater signature check: `electron-updater@6.8.11` `out/NsisUpdater.js` (`verifySignature`)
- Azure EnvironmentCredential: https://learn.microsoft.com/dotnet/api/azure.identity.environmentcredential
- Repo: `.github/workflows/release.yml`, `docs/releasing.md`, `scripts/desktop-assets.ts`, `apps/desktop/updater.ts` at `1f9466ab3fde0713b42430d0e59e08f744637d52`
- Prior work: #1003, PR #942
