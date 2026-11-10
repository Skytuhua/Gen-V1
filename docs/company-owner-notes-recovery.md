# Owner notes: independent recovery checkpoint

The owner's communication design places local drafts in Gen's UI store and requires
preserving edits across refresh/reconnect (§13.1, §13.3, §13.4). This invariant needs
neither native employees nor new company records or APIs.

Previously, one `Promise.all` coupled view-selection and owner-note recovery. Either
read failure discarded both results, then enabled a blank editor. Editing could
replace a saved note that had never been recovered.

[CompanyWorkspace](../apps/web/src/company/CompanyWorkspace.tsx) now recovers the two
entries independently. A selection failure uses the default view without hiding
readable notes. A notes failure keeps the editor disabled and explains that reload
retries recovery. Editing is enabled only after that note read succeeds, including
a verified absent entry. The existing journal and note keys are unchanged.

[Browser regressions](../tests/e2e/company-mode.spec.ts) reproduced both failures
before implementation. After the fix, all six company-mode cases passed. The
combined company-mode, manager and context browser run passed 22/22 with process
exit 0; typecheck exited 0. Independent code review found no blocking issues.
The tests use actual browser IndexedDB with targeted read failures and intercepted
read-only HTTP fixtures. They verify exact Unicode/multiline note recovery, safe
editing after a selection error, and draft/filter retention during reconnect.

This completes the local recovery checkpoint, not full C09. C09's canonical read
models, authorization, events and trusted actions still depend on C07/C08. No
backend, runtime, shared personal code, C01 bundle, historical contract or byte rule
changed. No live model, native admission, infrastructure or publication was used.

Detailed failed and passing evidence is retained under
`test-results/company-notes-*-20261102*`.
