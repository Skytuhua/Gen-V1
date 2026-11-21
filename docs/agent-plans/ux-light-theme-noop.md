# Plan: Make Light theme actually apply

## META
- Feature: Appearance — Light theme application
- Repo: skytuhua-org/Gen-V1 — plan rev 2, 2026-11-20 (design fully specified — implementer makes no design choices)
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1134
- Parent audit issue: https://github.com/skytuhua-org/Gen-V1/issues/1140
- Status: planning complete, implementation NOT started
- Source: manual UX audit of built app on :4317 (review-host fixture)

## OBJECTIVE
Settings → Appearance → Theme = "Light" persists the select value but the entire UI stays dark — settings dialog, sidebar, chat, and panels all remain on the dark palette. This is a functional bug, not just polish. Success: selecting Light re-themes the app; System follows `prefers-color-scheme`.

## REQUIREMENTS
- Light applies the light token set app-wide (dialog + shell) immediately on change.
- System resolves to OS preference; verify media-query listener updates on OS change.
- Dark remains default-consistent; no flash of wrong theme on reload (persist + apply before paint if the app persists theme).
- Accent color behavior unchanged.

## REPO_MAP
- `apps/web/src/AppearanceSettings.tsx` — verified: Theme select + accent swatches + Custom accent field.
- `apps/web/src/settings-inventory.ts`, `apps/web/src/desktop-context.tsx` — settings registry / theme context candidates.
- Discovery: where theme resolves to a class/`data-theme` attribute (`rg -n "data-theme|theme" apps/web/src -g '*.ts*'`), CSS token definitions (`rg ":root|\[data-theme" apps/web -g '*.css'`), persistence store, and whether failure is fixture-specific (review-host may pin dark) or global.

## DESIGN SPEC (exact values — no design choices left)

**Theme application mechanism (target behavior)**
- `document.documentElement.dataset.theme` ∈ `{light,dark}` is the single source of truth, set by `AppearanceSettings.tsx:13 applyTheme` (`system` resolves via `matchMedia('(prefers-color-scheme: dark)')`) and re-synced by `WorkspaceHost.tsx:224` from `settings.theme`.
- Verify the select's onChange actually calls `applyTheme` AND persists `settings.theme`; a stale `settings` object re-applied by WorkspaceHost will silently revert the attribute — that revert is the most likely root cause (hypothesis, not proven; confirm first).
- System mode: `matchMedia('(prefers-color-scheme: dark)')` listener re-runs `update()` on OS change (pattern at `WorkspaceSurfaceBody.tsx:78-79`).
- Apply before first paint on reload: resolve `settings.theme` → `data-theme` during initial render (`DesktopEntry.tsx:40` pattern).

**Token sets (already defined in `styles.css` — both must resolve)**
- Light `:root` (default): `--canvas:#fff; --sidebar:#fafafa; --surface:#fff; --subtle:#f5f5f5; --hover:#ededed; --border:#e5e5e5; --control-border:#878787; --text:#202020; --muted:#666666; --placeholder:#737373; --selection-bg:#ededed; --selection-border:#a3a3a3; --accent:#3b5bdb; --accent-solid:#3b5bdb; --accent-hover:#304bc4; --danger:#c92a3e; --danger-soft:#fff0f1; --pending:#8a5c00; --success:#087f5b; --elevation:0 10px 32px -14px #16161638; color-scheme:light`.
- Dark `:root[data-theme="dark"]`: `--canvas:#000; --sidebar:#080808; --surface:#0f0f0f; --subtle:#171717; --hover:#262626; --border:#282828; --control-border:#707070; --text:#e6e6e6; --muted:#a0a0a0; --placeholder:#969696; --selection-bg:#1f1f1f; --selection-border:#737373; --accent:#91a7ff; --accent-solid:#3b5bdb; --accent-hover:#4263eb; --danger:#ff6b7e; --danger-soft:#3b2028; --pending:#ffc247; --success:#2dd4a0; --elevation:0 12px 34px -12px #0009; color-scheme:dark`.
- Secondary semantic tokens (`--accent-fg/bg`, `--success-fg/bg`, `--danger-fg/bg`, `--warning-fg/bg`, `--category-fg/bg`) already have both variants in styles.css lines 5–6.
- Surface uses `color-scheme` so native scrollbars/inputs follow automatically — confirm no component hard-codes `#000`/`#0f0f0f`/`#fff` instead of vars (discovery grep: `rg '#0[0-9a-f]{5}|#fff' apps/web/src -g '*.css'`).
- Light-theme gradient overrides already exist (`appearance.css:7-8` graphite/midnight) — do not duplicate.

## DESIGN
Root cause first (discovery task): either (a) the select writes state but nothing applies the attribute/class, (b) the attribute is set but only dark tokens are defined/shipped in the built bundle, or (c) fixture overrides theme. Fix at the discovered level: wire theme → `data-theme` on root, ensure light tokens exist in the built CSS, respect `prefers-color-scheme` for System.

## EXECUTION_DAG
- T01: Reproduce + trace theme value → DOM attribute → CSS tokens. done-when: root cause named with file/line evidence (hypothesis vs proven marked).
- T02: Implement fix at root cause. done-when: selecting Light visibly re-themes; System + reload persistence verified.
- T03: Check contrast on the light set (text, red "connect folder" text, accents) — adjust tokens that fail.
- T04: Screenshots light + dark; regression check that Dark still works.


**Task contract (applies to every task above):** OWNER = one implementing agent claims this issue end-to-end. PREREQ = read this plan plus files in REPO_MAP; a task also depends on the earlier task it edits the same files as (sequential by ID). HANDOFF = implement on a `devin/*` branch off current main (pull latest main before branching), open a PR linking this issue, attach before/after screenshots and the VALIDATION results; post an AGENTS.md checkpoint on this issue at each milestone.

## VALIDATION
- Fixture: switch theme to Light → UI lightens; reload keeps it; System follows emulated `prefers-color-scheme` (Playwright `emulateMedia`).
- Existing appearance tests updated/added if present.

## STATE
- rev 2: full design spec added, incl. exact theme mechanism and both token palettes.
- Researched: /tmp/audit/13-light-theme-settings.png + 14-light-theme-app.png (Theme=Light, UI still dark). Implemented: nothing. Next: T01.

## REFERENCES
- Canonical issue: https://github.com/skytuhua-org/Gen-V1/issues/1134 ; audit evidence (screenshots, DOM dumps) is recorded in the audit session https://app.devin.ai/sessions/fdeae51a36244c48af3f43ff6dc04059 and summarized in parent issue #1140.
- Audit screenshots 13/14; AppearanceSettings.tsx.
