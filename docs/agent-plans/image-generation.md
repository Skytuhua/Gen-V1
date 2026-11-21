# Feature plan: generate and edit images in a thread

## META

| Field | Value |
| --- | --- |
| Feature | Image generation (batch 3, item 7, size **medium**) |
| Repository | `skytuhua-org/Gen-V1` |
| Canonical issue | https://github.com/skytuhua-org/Gen-V1/issues/1311 |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified with `git log` at planning time) |
| Implementation status | NOT_STARTED. Planning only; no product code exists for this feature. |
| Related work | #1237 "Feature plan: paste images into the composer" (clipboard image upload; it explicitly excludes native provider image parts). Related, not a duplicate. |
| Labels | `feature`, `medium` |
| Provenance | Batch 3 feature proposal approved by the product owner (Leonardo), code inspection of the baseline, inspection of the `@earendil-works/pi-ai` 1.4.0 package, and the public Codex image-generation docs (References). |
| Planner | `devin-cloud-497b09` |

**Design ownership for this batch.** The product owner said there is no front-end team designing batch 3 features, so this plan specifies the visual design and animation itself (DESIGN section 6). Separately, the product owner asked that the **implementing agent hand the finished work to the front-end team for review when finished**: that is task T10 and a release gate. The front-end team reviews the finished result; it does not design it up front.

## OBJECTIVE

### User problem

Gen users build apps and sites in threads. They often need small visual assets: an icon, a hero image, a placeholder, a mockup of a screen, a sprite. Today they leave Gen, generate the image elsewhere, download it and drag it back. Codex offers built-in image generation (`$imagegen`, model `gpt-image-2`) that uses the same ChatGPT plan Gen already connects, but Gen has no image-generation tool.

### Intended behavior

1. In a thread whose model runs on the ChatGPT / Codex connection, the user asks for an image ("make a 1024x1024 app icon of a paper plane, flat style, transparent background"). The agent calls a new `image_generate` tool.
2. A generated-image card appears in the thread with a loading state, then the image(s). The images are stored as read-only thread attachments and survive reload.
3. The user can open an image full size, attach it back to the composer to edit it ("make the plane orange"), download it, or **Save to project**, which writes a PNG into the project at a path the user confirms.
4. The agent can also save an image into the project, but only through a prepared operation the user approves (the same approval path as other file writes).
5. Errors (no supported connection, usage limit reached, content-policy refusal, network failure, cancellation) show a clear state on the card with the next action.

### Measurable success

- A user on a ChatGPT / Codex connection can generate, edit (with a reference image), preview, and save an image into the project without leaving Gen.
- 100% of project writes from this feature go through either a user click on **Save to project** or an approved prepared operation; zero silent writes (verified by T06/T08 tests).
- Generated images render after thread reload and app restart (T05/T09).
- Stopping the run cancels the provider request within 1 second of the Stop click and leaves no partial grant (T04/T08).
- With the feature flag off, no tool, card, setting or network call related to image generation exists (T02/T08).

## REQUIREMENTS

### In scope

- R1. Agent tool `image_generate` for text-to-image and image-to-image editing with up to 4 reference images.
- R2. Initial backend: the signed-in ChatGPT / Codex subscription connection (`openai` provider; `openai-codex` legacy) using OpenAI's hosted `image_generation` tool with model `gpt-image-2`, **only if** discovery task T01 proves Gen can call it with that connection. No API-key fallback is added by this feature.
- R3. Generated images stored as read-only thread attachments (`ResourceGrant.kind = "attachment"`) with generation provenance, rendered on reload.
- R4. Generated-image card in the thread: loading, result grid (1-4 images), error, cancelled states; full-size viewer; actions Save to project, Edit, Download, Copy prompt.
- R5. Save to project: user-initiated from the card (the click is the approval) or agent-initiated through prepared operation `image.save` that requires approval. New files only by default; overwrite only with an explicit confirmation that shows the existing file.
- R6. Composer attachment chips show a thumbnail for image attachments (generated or uploaded), so "Edit" visibly attaches the image.
- R7. Options: size (`auto`, `1024x1024`, `1536x1024`, `1024x1536`), quality (`auto`, `low`, `medium`, `high`), background (`auto`, `opaque`, `transparent`), count 1-4. The agent picks them; the card shows what was used.
- R8. Usage disclosure: Settings and the first card in each thread state that generations count toward the ChatGPT plan's Codex usage limits and use them 3-5x faster than text turns (per the Codex docs).
- R9. Cancellation, retry, idempotency and stale-result protection (DESIGN section 5).
- R10. Capability flag `media.imageGenerationV1`, default off, plus a user setting "Image generation" (on/off) shown only when the flag is on.
- R11. Accessibility and reduced motion (DESIGN section 6).
- R12. Hand the finished work to the front-end team for review (T10).

### Out of scope

- Mask-based inpainting UI (drawing a mask). Editing is reference-image + instruction only. A mask brush can be a later feature.
- Canvas view / multi-image commenting like the Codex app's "Canvas view". Out for this medium feature.
- Other providers (GitHub Copilot, xAI, OpenRouter, API keys). Pi 1.4.0 registers only an `openrouter-images` image API and Gen has no OpenRouter connection. Adding providers is a later feature.
- Native vision (sending images to the chat model as image parts) beyond what the hosted image tool needs for references. That belongs to #1237's follow-ups.
- Video, animation, SVG/vector generation.
- Bulk generation (more than 4 images per call) and background batch jobs.
- Changing clipboard paste (#1237).

### User flows

**F1 Generate.** User sends "Generate an app icon of a paper plane". Agent calls `image_generate({prompt, size:"1024x1024", quality:"auto", background:"transparent", count:1})`. Card enters `generating`; skeleton tile shows. Provider returns; card shows the image; a short assistant reply follows.

**F2 Edit.** User clicks **Edit** on a generated image. The composer gets that image as an attachment chip with thumbnail and the text "Edit this image: " with the caret at the end. User types "make it orange" and sends. Agent calls `image_generate` with `referenceResourceIds:[<id>]`. New card shows result; the original stays.

**F3 Edit an uploaded image.** User attaches/pastes a PNG (existing upload path) and asks for a change. Same as F2.

**F4 Preview.** User clicks an image. Full-size viewer opens (DESIGN 6.4) with prompt, size, quality, model and created time; left/right arrows move between images of the same card.

**F5 Save (user).** User clicks **Save to project**. Inline popover shows a path field prefilled with `assets/generated/<slug>.png` (slug from prompt, 40 chars max, `a-z0-9-`) and the project name. Enter or **Save** writes the file. If the path exists, the popover shows "A file already exists at this path" with **Replace** (secondary, danger) and **Save as copy** (suffix `-2`, `-3`, ...). Success: button becomes "Saved" with the path linked to the file viewer.

**F6 Save (agent).** Agent calls `image_save_prepare({resourceId, path})`. The existing operation approval card appears ("Save image to assets/hero.png"). Approve writes; Reject leaves nothing.

**F7 Failure.** Card shows the error state with the message from the error table (DESIGN 5.3) and **Retry** where retry makes sense.

**F8 Cancel.** User clicks Stop on the run while generating. Card shows "Cancelled"; no image appears later even if the provider finishes.

**F9 Unsupported.** Thread runs on a non-ChatGPT connection or the setting is off: the tool is not offered to the model. If the user asks anyway, the agent replies that image generation needs a ChatGPT / Codex connection with the setting on (tool description tells it so; no card is created).

### Decisions (agreed in this plan)

| Question | Decision |
| --- | --- |
| Model tool or composer command? | Model tool `image_generate` (matches Codex: natural language, optional `$imagegen`). No new slash command in r1. |
| Providers first | ChatGPT / Codex subscription only, gated by T01. |
| Editing representation | Reference images by granted resource id (thread attachments or generated images), max 4, PNG/JPEG/WebP, 20 MiB each. No mask. |
| Output location | Always a read-only thread attachment; project copy only on Save. |
| Save approval | User click = approval; agent path = prepared operation + approval. |
| Persistence | Grants in the store (existing resource persistence) + card artifact referencing grant ids. |
| Path selection | Relative to the project root, must end `.png`, confined with existing `inside()`/`canonical()` checks, default `assets/generated/`. |
| Options exposure | Agent-chosen via tool args; displayed read-only on the card and viewer. No user option pickers in r1. |
| Usage/limits | Disclosure text (R8) + provider 429 mapped to a "usage limit reached" state. Gen does not count or estimate cost. |
| Safety errors | Provider refusals shown as "The request was declined by OpenAI's content policy" plus the provider's short reason when present; never retried automatically. |
| Progress | Indeterminate. Partial-image streaming only if T01 finds it supported; otherwise none. |
| Bounds | 1-4 images per call, 20 MiB per image, 1 concurrent generation per thread, 120 s timeout. |
| Reduced motion | DESIGN 6.6. |

### Non-functional requirements

- Security: provider credentials never leave the Pi runtime process boundary used for model calls; the server and web never see tokens. Output bytes are validated as PNG/JPEG/WebP by magic bytes, re-encoded or rejected; stored as PNG unless the provider returns another validated type. Resource serving keeps the existing `Content-Security-Policy: sandbox; default-src 'none'` (`apps/server/server.ts:304-313`).
- Privacy: prompts and reference images go only to OpenAI through the user's own connection. Provenance stores a SHA-256 of the prompt plus the prompt text in the card artifact (same thread data as the chat message itself); nothing is logged to telemetry.
- Performance: thread rendering must not decode full images for offscreen cards (`loading="lazy"`, thumbnails via CSS sizing; no new image pipeline).
- Compatibility: no change to existing upload, Image catalog component, or attachment behavior when the flag is off. Store migrations are additive only.

## REPO_MAP

Verified at baseline `e883ac03` unless marked DISCOVERY.

| Path | What is there | Use in this feature |
| --- | --- | --- |
| `packages/contracts/connections.ts` | `SUBSCRIPTION_OAUTH_PROVIDER_IDS = ['openai','openai-codex','github-copilot','xai']`; `openai` labelled "ChatGPT / Codex", `openai-codex` "ChatGPT / Codex (legacy)" | Provider gate for the tool. Connection availability does not prove image entitlement (T01). |
| `packages/runtime-pi/connections.ts` | Connection URL / OAuth handling incl. OpenAI Codex | Read-only reference for auth. |
| `packages/runtime-pi/credentials.ts` | `acquireLiteralCredentialLease(authPath, {signal, maxHoldMs})` (line 93), `createLiteralCredentialStore(authPath)` (line 174) | How the Pi runtime obtains the account credential for a request. |
| `packages/runtime-pi/sdk.ts` | `loadSdk()` dynamic-imports `@earendil-works/pi-coding-agent`, `PI_UNAVAILABLE` error | Pi loading pattern. |
| `packages/runtime-pi/tool-definitions.ts` | `createHostTools()` composes UI, planning, verification, memory, repo-map and domain tools; `loadDomainTools()` imports `../capabilities/index.ts` | Register `image_generate` and `image_save_prepare`. |
| `packages/capabilities/index.ts`, `schemas.ts` | `DOMAIN_TOOLS` from `toolSchemas`; prepared operations such as `pdf_prepare` -> `pdf.export` (lines 141-206); `DomainContext` with resource resolution, operation preparation and write hooks | Pattern for `image_save_prepare` -> `image.save`. |
| `packages/contracts/index.ts` | `ResourceGrant {id, threadId, kind: "project"|"file"|"database"|"export"|"attachment", path, label, writable, createdAt, identity?}` | Add optional `provenance` (T03). |
| `packages/core/service.ts:1225-1233` | `resource.upload`: safe basename, base64 check, 20 MiB limit, writes `<dataDir>/attachments/<threadId>/<commandId>-<name>` with `wx`, read-only attachment grant, idempotent by command id | Extract a shared `storeThreadAttachment` helper (T03). |
| `packages/core/security.ts` | `assertNotStorage, canonical, inside, resolveGrant` | Path confinement for saves. |
| `packages/core/capability-flags.ts` | Flag registry; e.g. `M15_FLAG_KEYS = ["ui.sourceWorkbenchV1"]` (line 93) and its definition `{ key, owner, description }` (line 127) | Add `media.imageGenerationV1` (T02). |
| `apps/server/server.ts:304-313` | `/api/resources/:id/content`: MIME by extension, 20 MiB limit, sandbox CSP | Serves generated images unchanged. |
| `packages/ui-catalog/index.ts` (line 58), `image-compare.ts` | `Image` component (`src` https or `resourceId`); image compare | Reference for the new `GeneratedImages` catalog component (T05). |
| `apps/web/src/registry.tsx` (line 201) | `Image` renders `/api/resources/<id>/content`, `loading="lazy"`, `referrerPolicy="no-referrer"` | Renderer registration for the new component. |
| `apps/web/src/ComposerAttachments.tsx` | Attachment chips (`File`, `Lock` icons), leaving-chip animation honoring `reducedMotion()`, terminal excerpts | Add image thumbnails (T07). |
| `apps/web/src/Artifact.tsx`, `ArtifactPresentation.tsx` | Artifact rendering in the thread | Host the card (T05). DISCOVERY: exact mounting point. |
| `apps/web/src/Settings.tsx`, `settings-registry.ts` | Settings UI and registry | Add the "Image generation" setting (T02). |
| `DESIGN.md` "Motion tokens" | Durations/easings used below | Source of all motion values in DESIGN 6. |
| `@earendil-works/pi-ai` 1.4.0 (transitive via `@earendil-works/pi-coding-agent`) | Exports `generateImages(model, context, options)`, `ImageModel`, `ImageApi`, image API registry. Only API registered in its model catalogs: `openrouter-images`. `openai.models.js` / `openai-codex.models.js` list no image models. | Pi cannot generate images through the ChatGPT connection out of the box. T01 decides the call path. |
| `tests/` | Unit (`node --test`/vitest per CONTRIBUTING) and Playwright e2e | DISCOVERY: copy the nearest existing test style (e.g. resource upload tests, operation approval e2e) in each task. |

No open PR or issue implements image generation (issue search at planning time).

## DESIGN

### 1. Architecture

```
model --tool call--> image_generate (host tool, runtime-pi)
   runtime-pi: validate args, resolve reference grants (core), acquire credential lease
   runtime-pi -> OpenAI hosted image_generation (ChatGPT/Codex connection)  [path proven in T01]
   runtime-pi -> core: storeGeneratedImages(threadId, commandId, images, provenance)
   core: validate bytes, write attachments, create grants, emit card artifact update
web: GeneratedImages card <- artifact {state, resourceIds, options}
web Save to project -> command image.save -> core writes into project grant
model image_save_prepare -> prepared op image.save -> approval -> core writes
```

### 2. Provider call (decided shape, proven in T01)

OpenAI's documented way to use `gpt-image-2` in a conversation is the Responses API hosted tool:

```json
{
  "model": "<the thread's ChatGPT/Codex text model>",
  "input": [{"role": "user", "content": [
    {"type": "input_text", "text": "<prompt>"},
    {"type": "input_image", "image_url": "data:image/png;base64,<reference>"}
  ]}],
  "tools": [{"type": "image_generation", "size": "1024x1024", "quality": "auto", "background": "transparent"}],
  "tool_choice": {"type": "image_generation"}
}
```

The response carries `image_generation_call` output items whose `result` is base64 image data (and `revised_prompt` when present). Count > 1 is done as N sequential calls (the hosted tool returns one image per call), stopping on the first error.

T01 must establish, with a real signed-in ChatGPT account, which of these works and record the evidence on the issue:
- A. Pi 1.4.0's OpenAI Codex transport accepts extra hosted tools / raw request options for a one-off request.
- B. A direct `fetch` from runtime-pi to the same endpoint Pi uses for the `openai` connection, reusing the credential lease, with the request above.
- C. Neither works (endpoint rejects the tool for subscription accounts).
Decision rule: prefer A, else B. If C, the feature is BLOCKED; post a BLOCKED checkpoint, do not ship an API-key fallback, and tell the maintainer. The way the Codex CLI (`openai/codex`) implements `$imagegen` is the reference to read for B.

### 3. Contracts

`image_generate` arguments (zod, in `packages/capabilities/schemas.ts` style, strict):

```ts
{
  prompt: string;                 // 1..4000 chars, trimmed
  size?: "auto" | "1024x1024" | "1536x1024" | "1024x1536";   // default "auto"
  quality?: "auto" | "low" | "medium" | "high";              // default "auto"
  background?: "auto" | "opaque" | "transparent";            // default "auto"
  count?: 1 | 2 | 3 | 4;                                     // default 1
  referenceResourceIds?: string[];                           // 0..4, grants of this thread
}
```

Result returned to the model:

```ts
{ status: "completed" | "partial" | "cancelled" | "failed";
  images: { resourceId: string; label: string; width: number; height: number; bytes: number; sha256: string }[];
  revisedPrompt?: string; error?: { code: ImageErrorCode; message: string } }
```

`ResourceGrant` gets an optional, additive field (no migration for existing rows):

```ts
provenance?: { kind: "generated-image"; model: string; promptSha256: string; generationId: string;
               index: number; size: string; quality: string; background: string; referenceIds: string[] }
```

`image_save_prepare` arguments: `{ resourceId: string; path: string; overwrite?: { expectedSha256: string } }`. Prepared operation kind `image.save`, executed by core like `pdf.export`. User command `image.save` with the same payload plus the command id.

Card artifact (`GeneratedImages` catalog component, strict schema):

```ts
{ generationId: string; state: "generating" | "completed" | "partial" | "failed" | "cancelled";
  prompt: string; options: { size; quality; background; count }; model: string;
  resourceIds: string[]; error?: { code: ImageErrorCode; message: string; retryable: boolean };
  saved?: { resourceId: string; path: string }[] }
```

The card artifact is host-authored (created/updated by core when the tool runs), not by `ui_present`, so the model cannot fake a result.

### 4. Storage and save

- Extract `storeThreadAttachment(thread, commandId, name, bytes, extra?)` from `resource.upload` (`service.ts:1225-1233`); `resource.upload` keeps identical behavior and tests.
- Generated files: `<dataDir>/attachments/<threadId>/<generationId>-<index>-<slug>.png`, `wx`, read-only grant with `provenance`.
- Byte validation: magic bytes PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF....WEBP`; decoded size <= 20 MiB; width/height read from the header, each <= 4096. Anything else -> `INVALID_OUTPUT`, nothing stored.
- Save: resolve the thread's writable project grant (`kind: "project"`), `canonical()` + `inside()` the root, `assertNotStorage`, reject `..`, absolute paths, hidden-segment paths (`.git/` etc.), non-`.png` extension when source is PNG (match source type). Write with `wx`; overwrite only when `expectedSha256` matches the current file. Create parent folders under the root. Return the new project file path; card `saved[]` updated.

### 5. Control flow, cancellation, retry, errors

5.1 States: `generating -> completed | partial | failed | cancelled`. `partial` = count > 1 and a later call failed after at least one image was stored.

5.2 Rules:
- Idempotency: `generationId` = tool call id. A repeated tool call with the same id returns the stored result and makes no provider call.
- One concurrent generation per thread; a second call while one runs returns `BUSY` to the model.
- Cancellation: the run's `AbortSignal` is passed to the provider request and the credential lease. On abort: card -> `cancelled`, any bytes arriving after abort are discarded (check `signal.aborted` before every store), no grant is created.
- Timeout: 120 s per provider call -> `TIMEOUT`.
- Retry: the card's **Retry** inserts `Retry generating: <prompt>` into the composer and sends it, so the agent loop stays the only caller; the agent re-calls the tool with a new id. No automatic retries except one retry on a network reset before any bytes arrive.
- Cleanup: on any failure after a file was written but before its grant commit, delete that file.

5.3 Error table (user-facing text is final copy):

| Code | When | Card message | Retry |
| --- | --- | --- | --- |
| `NOT_CONNECTED` | No ChatGPT / Codex connection on this thread | "Image generation needs a ChatGPT / Codex connection." + link "Open connections" | No |
| `USAGE_LIMIT` | Provider 429 / usage limit | "You've reached your ChatGPT plan's usage limit. Try again later." | Yes |
| `POLICY` | Provider refusal / moderation | "OpenAI declined this request under its content policy." + provider reason if short | No |
| `INVALID_REFERENCE` | Reference not a granted image of this thread, wrong type or too big | "One of the reference images can't be used (PNG, JPEG or WebP up to 20 MB)." | No |
| `INVALID_OUTPUT` | Output failed validation | "The generated file wasn't a valid image." | Yes |
| `TIMEOUT` | 120 s | "Image generation timed out." | Yes |
| `NETWORK` | Connection failure | "Couldn't reach OpenAI." | Yes |
| `BUSY` | Another generation running in the thread | (model only) | - |
| `UNSUPPORTED` | T01 outcome C or account lacks access | "Image generation isn't available for this ChatGPT account." | No |

### 6. Visual design and animation

All values reuse existing tokens/classes; DISCOVERY in T05 is to map each named token to the existing CSS variable in `apps/web/src` (no new colors).

6.1 **Card placement.** The card sits in the assistant message flow where the tool call happened, full message width up to 560px, left-aligned with assistant text. Radius 12px, 1px border using the existing artifact/card border token, surface background of artifacts, 12px padding.

6.2 **Card anatomy (top to bottom).**
- Header row (24px): image icon (`lucide-react` `Image`, 16px, muted), label "Image" (or "Images · 3"), and a muted meta line "1024×1024 · high · gpt-image-2". Right side: overflow menu (`MoreHorizontal`) with Copy prompt, Download all.
- Prompt line: the prompt, 2 lines max with ellipsis, muted, 13px; click expands to full prompt.
- Image grid: 1 image = single tile at its aspect ratio, max height 420px. 2 = two columns. 3-4 = 2×2 grid, 8px gap. Tiles have 8px radius, checkerboard background (8px squares, existing muted surface tones) so transparent images read correctly.
- Hover/focus on a tile reveals a bottom-right action cluster (28px icon buttons on a translucent surface): Expand (`Maximize2`), Edit (`Pencil`), Download (`Download`). On touch devices the cluster is always visible.
- Footer: primary **Save to project** button (secondary style when more than one image: "Save…" opens a picker of tiles with checkboxes). After save: check icon + "Saved to assets/generated/paper-plane.png" link.
- First card per thread only: one muted line under the footer, "Uses your ChatGPT plan's Codex limits." (R8).

6.3 **Loading state.** Tiles with the final grid layout and the requested aspect ratio (square when `auto`) as skeletons. Skeleton shimmer per the existing skeleton style; status text "Generating image…" (or "Generating 2 of 4…") in the header meta, shown only after 150ms (DESIGN.md delayed-feedback rule). A Stop affordance is not added to the card; the run's existing Stop control cancels.

6.4 **Full-size viewer.** Uses the existing primitive overlay/dialog (DESIGN.md requires primitive-only overlays). Dark scrim, image centered with `object-fit: contain`, max 90vw × 80vh. Right panel 280px (below the image under 706px width): prompt (full), revised prompt if any, model, size, quality, background, created time, reference thumbnails. Toolbar: Previous, Next (when the card has more than one image), Edit, Download, Save to project, Close. Keyboard: Esc closes, ←/→ navigate, focus returns to the tile that opened it.

6.5 **Motion** (from DESIGN.md "Motion tokens"):

| Moment | Motion |
| --- | --- |
| Card insert | List insert 180ms, entrance easing `cubic-bezier(.16,1,.3,1)`, opacity 0→1 and translateY 4px→0 |
| Skeleton → image | 160ms crossfade (Status token); image fades in only after `load` fires, so no blank flash |
| Multiple images arriving | 30ms stagger, max 150ms |
| Tile action cluster | Hover/focus color 120ms; opacity 0→1 140ms |
| Button press | 80ms, scale .97, no layout shift |
| Viewer open/close | Panel 220/180ms, scale .95→1 from the tile's rect (FLIP from trigger origin), exit returns toward the tile |
| Save popover | Dropdown/popover 180/140ms, .95 scale from trigger |
| Saved confirmation | 160ms crossfade to the check state, one 240ms success pulse |
| Error state | 160ms crossfade from skeleton to error panel; no shake |
| Composer thumbnail chip | Attachment row 220/180ms height and opacity |

All transitions are interruptible and retarget from current geometry.

6.6 **Reduced motion** (System/Reduced/Off settings and `prefers-reduced-motion`): no translate/scale/FLIP, no stagger, no shimmer (static skeleton), opacity changes at most 80ms. Use the existing `reducedMotion()` helper used by `ComposerAttachments.tsx`.

6.7 **Error/cancelled visuals.** The grid area is replaced by a 120px-tall panel with a muted icon (`ImageOff`), the message from the table and, when retryable, a **Retry** secondary button. Cancelled: "Cancelled" muted text, no button. Partial: stored images shown, plus a small inline notice "1 of 3 images failed. Retry".

6.8 **Composer thumbnails (R6).** For attachments whose label ends in `.png/.jpg/.jpeg/.webp`, the chip shows a 20×20 thumbnail (4px radius, `object-fit: cover`) in place of the `File` icon. Same chip height as today; read-only `Lock` badge unchanged.

6.9 **Accessibility.**
- Card is a `figure` with `figcaption` = prompt; each image `alt` = "Generated image: <prompt truncated to 120 chars>" (revised prompt when present).
- Loading: `aria-busy="true"` on the grid and a polite live region announcing "Generating image", then "Image ready" / the error message.
- Tile action buttons have labels ("Expand image 1", "Edit image 1", "Download image 1"); they are keyboard reachable (tile `tabindex=0`, actions follow in tab order) and visible on focus.
- Viewer: `role="dialog"`, `aria-modal="true"`, labelled by the prompt, focus trapped, Esc closes, focus restored.
- Contrast: all text meets WCAG AA in light and dark themes; action cluster background must keep 3:1 against any image (use the solid surface token at 90% opacity).
- Save popover path field has a visible label "Save as" and error text bound via `aria-describedby`.

6.10 **Copy.** Buttons: "Save to project", "Save…", "Saved", "Edit", "Download", "Expand", "Retry", "Replace", "Save as copy". Setting: "Image generation" with description "Let the agent create and edit images with your ChatGPT / Codex connection. Generations count toward your plan's Codex usage limits."

### 7. Security boundaries

- Tool is registered only when: flag on, setting on, thread connection is `openai` or `openai-codex`, and T01 outcome is A or B.
- References: must be grants of the same thread with `kind` `attachment` (or generated); `resolveGrant` enforces; no arbitrary paths or URLs.
- Prompt text and reference bytes are not written to logs; error messages from the provider are trimmed to 300 chars and stripped of URLs before display.
- Save requires a writable project grant; never writes outside it or into Gen storage (`assertNotStorage`).
- The served image keeps sandbox CSP and `referrerPolicy="no-referrer"`.

### 8. Migration and rollback

- Additive: new optional `provenance` field, new flag, new setting, new catalog component, new tools. No data migration.
- Rollback: turn the flag off. Existing generated images remain normal read-only attachments; cards render with the plain `Image` fallback when the component is unavailable (T05 adds a fallback that renders each `resourceId` with the existing `Image` renderer).

## EXECUTION_DAG

```
T01 ─┬─> T04 ─┬─> T08 ─> T09 ─> T10
T02 ─┤        │
T03 ─┴─> T06 ─┤
T05 ──────────┤
T07 ──────────┘
```
T02, T03, T05, T07 can start in parallel with T01. T04 needs T01-T03. T06 needs T03. T08 needs T04-T07.

### T01 Prove the provider call path (discovery spike)
- Goal: decide A/B/C from DESIGN 2 with a real signed-in ChatGPT / Codex account.
- Depends on: none.
- Steps: read Pi 1.4.0 OpenAI Codex provider source under `node_modules/@earendil-works/pi-ai/dist/providers/` to find the endpoint, headers and whether hosted tools/extra body fields can be passed; read how `openai/codex` sends `image_generation`; write a throwaway script under `scripts/spikes/` (NOT committed) that sends the DESIGN 2 request with the credential lease; try count 1, a reference image, `background:"transparent"`, an abort after 1 s, and a deliberately disallowed prompt.
- Output: issue comment with outcome, endpoint/feature names (no tokens), observed response shape, error shapes for 429/refusal/abort, whether partial images stream, and observed latency.
- Tests: positive real call; negative abort and refusal.
- Done when: outcome recorded; if C, issue marked BLOCKED and later tasks stop except T02/T03/T05/T07 which may stay as unmerged branches.
- Ownership: research only; no committed code. Handoff: T04 owner.

### T02 Flag and setting
- Goal: `media.imageGenerationV1` (default off) in `packages/core/capability-flags.ts` following the `M15_FLAG_KEYS` pattern (lines 93-94, 127) with owner `media`; user setting "Image generation" in `apps/web/src/settings-registry.ts` / `Settings.tsx`, shown only when the flag is on, default on once the flag is on.
- Depends on: none. Ownership: these two files + their tests only.
- Tests: flag listed with default off; unknown-key error unchanged; setting hidden when flag off, persisted when toggled.
- Done when: tests pass and `pnpm` typecheck/lint pass.
- Handoff: T04, T05.

### T03 Storage helper, provenance, validation
- Goal: DESIGN 3/4 storage: `storeThreadAttachment` extracted from `resource.upload`; `provenance` added to `ResourceGrant` in `packages/contracts/index.ts`; new `packages/core/generated-images.ts` with `validateImageBytes(bytes)` (magic bytes, size, dimensions) and `storeGeneratedImages(...)` with abort checks and cleanup.
- Depends on: none. Ownership: `packages/contracts/index.ts` (additive), `packages/core/service.ts` (upload handler only), new core file + tests.
- Tests: existing `resource.upload` tests unchanged and passing; PNG/JPEG/WebP accepted; GIF/SVG/HTML/truncated rejected; >20 MiB rejected; >4096 px rejected; aborted signal stores nothing; idempotent re-store with same `generationId` returns same grants; different bytes for same id -> `DUPLICATE_COMMAND`.
- Done when: tests pass.
- Handoff: T04, T06.

### T04 `image_generate` tool in the runtime
- Goal: DESIGN 2/3/5: tool schema + description, registration in `packages/runtime-pi/tool-definitions.ts` under the gating in DESIGN 7, provider call using the T01 path, reference resolution, sequential count, timeout, abort, error mapping table, host-authored card artifact updates (`generating` first, final state last).
- Depends on: T01 (A or B), T02, T03.
- Files: new `packages/runtime-pi/image-generation.ts`; `tool-definitions.ts`; schema in `packages/capabilities/schemas.ts` only if the host-tool pattern requires it (DISCOVERY: follow how existing host tools declare schemas). Card artifact emission point: DISCOVERY in how host-authored artifacts/receipts are written today (search `packages/core` for host-created artifacts used by verification receipts) and reuse it.
- Tests: unit with a fake provider: success 1 and 4 images, partial, each error code, abort mid-call (no grant, card `cancelled`), timeout, idempotent repeat, BUSY, gating (tool absent for `github-copilot`, flag off, setting off).
- Done when: tests pass; tool description states supported connection and usage-limit note.
- Handoff: T08.

### T05 `GeneratedImages` card and viewer
- Goal: DESIGN 6.1-6.7, 6.9, 6.10: catalog component schema in `packages/ui-catalog` (new `generated-images.ts`, registered beside `Image` in `index.ts`), renderer in `apps/web/src` (new `GeneratedImages.tsx` + registration in `registry.tsx`), viewer dialog, Edit (composer prefill + attach), Download, Copy prompt, Retry, fallback to `Image`.
- Depends on: none for building against the schema; integrates with T04/T06 in T08.
- Ownership: new files + one registration line each in `packages/ui-catalog/index.ts` and `apps/web/src/registry.tsx`; CSS in the existing stylesheet section for artifacts (DISCOVERY: file that holds `.surface-image`).
- Tests: component tests for each state; schema rejects unknown fields, >4 ids, empty prompt; keyboard flow in viewer; reduced-motion snapshot (no transform/animation styles); light/dark visual check.
- Done when: tests pass and DESIGN.md guardrails (primitive-only overlays, reduced-motion checks) pass.
- Handoff: T08.

### T06 Save to project
- Goal: DESIGN 4 save: core command `image.save` (user path) and prepared op `image_save_prepare` -> `image.save` (agent path, approval), path validation, `wx`/`expectedSha256` overwrite, card `saved[]` update; web Save popover (DESIGN 6.2, F5) wired to the command.
- Depends on: T03.
- Files: `packages/capabilities/index.ts` + `schemas.ts` (new prepare/execute cases modeled on `pdf_prepare`/`pdf.export`), `packages/core/service.ts` (command), save popover inside `GeneratedImages.tsx` (coordinate with T05 owner: T05 leaves a `onSave` prop; T06 owns the popover component file `apps/web/src/ImageSavePopover.tsx`).
- Tests: saves new file; existing path -> conflict without write; overwrite with matching sha replaces, mismatched sha rejects; `../x.png`, `/abs.png`, `.git/x.png`, `x.exe`, path into Gen storage rejected; no project grant -> error; agent path requires approval and Reject writes nothing; Save as copy picks `-2`.
- Done when: tests pass.
- Handoff: T08.

### T07 Composer image thumbnails
- Goal: DESIGN 6.8 in `apps/web/src/ComposerAttachments.tsx`.
- Depends on: none. Ownership: that file + its CSS + test.
- Tests: image chip shows thumbnail; non-image keeps `File` icon; broken image falls back to `File` icon; reduced-motion unchanged.
- Done when: tests pass; #1237 owner informed if their branch touches the same file (refresh the issue before editing).
- Handoff: T08.

### T08 Integration and e2e
- Goal: wire T04-T07 together; Playwright e2e with a fake provider fixture (DISCOVERY: how existing e2e stubs the Pi runtime) covering F1-F9.
- Depends on: T04, T05, T06, T07.
- Tests: e2e per flow; flag-off e2e shows no tool/setting/card; reload shows images; Stop cancels; save writes the file on disk inside the project fixture.
- Done when: e2e and full unit suites pass in CI.
- Handoff: T09.

### T09 Real-account verification
- Goal: run F1, F2, F4, F5, F7 (`POLICY` via a clearly disallowed prompt), F8 with a real ChatGPT / Codex account in the desktop/web app; record a screen recording and screenshots in light/dark and reduced motion.
- Depends on: T08.
- Done when: evidence posted on the issue; any defect fixed or filed.
- Handoff: T10.

### T10 Front-end team review (requested by the product owner)
- Goal: hand the finished, verified work to the front-end team for review.
- Depends on: T09.
- Steps: post a HANDOFF checkpoint on this issue addressed to the front-end team (RECIPIENT=front-end team) with the PR link(s), the T09 recording, screenshots of every card state and the viewer in light/dark and reduced motion, and a list of where the build deviates from DESIGN 6 (if anywhere); request their review on the PR(s).
- Done when: the front-end team has reviewed and their requested changes are resolved or explicitly deferred by the maintainer. The issue is not closed before that.

## VALIDATION

Setup: `pnpm install` at repo root on current `main`; follow CONTRIBUTING.md for the exact unit, typecheck, lint and e2e commands (DISCOVERY: use the scripts in the root `package.json`; do not invent new runners).

### Acceptance matrix

| Req | Tasks | Check |
| --- | --- | --- |
| R1 tool + edit | T04, T08 | Unit fake-provider tests; e2e F1-F3 |
| R2 ChatGPT backend proven | T01, T09 | T01 issue evidence; T09 real run |
| R3 persisted attachments | T03, T08 | Store tests; e2e reload |
| R4 card states/actions | T05, T08 | Component tests; e2e |
| R5 safe save + approval | T06, T08 | Path/approval tests; e2e file on disk |
| R6 thumbnails | T07 | Component test |
| R7 options | T04, T05 | Schema tests; meta line shown |
| R8 usage disclosure | T02, T05 | Setting copy; first-card line test |
| R9 cancel/retry/idempotency | T03, T04, T08 | Abort/idempotency tests; e2e Stop |
| R10 flag + setting | T02, T08 | Flag tests; flag-off e2e |
| R11 a11y + reduced motion | T05, T07, T09 | Keyboard/aria tests; reduced-motion checks; recording |
| R12 front-end review | T10 | Review recorded on PR and issue |

### Release gate

All matrix checks green in CI; T09 evidence on the issue; T10 review resolved; flag stays default off until the maintainer turns it on.

### Tests executed during planning

None. This is a plan; no code or tests were written or run. Facts above come from reading the baseline source and the pi-ai 1.4.0 package.

## STATE

| Item | State |
| --- | --- |
| Research of repo, Pi package, Codex docs | Done (planner) |
| Decisions in this plan | Decided in r1 |
| T01-T10 | NOT_STARTED, unowned |
| Branches/PRs for implementation | None |

Risks:
- The ChatGPT/Codex backend may not accept the hosted image tool from Gen (T01 outcome C). Mitigation: stop and report; no API-key workaround.
- Image generation consumes plan limits 3-5x faster than text turns; mitigated by disclosure and flag default off.
- `ComposerAttachments.tsx` may also be edited by #1237's work; refresh and coordinate before T07.
- Pi upgrades may later add native OpenAI image models; T04 should keep the provider call behind one function so it can switch to `generateImages` then.

Next step: an implementing agent claims this issue, runs T01, and posts its outcome before starting T04.

## REFERENCES

- Codex / ChatGPT image generation docs: https://learn.chatgpt.com/docs/image-generation (built-in generation uses `gpt-image-2`, counts toward Codex usage limits, uses them 3-5x faster; `$imagegen` invokes it explicitly; reference images guide edits).
- OpenAI image generation guide (Responses API `image_generation` tool): https://developers.openai.com/api/docs/guides/image-generation
- Codex source (reference for how `$imagegen` calls the backend): https://github.com/openai/codex
- Related issue: https://github.com/skytuhua-org/Gen-V1/issues/1237
- `DESIGN.md` (motion tokens, overlay and reduced-motion rules), `AGENTS.md`, `CONTRIBUTING.md`, `docs/progress.md` on `main`.
