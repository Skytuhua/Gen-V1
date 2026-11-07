"""Coherent source-package capture; original-source fixture, no inference or platform overrides."""
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("harness_worker_capture", ROOT / "packages/runtime-hermes/worker.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CaptureTransport(unittest.TestCase):
    def test_serialized_limit_counts_escaping_and_actual_envelope(self):
        frame = {"id": "capture-id", "result": {"files": {"help.txt": '\x00"\\\n' * 30}}}
        encoded = json.dumps(frame, ensure_ascii=False, default=module._json_default, allow_nan=False)
        limit = len(encoded.encode("utf-8")) + 1
        with patch.object(module, "MAX_FRAME_BYTES", limit):
            self.assertEqual(module.frame_data(frame), encoded)
            with patch.object(module, "WIRE", io.StringIO()) as wire:
                module.emit(frame)
                self.assertEqual(len(wire.getvalue().encode("utf-8")), limit)
        with patch.object(module, "MAX_FRAME_BYTES", limit - 1):
            with self.assertRaisesRegex(ValueError, "transport bound"):
                module.frame_data(frame)
            with patch.object(module, "WIRE", io.StringIO()) as wire:
                with self.assertRaises(ValueError):
                    module.emit(frame)
                self.assertEqual(wire.getvalue(), "")

    def test_actual_32mib_jsonl_boundary_counts_escaped_content_and_newline(self):
        frame = {"id": "capture-wire-boundary", "result": {"files": {"references/help.md": ""}}}
        overhead = len(json.dumps(frame, ensure_ascii=False, allow_nan=False).encode("utf-8")) + 1
        escaped, plain = divmod(module.MAX_FRAME_BYTES - overhead, 6)
        frame["result"]["files"]["references/help.md"] = "\x00" * escaped + "x" * plain
        admitted = module.frame_data(frame)
        self.assertEqual(len(admitted.encode("utf-8")) + 1, 32 * 1024 * 1024)
        frame["result"]["files"]["references/help.md"] += "x"
        with self.assertRaisesRegex(ValueError, "transport bound"):
            module.frame_data(frame)

    def test_actual_worker_returns_bounded_capture_error_and_stays_available(self):
        with tempfile.TemporaryDirectory(prefix="hermes-capture-wire-") as temporary:
            home = Path(temporary)
            directory = home / "skills" / "capture-wire"
            (directory / "references").mkdir(parents=True)
            main = b"---\nname: capture-wire\ndescription: Bounded source response.\n---\n\nBody\n"
            support = b"\x00" * (module.MAX_FRAME_BYTES // 6 + 1)
            (directory / "SKILL.md").write_bytes(main)
            (directory / "references/help.md").write_bytes(support)
            hashes = {"SKILL.md": hashlib.sha256(main).hexdigest(), "references/help.md": hashlib.sha256(support).hexdigest()}
            expected = {"documentHash": hashes["SKILL.md"], "fileHashes": hashes, "state": "active", "enabled": True, "protected": False, "tip": None}
            requests = [
                {"id": "hello", "method": "hello", "params": {"home": temporary, "acpCommand": sys.executable, "dependencyRoot": str(ROOT / ".harness-hermes-python-deps"), "config": {}}},
                {"id": "oversized", "method": "skills.capture", "params": {"name": "capture-wire", "expected": {"capture-wire": expected}}},
                {"id": "after", "method": "skills.list", "params": {}}]
            environment = {key: value for key, value in os.environ.items() if key.upper() in {"SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP"}}
            result = subprocess.run([sys.executable, "-I", "-S", "-B", str(ROOT / "packages/runtime-hermes/worker.py")],
                input="".join(json.dumps(request) + "\n" for request in requests), text=True, encoding="utf-8", capture_output=True, env=environment, timeout=60)
            self.assertEqual(result.returncode, 0, result.stderr)
            lines = result.stdout.splitlines()
            self.assertTrue(all(len(line.encode("utf-8")) + 1 <= module.MAX_FRAME_BYTES for line in lines))
            replies = {row["id"]: row for row in map(json.loads, lines) if "id" in row}
            self.assertIn("result", replies["hello"])
            self.assertEqual(replies["oversized"]["error"]["code"], "ValueError")
            self.assertIn("transport bound", replies["oversized"]["error"]["message"])
            self.assertEqual(replies["after"]["result"]["skills"][0]["name"], "capture-wire")

    def test_raw_read_refuses_before_opening_oversized_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "large.txt"
            path.write_bytes(b"0123456789")
            with patch.object(Path, "open", side_effect=AssertionError("Oversized file must not be opened")):
                with self.assertRaisesRegex(ValueError, "raw-byte"):
                    module.Worker().capture_bytes(path, 9)
            self.assertEqual(module.Worker().capture_bytes(path, 10), b"0123456789")

    def test_raw_hash_does_not_normalize_bom_or_crlf(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "text.md"
            raw = b"\xef\xbb\xbfline\r\nnext\r"
            path.write_bytes(raw)
            captured = module.Worker().capture_bytes(path, len(raw))
            self.assertEqual(captured, raw)
            self.assertNotEqual(hashlib.sha256(captured).hexdigest(), hashlib.sha256(b"line\nnext\n").hexdigest())


class PackageCapture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.home = tempfile.TemporaryDirectory(prefix="hermes-package-capture-")
        cls.worker = module.Worker()
        cls.worker.event = lambda *_: None
        cls.addClassCleanup(cls.home.cleanup)
        cls.addClassCleanup(os.chdir, ROOT)
        cls.worker.hello({"home": cls.home.name, "acpCommand": sys.executable,
                          "dependencyRoot": str(ROOT / ".harness-hermes-python-deps"), "config": {}})

    def create(self, name, support="Support A\n"):
        document = f"---\nname: {name}\ndescription: Capture coherent source packages.\n---\n\nBody A\n"
        result = self.worker.dispatch("skills.manage", {"action": "", "name": "", "operations": [
            {"action": "create", "name": name, "content": document},
            {"action": "write_file", "name": name, "file_path": "references/help.md", "file_content": support}]})
        self.assertTrue(result["success"], result)
        return Path(self.home.name) / "skills" / name

    def expected(self, name):
        row = self.worker.dispatch("skills.inspect", {"name": name})
        return {"documentHash": row["fileHashes"]["SKILL.md"], "fileHashes": row["fileHashes"],
                "enabled": row["usage"].get("harness_enabled", True), "protected": row["usage"].get("harness_protected", False),
                "state": row["usage"].get("state", "active"), "tip": row["versions"][0]["id"] if row["versions"] else None}

    def capture(self, name, expected=None):
        return self.worker.dispatch("skills.capture", {"name": name, "expected": {name: expected or self.expected(name)}})

    def test_capture_is_read_only_and_historical_view_matches_every_saved_text(self):
        from tools import skill_manager_tool as manager, skill_ledger as ledger
        name = "capture-coherent"
        directory = self.create(name)
        before = {str(p): p.read_bytes() for p in Path(self.home.name).rglob("*") if p.is_file()}
        with patch.object(manager, "skill_manage", side_effect=AssertionError("capture called writer")):
            result = self.capture(name)
        self.assertEqual(result["inspection"]["content"], "Body A\n")
        self.assertEqual(result["files"], {"references/help.md": "Support A\n"})
        self.assertEqual(result["sourceId"], result["inspection"]["versions"][0]["id"])
        self.assertEqual(result["inspection"]["fileHashes"]["SKILL.md"], hashlib.sha256((directory / "SKILL.md").read_bytes()).hexdigest())
        for path in result["inspection"]["files"]:
            historical = self.worker.dispatch("skills.inspect", {"name": name, "revisionId": result["sourceId"], **({"file_path": path} if path != "SKILL.md" else {})})
            historical_text = historical["fileContent"] if path != "SKILL.md" else historical["document"]
            self.assertEqual(historical_text.replace("\r\n", "\n").replace("\r", "\n"), result["files"][path] if path != "SKILL.md" else result["inspection"]["document"])
        self.assertEqual({str(p): p.read_bytes() for p in Path(self.home.name).rglob("*") if p.is_file()}, before)

    def test_requires_exact_nonempty_expected_name_and_cas(self):
        name = "capture-fenced"
        self.create(name)
        expected = self.expected(name)
        for guard in [None, {}, {name: None}, {"other": expected}, {name: expected, "other": expected}]:
            with self.subTest(guard=guard), self.assertRaises((ValueError, module.SourceConflictError)):
                self.worker.dispatch("skills.capture", {"name": name, **({"expected": guard} if guard is not None else {})})
        expected["documentHash"] = "0" * 64
        with self.assertRaises(module.SourceConflictError):
            self.capture(name, expected)

    def test_writer_waits_for_entire_capture(self):
        name = "capture-lock"
        self.create(name)
        expected = self.expected(name)
        entered, resume, writer_started, writer_finished = (threading.Event() for _ in range(4))
        read = self.worker.capture_bytes
        result, errors = [], []
        def pause(path, remaining):
            value = read(path, remaining)
            if path.name == "SKILL.md" and threading.current_thread().name == "capture-test":
                entered.set()
                if not resume.wait(10):
                    raise AssertionError("writer synchronization timed out")
            return value
        def capture():
            try:
                result.append(self.capture(name, expected))
            except BaseException as exc:
                errors.append(exc)
        def write():
            writer_started.set()
            try:
                result.append(self.worker.dispatch("skills.manage", {"action": "write_file", "name": name, "file_path": "references/help.md", "file_content": "Support B\n"}))
            except BaseException as exc:
                errors.append(exc)
            finally:
                writer_finished.set()
        with patch.object(self.worker, "capture_bytes", side_effect=pause):
            reader = threading.Thread(target=capture, name="capture-test")
            writer = threading.Thread(target=write)
            reader.start()
            try:
                self.assertTrue(entered.wait(10))
                writer.start()
                self.assertTrue(writer_started.wait(10))
                self.assertFalse(writer_finished.is_set())
            finally:
                resume.set()
                reader.join(10)
                if writer.ident is not None:
                    writer.join(10)
        self.assertFalse(errors, errors)
        self.assertFalse(reader.is_alive())
        self.assertFalse(writer.is_alive())
        self.assertEqual(result[0]["files"], {"references/help.md": "Support A\n"})
        self.assertTrue(result[1]["success"], result)

    def test_detects_support_change_deletion_or_rename_between_reads(self):
        for change in ["write", "delete", "rename"]:
            name = "capture-race-" + change
            directory = self.create(name)
            expected, original, changed = self.expected(name), self.worker.capture_bytes, False
            def interleave(path, remaining):
                nonlocal changed
                value = original(path, remaining)
                if path == directory / "SKILL.md" and not changed:
                    changed = True
                    support = directory / "references/help.md"
                    if change == "write":
                        support.write_text("Support B\n", encoding="utf-8")
                    elif change == "delete":
                        support.unlink()
                    else:
                        support.rename(support.with_name("renamed.md"))
                return value
            with self.subTest(change=change), patch.object(self.worker, "capture_bytes", side_effect=interleave):
                with self.assertRaises((module.SourceConflictError, ValueError, OSError)):
                    self.capture(name, expected)

    def test_identical_byte_file_or_directory_substitution_is_refused(self):
        for change in ["file", "directory"]:
            name = "capture-custody-" + change
            directory = self.create(name)
            expected, original, changed = self.expected(name), self.worker.capture_bytes, False
            def interleave(path, remaining):
                nonlocal changed
                value = original(path, remaining)
                if path == directory / "references/help.md" and not changed:
                    changed = True
                    if change == "file":
                        main = directory / "SKILL.md"
                        data = main.read_bytes()
                        main.rename(directory / "old-main.txt")
                        main.write_bytes(data)
                        (directory / "old-main.txt").unlink()
                    else:
                        moved = directory.with_name(name + "-moved")
                        directory.rename(moved)
                        shutil.copytree(moved, directory)
                return value
            with self.subTest(change=change), patch.object(self.worker, "capture_bytes", side_effect=interleave):
                with self.assertRaises(module.SourceConflictError):
                    self.capture(name, expected)

    def test_cross_skill_duplicate_tip_cannot_bind_a_historical_view(self):
        from tools import skill_ledger as ledger
        name = "capture-cross-skill-collision"
        self.create(name)
        expected = self.expected(name)
        path = ledger.ledger_path()
        original = path.read_bytes()
        entry = dict(ledger.get_entry(expected["tip"]))
        entry["skill"] = "another-skill-with-the-same-id"
        try:
            path.write_bytes(original + (json.dumps(entry) + "\n").encode("utf-8"))
            with self.assertRaisesRegex(ValueError, "ambiguous"):
                self.capture(name, expected)
        finally:
            path.write_bytes(original)

    def test_same_skill_duplicate_tip_cannot_select_older_historical_bytes(self):
        from tools import skill_ledger as ledger
        name = "capture-same-skill-collision"
        directory = self.create(name)
        support = directory / "references/help.md"
        original_support = support.read_bytes()
        path = ledger.ledger_path()
        original_ledger = path.read_bytes()
        entry = dict(ledger.get_entry(self.expected(name)["tip"]))
        changed = b"Current bytes belong to the later duplicate entry\n"
        entry.update(action="patch", before=[{"path": str(support), "sha256": hashlib.sha256(original_support).hexdigest()}],
                     after=[{"path": str(support), "sha256": ledger._store_blob(changed)}])
        try:
            support.write_bytes(changed)
            path.write_bytes(original_ledger + (json.dumps(entry) + "\n").encode("utf-8"))
            expected = self.expected(name)
            historical = self.worker.dispatch("skills.inspect", {"name": name, "revisionId": expected["tip"], "file_path": "references/help.md"})
            self.assertNotEqual(historical["fileContent"], changed.decode("utf-8"))
            with self.assertRaisesRegex(ValueError, "ambiguous"):
                self.capture(name, expected)
        finally:
            path.write_bytes(original_ledger)
            support.write_bytes(original_support)

    def test_current_tip_cannot_be_attached_to_unledgered_bytes(self):
        name = "capture-unledgered"
        directory = self.create(name)
        (directory / "references/help.md").write_text("Outside writer\n", encoding="utf-8")
        with self.assertRaisesRegex((module.SourceConflictError, ValueError), "histor|ledger"):
            self.capture(name)

    def test_missing_historical_blob_refuses_without_repair(self):
        from tools import skill_ledger as ledger
        name = "capture-missing-blob"
        directory = self.create(name, "Unique historical support\n")
        expected = self.expected(name)
        missing = ledger.blobs_dir() / expected["fileHashes"]["references/help.md"]
        missing.unlink()
        with self.assertRaises((ValueError, OSError)):
            self.capture(name, expected)
        self.assertFalse(missing.exists())
        self.assertEqual((directory / "references/help.md").read_text(), "Unique historical support\n")

    def test_no_ledger_preserves_raw_hashes_and_current_decoding(self):
        name = "capture-no-ledger"
        directory = Path(self.home.name) / "skills" / name
        directory.mkdir()
        main = b"\xef\xbb\xbf---\r\nname: capture-no-ledger\r\ndescription: Raw-byte package\r\n---\r\n\r\nBody\r\n"
        support = b"\xef\xbb\xbfSupport\r\n"
        (directory / "SKILL.md").write_bytes(main)
        (directory / "references").mkdir()
        (directory / "references/z.txt").write_bytes(support)
        (directory / "references/a.txt").write_bytes(b"First\n")
        result = self.capture(name)
        self.assertNotIn("sourceId", result)
        self.assertEqual(result["inspection"]["content"], "Body\n")
        self.assertEqual(result["files"], {"references/a.txt": "First\n", "references/z.txt": "Support\n"})
        self.assertEqual(result["inspection"]["fileHashes"]["SKILL.md"], hashlib.sha256(main).hexdigest())
        self.assertEqual(result["inspection"]["fileHashes"]["references/z.txt"], hashlib.sha256(support).hexdigest())

    def test_ledger_crlf_captures_without_changing_historical_decoding(self):
        from tools import skill_ledger as ledger
        name = "capture-crlf-history"
        directory = self.create(name)
        before = ledger.snapshot_paths(directory)
        raw_main = b"\xef\xbb\xbf" + (directory / "SKILL.md").read_text(encoding="utf-8-sig").replace("\n", "\r\n").encode("utf-8")
        (directory / "SKILL.md").write_bytes(raw_main)
        (directory / "references/help.md").write_bytes(b"CRLF\r\nCR\r")
        ledger.append_entry(action="patch", skill=name, before=before, after=ledger.snapshot_paths(directory))
        captured = self.capture(name)
        self.assertEqual(captured["files"]["references/help.md"], "CRLF\nCR\n")
        self.assertEqual(captured["inspection"]["content"], "Body A\n")
        self.assertEqual(captured["inspection"]["fileHashes"]["SKILL.md"], hashlib.sha256(raw_main).hexdigest())
        historical = self.worker.dispatch("skills.inspect", {"name": name, "revisionId": captured["sourceId"], "file_path": "references/help.md"})
        self.assertEqual(historical["document"], raw_main.decode("utf-8-sig"))
        self.assertEqual(historical["fileContent"], "CRLF\r\nCR\r")

    def test_equal_normalized_text_does_not_hide_a_raw_history_mismatch(self):
        name = "capture-newline-unledgered"
        directory = self.create(name)
        support = directory / "references/help.md"
        before = support.read_bytes()
        replacement = b"Support A\r" if before != b"Support A\r" else b"Support A\n"
        support.write_bytes(replacement)
        self.assertEqual(support.read_text(encoding="utf-8-sig"), "Support A\n")
        with self.assertRaisesRegex(module.SourceConflictError, "ledger"):
            self.capture(name)

    def test_malformed_text_and_linked_custody_are_refused(self):
        name = "capture-invalid-text"
        directory = self.create(name)
        expected = self.expected(name)
        (directory / "references/help.md").write_bytes(b"\xff")
        with self.assertRaises(UnicodeError):
            self.capture(name, expected)
        (directory / "references/help.md").write_bytes(b"Support A\n")
        linked = directory / "linked.md"
        os.link(directory / "SKILL.md", linked)
        try:
            with self.assertRaises(PermissionError):
                self.capture(name, expected)
        finally:
            linked.unlink()

    def test_capture_preserves_archived_disabled_and_protected_controls(self):
        name = "capture-controlled"
        self.create(name)
        controlled = self.worker.dispatch("skills.flags", {"name": name, "enabled": False, "protected": True})
        self.assertTrue(controlled["success"], controlled)
        captured = self.capture(name)
        self.assertFalse(captured["inspection"]["usage"]["harness_enabled"])
        self.assertTrue(captured["inspection"]["usage"]["harness_protected"])
        archived = self.worker.dispatch("skills.flags", {"name": name, "archived": True})
        self.assertTrue(archived["success"], archived)
        captured = self.capture(name)
        self.assertEqual(captured["inspection"]["usage"]["state"], "archived")
        self.assertEqual(captured["files"]["references/help.md"], "Support A\n")

    def test_capture_resolves_owned_display_name_without_unbounded_inspect(self):
        name = "capture-display-alias"
        directory = Path(self.home.name) / "skills" / "capture-directory-alias"
        directory.mkdir()
        (directory / "SKILL.md").write_bytes(b"---\nname: capture-display-alias\ndescription: Bounded alias lookup.\n---\n\nAlias body\n")
        expected = self.expected(name)
        with patch.object(self.worker, "skills", side_effect=AssertionError("capture fell back to unbounded inspection")):
            result = self.capture(name, expected)
        self.assertEqual(result["inspection"]["name"], name)
        self.assertEqual(result["inspection"]["content"], "Alias body\n")
        self.assertNotIn("sourceId", result)

    def test_aggregate_raw_limit_refuses_a_complete_package_before_decoding(self):
        name = "capture-aggregate-bound"
        directory = self.create(name, "S" * 100)
        main = directory / "SKILL.md"
        # Even malformed UTF-8 is not decoded until the aggregate byte budget admits all files.
        original = main.read_bytes()
        main.write_bytes(original + b"\xff")
        total = main.stat().st_size + 100
        try:
            with patch.object(module, "MAX_FRAME_BYTES", total - 1):
                with self.assertRaisesRegex(ValueError, "aggregate raw-byte"):
                    self.worker.capture_package_bytes(directory)
        finally:
            main.write_bytes(original)
        self.assertEqual((directory / "references/help.md").read_bytes(), b"S" * 100)

    def test_capture_limit_includes_metadata_escaping_and_request_id(self):
        name = "capture-wire-bound"
        self.create(name, '\x00"\\\n' * 200)
        expected = self.expected(name)
        self.worker.library_context.request_id = "long-request-id-" * 30
        try:
            captured = self.capture(name, expected)
            limit = len(module.frame_data({"id": self.worker.library_context.request_id, "result": captured}).encode("utf-8")) + 1
            with patch.object(module, "MAX_FRAME_BYTES", limit):
                self.assertEqual(self.capture(name, expected), captured)
            with patch.object(module, "MAX_FRAME_BYTES", limit - 1):
                with self.assertRaisesRegex(ValueError, "transport bound"):
                    self.capture(name, expected)
        finally:
            del self.worker.library_context.request_id


if __name__ == "__main__":
    unittest.main()
