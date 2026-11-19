# M14 follow-up — stale fixture + fail-closed cleanup (local, pending review)

Base: `c4460fe1949f713d412a0b06ec1081a672b9dd94` (current main at
preparation time; post-#343-merge). Branch `agent/m14-followup-x1` —
local only, not pushed. Historical cuts preserved: 27/42 WSL2 custody
classification stays bound to `a99f6d07`; the independent verifier's
review cut `75196a246a3708463caa1aa493e64112c5ec2dc5` is untouched.

## X1 / WSL2 63/63 manifest

Independent verifier confirmed: no recoverable original 63-file X1
manifest exists and no approved clean privileged x86_64 ext4 broker
environment was recorded. **The 63/63 claim remains UNVERIFIED** — not
upgraded, no receipt fabricated. A recoverable manifest would need to
name exact command, tested SHA, and the dedicated broker environment;
none exists in any reviewed cut.

## Fixture reconciliation — `tests/fixtures/linux-path-guard/native.mjs`

Line ~197 asserted `CAPABILITY_DENIED` for
`{path: <root>/ordinary/save.txt, leaf: true}` — an ordinary owned leaf,
which the extended grant matrix (admitted in `6ba8dfac`, broker
extension `df1ca811`) supports: regular file, single link, owned by the
broker uid. Replaced with the documented positive contract:

- leaf acquire succeeds;
- inside the guard, `rename` of the leaf is denied `EBUSY` (the
  rename/unlink protection `pin_leaf` applies);
- the non-readOnly leaf stays writable; content verified post-release.

Denial rows untouched: `/etc` out-of-custody, symlink redirect, plus
all credential-barrier negative assertions. No permission,
authorization, or matrix row weakened.

## Bounded fail-closed cleanup corrections — `packages/core/linux-path-guard.py`

Static review found three mount-ledger gaps, all corrected
fail-closed, no `.ts` changes needed, no shared files touched:

1. **`pin()`** — a post-mount identity-check failure raised while the
   bind mount was already applied but before `self.pins` recorded it:
   permanent untracked mount (`release_paths` skips non-recorded
   paths). Now the applied mount is detached best-effort on failure;
   if detach itself fails the fence stays (denial preserved).
2. **`pin_leaf()`** — same gap across both the `MOUNT_ATTR_RDONLY`
   attribute call and the post-mount identity check. Same correction.
3. **`acquire_credential()`** — the held-ancestor `pin()` loop ran
   before the barrier existed, so a mid-loop failure leaked recorded
   pins with no unwind. Now the pinned prefix is released on failure.
4. **`release_paths()`** — one failed `umount2` aborted the loop,
   skipping all remaining paths while the caller had already popped
   the group (lost accounting). Now each pin releases independently; a
   failed detach keeps its ledger entry and fence, remaining releases
   still run, and the first error is re-raised afterward.

Out of scope per instruction: no `.ts` client changes (the
`withLinuxDirectoryGuard` release-error masking in `finally` was noted
but is a behavioral question, not a bounded fix), no M12/M16
`file-access.ts`, no ancestry/existing-writer redesign.

## Verification performed (aarch64, this host)

- `python3 -m py_compile` + `node --check`: both edited files parse.
- Mocked-LIBC unit checks (no real mounts):
  - `pin()` post-mount failure → mount detached, ledger clean. PASS
  - `release_paths` failed detach → pin retained+fenced, remaining
    paths still released, error re-raised. PASS
  - refcount >1 pin → decremented without detach. PASS
- `vitest run tests/linux-path-guard.test.ts tests/public-source.test.ts`:
  2 files, **41/41 PASS** (admitted/denied matrix + credential
  negative tests all synthetic — broker-free).

## Unrun native gates (unchanged prerequisites)

- `native.mjs` fixture end-to-end (including the reconciled leaf row):
  needs the privileged x86_64 ext4 broker environment — broker
  hard-pins `uname().machine == "x86_64"` + real-root + ext4; this host
  is aarch64.
- Full Linux custody vitest sweep under the dedicated broker (the
  historical 27/42 run's environment) — same x86_64/root/ext4 gate.
- X1 63/63 re-run: blocked separately on a recoverable manifest, which
  does not exist (see above).
