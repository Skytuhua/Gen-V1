# Installed v0.6.1 to 0.6.5 upgrade

## Preconditions and order

Complete clean-install lifecycle and native review first; see [checklist](checklist.md). Use a disposable VM snapshot and empty default profiles. The harness refuses nonempty profiles rather than overwriting a user's data. There is no historical updater, so this is setup-over-install, with no rollback promise.

Create a separate clean historical worktree (outside the review repo), at the exact `v0.6.1` tag, and install its frozen dependencies there. The seeder imports **that worktree's** `Store`, `taskFixture` and account-profile derivation. Do not copy main-only schema objects into it. Record historical HEAD and dependency setup. A prior profile can instead be restored manually on a checkpoint, but automatic seeding intentionally requires empty profiles.

```powershell
git worktree add --detach C:\gen-rc\source-v061 v0.6.1
corepack pnpm --dir C:\gen-rc\source-v061 install --frozen-lockfile
corepack pnpm exec tsx scripts/rc-review/run-rc-review.ts --phase upgrade --out $out --install C:\gen-rc\upgrade-065 --v061-worktree C:\gen-rc\source-v061 --allow-install disposable-vm
```

`$out` must already contain the clean lifecycle receipt and candidate `rc-build.json`. Upgrade phase verifies the baseline setup against `C:\gen-rc\baseline\v0.6.1\SHA256SUMS.txt`, installs baseline, seeds real default profiles, types two native unsent drafts over owned CDP, resizes the main window, quits cleanly, snapshots, installs candidate over the same destination, snapshots again, compares and runs native visibility checks. No live credentials are generated.

To reuse the prepared historical baseline after clean-install qualification, supply `--profile-archive C:\gen-rc\baseline\v0.6.1\profile-archive` instead of `--v061-worktree`. Upgrade installs v0.6.1 first, verifies every archived file's SHA-256, restores only into empty profile roots, and compares the restored files/entities/identifiers exactly against the archived pre-upgrade manifest before running candidate setup. Account profiles are included under the archived host root. `seed.json`, `restored-manifest.json` and `restore-compare.json` are retained in `$out`; corrupt archives or nonempty destinations fail closed.

Archive/restore standalone commands (application and host must be stopped):

```powershell
corepack pnpm exec tsx scripts/rc-review/profile-archive.ts archive --archive C:\gen-rc\baseline\v0.6.1\profile-archive --seed "$out\seed.json" --manifest C:\gen-rc\baseline\v0.6.1\pre-upgrade-manifest.json
corepack pnpm exec tsx scripts/rc-review/profile-archive.ts restore --archive C:\gen-rc\baseline\v0.6.1\profile-archive --install $install --out $out
```

Manual equivalents (for diagnosis, not bypassing custody):

```powershell
corepack pnpm exec tsx scripts/rc-review/seed-v061-profile.ts --v061-worktree C:\gen-rc\source-v061 --exe "C:\gen-rc\upgrade-065\Gen V1.exe" --out $out
corepack pnpm exec tsx scripts/rc-review/profile-manifest.ts snapshot --install C:\gen-rc\upgrade-065 --out "$out\before"
# Run the hash-verified 0.6.5 setup over the SAME install location, then snapshot before boot.
corepack pnpm exec tsx scripts/rc-review/profile-manifest.ts snapshot --install C:\gen-rc\upgrade-065 --out "$out\after"
corepack pnpm exec tsx scripts/rc-review/profile-manifest.ts compare "$out\before\profile-manifest.json" "$out\after\profile-manifest.json" --out $out
corepack pnpm exec tsx scripts/rc-review/upgrade-check.ts --seed "$out\seed.json" --exe "C:\gen-rc\upgrade-065\Gen V1.exe" --out $out
```

Snapshots include IndexedDB and Local Storage, excluding named Chromium cache directories. Entity bodies are hashed, never copied into the report. Changed existing bodies fail conservatively; additions in new kinds are classified separately. Snapshot while application/host are stopped. Take a further post-boot snapshot for manual migration review if needed. Comparison success alone is not UI visibility proof.

## Identifiers that must not change

- appId: `local.generativeharness.desktop` (installed metadata, or the corresponding installed HKCU NSIS key with matching InstallLocation; snapshot refuses absent/mismatched identity).
- userData: `%APPDATA%\GenerativeHarnessDesktop`; Chromium session: its `session` directory; retain origin/ports for IndexedDB drafts.
- Host: `%LOCALAPPDATA%\GenerativeHarness`, including `harness.sqlite` and runtime-owned files.
- Account profile directories: `accounts\provider-auth-<tuple-hash>`; compare exact names, not labels.
- Same per-user installation and executable/product identity, Gen V1.

## Per-store results

Every result begins Unverified. N/A stores require separate newer-schema clean-install retention evidence, not historical fabricated seeds.

| Store | v0.6.1 present? | Seeded | Survived | Evidence |
|---|---|---|---|---|
| Threads/messages | Yes | Unverified: three synthetic threads | Unverified | |
| Artifact accepted state | Yes | Unverified: three values | Unverified | |
| Drafts | Yes | Unverified: two native composer drafts | Unverified | |
| Native/local shell layouts | Yes | Unverified: move/resize native main | Unverified: CDP geometry assertion plus manual inspection | |
| Thread memory + revision | Yes | Unverified: taskMemory/memoryVersion | Unverified | |
| Settings | Yes | Unverified: dark theme | Unverified | |
| Account metadata/directories | Yes | Unverified: disabled synthetic account | Unverified | |
| Runtime credentials | Yes | No real tokens | Unverified; synthetic metadata is not login proof | |
| Workspace saved layouts/canvases | No | N/A | N/A; separate clean review | |
| Retired Code Review preset | No | N/A | N/A; separate clean review | |
| Plug-ins/extensions | No | N/A | N/A; separate clean review | |
| Durable scheduler | No | N/A | N/A; separate clean review | |
| Project memory | No (thread notes exist) | N/A | N/A; clean retained-memory run | |
| DPAPI environment secrets | No | N/A | N/A; installed Settings round-trip | |

## Failed-setup variant (separate restored checkpoint)

Restore a VM checkpoint with **installed, seeded v0.6.1** and the same candidate evidence. Do not run this on the successfully upgraded installation. Do not implement a harness rollback that would hide product failure.

```powershell
corepack pnpm exec tsx scripts/rc-review/run-rc-review.ts --phase failed-setup --out $out --install C:\gen-rc\upgrade-065 --interrupt-ms 1000 --allow-install disposable-vm
```

The variant kills its owned setup process tree at the chosen elapsed time, refuses to count setup completion before interruption as a tested failure, checks version still 0.6.1, then launches it over owned CDP and requires a clean exit. Check seeded records/drafts manually afterward. Save timing, logs, screenshot and `failed-setup.json`; one timing is not atomicity proof. If v0.6.1 cannot launch, report a failed recovery/product bug, preserve the VM, and restore a checkpoint only for the next experiment.

| Attempt / interruption point | Baseline launches | Seed retained | Evidence | Result |
|---|---|---|---|---|
| Not run | Unverified | Unverified | | Unverified |
