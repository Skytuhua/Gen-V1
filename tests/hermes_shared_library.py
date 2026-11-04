"""Original skill handlers retain policy, provenance and per-review read guards over shared RPC."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]


class SharedLibrary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("shared_hermes_worker", ROOT / "packages/runtime-hermes/worker.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cls.module = module
        cls.tmp = tempfile.TemporaryDirectory(prefix="hermes-shared-")
        cls.worker = module.Worker()
        cls.worker.event = lambda *_: None
        cls.worker.hello({"home": cls.tmp.name, "acpCommand": sys.executable,
                          "dependencyRoot": str(ROOT / ".harness-hermes-python-deps"), "config": {}})

    @classmethod
    def tearDownClass(cls):
        os.chdir(ROOT)
        cls.tmp.cleanup()

    def tool(self, name, args, owner="review-a", phase="background_review", writable=True):
        return json.loads(self.worker.dispatch("skills.tool", {"name": name, "args": args,
            "kw": {"task_id": owner, "session_id": owner},
            "policy": {"enabled": True, "allowWrites": writable},
            "ctx": {"threadId": owner, "runId": owner, "epoch": 1, "phase": phase}}))

    def test_read_only_caller_cannot_write_through_canonical_handler(self):
        result = self.tool("skill_manage", {"action": "create", "name": "forbidden",
            "content": "---\nname: forbidden\ndescription: A rejected source write.\n---\n\nNo write."}, writable=False)
        self.assertFalse(result["success"])
        self.assertFalse((Path(self.tmp.name) / "skills/forbidden").exists())

    def test_review_reads_are_retained_for_exact_owner_and_not_shared_with_another_review(self):
        name = "shared-review-proof"
        created = self.worker.skills("skills.manage", {"action": "create", "name": name,
            "content": "---\nname: shared-review-proof\ndescription: Preserve review read ownership.\n---\n\nOriginal procedure."})
        self.assertTrue(created["success"], created)
        edit = {"action": "patch", "name": name, "old_string": "Original procedure.", "new_string": "Verified procedure."}
        self.assertFalse(self.tool("skill_manage", edit)["success"])
        self.assertTrue(self.tool("skill_view", {"name": name})["success"])
        self.assertFalse(self.tool("skill_manage", edit, owner="review-b")["success"])
        self.assertTrue(self.tool("skill_manage", edit)["success"])
        self.assertIn("Verified procedure.", (Path(self.tmp.name) / "skills" / name / "SKILL.md").read_text())

    def test_task_worker_routes_original_skill_calls_to_host_library(self):
        worker = self.module.Worker()
        worker.shared_library = True
        calls = []
        worker.host_call = lambda name, args: calls.append((name, args)) or "canonical-original-result"
        self.assertEqual(worker.skill_tool("skill_view", {"name": "proof"}, {"task_id": "owned-run"}), "canonical-original-result")
        self.assertEqual(calls[0][0], "$library.tool")

    def test_task_skill_listing_exposes_only_its_own_enabled_bundle_metadata(self):
        worker = self.module.Worker()
        worker.shared_library = True
        worker.host_call = lambda *_: json.dumps({"success": True, "skills": [
            {"name": "learned", "category": "work"}, {"name": "humanizer:humanizer", "category": "plugin"}]})
        worker.integrations = SimpleNamespace(local_skill_list=lambda: [{"name": "graphify:graphify", "category": "plugin"}])
        result = json.loads(worker.skill_tool("skills_list", {}, {}))
        self.assertEqual({skill["name"] for skill in result["skills"]}, {"learned", "graphify:graphify"})

    def test_task_bundle_view_never_borrows_the_canonical_workers_profile(self):
        worker = self.module.Worker()
        worker.shared_library = True
        worker.host_call = lambda *_: self.fail("A bundle view must not use another worker's plugin registry")
        result = json.loads(worker.skill_tool("skill_view", {"name": "humanizer:humanizer"}, {}))
        self.assertFalse(result["success"])


if __name__ == "__main__":
    unittest.main()
