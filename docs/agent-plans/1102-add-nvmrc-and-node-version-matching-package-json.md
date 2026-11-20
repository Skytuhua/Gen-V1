<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1102 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: Node version files at repo root
- Repo: `skytuhua-org/Gen-V1`; plan revision 1, 2026-11-20
- Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified `git rev-parse HEAD`)
- Issue: #1102. Source provenance: reviewer `devin-a-cloud-51c9e2`, read-only inspection.
- Current status: implementer `devin-a-cloud-29cda7` already opened PR #1110 for this scope (claimed before this plan). Not yet merged; files absent on baseline.

### OBJECTIVE
Both files exist on a PR to `main`, each containing exactly `24`. Success = Done-when bullets.

### REQUIREMENTS
- In scope: create `/home/ubuntu/repos/Gen-V1/.nvmrc` and `/home/ubuntu/repos/Gen-V1/.node-version`, each with the literal content `24` followed by a trailing newline.
- Out of scope: code changes, docs, `.github/` workflow edits, pinning a fuller version (`24.10.0`), `.npmrc`, volta/asdf/mise config beyond these two files.
- Exact content: the string `24` (major version only — matches `engines >= 24.10.0` while letting version managers resolve the newest 24.x).

### REPO_MAP (verified on baseline)
- `package.json` `engines.node` = `>=24.10.0`.
- Neither `.nvmrc` nor `.node-version` exists at repo root (verified `ls`).
- CI: `.github/workflows/docs-links.yml:45` uses `actions/setup-node`; no `node-version-file` input currently — discovery: if any workflow should consume these files later, that is a separate change and out of scope.

### DESIGN
Two new files at repo root, exact bytes:
```
.nvmrc        → "24\n"
.node-version → "24\n"
```
No other edits. No control/data flow, no contracts.

### EXECUTION_DAG
- T01 (no deps): `printf '24\n' > .nvmrc && printf '24\n' > .node-version` at repo root. Done when `cat .nvmrc .node-version` prints `24` twice.
- T02 (deps T01): branch `chore/node-version-files`, one commit adding both files, PR to `main` with `Closes #1102`, post PR checkpoint. Recipient: maintainer.

### VALIDATION
- `cat .nvmrc .node-version` → `24`, `24`.
- `git status` shows exactly the two new files; `git diff --stat` shows 2 additions.
- `pnpm typecheck` unaffected (no code touched) — run anyway as a smoke check.
- Acceptance = Done-when bullets.

### STATE
Researched + decided; PR #1110 already implements this scope — if it merges, verify both files on main and close; otherwise T01–T02 stand ready. Next step: T01 (or verify #1110 contents match: `24`/`24`).

### REFERENCES
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1102; PR #1110.
- Baseline `7ef0710c`; `package.json` engines verified above.

