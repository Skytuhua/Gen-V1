# Canonical owner-note consumer conformance

Gen's existing read-record decoder consumes actual records from CONTROL's reviewed
internal owner-note producer. This is a disconnected temporary-Store integration
test, with no application API, interface or permission change.

| Pin | Value |
| --- | --- |
| Producer checkpoint | `e27f9443bfcac1fdf92b0d70dfab261a7fb7953b` |
| Producer receipt SHA-256 | `82751b55dd51e60f2fa97330766da16b62817fc1ef3085604fb8b64242972f48` |
| Exporter SHA-256 | `31b1a494d7d14c28dafd53f8305a680488b0612d72f52ff1b8c0f9f962792567` |
| Recipe SHA-256 | `1bbde77e6ce26efc37b4963eb843c9fda7c70c18f94af24e40f199e5c236b0f9` |
| Producer's retained specimen SHA-256 | `4d65868717fad2c11dd3f8a40f7a0c3173dade21517a3e21817c3e67a7acd0bd` |

The [opt-in test](../tests/company/owner-note-producer-integration.test.ts) verifies
the exact checkpoint and nine source/evidence hashes before and after execution.
The parent also compared these files to committed Git blobs. It invokes the existing
isolated Python interpreter with a small environment, a 15-second deadline and a
32 KiB output bound. It installs nothing and passes no database or credential input.

The exporter creates a new synthetic Store and fixture-only owner identity, appends
two Alpha notes and a Beta canary, exercises its own replay/conflict/denial checks,
and closes/removes the Store before emitting JSON. Gen retains stdout as bytes in a
unique `.harness-company-evidence/owner-note-consumer-*` directory. It never opens
or copies the Store. The wrapper is a fixture artifact, not a new wire response.

Gen strictly parses the whole small fixture before canonicalizing and validating
its four separate Conversation/Message records. The test checks exact company/scope,
computed digests, stored observation labels, immutable conversation revisions 1/2,
message sequences, exact historical reference and receipt bindings, and rejection
under Beta context. Historical conversation data is never labeled the current head.

The first real conformance run passed without a production-code change. No missing
feature RED is claimed for this compatibility check. Default execution explicitly
skips this new test; the original two service opt-in guards, including exact `99df`,
are untouched. This is a new source/evidence phase after the 1,644-test combined run.

To run against the exact trusted backend with its existing environment:

```powershell
$env:GEN_COMPANY_OWNER_NOTE_FIXTURE_ROOT = 'C:/Users/user/Documents/Maritime/hermes-swarm-control'
pnpm exec vitest run tests/company/owner-note-producer-integration.test.ts --maxWorkers=1
Remove-Item Env:GEN_COMPANY_OWNER_NOTE_FIXTURE_ROOT
```

Each execution creates fresh UUIDs and retains its own raw output. It does not replace
the producer's specimen or the [missing historical receipts](company-evidence-custody-2026-11-02.md).
The frozen [read-record pin](company-communications-reads.md) remains `bdfbaae`; the
producer checkpoint is separate provenance, not a runtime handshake or repin.

No full C01/C02/C03 acceptance, authenticated production read, C07/C08/C09, native
model/accounting/pilot, company activation or E01 cutover follows from this test.
