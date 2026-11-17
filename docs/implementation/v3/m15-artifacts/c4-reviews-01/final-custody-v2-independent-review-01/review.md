# Final-custody v2 independent review

## Disposition

No material defect was found in the narrow v2 extension at SHA-256 `facae1b76710059ef7bf4c2c50c0642acf91d318dba18446e24100aaa3083634` (14,618 bytes). The complete original helper, candidate, patch and proposal were read. The original remains byte-identical at `1dc96315cf9bda333adcc810e1d7516996789a781543654aee9d2fcfbbafb419` (10,456 bytes).

Python AST parsing and an in-memory exact diff comparison passed. Removing only the declared additions, parent guard replacement, published-tree loop source and output fields reproduces the complete original helper byte-for-byte. Neither helper was executed. No test, repository or index changes occurred.

## Narrow parent exception

The required arguments pin the tested-context parent to eeda and the separately supplied publication parent to 98. Local HEAD must remain eeda. The exact parent sequence requires 98 to have one parent, eeda; an additional ancestry check remains. The comparison uses all paths from both Git trees with their mode, kind and blob identities. Exactly `docs/implementation/v3/M15-source-cut.json` and `docs/implementation/v3/M15-validation-summary.json` may differ. This is not a generic documentation or source-drift exemption.

The dedicated archive manifest is pinned to SHA-256 `37ea9450c8c2667eb2d8ae409c2ca6c6851257c0be64778aed98698bb2fe4954`. The helper checks its schema, source and previous commits, source tree, exact ordered two-row membership, empty product delta and false new-execution marker. Destinations must be the canonical archive paths, have no symlink ancestors and be regular files with the expected Git executable mode. Every row must match the Git mode/kind/blob, recorded size and SHA-256, and the exact published Git bytes. The two archived metadata files remain historical bytes rather than an invented new validation.

## Preserved checks

All six original full-archive checks are unchanged, including their exact source membership and canonical destinations. Original checkout cleanliness, accepted b4aa ancestry, unfinished-merge/index refusal, lockfile and ordinary CI hashes remain. Nonmanifest source membership and kind/mode/size/digest continuity are unchanged. The tested public-manifest preimage still binds to the unique cut row; the final runtime array must match it exactly and retain 228 entries. Schema, sorted/unique/canonical paths, runtime subset, prior admission preservation, public admission contract and every changed-path admission check remain.

The published log/artifact check now reads the 98 tree while retaining its index mode/blob, regular-file mode and worktree-byte assertions. The exact two-path tree comparison proves that those retained evidence paths did not change between eeda and 98. The original whitespace check remains scoped identically. Output distinguishes the tested-context head, publication parent and two-file metadata archive from the six full archives.

The tested-cut digest is still a required caller-supplied value, as in the original helper. It is not newly hardcoded. The approved execution must supply final03 SHA-256 `0c4ceab16a33448876d38b5a3d4e1877c0adf7d267cb587dfa60853db21ff260` and its exact tested public-manifest preimage. The existing checks then require the cut head to equal eeda and its accepted base to equal b4aa. No current source check is redirected to the incoming generated historical source-cut file.

## Limits

Checker execution remains **NOT_RUN** in this review. Final custody success, publication lease/API success and product/platform acceptance require their own observations. Any other published parent or incoming path is rejected by this pinned extension and requires a new review. The companion JSON records exact inputs and the static preservation check.
