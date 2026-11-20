# Desktop releases

The [draft release workflow](../.github/workflows/release.yml) builds the Windows
x64 installer and stages a **draft** release in `skytuhua-org/Gen-V1`. Publishing
remains a separate human action. Version 0.6.5 ships as an **unsigned preview**
on the prerelease channel, not as a stable release. Review the draft and its
artifacts before publishing; signing is not yet configured.

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

## Signing hook

The labelled signing step is currently a no-op: builds are **unsigned**.
Future signing should wire certificate secrets such as `WINDOWS_CSC_LINK` and
`WINDOWS_CSC_KEY_PASSWORD` into electron-builder during packaging (and enable
its signing configuration), before blockmaps, feed hashes, and the manifest
are finalized. Do not sign the executable after those checksums are generated.
