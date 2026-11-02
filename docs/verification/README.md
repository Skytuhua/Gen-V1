# Verification scope

Gen V1 is a beta. Reproducible checks and observed provider behavior are separate
claims. The current GitHub workflow is available under [Actions](https://github.com/Skytuhua/Gen-V1/actions/workflows/ci.yml).

The preceding 0.6.0 implementation passed all 1,040 application regression tests,
23 original-Hermes worker/custody/control checks and 14 packaged native checks.
The owned OpenAI subscription completed genuine tasks, prediction acceptance,
same-artifact revision and restart recovery. The [completion report](../2026-11-01-product-completion.md)
records the observed interruption and recovery as well as remaining limits.

The 0.6.1 Gen V1 publication changes were separately checked for branding,
installer/profile compatibility, TypeScript, contributor documentation and
sample-data screenshot readiness. The release notes record the new build and
native checks when complete. Hosted workflow status must be read from Actions;
local passes do not establish a hosted pass.

Run the checks from [the setup guide](../getting-started.md). Source hashes for
the retained original engine are in its [manifest](../../third-party/hermes-agent/SOURCE_MANIFEST.json).
Screenshots demonstrate the real interface with illustrative data; they do not
prove model quality or account entitlement.

Raw profile files, credentials, local session snapshots and large verification
archives are intentionally excluded from Git. Other providers still require
their actual sign-ins and task checks. Installed upgrade/uninstall acceptance,
the wider generation-quality pilot and physical mixed-DPI/multi-monitor checks
remain open.
