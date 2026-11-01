"""Original usage writer must commit host controls and effective pin together."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class AtomicControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("harness_worker_controls", ROOT / "packages/runtime-hermes/worker.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cls.home = tempfile.TemporaryDirectory(prefix="hermes-atomic-controls-")
        cls.worker = module.Worker()
        cls.worker.event = lambda *_: None
        cls.worker.hello({"home": cls.home.name, "acpCommand": sys.executable,
                          "dependencyRoot": str(ROOT / ".harness-hermes-python-deps"), "config": {}})

    @classmethod
    def tearDownClass(cls):
        os.chdir(ROOT)
        cls.home.cleanup()

    def create(self, name):
        document = f"---\nname: {name}\ndescription: Verify atomic protection controls.\n---\n\nPreserve source control ownership.\n"
        result = self.worker.skills("skills.manage", {"action": "create", "name": name, "content": document})
        self.assertTrue(result["success"], result)

    def test_later_writer_failure_cannot_leave_half_a_protection_state(self):
        from tools import skill_usage as usage
        name = "atomic-later-failure"
        self.create(name)
        original = usage._mutate
        calls = 0

        def fail_later(*args, **kwargs):
            nonlocal calls
            calls += 1
            return None if calls > 1 else original(*args, **kwargs)

        with patch.object(usage, "_mutate", side_effect=fail_later):
            result = self.worker.skills("skills.flags", {"name": name, "protected": True})
        record = usage.get_record(name)
        self.assertEqual(record.get("harness_protected", False), record.get("pinned", False), result)
        self.assertEqual(result["success"], record.get("pinned", False))

    def test_failed_atomic_writer_leaves_all_controls_unchanged(self):
        from tools import skill_usage as usage
        name = "atomic-first-failure"
        self.create(name)
        before = usage.get_record(name)
        with patch.object(usage, "_mutate", return_value=None):
            result = self.worker.skills("skills.flags", {"name": name, "enabled": False, "protected": True})
        self.assertFalse(result["success"])
        self.assertEqual(usage.get_record(name), before)

    def test_legacy_metrics_are_preserved_once_without_resetting_later_source_use(self):
        from tools import skill_usage as usage
        name = "legacy-usage-proof"
        self.create(name)
        legacy = {"id": "verified-legacy-snapshot", "count": 7, "patchCount": 4,
                  "createdAt": "2026-10-01T12:00:00.000Z", "updatedAt": "2026-10-03T12:00:00.000Z",
                  "lastUsedAt": "2026-10-04T12:00:00.000Z"}
        result = self.worker.skills("skills.flags", {"name": name, "enabled": True,
                                   "legacyUsage": legacy, "legacyFresh": True})
        self.assertTrue(result["success"], result)
        record = usage.get_record(name)
        self.assertEqual(record["use_count"], 7)
        self.assertEqual(record["patch_count"], 4)
        self.assertEqual(record["last_used_at"], legacy["lastUsedAt"])
        self.assertEqual(record["harness_legacy_usage"], legacy)
        usage.bump_use(name)
        self.worker.skills("skills.flags", {"name": name, "enabled": True,
                           "legacyUsage": legacy, "legacyFresh": True})
        self.assertEqual(usage.get_record(name)["use_count"], 8)

    def test_matching_existing_source_keeps_its_newer_activity(self):
        from tools import skill_usage as usage
        name = "existing-source-usage"
        self.create(name)
        usage.bump_use(name)
        usage.bump_use(name)
        last_used = usage.get_record(name)["last_used_at"]
        legacy = {"id": "older-legacy-metrics", "count": 1, "patchCount": 0,
                  "createdAt": "2026-10-01T12:00:00.000Z", "updatedAt": "2026-10-01T12:00:00.000Z",
                  "lastUsedAt": "2026-10-02T12:00:00.000Z"}
        self.worker.skills("skills.flags", {"name": name, "enabled": True, "legacyUsage": legacy, "legacyFresh": False})
        record = usage.get_record(name)
        self.assertEqual(record["use_count"], 2)
        self.assertEqual(record["last_used_at"], last_used)
        self.assertEqual(record["harness_legacy_usage"], legacy)


if __name__ == "__main__":
    unittest.main()
