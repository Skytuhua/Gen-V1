# Gen V1 0.6.5 native RC review

This is an unexecuted report skeleton, not release approval. Candidate **dba9dde9 used for dry-run only, not the freeze commit**.

| Custody | Value |
|---|---|
| Freeze commit | |
| Installer file name | |
| Installer SHA-256 | |
| Build-manifest SHA-256 | |
| Machine / OS | |
| Date | |
| Toolchain (Node / pnpm / Python / VS) | |
| Open P1 count | unknown |
| Open P2 count | unknown |

Run the [operator checklist](checklist.md) and [historical upgrade plan](upgrade-v0.6.1.md). Move a row to Passed only with exact-candidate evidence; preserve failures and rerun receipts separately. Hashes/paths without behavioral checks do not certify behavior.

## Passed

| Area | Check | Evidence path | Notes |
|---|---|---|---|

## Failed

| Area | Check | Evidence path | Notes |
|---|---|---|---|

## Unverified

| Area | Check | Evidence path | Notes |
|---|---|---|---|
| Clean install | Setup, payload/provider custody | | Disposable per-user installation |
| Installed boots + draft recovery | Two clean boots; retained-memory review | | Default-off memory records, no live inference |
| Owned uninstall | Identity-bound cleanup | | Existing user installs refused |
| Native scenarios | 13 current receipt checks | | Historical v0.6.1 verifier had 14; different coverage |
| Popup focus/sound/privacy | Foreground unchanged, sound policy, preview purge | | Native/manual |
| DPAPI round-trip | Unit/native tests and installed Settings secret across restart | | Same Windows user; never attach secret values |
| Browser occlusion | Native bounds assertions plus dialog visual check | | Screenshots required |
| v6 flags off M01–M17 | Registry custody, key parity, sanitized launch | | M01/M12 N/A, not PASS; runtime endpoint absent |
| Upgrade threads/messages | All seeded records visible | | |
| Upgrade drafts | Two unsent drafts restored | | Origin/profile retained |
| Upgrade artifact accepted state | Three values restored | | |
| Upgrade thread memory | taskMemory/memoryVersion retained and notes visible | | |
| Upgrade settings | Theme retained | | |
| Upgrade account metadata | Synthetic directory and account record retained | | No live tokens |
| Upgrade credentials | Preserve existing runtime-owned credential files | | Synthetic run cannot prove authenticated login |
| Upgrade layouts/canvases/retired presets | N/A in v0.6.1; clean-install retention coverage | | Separate newer-schema fixture/operator check needed |
| Upgrade plug-ins/extensions/scheduler | N/A in v0.6.1; clean-install retention coverage | | Separate newer-schema fixture/operator check needed |
| Upgrade project memory/DPAPI secrets | N/A in v0.6.1; clean-install coverage | | Memory retention + installed secret check |
| Upgrade identifiers | appId, profile roots, account-profile names unchanged | | Installed metadata or directory-bound NSIS registry identity |
| Failed-setup recovery | Interrupt setup; launch retained v0.6.1 | | Separate VM checkpoint; may expose product failure |

## Spec deviations

- Current native verifier emits 13 checks, not the v0.6.1-era 14; it adds zoom, canonical floating/display and child-recovery coverage while replacing older detach paths.
- v0.6.1 has no updater/feed: upgrade means setup-over-install, not local-feed update.
- There is no post-install rollback guarantee. An interrupted NSIS setup may damage the existing install; never call that expected PASS.
- Saved workspace layouts/canvases, retired-preset records, plug-ins/extensions, scheduler, project memory and DPAPI secrets are absent from v0.6.1. They are N/A for historical upgrade and belong to separate clean-install/newer-schema retention review, not fabricated historical seeds. The automated clean lifecycle alone does not cover every newer store.
- M01 and M12 have no registered flag; report N/A, never PASS.
- There is no unified runtime effective-flags endpoint. Installed registry imports plus controlled child environment are bounded evidence, not an introspection endpoint.
- Profile comparison conservatively fails changed existing entity bodies. Review benign migrations explicitly; do not silently accept data loss. Chromium bookkeeping files can disappear on normal boots: retain the raw loss receipt and classify manually.
- Installed host package metadata may omit appId. Snapshot then verifies the installed HKCU NSIS key derived from the expected appId and binds its InstallLocation to the supplied directory; absent/mismatched identity fails instead of inferring success from source defaults. This proves installer identity, not a runtime endpoint.

## Product bugs found

| ID | Severity | Routed-to | Status |
|---|---|---|---|

Do not list harness/environment blockers as product bugs without reproduction in the installed product.
