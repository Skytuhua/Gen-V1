# C4 publication helper static review

No material defect was found in the exact C4 helper change. Both complete files and their full diff were read. The review did not execute either helper, generate a payload, run tests, inspect or change the final staged tree, upload objects, or publish a commit.

| Source | SHA-256 | Size |
| --- | --- | --- |
| C3 predecessor | `8f74b038122602759439ebeccc68da253db0d3b73092b178d48ef58c4c2f92dc` | 39,289 bytes, 591 lines |
| C4 reviewed helper | `605f8233c54c7d91c7051d3c61b2996a6d2486a9d03a50c03504edcb3eed3945` | 39,314 bytes, 592 lines |

The accepted base changes from49 to `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`. Observed main109 remains unaccepted. The publication contract changes from two parents to the supplied published parent alone. `prepare` now requires b4aa to be an ancestor of that parent before reading the parent/base trees or planning objects. A nonzero ancestry result fails through the existing checked Git runner. Manifest production and `publication_from_manifest` both require `additionalParents: []` and matching single-parent commit parameters. The measured parent tree and supplied expected final tree checks remain.

The remaining changes are C4/history labels and argument help text. Static AST comparison records unchanged and changed declarations in `review.json`; it does not execute application code. The copied-index/external-object Snapshot implementation, command/status validators, tree encoder, object transport planner and payload verifier are unchanged.

The helper still rejects unresolved index entries, hidden index flags, source/worktree drift and a final index tree mismatch. It reconstructs the exact Git tree, reads blobs from the copied index, validates the complete indexed evidence/source manifests against the accepted base, preserves the inactive/unapproved manifest, checks receipt/log digests and actual phase results, and retains every prior published log/artifact with exact path, mode, type and blob identity. It does not rewrite FAIL evidence into successful evidence.

Transport remains byte preserving: known parent/base blobs are referenced; new bounded UTF-8 text is round-trip checked; binary or larger content uses verified base64; mode changes and deletes are explicit; aliases follow blob creation. Every bounded tree request has a predicted tree, and verification recomputes the entire chain against both the supplied final tree and the copied index entries. The real index bytes and HEAD are rechecked before the outside payload directory is sealed.

This review is limited to source correctness of the helper and its C3-to-C4 delta. It is not a C4 helper execution result, remote object acceptance proof, product approval, or full custody result. The root controller still supplies and verifies the final reviewed staged tree and fresh published parent/tree. Concurrent remote branch movement, immutable archive/public-admission/original-checkout checks and actual API publication remain separate gates. Prior C3 execution evidence is not a C4 runtime pass.
