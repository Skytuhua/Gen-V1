# Partial C01: Gen codec consumer

Gen consumes Maritime's reviewed `maritime-communications / 1.0.0-candidate.1`
bundle. This implements strict JSON and closed artifact-free discussion data only.
Every result remains `executable: false`; validation provides no authority.

The [owner design](superpowers/plans/2026-11-02-gen-company-communications.md) and
[original 221 requirements](company/requirements.md) remain authoritative.

| Pin | Exact value |
| --- | --- |
| Backend checkpoint | `1214c9dcaf4ff2a2bc31e08afba09aadc30f10de` |
| Raw manifest SHA-256 | `4762203741d169461130796dab86e39adb5effa1e6c52bf77e837ba41a5e1492` |
| Backend review receipt SHA-256 | `cd7718f97e3edf8baf67464db6fc5cae1a0c0ceba52ab427ebf53cfdc6f597a3` |
| Raw consumer bundle | [manifest](../packages/company-contracts/communications/v1/manifest.json), with four subordinate file hashes |

All five files were copied as raw bytes, compared to committed backend blobs, and
protected by exact-path `-text` attributes. No backend file was changed. Legacy,
two-read and planning contracts and their historical fixture guards are preserved.

## Consumer boundary

[The pure module](../packages/company-contracts/communications/index.ts) exports:

- `decodeJson(raw)`: accepts raw `Uint8Array` bytes up to 32,768 bytes, including
  whitespace. Rejects malformed UTF-8, BOM, decoded duplicate keys, unpaired
  surrogates, depth above 64 and invalid integer spellings/ranges.
- `canonicalBytes(value)`: emits compact UTF-8 with explicit recursive UTF-16 key
  ordering, including numeric-looking keys. Preserves strings and array order.
  Rejects negative zero, unsafe/noninteger numbers and non-JSON object contents.
- `validateDiscussionCommand(raw)`: validates the pinned closed schema plus actual
  UTF-8 field sizes and combined audience constraints. Returns frozen intent data,
  immutable canonical JSON text, a Web Crypto SHA-256 argument digest and
  `executable: false`. The digest excludes only `command_id`; it is not a receipt.

Always pass wire bytes through the strict decoder. Serializing an already parsed
object cannot recover duplicate keys or the original `1.0`/`1e0` number spelling.
Object callers must check values before serialization; `canonicalBytes` rejects
negative zero and lossy values but cannot recover erased lexical provenance.

The module does not import personal storage, initialize services, expose a route or
attach a credential. It adds no registry, scheduler, operational events or company
records. Browser-platform bundling passed; no rendered browser or live inference
test is claimed for this slice.

## Evidence and remaining gates

[Consumer tests](../tests/company/communications-contracts.test.ts) exercise all 29
shared codec vectors and eight command vectors, including the accepted 8,192-byte
and rejected 8,194-byte multibyte bodies. Further tests cover raw whitespace limits,
depth, inert prototype keys, object input, error privacy, actor claims, trusted-event
classes, audience rules, digest coverage and frozen non-executable results.

The first run failed with the consumer entry point absent. The implemented suite
passed 72/72. With the four existing contract/conformance files, 107/107 passed.
Whole-workspace typecheck passed after correcting the Web Crypto buffer annotation.
Independent code and input-security reviews found no blocking findings. Detailed
RED/GREEN, typecheck and final receipts are under `test-results/company-communications-c01-*`.
No full application/unit/browser/native regression is inferred from these checks.

Full C01 remains incomplete: current-generation/task authorization, `Policy.authorize`,
audience/artifact resolution and all other Section 6 record/query/command types are
unsupported. Nonempty artifact references reject. Persistence, replay, receipts,
queries, HTTP/SSE/worker transport, communications UI and live execution remain
disabled. Later authority checks must reuse Maritime's registry and Store.

No E01 cutover, company acceptance, model/account use, credential permission,
external send, publication, source sync or commit was performed by this checkpoint.
