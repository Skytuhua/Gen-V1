# Desktop releases

The [draft release workflow](../.github/workflows/release.yml) builds the Windows
x64 installer and stages a **draft** release in `skytuhua-org/Gen-V1`. Publishing
remains a separate human action. Version 0.6.5 ships as an **unsigned preview**
on the prerelease channel, not as a stable release. Review the draft and its
artifacts before publishing; signing activates once the `windows-signing`
environment exists (see [Signing](#signing)).

## Trigger and channel

- Push a tag matching `v<package.json version>`. Tag pushes always use the
  prerelease channel, including plain versions such as `v0.6.5`. Protect `v*`
  tags with a GitHub tag ruleset restricting creation and updates to trusted
  release maintainers.
- Or run **Draft desktop release** manually (default channel: `prerelease`),
  on `main` only, choosing `stable` or `prerelease`. There is no source-ref
  override: checkout uses the event's immutable `github.sha`. The job-level
  ref gate runs before any repository code. The tag is derived from the
  package version. Prerelease accepts any valid semver, including `0.6.5`.
  Stable requires a version without a semver prerelease (so `0.7.0-beta.1`
  is rejected). Build metadata does not count as a prerelease.
- The workflow never creates or pushes a Git tag. A missing tag is created by
  GitHub when a maintainer publishes the draft, using the checked-out commit.

`HARNESS_RELEASE_CHANNEL=stable` selects `latest.yml`; `prerelease` selects
`beta.yml`. Unset defaults to the stable feed; other values (including empty)
are rejected. Existing stable clients explicitly use `latest` and reject
prereleases; this workflow does not opt them into beta updates. The 0.6.5
preview builds are also stable-only updater clients (`allowPrerelease=false`):
they will pick up the next stable release, not later prereleases.

Explicit release-channel packaging enables NSIS differential artifacts so the
installer's `.blockmap` is generated. Ordinary packaging (including the
installed-memory CI lane) retains its non-differential payload.
Packaging always uses `publish: never`. In electron-builder 26.18.0,
`PublishManager.artifactCreatedWithoutExplicitPublishConfig` schedules feed
generation independently of its upload gate, and `NsisTarget` creates the
blockmap when differential packaging is enabled.

## Permissions and artifacts

The `build` job has only `contents: read`. It uploads the installer, blockmap,
channel feed, `build-manifest.json`, and identity metadata as a workflow artifact.
The separate `publish` job alone has `contents: write` and uses the built-in
`GITHUB_TOKEN` as `GH_TOKEN`. It has no checkout, setup action, or repository
code execution: inline PowerShell uses only `gh api` for release operations.
It cross-checks metadata against build job outputs; metadata itself is not a
release asset. No personal token is needed.

An existing tag (including an annotated tag) must resolve to the build commit.
An existing draft must match the channel, its `target_commitish` must resolve
to that commit, and it must have **zero assets**. Tags and drafts are never
retargeted. Otherwise, a new draft is created targeting the build commit.
Uploads use the release ID, never overwrite or delete assets, and check that
the release remains a draft before each upload and after all uploads.
These checks are not a server-side transaction: do not publish a draft while
its workflow is running. A publication between API calls is detected by a
subsequent check, but an already completed upload cannot be rolled back.

If an upload fails after some assets have arrived, reruns fail closed.
Inspect the failure, delete the incomplete draft manually, and rerun; the
workflow will not remove assets or modify a published release.

## Signing

Release builds are Authenticode-signed (SHA-256, RFC 3161 timestamped) with a
publicly trusted certificate from **Azure Artifact Signing**, Microsoft's
managed code-signing service (formerly "Trusted Signing"). Signing activates
once the GitHub environment `windows-signing` exists with every entry below.
The `build` job declares that environment, so its secrets are released only
to runs approved for `main` or `v*` tags; until then the package step fails
closed naming the missing variables and never falls back to unsigned. The
installer, the uninstaller and `Gen V1.exe` are all signed during packaging,
before blockmaps, feed hashes and the manifest are finalized.

| Name | Kind | Where set | Meaning |
| --- | --- | --- | --- |
| `HARNESS_WINDOWS_SIGNING` | env | `build` job | `azure` turns signing on; unset means unsigned; any other value is rejected |
| `HARNESS_AZURE_SIGNING_ENDPOINT` | variable | environment `windows-signing` | Regional endpoint, e.g. `https://eus.codesigning.azure.net/` |
| `HARNESS_AZURE_SIGNING_ACCOUNT` | variable | same | Artifact Signing account name |
| `HARNESS_AZURE_SIGNING_PROFILE` | variable | same | Certificate profile name |
| `HARNESS_WINDOWS_PUBLISHER_NAME` | variable | same | Exact certificate subject CN (validated organization name) |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | **secrets** | same | Entra ID app registration holding the signer role on that profile |

Owner setup (Azure account):

1. Register the `Microsoft.CodeSigning` resource provider on the subscription.
2. Create an Artifact Signing account in a supported region (Basic SKU).
3. Complete identity validation for **Public Trust** as an organization;
   validation can take days and is the long pole.
4. Create a Public Trust certificate profile bound to the validated identity
   and record the subject CN exactly (it becomes
   `HARNESS_WINDOWS_PUBLISHER_NAME`).
5. Create an Entra ID app registration with a client secret and grant it only
   the certificate-profile signer role (Microsoft names it "Artifact Signing
   Certificate Profile Signer", formerly "Trusted Signing Certificate Profile
   Signer") on that one profile.
6. In the repository settings, create the environment `windows-signing`
   restricted to `main` and `v*` tags with a required reviewer, and add the
   three secrets and four variables from the table.

After packaging, a verification step requires `Get-AuthenticodeSignature` to
report `Valid` with a timestamp and the expected publisher CN on the installer
and the unpacked `Gen V1.exe`, and requires the channel feed's `sha512` to
equal the signed installer's checksum. The step prints names, statuses and
thumbprints only — never secret values.

Updater continuity:

| Installed build | Update candidate | Result |
| --- | --- | --- |
| unsigned (0.6.5, no `publisherName` in `app-update.yml`) | signed | accepted (signature verification skipped) |
| signed | signed by the same publisher CN | accepted |
| signed | unsigned or a different publisher | `ERR_UPDATER_INVALID_SIGNATURE`; the update fails and the current version is kept |

If the validated publisher name ever changes (for example an organization
rename), every signed install rejects updates. `publisherName` may be set to
an array listing the old and new names for one transition release.

A signing or timestamp failure fails the build before any artifact is
uploaded; fix the configuration and rerun — nothing is published. Rollback is
reverting the workflow change; already-published signed releases stay valid
because they are timestamped. Rotate the client secret at least yearly;
revoking the app registration stops signing immediately. The unsigned CI
packaging lane in `ci.yml` runs without `HARNESS_WINDOWS_SIGNING` and stays
unsigned.
