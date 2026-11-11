# WO-5.D evidence

Synthetic data in the actual App and production components. [QA r1 frontend fixes and verification](qa-r1-fixes.md) describe the current results, red-to-green evidence and limits. Backend owns major 2 via PR #129; host services, rich references and checkpoint writes remain disabled.

| Width | Original baseline | Current App | Actual-App saved restore | Named library | Retained Notes |
| --- | --- | --- | --- | --- | --- |
| 1440 | [Before](before-1440.png) | [After](after-1440.png) | [Restore](saved-drafts-app-1440.png) | [Drafts](saved-drafts-1440.png) | [Notes](notes-1440.png) |
| 1024 | [Before](before-1024.png) | [After](after-1024.png) | [Restore](saved-drafts-app-1024.png) | [Drafts](saved-drafts-1024.png) | [Notes](notes-1024.png) |
| 768 secondary | [Before](before-768.png) | [After](after-768.png) | [Restore](saved-drafts-app-768.png) | [Drafts](saved-drafts-768.png) | [Notes](notes-768.png) |

1024 component samples: [search preview](project-search-1024.png), [excerpt review](terminal-excerpts-1024.png), [checkpoint History](file-checkpoints-1024.png), [retained Usage](redundant-ui-1024.png), [saved restore](saved-drafts-restore-1024.png). [Checkpoint escaped paths](checkpoint-control-paths.png) preserve the exact review request bytes.

Full current manifests, all seven Saved Drafts states, normal/reduced motion and logs are linked from the QA report. Original baselines and historical attempt reports are preserved in ledger WO-5/fe/before-after/D-integration; historical pending-draft and capture-failure reports are not current results. Current App includes main's Chat View controls and the Drafts action; no new design was introduced.

skills: engineering-team-process, ponytail, ponytail-review.
