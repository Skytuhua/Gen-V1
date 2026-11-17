# C3 final custody validator: independent read-only review 01

## Scope and disposition

Reviewed `final-custody.py` in full at SHA-256 `921ed5075f5c2fef4374e5fbb5ec7299c2a8b3af8bf262e4e05fc1685dd85eea` (3,541 bytes). This is a static review plus read-only comparison of archive path sets with immutable Git trees. The validator itself was not executed. No repository source, index, documents, tests, or publication state were changed.

The current archive manifests have the intended complete 16 + 17 unique path sets and canonical archive destinations. Two validator completeness gaps remain. Neither finding establishes an observed loss or mutation of the current archived evidence.

## Finding 1: archive count does not establish exact archive membership

The archive loop checks `len(manifest['files']) == count`, then checks each supplied row's bytes against its supplied immutable source path. It does not require distinct source paths, the expected source path set, distinct destination paths, or the canonical destination beneath the corresponding publication-cut directory. A manifest containing repeated valid rows could satisfy the 16/17 count while omitting other intended documents. A row pointing to a matching copy outside the archive directory could also pass.

The current manifests were compared with all top-level `docs/implementation/v3/M15-*` paths in their stated immutable commits:

| Cut | Published commit | Expected paths | Actual distinct paths | Missing or unexpected | Canonical destinations |
| --- | --- | ---: | ---: | --- | --- |
| 01 | fd17d9f1b3931eb2b974b86ccc5a3892da47ba33 | 16 | 16 | None | All |
| 02 | a1349b0a7ffa1420566da9c7770faf80d6be5bf3 | 17 | 17 | None | All |

The validator should enforce that same immutable expected path set and require each archive destination to equal the corresponding `publication-cut-N/<source basename>` path. Merely checking that every supplied row is valid does not prove that every required row was supplied.

Cut01 manifest: 4,977 bytes, SHA-256 `cbfec9a180b422c158118a71301e02c1b6bf9c7dabaebc49f1cb231a9bbb07a7`.

Cut02 manifest: 5,303 bytes, SHA-256 `bbe177e524cbb19a98f563427c7e71f9eaa81307cd212e37ee6856ef787e48a1`.

## Finding 2: retained evidence check proves bytes, not current mode or file type

For the 709 parent evidence entries, the loop verifies that the parent entry is a regular Git blob with mode 100644 or 100755, then compares current `Path.read_bytes()` content against that immutable blob identity. It does not compare the current file type or mode. `read_bytes()` follows a symlink, so a same-content symlink or an executable-bit change can pass this particular check.

The output can accurately report unchanged content after a successful run. It should not be treated as independent proof of unchanged path mode or regular-file custody. A regular-file check using `lstat` and an appropriate current mode comparison would close that gap for this working-tree check.

This gap is separately covered at publication by the reviewed C3 `prepare-payload.py` function `validate_retained_evidence`, which requires equality of the complete indexed `Entry(mode, kind, sha)` for every published log/artifact path. That stronger indexed check must still run against the actual final publication index. This review does not substitute for it.

## Other reviewed invariants

The script requires the intended a134 HEAD, accepted49 MERGE_HEAD, zero unresolved index entries, the original checkout's fixed HEAD and clean Git status, the locked dependency digest, and the ordinary CI digest. It requires sorted unique public source/runtime arrays with runtime contained in source, and checks current tracked differences plus untracked nonignored paths against source admission. It also runs the authored whitespace check while excluding retained logs/artifacts.

These are checks of current working-tree state, not a promise that a later index or payload remains identical. The final copied-index publication helper is the separate authority for the emitted Git tree and retained indexed evidence.

The root controller has independently identified two existing changed tests absent from the allowlist and is reviewing their admission. This review does not override that failing check or mark it passed. No test, browser, Windows, Edge, full-custody execution, or publication result is claimed here.
