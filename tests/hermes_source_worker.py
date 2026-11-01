"""Scripted ACP integration: original Hermes executes, with no inference or credentials."""
from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "packages/runtime-hermes/worker.py"


def scripted_acp() -> None:
    for line in sys.stdin:
        msg = json.loads(line)
        method = msg.get("method")
        result = {}
        if method == "initialize":
            result = {"protocolVersion": 1, "agentCapabilities": {}}
        elif method == "session/new":
            result = {"sessionId": "fixture", "models": {"currentModelId": "fixture-model", "availableModels": [{"modelId": "fixture-model", "name": "Fixture"}]}}
        elif method == "session/prompt":
            prompt = msg["params"]["prompt"][0]["text"]
            # A separate process is started for every completion: inspect source history.
            if "ALIAS_POLICY_FIXTURE" in prompt:
                if "Skill is disabled or protected by the host" in prompt:
                    content = "Alias policy retained."
                else:
                    content = '<tool_call>' + json.dumps({"id": "alias-patch", "type": "function", "function": {"name": "skill_manage", "arguments": json.dumps({"operations": [{"action": "patch", "name": "folder-name", "old_string": "Original.", "new_string": "Changed."}]})}}) + '</tool_call>'
            elif "HOST_GATE_FIXTURE" in prompt:
                if '"gate": "released"' in prompt:
                    content = "Steer reached original source." if "steer-original" in prompt else "Host gate released."
                else:
                    content = '<tool_call>' + json.dumps({"id": "host-gate", "type": "function", "function": {"name": "tool_call", "arguments": json.dumps({"calls": [{"name": "host_gate", "arguments": {}}]})}}) + '</tool_call>'
            elif "AUTO_SKILL_FIXTURE" in prompt and "Review the conversation above and update the skill library." in prompt and '"success": true' not in prompt:
                skill = "---\nname: auto-source\ndescription: Reuse verified source-backed workflows.\n---\n\n# Source-backed workflows\n\nRun the original source and retain its behavior.\n"
                content = '<tool_call>' + json.dumps({"id": "auto-create", "type": "function", "function": {"name": "skill_manage", "arguments": json.dumps({"operations": [{"action": "create", "name": "auto-source", "content": skill}]})}}) + '</tool_call>'
            elif "PLAIN_REPLY_ONLY" in prompt:
                content = "A plain source reply."
            elif '"success": true' in prompt or '"success":true' in prompt:
                content = "Original Hermes executed the skill tool."
            else:
                skill = "---\nname: verified-source\ndescription: A source execution fixture.\nmetadata:\n  retained: true\n---\n\n# Verified\n\nUse the verified process.\n"
                content = '<tool_call>' + json.dumps({"id": "fixture-create", "type": "function", "function": {"name": "skill_manage", "arguments": json.dumps({"operations": [{"action": "create", "name": "verified-source", "content": skill}]})}}) + '</tool_call>'
            print(json.dumps({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "fixture", "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": content}}}}), flush=True)
            result = {"stopReason": "end_turn"}
        if "id" in msg:
            print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}), flush=True)


class WorkerFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="hermes-original-")
        env = {k: v for k, v in os.environ.items() if k.upper() in {"SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP"}}
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        self.proc = subprocess.Popen([sys.executable, "-I", "-S", "-B", str(WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf8", env=env)
        self.frames = queue.Queue()
        self.stderr = []
        threading.Thread(target=lambda: [self.frames.put(json.loads(line)) for line in self.proc.stdout], daemon=True).start()
        threading.Thread(target=lambda: [self.stderr.append(line) for line in self.proc.stderr], daemon=True).start()
        self.counter = 0

    def tearDown(self):
        self.proc.terminate()
        self.proc.wait(timeout=10)
        for stream in (self.proc.stdin, self.proc.stdout, self.proc.stderr):
            stream.close()
        self.tmp.cleanup()

    def request(self, method, params, error_code=None):
        self.counter += 1
        self.proc.stdin.write(json.dumps({"id": self.counter, "method": method, "params": params}) + "\n")
        self.proc.stdin.flush()
        while True:
            try:
                frame = self.frames.get(timeout=30)
            except queue.Empty:
                self.fail("Worker timed out: " + "".join(self.stderr[-30:]))
            if "hostCall" in frame:
                call = frame["hostCall"]
                self.proc.stdin.write(json.dumps({"hostResult": {"id": call["id"], "result": {}}}) + "\n")
                self.proc.stdin.flush()
            elif frame.get("id") == self.counter:
                if error_code is not None:
                    self.assertEqual(frame.get("error", {}).get("code"), error_code, frame)
                    return frame["error"]
                self.assertNotIn("error", frame, frame)
                return frame["result"]

    def hello(self, review=False, config=None):
        return self.request("hello", {"home": self.tmp.name, "acpCommand": sys.executable, "acpArgs": ["-I", "-S", "-B", str(Path(__file__).resolve()), "scripted-acp"], "dependencyRoot": str(ROOT / ".harness-hermes-python-deps"), "config": config or {"auxiliary": {"background_review": {"enabled": review}}}})

    def until_settled(self):
        events = []
        while True:
            try:
                frame = self.frames.get(timeout=45)
            except queue.Empty:
                self.fail("No settlement: " + "".join(self.stderr[-30:]))
            if "hostCall" in frame:
                self.proc.stdin.write(json.dumps({"hostResult": {"id": frame["hostCall"]["id"], "result": {}}}) + "\n")
                self.proc.stdin.flush()
            else:
                events.append(frame)
            if frame.get("event") == "settled":
                self.assertNotIn("error", frame["data"], frame)
                return events

    def until_host_gate(self):
        while True:
            frame = self.frames.get(timeout=45)
            if "hostCall" in frame:
                call = frame["hostCall"]
                if call["name"] == "host_gate":
                    return call["id"]
                self.proc.stdin.write(json.dumps({"hostResult": {"id": call["id"], "result": {}}}) + "\n")
                self.proc.stdin.flush()
            if frame.get("event") == "settled":
                self.fail("Source settled before gate: " + str(frame))

    def gate_params(self):
        return {"ctx": {"threadId": "gate", "runId": "gate"}, "modelId": "fixture-model", "prompt": "HOST_GATE_FIXTURE: wait on the host gate.", "inputIds": ["initial-input"], "hostTools": [{"name": "host_gate", "description": "A fixture gate", "parameters": {"type": "object", "properties": {}}}], "maxIterations": 4, "skillPolicy": {"enabled": True, "allowWrites": True}}

    def session_path(self, thread_id):
        return str(Path(self.tmp.name) / "sessions" / (hashlib.sha256(thread_id.encode()).hexdigest() + ".json"))

    def test_real_engine_creates_skill_with_full_frontmatter(self):
        hello = self.hello()
        self.assertEqual(hello["sourceCommit"], "c627ec84664d43e0b18b95d9d86d8963747d56c7")
        accepted = self.request("agent.start", {"ctx": {"runId": "fixture"}, "modelId": "fixture-model", "prompt": "Create the fixture skill.", "hostTools": [], "maxIterations": 4, "skillPolicy": {"enabled": True, "allowWrites": True}})
        self.assertTrue(accepted["accepted"])
        events = self.until_settled()
        settled = events[-1]["data"]
        self.assertEqual(settled["engineClass"], "run_agent.AIAgent")
        self.assertEqual(settled["result"]["final_response"], "Original Hermes executed the skill tool.")
        path = Path(self.tmp.name) / "skills/verified-source/SKILL.md"
        self.assertIn("retained: true", path.read_text(encoding="utf8"))
        report = self.request("skills.list", {})
        self.assertTrue(any(row["name"] == "verified-source" for row in report["skills"]))
        inspected = self.request("skills.inspect", {"name": "verified-source"})
        self.assertEqual(inspected["frontmatter"]["metadata"], {"retained": True})
        self.assertEqual(report["usage"]["verified-source"]["created_by"], "learn")

    def test_parent_instance_and_source_iteration_counter_survive_turns(self):
        self.hello()
        params = {"ctx": {"threadId": "retained", "runId": "one"}, "modelId": "fixture-model", "prompt": "Create the fixture skill.", "hostTools": [], "maxIterations": 4, "skillPolicy": {"enabled": True, "allowWrites": True}, "sessionPath": self.session_path("retained")}
        self.request("agent.start", params)
        first = self.until_settled()[-1]["data"]
        params["ctx"]["runId"] = "two"
        params["prompt"] = "Continue from the verified fixture."
        self.request("agent.start", params)
        second = self.until_settled()[-1]["data"]
        self.assertEqual(first["agentInstance"], second["agentInstance"])
        self.assertGreater(second["itersSinceSkill"], first["itersSinceSkill"])
        saved = json.loads(Path(params["sessionPath"]).read_text(encoding="utf8"))
        self.assertEqual(saved["messages"], self.request("agent.history", {})["messages"])
        self.assertEqual(saved["format"], "hermes-source-session-v1")

    def test_ten_plain_iterations_launch_the_original_review_fork(self):
        self.hello(review=True)
        params = {"ctx": {"threadId": "cadence", "runId": "zero"}, "modelId": "fixture-model", "prompt": "PLAIN_REPLY_ONLY AUTO_SKILL_FIXTURE: respond briefly.", "hostTools": [], "skillPolicy": {"enabled": True, "allowWrites": True}}
        instance = None
        for index in range(10):
            params["ctx"]["runId"] = str(index)
            self.request("agent.start", params)
            events = self.until_settled()
            settled = events[-1]["data"]
            instance = instance or settled["agentInstance"]
            self.assertEqual(settled["agentInstance"], instance)
            if index < 9:
                self.assertEqual(settled["itersSinceSkill"], index + 1)
                self.assertFalse(any(e.get("ctx", {}).get("phase") == "background_review" for e in events))
        self.assertEqual(settled["itersSinceSkill"], 0)
        self.assertTrue(any(e.get("event") == "model_request" and e["ctx"]["phase"] == "background_review" for e in events), events)
        report = self.request("skills.list", {})
        self.assertEqual(report["usage"]["auto-source"]["created_by"], "agent")

    def test_original_atomic_batch_fuzzy_patch_and_ledger_rollback(self):
        self.hello()
        document = "---\nname: fixture-name\ndescription: Verify original skill operations.\nmetadata:\n  retained: true\n---\n\nalpha\n  beta\ngamma\n"
        operations = [{"action": "create", "name": "batch-" + str(i), "content": document.replace("fixture-name", "batch-" + str(i))} for i in range(20)]
        too_many = self.request("skills.manage", {"action": "", "name": "", "operations": operations + [{"action": "create", "name": "twenty-first", "content": document}]})
        self.assertFalse(too_many["success"])
        self.assertEqual(self.request("skills.list", {})["skills"], [])
        result = self.request("skills.manage", {"action": "", "name": "", "operations": operations})
        self.assertTrue(result["success"], result)
        patched = self.request("skills.manage", {"action": "patch", "name": "batch-0", "old_string": "alpha\n beta", "new_string": "updated"})
        self.assertTrue(patched["success"], patched)
        inspected = self.request("skills.inspect", {"name": "batch-0"})
        self.assertIn("updated", inspected["content"])
        self.assertEqual(inspected["frontmatter"]["metadata"], {"retained": True})
        entry = inspected["versions"][0]
        rolled = self.request("skills.rollback", {"id": entry["id"]})
        self.assertTrue(rolled["success"], rolled)
        self.assertIn("alpha\n  beta", self.request("skills.inspect", {"name": "batch-0"})["content"])

    def test_original_approval_store_replays_only_after_user_decides(self):
        self.hello(config={"skills": {"write_approval": True}, "auxiliary": {"background_review": {"enabled": False}}})
        self.request("agent.start", {"ctx": {"threadId": "approval", "runId": "approval"}, "modelId": "fixture-model", "prompt": "Create the fixture skill.", "hostTools": [], "maxIterations": 4, "skillPolicy": {"enabled": True, "allowWrites": True}})
        self.until_settled()
        self.assertFalse((Path(self.tmp.name) / "skills/verified-source/SKILL.md").exists())
        pending = self.request("skills.proposals", {})
        self.assertIn("retained: true", pending[0]["payload"]["operations"][0]["content"])
        decided = self.request("skills.decide", {"id": pending[0]["id"], "approve": True})
        self.assertTrue(decided["success"], decided)
        self.assertEqual(self.request("skills.proposals", {}), [])

    def test_actual_source_steering_ticket_reaches_a_model_request(self):
        self.hello()
        self.request("agent.start", self.gate_params())
        gate = self.until_host_gate()
        accepted = self.request("agent.followUp", {"prompt": "steer-original: retain the submitted correction.", "inputId": "steer-input"})
        self.assertTrue(accepted["accepted"])
        self.proc.stdin.write(json.dumps({"hostResult": {"id": gate, "result": {"gate": "released"}}}) + "\n")
        self.proc.stdin.flush()
        events = self.until_settled()
        self.assertEqual(events[-1]["data"]["text"], "Steer reached original source.")
        self.assertEqual(events[-1]["data"]["unconsumedInputIds"], [])
        self.assertTrue(any(e.get("event") == "model_request" and "steer-input" in e["data"]["inputIds"] for e in events), events)
        self.assertFalse(any(e.get("event") == "input_entered" for e in events))

    def test_source_cancel_waits_for_actual_turn_settlement(self):
        self.hello()
        self.request("agent.start", self.gate_params())
        self.until_host_gate()
        self.assertTrue(self.request("agent.cancel", {})["accepted"])
        events = self.until_settled()
        self.assertTrue(events[-1]["data"]["result"]["interrupted"], events[-1])

    def test_linked_skill_node_is_rejected_before_source_writes(self):
        self.hello()
        outside = Path(self.tmp.name) / "external.txt"
        outside.write_text("original", encoding="utf8")
        skills = Path(self.tmp.name) / "skills"
        skills.mkdir(exist_ok=True)
        os.link(outside, skills / "linked.txt")
        error = self.request("skills.manage", {"action": "create", "name": "refused", "content": "---\nname: refused\ndescription: Refuse linked namespaces.\n---\n\nNo writes.\n"}, error_code="PermissionError")
        self.assertIn("linked", error["message"].lower())
        self.assertEqual(outside.read_text(encoding="utf8"), "original")
        self.assertFalse((skills / "refused").exists())

    def test_explicit_user_save_applies_when_model_write_approval_is_enabled(self):
        self.hello(config={"skills": {"write_approval": True}})
        document = "---\nname: user-save\ndescription: Save explicitly authorized user edits.\n---\n\nUser-approved body.\n"
        saved = self.request("skills.manage", {"action": "create", "name": "user-save", "content": document})
        self.assertTrue(saved["success"])
        self.assertEqual(self.request("skills.proposals", {}), [])
        self.assertEqual(self.request("skills.inspect", {"name": "user-save"})["document"], document)

    def test_host_controls_pin_original_curator_and_preserve_existing_pin(self):
        self.hello()
        document = "---\nname: controlled\ndescription: Preserve host controls during curation.\n---\n\nKeep the verified procedure.\n"
        self.request("skills.manage", {"action": "create", "name": "controlled", "content": document})
        self.request("skills.flags", {"name": "controlled", "managed": True, "protected": True})
        usage_path = Path(self.tmp.name) / "skills/.usage.json"
        usage = json.loads(usage_path.read_text(encoding="utf8"))
        usage["controlled"]["created_at"] = "2000-01-01T00:00:00+00:00"
        usage_path.write_text(json.dumps(usage), encoding="utf8")
        self.request("skills.curate", {"consolidate": False})
        self.assertTrue((Path(self.tmp.name) / "skills/controlled/SKILL.md").is_file())
        self.request("skills.flags", {"name": "controlled", "protected": False})
        self.assertFalse(self.request("skills.inspect", {"name": "controlled"})["usage"]["pinned"])
        self.request("skills.flags", {"name": "controlled", "pinned": True})
        self.request("skills.flags", {"name": "controlled", "enabled": False})
        self.request("skills.flags", {"name": "controlled", "enabled": True})
        self.assertTrue(self.request("skills.inspect", {"name": "controlled"})["usage"]["pinned"])

    def test_expected_source_state_refuses_stale_user_write(self):
        self.hello()
        document = "---\nname: compare-state\ndescription: Compare before saving.\n---\n\nOriginal.\n"
        self.request("skills.manage", {"action": "create", "name": "compare-state", "content": document})
        value = self.request("skills.inspect", {"name": "compare-state"})
        expected = {"documentHash": value["fileHashes"]["SKILL.md"], "fileHashes": value["fileHashes"], "enabled": True, "protected": False, "state": "active", "tip": value["versions"][0]["id"]}
        self.request("skills.manage", {"action": "patch", "name": "compare-state", "old_string": "Original.", "new_string": "Changed."})
        self.request("skills.manage", {"action": "patch", "name": "compare-state", "old_string": "Changed.", "new_string": "Stale overwrite.", "expected": {"compare-state": expected}}, error_code="STALE_SKILL")
        self.assertIn("Changed.", self.request("skills.inspect", {"name": "compare-state"})["document"])

    def test_current_host_protection_applies_to_an_ordinary_declared_name_alias(self):
        self.hello()
        document = "---\nname: declared-name\ndescription: Preserve an ordinary name alias.\n---\n\nOriginal.\n"
        self.request("skills.manage", {"action": "create", "name": "folder-name", "content": document})
        params = {"ctx": {"threadId": "alias", "runId": "first"}, "modelId": "fixture-model", "prompt": "PLAIN_REPLY_ONLY: respond briefly.", "hostTools": [], "maxIterations": 4, "skillPolicy": {"enabled": True, "allowWrites": True, "protectedNames": []}}
        self.request("agent.start", params)
        first = self.until_settled()[-1]["data"]
        self.request("skills.flags", {"name": "declared-name", "protected": True})
        params["ctx"]["runId"] = "second"
        params["prompt"] = "ALIAS_POLICY_FIXTURE: retain the current protection."
        self.request("agent.start", params)
        second = self.until_settled()[-1]["data"]
        self.assertEqual(first["agentInstance"], second["agentInstance"])
        self.assertEqual(second["text"], "Alias policy retained.")
        self.assertEqual(self.request("skills.inspect", {"name": "declared-name"})["document"], document)

    def test_bulk_snapshot_keeps_disabled_metadata_without_full_bodies(self):
        self.hello(config={"skills": {"disabled": ["catalog-check"]}})
        document = "---\nname: catalog-check\ndescription: Verify the metadata snapshot.\n---\n\nFull body stays on demand.\n"
        self.request("skills.manage", {"action": "create", "name": "catalog-check", "content": document})
        snapshot = self.request("skills.snapshot", {})
        self.assertEqual(snapshot["catalog"]["skills"][0]["name"], "catalog-check")
        row = snapshot["inspections"]["catalog-check"]
        self.assertNotIn("document", row)
        self.assertNotIn("content", row)
        actual = (Path(self.tmp.name) / "skills/catalog-check/SKILL.md").read_bytes()
        self.assertEqual(row["fileHashes"]["SKILL.md"], hashlib.sha256(actual).hexdigest())


if __name__ == "__main__":
    if sys.argv[-1:] == ["scripted-acp"]:
        scripted_acp()
    else:
        unittest.main()
