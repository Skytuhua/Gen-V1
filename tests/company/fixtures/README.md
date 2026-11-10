The owner-history certificate and private key are deliberately PUBLIC test-only
material copied byte-for-byte from the Maritime control repository's
tests/communications/fixtures directory. They serve only task-owned loopback TLS
servers in tests. The private key is not a credential and provides no production
identity or authority.

Never install this certificate as production or system trust, use this key for a
production listener, or load either file from production client code. Tests pass
the certificate explicitly as an isolated CA; deployments supply operator-owned
trust and credentials independently.

SHA-256:

- owner-history-test.cert.pem: e90aac4fc38cfc57051c4c3ebdcdde8b12b1fa23bc0af13669c15b552252ce99
- owner-history-test.key.pem: 9cfb337da6d23f82182485ce8b19acdac769b2883e949a0f6c70fc8fe0d499d4
