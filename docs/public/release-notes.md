# Preview release notes

Gen is a Windows x64 preview. Source features, published downloads and acceptance results have different scopes.

[Get started](getting-started.md) · [Feature tour](features.md) · [Changelog](../../CHANGELOG.md)

## What you can download

The [v0.6.1 prerelease](https://github.com/Skytuhua/Gen-V1/releases/tag/v0.6.1) is the current published preview. It includes an unsigned Windows x64 installer and a SHA-256 checksum file. It is not a stable release.

The 0.6.4 and 0.6.5 source previews are not published stable installers. Use the source setup instructions to try changes made after the v0.6.1 prerelease. Release availability can change; check the [release list](https://github.com/Skytuhua/Gen-V1/releases) before choosing an installer.

## Unreleased 0.6.5 source

For the latest source changes, see the [unreleased changelog](../../CHANGELOG.md#unreleased--065-visual-workspace-preview) and [visual workspace guide](../visual-workspace.md).

## 0.6.4 source preview

The 0.6.4 preview kept the original conversation workspace, project/thread navigation, compact composer, neutral dark/light themes and interactive task catalog. Changes include:

- A public plug-in API with independent package versions, compatibility checks, file inventories and durable data outside application updates.
- A main workspace that works without an optional plug-in installed.
- A searchable combined model/reasoning picker, project selection and Build/Plan controls in the composer.
- Compact project context and usage tools with minimize controls; validated plans open automatically.
- Sidebar collapse and narrow-window navigation, with a compact composer.
- Native startup feedback and close/reopen recovery checks for the current candidate.

The [screenshots and videos](media/README.md) show the actual public browser interface from source commit `cb504d0e392fde9e70883b7b7c2e808e13488b7c`, using authored sample data. They do not demonstrate live inference or a packaged installation.

## Verified scope and remaining work

The 0.6.4 source preview passed its Windows CI run. Focused native candidate checks covered workspace cleanup and normal close/reopen recovery. For later revisions, check [GitHub Actions](https://github.com/skytuhua-org/Gen-V1/actions) for the exact commit; source CI does not verify an installed upgrade. Earlier genuine OpenAI/Hermes task verification is documented in [the acceptance report](../2026-11-01-product-completion.md); it does not prove every later build or connection.

The following remain open:

- Installed stable upgrade/updater acceptance on a suitable isolated Windows target.
- Independent live sign-in, model entitlement and task acceptance for providers beyond the evidenced OpenAI route.
- The broader generated-application quality pilot.
- Physical multi-monitor and mixed-DPI acceptance.

A bounded review of 28 captured alerts from the older default branch found none applicable to the evaluated 0.6.4 source. It did not cover newly disclosed advisories outside that set or every opaque bundled binary, and is not a vulnerability-free claim.

In the current source preview, the conversation pane's **Detach conversation** action floats it inside Gen; use **Return to main** or drag it to a split edge. On Windows desktop, the sidebar's **Detach thread** instead opens a pinned native window. See the [visual workspace guide](../visual-workspace.md) for both paths. Neither action enables new native detachment for canvas panels. Gemini/Cursor native compaction, the separate OpenCode agent runtime and Meta/Muse access are also unavailable. Historical design and desktop documents retain older proposals and evidence; the current UI and these limits take precedence.

## Data, licensing and attribution

Existing profiles keep the `GenerativeHarness` and `GenerativeHarnessDesktop` namespaces. Close the app before backups and retain saved drafts, receipts and blocked-operation records during troubleshooting. A source build or candidate check does not establish that an installed upgrade preserved a real profile.

First-party source remains proprietary and unlicensed for redistribution under [LICENSE](../../LICENSE). Retained third-party components keep their original terms; see [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). This presentation does not change those terms.
