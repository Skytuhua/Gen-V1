# Bounded review admission safety review

The exact134-file admission is acceptable under the root's fixed-report-path condition. This is **not generalized approval** of the sealed helper for arbitrary arguments. The helper remains unchanged at SHA-256 `7e443d3f85bba57bea8a052c17991a1dcd76ba79c74d23a3cd424b54e5d91d8f`; the reviewed manifest remains `148aae6ebca4aee6295598ce98acf53e8280dec80ae0d55f1339aef20a71da2f`.

The complete helper, all134 manifest entries and roles, readable admission summary, README and retained preflight were read. The manifest selects1,163,319 bytes, all regular0644 UTF-8 text files:133 under c4-reviews-01 plus the single approved upstream-M05 dependency-review destination. Only the three intentional `.ts`/`.mts` adapter pairs have identical content. No broad directory copy is performed.

## Retained helper finding and exact-call condition

The helper's report path uses Path.absolute and lexical containment, and checks only the immediate report parent for a symlink. Parent traversal or an ancestor symlink can therefore evade its general outside-repository promise. Root retained the sealed helper and narrowed the actual call to:

`/workspace/scratch/1b47eb428672/m15-publication/c4/review-admission-01/application.json`

The required caller checks are that the absolute path equals its resolved path, no ancestor is a symlink, the resolved path is outside the repository, and the report does not already exist before invocation. The currently observed fixed path meets the canonical/outside/no-symlink conditions; its existence is expected after root's application. The finding remains open in the general helper and is mitigated for this exact controlled invocation.

The artifact destinations themselves are canonical and restricted to the two explicit evidence roots. The helper verifies all selected source hashes, sizes and modes before copying, rechecks destination absence, creates exclusively without following a final symlink, verifies written bytes, and checks HEAD/index afterward. It contains no staging, commit, publication or source-manifest edit command. Failure cleanup removes only created files still matching expected bytes; this is intentionally fail closed, not a transaction that guarantees removal of every partial file.

## Observed root application and independent readback

During this review the root completed application. Its outside report says APPLY/PASS with134 new files,1,163,319 bytes, unchanged index/HEAD and no remote mutation. I independently read every source and copied destination and confirmed all134 hashes, sizes, regular-file types and0644 modes match the sealed manifest. Every target stays under the declared roots with no symlink ancestor. Current HEAD and index hash also match the application report. Exact identities are recorded in review.json.

I did not execute the helper, run tests, stage files, or mutate the repository. This copy verification does not reapprove all historical conclusions, replace a full private-content audit, or establish product/browser/native/packaging/publication success. The unchanged general report-path finding must remain visible with this bounded result.
