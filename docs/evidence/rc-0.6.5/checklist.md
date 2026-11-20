# Ordered RC operator checklist

Use a disposable Windows x64 VM and the same Windows account throughout. No real credentials, inference or provider network calls are needed. Back up/relocate default profiles before any installation; do not delete user data. Close Gen V1 before snapshots. CDP binds loopback only and is closed with the owned application.

All commands run from the review-branch repo root. In PowerShell, set `$out` to a fresh absolute evidence directory under `.harness-rc-review`; retain it for every phase. `$install` is an exclusive short absolute directory, e.g. `C:\gen-rc\native-065`. Commands below use `corepack pnpm exec tsx scripts/rc-review/run-rc-review.ts` (abbreviated here only in prose, never installed as an alias).

1. Record OS, toolchains, display/audio setup and open P1/P2 counts in [the report](README.md). Confirm CPython 3.14 x64 (`py -3.14 --version`), VS C++ desktop tools and frozen-lockfile dependencies. No feature-flag environment overrides may be present. Do not approve unrelated dependency build scripts blindly.
2. Freeze only after review changes are committed, pushed and clean. Build exact commit:
   ```powershell
   corepack pnpm exec tsx scripts/rc-review/run-rc-review.ts --phase build --commit <sha> --label dry-run --out $out
   ```
   Use `--label freeze` only for the actual freeze SHA; dba9dde9 is dry-run-only. Preserve `rc-build.json`, setup and build-manifest hashes. Build rejects source drift.
   For an isolated candidate checkout, add `--worktree C:\gen-rc\worktrees\dba9dde9`; the branch's harness stays outside that clean checkout. Install its pinned Node/Python/integration/tool inputs first per the repository build instructions. `rc-build.json` records the target worktree and elapsed build milliseconds.
3. Run clean lifecycle **before any installed upgrade**. Preflight refuses existing Gen V1 registry keys, processes, shortcuts or updater cache:
   ```powershell
   corepack pnpm exec tsx scripts/rc-review/run-rc-review.ts --phase clean --out $out --allow-install disposable-vm
   ```
   This includes `--project-memory-retention` behavior (default-off review). Inspect `clean.json` and linked full evidence directory, including provider receipts; it owns its uninstall.
4. Install the same setup into an exclusive temporary directory and exercise native checks, then flags:
   ```powershell
   corepack pnpm exec tsx scripts/rc-review/run-rc-review.ts --phase native --out $out --install $install --allow-install disposable-vm
   corepack pnpm exec tsx scripts/rc-review/run-rc-review.ts --phase flags --out $out --install $install
   ```
   The native verifier uses its own fixture profile. Do not confuse it with the real-profile upgrade seed. `native-source.json` retains the original screenshot/diagnostic directory. Review all 13 receipt entries.
5. Native popup manual acceptance: use Settings → Notifications & Usage to choose task notifications, Preview sound, sound volume, preview privacy (Message preview / Title only / Private · no content), and Quiet hours. Open another application, focus its editor and place the caret. Trigger a synthetic pending-attention event in Gen V1 without changing foreground; this requires a controlled host fixture or a real provider event, not merely clicking Preview sound. Record foreground HWND/app and caret before/after; confirm no focus steal. Test one-shot sound, muted setting, repeated delivery and overnight quiet hours with actual speakers/headphones; without an audio device/listener, sound remains Unverified even if Preview sound is executable. Test full/title/private previews, then change to private while cards are queued/visible: confirm old sensitive previews disappear immediately. Save screenshots with synthetic text only; record audible observations in a dated operator note. Unit mocks are not OS acceptance.
6. Open native browser content; open Settings and another app dialog above it. Confirm remote pixels disappear under dialogs and return only afterward. Record before/dialog/after screenshots, not only bounds logs.
7. Run DPAPI tests and installed secret review:
   ```powershell
   corepack pnpm exec tsx scripts/rc-review/run-rc-review.ts --phase dpapi --out $out --install $install
   ```
   This runs `vitest run tests/host-effect-authenticator-v3.test.ts tests/protected-effect-host-v3.test.mjs`. In the installed app, open Settings → Models & Accounts → Environment variables and advanced runtime settings. Save a disposable environment secret, restart, and confirm it resolves for a new project terminal without exposing its value in evidence. Confirm `%LOCALAPPDATA%\GenerativeHarness\environment\values.json` contains no plaintext canary. Preserve only a boolean/hash observation. This manual round-trip is separate from the test-profile unit tests.
8. Run physical checks against actual hardware:
   ```powershell
   corepack pnpm exec tsx scripts/rc-review/run-rc-review.ts --phase physical --out $out --install $install
   ```
   Inspect screenshots, display inventory, monitor movement and DPI. Missing multi-monitor/mixed-DPI hardware stays Unverified. Do not emulate geometry to claim physical PASS.
9. Review newer-schema-only store retention separately (saved layouts/legacy canvas/retired preset fixtures, plug-ins and scheduler); these have no valid v0.6.1 seeds. Record exact fixtures and outcomes; do not promote the clean lifecycle to coverage it lacks.
10. Close Gen V1; uninstall only the native installation owned by `native-install-owner.json`, using its matching uninstaller or Windows Apps. Do not uninstall another installation. Relocate its default profiles for the manual checks and confirm installation keys/shortcuts/cache are absent. Do not reuse profiles for the historical seed.
11. Follow [the upgrade plan](upgrade-v0.6.1.md), then a separate VM-checkpoint failed-setup run. Never run clean lifecycle after installing a real upgrade baseline.
12. Collect the entire `$out` tree **and linked original directories**. The orchestrator copies summary receipts, not all screenshot/provider trees. Move report rows only after checking hashes and behavior; retain failed attempts and route product bugs. No harness result is release approval by itself.
