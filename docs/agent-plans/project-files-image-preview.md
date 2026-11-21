# Plan: Image preview in project Files

> **Design ownership (batch 8).** No separate front end team designs this feature. This plan specifies the visual design and the animation itself (section VISUAL_DESIGN_AND_MOTION), and implementers build exactly that. **When implementation is finished, the implementing agent sends the finished work to the front end team for review** (task T07). This issue stays open until that review is recorded on it.

## META

| Field | Value |
|---|---|
| Feature | Image preview in project Files: picking a PNG, JPEG, GIF, WebP or SVG file in the project Files pane shows the image (Fit / 100% toggle, pixel size, file size) instead of "Binary file; no text preview." |
| Size | small (labels `feature`, `small`); one issue, no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue |
| Plan file | `docs/agent-plans/project-files-image-preview.md` (identical to this body below the file link; SHA-pinned link at the top of the issue) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `8fa907f378127bcfc23d71b55c53625ffc43e8da` (verified by clone and `git rev-parse origin/main` on 2026-11-21) |
| Existing work | None for this feature. Searched issues for "image preview": the only hits are [#1237](https://github.com/skytuhua-org/Gen-V1/issues/1237) (paste images into the composer) and [#1311](https://github.com/skytuhua-org/Gen-V1/issues/1311) (generate and edit images in a thread); neither previews project files. Related: [#1583](https://github.com/skytuhua-org/Gen-V1/issues/1583) (Render Markdown previews in project Files) edits the same `ProjectFiles.tsx` preview branch (see D9). |
| Implementation status | NOT_STARTED. Planning only; no code written |
| Source provenance | Feature proposal batch 8, item 1 ("Image preview in project Files", small), filed directly under the maintainer's standing instruction (no approval step); static repository research at the baseline SHA (line numbers below refer to it); public prior art: [openai/codex#49891](https://github.com/openai/codex/issues/49891), [openai/codex#56692](https://github.com/openai/codex/issues/56692). Decisions marked **DECIDED** were made by the planner; the owner delegated every non-approval decision. |

## OBJECTIVE

**User problem.** The project Files pane (Workspace panel → Files, project source) previews text only. Any file whose first MiB contains a NUL byte is reported as `binary` by the host and the pane shows the single line "Binary file; no text preview." (`apps/web/src/files/ProjectFiles.tsx:165–168`). Every PNG, JPEG, GIF and WebP in a project therefore shows nothing, so a user who asks the agent to change an icon, a screenshot fixture or a generated chart cannot look at the result inside Gen and has to open File Explorer. SVG files contain no NUL, so today they show as raw XML text, with no way to see the drawing. Images larger than 1 MiB fail outright, because the host read is capped at 1 MiB (`packages/workspace/tools.ts:204`, `readBoundFile(target, 1024*1024)` throws `RESOURCE_LIMIT`). Codex users asked for exactly this ("preview local images in the file viewer", [openai/codex#49891](https://github.com/openai/codex/issues/49891), [openai/codex#56692](https://github.com/openai/codex/issues/56692)).

Gen already has an image preview for **granted** files (`apps/web/src/files/GrantedFiles.tsx`, `GrantedImage`, `<img src=blob:...>`, 10 MiB cap), so the pattern and its limits are proven in this codebase; project Files never got it.

**Intended behavior.**
1. Selecting `logo.png` in project Files shows the image centered in the preview area, scaled down to fit (never scaled up beyond 100%), on a checkerboard that makes transparency visible.
2. A small toolbar above the image shows `Fit` / `100%` (a two-button toggle), the pixel size (`512 × 512 px`) and the file size (`24.1 KB`).
3. `100%` shows the image at its natural pixel size; the area scrolls in both directions when it is larger than the pane.
4. SVG files open as an image by default, with a third toggle `Source` that shows the existing text view (the current SVG behavior).
5. Images up to 10 MiB preview; above that, or when the bytes are not a valid image, a plain message explains why and the SHA-256 line still shows.
6. Refresh, Project Search jumps, folder navigation and stale-response protection keep working exactly as today.

**Measurable success.**
1. Route tests: the new image route returns the exact bytes with the allowlisted `Content-Type` for each of the five formats, and rejects paths outside the worktree, `.git` paths, non-image extensions, mismatched magic bytes and files over 10 MiB, with the error codes in R03 (T02).
2. Browser: with route mocks, selecting a PNG shows an `img` with accessible name equal to the file name, the size line `2 × 2 px · 70 B`, and the toggle; pressing `100%` sets `aria-pressed="true"` on it; an SVG shows an image and its `Source` toggle shows the XML text; a 404/413 response shows the matching message (T05).
3. No regression in `tests/e2e/shared-panels.spec.ts` (including "directory navigation rejects a file response from the previous selection"), the Project Search specs, the UI guard (`pnpm test:ui-guard`) and `pnpm lint`.

## REQUIREMENTS

### In scope (each maps to tasks and acceptance rows)

- **R01 Formats.** Preview by file extension, case-insensitive: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`. **DECIDED** (D1): extension picks the path; the host then verifies magic bytes for raster formats (R03). No AVIF, BMP, ICO, TIFF, HEIC in v1.
- **R02 Client routing.** In `ProjectFiles.tsx`, when the selected entry's name matches R01, the preview uses the image read (R04) instead of the text read. Other files keep the current text read and current UI unchanged (including "Binary file; no text preview." for other binaries).
- **R03 Host image route.** New read-only route `GET /api/projects/:projectId/file/image?path=<relative>&threadId=<id>` in `apps/server/workspace-routes.ts`, next to the existing `/file` route (`:70`), behind the same host/origin/cookie/CSRF hooks as every route registered in `registerWorkspaceRoutes`. It calls a new `projects.fileImage(projectId, threadId, path)` in `packages/workspace/tools.ts` that reuses the **exact** path checks of `file()` (`tools.ts:204`: `pathName.parse`, `realpath`, `inside`, `gitSegment` on both the resolved and the requested path, `withPathGuard` read-only leaf) and reads with `readBoundFile(target, 10 * 1024 * 1024)`.
  - Extension → MIME allowlist: png `image/png`, jpg/jpeg `image/jpeg`, gif `image/gif`, webp `image/webp`, svg `image/svg+xml`. Any other extension → `HarnessError('INVALID_INPUT', 'This file type has no image preview.')`.
  - Magic bytes (raster only): PNG starts `89 50 4E 47 0D 0A 1A 0A`; JPEG `FF D8 FF`; GIF `GIF87a` or `GIF89a`; WebP `RIFF????WEBP` (bytes 0–3 `RIFF`, 8–11 `WEBP`). Mismatch → `HarnessError('UNSUPPORTED', 'This file is not a valid <PNG|JPEG|GIF|WebP> image.')`. SVG: the first 4 KiB decoded as UTF-8 must contain `<svg` (case-insensitive) and no NUL byte, else the same `UNSUPPORTED` error with "SVG".
  - Over 10 MiB → the existing `RESOURCE_LIMIT` from `readBoundFile`; the route maps nothing new, the client shows R06 text by error code.
  - Response headers, **DECIDED** (D2), same as `/api/resources/:id/content` (`apps/server/server.ts:313`) plus nosniff: `Content-Type: <allowlisted MIME>`, `Content-Security-Policy: sandbox; default-src 'none'`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `X-File-Sha256: <hex sha256 of the bytes>` (so the client keeps the checksum line without a second read).
- **R04 Client image read.** New function `readProjectImage(base, query, path, signal)` in a new `apps/web/src/files/project-image.ts`, used through the existing `useFilesRead` hook so key/generation/abort behavior (stale-response protection) is identical to text reads. It fetches with `authenticated(() => fetch(..., { credentials: "same-origin", cache: "no-store", signal }))`, rejects non-OK responses by reading the JSON error the same way `read()` in `apps/web/src/api.ts` does (DISCOVERY in T03: confirm `read()` throws an `ApiError` carrying `code`; `useFilesRead` already reads `errorCode`), checks `Content-Length` ≤ 10 MiB before reading the body, reads the body as a `Blob`, re-checks `blob.size`, and returns `{ blob, sha256, bytes }`.
- **R05 Image view.** New component `ProjectImagePreview` in `apps/web/src/files/ImagePreview.tsx`: creates an object URL from the blob in an effect and revokes it on change/unmount (same as `GrantedImage`, `GrantedFiles.tsx:205–212`); renders `<img alt={file name} decoding="async" draggable={false}>`; on `load`, reads `naturalWidth`/`naturalHeight` for the size line; on `error`, replaces the image with the R06 "could not be decoded" message. Toolbar per VISUAL_DESIGN_AND_MOTION. The SHA-256 line (`files-checksum`) stays under the preview for images too.
- **R06 Messages (exact text).**
  | Case | Message |
  |---|---|
  | `RESOURCE_LIMIT` or client size check | `Image preview is limited to 10 MiB.` |
  | `UNSUPPORTED` | the host message, e.g. `This file is not a valid PNG image.` |
  | `img` `error` event | `This image could not be decoded.` |
  | `CAPABILITY_DENIED` / other | existing error text from the host, with the existing Retry button (`FilesView.tsx` preview error block) |
- **R07 SVG safety and Source view.** SVG is shown **only** through `<img src=blob:...>` (scripts, external loads and event handlers never run in `<img>` context) and never inserted as inline DOM or via `dangerouslySetInnerHTML`, `<object>`, `<embed>` or `<iframe>`. The `Source` toggle switches to the existing text read (`/file`, `<pre>`) for the same path; the choice resets to `Fit` when another file is selected. **DECIDED** (D3).
- **R08 Project Search jumps.** When a Project Search text match opens an `.svg` file (matches are text-only, `selectedMatch.kind === "text"`), the preview opens in `Source` mode so the matching-line highlight still works (`ProjectFiles.tsx:96–110`). Raster files never produce text matches (the search reports them as `binary`, `tests/e2e/project-search-fixture.tsx:106`).
- **R09 Refresh.** The pane's Refresh button and re-selecting the same file re-run the image read (via `preview.refresh()` as today) and keep the previous image visible with the existing "Refreshing…" status until the new one arrives.
- **R10 Accessibility.** The image has `alt` = file name. The toggle is a group (`role="group"`, `aria-label="Image zoom"`) of buttons with `aria-pressed`. The size line is plain text, not live. Keyboard: the preview content region is already focusable (`tabIndex={0}`); arrow keys scroll it at 100% (native overflow scrolling). Checkerboard and outline remain visible in `forced-colors: active` (see VISUAL_DESIGN_AND_MOTION).
- **R11 Performance.** One request per selection; no thumbnails in the file list; the object URL is revoked on every change; `decoding="async"`. Images above 10 MiB are never downloaded in full (the host refuses before allocating; the client checks `Content-Length`).

### Out of scope

- Editing, rotating, cropping or annotating images; zoom levels other than Fit and 100%; pinch/wheel zoom; pan by drag.
- Thumbnails in the file list; image previews in Project Search results; previews in diffs or checkpoints.
- Formats outside R01; animated-frame controls (GIF and animated WebP play as the browser plays them in `<img>`).
- Changing Granted Files (`GrantedFiles.tsx`); it may later reuse `ProjectImagePreview`, but not in this issue.
- Rendered Markdown preview ([#1583](https://github.com/skytuhua-org/Gen-V1/issues/1583), separate issue).

### Decisions

- **D1** Extension decides whether to try the image path; host magic-byte check decides validity. Rationale: the text read already reads the whole file; sniffing on the client would need a second request for every binary.
- **D2** A new route rather than extending `/file`'s JSON (base64 would inflate 10 MiB to ~13.3 MiB of JSON and keep the 1 MiB text cap tangled with images). Headers copy the granted-resource route, which is already reviewed for safe inline serving.
- **D3** SVG via `<img>` only, plus a Source toggle that keeps today's text view reachable.
- **D4** 10 MiB cap, same as `GrantedFiles.tsx` (`limit = image ? 10 * 1024 * 1024 : ...`).
- **D5** Fit never upscales (`max-width: 100%; max-height: 100%; width/height auto`), so small icons stay crisp at natural size in Fit mode.
- **D6** Checkerboard behind every image (not only transparent ones): detecting alpha would need canvas decoding; the pattern is subtle enough for opaque images.
- **D7** 100% uses `image-rendering: auto` (smooth). No pixelated mode in v1.
- **D8** No new capability flag: the change is read-only, additive and limited to files the pane can already open. If reviewers want a flag, add `workspace.imagePreviewV1` in `packages/core/capability-flags.ts` as a follow-up; not required by this plan.
- **D9** Coordination with [#1583](https://github.com/skytuhua-org/Gen-V1/issues/1583) (Markdown preview): both change the `file.binary ? ... : <pre>` block in `ProjectFiles.tsx`. Whichever lands second rebases; neither may remove the other's branch. The mode toggle component from T04 is generic (`options`, `value`, `onChange`) so the Markdown plan can reuse it for Source / Preview.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Area | Path | What is there today |
|---|---|---|
| Project Files reader | `apps/web/src/files/ProjectFiles.tsx` | `ProjectFile { text: string | null; binary: boolean; sha256 }` (`:19–23`); `readFile` fetches `base + "/file?" + params` and `read<ProjectFile>` (`:66–79`); `useFilesRead` for folder and preview (`:80–85`); binary branch "Binary file; no text preview." (`:165–168`); text `<pre>` with matching-line `<mark>` (`:171–183`); checksum line (`:185`). |
| Shared Files view | `apps/web/src/files/FilesView.tsx` | Toolbar, breadcrumb, folder list, preview `section[aria-label="File content"]` with header (file name, optional Download) and `div.files-preview-content[tabIndex=0][aria-label="File preview"]` that renders pending/error/skeleton and `preview.body`. |
| Read hook | `apps/web/src/files/useFilesRead.ts` | `FilesRead<T> { value, pending, error, errorCode }`; generation + owner key guard so late responses for an old selection are dropped; `refresh()`. |
| Granted image preview (pattern) | `apps/web/src/files/GrantedFiles.tsx` | `GrantedPreview` union with `{ kind: "image"; blob }`; MIME allowlist `^image/(png|jpeg|gif|webp)$`; 10 MiB cap with `Content-Length` precheck and streamed recheck; `GrantedImage` object-URL lifecycle (`:205–212`). |
| Files styles | `apps/web/src/files/files.css` | `.files-preview-content img { display:block; max-width:100%; height:auto; padding:var(--files-inset); margin:auto; }`; `.files-message`, `.files-limit`, `.files-checksum`; container queries at 560px and 400px; `forced-colors` rule for selected rows. |
| Host file read | `packages/workspace/tools.ts:204` | `file(projectId, threadId, relativePath)`: binding, `realpath`, `inside`, `gitSegment`, `withPathGuard(..., readOnly:true)`, `readBoundFile(target, 1024*1024)`, returns `{ text, binary, sha256 }` with `hash(data)`. |
| Bounded read | `packages/core/file-access.ts:145` | `readBoundFile(path, maxBytes, identity?)`: refuses non-files and hard links, throws `RESOURCE_LIMIT` when `size > maxBytes`. |
| Routes | `apps/server/workspace-routes.ts:69–70` | `GET /api/projects/:projectId/files` and `GET /api/projects/:projectId/file` (`querySchema` = `threadId?`, `path?` max 1024). |
| Safe inline serving (pattern) | `apps/server/server.ts:304–315` | `/api/resources/:id/content`: `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: no-store`, `Content-Disposition: inline`, MIME from `mime()` (`server.ts:56`, includes `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`; **no `.gif`**). |
| Blob URLs in desktop | `apps/desktop/main.ts:116` | Navigation/request filter allows `blob:` URLs, which `GrantedImage` relies on. DISCOVERY (T03): confirm no renderer CSP blocks `img-src blob:` in the packaged app (no `img-src` directive for the main app was found by grep at baseline). |
| Motion tokens | `packages/ui-shell/tokens.css:20–31` | `--ui-ease-enter`, `--ui-motion-hover` (120ms), `--ui-motion-press` (80ms), `--ui-motion-status` (160ms), etc. |
| Theme tokens | `apps/web/src/styles.css:3–4` | `--surface`, `--subtle`, `--hover`, `--border`, `--control-border`, `--text`, `--muted`, `--selection-bg`, `--selection-border`, `--danger`, light and dark values. |
| Browser tests | `tests/e2e/shared-panels.spec.ts`, `tests/e2e/shared-panels-fixture.tsx`, `tests/e2e/project-search-fixture.tsx` | Route-mocked project Files tests (`/shared-panels-check?project=1`, `page.route('**/api/projects/project-one/file?*', ...)`, `openSurface(page, panel, 'Files')`). |
| Route tests (pattern) | `tests/workspace-linked-pr.test.ts` | Fastify inject tests for project read routes (`/api/projects/project/...`) with host fixtures; extend or copy for the image route. DISCOVERY (T02): pick the test file that already builds a real temp worktree for `projects.file` (grep `\.file(` / `/file?` in `tests/`). |
| Source manifest | `scripts/public-source-files.json` | Every new source file must be listed (CONTRIBUTING.md). |

## DESIGN

**Data flow.**
1. User selects `assets/logo.png` → `FilesView` calls `onSelect(entry)` → `ProjectFiles` sets `selected`.
2. `ProjectFiles` computes `imageKind = imageKindFor(selected.name)` (`"raster" | "svg" | null`, from `project-image.ts`) and `mode` state (`"fit" | "actual" | "source"`, default `"fit"`, reset in the same handlers that call `setSelected`; `"source"` preset when `selectedMatch?.kind === "text"` and `imageKind === "svg"`).
3. Preview read: `useFilesRead(selected.path + "#" + (useImage ? "image" : "text"), active && !!selected, useImage ? readImage : readFile)` where `useImage = imageKind !== null && mode !== "source"`. Changing the key on mode switch keeps the hook's stale-response guard correct. The two `useFilesRead` calls approach is also acceptable if it keeps one active request; the implementer must keep the "directory navigation rejects a file response from the previous selection" test passing.
4. Host: `GET /file/image` → `projects.fileImage` → path guard → `readBoundFile(10 MiB)` → allowlist + magic bytes → bytes with headers.
5. Client: `Blob` → `ProjectImagePreview` → object URL → `<img>` → `load` gives natural size.

**Contracts.** No `packages/contracts` change: the route returns raw bytes, errors use existing `HarnessError` codes (`INVALID_INPUT`, `UNSUPPORTED`, `RESOURCE_LIMIT`, `CAPABILITY_DENIED`, `NOT_FOUND`). DISCOVERY (T02): confirm `UNSUPPORTED` is an existing `HarnessError` code (it is used in `apps/server/code-intelligence-routes.ts:56`) and how it maps to HTTP status in the server error handler.

**Sketch (host, illustrative; follow the file's existing compact style).**

```ts
// packages/workspace/tools.ts, beside file()
async fileImage(projectId: string, threadId: string | undefined, relativePath: string) {
  const type = IMAGE_TYPES[extname(relativePath).toLowerCase()];
  if (!type) throw new HarnessError('INVALID_INPUT', 'This file type has no image preview.');
  // same guard as file(): binding, realpath, inside, gitSegment, withPathGuard read-only leaf
  const data = await readBoundFile(target, 10 * 1024 * 1024);
  if (!matchesSignature(type, data)) throw new HarnessError('UNSUPPORTED', `This file is not a valid ${type.label} image.`);
  return { bytes: data, mime: type.mime, sha256: hash(data) };
}
```

**Security boundaries.** Same authorization and path rules as the text read (no new reachable files). Response is never HTML; SVG carries `CSP: sandbox; default-src 'none'` and `nosniff` so opening the URL directly cannot run script; in-app it is only used as `<img>`. Object URLs are revoked. No new network egress.

**Rollback.** Revert the PR; no stored data or schema changes.

## VISUAL_DESIGN_AND_MOTION

Specified here because there is no separate design team; implement exactly, using existing tokens.

**Layout (inside `.files-preview-content`).**
- New wrapper `.files-image` (column flex, fills the content area: `min-height: 100%`).
- **Toolbar** `.files-image-bar`: sticky top (`position: sticky; top: 0; z-index: 1`), `display: flex; align-items: center; gap: 12px; padding: 8px var(--files-inset); border-bottom: 1px solid var(--border); background: var(--surface)`.
  - Left: the mode toggle `.files-mode-toggle` — inline-flex, `border: 1px solid var(--control-border); border-radius: 6px; padding: 2px; gap: 2px`. Buttons: `min-height: 24px` (overrides the 32px Files button rule only inside the toggle), `padding: 2px 8px; font-size: 12px; border-radius: 4px; color: var(--muted)`. Pressed button: `background: var(--selection-bg); color: var(--text); box-shadow: inset 0 0 0 1px var(--selection-border)`. Labels: `Fit`, `100%`, and for SVG `Source`.
  - Right (`margin-left: auto`): `.files-image-meta`, `font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap`. Text: `512 × 512 px · 24.1 KB` (multiplication sign U+00D7 written as the literal character, middle dot U+00B7). Before `load`, only the file size shows. File size format: bytes < 1024 → `N B`; < 1 MiB → one decimal `KB`; else one decimal `MB` (1024-based, unit labels `KB`/`MB` as in the rest of Files UI which shows raw bytes; use `Intl.NumberFormat` with `maximumFractionDigits: 1`).
  - At container width ≤ 400px the meta text drops the file size (only `512 × 512 px`) so the bar stays one line.
- **Stage** `.files-image-stage`: `flex: 1; display: grid; place-items: center; padding: var(--files-inset); overflow: auto` (in 100% mode `place-items: start` once the image is larger than the stage, done by `justify-content: safe center; align-content: safe center`).
- **Checkerboard**: on the `img` itself (so it hugs the image box), 8px squares:
  `background-color: var(--surface); background-image: conic-gradient(var(--subtle) 25%, transparent 0 50%, var(--subtle) 0 75%, transparent 0); background-size: 16px 16px;` — light theme gives #fff/#f5f5f5, dark gives #0f0f0f/#171717, both subtle.
- **Image box**: `outline: 1px solid var(--border); outline-offset: 0; border-radius: 2px` (sharp enough not to clip pixels visibly). Remove the old `padding` from `.files-preview-content img` for this component only (use the class `.files-image-stage img`; keep the existing rule for Granted Files).
- **Fit**: `max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain` (never upscales, D5). The stage needs a definite height for `max-height` to work: `.files-image` is `height: 100%` within the scroll container.
- **100%**: `max-width: none; max-height: none; width: <naturalWidth>px; height: <naturalHeight>px` via inline style after `load` (SVG without intrinsic size: browsers report 150×300 or 0; if `naturalWidth === 0` treat as 300×150 and show meta `SVG (no fixed size)`).
- **Messages** (R06) use the existing `.files-message` (and `.files-error` styling only for decode failure). They sit under the toolbar.

**Forced colors.** `@media (forced-colors: active)`: image `outline: 1px solid CanvasText`; checkerboard removed (`background-image: none`); pressed toggle button `outline: 2px solid Highlight; outline-offset: -2px`.

**Motion.** Use existing tokens only.
- Image appear: when a new image finishes loading, fade and settle: `opacity 0 → 1` and `transform: scale(.985) → scale(1)` over `var(--ui-motion-status)` (160ms) with `var(--ui-ease-enter)`. Apply by toggling `data-loaded="true"` on the `img` after `load`; before that the `img` has `opacity: 0` (the size line and skeleton cover the gap). Refresh of the same file does not replay the animation (only key changes do).
- Mode switch Fit ↔ 100%: no animated resize (avoids layout thrash on large images); the pressed state change of the toggle uses `background-color` and `color` transitions over `var(--ui-motion-hover)` (120ms).
- Toggle press: `transform: scale(.97)` on `:active` over `var(--ui-motion-press)` (80ms).
- Reduced motion: under `@media (prefers-reduced-motion: reduce)`, `:root:is([data-motion=reduced],[data-motion=off])` and `.app-shell[data-panel-animations=false]`, use no transform and no fade (the image shows at full opacity on load) and set toggle transitions to `none`, matching the repo pattern in `apps/web/src/composer-toolbar.css:43–44`.

**States summary.**
| State | Toolbar | Stage |
|---|---|---|
| Loading first time | hidden | existing `Loading…` + skeleton |
| Loaded | toggle + meta | image |
| Refreshing | toggle + meta | previous image + `Refreshing…` status |
| Too large / invalid | hidden | message (R06) |
| Decode error | toggle (Source only reachable for SVG) + file size | `This image could not be decoded.` |
| SVG Source | toggle with `Source` pressed | existing `<pre>` text view |

## EXECUTION_DAG

| ID | Goal | Depends | Edits / discovery | Tests (positive / negative) | Done when | Handoff |
|---|---|---|---|---|---|---|
| T01 | Claim and discovery | — | Read this issue fully. Confirm: `UNSUPPORTED` code and HTTP mapping; the test file that exercises `projects.file` on a real temp worktree; no renderer CSP blocks `img-src blob:`; `read()`/`ApiError` exposes `code`. Post findings as a checkpoint comment with file:line | n/a | Comment posted with each answer | T02, T03 |
| T02 | Host route `GET /api/projects/:projectId/file/image` and `projects.fileImage` | T01 | `packages/workspace/tools.ts` (method + `IMAGE_TYPES` + `matchesSignature`), `apps/server/workspace-routes.ts` (route beside `:70`, headers per R03) | Unit/route (vitest, fastify inject, temp worktree): each of PNG/JPEG/GIF/WebP/SVG returns exact bytes, MIME, CSP, nosniff, no-store, `X-File-Sha256`; negatives: `../` path, symlink to outside, `.git/config`, `.txt` → `INVALID_INPUT`, PNG extension with JPEG bytes → `UNSUPPORTED`, SVG without `<svg` → `UNSUPPORTED`, 10 MiB + 1 byte → `RESOURCE_LIMIT`, missing CSRF/origin rejected as for `/file` | Tests pass; `pnpm typecheck` passes | T03 |
| T03 | Client read helper | T02 | New `apps/web/src/files/project-image.ts`: `imageKindFor(name)`, `readProjectImage(...)` (R04), `formatImageBytes(n)`. Add to `scripts/public-source-files.json` | Vitest: `imageKindFor` for each extension and uppercase; `.svgz`, `.ico`, no extension → null; `formatImageBytes(0)` `0 B`, `1023` `1023 B`, `1024` `1 KB`, `24678` `24.1 KB`, `10485760` `10 MB`; read helper rejects `Content-Length` > 10 MiB without reading the body (mock fetch) | Tests pass | T04 |
| T04 | Image view and wiring | T03 | New `apps/web/src/files/ImagePreview.tsx` (`ProjectImagePreview`, generic `FilesModeToggle`); `ProjectFiles.tsx` (mode state, read switch, R08, messages); `files.css` (VISUAL_DESIGN_AND_MOTION). Add new files to the manifest | Covered by T05; local manual check in `pnpm dev` with a real project containing the five formats, light and dark theme | `pnpm lint` and `pnpm test:ui-guard` pass | T05 |
| T05 | Browser tests | T04 | Extend `tests/e2e/shared-panels.spec.ts` (or a new `tests/e2e/project-files-image.spec.ts`, added to the manifest) with route mocks for `**/api/projects/project-one/file/image?*` serving a 2×2 PNG fixture (inline base64 in the spec) and an SVG | Positive: PNG shows `img[alt="logo.png"]`, meta `2 × 2 px · 70 B` (adjust to the fixture's real byte length), `Fit` pressed by default, `100%` toggles; SVG shows image, `Source` shows XML text; Project Search text match on `.svg` opens Source with the matching line. Negative: 413/`RESOURCE_LIMIT` JSON shows `Image preview is limited to 10 MiB.`; `UNSUPPORTED` shows host text; corrupt bytes trigger `This image could not be decoded.`; `.bin` file still shows "Binary file; no text preview."; late image response after folder navigation is dropped; reduced-motion emulation shows no transform | Specs pass with `pnpm build && pnpm test:browser` (or the targeted Playwright command) | T06 |
| T06 | Real-user verification | T05 | Windows x64 source build; open a real project with sample images (include a transparent PNG, a 4000×3000 JPEG, an animated GIF, a WebP, an SVG with an inline `<script>` that would `alert`) | Manual: each previews; the SVG script never runs; 100% scrolls; >10 MiB file shows the limit message; light/dark/high contrast checked | Redacted screenshots posted on this issue | T07 |
| T07 | Front end team review handoff | T06 | Send the finished work (PR link, screenshots in light/dark/forced-colors, a short screen recording of Fit/100%/Source and the load animation) to the front end team for review; record their verdict on this issue and apply requested changes | Front end team review recorded | Review comment on this issue says approved, or follow-up changes are merged | Owner |

Parallel scopes: T02 (host) and T03 (client helper) touch different files and can run in parallel after T01 if the T03 worker mocks the route. T04 depends on both.

## VALIDATION

- **Setup:** Windows x64, Node ≥ 24.10.0, pnpm 10.30.3 (README). `pnpm install`; `pnpm exec playwright install chromium`.
- **Commands:** `pnpm typecheck`; `pnpm lint`; `pnpm test:ui-guard`; `pnpm build:widgets && pnpm exec vitest run <T02 test file> <T03 test file> --maxWorkers=1`; `pnpm build && pnpm test:browser` (or `pnpm exec playwright test tests/e2e/shared-panels.spec.ts` plus the new spec).
- **Fixtures:** smallest valid PNG/JPEG/GIF/WebP byte arrays written by the test to a temp worktree; an SVG `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>`; a 10 MiB + 1 byte file created with `Buffer.alloc`.
- **Regressions:** text preview, matching-line highlight, empty file message, other binaries' message, Granted Files image preview (unchanged), Refresh, stale-response test.
- **Acceptance matrix:**
  | Req | Tasks | Check |
  |---|---|---|
  | R01 | T02, T03 | allowlist unit tests |
  | R02 | T04, T05 | `.bin` still shows binary message; `.png` shows image |
  | R03 | T02 | route tests (bytes, headers, negatives) |
  | R04 | T03, T05 | size precheck test; stale-response spec |
  | R05 | T04, T05 | img alt, meta text, toggle |
  | R06 | T05 | message specs |
  | R07 | T02, T05, T06 | SVG served sandboxed; only `<img>`; script never runs |
  | R08 | T05 | Search jump opens Source |
  | R09 | T05 | refresh keeps previous image |
  | R10 | T05, T06 | roles/aria-pressed; forced colors screenshot |
  | R11 | T02, T03 | no full download over cap; URL revoked (unit: `URL.revokeObjectURL` spy) |
- **Release gate:** all commands above pass in CI, T06 evidence posted, T07 review recorded. None of these tests has been executed yet; they are planned.

## STATE

- Researched/decided: this plan (r1). Implemented: none. Verified: none.
- Owners: none assigned. Branches: none for code.
- Risks: (1) the Markdown preview plan [#1583](https://github.com/skytuhua-org/Gen-V1/issues/1583) edits the same block in `ProjectFiles.tsx` (D9). (2) A renderer CSP added later could block `blob:` images (T01 checks). (3) `mime()` in `server.ts` lacks `.gif`; this plan uses its own allowlist in `tools.ts`, so do not route through `mime()`.
- Exact next step: T01 discovery and claim comment by the first implementing worker.

## REFERENCES

- Prior art / demand: [openai/codex#49891](https://github.com/openai/codex/issues/49891) (local image previews), [openai/codex#56692](https://github.com/openai/codex/issues/56692).
- Repo: `apps/web/src/files/ProjectFiles.tsx`, `FilesView.tsx`, `GrantedFiles.tsx`, `useFilesRead.ts`, `files.css`; `packages/workspace/tools.ts:204`; `packages/core/file-access.ts:145`; `apps/server/workspace-routes.ts:69–70`; `apps/server/server.ts:56,304–315`; `packages/ui-shell/tokens.css`; `apps/web/src/styles.css`; `CONTRIBUTING.md`; `.github/pull_request_template.md`.
- MDN: [`HTMLImageElement.naturalWidth`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/naturalWidth); [SVG as an image (script disabled)](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image); [`URL.revokeObjectURL`](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static).
