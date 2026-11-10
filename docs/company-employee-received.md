# Received-only consumer boundary

Pinned producer checkpoint: `cb130ab31b2c8818c4a199a3eb0c9e7017d47c5b`.
The raw descriptor/schema/golden files retain their issued bytes under
`packages/company-contracts/communications/v1/`.

The data validator captures the independently retained machine/project/recipient
context, verifies a full canonical information envelope and an existing supervisor
local receipt, prepares the exact persisted ACK, and validates the service's separate
DeliveryReceipt. It creates no identity or local persistence. The frozen information
Delivery remains accepted, with received/consumed timestamps unchanged.

`EmployeeReceivedClient.acknowledge(expected, envelope, persistedACK, signal?)` performs
one verified same-host TLS POST with a machine bearer and no owner fallback, automatic
retry, employee read, engine or CLI composition. Callers retain the same command on an
uncertain outcome. Received is a supervisor assertion, not proof of OS disk, model
consumption, admission, task execution or completion.

Focused coverage is 16 validator tests and 18 client tests, including exact command
capture, independent bindings, errors, abort/deadline, response bounds and verified TLS.
No Gen disposable CONTROL WorkerInbox counterpart was run in this checkpoint; its
producer proof remains separately scoped. The owner redirected work to the running
Stage 1 workspace at this coherent source boundary. No later protocol slice is started.
