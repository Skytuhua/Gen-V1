"""Linux path-guard cleanup bookkeeping keeps lease ownership on failure."""
import importlib.util
import os
import stat
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

_spec = importlib.util.spec_from_file_location("linux_path_guard", ROOT / "packages/core/linux-path-guard.py")
_guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_guard)


def _checked(result):
    if result < 0:
        raise OSError("synthetic detach failure")
    return result


def _new_guard():
    guard = _guard.DirectoryGuard.__new__(_guard.DirectoryGuard)
    guard.root = "/r"
    guard.uid = os.getuid()
    guard.pins = {}
    guard.readonly_pins = set()
    guard.barriers = {}
    guard.groups = {}
    guard.credentials = {}
    guard.quarantined = set()
    guard.unresolved = {}
    return guard


class CleanupOwnership(unittest.TestCase):
    def test_failed_acquire_retains_leftovers_without_a_lease(self):
        # A mid-acquire pin failure unwinds the pinned prefix; a failed detach
        # records the leftovers under the failed lease id — never a group.
        guard = _new_guard()

        def ordered_pin(path):
            if path == "/r/a/b":
                raise PermissionError("synthetic pin refusal")
            guard.pins[path] = 1

        fake_stat = type("I", (), {"st_dev": 1, "st_ino": 2})()
        with patch.object(guard, "pin", side_effect=ordered_pin), \
             patch("os.path.isdir", return_value=True), \
             patch("os.stat", return_value=fake_stat), \
             patch.object(_guard, "LIBC") as libc, \
             patch.object(_guard, "checked", _checked):
            libc.mount.side_effect = lambda *args: 0
            libc.umount2.side_effect = lambda target, flags: -1
            with self.assertRaises(PermissionError):
                guard.request({"command": "acquire", "id": "A", "paths": [{"path": "/r/a/b", "leaf": False}]})
        self.assertNotIn("A", guard.groups)  # no usable lease was created
        self.assertEqual(guard.unresolved, {"A": ["/r/a", "/r"]})
        self.assertEqual(guard.pins, {"/r": 1, "/r/a": 1})  # leftovers stay fenced and ledgered

    def test_quarantined_descendant_retains_ancestry_while_siblings_release(self):
        guard = _new_guard()
        guard.pins = {"/r": 1, "/r/a": 1, "/r/x": 1}
        guard.quarantined = {"/r/a/child"}
        detached = []
        with patch.object(_guard, "LIBC") as libc, patch.object(_guard, "checked", _checked):
            libc.umount2.side_effect = lambda target, flags: detached.append(target) or 0
            unresolved = guard.release_paths(["/r", "/r/a", "/r/x"])
        self.assertEqual(unresolved, ["/r/a", "/r"])  # ancestry of the quarantined child stays held
        self.assertEqual(detached, [b"/r/x"])  # the independent sibling still released
        self.assertEqual(guard.pins, {"/r": 1, "/r/a": 1})

    def test_unresolved_retry_resumes_without_double_decrement(self):
        guard = _new_guard()
        guard.pins = {"/r/a": 2, "/r/b": 1}
        guard.groups["G"] = ["/r/a", "/r/b"]
        with patch.object(_guard, "LIBC") as libc, patch.object(_guard, "checked", _checked):
            libc.umount2.side_effect = lambda target, flags: -1 if target == b"/r/b" else 0
            with self.assertRaises(PermissionError):
                guard.request({"command": "release", "id": "G"})
            self.assertEqual(guard.groups["G"], ["/r/b"])  # lease keeps only the unresolved set
            self.assertEqual(guard.pins, {"/r/a": 1, "/r/b": 1})  # /r/a decremented exactly once
            libc.umount2.side_effect = lambda target, flags: 0
            self.assertEqual(guard.request({"command": "release", "id": "G"})["entries"], [])
        self.assertNotIn("G", guard.groups)
        self.assertEqual(guard.pins, {"/r/a": 1})  # /r/a kept for its other lease — never decremented twice

    def test_uncertain_ancillary_cleanup_keeps_a_cleanup_only_owner(self):
        # The ordinary release drains; a refused ancillary detach raises
        # CustodyUncertain while the group id stays owned for a legal retry.
        guard = _new_guard()
        guard.pins = {"/r/b": 1, "/r/accounts/x/pi": 1}
        guard.groups["G"] = ["/r/b"]
        guard.credentials = {"/r/accounts/x/pi": {"fd": 99, "held": ["/r/accounts/x/pi"]}}
        detached, closed = [], []
        with patch.object(_guard, "LIBC") as libc, \
             patch.object(_guard, "checked", _checked), \
             patch("os.close", side_effect=lambda fd: closed.append(fd)):
            libc.umount2.side_effect = lambda target, flags: detached.append(target) or (-1 if target == b"/r/accounts/x/pi" else 0)
            with self.assertRaises(_guard.CustodyUncertain):
                guard.request({"command": "release", "id": "G"})
            self.assertEqual(guard.groups["G"], [])  # cleanup-only owner — not a usable lease
            self.assertEqual(guard.credentials["/r/accounts/x/pi"]["held"], ["/r/accounts/x/pi"])
            # The retained id still cannot be re-acquired as an ordinary lease.
            with self.assertRaises(PermissionError):
                guard.request({"command": "acquire", "id": "G", "paths": [{"path": "/r/b", "leaf": False}]})
            libc.umount2.side_effect = lambda target, flags: detached.append(target) or 0
            self.assertEqual(guard.request({"command": "release", "id": "G"})["entries"], [])
        self.assertNotIn("G", guard.groups)
        self.assertNotIn("/r/accounts/x/pi", guard.credentials)
        self.assertEqual(guard.pins, {})
        # The settled group path is never re-detached; the prepared fd closes once.
        self.assertEqual(detached, [b"/r/b", b"/r/accounts/x/pi", b"/r/accounts/x/pi"])
        self.assertEqual(closed, [99])

    def test_drop_pin_refuses_ancestry_of_a_quarantined_child(self):
        guard = _new_guard()
        guard.pins = {"/r/a": 1}
        guard.quarantined = {"/r/a/c"}
        with self.assertRaises(PermissionError):
            guard.drop_pin("/r/a")
        self.assertEqual(guard.pins, {"/r/a": 1})


def _file(mode=0o600, uid=None, nlink=1, size=0, dev=1, ino=2):
    return type("I", (), {"st_mode": stat.S_IFREG | mode, "st_dev": dev, "st_ino": ino, "st_uid": os.getuid() if uid is None else uid, "st_nlink": nlink, "st_size": size})()


class PinFaultInjection(unittest.TestCase):
    def test_pin_refuses_unsuitable_targets_before_mounting(self):
        cases = (
            _stat(stat.S_IFREG | 0o600),                       # not a directory
            _stat(stat.S_IFDIR | 0o777),                       # writable by others
            _stat(stat.S_IFDIR | 0o700, uid=os.getuid() + 1),  # foreign owned
        )
        for info in cases:
            guard = _new_guard()
            with patch("os.open", return_value=42), \
                 patch("os.fstat", return_value=info), \
                 patch("os.close"), \
                 patch.object(_guard, "LIBC") as libc:
                with self.assertRaisesRegex(PermissionError, "Private ordinary directory required"):
                    guard.pin("/r/a")
                libc.mount.assert_not_called()
            self.assertEqual((guard.pins, guard.quarantined), ({}, set()))

    def test_pin_post_mount_identity_change_unwinds_or_quarantines(self):
        info, after = _stat(stat.S_IFDIR | 0o700), _stat(stat.S_IFDIR | 0o700)
        after.st_dev, after.st_ino = 9, 9
        for detach in (0, -1):
            guard = _new_guard()
            with patch("os.open", return_value=42), \
                 patch("os.fstat", return_value=info), \
                 patch("os.stat", return_value=after), \
                 patch("os.close"), \
                 patch.object(_guard, "LIBC") as libc, \
                 patch.object(_guard, "checked", _checked):
                libc.mount.side_effect = lambda *args: 0
                libc.umount2.side_effect = lambda target, flags: detach
                with self.assertRaisesRegex(PermissionError, "Directory identity changed"):
                    guard.pin("/r/a")
            self.assertEqual(guard.pins, {})
            if detach == 0:
                self.assertEqual(guard.quarantined, set())  # applied mount unwound cleanly
                continue
            self.assertEqual(guard.quarantined, {"/r/a"})  # unledgered mount stays fenced
            with self.assertRaisesRegex(PermissionError, "quarantined"):
                guard.pin("/r/a")  # later acquisitions are refused before any syscall
            with patch("os.open", return_value=42), \
                 patch("os.fstat", return_value=info), \
                 patch("os.stat", return_value=info), \
                 patch("os.path.isdir", return_value=True), \
                 patch("os.close"), \
                 patch.object(_guard, "LIBC") as libc, \
                 patch.object(_guard, "checked", _checked):
                libc.mount.side_effect = lambda *args: 0
                libc.umount2.side_effect = lambda *args: 0
                with self.assertRaises(PermissionError):
                    guard.request({"command": "acquire", "id": "A", "paths": [{"path": "/r/a", "leaf": False}]})
            self.assertNotIn("A", guard.groups)

    def test_pin_leaf_refuses_unsuitable_files_before_mounting(self):
        cases = (
            (_stat(stat.S_IFDIR | 0o700), False, None, "Private ordinary file required"),
            (_file(nlink=2), False, None, "Private ordinary file required"),
            (_file(uid=os.getuid() + 1), False, None, "Private ordinary file required"),
            (_file(size=5), True, None, "Guarded file is not empty"),
            (_file(), True, ("9", "9"), "Directory identity mismatch"),
        )
        for info, empty, expected, message in cases:
            guard = _new_guard()
            with patch("os.open", return_value=42), \
                 patch("os.fstat", return_value=info), \
                 patch("os.close"), \
                 patch.object(_guard, "LIBC") as libc:
                with self.assertRaisesRegex(PermissionError, message):
                    guard.pin_leaf("/r/f", False, expected, empty)
                libc.mount.assert_not_called()
            self.assertEqual((guard.pins, guard.readonly_pins, guard.quarantined), ({}, set(), set()))

    def test_pin_leaf_post_mount_identity_change_unwinds_or_quarantines(self):
        info, after = _file(), _file(dev=9, ino=9)
        for detach in (0, -1):
            guard = _new_guard()
            with patch("os.open", return_value=42), \
                 patch("os.fstat", return_value=info), \
                 patch("os.stat", return_value=after), \
                 patch("os.close"), \
                 patch.object(_guard, "LIBC") as libc, \
                 patch.object(_guard, "checked", _checked):
                libc.mount.side_effect = lambda *args: 0
                libc.umount2.side_effect = lambda target, flags: detach
                with self.assertRaisesRegex(PermissionError, "File identity changed"):
                    guard.pin_leaf("/r/f", False)
            self.assertEqual((guard.pins, guard.readonly_pins), ({}, set()))
            if detach == 0:
                self.assertEqual(guard.quarantined, set())
            else:
                self.assertEqual(guard.quarantined, {"/r/f"})
                with self.assertRaisesRegex(PermissionError, "quarantined"):
                    guard.pin_leaf("/r/f", False)  # refused before any syscall


PARENT = "/r/accounts/pa/pi"
TASKS = PARENT + "/tasks"
LEAF = PARENT + "/.harness-directory-guard"


def _stat(mode, uid=None):
    return type("I", (), {"st_mode": mode, "st_dev": 1, "st_ino": 2, "st_uid": os.getuid() if uid is None else uid})()


def _record(mount_id, path, root, flags, dev="8:1", filesystem="ext4"):
    return {"id": mount_id, "dev": dev, "root": root, "path": path, "flags": flags, "filesystem": filesystem}


def _credential_harness(guard):
    # The mount table the real profile lifecycle produces: ancestor and root
    # pins outside the credential parent, pinned task directories inside it,
    # and read-only child-write marker leaves the guard applied itself.
    guard.pins = {"/r": 1, "/r/accounts": 1, "/r/accounts/pa": 1, PARENT: 1, TASKS: 1, LEAF: 1}
    guard.readonly_pins = {LEAF}
    stats = {
        PARENT: _stat(stat.S_IFDIR | 0o700),
        TASKS: _stat(stat.S_IFDIR | 0o700),
        LEAF: _stat(stat.S_IFREG | 0o600),
    }
    prepared = {"path": PARENT, "mount": "7", "fd": 99, "identity": stats[PARENT], "held": ["/r", "/r/accounts", "/r/accounts/pa", PARENT]}

    def records(directories_readonly=False):
        flag = ["ro"] if directories_readonly else ["rw"]
        return [
            _record("1", "/r", "/r", ["rw"]),
            _record("2", "/r/accounts", "/r/accounts", ["rw"]),
            _record("3", "/r/accounts/pa", "/r/accounts/pa", ["rw"]),
            _record("7", PARENT, PARENT, flag),
            _record("10", TASKS, TASKS, flag),
            _record("11", LEAF, LEAF, ["ro"]),
        ]

    return prepared, stats, records


class CredentialMountAdmission(unittest.TestCase):
    def test_ledgered_leaf_and_directory_submounts_are_admitted(self):
        guard = _new_guard()
        prepared, stats, records = _credential_harness(guard)
        with patch.object(_guard, "mount_records", new=lambda: records()), \
             patch("os.stat", side_effect=lambda path, *a, **k: stats[path]):
            self.assertEqual(guard.credential_mounts(prepared, False), {"7", "10", "11"})
        with patch.object(_guard, "mount_records", new=lambda: records(directories_readonly=True)), \
             patch("os.stat", side_effect=lambda path, *a, **k: stats[path]):
            self.assertEqual(guard.credential_mounts(prepared, True), {"7", "10", "11"})

    def test_foreign_alias_unpinned_and_writable_leaf_stay_rejected(self):
        guard = _new_guard()
        prepared, stats, records = _credential_harness(guard)
        stats[PARENT + "/evil"] = _stat(stat.S_IFREG | 0o600)
        stats[PARENT + "/writable"] = _stat(stat.S_IFREG | 0o600)
        cases = (
            # Writable bind exposing the credential tree at an outside path.
            ("mount alias", [_record("20", "/outside", "/r", ["rw"])]),
            # A mount inside the parent the guard never ledgered.
            ("submount", [_record("21", PARENT + "/evil", PARENT + "/evil", ["ro"])]),
            # A writable file pin is not ordinary barrier custody.
            ("submount", [_record("22", PARENT + "/writable", PARENT + "/writable", ["rw"])]),
        )
        guard.pins[PARENT + "/writable"] = 1
        for message, extra in cases:
            with patch.object(_guard, "mount_records", new=lambda: records() + extra), \
                 patch("os.stat", side_effect=lambda path, *a, **k: stats[path]):
                with self.assertRaisesRegex(PermissionError, message):
                    guard.credential_mounts(prepared, False)

    def test_release_restores_leaf_fences_after_recursive_unfence(self):
        guard = _new_guard()
        prepared, stats, records = _credential_harness(guard)
        guard.pins = {"/r": 1, "/r/accounts": 1, "/r/accounts/pa": 1, PARENT: 2, TASKS: 2, LEAF: 2}
        guard.credentials[PARENT] = prepared
        guard.barriers["L1"] = {"parent": PARENT, "mounts": {"7", "10", "11"}, "held": [PARENT, TASKS, LEAF], "expires": 0, "fenced": True}
        mount_state = {PARENT: "ro", TASKS: "ro", LEAF: "ro"}
        calls = []

        def fenced_records():
            result = records()
            for record in result:
                if record["path"] in mount_state:
                    record["flags"] = [mount_state[record["path"]]]
            return result

        def mount_readonly(fd, enabled):
            calls.append((fd, enabled))
            if fd == 99:  # Recursive on the parent: every mount beneath it.
                for path in mount_state:
                    mount_state[path] = "ro" if enabled else "rw"
            else:
                mount_state[LEAF] = "ro" if enabled else "rw"

        with patch.object(_guard, "mount_records", new=fenced_records), \
             patch.object(_guard, "mount_readonly", new=mount_readonly), \
             patch("os.stat", side_effect=lambda path, *a, **k: stats[path]), \
             patch("os.open", return_value=42), \
             patch("os.close"):
            guard.release_credential("L1")
        self.assertEqual(calls, [(99, False), (42, True)])  # un-fence, then re-fence the leaf
        self.assertNotIn("L1", guard.barriers)
        self.assertEqual(mount_state[LEAF], "ro")
        self.assertEqual(guard.pins[LEAF], 1)  # barrier ref dropped; group ref stays
        self.assertEqual(guard.readonly_pins, {LEAF})

    def test_leaf_fence_restore_failure_is_explicitly_uncertain(self):
        guard = _new_guard()
        prepared, stats, records = _credential_harness(guard)
        guard.pins = {"/r": 1, "/r/accounts": 1, "/r/accounts/pa": 1, PARENT: 2, TASKS: 2, LEAF: 2}
        guard.credentials[PARENT] = prepared
        guard.barriers["L2"] = {"parent": PARENT, "mounts": {"7", "10", "11"}, "held": [PARENT, TASKS, LEAF], "expires": 0, "fenced": True}

        def mount_readonly(fd, enabled):
            if fd != 99:
                raise OSError("synthetic leaf re-fence failure")

        with patch.object(_guard, "mount_records", new=lambda: records(directories_readonly=True)), \
             patch.object(_guard, "mount_readonly", new=mount_readonly), \
             patch("os.stat", side_effect=lambda path, *a, **k: stats[path]), \
             patch("os.open", return_value=42), \
             patch("os.close"):
            with self.assertRaises(_guard.CustodyUncertain):
                guard.release_credential("L2")
        self.assertTrue(guard.barriers["L2"]["fenced"])  # custody retained, not claimed released


class CredentialLifecycleRollback(unittest.TestCase):
    def test_acquire_rolls_back_the_pinned_prefix_on_failure(self):
        # A mid-acquire pin failure unwinds the prefix it already pinned; what
        # could not detach stays ledgered under the failed parent, never a lease.
        parent = "/r/accounts/provider-auth-" + "a" * 64 + "/pi"
        tasks = parent + "/tasks"
        for detach in (0, -1):
            guard = _new_guard()
            guard.credentials[parent] = {"path": parent, "fd": 99, "mount": "7", "identity": _stat(stat.S_IFDIR | 0o700), "held": []}
            records = [_record("7", parent, parent, ["rw"]), _record("10", tasks, tasks, ["rw"])]

            def pin(path):
                if path == tasks:
                    raise PermissionError("synthetic pin refusal")
                guard.pins[path] = 1

            with patch.object(guard, "credential_mounts", return_value={"7", "10"}), \
                 patch.object(guard, "credential_processes"), \
                 patch.object(guard, "pin", side_effect=pin), \
                 patch.object(_guard, "mount_records", return_value=records), \
                 patch.object(_guard, "LIBC") as libc, \
                 patch.object(_guard, "checked", _checked):
                libc.umount2.side_effect = lambda target, flags: detach
                with self.assertRaisesRegex(PermissionError, "synthetic"):
                    guard.acquire_credential(parent + "/auth.json", 1000)
            self.assertEqual(guard.barriers, {})
            if detach == 0:
                self.assertEqual((guard.pins, guard.unresolved), ({}, {}))  # prefix fully unwound
            else:
                self.assertEqual(guard.pins, {parent: 1})  # leftover stays fenced and ledgered
                self.assertEqual(guard.unresolved, {parent: [parent]})

    def test_release_keeps_unresolved_held_paths_for_retry(self):
        guard = _new_guard()
        parent, tasks = "/r/accounts/x/pi", "/r/accounts/x/pi/tasks"
        guard.pins = {parent: 1, tasks: 1}
        guard.barriers["L"] = {"parent": parent, "mounts": {"7"}, "held": [parent, tasks], "expires": 0, "fenced": False}
        detached = []
        with patch.object(_guard, "LIBC") as libc, patch.object(_guard, "checked", _checked):
            libc.umount2.side_effect = lambda target, flags: detached.append(target) or (-1 if target == os.fsencode(tasks) else 0)
            with self.assertRaises(_guard.CustodyUncertain):
                guard.release_credential("L")
            # The still-fenced child keeps its ancestor held: detaching the
            # parent would strand the child mount under a detached parent.
            self.assertEqual(guard.barriers["L"]["held"], [tasks, parent])
            self.assertEqual(guard.pins, {parent: 1, tasks: 1})
            self.assertEqual(detached, [os.fsencode(tasks)])
            libc.umount2.side_effect = lambda target, flags: detached.append(target) or 0
            guard.release_credential("L")
        self.assertNotIn("L", guard.barriers)
        self.assertEqual(guard.pins, {})
        self.assertEqual(detached, [os.fsencode(tasks)] * 2 + [os.fsencode(parent)])


if __name__ == "__main__":
    unittest.main()
