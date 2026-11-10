# Restore Gen and Separate the Private Company Plug-in

## 1. Goal and final structure

Restore **your original Gen interface**, using your screenshots and existing GitHub frontend as the reference. The company manager becomes an optional plug-in within that harness.

The original frontend still exists. The separate company entry currently bypasses it. Recovery must also check for unwanted changes within the original interface, rather than assuming that changing the launcher fixes everything.

The final GitHub structure will be:

| Repository | Visibility | Contents |
|---|---|---|
| **Skytuhua/Gen-V1** | Public, after privacy review | General harness, original interface, runtimes, generative UI, windows, generic plug-in support and automatic updates |
| **Skytuhua/Gen-Company** | Private | Company plug-in, company-specific clients/contracts, existing company backend, private configuration templates and test fixtures |

The existing company backend remains the single authority for employees, machines, scheduling, budgets, approvals and execution.

**Order of work:** restore the harness → integrate the private plug-in → migrate repositories → verify updates → retire obsolete repositories.

## 2. Ownership and coordination

Create one implementation thread named **“Restore Gen and extract the private Company plug-in.”**

That thread owns the restoration, generic integration boundary, repository migration and updater changes. It must first receive a coherent source handoff from the existing owners, including uncommitted and untracked files.

During this work:

- **Existing Gen app owner:** preserves the current native runtime, profiles, launcher rollback and packaging evidence; performs the coordinated native verification.
- **Existing Gen company owner:** supplies company components, contracts, saved-state behavior and the completed floating-window repair. It stops overlapping interface changes after handoff.
- **Existing Maritime owner:** continues useful backend and live-operation work. It supplies a committed backend snapshot and identifies changes that must be carried into the new private repository.
- **New implementation thread:** owns integration edits after those boundaries are agreed. Other threads must not edit the same files concurrently.

Use short, file-specific handoffs. Do not freeze the entire project or interrupt useful cloud work for the repository migration.

## 3. Implementation phases

### Phase A — Preserve current work and establish the original baseline

1. Record the current GitHub branches, local changes, untracked company files, relevant releases and active pull requests.
2. Preserve the existing profile backups and launcher rollback. Store additional migration backups on D:.
3. Record the original personal harness entry, frontend, host and state locations.
4. Use the supplied screenshots together with `DESIGN.md` and the existing Gen frontend to define visual acceptance.
5. Compare the current original interface against the GitHub baseline. Preserve later working runtime fixes; selectively repair unwanted interface changes.

**Preserve:** chats, projects, drafts, notes, settings, accounts, saved layouts, company caches and existing evidence.

**Deliverable:** a recoverable starting point and a precise list of restoration changes.

### Phase B — Restore the original harness first

1. Restore the original startup chain: desktop entry → original application shell → conversation workspace.
2. Add the primary **Gen V1** desktop entry using the existing complete personal runtime and original frontend.
3. Use the original personal host and state locations. Do not point the company-only host at the personal application.
4. Preserve the protected installed 0.5.1 application and existing company profiles.
5. Compare the running desktop application with all four supplied screenshots.

The restored interface must retain:

- Project and thread navigation, search and New thread.
- Centered conversation and the original composer.
- Model and reasoning controls.
- Existing settings and theme choices.
- Inline generative interfaces.
- Task plans and workspace panels.
- Existing split, floating and detachable views.

The company overview must open as an optional view within this experience.

**Deliverable:** one clear main Gen entry showing the original harness before the larger extraction proceeds.

### Phase C — Introduce the smallest reusable plug-in boundary

Keep the existing React interface and component catalog. Add a small, typed extension boundary.

**Public interfaces:**

- `PluginManifest`: plug-in identity, version, API version, compatible Gen versions, frontend entry and host entry.
- `registerPlugin`: registers workspace navigation, a conversation adapter, optional panels and host-validated window behavior.
- A conversation adapter for loading conversations, sending messages, submitting artifact actions and cancellation, with explicit capability availability.

The original personal adapter continues to dispatch existing personal commands.

The company adapter dispatches only company operations through the private company host.

Important integration changes:

1. Separate presentation from personal command dispatch in the existing composer and artifact renderer.
2. Reuse those presentation components for the company manager.
3. Replace company-specific assumptions in public workspace/window contracts with generic plug-in references.
4. Keep company identity, project checks and operation authorization in the private implementation.
5. Preserve native sender, origin and window ownership checks.

Selecting the company manager must never silently start a personal runtime or borrow a personal account.

**Deliverable:** the original harness runs normally without any company plug-in installed.

### Phase D — Build the private company plug-in

Create **Gen-Company** as a private repository with this organization:

```text
plugin/       Company UI, adapters, clients, contracts and host integration
control/      Existing company backend, moved with its working behavior intact
fixtures/     Reusable company test applications
docs/         Private company plans, configuration guidance and migration records
```

Move existing implementation into these locations. Preserve the current backend and its authoritative records.

Inside Gen:

- The company manager appears as a conversation in the existing workspace.
- Company tasks and evidence use existing generative cards and panels.
- Company status is compact and uses plain language.
- Technical details are available through an optional disclosure.
- Existing company drafts, notes, cached records and window placement remain recoverable.
- Send reflects actual company capabilities. Missing access produces a clear explanation.

Install the first private plug-in as a separate versioned package through the trusted host. Keep credentials outside the package and browser.

**Deliverable:** the private plug-in opens within the original Gen interface, with honest connection and action states.

### Phase E — Complete the repository separation

1. Build the public harness using an explicit source/package allowlist.
2. Remove company-specific imports, host entrypoints, schemas, generated validators and assets from the public build.
3. Inspect the resulting JavaScript, native bundle, packaged host files and source maps.
4. Review Git history, branches, releases and GitHub-hosted artifacts before making Gen-V1 public.
5. Retain existing history where it passes review. If private material exists in that history, preserve a private backup and prepare a clean public history.
6. Verify both repositories from fresh checkouts.

The public harness must build and run without access to Gen-Company.

The private repository must build against the documented public plug-in API without copying or replacing the harness interface.

**Deliverable:** independently buildable public harness and private company package.

### Phase F — Add automatic stable-release updates

Use the existing Electron Builder/NSIS packaging and its supported updater integration. Add **electron-updater 6.8.11**, compatible with the currently installed builder dependency family; retain the existing builder version.

Default behavior:

- Check on startup and every six hours while Gen is open.
- Use published stable releases from **Skytuhua/Gen-V1**.
- Ignore main-branch commits, drafts and prereleases.
- Download available updates automatically.
- Apply during a controlled normal close or requested restart, after saved-state flushing and backend shutdown.
- Defer installation during active work or operating-system shutdown.
- Show simple progress and failure messages through existing settings/notifications.

Use updater-provided release metadata and integrity verification. Preserve supported signature verification. The existing NSIS target supports this integration. [Official updater documentation](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)

Public updates must preserve the separately installed private plug-in. Check declared compatibility before applying an update; retain the working version if the installed plug-in requires an update first.

Private plug-in installation remains separately versioned initially. Cloud employee runtime updates continue through the controlled Maritime rollout.

Existing installations require one initial upgrade to obtain the updater.

**Deliverable:** a demonstrated installed-version update that preserves user data and the private plug-in.

### Phase G — Retire the old company repositories

**Do not delete either repository immediately.**

`hermes-swarm-control` contains the working backend on its development branch and an active pull request. Preserve that work in `Gen-Company/control`.

`hermes-swarm-smoke-test` contains a small checklist application. Current publisher code, tests and evidence still reference it. Preserve the useful fixture under `Gen-Company/fixtures`.

Before deletion:

1. Preserve all branches, tags and relevant pull-request history in verified backups.
2. Carry current backend changes into the private repository.
3. Update active repository references, CI configuration and fixture permissions.
4. Keep historical evidence unchanged; record where the migrated source now lives.
5. Verify that the existing local company service and E01 deployment do not depend on the old repository locations.
6. Confirm fresh-checkout builds and relevant integration tests pass.

Once these conditions establish that the old repositories are unnecessary, delete them under the owner’s existing conditional authorization.

**Deliverable:** the two agreed repositories, with the company’s useful code and history preserved.

## 4. Acceptance checks

### Original interface

- Dark and light views match the supplied design in structure, spacing and controls.
- Settings, model picker, thread navigation, composer and generative cards remain usable.
- Narrow windows remain readable.
- Split, floating and native detached views retain state.
- Close/reopen preserves chats, drafts, notes, themes and window placement.

### Plug-in boundary

- Gen works without the private plug-in.
- Installing the plug-in adds company functionality within the existing shell.
- Company actions cannot reach personal commands or credentials.
- Disabled, expired and unavailable capabilities produce truthful states.
- Removing the plug-in preserves company data and leaves the harness usable.

### Repositories and packaging

- Public checkout and installer contain no private company implementation or credentials.
- Private checkout builds the plug-in and existing backend successfully.
- Old-repository references are resolved before deletion.
- Backups can restore the migrated source.

### Updates

- An installed version updates to a newer stable release.
- Prereleases and main-branch changes are ignored.
- Interrupted downloads and failed verification leave the working application usable.
- Updating preserves profiles, drafts, layouts and plug-in files.
- An incompatible plug-in prevents an unsafe update.
- Installed update verification requires a suitable isolated Windows target; source tests alone do not satisfy it.

### Company operation

Repository migration must preserve the existing E01 host, Store, approvals and budgets. Authentication, accounting and transport blockers remain separate work; interface restoration does not depend on clearing them, and does not establish that employees are operational.

## 5. Completion and handoff

The new implementation thread should deliver these checkpoints in order:

1. **Original harness restored and visibly compared with your screenshots.**
2. **Company manager integrated as a private plug-in.**
3. **Two repositories verified independently.**
4. **Stable-release updating demonstrated.**
5. **Obsolete repositories safely retired.**

Each checkpoint must state what you can actually open and use, with remaining limitations stated plainly.

This document is the implementation handoff. No repository deletion, public visibility change or migration has been performed during planning.
