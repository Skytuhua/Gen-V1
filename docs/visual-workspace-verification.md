# Visual workspace verification

Implementation branch: `feat/visual-workspace`; source version 0.6.5.
Execution used a fresh isolated checkout. Existing application roots, profiles,
accounts, native windows and release candidates were retained.

## Passed local checks

- Whole public TypeScript and the optional personal-visuals plug-in TypeScript.
- Production web/shared presentation builds and desktop-shell build.
- Independent personal-visuals standalone package build: five files, inventory
  SHA-256 `cfea3feee761cf90da152d7916848f1a68db33238ad748c7947251265f8acbc9`.
- Ten actual-App Chrome regressions using clearly labelled synthetic host data:
  full independent chats/models/drafts; move/park/reload editor identity; sidebar
  spatial placement; canonical overview/full plan; repeated plan revisions;
  exact started/unstarted project handling; saved layouts/retained canvas; narrow
  real pointer interaction; installed workspace navigation waits for draft flush.
- Six actual split-renderer browser regressions, including size constraints,
  cancellation, parked editor identity, keyboard operations and bounded menus.
- Forty-four focused layout/repository/profile/plug-in/export checks, and
  nineteen Inbox/attention/event-stream checks.
- Real opaque-frame handshake/custody tests: four pass. Child readiness waits
  for initial verified visibility; replacement documents cannot inherit RPC or
  flush authority. Eight personal-visuals host/opaque-frame checks also pass.
- Initial isolated-Hermes/sidecar failures were traced to a partial dependency
  install. After the pinned local target install completed, all fifteen affected
  engine/sidecar checks passed without changing runtime isolation.
- Independent code/security review findings were corrected and rereviewed.
  Final reviewed deltas have no blocking P1/P2 findings.

Final aggregate public-suite result: **171 files passed, 2 opt-in files skipped;
1468 tests passed, 16 skipped** in 647.87 seconds. The two opt-in files were run
separately with their browser flags (10 actual-App + 6 renderer checks).

The source/runtime allowlists add only explicitly reviewed generic modules,
tests, presentation, optional personal plug-in and attributed Vespin files.
Runtime closure adds eight files. Generated outputs and dependency directories
are excluded. The complete private roadmap is not a public input.

## Limits and remaining acceptance

No installer, installed version, real native popup or browser was executed for
acceptance. Verify popup focus/sound/privacy, DPAPI round-trip on a controlled
target, browser occlusion, DPI and physical multi-monitor placement separately.
Vespin code provenance is verified; pixel fidelity and user visual acceptance
are not claimed. Build warnings about existing large chunks remain visible.

Schedules, observation feeds and operational actions require real scoped
producers. Unavailable states stay explicit. No provider/model call, credential
change, live employee operation, repository visibility change, installation,
release publication or saved-profile promotion was performed by these checks.

New detachment and free-floating desktop views remain deferred. Existing typed
recovery paths remain guarded. Source/browser checks cannot substitute for a
combined native release candidate review.
