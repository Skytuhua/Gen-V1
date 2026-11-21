# Design plan: Paste images into the composer — visual, feedback and motion spec (T05)

## META

| Field | Value |
|---|---|
| Feature | Pasted-image attachment chip: thumbnail, uploading feedback, failure state, motion |
| Size | small (`feature`, `small`) |
| Repository | skytuhua-org/Gen-V1 |
| Plan revision | r1, 2026-11-21 (UTC) |
| Baseline | `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52` |
| Companion plan | [`docs/agent-plans/composer-image-paste.md` @ `2ca9c2a`](https://github.com/skytuhua-org/Gen-V1/blob/2ca9c2a4f4fcdfd01e814ccede31980f9bcebf37/docs/agent-plans/composer-image-paste.md) — behavior, data and wiring (T01–T04). This document is the T05 design hand-off it defers to (its R9). |
| Issue | https://github.com/skytuhua-org/Gen-V1/issues/1237 |
| Implementation status | NOT_STARTED. Design only; no code changes in this PR. |
| Provenance | Written by the front end team worker `devin-cloud-830028e9` from read-only source inspection at the baseline SHA: `ComposerAttachments.tsx`, `App.tsx:391–454`, `composer-entry.css`, `styles.css:161–165,354–369`, `packages/ui-shell/tokens.css:20–39`, `DESIGN.md` motion/attachment rows. |

## OBJECTIVE

Define every visible state, layout value, token, string and motion value for the pasted-image attachment experience so the implementing worker makes **zero** design decisions. Scope: the image attachment chip (thumbnail variant), the immediate paste/uploading feedback (pending chips in the existing attachment band), the failure state, entry/exit choreography, accessibility announcements, and reduced-motion fallbacks. Behavior (what `upload()` does, names, sizes) is the companion plan's; this document changes none of it.

**Measurable success.**
1. On an image-only paste, one pending chip per image appears in the attachment band within one frame (no waiting on the network), each showing a real thumbnail of the pasted image.
2. On `resource.upload` completion the pending chip becomes an attached chip in place: spinner crossfades to the read-only lock, one 240ms ring flash, and an `aria-live` "Attached …" announcement.
3. A rejected image (oversized, upload error) flips its chip to a failed state, exits via `ui-item-out`, and the existing `.composer-error` explains the failure.
4. Under Reduced motion, all spatial travel, stagger and the ring flash are removed; feedback is ≤80ms opacity plus text announcements only.

## REQUIREMENTS

### In scope (decided)

- **D1 — Thumbnail chip variant.** Image attachments render a 20×20px live thumbnail of the pasted/dropped/picked file inside the existing `.resource-chip`, not a generic `<File>` icon.
- **D2 — Immediate pending state.** Each image gets a pending chip in `.resource-strip` in the same frame as the paste, before `upload()` resolves. No toast, no composer-overlay, no progress bar — the chip is the feedback, consistent with DESIGN.md ("the attachment row … present only with attachments" and immediate control response).
- **D3 — In-place resolution.** Pending → attached is an in-place state change of the same chip element (thumbnail and label do not move), with spinner→lock crossfade and one success ring flash.
- **D4 — Failed state.** A file `upload()` rejects gets `data-state="failed"`, shows the danger icon, then exits; earlier successful files in the same paste stay as attached chips.
- **D5 — Staggered multi-image entry.** Pending chips for multiple images in one paste enter with the DESIGN.md list stagger (30ms, ≤150ms delay).
- **D6 — Same visuals for every image entry point.** Paste, drag-and-drop and the Attach files picker share this chip/pending design when the file's `type` is `image/png`, `image/jpeg`, `image/gif` or `image/webp` — identical to the companion plan's `pastedImageTypes` (R4). Non-image files keep the existing `<File>` chip with no thumbnail and no pending chip.
- **D7 — Object-URL thumbnails.** Thumbnails come from `URL.createObjectURL(file)` created at input time. No host read, no new endpoint, no re-encode.
- **D8 — Accessibility.** Pending/attach/ fail transitions announce through the existing `sr-only` `aria-live` region pattern already used at `App.tsx:444`.

### Out of scope (unchanged or the other team's)

- Anything `ComposerAttachments` already does: band open/close height animation, `data-leaving` exit replay, excerpt chips, lock semantics.
- Behavior: paste detection, text-first rule, naming, 20 MiB check, `resource.upload`, `ensureThread` (companion plan T01–T03).
- New endpoints, `ResourceGrant` schema changes, persisted thumbnails after reload (see D7/F3 fallback).
- Chip removal, image lightbox/preview, per-message attachments.

## REPO_MAP (verified at baseline)

| Path | Role |
|---|---|
| `apps/web/src/ComposerAttachments.tsx:10–29` | Attachment band + `.resource-chip` rendering; chip is `File 12px` + label + conditional `<Lock size={10}>`; exit replay via `data-leaving`; hidden until `attachments.length` is nonzero. **Edit point for pending chips + thumbnail variant.** |
| `apps/web/src/App.tsx:391–404` | `upload(files)` — sequential `resource.upload`, then `refresh()`. Throws per file. **Call site feeds pending state; function itself unchanged.** |
| `apps/web/src/App.tsx:424,431,446` | Drop handler, `onPaste` point, file-input change — the three `upload()` entry points. |
| `apps/web/src/composer-entry.css:4–7` | `.composer-attachment-band` / `.composer-attachment-clip` / `.resource-strip` (wrap, `max-height:128px`, thin scroll, `padding-bottom: var(--ui-space-2)`). |
| `apps/web/src/styles.css:161–165` | `.resource-chip` base (1px `var(--border)`, `padding:4px 7px`, `border-radius:6px`, `max-width:220px`, ellipsis), `.composer-error`, `.composer-hint`, `.composer.dragging`. |
| `apps/web/src/styles.css:346–369` | `@keyframes spin`, `ui-item-in` (opacity 0→1, `translateY(4px)`→0), `ui-item-out` (→opacity 0, `translateY(3px)`), chip enter/leave bindings, forced-reduced-motion block binding `.resource-chip` to `ui-popover-fade` at `--ui-motion-press`. |
| `apps/web/src/shell.css:77` | `.resource-chip` font-size: 12px. |
| `packages/ui-shell/tokens.css:20–39` | `--ui-ease-enter`, `--ui-ease-move`, `--ui-motion-insert` 180ms, `--ui-motion-remove` 140ms, `--ui-motion-stagger` 30ms, `--ui-motion-status` 160ms, `--ui-motion-success` 240ms, `--ui-motion-press` 80ms. |
| `apps/web/src/task-motion.tsx:9` | `reducedMotion()` — true unless motion policy is `full`. |
| `packages/contracts/index.ts:18` | `ResourceGrant { id, threadId, kind, path, label, writable, createdAt }` — **no mimeType**: the composer must carry the thumbnail itself (D7). |
| `DESIGN.md:29,64–81` | Attachment row present only with attachments; motion token table; reduced-motion rule (no spatial transforms/stagger/shimmer; opacity ≤80ms). |

## DESIGN

### Anatomy — `.resource-chip--image`

```
┌───────────────────────────────────────────┐
│ [20×20 thumb] pasted-image-…-2.png    [◌🔒] │  26px tall, radius 6px
└───────────────────────────────────────────┘
```

| Property | Value |
|---|---|
| Chip | `.resource-chip` + modifier `.resource-chip--image`: `padding:3px 7px 3px 3px; gap:6px;` (everything else inherited: 1px `var(--border)`, `border-radius:6px`, 12px label, `max-width:220px`, ellipsis) |
| Thumbnail | `.resource-chip-thumb`: `width:20px; height:20px; border-radius:4px; object-fit:cover; flex:0 0 auto; background:var(--subtle);` `draggable={false}`, `alt=""`, `aria-hidden="true"` (decorative — the filename is the label) |
| Trailing icon slot | Fixed 12×12px: `data-state="uploading"` → `<LoaderCircle size={12} className="spinning">`; `data-state="attached"` + `!writable` → existing `<Lock size={10} className="resource-chip-readonly">`; `data-state="failed"` → `<AlertTriangle size={12}>` in `var(--danger)`. Exactly one icon mounts; the swap crossfades (below). |
| Title attr | Unchanged pattern: `${resource.path} · ${writable ? 'Approved writes allowed' : 'Read only — the agent can view this file but cannot change it'}`; pending chip title: `${label} · Uploading…` |

### States (exact)

| State | Trigger | Visual |
|---|---|---|
| `uploading` | image passed to `upload()` | pending chip: thumb + label + `LoaderCircle`; `aria-disabled` not needed (chip is non-interactive); enters with `ui-item-in` |
| `attached` | snapshot gains the resource with matching `label` | same chip element keeps thumb + label; spinner→`Lock` crossfade 160ms (`--ui-motion-status`, `--ui-ease-move`); ring flash once |
| `failed` | `upload()` threw for this file (size or host) | thumb stays, trailing icon → `AlertTriangle` `var(--danger)`, chip `border-color:var(--danger)`; holds 700ms, then `ui-item-out` (140ms) unmount; `.composer-error` carries the message |
| leaving | chip removed from resources | unchanged `data-leaving` replay; pending chips never get `data-leaving` — they exit only via failed→`ui-item-out` or successful swap |

### Pending plumbing (wiring the implementer needs)

- `ComposerAttachments` gets an optional prop `pending?: readonly PendingImage[]`; `PendingImage = { key: string; label: string; thumbUrl: string; state: 'uploading' | 'failed' }`. Pending chips render inside the same `.resource-strip`, after the real chips, keyed by `key` (`crypto.randomUUID()` per file at input time). The band renders when `attachments.length || excerpts.length || leaving.size || pending.length`.
- The composer (`App.tsx`) holds `Map<File-key, {file, objectURL}>`: entry created in the same synchronous turn that reads `clipboardData`/`dataTransfer`/input `files`; passed to `upload()` together with its files.
- Resolution matching: when a snapshot resource appears with `kind==='attachment'` and `label ===` the pending entry's final `File.name`, move `thumbUrl` to a `Map<resourceId, thumbUrl>` and drop the pending entry. Real chips render `.resource-chip--image` only when an entry exists in that map.
- `upload()` rejection: the rejecting file's pending entry flips to `failed`, exits after 700ms hold; other pendings continue.
- `URL.revokeObjectURL` on: chip `data-leaving` `animationend` (existing handler), thread switch/composer unmount, and successful send. Reload safety: a thread restored without object URLs renders image attachments as the plain `<File>` chip — no broken `<img>` (decided fallback F3).

### Motion (all values from `tokens.css` / DESIGN.md table)

| Moment | Animation |
|---|---|
| Band opens for first pending chip | Existing band height+opacity open (220ms panel-enter, `--ui-ease-enter`) — free, because band mounts on `pending.length` |
| Each pending chip enter | `ui-item-in` 180ms `--ui-ease-enter`; delay `min(i*30ms, 150ms)` via `animation-delay` per index (`--ui-motion-stagger`) |
| Spinner→lock | 160ms opacity crossfade (`--ui-motion-status`, `--ui-ease-move`) on the 12px icon slot |
| Attach success ring | `@keyframes resource-chip-attach { from { box-shadow:0 0 0 1px var(--ui-focus-ring,#808080); } to { box-shadow:0 0 0 0 rgba(0,0,0,0); } }`, 240ms (`--ui-motion-success`) `--ui-ease-enter`, once |
| Failed hold→exit | 700ms hold, then `ui-item-out` 140ms `--ui-ease-move` |
| Interrupts | All CSS-driven, so retargeting from current geometry is free; a chip that resolves mid-enter keeps its element and continues (D3) |

Reduced motion (`reducedMotion()` or `data-panel-animations="false"`): pending chips appear with the existing `ui-popover-fade` 80ms binding (already applies to `.resource-chip`); no stagger, no `translateY`, no ring flash, no 700ms delay (failed chips exit immediately); spinner keeps its `spin` (functional status, not decoration); the aria-live announcements are the feedback.

### Accessibility & copy (exact strings)

- `aria-live` region (reuse `App.tsx:444` pattern): `"Uploading {label}"` on pending mount; `"Attached {label}"` on resolve; on failure the existing `.composer-error` (`role="alert"`) announces — no extra text.
- `role="group" aria-label="Attachments"` already on the band; pending chips are `aria-hidden` false but get `data-state` so tests can target them; the spinner icon has `aria-label="Uploading"` on a wrapper `<span role="status">`? No — the aria-live text covers it; icon is `aria-hidden`.
- Keyboard/focus: chips are not focusable today; unchanged.
- Privacy note: the thumbnail is visible immediately — that IS the consent point the companion plan names (Privacy section).

## EXECUTION_DAG

| ID | Goal | Depends on | Owner boundary |
|---|---|---|---|
| F01 | Thumbnail chip + pending plumbing | companion plan's `upload()` shape | `ComposerAttachments.tsx`, `composer-entry.css`, `styles.css` (chip rules + `resource-chip-attach` keyframes), `App.tsx` (pending map + pass-through) |
| F02 | State transitions + motion + a11y strings | F01 | same files |
| F03 | Tests | F02 | `tests/content-motion.test.ts` (regression) + new focused checks in the paste spec (`composer-image-paste.spec.ts`): pending chip visible pre-resolve, `data-state` transitions, failed exit; reduced-motion run asserts no `translateY`/stagger |

## VALIDATION

| Req | Check |
|---|---|
| D1 thumb | e2e: pasted PNG shows `<img>` 20×20 with `object-fit:cover`, `alt=""` |
| D2 pending | e2e: chip in DOM before `resource.upload` response is awaited (dispatch paste, assert `.resource-chip--image[data-state="uploading"]` synchronously) |
| D3 resolve | e2e: after refresh, same key has `data-state="attached"`, lock icon, spinner gone |
| D4 fail | e2e: >20 MiB → `data-state="failed"` → unmounted, `.composer-error` visible |
| D5 stagger | DOM order + computed `animation-delay` ≤150ms |
| D8/reduced | `reducedMotion()` path: no transform in computed style; announcements present |
| Regression | `tests/content-motion.test.ts`, chip `data-leaving` replay, non-image attachments unchanged |

## STATE

- Researched/decided: all of the above (r1). Implemented: nothing. Verified: nothing.
- Open risks: (1) object-URL matching is by `label`; two identical filenames in one paste are distinguished by key order — companion plan's `-2`/`-3` suffixes make labels unique, so matching stays safe. (2) Rapid paste of the same screenshot twice produces two labels differing only by suffix — fine, same rule.
- Next step: implementing worker merges this into the T05 scope (separate PR per companion plan) or folds F01–F03 into the same feature PR if the maintainer prefers.

## REFERENCES

- Companion behavior plan: `docs/agent-plans/composer-image-paste.md` @ `2ca9c2a` (R9 names this document).
- Motion tokens: `packages/ui-shell/tokens.css`; `DESIGN.md:64–81`; attachment row rule `DESIGN.md:29`.
- Existing chip/exit mechanics: `ComposerAttachments.tsx`, `styles.css:354–369`.
