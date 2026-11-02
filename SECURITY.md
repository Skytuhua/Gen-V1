# Security policy

Last updated: 2026-11-01.

Gen V1 is a beta local application. Security reports should identify the affected version and a minimal, redacted reproduction. The current release line is the focus of review; there is no published response-time or patch-support guarantee for older builds.

## Report privately

Use **Security → Report a vulnerability** on GitHub when available. If it is unavailable, ask the maintainer for a private reporting channel without posting sensitive details. Do not include tokens, provider credential files, private conversations or full application profiles in issues or pull requests.

A useful report includes:

- The affected release or commit and operating system.
- The boundary involved and expected behavior.
- Minimal steps using synthetic data.
- The observed effect and relevant redacted logs.

Ordinary UI bugs and feature requests can use the normal issue templates.

## Application boundaries

- The backend binds to loopback. Remote or multi-user exposure is not an accepted deployment mode.
- Credentials stay in app-owned provider profiles. A local label, configured credential or advertised model list is not verified account identity or entitlement.
- File and operation access is scoped by host grants, validation and explicit approval. Approved project tests and native runtimes execute with local-user privileges; they are not an operating-system sandbox.
- Generated JavaScript runs in opaque workers with bounded messages, schema checks and a watchdog. There is no hard per-worker operating-system memory quota.
- Native work retains ownership until teardown is confirmed. Do not remove guard files or clear blocked metadata to bypass an unfinished sign-in or process.
- Model output and learned skill text do not grant permissions. Review consequential actions and proposed skill changes before approval.

## Handling local data

The backend data directory defaults to `%LOCALAPPDATA%\GenerativeHarness`. It can contain credentials, attachments, conversations, skill files and operation receipts. The native window/session profile defaults to `%APPDATA%\GenerativeHarnessDesktop`.

Keep these directories and raw test evidence out of source control. Close the application before copying a profile for backup. Removing a local account registration or signing out locally does not imply that a provider revoked remote sessions or grants.

For verification scope and known acceptance limits, see [the completion report](docs/2026-11-01-product-completion.md).
