# Curated summary — installed-verification.json (receipt: full verifier output preserved out of source)

- createdAt `2026-11-18T17:28:21.297Z`; version `0.6.5`; nsisGuid `f973205b-ac9b-56c0-baad-730abd2ca4b3`
- setup `<runner-workspace>\.harness-installed-package\desktop-release-0.6.5\Gen-V1-Setup-0.6.5-win-x64.exe` sha256 `afa42167eac4af0dad6651043237da3cc2b6b68bc29c0d810056f9da35d87753`; installDirectory `<runner-workspace>\.harness-app-63bc18c23122`; expectedUnpacked `<runner-workspace>\.harness-installed-package\desktop-release-0.6.5\win-unpacked`
- scope: Owned temporary per-user installation, exact payload/provider custody, two personal installed executable launches per requested phase with local recovery, and identity-bound uninstall. No sign-in, credentials, inference or user-profile adoption.
- flags: inference `False`, auth `False`, memoryRetentionRequested `True`, memoryEnabledRequested `True`
- launches (4): iter 1 default-off pid 2500 ready 26325ms owner True exit 0 passed True; iter 2 default-off pid 6428 ready 7160ms owner True exit 0 passed True; iter 1 enabled pid 8956 ready 7213ms owner True exit 0 passed True; iter 2 enabled pid 8772 ready 6915ms owner True exit 0 passed True
- **passed: `True`**
- expectedPayload: 92944 files / 2577916985 B, sha256 `a8ff5f5f0ef9c8116ff2d551bece0b2671c2920678bc17f6c5bf8fc24ddbcea5`
- payloadCustody: matches `True`, 92944 files, sha256 `a8ff5f5f0ef9c8116ff2d551bece0b2671c2920678bc17f6c5bf8fc24ddbcea5`
- providerVerification.passed `True`; installCommand exit `0` (512884ms)
- installedRegistry: 4 HKCU entries (install+uninstall keys, DisplayVersion `0.6.5`, paths redacted)
- cleanup: `uninstalled-owned-installation`, uninstall exit `0` (14397ms), cache `removed-owned-exact-file` sha `afa42167eac4af0dad6651043237da3cc2b6b68bc29c0d810056f9da35d87753`, shortcuts/keys/processes `absent`/`absent`/`absent`
- Original sha256: `6b0ccde44e8d73657734dcc17889a212c0ce60f396226b6d692b21351f62ed54`
