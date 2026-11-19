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

    def test_pending_credential_cleanup_is_explicitly_uncertain(self):
        guard = _new_guard()
        guard.pins = {"/r/b": 1, "/r/accounts/x/pi": 1}
        guard.groups["G"] = ["/r/b"]
        guard.credentials = {"/r/accounts/x/pi": {"fd": 99, "held": ["/r/accounts/x/pi"]}}
        with patch.object(_guard, "LIBC") as libc, \
             patch.object(_guard, "checked", _checked), \
             patch("os.close"):
            libc.umount2.side_effect = lambda target, flags: -1 if target == b"/r/accounts/x/pi" else 0
            with self.assertRaises(_guard.CustodyUncertain):
                guard.request({"command": "release", "id": "G"})
        self.assertNotIn("G", guard.groups)  # the settled group release still completed
        self.assertEqual(guard.credentials["/r/accounts/x/pi"]["held"], ["/r/accounts/x/pi"])

    def test_drop_pin_refuses_ancestry_of_a_quarantined_child(self):
        guard = _new_guard()
        guard.pins = {"/r/a": 1}
        guard.quarantined = {"/r/a/c"}
        with self.assertRaises(PermissionError):
            guard.drop_pin("/r/a")
        self.assertEqual(guard.pins, {"/r/a": 1})


if __name__ == "__main__":
    unittest.main()
