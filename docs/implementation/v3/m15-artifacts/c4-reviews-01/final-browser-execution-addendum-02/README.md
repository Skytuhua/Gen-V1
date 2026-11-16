# Final03 browser execution addendum

This immutable plan uses new run identities and binds the same complete commands to final03 source manifest 0c4ceab16a33448876d38b5a3d4e1877c0adf7d267cb587dfa60853db21ff260. The manifest has 2,391 non-document source files and 55,491,032 bytes. Only workbench-recovery.ts and the source-handoff unit test differ from final02; every browser spec, fixture and config is unchanged.

After root release, run App 26, desktop 31 and renderer 21 sequentially as c4-workbench-app-final-02, c4-desktop-final-02 and c4-workbench-final-02. The exact child commands remain the declared Chromium configs with line/JSON reporting and absolute JSON destinations. No case filters, retries, deadline changes, source edits or channel overrides are added. The existing renderer benchmark budget remains unchanged.

Hold execution until the new host selection, typecheck, build and UI policy are terminal and root releases the browser slot. Match the manifest SHA and verify every source byte before and after each command, including failures; retain both verification records under the run's artifact directory. Stop on a source mismatch. Report failures before continuing other safe independent suites. Keep the renderer quiet.

Final02 App 22/4 and desktop 26/5 remain failed observations; renderer 21/0 remains its separate pass. A later pass alone does not explain the stale-source reload or rollback startup failures. This plan supplies no new execution result, Edge result, installed-desktop result or release acceptance.
