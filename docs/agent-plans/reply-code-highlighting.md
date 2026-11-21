# Plan: Syntax highlighting in reply code blocks

## META

| Field | Value |
|---|---|
| Feature | Syntax highlighting in reply code blocks: color fenced code in rendered Markdown by its language tag and show the language name in the block's header band, beside the existing Copy code button |
| Repo | skytuhua-org/Gen-V1 |
| Plan revision | rev 1, 2026-11-21 |
| Baseline | `main` @ `4ca1134ae1e4f354064457cb5664b545712da4a9` (verified 2026-11-21; all line references below are at this SHA) |
| Issue | https://github.com/skytuhua-org/Gen-V1/issues/1530 (this plan is its body) |
| Size | small (labels `feature`, `small`) |
| Related work | Open PR [#1494](https://github.com/skytuhua-org/Gen-V1/pull/1494) "Manual editor: pin CodeMirror 6 + Lezer dependencies and notices (T07)" (not merged at baseline; head `b6880fa8a663d9090a71c1d1029851b2bdf71b83`) pins `@codemirror/language` 6.13.1, `@codemirror/language-data` 6.5.2 and `@lezer/highlight` 1.2.5 plus notices, for the manual editor feature [#1344](https://github.com/skytuhua-org/Gen-V1/issues/1344) (open). No other issue or PR covers reply code highlighting (searched issues/PRs for "syntax highlighting", "highlight", "shiki", "prism"). |
| Current status | Researched and planned. Not implemented. No code was built or tested while planning. |
| Provenance | Researched feature proposal batch 7, item 1 (small). The repository owner (Leonardo) asked for researched small/medium features to be filed directly as plan issues with a detailed .md ("just post the issue and attach a detailed md file"); there is no separate front end design team for this feature, so this plan specifies the visual design and animation itself, and the last task (T06) hands the finished work to the front end team for review. Decisions marked **DECIDED** were made by the planner (the owner delegated non-approval decisions); options not taken are recorded in DESIGN §D. Repository facts come from static inspection of the baseline SHA; package facts from the published npm tarballs of `@lezer/highlight` 1.2.5, `@codemirror/language` 6.13.1 and `@codemirror/language-data` 6.5.2. |

## OBJECTIVE

**User problem.** Gen renders fenced code in replies as plain monochrome text. `blocks()` in `apps/web/src/Markdown.tsx` (fence branch, lines 81–86) emits `<div className="markdown-code"><CopyButton text={code} label="Copy code"/><pre><code>{code}</code></pre></div>` and discards the fence info string (`opening[2]`). There is no highlighter in the root `package.json` (the web app has no own `package.json`; dependencies live at the repo root). Agents answer with a lot of code; without color and without a visible language name, long snippets are harder to scan and compare. Competing agent apps get the same request: [openai/codex#44180](https://github.com/openai/codex/issues/44180) and [anthropics/claude-code#64968](https://github.com/anthropics/claude-code/issues/64968) ask for syntax highlighting of code in responses.

**Intended behavior.** A fenced block whose info string names a known language (```` ```ts ````, ```` ```python ````, ```` ```json ````, …) renders with token colors (keywords, strings, numbers, comments, types, properties, headings, links) from theme tokens that work in light and dark themes, and a small language label (the tag as written, lowercased, e.g. `ts`) in a header band at the top-left of the block. The Copy code button keeps its position (top-right) and still copies exactly the raw code. Unknown or unsupported tags show the label but stay plain. Blocks without a tag look exactly as today. Very large blocks stay plain. Word wrap, the Code font and Code size settings keep working.

**Measurable success.**
1. A ```` ```ts ```` block containing `const x = "a"; // c` renders `const` inside an element with class `tok-keyword`, `"a"` inside `tok-string`, `// c` inside `tok-comment`, and a visible label `ts` (T05 browser test).
2. For every highlighted block, `pre code` `textContent` equals the raw fenced code byte-for-byte, and Copy code copies the same string (T03 unit test, T05 browser test).
3. Unknown tag (```` ```foo ````) → label `foo`, no `tok-*` spans; no tag → no label and the unchanged DOM `div.markdown-code > button.copy-button + span.sr-only + pre > code` (T05).
4. Blocks over 20,000 characters or over 1,000 lines render plain (T03, T05).
5. The initial web entry chunk contains no CodeMirror/Lezer code; highlighting code loads in a separate lazy chunk on first use (T04 build check).
6. All token colors meet WCAG AA 4.5:1 against the code block background in both themes (T03 contrast unit test).

## REQUIREMENTS

### In scope
- **R01 Language tag parsing.** Take the first whitespace-delimited word of the fence info string (`opening[2]` from the existing `fence()` regex, `Markdown.tsx` line 47). Strip one leading `{` and `.` and one trailing `}` (Pandoc-style ```` ```{.python} ````). Lowercase it. Accept only `[a-z0-9_+#.-]{1,32}`; anything else is treated as no tag (no label, plain). Tags `text`, `txt`, `plain`, `plaintext`, `diff`, `patch` show the label but are never highlighted (**DECIDED**: diff coloring is out of scope).
- **R02 Language resolution.** Resolve the tag against `languages` from `@codemirror/language-data` with `LanguageDescription.matchLanguageName(languages, tag, false)` (exact name/alias match, no fuzzy substring match; aliases include the lowercased name, verified in `@codemirror/language` 6.13.1 `LanguageDescription.of`). If that returns null, fall back to `LanguageDescription.matchFilename(languages, 'file.' + tag)` so extension-style tags work (`py` → Python, `rs` → Rust, `yml` → YAML, `md` → Markdown, `rb` → Ruby, `kt` → Kotlin). Still null → plain with label.
- **R03 Highlighting.** Load the language with `description.load()` (lazy per-language chunk), parse with `support.language.parser.parse(code)`, and emit segments with `highlightCode(code, tree, classHighlighter, putText, putBreak)` from `@lezer/highlight` (signature verified in 1.2.5 `dist/index.d.ts` line 176). Render segments as React text and `<span className={classes}>` children of the existing `<code>`; never `dangerouslySetInnerHTML`.
- **R04 Label.** Visible language label for every block that has a valid tag (R01), highlighted or not. Text = the parsed tag, not the resolved display name (**DECIDED**: avoids a text swap when the grammar loads and matches what the model wrote).
- **R05 Copy and selection fidelity.** Copy code copies the raw code (unchanged `CopyButton text={code}`); `textContent` of `code` equals the raw code; the label is excluded from text selection (`user-select:none`) and from Copy.
- **R06 Size cap.** No highlighting when `code.length > 20_000` or line count `> 1_000`; the block renders plain with its label.
- **R07 Streaming.** A fence still streaming (unclosed) is highlighted as it grows once its grammar is loaded; the rendered text always equals the current code (no stale segments).
- **R08 Theme tokens.** Colors come from CSS custom properties defined once (light defaults on `:root`, dark overrides on `:root[data-theme="dark"]`), so the manual editor (#1344 §8.3) can reuse them.
- **R09 Settings.** Keep `--code-font` / `--code-font-size` (applied by `shell.css` line 125 and `appearance.css` line 14) and the Word wrap setting (`.app-shell[data-word-wrap=false] :is(pre,.surface-code)`, `shell.css` line 126) working unchanged.
- **R10 Motion.** On live replies only, newly highlighted tokens tint in from the text color; restored history and reduced/off motion show colors immediately (see DESIGN §V3).
- **R11 Bundle.** The highlighter module, `@codemirror/language`, `@codemirror/language-data` and every grammar load lazily, never in the initial entry chunk.
- **R12 Failure.** If the lazy module or a grammar chunk fails to load (offline, packaging bug), the block stays plain with its label, nothing is logged to the user, and a later block may retry.
- **R13 Surfaces.** Applies wherever the shared `Markdown` component renders (assistant replies, user prompts, decision prompts, documents and other Markdown artifacts), because they share `blocks()`. **DECIDED**: no per-surface opt-out.

### Out of scope
- Line numbers, diff/patch coloring, line highlighting (`{1,3-5}` info syntax), code folding, "wrap toggle" per block, inline code (single backticks) highlighting.
- Language auto-detection for untagged fences.
- Shiki, Prism, highlight.js or any second highlighting stack (DESIGN §D).
- Changing the Markdown parser beyond the fence branch.
- Terminal output, Files preview and diff views (the Files editor is #1344).

### Compatibility, security, privacy, accessibility
- **Security:** all code stays text nodes; class names come only from `classHighlighter`'s fixed `tok-*` list. The existing hostile-input browser test (`tests/e2e/markdown.spec.ts`, "renders hostile HTML…") and the `<script>` fence assertion (line ~43: `pre code` `toHaveText('const markup = "<script>";')`) must keep passing.
- **Privacy:** no network beyond same-origin lazy chunks; no telemetry.
- **Accessibility:** colors meet 4.5:1 (R08 table); the label is real text read before the code (it precedes `pre` in DOM order); color is decorative (code meaning does not depend on it). No new focusable elements.
- **Performance:** one Lezer parse per render of a highlighted block, bounded by R06; grammars cached per language for the page lifetime.
- **Compatibility:** no contract, storage or server changes; no migration. Rollback = revert the PR.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Path | Fact |
|---|---|
| `apps/web/src/Markdown.tsx` (116 lines) | `fence()` regex line 47: `/^ {0,3}(`{3,}\|~{3,})(.*)$/` — group 2 is the info string. `blocks()` fence branch lines 81–86 builds `code` and pushes the `markdown-code` div. `Markdown` (lines 113–116) wraps output in `SentenceReveal` with `animate`/`initialReveal` props. Listed in `scripts/public-source-files.json` line 120. |
| `apps/web/src/markdown.css` (16 lines) | `.markdown-code { position:relative; }`; `.markdown-code>.copy-button { position:absolute; top:6px; right:6px; opacity:0; transition:opacity var(--ui-motion-hover) var(--ui-ease-move); }`, visible on hover/focus-within and on `(hover:none)`. Listed in manifest line 256. |
| `apps/web/src/styles.css` lines 115–117 | `.markdown code { background:var(--subtle); padding:2px 4px; border-radius:4px; }`, `.markdown pre { background:var(--subtle); padding:14px 16px; border-radius:9px; margin:14px 0; }`, `.markdown pre code { background:none; padding:0; }`. Tokens line 3 (light): `--subtle:#f5f5f5`, `--text:#202020`, `--muted:#666666`, `--danger:#c92a3e`; line 4 (dark): `--subtle:#171717`, `--text:#e6e6e6`, `--muted:#a0a0a0`, `--danger:#ff6b7e`. Light is the `:root` default; dark is `:root[data-theme="dark"]`. |
| `apps/web/src/shell.css` lines 80–81, 125–126 | High contrast overrides only `--muted`/`--border` on `.app-shell[data-contrast=high]`. Code font and word-wrap rules as in R09. |
| `apps/web/src/CopyButton.tsx` | Renders `button.icon-button.copy-button` + `span.sr-only[role=status]`; copies its `text` prop. Unchanged by this plan. |
| `apps/web/src/SentenceReveal.tsx` line 13 | Prose reveal skips text inside `pre,code,button,…`, so token spans inside `code` are never masked. The label `span` sits outside `pre`; it contains letters, so it is treated as prose and may grapheme-reveal with the reply (acceptable; see V2). |
| `apps/web/src/motion-policy.ts` | `readMotionPolicy()` returns `'full' \| 'reduced' \| 'off'` from `data-motion` and `prefers-reduced-motion`. `appearance.css` lines 17–20 already disable animations for `data-motion=off/reduced` and reduced-motion media. |
| `packages/ui-shell/tokens.css` lines 20–34 | Motion tokens: `--ui-ease-move: cubic-bezier(.4,0,.2,1)`, `--ui-motion-hover: 120ms`, `--ui-motion-status: 160ms`. |
| `apps/web/src/App.tsx` line 146, 1178; `SideChat.tsx`, `DocumentWindow.tsx`, `WorkActivity.tsx`, `PlanningQuestion.tsx`, `registry.tsx`, others | Callers of `<Markdown>`; assistant prose passes `animate` for live messages (line 146). No caller changes needed. |
| `tests/e2e/markdown.spec.ts` (114 lines) | Playwright tests through `documentFixture(page,text)` (task fixture with a `Markdown` element). Add new tests here. |
| `vitest.config.ts` | Includes `tests/**/*.test.{ts,tsx,…}`; node environment (no jsdom configured). |
| `scripts/public-source-files.json` | Sorted, unique `source` list (enforced by `tests/public-source.test.ts` ~line 137) and a `runtime` subset starting line 4525. New web source files go in `source`, sorted. DISCOVERY: whether web files also need `runtime` entries (`CopyButton.tsx`/`Markdown.tsx` are not in `runtime` at baseline, so new web files most likely are not). |
| Root `package.json` | No `@codemirror/*` or `@lezer/*` at baseline. Exact pins (no `^`) are the convention. |
| `THIRD_PARTY_NOTICES.md` | PR #1494 adds a paragraph covering the CodeMirror/Lezer packages. |
| PR #1494 | Adds to `package.json`: `@codemirror/commands` 6.11.1, `language` 6.13.1, `language-data` 6.5.2, `merge` 6.12.3, `search` 6.7.2, `state` 6.7.6, `view` 6.43.15, `@lezer/highlight` 1.2.5; updates `pnpm-lock.yaml` and `THIRD_PARTY_NOTICES.md`. |
| `@codemirror/language` 6.13.1 | Depends on `@codemirror/state`, `@codemirror/view`, `@codemirror/streamparser`, `@lezer/common`, `@lezer/highlight`, `@lezer/lr`. Importing it pulls in `@codemirror/view`; hence the lazy-module requirement R11. |
| `@codemirror/language-data` 6.5.2 | ~150 descriptions; examples: `TypeScript` alias `ts`, `JavaScript` aliases `ecmascript, js, node`, `Shell` aliases `bash, sh, zsh`, `YAML` alias `yml`, `C#` aliases `csharp, cs`, `Python` has no `py` alias (extension `py` only → R02 fallback), `diff` (excluded by R01). |
| `@lezer/highlight` 1.2.5 | `classHighlighter` maps tags to `tok-link, tok-heading, tok-emphasis, tok-strong, tok-keyword, tok-atom, tok-bool, tok-url, tok-labelName, tok-inserted, tok-deleted, tok-literal, tok-string, tok-number, tok-string2` (regexp/escape/special string), `tok-variableName` (+ `tok-local` / `tok-definition`), `tok-variableName2`, `tok-propertyName` (+ `tok-definition`), `tok-typeName, tok-namespace, tok-className, tok-macroName, tok-operator, tok-comment, tok-meta, tok-invalid, tok-punctuation`. Sub-tags fall back to their parent (`tagName`→`typeName`, `attributeName`→`propertyName`, `function(...)`→base). |

## DESIGN

### Architecture and data flow

```
blocks() fence branch
  ├─ parseFenceLanguage(opening[2])  -> tag | null           (code-language.ts, static, no deps)
  └─ <CodeBlock code tag animate/>                             (Markdown.tsx)
        ├─ tag null      -> today's DOM exactly (no label)
        ├─ tag present   -> label + Copy + <pre><code>
        └─ highlightable(tag, code)?  (not excluded, within cap)
              ├─ peekHighlighter(tag) cached? -> segments now (sync)
              └─ else loadHighlighter(tag) (lazy import('./code-highlight'))
                    -> setState(highlighter) -> re-render -> segments
```

**New file `apps/web/src/code-language.ts`** (static, tiny, imported by `Markdown.tsx`):
```ts
export const MAX_HIGHLIGHT_CHARS=20_000,MAX_HIGHLIGHT_LINES=1_000;
const PLAIN_TAGS=new Set(['text','txt','plain','plaintext','diff','patch']);
export function parseFenceLanguage(info:string):string|null {
  const word=(info.trim().split(/\s+/)[0]??'').replace(/^\{?\.?/,'').replace(/\}$/,'').toLowerCase();
  return /^[a-z0-9_+#.-]{1,32}$/.test(word)?word:null;
}
export function highlightable(tag:string,code:string):boolean {
  if(PLAIN_TAGS.has(tag)||code.length>MAX_HIGHLIGHT_CHARS)return false;
  let lines=1;for(let i=0;i<code.length;i++)if(code.charCodeAt(i)===10&&++lines>MAX_HIGHLIGHT_LINES)return false;
  return true;
}
```

**New file `apps/web/src/code-highlight.ts`** (only ever reached through `import('./code-highlight')`):
```ts
import {LanguageDescription} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {classHighlighter,highlightCode} from '@lezer/highlight';
import type {Parser} from '@lezer/common';
export interface Segment {text:string;classes:string}
const parsers=new Map<string,Parser|null>();   // resolved results only; failures are not cached
export function resolve(tag:string){return LanguageDescription.matchLanguageName(languages,tag,false)??LanguageDescription.matchFilename(languages,'file.'+tag);}
export function cachedParser(tag:string){return parsers.get(tag);}   // undefined = not loaded yet
export async function loadParser(tag:string):Promise<Parser|null>{
  if(parsers.has(tag))return parsers.get(tag)!;
  const description=resolve(tag);
  if(!description){parsers.set(tag,null);return null;}
  const support=description.support??await description.load();   // throws on chunk failure -> caller treats as plain, not cached
  parsers.set(tag,support.language.parser);return support.language.parser;
}
export function segments(code:string,parser:Parser):Segment[]{
  const out:Segment[]=[];
  highlightCode(code,parser.parse(code),classHighlighter,(text,classes)=>{out.push({text,classes});},()=>{out.push({text:'\n',classes:''});});
  return out;
}
```
DISCOVERY (T02): `@lezer/common` is a transitive dependency; if TypeScript cannot resolve its types under pnpm strict hoisting, use `type Parser=ReturnType<...>` from `support.language.parser` instead of adding a direct dependency. DISCOVERY (T02): confirm `highlightCode` handles legacy stream-parser languages (`StreamLanguage`, e.g. Shell, TOML, Ruby) by unit test; if a stream language yields no `tok-*` classes, it still renders correct plain text (acceptable), record which.

**`Markdown.tsx` changes (T02):**
- Fence branch: compute `tag=parseFenceLanguage(opening[2]!)` and push `<CodeBlock key={key} code={code} tag={tag}/>` instead of the inline div. `blocks()` gains a second parameter `animate:boolean` passed from `Markdown` (`useMemo(()=>blocks(text,animate),[text,animate])`) and forwarded to `CodeBlock`.
- `CodeBlock({code,tag,animate})`:
  - `const wanted=tag!==null&&highlightable(tag,code);`
  - Module-level `let highlightModule: typeof import('./code-highlight') | undefined` and `let highlightModulePromise`; `useState<Parser|null|undefined>(()=>wanted?highlightModule?.cachedParser(tag!):undefined)`.
  - `useEffect` keyed on `[tag,wanted]`: if `wanted` and parser state is `undefined`, `import('./code-highlight')` (memoized promise; reset the promise on rejection) → `loadParser(tag)` → set state if still mounted and tag unchanged (generation ref). On any rejection: set state `null` (plain), no toast, no console error beyond dev.
  - `const parts=useMemo(()=>wanted&&parser&&highlightModule?highlightModule.segments(code,parser):null,[code,parser,wanted]);` — computed synchronously from the current `code`, so text is never stale (R07).
  - Render:
    ```tsx
    <div className="markdown-code" data-language={tag??undefined} data-highlight={parts?'ready':undefined} data-tint={parts&&animate?'true':undefined}>
      {tag&&<span className="markdown-code-language">{tag}</span>}
      <CopyButton text={code} label="Copy code"/>
      <pre><code>{parts?parts.map((part,index)=>part.classes?<span key={index} className={part.classes}>{part.text}</span>:<Fragment key={index}>{part.text}</Fragment>):code}</code></pre>
    </div>
    ```
  - With `tag===null` the output must equal today's DOM (no label, no data attributes).
- Keep `CodeBlock` in `Markdown.tsx` (not a new file) so the public-source manifest only gains the two new modules.

### Visual design (exact values; no design choices left to the implementer)

**V1 Layout.**
- Unlabelled block: unchanged (`pre` padding `14px 16px`, radius 9px, background `var(--subtle)`, Copy at `top:6px; right:6px`).
- Labelled block (`.markdown-code[data-language]`): a 32px header band inside the same `pre` background — `pre` padding becomes `34px 16px 14px` (top 34px = 32px band + 2px). No border or divider line between band and code (**DECIDED**: one container, no nested chrome, per DESIGN.md "one visible outer container").
- Label `.markdown-code-language`: `position:absolute; top:8px; left:16px; max-width:calc(100% - 64px); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--interface-font,inherit); font-size:11px; line-height:16px; font-weight:500; letter-spacing:.01em; color:var(--muted); user-select:none; pointer-events:none;`. Left edge aligns with the code text (16px). No background, no pill, no uppercase.
- Copy button: unchanged position and hover/focus/`hover:none` visibility rules; in a labelled block it sits in the band, so it no longer covers the first code line.
- Word wrap off: the band does not scroll with horizontal code scroll (label is positioned against `.markdown-code`, not inside `pre`'s scroll box) — verified in T05.

**V2 Color tokens** (added to `apps/web/src/markdown.css`; light values on `:root`, dark on `:root[data-theme="dark"]`). Contrast ratios computed against the code block background `--subtle` (`#f5f5f5` light, `#171717` dark) with the WCAG 2.x formula during planning; T03 re-verifies them in a unit test.

| Token | Applied to classes | Light | ratio | Dark | ratio | Style |
|---|---|---|---|---|---|---|
| `--syntax-keyword` | `tok-keyword`, `tok-macroName` | `#AF00DB` | 5.01 | `#C586C0` | 6.44 | |
| `--syntax-string` | `tok-string`, `tok-string2` | `#A31515` | 7.20 | `#CE9178` | 6.78 | |
| `--syntax-number` | `tok-number`, `tok-bool`, `tok-atom`, `tok-literal` | `#067550` | 5.25 | `#B5CEA8` | 10.55 | |
| `--syntax-comment` | `tok-comment` | `#59616B` | 5.76 | `#7F848E` | 4.78 | italic |
| `--syntax-type` | `tok-typeName`, `tok-className`, `tok-namespace`, `tok-variableName2` | `#1C6B82` | 5.54 | `#4EC9B0` | 8.80 | |
| `--syntax-property` | `tok-propertyName` | `#0451A5` | 7.07 | `#9CDCFE` | 12.02 | |
| `--syntax-heading` | `tok-heading` | `#800000` | 10.04 | `#569CD6` | 6.08 | bold (600) |
| `--syntax-link` | `tok-link`, `tok-url` | `#0066BF` | 5.27 | `#4FC1FF` | 8.88 | underline |
| `--syntax-meta` | `tok-meta`, `tok-labelName` | `var(--muted)` | 5.27 | `var(--muted)` | 6.86 | |
| `--syntax-invalid` | `tok-invalid` | `var(--danger)` | 4.96 | `var(--danger)` | 6.54 | wavy underline |

- Not colored (inherit `var(--text)`): `tok-variableName` (incl. `tok-local`, `tok-definition`), `tok-operator`, `tok-punctuation`, `tok-inserted`, `tok-deleted` (diff coloring out of scope). `tok-emphasis` italic, `tok-strong` font-weight 600, no color.
- Dark values match #1344 §8.3. Three light values intentionally differ from #1344 §8.3 (`#098658`→`#067550`, `#6A737D`→`#59616B`, `#267F99`→`#1C6B82`) because those measured 4.22, 4.42 and 4.21 against `#f5f5f5`; T06 posts a note on #1344 recommending the editor reuse these `--syntax-*` tokens.
- High contrast (`data-contrast=high`): no extra overrides; `--syntax-meta` follows the high-contrast `--muted` automatically.
- CSS shape (selectors scoped to Markdown code so other `tok-*` users are unaffected):
  ```css
  :root { --syntax-keyword:#AF00DB; --syntax-string:#A31515; --syntax-number:#067550; --syntax-comment:#59616B; --syntax-type:#1C6B82; --syntax-property:#0451A5; --syntax-heading:#800000; --syntax-link:#0066BF; --syntax-meta:var(--muted); --syntax-invalid:var(--danger); }
  :root[data-theme="dark"] { --syntax-keyword:#C586C0; --syntax-string:#CE9178; --syntax-number:#B5CEA8; --syntax-comment:#7F848E; --syntax-type:#4EC9B0; --syntax-property:#9CDCFE; --syntax-heading:#569CD6; --syntax-link:#4FC1FF; }
  .markdown-code[data-language]>pre { padding-top:34px; }
  .markdown-code>.markdown-code-language { /* V1 values */ }
  .markdown-code :is(.tok-keyword,.tok-macroName) { color:var(--syntax-keyword); }
  /* …one rule per token row above… */
  ```

**V3 Motion.**
- Live replies only (`data-tint="true"`, i.e. `Markdown animate` is true): when tokens first appear, each newly mounted token span plays `@keyframes markdown-code-tint { from { color:var(--text); } }` over `var(--ui-motion-status)` (160ms) with `var(--ui-ease-move)`, `animation-fill-mode:backwards`. Only color animates: no opacity, transform or layout change. Spans that persist across streaming updates are not remounted (index keys), so they do not re-animate; tokens appended while streaming tint in as they mount.
- Restored history, non-animated surfaces, and any block that was already highlighted on first render (grammar cached): no animation.
- `data-motion=off|reduced` and `prefers-reduced-motion: reduce`: no animation (existing global rules in `appearance.css` lines 17–20, plus an explicit `@media (prefers-reduced-motion:reduce){ .markdown-code[data-tint] span{animation:none;} }` next to the existing copy-button rule).
- The label has no animation of its own (it may take part in the reply's existing grapheme reveal, like other prose).
- The plain→highlighted swap never changes layout: same font, size and line height; the band exists from the first render because it depends only on the tag.

### D. Decisions and rejected options
| # | Decision | Rejected |
|---|---|---|
| D1 | Reuse the Lezer grammars CodeMirror ships (`@codemirror/language-data` + `@lezer/highlight` `highlightCode`), same pins as #1494, one highlighting stack for replies and the editor | Shiki (TextMate grammars + Oniguruma WASM, large, second stack); Prism / highlight.js (regex highlighters, second stack, separate theme) |
| D2 | Lazy-load the highlighter module and grammars | Static import (would put `@codemirror/view` into the entry chunk) |
| D3 | Label shows the tag as written (lowercased) | Resolved display name (text changes after load) |
| D4 | Exact alias match, then extension fallback; no fuzzy match | Fuzzy `matchLanguageName` (substring matches, e.g. tags containing `c`) |
| D5 | Highlight unclosed streaming fences synchronously from cached parser | Highlight only closed fences (colors pop in only at the end) |
| D6 | Cap 20,000 chars / 1,000 lines | No cap (parse cost on every streaming update) |
| D7 | Class-based colors via CSS tokens | Inline styles via `tagHighlighter` (no theme switch without re-render) |

### Error, cancel, retry
- Module or grammar import rejects → block plain; the memoized module promise is cleared on rejection so the next block retries once; parser failures are not cached.
- Component unmounts or `tag` changes before load resolves → result ignored (generation ref).
- Parse throws (unexpected) → catch in `segments` caller, render plain.

### Integration / dependencies
- **Preferred:** land after PR #1494 merges (it adds the three packages and notices).
- **If #1494 has not merged when implementation starts:** add exactly `@codemirror/language` 6.13.1, `@codemirror/language-data` 6.5.2 and `@lezer/highlight` 1.2.5 to root `package.json` `dependencies` (sorted), run `pnpm install`, and add a notice paragraph for those packages and their transitive `@codemirror/*`, `@lezer/*`, `style-mod`, `w3c-keyname`, `crelt` packages (MIT, Marijn Haverbeke and contributors) mirroring #1494's wording. Comment on #1494 so whichever lands second rebases cleanly.

## EXECUTION_DAG

| ID | Goal | Depends on | Files (ownership) |
|---|---|---|---|
| T01 | Dependencies and notices | — (or PR #1494 merged) | `package.json`, `pnpm-lock.yaml`, `THIRD_PARTY_NOTICES.md` |
| T02 | Tag parsing, highlighter module, `CodeBlock` wiring | T01 | `apps/web/src/code-language.ts` (new), `apps/web/src/code-highlight.ts` (new), `apps/web/src/Markdown.tsx`, `scripts/public-source-files.json` |
| T03 | Unit tests (parsing, segments fidelity, cap, contrast) | T02 | `tests/code-highlight.test.ts` (new) |
| T04 | Visual design, motion, bundle check | T02 | `apps/web/src/markdown.css` |
| T05 | Browser tests and evidence | T03, T04 | `tests/e2e/markdown.spec.ts` |
| T06 | PR, issue checkpoint, front end team review handoff | T05 | issue/PR comments only |

T01→T02→(T03 ∥ T04)→T05→T06. T03 and T04 touch disjoint files and may run in parallel.

### T01 Dependencies and notices
- **Goal:** the three packages available at the exact versions above.
- **Steps:** check `git log origin/main -- package.json` for #1494. If merged: verify the three entries exist and add one sentence to the #1494 notice paragraph in `THIRD_PARTY_NOTICES.md`: "Reply code blocks use the same `@codemirror/language`, `@codemirror/language-data` and `@lezer/highlight` packages for read-only syntax highlighting." If not merged: follow "Integration / dependencies" above.
- **Tests:** `pnpm install --frozen-lockfile` passes after the lockfile update; `pnpm typecheck` passes.
- **Done when:** `node -e "import('@codemirror/language-data').then(m=>console.log(m.languages.length))"` prints a number > 100 from the repo root.
- **Handoff:** T02.

### T02 Tag parsing, highlighter, wiring
- **Goal:** R01–R07, R11–R13.
- **Steps:** create `code-language.ts` and `code-highlight.ts` exactly as in DESIGN; change the fence branch and add `CodeBlock` in `Markdown.tsx`; thread `animate` into `blocks()`; add `"apps/web/src/code-highlight.ts"` and `"apps/web/src/code-language.ts"` to the `source` array of `scripts/public-source-files.json` in sorted position (resolve the `runtime` DISCOVERY by mirroring `Markdown.tsx`'s membership).
- **Negative cases:** invalid tag characters (` ```<script> `), tag over 32 chars, `diff`, unknown tag, empty fence, unclosed fence, CRLF input (already normalized by `blocks()` line 77).
- **Tests:** T03, T05; `pnpm typecheck`, `pnpm lint`, `pnpm lint:ui`, `pnpm test:ui-guard`, `pnpm vitest run tests/public-source.test.ts`.
- **Done when:** a ```` ```ts ```` block in the dev app shows colored tokens and a `ts` label; an untagged block's DOM is unchanged.
- **Handoff:** T03, T04.

### T03 Unit tests (`tests/code-highlight.test.ts`, vitest, node)
- `parseFenceLanguage`: `'ts'`→`ts`; `'TypeScript title="a.ts"'`→`typescript`; `'{.python}'`→`python`; `'c++'`→`c++`; `'c#'`→`c#`; `''`→null; `'<script>'`→null; 33-char word→null.
- `highlightable`: `diff`/`text`→false; 20,000 chars→true; 20,001→false; 1,000 lines→true; 1,001→false.
- `resolve`: `ts`→TypeScript, `py`→Python (extension fallback), `sh`→Shell, `yml`→YAML, `csharp`→C#, `foo`→null, `c`→C (exact, not fuzzy).
- `loadParser`+`segments` for TypeScript, Python, JSON, CSS, HTML, Shell: `segments(...).map(s=>s.text).join('')===code` (fidelity, including blank lines and trailing newline); TypeScript `const` has class containing `tok-keyword`, a string literal `tok-string`, `// c` `tok-comment`; `<script>` inside a TS string stays a text segment.
- Contrast: parse the `--syntax-*` hex values from `apps/web/src/markdown.css` and `--subtle` from `apps/web/src/styles.css` for both themes; assert WCAG ratio ≥ 4.5 for every color token (skip `var(...)` tokens, covered by existing palette).
- DISCOVERY: if importing `@codemirror/language` fails in the node environment (DOM globals in `@codemirror/view`), add `// @vitest-environment happy-dom` only if `happy-dom`/`jsdom` is already a dependency; otherwise move the `loadParser`/`segments` cases to T05 as browser assertions and keep the pure-function cases here. Record the choice in the PR.
- **Done when:** `pnpm vitest run tests/code-highlight.test.ts` passes.

### T04 Visual design, motion, bundle check
- **Goal:** V1–V3, R08–R11.
- **Steps:** add the token block, layout, token rules, keyframes and reduced-motion rule to `apps/web/src/markdown.css` exactly as specified. Do not edit `styles.css` base `pre` rules.
- **Bundle check:** `pnpm build`; then confirm the entry chunk (DISCOVERY: the entry file name under `dist/web/assets/`, #1494 names `DesktopEntry-*.js`) contains none of `EditorView`, `LanguageDescription`, `classHighlighter`, and that a separate chunk contains `classHighlighter`. Record the chunk names and sizes in the PR.
- **Done when:** visual checks in T05 pass in light and dark and the bundle check passes.

### T05 Browser tests and evidence (`tests/e2e/markdown.spec.ts`)
Add tests using the existing `documentFixture`:
1. ```` ```ts\nconst x = "a"; // c\n``` ```` → `.markdown-code-language` text `ts`; `pre code .tok-keyword` has text `const`; `.tok-string` `"a"`; `.tok-comment` `// c`; `pre code` `toHaveText` the raw code; computed color of `.tok-keyword` equals `rgb(175, 0, 219)` in light and `rgb(197, 134, 192)` after setting `data-theme="dark"` on `documentElement` (DISCOVERY: how the fixture switches theme; else set the attribute directly).
2. Untagged fence → no `.markdown-code-language`, no `[data-language]`, no `tok-*`; existing tests unchanged and passing.
3. ```` ```foo ```` → label `foo`, no `tok-*` spans. ```` ```diff ```` → label `diff`, no `tok-*`.
4. 1,001-line ```` ```ts ```` block → label shown, no `tok-*`.
5. Copy code on a highlighted block: grant clipboard permission (`context.grantPermissions(['clipboard-read','clipboard-write'])`), click Copy code, `navigator.clipboard.readText()` equals the raw code.
6. Label does not overlap code: label bounding box bottom ≤ first code line box top; with `data-word-wrap=false` and a long line, scrolling `pre` horizontally leaves the label's x unchanged.
7. Hostile: ```` ```html\n<img src=x onerror="globalThis.markdownExecuted=true">\n``` ```` → no `img` element, `markdownExecuted` undefined, text visible.
8. Reduced motion: `page.emulateMedia({reducedMotion:'reduce'})` → computed `animation-name` of a token span is `none`.
- **Evidence:** screenshots of a TS, Python and JSON block in light and dark (store under the existing `.harness-markdown-evidence` folder used by this spec) attached to the PR.
- **Done when:** `pnpm test:e2e` (or `pnpm build && pnpm test:browser`) passes for `markdown.spec.ts`.

### T06 PR, checkpoint, front end team review
- Open one PR "Syntax highlighting in reply code blocks" linked to this issue, following `.github/pull_request_template.md`, with the screenshots from T05, test commands and results, bundle-check results and any DISCOVERY outcomes.
- Post an AGENTS.md checkpoint on this issue.
- Post a comment on #1344 recommending the editor theme reuse the `--syntax-*` tokens (and the three adjusted light values).
- **Final step: send the finished work to the front end team for review** — post a handoff comment on this issue and the PR addressed to the front end team with the PR link, the light/dark screenshots, and the specific points to review: header band spacing, label typography, token palette, tint motion. Leave the PR for repository reviewers; do not merge it yourself.
- Post the RELEASE checkpoint (`OWNER=NONE`).

## VALIDATION

**Setup:** Node 24 (`.nvmrc`), `pnpm install` from the repo root.

**Commands (planned, not run):**
- `pnpm typecheck`
- `pnpm lint`
- `pnpm lint:ui`
- `pnpm test:ui-guard`
- `pnpm vitest run tests/code-highlight.test.ts tests/public-source.test.ts`
- `pnpm build` + T04 bundle grep
- `pnpm build && pnpm test:browser` (Playwright; at least `tests/e2e/markdown.spec.ts`)

**Acceptance matrix**

| Requirement | Task | Acceptance check |
|---|---|---|
| R01 tag parsing | T02 | T03 parse cases |
| R02 resolution | T02 | T03 resolve cases |
| R03 highlighting | T02 | T03 segments classes; T05 test 1 |
| R04 label | T02, T04 | T05 tests 1–4 |
| R05 copy/selection fidelity | T02 | T03 fidelity; T05 tests 1, 5 |
| R06 cap | T02 | T03 highlightable; T05 test 4 |
| R07 streaming | T02 | Manual: stream a reply with a ts fence in the dev app, text always matches; code review of `useMemo` on `code` |
| R08 tokens/contrast | T04 | T03 contrast; T05 test 1 colors |
| R09 settings | T04 | T05 test 6 (word wrap); manual Code font/size change |
| R10 motion | T04 | T05 test 8; manual live reply tint vs reload no tint |
| R11 bundle | T02, T04 | T04 bundle check |
| R12 failure | T02 | Manual: block the chunk URL in DevTools → plain with label, no error UI |
| R13 surfaces | T02 | Manual: a fenced block in a user prompt and in a Document window is highlighted |
| Security | T02 | Existing hostile tests + T05 test 7 |

**Regressions to watch:** all existing `markdown.spec.ts` tests; Conversation Find in a reply with highlighted code (text nodes split across spans must still be found — manual check, find `const x` across a token boundary); `SentenceReveal` grapheme reveal of prose after a code block.

**Release gate:** all commands above pass, screenshots attached, front end team review handoff posted.

## STATE

| Item | State |
|---|---|
| Research and plan | DONE (rev 1) |
| Implementation T01–T06 | NOT_STARTED |
| Verification | NOT_RUN (no tests executed during planning) |
| Owner | none; open for an implementing agent |
| Risks | #1494 merge timing (T01 covers both orders); stream-language highlight coverage (T02 DISCOVERY); node test environment for CodeMirror imports (T03 DISCOVERY) |
| Next step | Implementing agent reads this issue, claims it per AGENTS.md, starts T01 |

## REFERENCES

- Gen baseline: https://github.com/skytuhua-org/Gen-V1/tree/4ca1134ae1e4f354064457cb5664b545712da4a9
- `apps/web/src/Markdown.tsx` at baseline: https://github.com/skytuhua-org/Gen-V1/blob/4ca1134ae1e4f354064457cb5664b545712da4a9/apps/web/src/Markdown.tsx
- CodeMirror/Lezer pins: https://github.com/skytuhua-org/Gen-V1/pull/1494
- Manual editor plan (syntax theme §8.3): https://github.com/skytuhua-org/Gen-V1/issues/1344
- `@lezer/highlight` `highlightCode` / `classHighlighter`: https://lezer.codemirror.net/docs/ref/#highlight.highlightCode
- `@codemirror/language` `LanguageDescription`: https://codemirror.net/docs/ref/#language.LanguageDescription
- `@codemirror/language-data`: https://github.com/codemirror/language-data
- User requests: https://github.com/openai/codex/issues/44180, https://github.com/anthropics/claude-code/issues/64968
- WCAG 2.2 contrast (minimum): https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
