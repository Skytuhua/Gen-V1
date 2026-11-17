# M15 lazy workbench boundary review

Reviewed at 2026-11-16 00:33:30 UTC. Review mode: independent source inspection. No App or browser implementation files were edited by this reviewer, and no browser jobs were run for this review.

## Disposition

One actionable recovery-message defect was reported and corrected by the implementation owner. No additional actionable defect was found in the inspected lazy-loading change. This is a code-review result, not browser acceptance, performance evidence, native-platform evidence, or release approval.

## Inspected scope

The reviewer read the complete current `SourceWorkbench.tsx`, `WorkbenchPanelContent.tsx`, `WorkActivity.tsx`, and `workbench-app.spec.ts`, and traced the related `WorkbenchActivity`, `WorkbenchOutput`, `WorkbenchInputsPanel`, `WorkbenchPanels`, and modal-focus code. The changed import edges and the App provider/activity call sites were inspected. The comparison covered the published M15 implementation and the current reconciled working source.

The eager `SourceWorkbenchProvider` retains the existing journal, source and input-recovery ownership. The optional panel implementation is reached through `import('./WorkbenchPanelContent')`; the source file's direct import of its props and tab types is type-only. Large activity presentation is reached through `import('./WorkbenchActivity')`. No additional static import of those optional view implementations was found in the App import paths inspected.

## Finding and correction

The initial failure messages instructed the user to close and reopen the panel or conversation to retry. Both loaders catch the entire module-import promise, which includes evaluation failures as well as fetch failures, and reopening uses the identical module specifier. The message did not distinguish those cases or establish that reopening could recover. The new browser fixture checked failed-load draft and focus retention, then reloaded the page; it did not prove successful recovery by reopening.

The implementation owner corrected both messages. The source panel now says: `The source views could not be loaded. Close this panel to continue editing. Reload the window to retry. The draft was retained.` The activity view now says: `The activity view could not be loaded. Reload the window to retry.` The corrected source was re-read before this review was finalized. The wording asks for a fresh document when retrying and does not promise that a persistent failure is repaired.

No universal claim about fetch-failure caching across browsers is made here. Browser versions and current HTML fetching semantics differ. This review did not execute a target-browser module retry experiment.

## Verified by source inspection

The modal shell, Close button, tab state, and focus region remain outside the deferred content. The existing composer remains a child of the stable provider and is not replaced by a loading fallback. Module completion sets a component reference; it does not reconstruct or import draft authority.

The existing owner, account, epoch, and generation fence remains in the provider. A scope change makes `panelScope === scope` false, which removes the old dialog. The loader effect's cleanup marks that mount inactive, so a later module completion cannot update the replaced dialog. Activity loaders likewise ignore completion after their own unmount and render using current props after successful loading.

The modal hook focuses the stable Close control and observes newly mounted controls without moving initial focus into the arriving content. Escape and modal focus restoration remain in the existing `useModalRegion` owner. The extracted descriptor retains its locator/revision key, and retained output retains its logical source identity and scroll-anchor handling.

Async source capture, open, refresh, input recovery, and presentation persistence remain with their existing owners. The lazy view does not add a command transport, grant authority, or canonical message store. The host remains responsible for exact ownership and byte authorization.

## Untested limits

This review did not run either new lazy boundary in a browser. The browser agent owns that execution slot and its receipts must supply runtime outcomes. The source-failure scenario is an actual App with deterministic host HTTP fixtures; it is not native-host authorization evidence.

The inspected new failure scenario covers blocked panel-module fetching, a still-connected composer element, retained prompt text, focus restoration, and prompt recovery after reload. It does not prove a successful retry of the failed module after the fault is removed. It does not cover a dedicated failed activity-module fetch or a module evaluation exception.

The default-off request assertion observes Vite `.tsx` requests. It does not independently certify production chunk topology, installed-desktop loading, or startup performance. A successful production build and the declared browser/platform suites remain separate gates. No whole-App latency or rendering benchmark result is inferred from source inspection.

## Reviewed source bytes

| Path | SHA-256 |
| --- | --- |
| `apps/web/src/SourceWorkbench.tsx` | `16595a6ab717aa4b0a25aa882b4b63c95e337487ec54a564ebc1aa753e7c608f` |
| `apps/web/src/WorkbenchPanelContent.tsx` | `e8d036e293d419aa1cbb0adcca8bc0dd885ca480f9d9a88ff26719540f59f79d` |
| `apps/web/src/WorkActivity.tsx` | `3a6118709384c3195f9bb25b259ce46d7b670efe2cdbd8326913f633ad2939d2` |
| `tests/e2e/workbench-app.spec.ts` | `ecd421c8372fa0132e32dc979331942180b396663ac96657d01b61796a329239` |
| `apps/web/src/WorkbenchActivity.tsx` | `20f9477187b2d18a6652caa3e597d1782f16acfd871963dbf894e68499679771` |
| `apps/web/src/WorkbenchOutput.tsx` | `97af6b234bd842ada92ef37258942128370acb07cc4534c32dc9a8c2848d63a0` |
| `apps/web/src/WorkbenchInputsPanel.tsx` | `987e86eed7d1f2cf961c16a36bed7c9032cd4af5952c3686bab2c4dcc0ab9e12` |
| `apps/web/src/WorkbenchPanels.tsx` | `46d2e3c255160fcf543d0bff0c670e2f7aeb63616b1b4d0701121f042c1fa6aa` |
| `apps/web/src/focus.ts` | `8ca47390b2047777f6539a8c14cd397c2fe37aa75685ad9929d0cdd255be13c1` |
