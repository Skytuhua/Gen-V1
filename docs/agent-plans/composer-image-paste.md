# Plan: Paste images into the composer

## META

| Field | Value |
|---|---|
| Feature | Paste images into the composer (Ctrl+V / Cmd+V a screenshot straight into a message) |
| Size | small (`feature`, `small`) |
| Repository | skytuhua-org/Gen-V1 |
| Plan revision | r1, 2026-11-21 (UTC) |
| Baseline | `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52` (verified with `git rev-parse HEAD` on a fresh clone) |
| Existing issues/PRs | None found for clipboard image paste (searched issues and PRs for "paste image", "attachment", "screenshot", "clipboard"). Related, not duplicates: #22 (merged, compact composer attachment row), #374 (merged, attachment removal replay with motion), #684 (merged, stored attachments stay inside their conversation), #1188 / #1203 (open, composer animation), #1132 (open, composer control crowding). |
| Implementation status | NOT_STARTED. Planning only; maintainer approved the feature for planning, not implementation. |
| Provenance | Feature proposal approved by the maintainer (Leonardo) from a researched proposal batch; repo facts below come from read-only source inspection of the baseline SHA by worker `devin-cloud-7c2e41`. No code was built or tested while planning. |
| Visual/animation ownership | **The maintainer's separate front end team defines all animation and visual design for this feature** (chip/thumbnail look, paste feedback, motion). This plan covers behavior, data and wiring only. |

## OBJECTIVE

**Problem.** Today a user who wants to show an agent a screenshot has to save it to disk and then use **Attach files** or drag and drop. Pressing Ctrl+V with an image on the clipboard in the composer does nothing useful: the textarea's `onPaste` only dismisses the prediction (`apps/web/src/App.tsx:431`).

**Intended behavior.** With focus in the main composer textarea, pasting a clipboard that holds one or more images (for example a Windows Snipping Tool / Win+Shift+S capture, macOS Cmd+Ctrl+Shift+4, or "Copy image" in a browser) attaches each image to the current thread exactly as if the user had picked that file with **Attach files**: it is uploaded through the existing `resource.upload` command, shows as an attachment chip, and is available to the agent as a thread resource on the next send. Text paste is unchanged.

**Measurable success.**
1. Pasting a PNG screenshot into the composer produces one `resource.upload` command whose `mimeType` is `image/png` and whose `name` matches `pasted-image-YYYYMMDD-HHMMSS[-N].png`, and one new attachment chip, with no text inserted into the draft.
2. Pasting plain text produces zero `resource.upload` commands and inserts the text exactly as today (including prediction dismissal).
3. Oversized (> 20 MiB) or failing pastes show the existing composer error and leave the draft untouched.
4. Verified in the packaged Windows Electron build with a real OS screenshot (Windows x64 is the supported beta platform per CONTRIBUTING.md).

## REQUIREMENTS

### In scope (agreed decisions)

- **R1 — Image paste in the main composer.** `onPaste` on the main composer textarea (`App.tsx:431`) detects image files on `event.clipboardData` and uploads them through the existing `upload(files)` function (`App.tsx:391–404`). No new upload path, command, endpoint or storage.
- **R2 — Text paste unchanged.** If the clipboard has non-whitespace `text/plain`, the paste is treated as text: no upload, no `preventDefault`, native textarea paste proceeds, prediction is still dismissed. Decision rationale: copying from Office/rich editors often puts a rendered image *and* the text on the clipboard; text wins so users never get a surprise image attachment. (Decided by the planner; reversible in T01 by changing one predicate.)
- **R3 — Image-only clipboard.** If the clipboard has at least one image file and no non-whitespace `text/plain`, call `event.preventDefault()` (so nothing like a file path or `[object]` is inserted), dismiss the prediction, and upload every image file in clipboard order.
- **R4 — Accepted types.** `image/png`, `image/jpeg`, `image/gif`, `image/webp`. These are the image types the content route already serves by extension (`apps/server/server.ts:56,311`). Other clipboard files (including `image/svg+xml`, `image/bmp`, `image/tiff`, non-image files) are ignored by paste; if *only* ignored files are present, behave as R2 (fall through to native paste, which inserts nothing for files). SVG is excluded because it is scriptable markup, not a raster screenshot.
- **R5 — Names.** Clipboard images usually arrive named `image.png` or with an empty name. Each pasted image is re-wrapped as `new File([blob], name, {type})` with `name = pasted-image-YYYYMMDD-HHMMSS.<ext>` using local time at paste, and `-2`, `-3`… suffixes for multiple images in one paste. Extension comes from MIME (`png`, `jpg`, `gif`, `webp`). The name must survive the host sanitizer `/[^a-zA-Z0-9._ -]/g` unchanged (it does: digits, letters, `-`, `.`).
- **R6 — Limits and errors.** Reuse `upload()`'s existing 20 MiB per-file check and error message, `ensureThread` draft migration, sequential upload, `refresh()`, and `fail()/reportError()` handling. A paste while the composer is disabled (`!ready`, `busy`, `retry`) does nothing — the textarea is already `disabled={!ready}`; the handler must also return early when `busy || retry` so it matches the Attach button's disabled state.
- **R7 — Keyboard/IME/predictions/slash commands unaffected.** Do not touch `onKeyDown` (`App.tsx:432–438`) or `ComposerCommands.tsx`. Detection uses the paste event's `clipboardData`, never a Ctrl+V keydown or `navigator.clipboard.read()` (no clipboard permission prompt, works identically for Ctrl+V, Cmd+V, Shift+Insert and the context-menu Paste).
- **R8 — Electron.** No IPC or preload change: the renderer is a standard Chromium page (`apps/desktop/main.ts:161`, sandboxed, contextIsolation) and the DOM paste event carries OS clipboard images as `File`s. Verified only in a real packaged build (T04).
- **R9 — Design hand-off.** Visible states (chip appearance for pasted images, any thumbnail, paste/uploading feedback, motion) are defined by the front end team. Implementation uses the existing `ComposerAttachments` chip unchanged; DESIGN.md:29/74 rules for the attachment row continue to apply.

### Out of scope (explicit exclusions)

- **Native vision / provider image parts.** Messages and runtime prompts are strings (`packages/contracts/index.ts:4,34`); adapters send text (Pi `input-envelope.ts:7–11`, Claude `claude.ts:81`, Gemini `gemini.ts:112–114` sends `[{type:'text'}]`, Cursor `cursor-worker.ts:163`); `ModelInfo` has no vision flag. A pasted image reaches the agent the same way a picked file does today: as a thread resource grant `{id,kind:'attachment',label,writable:false}` that the agent can read with its tools. Whether a given agent actually "sees" the pixels is not promised by this feature. Native multimodal input is a separate, larger feature to propose later.
- Image-only send. The send gate (`App.tsx:357`, button at `:449`) still requires text, terminal excerpts or retry. Unchanged.
- Thumbnails/previews, chip removal, per-message attachments, attachment retention/cleanup, image re-encoding/downscaling, magic-byte validation on the host.
- Other composers: `AgentsWorkspace.tsx:175` `InlineComposer`, `SourceWorkbench.tsx:157` `WorkbenchComposer`, side chat (uploads rejected there with `SIDE_CHAT_READ_ONLY`, `tests/side-chat.test.ts:81`). Shared-agent composers submit through the same `App.tsx` `Composer`, so they get paste for free; no extra work.
- Global paste interception outside the composer textarea.
- Any animation or visual design (front end team).

### Compatibility, security, privacy, accessibility

- **Security.** Bytes go through the existing host path (`packages/core/service.ts:1225–1233`): sanitized name, base64 charset check, 20 MiB decoded cap, `wx` write under `<dataDir>/attachments/<threadId>/`, read-only grant, content route CSP `sandbox; default-src 'none'`. No new attack surface beyond "more PNGs reach the existing upload".
- **Privacy.** Screenshots often contain sensitive data. Pasting is an explicit user action, and the result is visible as a chip before send; that is the consent point. Nothing is read from the clipboard without a paste event. The composer-prediction boundary (`docs/superpowers/specs/2026-11-01-composer-predictions-design.md:36`: predictions must not read attachments) is unaffected because pasted images become ordinary attachments.
- **Accessibility.** The existing error region and chip are reused. Uploaded chips already announce via the existing attachment row; no new announcement is required by this plan (front end team may add paste feedback).
- **Performance.** FileReader base64 of up to 20 MiB per image, sequential, as today.

## REPO_MAP (verified at baseline SHA)

| Path | Role for this feature |
|---|---|
| `apps/web/src/App.tsx:256–450` | Local `Composer` component. `:391–404` `upload(files: FileList \| File[])`: 20 MiB check, `ensureThread`, FileReader → base64, `command('resource.upload', {name, mimeType, base64}, id)`, `refresh()`. `:424` form drag/drop → `upload`. `:431` textarea `onPaste={prediction.dismiss}` — **edit point**. `:446` Attach files button / hidden `<input type=file multiple>`. |
| `apps/web/src/ComposerAttachments.tsx:10–28` | Renders attachment chips (file icon + label + lock). Not changed. |
| `apps/web/src/api.ts:115–124` | `command()` posts `HostCommand` to `/api/commands`. Not changed. |
| `packages/core/service.ts:1225–1233` | `resource.upload` host handler. Not changed. |
| `apps/server/server.ts:56,61,310–313` | Extension→MIME map; 29 MiB body limit; guarded content route. Not changed. |
| `scripts/public-source-files.json` | Source manifest; **new source files must be listed** (CONTRIBUTING.md). `apps/web/src/App.tsx` at line 81, `ComposerAttachments.tsx` at 88. |
| `tests/e2e/task-interface-fixture.ts:86–87` | `serveTaskFixture` routes `/api/commands` and records every `HostCommand` in `host.commands`. Use for the browser test. |
| `tests/e2e/composer-integration.spec.ts` | Pattern for composer browser tests (fill textbox `Message`, assert `host.commands`). |
| `scripts/browser-suites.ts:53` | `micro-motion` suite includes `composer-integration.spec.ts`; new spec must be registered in a suite. |
| `tests/content-motion.test.ts:44–56` | Attachment chip motion tests; regression only. |
| `tests/saved-drafts.test.ts:11` | Preserves attachment choices with saved drafts; regression only. |

Discovery left to implementers (not verified): whether `serveTaskFixture`'s fallback returns a success body for `resource.upload` and whether the following `refresh()` snapshot needs a new `resources` entry for the chip to appear (T02 step 2).

## DESIGN

Control flow (new parts in bold):

```
textarea paste event
  └─ prediction.dismiss()                     (unchanged)
  └─ **images = pastedImageFiles(event.clipboardData, new Date())**
       ├─ [] → return (native text paste continues)
       └─ [File…] → **event.preventDefault()**
                    if (busy || retry) return
                    void upload(images)       (unchanged existing function)
                        └─ resource.upload × n → refresh() → ComposerAttachments chip
```

New pure helper, `apps/web/src/pasted-images.ts`:

```ts
export const pastedImageTypes = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as const;
export function pastedImageName(at: Date, ext: string, index: number): string; // pasted-image-20261121-140502.png, -2, -3 …
export function pastedImageFiles(data: Pick<DataTransfer, 'getData' | 'files' | 'items'> | null, at: Date): File[];
```

`pastedImageFiles` rules, in order:
1. `data` null → `[]`.
2. `data.getData('text/plain').trim() !== ''` → `[]` (R2).
3. Collect candidates from `data.files`; if empty, fall back to `data.items` where `kind === 'file'` via `getAsFile()` (some Chromium/Electron builds expose clipboard images only through `items`). De-duplicate is not needed because only one source is used.
4. Keep files whose `type` is a key of `pastedImageTypes` (R4).
5. Rename each: `new File([file], pastedImageName(at, ext, i), { type: file.type, lastModified: at.getTime() })` (R5). Index starts at 1; index 1 has no suffix.

Edit in `App.tsx:431` (shape only; keep the file's dense single-line style):

```tsx
onPaste={event => { prediction.dismiss(); const images = pastedImageFiles(event.clipboardData, new Date()); if (!images.length) return; event.preventDefault(); if (busy || retry) return; void upload(images); }}
```

Errors/cancel/retry: identical to Attach files — `upload` throws on size before any network call; per-file failures stop the loop, earlier images stay uploaded (existing behavior, documented not changed); thread switch/unmount behavior is whatever `runAction` already does. No migration, no schema change, rollback = revert the PR.

## EXECUTION_DAG

| ID | Goal | Depends on | Owner boundary |
|---|---|---|---|
| T01 | Pure clipboard helper + unit tests | — | `apps/web/src/pasted-images.ts`, `tests/pasted-images.test.ts`, `scripts/public-source-files.json` |
| T02 | Wire helper into composer + browser test | T01 | `apps/web/src/App.tsx` (line ~431 only), new `tests/e2e/composer-image-paste.spec.ts`, `scripts/browser-suites.ts` |
| T03 | Docs | T02 | `docs/feature-map.md` (one line), CHANGELOG.md if the repo convention requires |
| T04 | Real-user Windows desktop verification | T02 | No source edits; evidence on the issue |
| T05 | Front end team design pass | T02 | Front end team; visual/motion only, separate issue/PR |

T01–T03 may be one PR (one concern: paste images). T05 is not blocking for T04.

### T01 — Clipboard image helper
- **Steps.** Create `apps/web/src/pasted-images.ts` exactly per DESIGN. Add it to `scripts/public-source-files.json` under `source` (and `runtime` only if neighbouring `apps/web/src/*.ts` files are listed there — check `App.tsx`'s entries and mirror them). Create `tests/pasted-images.test.ts` (vitest; jsdom/happy-dom not required if you build a fake `{getData, files, items}` object; `File` exists in Node ≥ 20).
- **Positive tests.** single PNG → one File named `pasted-image-YYYYMMDD-HHMMSS.png`, type `image/png`; two images → `…`, `…-2`; JPEG → `.jpg`; images only in `items` → found; whitespace-only text + image → image returned.
- **Negative tests.** null data → `[]`; text `"hello"` + image → `[]`; only `image/svg+xml` / `application/pdf` → `[]`; name passes `/^[a-zA-Z0-9._ -]+$/`.
- **Done when.** `pnpm exec vitest run tests/pasted-images.test.ts` passes; `pnpm typecheck` passes; manifest validation passes (`pnpm exec vitest run tests/public-source*` or whatever test imports the manifest — discover with `rg -l public-source-files tests`).
- **Handoff.** T02 worker, with commit SHA.

### T02 — Composer wiring + browser test
- **Steps.** Import `pastedImageFiles` in `App.tsx`; replace `onPaste={prediction.dismiss}` with the handler in DESIGN. Do not change `upload`, `onKeyDown`, drag/drop or the Attach button. Create `tests/e2e/composer-image-paste.spec.ts` using `taskFixture`/`serveTaskFixture` like `composer-integration.spec.ts`; synthesize the paste in the page:
  ```ts
  await page.getByRole('textbox',{name:'Message',exact:true}).evaluate(node=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])],'image.png',{type:'image/png'}));node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  ```
  Register the spec in an existing suite in `scripts/browser-suites.ts` (e.g. next to `composer-integration.spec.ts` in `micro-motion`) or a new `composer-image-paste` suite, following file conventions.
- **Discovery (step 2).** If the chip does not appear, inspect `serveTaskFixture` and make the route add a `{id, threadId, kind:'attachment', path, label, writable:false, createdAt}` resource to the snapshot on `resource.upload` *inside the spec* (do not change shared fixture behavior for other specs unless necessary).
- **Positive tests.** image paste → exactly one `resource.upload` in `host.commands` with `mimeType:'image/png'`, `name` matching `/^pasted-image-\d{8}-\d{6}\.png$/`, non-empty `base64`; draft text unchanged; chip with that label visible.
- **Negative tests.** text paste (`DataTransfer` with `text/plain` `"hello"`) → zero `resource.upload`; text + image → zero `resource.upload`; 21 MiB image → zero `resource.upload` and the existing "larger than the 20 MB attachment limit" error visible.
- **Regression.** Run `composer-integration`, `composer-prediction`, `composer-commands` suites and `tests/content-motion.test.ts`, `tests/saved-drafts.test.ts`.
- **Done when.** `pnpm typecheck`, `pnpm build`, focused vitest, and `node --import tsx scripts/test-browser.ts --suite <suite>` for the new and regression suites pass; PR opened linking this issue.

### T03 — Docs
- Add one line to `docs/feature-map.md` under the composer entry: pasting images attaches them like **Attach files**. Add a CHANGELOG entry only if recent feature PRs do (check `git log -p -5 -- CHANGELOG.md`). Done when links/format reviewed.

### T04 — Real-user verification (Windows x64 packaged build)
- Build with `pnpm desktop:package` (or install the PR's CI artifact if one exists). In a thread: (a) Win+Shift+S → Ctrl+V in composer → one chip `pasted-image-….png`, send "describe this", confirm the agent run receives the resource (thread resources list / agent can open the file); (b) copy an image in the embedded or external browser ("Copy image") → paste → chip; (c) copy a paragraph from Word/Outlook → paste → text only, no chip; (d) right-click → Paste with an image → chip. Record evidence (redacted screenshots/recording) on the issue. macOS/Linux: optional, note as NOT_RUN if skipped.
- **Done when.** (a)–(d) pass and evidence is posted.

### T05 — Front end team design pass (not part of the implementation PR)
- The front end team decides chip/thumbnail visuals and any paste/uploading feedback and motion, then files its own issue/PR. Implementers must not invent visuals in T01–T02.

## VALIDATION

**Setup.** Node ≥ 24.10, pnpm 10.30.3, `pnpm install`, `pnpm exec playwright install chromium`.

**Acceptance matrix.**

| Req | Check | Task |
|---|---|---|
| R1 | e2e image paste → `resource.upload` + chip | T02, T04a |
| R2 | unit text+image → `[]`; e2e text paste → no upload, text inserted | T01, T02, T04c |
| R3 | e2e image-only paste → `preventDefault`, draft unchanged | T02 |
| R4 | unit svg/pdf ignored | T01 |
| R5 | unit + e2e name regex | T01, T02 |
| R6 | e2e 21 MiB → error, no upload; disabled composer → no upload | T02 |
| R7 | regression suites composer-prediction / composer-commands | T02 |
| R8 | packaged Windows build real clipboard | T04 |
| R9 | no visual changes in implementation diff; T05 owned by front end team | T02 review, T05 |

**Release gate.** T01–T03 merged with green required checks, T04 evidence posted. Planned tests only; **none executed during planning**.

## STATE

- Researched/decided: everything above (r1).
- Implemented: nothing. Verified: nothing.
- Owners: none claimed for implementation. Planner `devin-cloud-7c2e41` released after publishing.
- Risks: (1) users may expect the agent to *see* the image — mitigated by stating scope; native vision is a follow-up. (2) Some apps put both text and image on the clipboard; R2 picks text. (3) Fixture may need a spec-local resource injection (T02 discovery).
- Next step: maintainer assigns T01–T03 to an implementing worker; front end team picks up T05.

## REFERENCES

- Composer: `apps/web/src/App.tsx` @ 1f9466ab (lines 256–450, 391–404, 424, 431, 446).
- Host upload: `packages/core/service.ts:1225–1233`; content route `apps/server/server.ts:310–313`.
- Contracts: `packages/contracts/index.ts:4,18,34`.
- Design rules: `DESIGN.md:29,74`; predictions boundary `docs/superpowers/specs/2026-11-01-composer-predictions-design.md:36`.
- Contribution rules: `CONTRIBUTING.md` (manifest, decision-level tests, one concern per PR).
- Web platform: the `paste` event's `ClipboardEvent.clipboardData` exposes pasted images as `File`s via `files`/`items` without clipboard-read permission (MDN "Element: paste event", "DataTransfer.files").
