# Native desktop owner

`main.ts` owns the only backend process, the application lifecycle and native window registry. `preload.ts` exposes only the typed methods in `packages/desktop-contract`; it does not expose raw IPC, Node, filesystem or process APIs.

Root builds `main.mjs` and `preload.cjs` together. Production resources contain `host/` (server, runtime dependencies and trusted assets) and `node/node.exe` (Node >=24.10). Development supplies `HARNESS_DESKTOP_HOST_ROOT` and `HARNESS_DESKTOP_NODE_PATH`. `HARNESS_DESKTOP_TEST_DATA_DIR` isolates both backend data and Electron profile; it is the required native-test path. Ports default to4317/4318 and can be changed together for isolated tests.

Backend readiness is authenticated through the private child IPC channel, random launch token, exact loopback origin and child PID. The owner does not attach to an unrelated service already occupying the port. Shutdown requests carry the same token. One backend remains while any native application windows exist; minimizing or closing one view does not Stop a task. Explicit Quit first asks every renderer to save, then closes windows and shuts down the process tree.

Detached views pin their task and surface identities. New editable destinations wait for matching source renderers to flush/release leases, then acknowledge readiness before the original owner resumes its placement controls. Workspace/artifact aliases share one native editor identity. A failed save or target startup leaves the source available. Reset clamps bounds to connected display work areas; native geometry is separate from docked vertical rail preferences.

The built-in browser uses a separate Electron session and native WebContentsView without the application preload, Node integration or application cookies. Docking reparents the same live view. Explicit closure disposes the view and releases its budget. Its main-owned outbound proxy resolves each HTTP80 or CONNECT443 destination once and connects only to an approved numeric public IP, so later DNS changes cannot redirect the actual connection into a private network. Private targets, mixed DNS answers, nonstandard ports, unsupported protocols, downloads and permissions are denied. WebRTC non-proxied UDP and QUIC/WebTransport are disabled. This is an application browser policy, not an OS sandbox or hard browser memory quota.

Native bounds and browser/app sessions persist in the Electron profile. Browser-only drafts from another browser profile are not automatically imported or scraped. The existing host remains authoritative for task resources, approvals, revisions and completed-effect receipts.

Root-owned `scripts/verify-desktop.ts` exercises actual Electron and the packaged executable. Unit checks in `tests/desktop-native.test.ts` cover strict descriptors, exact-frame bridge authority, display geometry, source handoff selection, lifecycle disposal, Node loader launch and the pinned proxy transport.
