# Plan: Make Light theme actually apply

## META
- Feature: Appearance — Light theme application
- Repo: skytuhua-org/Gen-V1 — plan rev 1, 2026-11-20
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
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

## DESIGN
Root cause first (discovery task): either (a) the select writes state but nothing applies the attribute/class, (b) the attribute is set but only dark tokens are defined/shipped in the built bundle, or (c) fixture overrides theme. Fix at the discovered level: wire theme → `data-theme` on root, ensure light tokens exist in the built CSS, respect `prefers-color-scheme` for System.

## EXECUTION_DAG
- T01: Reproduce + trace theme value → DOM attribute → CSS tokens. done-when: root cause named with file/line evidence (hypothesis vs proven marked).
- T02: Implement fix at root cause. done-when: selecting Light visibly re-themes; System + reload persistence verified.
- T03: Check contrast on the light set (text, red "connect folder" text, accents) — adjust tokens that fail.
- T04: Screenshots light + dark; regression check that Dark still works.

## VALIDATION
- Fixture: switch theme to Light → UI lightens; reload keeps it; System follows emulated `prefers-color-scheme` (Playwright `emulateMedia`).
- Existing appearance tests updated/added if present.

## STATE
- Researched: /tmp/audit/13-light-theme-settings.png + 14-light-theme-app.png (Theme=Light, UI still dark). Implemented: nothing. Next: T01.

## REFERENCES
- Audit screenshots 13/14; AppearanceSettings.tsx.
