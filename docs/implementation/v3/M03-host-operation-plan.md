# M03 host operation composition

This dependency change connects trusted integration hosts to the existing pending Operation approval and executor path. It does not approve an integration, resolve a secret, enable a flag or choose an execution backend.

The host constructor supplies a finite map of integration operation kinds to executors. Service snapshots that map and refuses core capability names. The existing additionalTool callback receives a third, host-only context exposing preparation for registered kinds. Preparation retains the current run check, plan-mode prohibition and resource-grant checks. It creates an ordinary unapproved Operation.

Registered executors run only inside Service.executeOperation after approval admission and the existing post-await original-owner check. They receive the admitted current owner and cancellation signal. Their results use the existing operation/effect settlement path. A missing registration never dispatches a host callback.

The follow-on Context7 change will use this path for exact reference and child metadata, after M02's keyed authority integration. It will leave security.secretRefsV1 false by default, present an explicit pending operation, and resolve only inside the approved executor. No secret value or low-entropy value hash belongs in operation arguments.

Alternatives considered: automatically minting a SecretReferenceLedger approval at MCP startup would invent authority; a metadata-only adapter would not enforce the production boundary. A constructor-owned integration executor map composes with the current operation UI and durable admission without broadening the existing capability-domain executor.

Verification uses real Service and Store instances with owned append-file executors. Cases cover pending preparation, no execution without approval, a single durable dispatch, registry custody, absent registration, plan mode, stale preparation and revocation between admission and executor entry. Existing admission-owner and effect tests remain adjacent regression gates. Actual native sandbox and Windows key custody acceptance remain separate.
