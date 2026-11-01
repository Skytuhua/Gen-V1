# Original Hermes Agent runtime

The harness runs the pinned original **Nous Research Hermes Agent** Python engine through `packages/runtime-hermes/worker.py`. Upstream agent loops, learning prompts, skill tools, review, curation and filesystem ledgers remain in `upstream/`; host transport and permission checks live outside that tree.

- Repository: https://github.com/NousResearch/hermes-agent
- Exact source: https://github.com/NousResearch/hermes-agent/commit/c627ec84664d43e0b18b95d9d86d8963747d56c7
- Source commit date: 2026-11-01T14:36:49Z.
- License: MIT, Copyright (c) 2025 Nous Research. The complete notice is preserved in [LICENSE](LICENSE).
- [UPSTREAM_MANIFEST.json](UPSTREAM_MANIFEST.json) records every vendored file's Git blob SHA, SHA-256 and size. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) retains the earlier seventeen-file research inventory.

Key source paths: `tools/skills_tool.py`, `tools/skill_manager_tool.py`, `tools/skill_manager_batch.py`, `tools/skill_manager_guards.py`, `tools/skill_ledger.py`, `tools/skill_usage.py`, `agent/background_review.py`, `agent/turn_finalizer.py`, `agent/skills_index_delta.py`, `agent/curator.py`, and `agent/learn_prompt.py`.

Original skill files and ledgers are canonical. SQLite projects the app's UI and preserves legacy history. The selected account's native SDK supplies model text through original Hermes ACP support; native tools are disabled there, and the original outer agent reaches only admitted host capabilities. Inline shell, template expansion, external skill roots, plugins and lazy installation are disabled by explicit source configuration. These application boundaries do not claim an operating-system sandbox or parity with every optional Hermes product feature.

Development requires installed Windows x64 CPython 3.14 and the isolated packages pinned in [runtime-requirements.txt](runtime-requirements.txt). [RUNTIME_DEPENDENCIES.json](RUNTIME_DEPENDENCIES.json) records their exact versions and the requirements digest. For a fresh dependency target:

```powershell
py -3.14 -m pip install --no-cache-dir --no-compile --target .harness-hermes-python-deps -r third-party/hermes-agent/runtime-requirements.txt
```

No global package installation or model download is required. The host starts Python with `-I -S -B` and explicitly inserts the app-owned source/dependency paths. `HARNESS_HERMES_PYTHON` may select an installed Python executable for development and packaging.

Desktop packaging performs an offline preflight before creating a staging tree. It verifies source hashes, the requirements digest and every installed distribution version, then copies only the selected Python interpreter/DLLs/standard library and isolated dependencies. It excludes package caches, global site-packages, pip, tests and development tools. Runtime assets are bounded to 15,000 files and 256 MiB.

The installed layout is `host/hermes-python`, `host/.harness-hermes-python-deps`, and the same source/worker paths as development. A generated `python314._pth` contains only `.`, `Lib`, and `DLLs`; Python documents this [relative-path isolation mechanism](https://docs.python.org/3.14/library/sys_path_init.html#pth-files), which ignores registry/environment search paths and omits global site initialization. `afterPack` checks all admitted file hashes and launches the relocated interpreter to verify standard-library and native dependency imports. Those checks run during an explicitly requested package build; source-only and fixture checks do not prove a packaged native model interaction.
