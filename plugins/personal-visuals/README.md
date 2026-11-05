# Personal Visuals

An optional separately installed Gen plug-in for architecture diagrams, dependency
maps, system flows and timelines. Custom diagram behavior lives in this package;
the harness supplies its existing opaque frame, shared React presentation runtime
and verified host bridge.

It reads and saves only its own diagram records. It has no personal conversation,
model, account, runtime, project-file or general network capability. Opening an
example does not inspect your projects. Every example is labelled **Example**.

## Build and install

Requires Node 24.10 or newer and Gen 0.6.5 within 0.6. The vendored SDK is public
API 1.1.0 with the additive workspace contribution contract.

```powershell
cd plugins/personal-visuals
pnpm install --ignore-workspace --frozen-lockfile
pnpm build
```

The builder refuses to overwrite an existing output. Subsequent attempts use a
new destination:

```powershell
node scripts/build.mjs --output-root dist/package-attempt02
```

For development against an explicitly selected existing public harness toolchain:

```powershell
node scripts/build.mjs --harness-root <Gen-V1-checkout> --output-root dist/package-dev
```

The build prints the output path and exact `plugin-files.json` SHA-256 inventory
digest. Installation is a separate explicit action through Gen's trusted plug-in
CLI. This package does not install or activate itself. Refer to the harness
plug-in guide for the current CLI syntax. `dist/` and dependency directories are
generated outputs, not source exports.

## Documents and sources

Import a structured JSON document or edit its JSON inside the plug-in. Preview
updates the diagram; Save commits the validated document while preserving its
identity. Partial JSON drafts are saved separately and restored after reopening.
Failed saves retain their exact request identity, hold clean close and expose
explicit retry/recovery. Export opens a read-only panel containing the current
JSON draft. Select all, copy the text manually, and save it as a `.json` file.
The opaque frame keeps its existing sandbox: no download, clipboard permission,
host filesystem grant, or automatic save is requested by Export.

Documents have version `1`, a title, `kind` (`architecture`, `dependencies`, `flow`
or `timeline`), `provenance` (`example`, `provided` or `derived`), nodes, edges and
sources. Each node has an ID, label and kind; optional descriptions and source
references supply the inspector. Every edge names existing source/target nodes.
Timeline nodes additionally supply finite `start` and `end` values plus an
optional document time unit. The example selector provides complete valid
documents that can be exported and adapted.

Limits: 128 nodes, 256 edges, 64 source records and 96 KiB per document/draft.
Unique IDs, reference integrity and timeline intervals are checked before a
document is admitted. Unknown fields such as HTML, JavaScript or executable
handlers are rejected. Labels, excerpts and source locations render as text;
they are not evaluated or automatically fetched.

Select a node or connection for its exact supporting sources. Fit, pan and zoom
stay inside the visual area. Every node/edge also has a keyboard-accessible list.
Color identifies component types, never invented activity or agent health.

## Host storage contract

Only two fixed host operations exist:

- `visual.document.read`: bounded document ID, optionally an exact request ID for
  recovery metadata.
- `visual.document.write`: document ID, base revision, request ID and a strict
  `draft` or `commit` payload.

The single-writer host uses its own assigned data directory, revision checks,
bounded idempotency receipts, ordinary-file/link checks and atomic synced writes.
It exposes no arbitrary path, URL, IPC, native surface or personal Store. The
normal Gen editor-flush guard waits for durable draft writes before leaving.

Run focused tests from the Gen-V1 repository root:

```powershell
pnpm exec vitest run tests/personal-visuals.test.ts
```

The focused opaque-frame browser case is `tests/personal-visuals-ui.test.ts`.
It uses the actual frontend with a labelled synthetic operation adapter, checks
that autosave retains typing focus, and verifies that source labels cannot create
HTML elements or external requests. Where the bundled Playwright browser is not
installed, set `GEN_TEST_BROWSER_CHANNEL=chrome` to use an existing Chrome
installation; the test never downloads a browser or starts a server.

Source/package tests do not establish native display, live system inspection or
user visual acceptance. The plug-in has no automatic inference or collection
producer; provided and derived diagrams remain clearly attributed documents.
