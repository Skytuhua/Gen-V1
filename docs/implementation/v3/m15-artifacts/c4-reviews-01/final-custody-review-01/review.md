# C4 final custody checker review, first cut

Reviewed the complete helper at SHA-256 `86a0c096d0968f502befa220edfb3e7c43c1c9eacc462166b254c07682843999`, the complete C3 predecessor, the complete source-cut-v2 helper, all six current archive mappings and accepted public-source data rules. This is static review only. No helper or repository test was executed; no repository file or index was changed.

Two custody checks need strengthening before the checker can attest the intended scope.

**Exact archive membership and destination.** The first three archives each have the same number of top-level M15 source paths as their fixed count. The external archives contain18 top-level paths plus16,2,4 explicitly intended historical log rows. The checker fixes only the top-level subset and total count. Substituting another same-commit file for an extra log can satisfy that rule. Its lexical `is_relative_to` destination check also accepts noncanonical aliases and paths containing `..`. Preserve the exact extra log set and require the canonical archive path derived from the source path. The C3 predecessor already required exact source membership and canonical destinations for its smaller two-archive scope. Current archive rows I inspected have the intended mappings; this is not a claim that published evidence was lost or modified.

**Exact public runtime admission after the tested cut.** Exempting public-source-files.json permits final explicit documentation admissions, but runtime length228 plus subset/sorted checks does not prove the runtime list stayed unchanged. A same-count replacement can pass. Bind the runtime array to its exact reviewed membership or digest. Also retain the accepted data contract's version1 and canonical-path requirements; comparing public-source.ts bytes alone does not evaluate them against the exempted JSON.

The remaining reviewed controls are appropriately narrow: exact dynamic local HEAD and base ancestry, clean original checkout, fixed accepted lock/ordinary CI hashes, per-parent published evidence mode/blob/index/worktree preservation, hash-bound tested-cut identity and complete nonmanifest source membership/bytes/modes, explicit changed-path admission and scoped whitespace. No source implementation or native guard changes are needed for these checker corrections.

The final parent and post-adoption tested cut have not been executed through this checker. `review.json` records the helper hash at seal so later corrections cannot be mistaken for this reviewed first cut.
