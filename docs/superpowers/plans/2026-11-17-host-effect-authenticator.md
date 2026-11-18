# Protected host effect authority

## Requirement and boundary

Original M02 C3 requires a host authenticator for a single-use approval and private keyed commitments for effect-bearing arguments. Existing approvals and argument commitments use ordinary hashes. The public projection repair removes those hashes from read models; it does not authenticate a grant.

This plan implements three focused, stacked changes. Production capability flags remain off. The complete boundary remains incomplete until the signer is connected to actual ledger and Service dispatch paths.

## 1. Protected custody and cryptographic provider

Add a host-only synchronous authenticator backed by a 32-byte random key. Use HMAC-SHA256 with explicit version, key ID and purpose separation for arguments, actions, grants and the current operation definition commitment. Normalize the input with the existing digest function before applying HMAC. Reject malformed tags before fixed-length timing-safe comparison. The provider exposes no key material and becomes unusable after revocation.

Add a dedicated `effect-authority` directory to protected host storage. Initialization is explicit, creates the directory and key file exclusively, and never overwrites an existing or partially initialized directory. Use the existing CurrentUser DPAPI codec; the encrypted payload binds its version, random key ID and canonical profile path. Sync the new file before returning custody. Reopen after initialization must require the generated key ID.

Ordinary open never initializes or regenerates. Missing, corrupt, oversized, linked, wrong-profile, unprotectable or mismatched key material fails closed. The native read-only file guard stays alive throughout the returned custody handle's lifetime. Bounded read, identity checking and decryption occur inside that guard. Guard loss revokes the signer. Close revokes and zeroes its retained Buffer before waiting for native guard teardown. Existing SecretCodec operations necessarily create temporary JavaScript strings; Buffer wiping is not a claim that every transient copy was erased.

The exact current Linux guard rejects read-only leaf-file custody and requires a kernel-owned inherited guardian. Protected custody therefore remains Windows-only and fails closed elsewhere. There is no permissive cross-platform fallback. Real Windows guarded-file/DPAPI tests are a separate gate from Linux cryptographic tests with explicit test keys.

## 2. Authenticated ledger admission

Introduce an optional versioned authenticator field on stored approvals so old rows remain readable. Enabled-mode authorization requires a strict signed approval: issuer `authenticated_user`, exact owner and operation, finite ordered timestamps within the grant lifetime, exactly one remaining use, expected action commitment and authentic tag. Unsigned history cannot authorize new dispatch.

Bind all grant fields, including current remaining uses. Consumption validates the expected owner/action/operation inside the same synchronous Store transaction that records dispatch, then writes remaining uses zero with a fresh authenticator. Transaction rollback must leave both original grant and effect state unchanged. The MAC authenticates fields; durable invocation records provide replay prevention.

Use the same provider for private argument commitments at admission, dedupe, denied/prepared records and action commitments. Existing unkeyed rows remain historical evidence. New enabled-mode invocation or approval creation requires an available signer and cannot fall back to ordinary hashes.

## 3. Service and fixture integration

Pass a host-only preloaded signer through ServiceOptions to the ledger. Missing custody must block issuing, spending and new audited dispatch without preventing Service construction, recovery or read-only evidence. Update `Service.finish` to obtain the task-finish self commitment from the same ledger provider used at admission.

The composing host owns the async custody handle: load before opted-in Service construction; drain/dispose the Service before closing custody in finally; close custody after startup failure too. Existing production composition remains default off. Every opted-in test host supplies an explicit test signer; there is no environment-based or implicit test fallback.

## Verification sequence

1. Preserve new acceptance tests before implementation. Existing unsigned grant behavior supplies a real baseline for the missing enforcement boundary.
2. Verify deterministic normalization, domain/key separation, malformed-tag denial, and revocation with real Node crypto.
3. On Windows, verify actual guarded exclusive initialization, competing initialization, reopen, key ID/profile binding, no plaintext persistence, corrupt/missing key denial, live replacement denial, close, and native DPAPI round-trip. Record platform unavailability separately.
4. Use real Store transactions to test authenticated spend, field/issuer/use tampering, unsigned grants, mismatched action/owner, key loss, duplicate invocation, restart and injected transaction rollback.
5. Use the real Service approval/dispatch path with a counted external effect. Verify missing signer leaves history readable, tampering prevents execution, valid grant executes once, spent state authenticates, and task-finish self identification remains consistent.
6. Run focused existing effect/approval/recovery tests and typecheck. Publish exact tested blobs and tree; distinguish local Linux, Windows CI, static review and native custody evidence.

## Remaining separately reviewed work

The current operation commitment does not establish exact resolved executable bytes, cwd or the real tool-definition schema. Those belong to a subsequent focused S4 binding change. M03 is reviewing the smallest actual SecretRef consumer; opaque reference identity and approved destination must enter commitments rather than resolved secrets. Neither this custody change nor its keyed ledger integration claims those remaining requirements complete.

This design does not claim resistance to an attacker who controls the trusted host process or rolls back the complete OS profile and durable ledger. It does not add key rotation, operator approval, a user preference, a secret resolver available to the model, or production activation.
