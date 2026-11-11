# WO-8 visual comparisons

Synthetic production app/component fixtures, captured in Chromium. Before is an isolated export of origin/main `d72030013715ec94d023195d852562d7d34bc4f4`; after is this PR. These show UI behavior, not live provider activity. No external accounts or private profiles were used.

The checked-in set contains thread diff, Usage, context inspector, and label/value pairing at 1440px in both themes. The complete 112-PNG set also covers Files, live usage, software diagnostics, maps, Settings, project context and 1024px secondary captures in the WO-8 ledger.

| Screen | Dark before | Dark after | Light before | Light after |
| --- | --- | --- | --- | --- |
| thread-diff | [Before](thread-diff-before-dark-1440.png) | [After](thread-diff-after-dark-1440.png) | [Before](thread-diff-before-light-1440.png) | [After](thread-diff-after-light-1440.png) |
| usage-dialog | [Before](usage-dialog-before-dark-1440.png) | [After](usage-dialog-after-dark-1440.png) | [Before](usage-dialog-before-light-1440.png) | [After](usage-dialog-after-light-1440.png) |
| context-inspector | [Before](context-inspector-before-dark-1440.png) | [After](context-inspector-after-dark-1440.png) | [Before](context-inspector-before-light-1440.png) | [After](context-inspector-after-light-1440.png) |
| pairing | [Before](pairing-before-dark-1440.png) | [After](pairing-after-dark-1440.png) | [Before](pairing-before-light-1440.png) | [After](pairing-after-light-1440.png) |

## QA r1: long metric strings

The affected view is the actual inline `Metric` artifact, with a long sentence, an unbroken identifier, and a short numeric value/unit pair. Before uses reviewed head `08616a3`; after includes the metric wrapping fix and merges main `bef6239`. Screenshots are 1440px in dark/light, using synthetic data. Six responsive cases cover 1440/1024/768px in both themes.

| Theme | Before | After |
| --- | --- | --- |
| Dark | [Before](metric-long-value-before-dark-1440.png) | [After](metric-long-value-after-dark-1440.png) |
| Light | [Before](metric-long-value-before-light-1440.png) | [After](metric-long-value-after-light-1440.png) |
