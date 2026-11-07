# Visual workspace preview

Gen 0.6.5 adds a split workspace while keeping the original conversations,
composer, account/model selection, resources and approvals. No plug-in is needed
to use the personal workspace. Separate desktop windows remain deferred.

## Arrange existing views

- Drag a thread from the sidebar to a highlighted edge or center target. An
  already open thread moves its existing editor rather than starting another.
- Drag a shared divider to resize. Keyboard arrows resize a focused divider.
  Hover a corner for split/join controls; the area menu provides the keyboard
  alternative, editor selection and parked-view recovery.
- Joining or changing an editor parks the displaced view. Drafts and threads
  are retained. Layout Undo/Redo changes placement, never messages or task work.
- Use **Layouts** to save/apply a named arrangement or recover the retained
  canvas. The version 1 canvas record is kept separately and is not rearranged.
- Narrow layouts show one selected area while preserving the desktop tree.
  Automatic plans expand the overview without replacing the narrow chat.

The stationary surface layer retains mounted editors during moves, tab changes
and parking. Layout commands carry exact revisions and owner bindings. A refused
editor flush or stale revision leaves saved work available for recovery.

The editor selector provides Files, Diff, Notes, Terminal, PRs, plan, context,
usage and Inbox views. Thread areas ask for a sidebar drag. The desktop host can
open one genuine in-app browser; moving its tab preserves the same browser.
Browser builds show an unavailable state rather than a simulated desktop view.

## One project overview

The protected right overview contains project identity/changes, actual subagents,
side conversations, automation availability and a concise plan summary. A full
plan area reads the same validated plan record and includes detailed steps and
requirements. New plan revisions reuse the existing area. They do not move
keyboard focus away from a wide-screen composer. Schedules are shown only when
an actual automation producer supplies them; no tasks are fabricated.

An explicit project switch uses the existing host connection guard. A started
conversation keeps its binding and opens a new chat for another project.
Unstarted conversations reconcile their thread layout reference through an
exact host command. Previously opened project tools retain their captured owner;
they are never silently redirected to another project.

## Appearance and settings

Settings separates practical controls from a closed, searchable capability
inventory. Appearance previews include solid/graphite/midnight backgrounds,
validated local raster images, accent colors and reset/cancel. Project colors
are saved by typed project identity, not display name, and remain separate from
activity/error status. Labels and icons continue to convey meaning without color.

Environment settings support ordinary values and write-only secrets with explicit
device/project scope. Windows secrets use current-user DPAPI in a host-owned
file outside the event journal. Renderers receive metadata only. Unsupported
hosts report secure storage unavailable. Reserved runtime/account/home variables
are rejected. These values apply to newly opened ordinary project terminals;
they do not change a running process, subscription identity or billing route.
Saving a key does not claim a successful provider connection.

## Inbox and attention

Inbox uses selected Vespin list/reader presentation code, pinned with source
hashes, modifications and Apache notices under `third-party/vespin`. Gen supplies
durable scoped records and existing conversation actions. Reading an item never
approves it; dismissing a popup keeps its Inbox record.

Desktop attention uses a fixed, isolated bottom-right popup above ordinary
application windows without taking typing focus. It has bounded stacking,
deduplication, sound volume/mute, quiet hours and preview privacy. Sensitive
preview changes purge active/queued cards immediately. The popup only accepts
canonical event IDs; it cannot open arbitrary URLs or desktop windows.

## Optional personal visualizations

`plugins/personal-visuals` is a separately built and explicitly installed plug-in
for architecture diagrams, dependencies, flows and timelines. Its structured
documents include attributed sources and accessible lists. Examples are labelled.
It owns its documents/drafts and has no automatic project inspection, network,
account or model capability. JSON export uses a read-only copy panel compatible
with the existing opaque sandbox. See its README for independent builds.

## Verification boundary

CI installs the optional plug-in from its own frozen lockfile, checks its types
and build, and explicitly runs split renderer/actual-App browser regressions.
Source and browser tests cover draft retention, exact ownership, plan revisions,
saved layouts, privacy and denied operations. Native popup focus/sound, browser
occlusion at display scales, multi-monitor placement and user visual acceptance
need a separate Windows candidate run. A build does not establish those results.

Live visualization/management behavior requires a real authorized producer in
the owning plug-in. Generic workspace registration does not create that authority.
