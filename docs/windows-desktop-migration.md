# Windows desktop migration and detachable surfaces

> Current preview: new native detachment is unavailable. Existing child-window recovery and saved placements are retained. See the [current feature guide](public/features.md) and [preview release notes](public/release-notes.md).

This page records the historical Windows migration design. Original v0.4.1 installer verification is retained separately; its archived reference is `evidence/ui-working-object-package-20261031/report.md`. Requirements and versioned evidence below retain their original scope.

Historical status: native Electron window ownership, detachable surfaces, the isolated browser and packaged-Node sidecar were implemented for that milestone. Packaged launch and final verification were recorded separately in the desktop delivery evidence. The controls described below do not describe current detachment availability.

## Required desktop behavior

Every major workspace surface needs a Detach action: left navigation/project sidebar, right workspace/sidebar, built-in browser, chat threads/tabs, Plan, usage, artifacts, files/diffs/executor views and subagent details. Each can become an independent native window and move freely in both axes across the desktop and connected monitors, including outside the main harness. Reattach returns the same view to the main window. This applies to meaningful workspace surfaces rather than detaching individual buttons.

The chat window must minimize independently through native window controls. Detached browsers, sidebars and task windows remain visible; active tasks and subagents continue. Restore chat from the taskbar or desktop window launcher without creating another thread or runtime. Minimizing a view is not Stop, cancellation or application shutdown. Closing and quitting retain their separately defined lifecycle behavior.

Browser task tools open on demand with vertical-only movement; closed tools reserve no rail width. Native bounds are stored separately. Reset position makes a detached window reachable in a connected display's work area after monitor or DPI changes. Always-on-top can be an explicit preference rather than mandatory behavior.

## Application foundation

Use Electron for the desktop owner and keep the existing React frontend, authenticated HTTP/SSE boundary and one Node/Pi backend. The Electron main process owns a single-instance lock, backend supervision and a bounded registry of native windows. Each nonmodal BrowserWindow selects a validated surface descriptor; task components do not import Electron.

The backend needs a pinned Node >=24.10 sidecar. The current server uses `node:sqlite`, and Pi currently launches workers using `process.execPath`; launching those workers with Electron's executable would change their runtime. Package compiled worker entrypoints, Pi resources, PDF/widget assets and the Windows filesystem-guard helper with real filesystem paths as required. Do not weaken the existing resource or generated-code boundaries to make packaging succeed.

Use a stable loopback origin and one persistent Electron session for all windows and subsequent launches. Keep one Store, Service, Pi coordinator and operation broker. A new window must never create another task runtime or silently reuse an unrelated process already occupying the host port.

Primary references: [Electron application lifecycle](https://www.electronjs.org/docs/latest/api/app), [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window), [persistent sessions](https://www.electronjs.org/docs/latest/api/session), [display work areas](https://www.electronjs.org/docs/latest/api/screen).

## Window and editing ownership

Allowed surfaces include navigation, workspace, browser, Plan, usage, thread, artifact and agent, with bounded subtype descriptors for files/diffs/executor views. Task descriptors pin their thread and, where applicable, artifact or agent identity; they do not inherit later main-window navigation. Reuse those identities when reattaching. Sidebar navigation can explicitly target a chosen chat window rather than silently replacing every open thread.

Expose only narrow desktop methods for detach, reattach, reset bounds and lifecycle acknowledgment. Validate the sender's main frame, origin, surface identity and payload. Keep Node integration off, context isolation and sandboxing on, and deny arbitrary navigation or new windows. Do not expose generic IPC, filesystem or process methods to the renderer. See [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

An editable surface handoff must:

1. Persist its journal and pending assets, then await the host's accepted state revision.
2. Release the original editing lease before the destination takes ownership.
3. Restore the same artifact/state identities in the destination and acknowledge readiness.
4. Keep the source available if persistence, lease transfer or destination startup fails.

A native window has a new DOM. Promise state and draft continuity rather than transferring an arbitrary mounted React subtree. Existing journal caches and artifact save lanes live in renderer memory; add explicit cross-window invalidation and retain one active editor per state. Shared IndexedDB alone does not synchronize those caches.

Electron has a separate browser profile. Existing browser-only drafts need an explicit export/import path with schema, generation and identity validation, preserving conflicts for review. Do not scrape browser profiles or silently replace current harness storage.

## Built-in browser boundary

The desktop browser launcher opens a native browser surface. Dock/Detach reparents the same remote WebContentsView. Remote pages use a separate browser session with no harness preload, Node integration, application cookies or desktop bridge. The pinned outbound proxy permits public HTTP port 80 and HTTPS port 443; private/local targets, unsupported protocols, nonstandard ports, downloads and media permissions are denied. WebRTC non-proxied UDP and QUIC/WebTransport are disabled. Browser memory is not hard limited, and this is not an OS sandbox. Native browser bounds are hidden while Settings or an expanded artifact covers the page.

## First executable milestone

The implementation covers Plan, usage, both sidebars, chats, artifacts, subagent details and the isolated built-in browser. It packages pinned Node 24.22.2 with Electron 45.2.0 and materialized production dependencies outside ASAR. Fixed subscription sign-in uses bundled Node in its own interactive console; codes never pass through app IPC/logs and there is no API-key fallback. Native startup is single-instance and requires authenticated readiness from its own backend.

Browser-only journals can be explicitly exported/imported through Maintenance. Compatible imported artifact drafts update mounted editors immediately; dirty, stale and conflicting local entries are preserved rather than overwritten. Native handoff waits for journal/asset saving and source leases, including when another window initiates it. A ready renderer crash gets bounded trusted-surface recovery; repeated failure releases the view while retaining durable journals.

Acceptance includes cold and repeated launch, backend crash/reconnect, shutdown during a run, dirty handoff failure, competing edit leases, close versus Stop, monitor removal, restart recovery and preservation of exact approval/effect receipts. Explicitly test chat minimization with visible detached tools and a continuing agent; restoring chat must recover its existing draft. Browser acceptance must prove that remote pages cannot use the harness bridge, credentials or resource grants. Generated-code applications remain disabled; external integrations and the 36-run pilot remain separate work.
