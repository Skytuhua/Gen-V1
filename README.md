# Exact reviewed M12 history

This artifact preserves the original local M12 audit and implementation commit objects. The feature publication through the GitHub connector has the same reviewed file tree but separate commit metadata.

Accepted prerequisite: `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`

Original local head: `d55433f2231597d0efe7515b187e237e11b7ac95`

Reviewed tree: `7cafb5be7f88247b14b6224b716b74812137aa24`

Bundle SHA-256: `fda85983d78b16598160d72464e639cf9ed694c50f1ad8816917fe7b826b2bb3`

The bundle was verified and imported into a disposable repository that held only the accepted-base history. All three original commit objects and the reviewed final tree matched byte for byte. The original repository and refs were unchanged. See `manifest.json` for exact observed commands and exits.

## Restore the audit objects

Use a repository containing the accepted prerequisite commit. Verify the downloaded bundle SHA-256, then run:

```sh
git bundle verify m12-reviewed-history.bundle
git bundle unbundle m12-reviewed-history.bundle
```

Unbundling imports objects without updating branch refs. The original audit commits are required by the M12 evidence builder's committed-log custody checks. The controller also checks the recorded workspace, branch, origin and original checkout; this restoration does not make arbitrary fresh-clone validation equivalent to the recorded environment.

The bundle and manifest are provenance artifacts. They do not enable features, change test outcomes, approve production execution or deploy the application.
