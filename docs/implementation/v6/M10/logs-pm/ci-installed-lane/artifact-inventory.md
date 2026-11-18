# CI installed-lane artifact inventory — ff38c62c3b0f8856e08f528f3c2ea8b1c1fea199

Authenticated GitHub Actions API queries performed 2026-11-18 (token from local git credential store; not committed).

## Query chain

1. `GET /repos/skytuhua-org/Gen-V1/actions/runs?head_sha=ff38c62c3b0f8856e08f528f3c2ea8b1c1fea199`
   → 48 runs, all `CI queue guard` (`workflow_run` events) — none carry build artifacts.
2. `GET /repos/skytuhua-org/Gen-V1/actions/workflows/ci.yml/runs?head_sha=ff38c62c...`
   → 1 run: **`44356008329`** `CI` / `push` / completed **success** / created 2026-11-18T17:12:19Z.
3. `GET .../runs/44356008329/jobs` → 9 jobs, all success, including:
   - **`134984166865` `Installed desktop memory retention and opt-in`** — success, 17:12:21→17:41:12Z (~29 min, windows-latest).
   - `134984166429` Desktop build — success.
   - `134984166788` Windows checks — success.
4. `GET .../runs/44356008329/artifacts` → 2 artifacts:
   - **`14455070587` `installed-memory-44356008329-1`** — 1,797,843 bytes (this directory's zip, byte-identical download).
   - `14451909340` `browser-44356008329-1` — 4,205,971 bytes.

## Exact artifact gap (named, per manager decision)

The declared installed lane at this cut **does not upload the binary pair**. Artifact
`installed-memory-44356008329-1` contains only receipts and screenshots:
`build-manifest.json`, `PYTHON_INSTALLATION_V2.json`, `owner.json`, `verification.json`,
packaged-providers `verification.json`, ~20 PNGs. **`Gen-V1-Setup-0.6.5-win-x64.exe`
(477,528,078 bytes) and `win-unpacked/` are not retained** — the job installs, verifies,
and uninstalls on the ephemeral runner. Therefore no downloadable exact-cut pair exists to
feed `scripts/verify-installed-desktop.ts` on a reachable box; local packaging was not
rerun (prior UNSUPPORTED_ENV_STALL record preserved).

## Compatible installed lane that DID run at the cut

The `Installed desktop memory retention and opt-in` job itself executed the declared
installed verifier end-to-end at `head_sha=ff38c62c`:

- `desktop:package` produced `Gen-V1-Setup-0.6.5-win-x64.exe`, sha256
  `afa42167eac4af0dad6651043237da3cc2b6b68bc29c0d810056f9da35d87753` (build-manifest.json `files`).
- `installed-memory-retention` invoked `verify-installed-desktop.ts` with that job's own
  declared flags `--project-memory-retention --project-memory-enabled` → `passed: true`.
- Installer: 512,884 ms, exit 0 (installerObservation).
- 4 owned personal launches, all `passed`, `verifiedOwner: true`, `exitCode: 0`
  (pids 2500/6428 memoryMode `default-off`; pids 8956/8772 `enabled`) — includes the
  default-off lifecycle the M10 lane exercises.
- `payloadCustody`: `matches: true`, 92,944 files, 2,577,916,985 bytes,
  sha256 `a8ff5f5f0ef9c8116ff2d551bece0b2671c2920678bc17f6c5bf8fc24ddbcea5`
  (the win-unpacked manifest identity).
- `providerVerification.passed: true`; packaged-providers run receipt `passed: true`.
- `cleanup`: `uninstalled-owned-installation`, uninstall exit 0 (14,397 ms); cache
  `removed-owned-exact-file` matching setup sha256; shortcuts / installationKeys /
  nativeProcesses `absent`.
- Registry: HKCU install + uninstall keys (DisplayVersion 0.6.5, both views) — real NSIS install.
- `inference: false`, `auth: false` — no credentials/inference in the lane.

## Files in this directory

| File | sha256 | Content |
|---|---|---|
| `installed-memory-44356008329-1.zip` (not committed per CONTRIBUTING shared-evidence rules — raw bundle retained locally at `/home/piadmin/m10-evidence-local/`; re-fetchable from artifact id `14455070587` while within its 7-day retention, expiry ≈ 2026-11-25) | `e61b74779107aba45efcdaad236cc823c5274538adb99e2c4bd47439ec935c54` | Byte-identical GitHub artifact download (provenance object; digest + artifact id recorded) |
| `build-manifest.json` | `3be1b2988f2d6bb60489c9b423728e9f07614899b3b898b59ad322708b55e30b` | Package manifest incl. Setup.exe sha256 |
| `owner.json` | `4c7e4e5e1e40751173a44bf22fb5c8bf7653e6bfc04c1fdfa268f626beffbc06` | Install ownership + setup sha256 |
| `installed-verification.json` | `6b0ccde44e8d73657734dcc17889a212c0ce60f396226b6d692b21351f62ed54` | Full verifier receipt, `passed: true` |
| `packaged-providers-verification.json` | `c1f8f51a11fa9a9a89c16685823a4a5bc4ed185433259442fbf1872e44bd1461` | Provider custody receipt, `passed: true` |

## Honesty notes

- This is the **installed-memory lane's own run** (its declared flags include memory
  activation for its enabled-mode phase). It is evidence that the installed lifecycle
  — install → owned launch → identity revalidation → UI acceptance → uninstall — passed
  at the exact cut on a healthy Windows host. It is **not** a re-run of the M10 no-flag
  invocation on WIN-M0N0V07LGM1, and it does not erase that box's
  `UNSUPPORTED_ENV_STALL` record.
- No pass is inferred from packaging CI alone: the receipts above are the verifier's own
  output from the run, provenance-bound via run/job/artifact IDs and `head_sha`.
