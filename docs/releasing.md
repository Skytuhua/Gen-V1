# Desktop releases

The [draft release workflow](../.github/workflows/release.yml) builds the Windows
x64 installer and stages a **draft** release in `skytuhua-org/Gen-V1`. Publishing
remains a separate human action. Version 0.6.5 ships as an **unsigned preview**
on the prerelease channel, not as a stable release. Review the draft and its
artifacts before publishing; signing is not yet configured.

## Trigger and channel

- Push a tag matching `v<package.json version>`. Tag pushes always use the
  prerelease channel, including plain versions such as `v0.6.5`.
- Or run **Draft desktop release** manually (default channel: `prerelease`),
  choose `stable` or `prerelease`,
  and optionally supply a source ref. The tag is derived from that ref's
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

The job uses the built-in `GITHUB_TOKEN` as `GH_TOKEN`, with `contents: write`
only for the release job. No personal token is needed. The release contains
the installer, its blockmap, the channel feed, and `build-manifest.json`.
An existing draft is updated with clobber semantics only when its channel
matches. A published release is never intentionally changed; reruns fail.
Do not publish a draft while its release workflow is running.

## Signing hook

The labelled signing step is currently a no-op: builds are **unsigned**.
Future signing should wire certificate secrets such as `WINDOWS_CSC_LINK` and
`WINDOWS_CSC_KEY_PASSWORD` into electron-builder during packaging (and enable
its signing configuration), before blockmaps, feed hashes, and the manifest
are finalized. Do not sign the executable after those checksums are generated.
