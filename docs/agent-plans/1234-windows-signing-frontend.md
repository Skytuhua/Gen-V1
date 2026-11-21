# Plan: Windows installer signing — front-end design spec (issue #1234)

## META

| Field | Value |
|---|---|
| Feature | Front-end surface of "Sign the Windows installer" — update-status copy, signature-failure wording, and all user-facing trust copy |
| Issue | https://github.com/skytuhua-org/Gen-V1/issues/1234 |
| Companion plan | `docs/agent-plans/windows-installer-signing.md` r1 (technical plan; assigns all visual/animation/copy decisions to the front-end team — this document is that decision set) |
| Repo | skytuhua-org/Gen-V1 |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52` (verified by clone) |
| Implementation status | NOT_STARTED. Design/copy spec only; the implementer changes no visual treatment beyond what is written here. |
| Provenance | Front-end team (Devin) for owner S. All file paths, strings and styles below were read from the baseline SHA. |

## OBJECTIVE

The signing feature is almost invisible to users — that invisibility *is* the design goal. The only user-visible surfaces are:

1. **Settings → Updates row and the compact Update button** (`apps/web/src/UpdateControl.tsx`), which render `UpdateStatus.message` strings produced by `apps/desktop/updater.ts` and `apps/desktop/main.ts`.
2. **Markdown trust copy** (README, CHANGELOG, `docs/public/*`) that currently tells users to expect an unsigned installer and SmartScreen warnings.
3. **Windows' own dialogs** (UAC/SmartScreen), which are OS chrome we do not style — their change (publisher name instead of "Unknown publisher") is the payoff, not a design surface.

Success: after signing ships, no user ever reads "unsigned" or is warned to expect SmartScreen for Gen, update failure due to a signature mismatch reads as a safe, specific failure (never a scary crash), and every existing update state keeps identical layout, spacing, type and motion.

## REQUIREMENTS

- F1. **Zero new UI.** No new components, icons, colors, badges, banners, dialogs or motion. The implementer must not add any.
- F2. Copy for **every** `UpdateStatus` state is specified verbatim below, including a new, distinct message for a signature-mismatch rejection (`ERR_UPDATER_INVALID_SIGNATURE`). No other state changes wording.
- F3. The signature-mismatch failure is a **distinct** message from the generic verification failure so the user (and support) can tell "server/file corrupt" from "publisher mismatch". It is displayed through the same `<p role="status">` channel — no special styling.
- F4. Doc copy is updated **only when the first signed release actually ships** (companion plan task T07). Until then the "unsigned prerelease" wording stays true. The strings below cover both the pre-signing state (unchanged, shown for reference) and the post-signing replacement (verbatim).
- F5. Accessibility and motion: the `<p role="status">` live region already announces message changes; keep it. No animation is added, removed or retimed; `prefers-reduced-motion` needs no branch because nothing animates.
- F6. Keep the existing copy voice: one sentence, plain verbs, product named "Gen", no exclamation marks, no technical jargon beyond "publisher", under ~90 characters where the baseline already is.

## REPO_MAP (verified at baseline)

| Path | User-visible content |
|---|---|
| `apps/desktop/updater.ts` | Publishes `UpdateStatus.message` per state: `unavailable` "Install Gen to receive automatic updates."; `idle` "Gen checks for stable updates automatically."; `checking` "Checking for stable updates…"; `current` "Gen is using the latest available stable version."; `downloading` "Downloading the next stable version of Gen." (+`percent`); `ready` "An update is ready. Gen will install it after a safe close."; `failed` "The update could not be verified. Gen will keep the current version."; `installing` "Installing the verified Gen update." |
| `apps/desktop/main.ts` | `deferred` "Finish the current work before restarting to update."; startup-failure `failed` "Automatic updates could not start. Gen will keep the current version." |
| `apps/web/src/UpdateControl.tsx` | Renders `message` in `<p role="status">`; compact button exposes the same message via `title`; fallback error "Updates are unavailable. Gen will keep the current version."; labels "Check for updates" / "Restart to update" / "Update". |
| `apps/web/src/settings.css` | `.settings-row` (padding 10px 0, min-height 56px, 16px gap, 1px `var(--border)` bottom), `.settings-row-copy h2` (14px/600/`var(--text)`), `.settings-row-copy p` (13px/`var(--muted)`, `max-width:60ch`), `.settings-row-control` — all unchanged. |
| `README.md` ~L76 | "The published download is an **unsigned prerelease**…" |
| `CHANGELOG.md` ~L21, ~L31 | "0.6.5 ships as an **unsigned prerelease (preview)**"; "Expect Windows SmartScreen to show a 'Windows protected your PC' warning when installing it." |
| `docs/public/release-notes.md` ~L9, ~L30, ~L40 | "unsigned Windows x64 installer"; same "unsigned prerelease (preview)" line; same SmartScreen expectation line |
| `docs/public/getting-started.md` ~L9 | "It contains an unsigned Windows x64 installer and `SHA256SUMS.txt`." |
| `docs/getting-started.md` ~L159 | "…creates an unsigned per-user Windows x64 installer under `dist/desktop-release-<version>/`" |
| `docs/releasing.md` | Signing-hook section (technical; companion plan edits it, not this spec) |
| `tests/desktop-updater.test.ts`, `tests/desktop-packaging.test.ts`, `tests/release-workflow.test.ts` | Existing assertions; new copy asserted in T-F2 |

## DESIGN

### D-F1. Update-status copy contract (verbatim)

The renderer displays `UpdateStatus.message` verbatim; every state keeps its current string **except** the new signature-mismatch case added in D-F2.

| State | Message (unchanged) |
|---|---|
| `unavailable` | `Install Gen to receive automatic updates.` |
| `idle` | `Gen checks for stable updates automatically.` |
| `checking` | `Checking for stable updates…` |
| `current` | `Gen is using the latest available stable version.` |
| `downloading` | `Downloading the next stable version of Gen.` (UI appends ` NN%`) |
| `ready` | `An update is ready. Gen will install it after a safe close.` |
| `deferred` | `Finish the current work before restarting to update.` |
| `installing` | `Installing the verified Gen update.` |
| `failed` (generic verification/download error) | `The update could not be verified. Gen will keep the current version.` |
| `failed` (updater failed to start) | `Automatic updates could not start. Gen will keep the current version.` |
| `failed` (renderer bridge error fallback) | `Updates are unavailable. Gen will keep the current version.` |

### D-F2. New message: signature/publisher mismatch

When electron-updater rejects an update with `ERR_UPDATER_INVALID_SIGNATURE` (signed install, candidate unsigned or different publisher — companion plan D4), `failure()` publishes:

```
The update was not signed by the expected publisher. Gen will keep the current version.
```

- Implementation hook for the code owner: `downloadUpdate()` rejections are already funneled through `failure()` in `apps/desktop/updater.ts`; inspect the rejection's `code`/`message` for `ERR_UPDATER_INVALID_SIGNATURE` and publish the string above instead of the generic one. No new `UpdateStatus.state` value — it stays `failed`.
- Do **not** surface the expected publisher CN or certificate details in UI copy; they belong in logs only.
- No icon, color or `data-*` attribute is added for this case.

### D-F3. UpdateControl rendering (unchanged, restated so nobody restyles it)

- Full row: `section.settings-row` → `h2` "Updates" (14px/600) + `<p role="status">` (13px, `var(--muted)`, max-width 60ch) + `button.secondary` right-aligned.
- Compact: icon `Download` 16px + label "Update"/"Restart to update"; the status message is only the `title` tooltip — no tooltip redesign.
- Disabled while `checking`/`downloading`/`busy`/`unavailable`; label flips to "Restart to update" only in `ready`. Unchanged.
- No progress bar is added for `downloading`; the text-suffixed ` NN%` stays.

### D-F4. Documentation copy (verbatim replacements, applied at first signed release)

Each edit replaces the sentence about unsigned/SmartScreen status. Filenames of artifacts (`SHA256SUMS.txt`) are unchanged — checksum verification stays as a secondary, optional check.

1. `README.md` L76 →
   > The published download is a **signed prerelease**. Windows shows the publisher name on the install prompt; a new publisher may still see a SmartScreen reputation prompt on first downloads — choose "More info" → "Run anyway" to proceed. Read the release notes before running it. The source tree includes newer workspace and plug-in changes than the installer. The [demo notes](docs/public/media/launch-demos.md) identify which source was recorded.

2. `CHANGELOG.md` — the `unsigned prerelease (preview)` clause → `signed prerelease (preview)`; the SmartScreen expectation sentence →
   > The installer is signed; a brand-new publisher may still see a Windows SmartScreen reputation prompt on first downloads — choose "More info" → "Run anyway".

3. `docs/public/release-notes.md` — L9 `an unsigned Windows x64 installer` → `a signed Windows x64 installer`; the `unsigned prerelease (preview)` clause → `signed prerelease (preview)`; the SmartScreen expectation sentence → same replacement as CHANGELOG.

4. `docs/public/getting-started.md` L9 →
   > It contains a signed Windows x64 installer and `SHA256SUMS.txt`. Windows shows the publisher name on the install prompt; a SmartScreen reputation prompt may still appear on first downloads — choose "More info" → "Run anyway". You can still compare the installer's SHA-256 with that file:

5. `docs/getting-started.md` L159 → `creates a per-user Windows x64 installer under dist/desktop-release-<version>/` (drop "unsigned"; add a parenthetical: `unsigned unless HARNESS_WINDOWS_SIGNING=azure, see docs/releasing.md`).

### D-F5. Motion and reduced motion

- **No motion is introduced or changed.** Message text swaps are instant DOM updates under `role="status"`; there is no fade, slide or skeleton for this row today and none is added.
- `prefers-reduced-motion`: no-op by construction (nothing animates). The implementer must not add transitions to status text.

### D-F6. Edge cases (copy already covers them; do not add states)

- Fresh signed build, first SmartScreen reputation prompt: docs copy above sets the expectation; the app itself never mentions SmartScreen.
- Publisher rename (companion plan D4 risk): signature-mismatch message stays correct ("expected publisher"); runbook, not UI, carries the detail.
- Message overflow: strings ≤ 96 chars fit the 60ch line and wrap under `overflow-wrap:anywhere`; verified longest string is the signature message (95 chars).

## EXECUTION_DAG

| ID | Task | Depends on | Files | Done when |
|---|---|---|---|---|
| T-F1 | Add the signature-mismatch branch publishing the D-F2 string | companion-plan T02/T06 (signing exists) — the branch is dead code until then and may land earlier safely | `apps/desktop/updater.ts`, `tests/desktop-updater.test.ts` | unit test asserts `ERR_UPDATER_INVALID_SIGNATURE` → the exact D-F2 message, all other rejections → generic message |
| T-F2 | Doc copy swaps per D-F4 | first signed release published (companion T06/T07) | README.md, CHANGELOG.md, `docs/public/release-notes.md`, `docs/public/getting-started.md`, `docs/getting-started.md` | grep finds no `unsigned`/`SmartScreen`-expectation wording on release-facing pages; `SHA256SUMS` references kept |
| T-F3 | Regression check on UpdateControl rendering | T-F1 | `apps/web/src/UpdateControl.tsx` (no edit expected), `tests/desktop-updater.test.ts` | no visual/behavioral change to any other state; `pnpm typecheck` clean |

No visual implementation task exists; T-F1 is a one-branch copy addition, T-F2 is prose. Both are single small commits.

## VALIDATION

- `pnpm exec vitest run tests/desktop-updater.test.ts` — new case: driver rejects `downloadUpdate()` with an `ERR_UPDATER_INVALID_SIGNATURE` error → status is `failed` with the D-F2 message verbatim; existing generic-failure cases unchanged.
- `pnpm typecheck` — `UpdateStatus` type unchanged.
- `rg -n "unsigned|SmartScreen" README.md CHANGELOG.md docs/public/` — zero hits after T-F2 except historical release sections explicitly labeled with their (unsigned) version number, which must not be rewritten (v0.6.1/v0.6.5 notes stay factual about those builds).
- Manual on Windows (release verification, companion plan): downloaded signed installer shows the publisher name; a signature-mismatched update renders the D-F2 message in Settings → Updates.
- Not run in planning: no code executed; this spec is prose.

## STATE

- Researched + decided: every string and file above (read at baseline SHA).
- Pending: T-F1 (code owner), T-F2 (release-time doc edit), T-F3.
- Next step: implementer of companion plan picks up T-F1 alongside T02; T-F2 runs at T07.
- Risks: none visual; the only copy risk is rewriting historical version notes — explicitly excluded above.

## REFERENCES

- Issue + technical plan r1 (assigns design/copy to this team): https://github.com/skytuhua-org/Gen-V1/issues/1234 and `docs/agent-plans/windows-installer-signing.md`
- electron-updater `ERR_UPDATER_INVALID_SIGNATURE` behavior: companion plan REPO_MAP/D4.
