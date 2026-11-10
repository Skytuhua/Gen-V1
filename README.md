<div align="center">

<img src="docs/public/media/gen-banner.svg" width="100%" alt="Gen V1 — a conversation with room to work. A local AI workspace for Windows.">

# Your conversation. Your tools. One workspace.

Talk through a task. Work with an interactive view. Pick up where you left off.

**[Get started](docs/public/getting-started.md)** · **[Download the preview](https://github.com/Skytuhua/Gen-V1/releases/tag/v0.6.1)** · **[Watch a demo](#see-it-in-action)** · **[Contribute](#contribute-to-gen)**

[Features](docs/public/features.md) · [Documentation](#find-your-way) · [Windows CI](https://github.com/Skytuhua/Gen-V1/actions/workflows/ci.yml) · [Changelog](CHANGELOG.md)

</div>

<br>

![A looping capture of Gen’s document workspace with an authored sample brief open for review](docs/public/media/document-workflow.gif)

<p align="center"><sub>Actual Gen interface · Authored sample data · <a href="docs/public/media/readme-refresh.md">Screenshots, GIFs and provenance</a></sub></p>

## A conversation can be a workspace

A trace needs a timeline. A decision needs a comparison. A document needs an editor.

Gen is a local AI workspace for Windows that brings these working interfaces into the conversation. Your discussion, drafts and decisions stay together while you inspect the work and choose what comes next.

| Work with the task | Keep the thread |
| :--- | :--- |
| **Interactive task interfaces**<br>A trusted catalog of 48 components supports traces, comparisons, documents, workflows and diagrams. | **State that stays with you**<br>Conversations, task interfaces and saved state persist. Newer draft edits are retained for review. |
| **Your model, your account**<br>Search models and choose supported reasoning levels. Existing tasks retain their selected account. | **Skills you can inspect**<br>The original Hermes engine supplies skill tools, `/learn`, background review and visible revision history. |
| **A familiar place to work**<br>Projects, threads, a compact composer, dark and light themes, and tools that minimize when you need room. | **Room to extend**<br>Separately versioned packages use the public plug-in API. Gen also runs without an installed plug-in. |

**Connected inference, local working state.** The application host runs on your machine; model requests go to the provider you connect. OpenAI has recorded live task verification. Other provider routes require their own account and entitlement checks. [Connection reference →](docs/subscription-connections.md)

## See it in action

### Work on a document

The animation above shows a brief and its review beside the conversation. Work on the content while keeping the discussion close.

[Still image](docs/public/media/document-workspace.png) · [What this demonstrates](docs/public/media/readme-refresh.md#document-workspace)

### Keep the next steps in view

![A looping capture of Gen’s task plan surface with authored sample steps](docs/public/media/plan-workflow.gif)

Follow a structured plan without leaving the thread.

[Still image](docs/public/media/plan-workspace.png) · [What this demonstrates](docs/public/media/readme-refresh.md#plan-workspace)

These GIFs show the actual browser UI with authored sample data. They demonstrate interface behavior, without live model inference or external operations. Still images and [text descriptions](docs/public/media/readme-refresh.md) are available if you prefer to skip the animation.

## Get started

### Try the Windows preview

**[Download v0.6.1 for Windows x64 →](https://github.com/Skytuhua/Gen-V1/releases/tag/v0.6.1)**

The published download is an **unsigned prerelease**. Read its notes and compare the installer with `SHA256SUMS.txt` before running it. The **0.6.4 source** includes newer workspace and plug-in changes shown in the gallery; it is not a published stable download.

[Installation and provider sign-in](docs/public/getting-started.md) · [Release status and known limits](docs/public/release-notes.md)

### Run from source

Use **Windows x64**, **Node.js ≥ 24.10.0**, **pnpm 10.30.3** and **CPython 3.14 with pip**.

```powershell
git clone https://github.com/Skytuhua/Gen-V1.git
cd Gen-V1
pnpm install --frozen-lockfile
py -3.14 -m pip install --no-cache-dir --no-compile --target .harness-hermes-python-deps -r third-party/hermes-agent/runtime-requirements.txt
pnpm desktop:dev
```

For the browser interface, use `pnpm dev` and open `http://127.0.0.1:5173`. Open **Settings → Providers**, add an account and choose **Connect**, then refresh models and select an available model.

Use the [development setup guide](docs/public/getting-started.md#develop-from-a-fresh-checkout) to create a separate data directory before sign-in and startup. See the [full setup reference](docs/getting-started.md) for runtime and packaging details. Repository access and use remain subject to [LICENSE](LICENSE).

## Built around your working state

The React interface and Windows Electron shell share a local Fastify host. SQLite stores application projections and operation receipts; the pinned original Hermes engine owns conversation state and source skill packages.

- **Explicit connections.** Conversations, credentials and receipts live in local application directories. Connected providers receive model requests; inference is not offline.
- **Account continuity.** Tasks retain their selected account. Gen does not automatically rotate accounts or fall back to API-key billing.
- **Host-owned permissions.** Grants, validation and approvals bound supported file and operation access. Learned text and model output do not grant permissions.
- **Reviewable extension boundaries.** Plug-in API v1 supports independent packages with declared capabilities and durable state. [Explore the API →](docs/plugin-api.md)

<details>
<summary><strong>Current preview boundaries</strong></summary>

- Installed upgrade/update acceptance, the broader generation-quality pilot and physical mixed-DPI/multi-monitor acceptance remain open.
- New native detachment is unavailable. Context and usage tools minimize within the workspace.
- The composer can browse installed skills. Binding a selected skill to a new message is unavailable.
- Gemini/Cursor native compaction, the separate OpenCode agent runtime and Meta/Muse access are unavailable.
- Generated-code interfaces use opaque workers, validated messages and a termination watchdog. This is not a hard operating-system memory quota. Approved native runtimes and project tests execute with local-user privileges.
- Existing installations retain the `GenerativeHarness` storage namespace for compatibility.

Read [release status](docs/public/release-notes.md), [security and local data](SECURITY.md), and the [historical acceptance report](docs/2026-11-01-product-completion.md) for the scope behind these statements.

</details>

## Find your way

| I want to… | Start here |
| :--- | :--- |
| Install Gen and connect an account | [Getting started](docs/public/getting-started.md) |
| Explore what the workspace can do | [Feature tour](docs/public/features.md) |
| Understand the current preview | [Release notes and limitations](docs/public/release-notes.md) |
| Understand the host and recovery model | [Architecture](docs/architecture.md) |
| Build a workspace extension | [Plug-in API](docs/plugin-api.md) |
| Report a security issue privately | [Security policy](SECURITY.md) |
| Make a useful contribution | [Contributor guide](CONTRIBUTING.md) |

## Contribute to Gen

Good contributions start with a clear problem. A reproducible bug, a better explanation, an accessibility improvement or a focused fix can all make Gen better.

**[Read the contributor guide →](CONTRIBUTING.md)**

[Report a bug](https://github.com/Skytuhua/Gen-V1/issues/new?template=bug_report.yml) · [Suggest a feature](https://github.com/Skytuhua/Gen-V1/issues/new?template=feature_request.yml) · [Improve the docs](https://github.com/Skytuhua/Gen-V1/issues/new?template=documentation.yml)

Coordinate source changes with the maintainer before starting; the current first-party license does not grant general modification or redistribution rights. The guide explains setup, focused checks and what makes a pull request easy to review.

### Contributors

<a href="https://github.com/Skytuhua"><img src="https://avatars.githubusercontent.com/u/99881928?v=4&amp;s=64" width="56" height="56" alt="Skytuhua, Gen V1 creator and maintainer"></a>

Created and maintained by [Skytuhua](https://github.com/Skytuhua). [View the contribution history →](https://github.com/Skytuhua/Gen-V1/graphs/contributors)

## License and acknowledgments

**Gen’s first-party source is proprietary and currently unlicensed for redistribution.** Source availability does not grant an open-source license. Read [LICENSE](LICENSE) before using or redistributing it.

Gen builds on the work of [Nous Research Hermes Agent](third-party/hermes-agent/README.md) and identified [T3 Code](third-party/t3code/README.md) components, with retained source provenance and MIT notices. Other retained integrations and dependencies keep their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md), [package.json](package.json) and [pnpm-lock.yaml](pnpm-lock.yaml).

<div align="center">

<sub>Gen V1 is an independent project. Provider names and marks belong to their respective owners.</sub>

</div>
