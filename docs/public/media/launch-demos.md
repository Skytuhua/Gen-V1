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

## Study plan

[Video](launch-study-plan.mp4) · [GIF](launch-study-plan.gif)

1. Ask for a study checklist that fits 30 minutes a night.
2. Gen displays a four-day checklist with a time estimate for each session.
3. Check off the first two sessions in the table itself.

## Laptop comparison

[Video](launch-laptop-comparison.mp4) · [GIF](launch-laptop-comparison.gif)

1. Ask to compare three sample laptops by price, weight, and battery life.
2. Sort by price and then by weight; the order changes each time.
3. Select the lightest option to keep on the shortlist. Names and figures are fictional.

## Weekend itinerary

[Video](launch-weekend-trip.mp4) · [GIF](launch-weekend-trip.gif)

1. Ask for a car-free Saturday itinerary with a backup for rain.
2. Open the rain backup to read the museum suggestion.
3. Ask to move it to the morning; the next reply proposes a revised order in the same conversation.

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
- [Release checklist](launch-interactive-table.mp4) · [GIF](launch-interactive-table.gif) · [Still](launch-interactive-table.webp). Sort and select sample release tasks.
- [Plan GIF](plan-workflow.gif) · [Document GIF](document-workflow.gif) · [Earlier capture notes](readme-refresh.md).

## Recording notes

These silent recordings show real clicks, sorting, selections, and message composition in the Gen browser renderer, driven by authored fixture responses. No personal account, live inference, purchase, source-system data, or external operation is used. This is not a demonstration of the published installer's behavior. The still is framed from an actual recording. The developer launch cut adds only camera framing and zoom, with no title cards or captions. [Everyday workflow capture](https://github.com/Skytuhua/Gen-V1/actions/runs/43585601617) · [Developer workflow capture](https://github.com/Skytuhua/Gen-V1/actions/runs/43586852755).

From the repo root, with locked dependencies and FFmpeg/FFprobe installed:

```shell
pnpm exec playwright install chromium
node --import tsx scripts/record-readme-launch.ts .harness-readme-launch
```

Use `GEN_README_FLOWS=everyday` on shells with inline environment assignments to record only the everyday workflows. Set it to `developer` to record only the PR and CI workflows. The script binds a loopback-only fixture host, blocks nonlocal browser requests, and checks the visible end states.
