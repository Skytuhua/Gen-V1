# Hermes Agent learning reference

Procedural-learning guidance and behavior in `packages/core/learning-context.ts`, the skill library and automatic review/curation are adapted from **Nous Research's Hermes Agent**, not from an unpinned mirror or a bundled third-party skill.

- Repository: https://github.com/NousResearch/hermes-agent
- Exact source: https://github.com/NousResearch/hermes-agent/commit/c627ec84664d43e0b18b95d9d86d8963747d56c7
- Source commit date: 2026-11-01T14:36:49Z.
- License: MIT, Copyright (c) 2025 Nous Research. The complete notice is preserved in [LICENSE](LICENSE).
- [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) records the seventeen inspected source files' official Git blob SHA, local SHA-256, size and pinned URL. The research snapshot was verified against Git blob hashes. Downloaded Python was not executed and is not a runtime dependency.

Key source paths: `tools/skills_tool.py`, `tools/skill_manager_tool.py`, `tools/skill_manager_batch.py`, `tools/skill_manager_guards.py`, `tools/skill_ledger.py`, `tools/skill_usage.py`, `agent/background_review.py`, `agent/turn_finalizer.py`, `agent/skills_index_delta.py`, `agent/curator.py`, and `agent/learn_prompt.py`.

The Harness implementation uses TypeScript, its existing SQLite event/projection store and its existing runtime/account owners. Its atomic versions replace filesystem rollback manifests; supporting files are text identifiers in app-owned storage. Loading never executes inline shell, installs dependencies or scans arbitrary machine/project skill roots. These are deliberate permission-preserving differences. No claim is made that the entire Hermes product or all optional memory/marketplace/graph features were copied.
