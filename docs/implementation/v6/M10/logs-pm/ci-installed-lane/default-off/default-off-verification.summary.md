# Curated summary — flag-less installed verification (workflow_dispatch 44414623739, artifact 14482448945)

Raw JSON removed per CONTRIBUTING; preserved byte-for-byte out of source.
Bound to tested SHA `f8a4ac69ceb415b1be32d869a90093875805609b` (CI job `135191550723`
`Installed desktop memory retention and opt-in`, step `Verify installed default-off
acceptance`, completed success 2026-11-18T23:39:47Z→23:47:03Z).

- createdAt `2026-11-18T23:39:49.523Z`; version `0.6.5`; nsisGuid `f973205b-ac9b-56c0-baad-730abd2ca4b3`
- setup `Gen-V1-Setup-0.6.5-win-x64.exe` sha256 `476b2a6e27cd580cfa103838165cce093496ecd6edd1f9fe7cdbe6694a243fcc` (build-manifest, owner.json and verification.json agree; 477509897 bytes — packaged from the tested SHA's own cut, distinct from the ff38c62c build `afa42167…`)
- installDirectory/expectedUnpacked: `<runner-workspace>` paths (redacted)
- flags: inference `False`, auth `False`, memoryRetentionRequested `False`, memoryEnabledRequested `False` — flag-less invocation confirmed
- launches (2): iter 1 personal memoryMode `None` pid 6804 ready 5910ms verifiedOwner `True` exit `0` passed `True`; iter 2 personal memoryMode `None` pid 9960 ready 5072ms verifiedOwner `True` exit `0` passed `True`
- **passed: `True`**
- installCommand exit `0` (333883 ms); expectedPayload 92944 files sha256 `027edc9871e50ad10e2fa12c572e6cc9b5dc944b9f91ad440efe6df7bd366e39`
- payloadCustody matches `True` — 92944 files / 2577913719 B sha256 `027edc9871e50ad10e2fa12c572e6cc9b5dc944b9f91ad440efe6df7bd366e39`
- providerVerification.passed `True` (receipt in artifact)
- installedRegistry: 4 HKCU entries (paths redacted)
- cleanup: `uninstalled-owned-installation`, uninstall exit `0` (9242 ms); cache `removed-owned-exact-file` sha `476b2a6e27cd580cfa103838165cce093496ecd6edd1f9fe7cdbe6694a243fcc`; shortcuts/installationKeys/nativeProcesses `absent`/`absent`/`absent`

## Qualification boundary (manager-declared)

This receipt qualifies the **generic default-off installed lifecycle only**
(install → owned default-off launches → identity revalidation → UI acceptance →
custody → uninstall). It does **not** qualify M10's installed supervisor,
reconnect/cancel or native fork — those holds stand.

## Source-object digests

- artifact zip `installed-memory-44414623739-1.zip` (id `14482448945`, ~7-day retention): sha256 `f54484ce95d8bc63c2c8176f55fb879c349eb6f9fe846b1ba92fa94c77ac7083` — retained out-of-source
- `.harness-desktop-installed/run-1795045189522-f874c01a-c417-45fc-9c70-151ccd01c7b2/verification.json`: sha256 `b19abe20d61499afa273c6fdec283b263ab247ac34f2d88e1c7739d549ec9e5d`
- `.harness-desktop-installed/run-1795045189522-f874c01a-c417-45fc-9c70-151ccd01c7b2/owner.json`: sha256 `52b52758089a789eb57ff936ba58ce0976c863df20afd3c3b1aa6ae05d24abcd`
- build-manifest.json: sha256 `b430f14d33a5f762ab57398f48c437c9fbedd3d300fcddc1d702edbdf8510b85`
- memory-flag run receipt `.harness-desktop-installed/run-1795044607506-8de2c5d8-9c60-448a-b28d-8233b855f811/verification.json`: sha256 `799b952705963e2cf101c86012e53d27401fe4f2007f84082bf6bed0f507a4d1` (memory lane also passed on this cut)
