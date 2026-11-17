# Gen V1 launch demos

[Back to the README](../../../README.md) · [Watch the launch video](gen-v1-launch.mp4) · [Earlier workspace tour and transcripts](README.md)

## Pull request review

[Video](launch-pr-review-workflow.mp4) · [GIF](launch-pr-review-workflow.gif) · [Still](launch-workspace.webp)

1. Ask Gen to review the sample PR and show what needs to pass.
2. Click a commit to inspect both sides of a conflict.
3. Select **Resolve conflicts**, watch checks progress to **Ready to merge**, then choose **Merge** and verify **Merged**.

The simulated checks and merge do not touch GitHub.

## CI log review

[Video](launch-ci-log-workflow.mp4) · [GIF](launch-ci-log-workflow.gif)

1. Ask why a sample Windows CI run failed.
2. Search the log for `typecheck` and select the failed event.
3. Expand **Event details** to read the sample compiler error.

## Migration checklist

[Video](launch-migration-checklist.mp4) · [GIF](launch-migration-checklist.gif)

1. Ask Gen to break down the session-store migration.
2. The steps land as an interactive checklist in the thread.
3. Check off completed steps in the table itself.

## Runtime comparison

[Video](launch-runtime-comparison.mp4) · [GIF](launch-runtime-comparison.gif)

1. Ask Gen to compare candidate base images side by side.
2. Sort by image size and then by open CVEs; the order changes each time.
3. Select the distroless candidate to keep on the shortlist. Names and figures are fictional.

## Staged rollout plan

[Video](launch-rollout-plan.mp4) · [GIF](launch-rollout-plan.gif)

1. Ask for a phased rollout of a cache migration, including the rollback.
2. Expand the rollback phase to read its checks.
3. Ask to gate phase 2 on the rollback checks; the next reply proposes the revised gate in the same conversation.

## Under the hood

**Why Hermes?** Gen needs an agent loop that can ask a model what to do next, call a tool, and feed the result back to the model. The pinned Hermes engine supplies that loop and runs locally in Python. The host connects it to the model account selected for the thread.

**Why a separate host?** The React interface runs in a browser or the Windows Electron shell. Both talk to a loopback Fastify host that checks permissions and enforces user approval when required. SQLite stores task progress and receipts so a repeated command ID can return an existing result instead of submitting the action again.

**Why a component catalog?** For typed views, the model supplies structure and data, while React provides known controls such as sortable tables and expandable sections. A separate worker handles generated JavaScript; it does not grant the app access to host tools.

[Execution and recovery details](../../architecture.md) · [Provider-specific limits](../../subscription-connections.md)

The recordings show the user workflows and do not test backend recovery, native approval dialogs or live model performance.

## How this compares

| Tool | What its documentation shows |
| --- | --- |
| [Claude Artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them) | Interactive apps and documents that can stand on their own. Apps described in the guide run on Anthropic's infrastructure. |
| [Open WebUI Artifacts](https://docs.openwebui.com/features/chat-conversations/chat-features/code-execution/artifacts/) | HTML, CSS and JavaScript previews in a dedicated Artifacts pane. Open WebUI also supports [multi-model chats](https://docs.openwebui.com/features/chat-conversations/chat-features/multi-model-chats/). |
| [Notion Agent](https://www.notion.com/help/notion-agent) | Builds and edits pages and database views in the Notion workspace. |
| Gen V1 | Typed controls inside the conversation, plus saved task state and receipts on a local Windows host, with the particular provider account retained for the thread. |

This compares documented workflows, not every capability, edition, or integration. Interactive output, local hosting, and model choice are not individually exclusive to Gen.

## Developer demos

- [Pull request review](launch-pull-request.mp4) · [GIF](launch-pull-request.gif) · [Still](launch-pull-request.webp). Conflict resolution, checks, and the merge outcome are scripted; nothing is sent to GitHub.
- [Migration checklist](launch-migration-checklist.mp4) · [GIF](launch-migration-checklist.gif). Check off migration steps in the generated table.
- [Runtime comparison](launch-runtime-comparison.mp4) · [GIF](launch-runtime-comparison.gif). Sort and select sample base images.
- [Staged rollout](launch-rollout-plan.mp4) · [GIF](launch-rollout-plan.gif). Expand the rollback phase and refine the plan.
- [Plan GIF](plan-workflow.gif) · [Document GIF](document-workflow.gif) · [Earlier capture notes](readme-refresh.md).

## Recording notes

These silent recordings show real clicks, sorting, selections, and message composition in the Gen browser renderer, driven by authored fixture responses. No personal account, live inference, purchase, source-system data, or external operation is used. This is not a demonstration of the published installer's behavior. The still is framed from an actual recording. The developer launch cut adds only camera framing and zoom, with no title cards or captions. [Everyday workflow capture](https://github.com/Skytuhua/Gen-V1/actions/runs/43585601617) · [Developer workflow capture](https://github.com/Skytuhua/Gen-V1/actions/runs/43586852755).

From the repo root, with locked dependencies and FFmpeg/FFprobe installed:

```shell
pnpm exec playwright install chromium
node --import tsx scripts/record-readme-launch.ts .harness-readme-launch
```

Use `GEN_README_FLOWS=scenarios` on shells with inline environment assignments to record only the scenario workflows. Set it to `developer` to record only the PR and CI workflows. The script binds a loopback-only fixture host, blocks nonlocal browser requests, and checks the visible end states.
