# C4 final custody checker correction review

No remaining material defect was found in the corrected checker at SHA-256 `1dc96315cf9bda333adcc810e1d7516996789a781543654aee9d2fcfbbafb419` (10,456 bytes). The full intermediate correction `412a38d91ad3a9dada9edbdf4b0f4c43e519b9310bc2c7452da674affd896682` was read; the final change adds only explicit integer type guards for both version fields. Removing that exact addition reproduces the intermediate hash. The final Python source parses statically. The helper was not executed.

The first-cut findings in final-custody-review-01 remain preserved. They concerned what the checker could accept, not observed archive loss.

The six archive source sets are now exact: immutable top-level M15 documents plus the explicitly named historical receipt/log pairs, with counts16,17,18,34,20,22, totaling127. Each destination must equal the canonical path derived from its source, with no symlink parent and a regular destination file. Published source bytes and optional Git identities are still compared.

Public runtime admission is now tied to the tested input, rather than only its count. The required tested-public-manifest preimage must hash to the unique public manifest row in the hash-bound tested cut. The final runtime array must match that preimage exactly and contain228 entries. The inspected backup is SHA-256 `f9cb5f536f5808fbb741ac5c57b2f0511ee29da35653fa68a71f634b3b18c9fc`, with3,275 source entries and228 runtime entries. These are backup counts, not a final publication count.

The JSON schema is limited to version/source/runtime, both versions must be numeric integer1, paths must remain sorted, unique and canonical, runtime remains a source subset, and prior source admissions cannot disappear. Thus the intentional post-test metadata additions do not authorize a runtime membership swap.

The checker retains exact dynamic parent/base ancestry and tested-cut binding, original checkout cleanliness, accepted lock/ordinary CI hashes, all parent-published log/artifact index+mode+blob+worktree checks, full nonmanifest source membership/bytes/modes, explicit changed-path admission and scoped whitespace. No product source, journal policy, source authority or native guard changes were made for these corrections.

This is a bounded static review, with checker execution **NOT_RUN**. The root controller still must run it against the final parent and final tested cut. It does not establish current product, browser, native Windows or publication transport success.
