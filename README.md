# M12 original local history

This artifact branch preserves the exact original local audit, implementation and final documentation commits for draft PR #355. The authenticated GitHub connector publishes the same reviewed source tree with a different commit identity because its commit API cannot preserve original author/committer timestamps.

Local head: `be824cdbc07a07db89bce7aac8c7c2ff148152c3`. Exact tree: `2778ae29bc4cec8bf47be5767a515f7641eb8f45`.

Bundle SHA-256: `875c1fe97d40c50c0704080a37f8266bb51ca202c3f6a20c13380b9d5c371da0`. Bundle size: 1630591 bytes. Prerequisite accepted base: `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`.

The manifest records four original commit objects and their successful byte-for-byte restoration in a disposable bare repository populated only with the accepted-base history. `git bundle unbundle` restores objects without updating branch references. No force update, account change, deployment or PR merge is part of this archive.

From a repository containing the accepted-base history, verify and import the downloaded bundle:

```sh
git bundle verify /absolute/path/m12-reviewed-history.bundle
git bundle unbundle /absolute/path/m12-reviewed-history.bundle
git cat-file -t be824cdbc07a07db89bce7aac8c7c2ff148152c3
git rev-parse be824cdbc07a07db89bce7aac8c7c2ff148152c3^{tree}
```

The historical objects are required by `M12-build-evidence.py`. The evidence controller additionally checks its recorded workspace, original checkout, branch and origin. This archive does not claim that an arbitrary clone automatically satisfies those environment assumptions. The source-drift audit references immutable upstream `5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42`; fetching it for source inspection does not accept it as the execution base.

The earlier archive remains in this branch history. This bundle retains every original local bundle commit, including the final documentation-only source-drift gate. Canonical bundle acceptance remains FAIL; platform coverage is partial; production approval and all three capability flags remain false.
