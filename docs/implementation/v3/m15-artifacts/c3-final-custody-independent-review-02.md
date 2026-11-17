# C3 final custody validator: correction review 02

Re-read the complete revised private `final-custody.py`: 4,593 bytes, SHA-256 `4e23860a208430b0c3b284fb68cb5f7226637a37d9c1e9a9382712690471da00`. The prior review remains sealed at `c3-final-custody-independent-review-01.md`, SHA-256 `92fce4f08ff254527dd446d7834ea62ad48468734162e11e3a9d8f0884369b81`.

Both reported validator gaps are closed in the reviewed source.

The archive check now derives the exact sorted top-level M15 path set from each immutable published commit, compares the entire supplied source-path list with it, requires the canonical archive destination beneath that publication cut, and requires a regular archive file via `lstat`. Combined with the existing immutable byte comparison, this prevents duplicate-row counts, omitted required rows, arbitrary source substitution, outside-directory destinations, and leaf symlink substitution from satisfying this check. The intended 16 and 17 expected path sets were independently verified in review01.

The retained evidence check now builds the current stage-zero index mapping and requires each of the 709 parent evidence paths to retain its exact indexed mode and blob ID. It also requires the current working file to be regular, requires its executable state to agree with the Git mode, and retains the immutable blob-content comparison. An immutable metadata read confirms all 709 published entries have mode 100644; the revised current-file check therefore rejects any execute bit on this actual retained set. Missing or changed indexed entries fail closed.

The fixed HEAD/MERGE_HEAD, original checkout, dependency lock, ordinary CI, public source admission, and authored whitespace checks remain present. The current public manifest was read at SHA-256 `d3008bd88c5343ec56403e53d1bcf85f2e95193420675a0c886790724cb6678c`: 3,041 source entries and 216 runtime entries. Both `tests/agents-workspace-composer.test.ts` and `tests/agents-workspace-dispatch.test.ts` are admitted as source and absent from runtime. This metadata observation does not substitute for the root controller's content review of those tests.

No further material defect was found in this bounded static review. The validator was not executed by this reviewer. No repository source, index, documents, tests, or publication state were changed. This review establishes what the current validator checks; the actual final custody run and the separate frozen-index publication validation still determine the resulting evidence and Git-tree status.
