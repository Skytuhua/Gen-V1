# Product screenshots

These are unedited captures of the actual Gen V1 interface rendered in Chromium at 1440 × 1080. All conversations, trace spans, model choices and skills are clean **sample data**. They demonstrate the interface, not live provider authentication, inference quality, account entitlement or production measurements. No personal account, conversation or local profile was used.

- `workspace.png`: dark conversation with a trace investigation and comparison.
- `models.png`: searchable model picker with an illustrative model catalog.
- `learning.png`: Skills & learning procedure editor, supporting files and revision history.
- `workspace-light.png`: the same sample investigation in light mode.

Regenerate with `pnpm exec tsx scripts/capture-repository-screenshots.ts` after installing Chromium with `pnpm exec playwright install chromium`. The script starts and stops its own local development server and makes no model requests.
