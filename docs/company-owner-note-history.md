# Owner-note history: data-only consumer

Gen validates the additive `maritime-owner-note-history` file contract. The decoder
is a data consumer; the separate opt-in [trusted owner-host TLS client](company-owner-history-read.md)
now reuses it for one implemented same-host read. There is no registered CLI or
browser route or communication view. The issued file-contract pin below is unchanged.

| Pin | Exact value |
| --- | --- |
| Issued candidate checkpoint | `24ff923dae78e5701447b687620b18c3c713c573` |
| Raw manifest SHA-256 | `26fd87d8b2065a1546f905963c8c0ebdc06f7a4783dd10993f94d83bb85a5f54` |
| Raw schema SHA-256 | `56810ef076b97563bce763eba05bb55fb6f60aa5f76a960eae92c3628680ad74` |
| Raw goldens SHA-256 | `f0afeb4ba60c5c11bfcd9c02f5c51d240ce7043351a5d5f9984ff80c7ea239e5` |
| Producer file-contract receipt SHA-256 | `db8d389e41144467f231e2886846b63db8b4c0c039754df7ac2aec0c690e9d28` |
| Query-binding clarification checkpoint | `966995529a306bfa93e6997667041605909ba711` |
| Query-binding document SHA-256 | `eee615c1cf50824598dcf950cf4be2bf56612aa3e3f36e74930968e8bb240089` |

The three raw files match committed producer blobs and have exact-path `-text`
attributes. The frozen `bdfbaae` record schema and all older protocols are unchanged.
These pins describe reviewed source files, not running-server negotiation.

## Consumer boundary

[`validateOwnerNoteHistory(raw, expectedContext, expectedLimit)`](../packages/company-contracts/communications/history.ts)
requires raw bytes, independently permitted company/project context, and a separately
retained integer limit from 1 to 50. A caller resolves the default 20 independently.
The response echo cannot choose that limit. Even a schema-valid, correctly hashed
one-item response with `requested_limit: 1` rejects when the expected query limit is 20.
The existing `ReadContext` remains closed to company/scope fields only. Its shared
snapshot helper copies query data; it does not authenticate or authorize anyone.

Validation covers strict JSON/UTF-8 and the full 262,144-byte raw boundary, the pinned
schema, root/nested company and scope, fixed owner-note fields, matching observation
labels, exact historical conversation references, unique message IDs, and a contiguous
newest-first sequence starting at the observed head revision. Every nested record's
decoded UTF-8 limits and own digest are checked independently, followed by the aggregate
digest. Successful output is deeply frozen; errors do not include submitted content.

The current-at-read `room_head` is separate from immutable historical pairs. Each pair
uses its own conversation revision/digest; an ID-only record map cannot represent this
history. Observation labels remain data and `live_verified` remains false.

An observed absent room has null head and no items. This is distinct from an unavailable
or corrupt operation, which must not be presented as empty history. Coverage remains
partial; totals, `has_more` and cursors are null, with replay/snapshot explicitly
unavailable. A `none_observed` truncation label is not a completeness claim.

## Focused proof

The 37 new cases exercise three examples, 17 mutations, eight inherited raw lexical
vectors, generated encoded-byte recipes, expected-limit binding, empty-result scope
privacy, observation/digest mismatches, multibyte field limits and context snapshotting.
The 50-pair recipe occupies 2,542,503 bytes; its five-pair prefix is 255,357 bytes.
Exactly 262,144 raw bytes pass and 262,145 reject. The separate command decoder still
rejects that large output at its unchanged 32,768-byte boundary.

The first 26 cases failed with the missing consumer entrypoint. Implementation and
the additional boundary cases passed together with 84 existing record tests (121 total).
Detailed source, test and review evidence is isolated under
`.harness-company-evidence/history-consumer-20261102/`.

Only the new schema is a runtime JSON asset. Manifest and golden files remain custody
and conformance inputs. Static packaging admission is not a rebuilt/installed payload
claim. No full application regression is inferred from these focused tests.

## Actual producer and packaged closure

The separate CONTROL implementation checkpoint is
`530ec7a0cc01c3c1df610a38eda01dd8829379ca`; its receipt SHA-256 is
`55fe840adaeab69b2098d9b3a13e54d51f07b7a624dca94446f7c579ecfc950e`.
This does not repin the issued candidate or any historical integration guard.

Gen ran the published isolated Python fixture recipe against that implementation,
then applied the unchanged data-only validator to each fresh projection. A reviewer
independently repeated the same three fixed cases. Both executions passed:

| Case | Independently retained limit | Whole pairs | Encoded projection bytes |
| --- | ---: | ---: | ---: |
| Small | 20 | 2 | 4,573 |
| Empty observed room | 20 | 0 | 713 |
| Byte-limited prefix | 50 | 7 | 239,622 |

Each run checked exact historical references, frozen output, source-file pins and
wrong expected limit/project/company rejection. The fixture itself reported current
wrong-token/project denial, unchanged read rows and removal of its temporary Store.
Those producer assertions are local synthetic evidence, not production authentication.
Only the enumerated files were rehashed; no whole-Python-environment claim is made.

Raw stdout, stderr and process records are retained under
`.harness-company-evidence/history-producer-conformance-20261102/`:
parent `actual-5uM4F5/verification.json` SHA-256
`0f52fdeb5333c9cfb589c9f95d1eb951262b10a503be7b53d327ccd846d7a01b`,
independent `actual-e6ssUF/verification.json` SHA-256
`50f35949673bd6f50b70749a99eebbde97b0dd333f3969848768293d54bcdafb`.
The fixture wrapper cap is 524,288 bytes. These actual wrappers fit the existing
262,144-byte strict decoder; the projection cap and unchanged 32,768-byte command
cap remain distinct. Larger future wrappers are unsupported by this verifier.

Separately, unique03's actual bundled Node 24.22.2 and production dependencies loaded
the company host and history validator. In-process unconfigured bootstrap/connection
returned 200 with all capabilities disabled, followed by awaited close with no listener.
Three pinned synthetic history examples and mismatch checks passed. The receipt is
`.harness-company-evidence/bundled-history-20261102/checkpoint.json`, SHA-256
`feaef5b35d74a3cb2a13025ee99f839e3882d59d178797199aa50d04003de743`.
This is unpacked runtime closure, separate from installation and live company operation.

The decoder/conformance checkpoints above added no service call or authority. The
separate TLS read remains owner-host-only; general employee/current-attempt/audience
authorization, cursor issuance, fixed snapshots, communication UI, model/native
activation and full C01/C02/C03/C07/C08/C09 acceptance remain open.
