"""Original skill handlers retain policy, provenance and per-review read guards over shared RPC."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

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

    def history_package(self, name):
        document = f"---\nname: {name}\ndescription: Historical source availability.\nmetadata:\n  retained: true\n---\n\nBody A for {name}.\n"
        result = self.worker.skills("skills.manage", {"operations": [
            {"action": "create", "name": name, "content": document},
            {"action": "write_file", "name": name, "file_path": "references/help.md", "file_content": f"Support A for {name}.\n"}]})
        self.assertTrue(result["success"], result)
        inspection = self.worker.skills("skills.inspect", {"name": name})
        # Current reads normalize newlines; revision blobs retain the writer's bytes.
        inspection["_retained_document"] = (Path(self.tmp.name) / "skills" / name / "SKILL.md").read_bytes().decode("utf-8-sig")
        return inspection

    def rewrite_history(self, transform):
        from tools import skill_ledger as ledger
        path = ledger.ledger_path()
        original = path.read_bytes()
        self.addCleanup(path.write_bytes, original)
        rows = [json.loads(line) for line in original.splitlines() if line]
        path.write_text("".join(json.dumps(row) + "\n" for row in transform(rows)), encoding="utf-8")

    def assert_source_unavailable(self, params):
        with self.assertRaises(ValueError) as raised:
            self.worker.skills("skills.inspect", params)
        self.assertEqual(getattr(raised.exception, "code", None), "SKILL_SOURCE_UNAVAILABLE")
        self.assertEqual(str(raised.exception), "The original source for this revision is no longer available.")

    def test_retired_revision_keeps_current_document_support_and_catalog_available(self):
        name = "history-retired"
        initial = self.history_package(name)
        revision = initial["versions"][0]["id"]
        selected = {"name": name, "revisionId": revision}
        self.assertEqual(self.worker.skills("skills.inspect", selected)["document"], initial["_retained_document"])
        self.assertIn("Support A", self.worker.skills("skills.inspect", {**selected, "file_path": "references/help.md"})["fileContent"])
        self.rewrite_history(lambda rows: [row for row in rows if row["id"] != revision])
        self.assert_source_unavailable(selected)
        current = self.worker.skills("skills.inspect", {"name": name})
        self.assertEqual(current["document"], initial["document"])
        self.assertEqual(current["fileHashes"], initial["fileHashes"])
        self.assertIn("Support A", self.worker.skills("skills.inspect", {"name": name, "file_path": "references/help.md"})["fileContent"])
        self.assertIn(name, [row["name"] for row in self.worker.skills("skills.list", {})["skills"]])

    def test_missing_historical_main_after_state_is_unavailable(self):
        name = "history-no-main"
        initial = self.history_package(name)
        revision = initial["versions"][0]["id"]
        def remove_main(rows):
            for row in rows:
                if row.get("skill") == name:
                    row["after"] = [part for part in row.get("after", []) if Path(part["path"]).name != "SKILL.md"]
            return rows
        self.rewrite_history(remove_main)
        self.assert_source_unavailable({"name": name, "revisionId": revision})
        self.assertEqual(self.worker.skills("skills.inspect", {"name": name})["document"], initial["document"])

    def test_missing_historical_main_or_support_blob_is_unavailable_without_repair(self):
        from tools import skill_ledger as ledger
        for relative in ("SKILL.md", "references/help.md"):
            with self.subTest(relative=relative):
                name = "history-blob-" + ("main" if relative == "SKILL.md" else "support")
                initial = self.history_package(name)
                blob = ledger.blobs_dir() / initial["fileHashes"][relative]
                original = blob.read_bytes()
                self.addCleanup(blob.write_bytes, original)
                blob.unlink()
                params = {"name": name, "revisionId": initial["versions"][0]["id"]}
                if relative != "SKILL.md":
                    params["file_path"] = relative
                self.assert_source_unavailable(params)
                self.assertFalse(blob.exists())
                self.assertEqual(self.worker.skills("skills.inspect", {"name": name})["document"], initial["document"])

    def test_foreign_revision_and_absent_or_invalid_support_paths_are_not_retirement(self):
        first = self.history_package("history-owner")
        self.history_package("history-foreign")
        revision = first["versions"][0]["id"]
        for params in ({"name": "history-foreign", "revisionId": revision},
                       {"name": "history-owner", "revisionId": revision, "file_path": "references/absent.md"},
                       {"name": "history-owner", "revisionId": revision, "file_path": "../../private.txt"}):
            with self.subTest(params=params), self.assertRaises(ValueError) as raised:
                self.worker.skills("skills.inspect", params)
            self.assertNotEqual(getattr(raised.exception, "code", None), "SKILL_SOURCE_UNAVAILABLE")

    def test_historical_permission_errors_and_unreadable_existing_blobs_are_not_retirement(self):
        from tools import skill_ledger as ledger
        initial = self.history_package("history-permission")
        params = {"name": initial["name"], "revisionId": initial["versions"][0]["id"]}
        with patch.object(ledger, "read_blob", side_effect=PermissionError("Denied historical read")):
            with self.assertRaises(PermissionError):
                self.worker.skills("skills.inspect", params)
        # Upstream read_blob returns None for both missing and unreadable blobs.
        # An existing blob must not be classified as source retirement.
        with patch.object(ledger, "read_blob", return_value=None):
            with self.assertRaises(ValueError) as raised:
                self.worker.skills("skills.inspect", params)
            self.assertNotEqual(getattr(raised.exception, "code", None), "SKILL_SOURCE_UNAVAILABLE")

    def test_historical_owned_path_guard_precedes_blob_read(self):
        from tools import skill_ledger as ledger
        name = "history-outside"
        initial = self.history_package(name)
        revision = initial["versions"][0]["id"]
        def move_outside(rows):
            for row in rows:
                if row.get("skill") == name:
                    for part in row.get("after", []):
                        part["path"] = str(Path(self.tmp.name) / "private" / Path(part["path"]).name)
            return rows
        self.rewrite_history(move_outside)
        with patch.object(ledger, "read_blob", side_effect=AssertionError("Guard must precede read")):
            with self.assertRaises(PermissionError):
                self.worker.skills("skills.inspect", {"name": name, "revisionId": revision})

    def test_ledger_read_errors_remain_retryable_for_history(self):
        from tools import skill_ledger as ledger
        name = "history-ledger-errors"
        initial = self.history_package(name)
        params = {"name": name, "revisionId": initial["versions"][0]["id"]}
        path = ledger.ledger_path()
        original_bytes = path.read_bytes()
        original_read = Path.read_bytes
        for error_type in (PermissionError, OSError, UnicodeDecodeError, json.JSONDecodeError):
            with self.subTest(error=error_type.__name__):
                def ledger_error(candidate):
                    if candidate == path:
                        if error_type is UnicodeDecodeError:
                            return b"\xff"
                        if error_type is json.JSONDecodeError:
                            return b"{broken json"
                        raise error_type("Ledger read unavailable")
                    return original_read(candidate)
                with patch.object(Path, "read_bytes", ledger_error):
                    with self.assertRaises(error_type) as raised:
                        self.worker.skills("skills.inspect", params)
                    self.assertNotEqual(getattr(raised.exception, "code", None), "SKILL_SOURCE_UNAVAILABLE")
                self.assertEqual(self.worker.skills("skills.inspect", params)["document"], initial["_retained_document"])
        self.assertEqual(path.read_bytes(), original_bytes)

    def test_unverified_ledger_does_not_claim_current_history_is_retired(self):
        from tools import skill_ledger as ledger
        name = "history-ledger-current"
        initial = self.history_package(name)
        path = ledger.ledger_path()
        original_read = Path.read_bytes
        for failure in (PermissionError("Ledger permission denied"), OSError("Ledger I/O failed"), b"\xff", b"{broken json"):
            with self.subTest(failure=repr(failure)):
                def ledger_error(candidate):
                    if candidate == path:
                        if isinstance(failure, bytes):
                            return failure
                        raise failure
                    return original_read(candidate)
                with patch.object(Path, "read_bytes", ledger_error):
                    current = self.worker.skills("skills.inspect", {"name": name})
                    self.assertEqual(current["document"], initial["document"])
                    self.assertEqual(current["fileHashes"], initial["fileHashes"])
                    self.assertEqual(current.get("versionsVerified"), False)
                    support = self.worker.skills("skills.inspect", {"name": name, "file_path": "references/help.md"})
                    self.assertIn("Support A", support["fileContent"])
                    self.assertEqual(support.get("versionsVerified"), False)

    def test_actual_missing_ledger_confirms_retirement_without_blocking_current_reads(self):
        from tools import skill_ledger as ledger
        name = "history-missing-ledger"
        initial = self.history_package(name)
        path = ledger.ledger_path()
        original = path.read_bytes()
        self.addCleanup(path.write_bytes, original)
        path.unlink()
        self.assert_source_unavailable({"name": name, "revisionId": initial["versions"][0]["id"]})
        current = self.worker.skills("skills.inspect", {"name": name})
        self.assertEqual(current["document"], initial["document"])
        self.assertEqual(current["versions"], [])
        self.assertNotEqual(current.get("versionsVerified"), False)

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
