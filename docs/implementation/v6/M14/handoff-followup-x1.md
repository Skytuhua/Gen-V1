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

Static review found three mount-ledger gaps; manager review found two
further accounting faults in the first correction, all repaired
fail-closed. No `.ts` changes, no shared files touched:

1. **`pin()` / `pin_leaf()`** — a post-mount identity/attribute
   failure raised while the bind mount was applied but before
   `self.pins` recorded it: an untracked permanent mount. The unwind
   now detaches with `checked()` (verifies the actual syscall
   outcome); a failed detach records the path in
   `self.quarantined` — applied but unledgered mounts stay fenced and
   ordinary acquisitions cannot borrow them (`pin`/`pin_leaf` refuse
   quarantined paths).
2. **`acquire_credential()`** — the held-ancestor `pin()` loop ran
   before the barrier existed, so a mid-loop failure leaked recorded
   pins with no unwind. Now the pinned prefix is released on failure.
3. **`release_paths()`** — now returns the unresolved subset instead
   of aborting: each pin releases independently; a failed detach
   keeps its ledger entry and fence; a still-held child's ancestors
   stay held — including children quarantined by a failed earlier
   unwind — while independent siblings release normally.
4. **`release` command** — no longer pops the group before release.
   An unresolved cleanup stores the *unresolved-only* held list under
   the lease (ownership and identity retained; a cleanup refusal does
   not claim release — it raises) and a retry resumes exactly the
   unresolved set, so released paths cannot be double-decremented.
   Fully-settled groups are deleted as before.
5. **Failed-rollback ownership** — every unwind caller now records its
   unresolved leftovers under a named cleanup owner in
   `self.unresolved` (the failed lease id for ordinary `acquire`, the
   credential parent for `prepare_credential`/`acquire_credential`),
   instead of leaving ownerless refcounts. A failed acquire's id
   enters `unresolved`, never `groups` — it is not a usable lease.
6. **Credential-scope cleanup** — `release_credential` retains the
   barrier's held list on unresolved ancestry release and raises
   `CustodyUncertain`; the scope-scoped credential-clear loop retains
   each `prepared` entry whose `held` pins did not fully release
   (fd kept open) and raises `CustodyUncertain` so pending ancillary
   cleanup is explicitly uncertain rather than claimed complete.
7. **`drop_pin`** — refuses to release a parent that has a quarantined
   descendant (`Quarantined child retains ancestry custody`).

Out of scope per instruction: no `.ts` client changes (the
`withLinuxDirectoryGuard` release-error masking in `finally` was noted
but is a behavioral question, not a bounded fix), no M12/M16
`file-access.ts`, no ancestry/existing-writer redesign, no policy
redesign.

## Guard-side diagnosis — WSL verifier ordinal 29 (credential-loss/barrier FAIL)

Verifier reported: native directory custody PASS; credential-loss and
credential-barrier FAIL at ordinary credential submount admission.
Guard-side review found the defect in the **normal broker lifecycle**,
not the owned-profile fixture — the fixture drives `withAccountProfile`
exactly as the real runtime does and correctly caught it.

**Root cause.** `withNativeDirectories` acquires `allowChildWrites`
custody for `pi`, `pi/tasks`, `pi/tasks/<task>` and
`pi/tasks/<task>/sessions`; every such acquire applies a read-only
`.harness-directory-guard` leaf bind mount inside the directory — i.e.
the broker's own ledgered mounts (`self.pins` + `self.readonly_pins`)
inside the credential parent. `credential_mounts` admission required
every submount to be a directory whose `ro` flag equals the fence
state, so the guard rejected its own ordinary mounts:
`Unsupported credential submount` → `CAPABILITY_DENIED` on every
`credential-acquire` under the real lifecycle.

**Correction (broker only, all checks preserved):**

1. `credential_mounts` — a ledgered read-only leaf (`S_ISREG` and
   present in `self.readonly_pins`) is admitted as the guard's own
   custody; its expected `ro` flag is `readonly or leaf` because a
   permanent leaf fence does not track the barrier state. Directory
   submounts are unchanged; foreign mounts, unledgered mounts and
   writable file pins inside the parent are still rejected.
2. `release_credential` — the recursive un-fence also clears the
   permanent `ro` on leaf binds; the held leaf mounts are re-fenced
   before the settle check so custody matches the ledger. Any failure
   still raises `CustodyUncertain`.

No guard, check, or rejection was removed; no permission widened.
`pin()` needed no change — its `self.pins` early return precedes the
`O_DIRECTORY` open, so re-pinning a ledgered leaf already works.

## Verification performed (aarch64, this host)

- `python3 -m py_compile`: both edited files parse.
- Committed regression suite `tests/linux_path_guard_cleanup.py`
  (repo convention: `python3 -I -S -B`, unittest, stdlib
  `unittest.mock` only — runs from a clean checkout with no broker,
  no native mounts, synthetic return codes and paths only), **9/9
  PASS** — the original five plus four admission/restoration cases:
  - ledgered read-only leaf + directory submounts admitted in both
    unfenced and fenced passes; foreign writable alias, unledgered
    submount and writable file pin still rejected. PASS
  - barrier release re-fences the ledgered leaf after the recursive
    un-fence and settles; a failed leaf re-fence raises
    `CustodyUncertain` with the barrier retained. PASS
  - failed `acquire` → leftovers recorded under `self.unresolved` and
    the id never becomes a usable lease. PASS
  - quarantined descendant → parent ancestry retained, independent
    sibling released; `drop_pin` refuses the same ancestry. PASS
  - `release` handler → group retains only the unresolved set on
    refusal; retry resolves cleanly with no double decrement. PASS
  - pending ancillary credential cleanup → `CustodyUncertain` while
    the settled group release completes. PASS
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

## Ordinary-only fixture mode and qualified writer attribution

Verifier ordinal 34 recorded a PASS of a distinct ordinary-only WSL
fixture (fixture SHA256
fa6be7135069e4000bc55064f2094cf7a4b8aeebcce4058f8028dc22b48ba2f2) on
pristine production code at this head: awaited synthetic store write,
single acquire, assert/read, release/settled, exit 0, no leaked
mounts or processes.

The earlier O_RDWR fd-23-on-mount-173 attribution to the parked
`withLockAsync` remains qualified: the cited scratch command stream
came from a successful acquire and does not establish that fd's
opening call. The trace found no supported operation that retains a
writable descriptor on the credential parent — `proper-lockfile` is a
mkdir/stat/utimes protocol (no held fd), `writable` is the only
O_RDWR ever opened and `await writable.close()` drops its writer
before the `await` resolves — so no broker or SDK change is
justified. The broker fence and the combined `credential-barrier`
regression are unchanged.

New fixture mode `credential-lease` in
`tests/fixtures/linux-path-guard/native.mjs` reproduces the
ordinary-only lifecycle in this harness, with a separate outcome
(`LOCAL_NATIVE_CREDENTIAL_LEASE_ORDINARY`) from the unchanged
combined `credential-barrier` regression: profile custody → awaited
synthetic `store.modify` → single `acquireLiteralCredentialLease` →
`assertCurrent`/`read` → `release`/`settled` → post-release native
write. It contains no denial, held-writer, lock, parked-transaction,
or loss cases.

Gate status: the prior combined-fixture EBUSY and the full
`credential-barrier` variant are NOT re-verified by this mode;
`credential-loss` was NOT_RUN; the original X1 manifest remains
unverified. A pass on this ordinary-only mode does not satisfy those
other gates.
