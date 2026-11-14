# Gen V1 launch demos

[Back to the README](../../../README.md) · [Earlier workspace tour and transcripts](README.md)

## Pull request review

[GIF](launch-pull-request.gif) · [Video](launch-pull-request.mp4) · [Still image](launch-pull-request.webp)

Follow a sample branch graph from conflict inspection through resolution, checks and merge. The clip shows the actual Gen UI and its motion. The fixture supplies the conflicts, check results and merge outcome; nothing is sent to GitHub.

## Interactive checklist

[GIF](launch-interactive-table.gif) · [Video](launch-interactive-table.mp4) · [Still image](launch-interactive-table.webp)

Sort an authored release checklist and select two items inside the conversation. The table uses Gen's actual renderer and interaction controls.

## Plan and document

- [Plan GIF](plan-workflow.gif) · [Plan still](plan-workspace.png)
- [Document GIF](document-workflow.gif) · [Document still](document-workspace.png)
- [Earlier capture notes](readme-refresh.md)

The recordings use sample data and no provider sign-in, model inference, personal profile or external operation. They show the browser interface, not native installer or updater behavior. The banner is abstract artwork rather than an application screenshot. The GIFs are silent; the descriptions above give the same steps in text. Both new clips are cropped to the interactive area for legibility. They were recorded from the 0.6.5 source and use the actual UI, not generated animation. [Capture run](https://github.com/Skytuhua/Gen-V1/actions/runs/43581211200).

## Record again

From the repository root, with locked dependencies installed, install Playwright Chromium and ensure FFmpeg and FFprobe are on your path. Then run:

```shell
pnpm exec playwright install chromium
node --import tsx scripts/record-readme-launch.ts .harness-readme-launch
```

The script opens a loopback-only fixture host, blocks nonlocal browser requests, and checks each visible end state before saving the raw, uncropped videos and stills. It does not require a model account or GitHub credentials.
