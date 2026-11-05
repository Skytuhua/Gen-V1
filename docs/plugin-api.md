# Gen plug-in API v1

Gen keeps its conversation workspace, navigation, settings, composer, generative catalog and native windows. An optional plug-in contributes views through this API. The harness builds and opens with no plug-in installed.

The first release of this API requires Gen **0.6.4**. Older installations need an initial application upgrade. A package must declare the actual Gen versions it supports; the host rejects incompatible API and version declarations.

## Package format

```text
plugin.json
plugin-files.json
frontend/index.html
frontend/main.js
host/main.mjs
```

`plugin.json` is a strict `PluginManifest`:

```json
{
  "id": "example-plugin",
  "name": "Example workspace",
  "version": "1.0.0",
  "apiVersion": 1,
  "compatibleGenVersions": ">=0.6.4 <0.7.0",
  "frontendEntry": "frontend/index.html",
  "hostEntry": "host/main.mjs"
}
```

IDs use lowercase letters, numbers and single hyphen separators, with an 80-character limit. Package paths are bounded relative paths. Frontend entrypoints are HTML under `frontend/`; host entrypoints are standalone ESM bundles under `host/`. Do not package credentials, account stores, browser profiles or mutable application state.

`plugin-files.json` declares every other package file using its exact byte length and SHA-256:

```json
{
  "version": 1,
  "files": [
    {"path": "plugin.json", "bytes": 228, "sha256": "<64 lowercase hex characters>"},
    {"path": "frontend/index.html", "bytes": 102, "sha256": "<64 lowercase hex characters>"},
    {"path": "frontend/main.js", "bytes": 2048, "sha256": "<64 lowercase hex characters>"},
    {"path": "host/main.mjs", "bytes": 4096, "sha256": "<64 lowercase hex characters>"}
  ]
}
```

The displayed lengths and digests are placeholders: compute them from the finished package. The trusted installation digest is the SHA-256 of **the raw `plugin-files.json` bytes**, not a hash of reserialized JSON. Inventory verification rejects undeclared files, changed bytes, links, traversal and oversized payloads before activation or asset serving.

## Install, inspect and remove

Close Gen before changing its installed plug-in inventory. From a Gen source checkout:

```powershell
pnpm exec tsx scripts/plugin.ts install C:\Packages\example-plugin <trusted-inventory-sha256>
pnpm exec tsx scripts/plugin.ts list
pnpm exec tsx scripts/plugin.ts remove example-plugin
```

Obtain the expected digest through the trusted package handoff. Calculating a new digest for an unexplained or altered package does not establish trust.

The default Windows registry lives at `%LOCALAPPDATA%/GenV1/plugins`. `HARNESS_PLUGIN_DIR` selects an explicit alternative. Installed versions are immutable at `<root>/<id>/<version>`; activation is recorded separately. Persistent private data belongs at `<root>/data/<id>`, outside the application installation directory. The host supplies that directory to the plug-in.

Removal deactivates the plug-in and retains installed versions and data. Restart Gen to refresh navigation. Application updates preserve this separate directory and reverify the current active inventory before installation. An incompatible or unverifiable installed package prevents an unsafe update.

## Host implementation

Build contracts from the public `@gen-v1/plugin-api` package. `node scripts/build-plugin-api.mjs` builds that package from a Gen checkout. Its `./host-utilities` export includes `acquireProfileLease` for single-writer persistent state.

The host entry exports a default module:

```ts
import type {PluginHostModule} from '@gen-v1/plugin-api';

export default {
  async activate({dataDir, genVersion}) {
    return {
      operations: {
        'conversation.load': async (input, signal) => {
          // Validate this plug-in's scope and return bounded JSON records.
          return readAuthorizedConversation(dataDir, input, signal);
        }
      },
      validateSurface: async surface => validateCurrentWindowAuthority(surface),
      isBusy: async () => hasPendingWork(),
      close: async () => flushAndCloseOwnedResources()
    };
  }
} satisfies PluginHostModule;
```

The functions in this example are implementation responsibilities. The host context contains only `dataDir` and `genVersion`. It supplies no personal Store, runtime, account resolver, credential manager or personal-command client. A plug-in host is trusted Node code; this context is an integration boundary, not an adversarial JavaScript sandbox.

Each operation must validate authorization, input identity and size before effects. Preserve stable request identities and uncertain outcomes; do not silently replay a timed-out action. Read protected configuration and credentials from the plug-in's external private storage. Return bounded, credential-free JSON. An unavailable operation must reject clearly. Implement `isBusy` and `close` so normal shutdown and update readiness can be assessed honestly.

## Frontend registration and shared presentation

The frontend runs in an opaque-origin frame inside the existing shell. It has no personal desktop bridge or network access. Gen loads its public `GenPluginUI` runtime before the package's frontend script. Bundle against the shared React exports in that runtime so components use the same React instance.

`GenPluginUI` supplies `React`, `ReactDOM`, `ReactDOMClient`, `JSXRuntime`, `ComposerView`, `ArtifactFrame`, `ArtifactPresentation`, `Markdown` and `FloatingWindow`. Reuse these presentation components; keep state, actions and authorization in the plug-in adapter. Do not mount personal composer, artifact, credential or runtime controllers.

Register contributions with `GenPluginUI.registerPlugin(manifest, registration)`:

```ts
interface PluginRegistration {
  navigation: {id: string; title: string}[];
  conversation: ConversationAdapter;
  panels?: {id: string; title: string}[];
  windowBehavior?: {surfaceId: string; detachable: boolean}[];
}
```

`registerPlugin` returns a disposer. Registration must match the installed plug-in identity. Window declarations request behavior; the trusted host still authorizes every native operation.

New detached views are currently unavailable. `window.capabilities` reports this
explicitly. Typed window references, existing-child recovery and saved layouts
remain intact; declarations do not enable new windows. Existing child returns
still require current host authorization and successful draft flushing.

The adapter is explicit:

```ts
interface ConversationRef {
  pluginId: string;
  scopeId: string;
  conversationId: string;
}

interface ConversationAdapter {
  load(ref: ConversationRef, signal: AbortSignal): Promise<ConversationView>;
  send(ref: ConversationRef, input: MessageInput, signal: AbortSignal): Promise<unknown>;
  submitArtifactAction(ref: ConversationRef, input: ArtifactActionInput, signal: AbortSignal): Promise<unknown>;
  cancel(ref: ConversationRef, signal: AbortSignal): Promise<unknown>;
}
```

`ConversationView` includes source messages and explicit `send`, `submitArtifactAction` and `cancel` capabilities. A capability is `{available: true}` or `{available: false, reason: string}`. Disabled, expired and unavailable capabilities must remain disabled with the real reason. A local draft is not delivery, and selecting a plug-in must never borrow a personal runtime or account.

Use `GenPluginUI.pluginRequest(operation, input, signal?)` for host calls. The parent verifies the frame source, session and plug-in identity, then dispatches only the registered plug-in operation. Never send credentials, cookies, CSRF tokens, arbitrary destination URLs or personal commands over this bridge.

The runtime's journal helpers call the plug-in's `state.read` and `state.write` operations; implement these against its own durable storage if used. Register editor handoffs and await journal writes before calling `pluginReady()`. Native child windows remain hidden until recovery completes. Flush failures retain the working window and defer installation.

Saved identities must include the plug-in and scope. Preserve source-origin caches and uncertain request records. Any cross-profile import must be explicit and additive, with conflicts retained for review; do not silently combine unrelated drafts.

## Native windows

Public native references contain no service-specific identity:

```ts
interface PluginSurface {
  kind: 'plugin';
  pluginId: string;
  scopeId: string;
  surfaceId: string;
  resourceId?: string;
}
```

Validate the complete reference against current authority in `validateSurface`. Opening, recovery, ready and return paths must preserve native sender, exact origin and window ownership checks. A browser-supplied URL never chooses the native destination.

The frame bridge provides bounded `window.capabilities`, `window.list`, `window.detach` and `window.reattach` operations. Availability comes from the actual native owner; browser builds do not fabricate native support. Lists are limited to the owning plug-in. Keep one editor for a given reference, flush before transfer, and yield the embedded task body while its native child owns that state.

## Verification boundaries

Test no-plug-in startup, installed-package integrity, denied operations, unavailable capabilities, cross-scope rejection, stale requests, saved-state recovery, removal and compatibility changes. Inspect frontend output, native bundles, packaged host inputs and source maps independently. The public source/runtime allowlists are exact reviewed inputs; unknown files require an explicit review and manifest edit.

Unit tests and successful builds do not establish native window behavior, installed update success, external service access or live execution. Installed update acceptance requires a suitable isolated Windows target and verification that user data and separately installed plug-in files survive a real stable-version upgrade.
