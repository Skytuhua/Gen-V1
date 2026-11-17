"""Scripted ACP integration: original Hermes executes, with no inference or credentials."""
from __future__ import annotations

import json
import hashlib
import importlib.util
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
sys.dont_write_bytecode = True


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
            if "You are running as Hermes' background skill CURATOR." in prompt and "curator-source" in prompt:
                if "Patched SKILL.md in skill 'curator-source'" in prompt:
                    content = "Curator source review completed."
                elif '"success": false' in prompt:
                    content = "Curator fixture failed."
                elif "CURATOR_ORIGINAL_PROCEDURE" in prompt:
                    content = '<tool_call>' + json.dumps({"id": "curator-patch", "type": "function", "function": {"name": "skill_manage", "arguments": json.dumps({"action": "patch", "name": "curator-source", "old_string": "CURATOR_ORIGINAL_PROCEDURE", "new_string": "Read the original skill before applying a verified patch."})}}) + '</tool_call>'
                else:
                    content = '<tool_call>' + json.dumps({"id": "curator-view", "type": "function", "function": {"name": "skill_view", "arguments": json.dumps({"name": "curator-source"})}}) + '</tool_call>'
            elif "ALIAS_POLICY_FIXTURE" in prompt:
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
            elif "M04_EXPOSURE_FIXTURE" in prompt:
                direct = '"name": "m04_direct_fixture"' in prompt
                deferred = '"name": "m04_deferred_fixture"' in prompt
                content = "M04 visibility: direct=" + str(int(direct)) + ", deferred=" + str(int(deferred))
            elif "M04_INSTRUCTION_FIXTURE" in prompt:
                first = "M04_INSTRUCTION_ONE_SENTINEL" in prompt
                second = "M04_INSTRUCTION_TWO_SENTINEL" in prompt
                content = "Project instructions: first=" + str(int(first)) + ", second=" + str(int(second))
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


class ContextCaptureFixture(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("context_capture_fixture", ROOT / "packages/runtime-hermes/context_capture.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.capture = self.module.NativeContextCapture()

    def test_append_reports_only_new_tool_metadata_and_exact_unicode_bytes(self):
        messages = [{"role": "system", "content": "Stable policy"}, {"role": "user", "content": "Private 日本語"}]
        first = self.capture.capture(messages, "a" * 64, [])
        expected = sum(len(json.dumps(message, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")) for message in messages)
        self.assertEqual(first["sourceBytes"], expected)
        tool = {"role": "tool", "tool_call_id": "call-one", "content": "Private result 日本語"}
        messages.append(tool)
        next_cut = self.capture.capture(messages, "a" * 64, [])
        self.assertEqual(next_cut["reusedSources"], 2)
        self.assertEqual(len(next_cut["sources"]), 1)
        self.assertEqual(next_cut["inspectedSources"], 3)
        self.assertEqual(next_cut["newToolResults"], 1)
        self.assertEqual(next_cut["newToolResultBytes"], len(json.dumps(tool, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")))
        self.assertNotIn("Private", json.dumps(next_cut))
        unchanged = self.capture.capture(messages, "a" * 64, [])
        self.assertEqual(unchanged["change"], "UNCHANGED")
        self.assertEqual(unchanged["sources"], [])

    def test_in_place_native_mutation_rebuilds_instead_of_reusing_object_identity(self):
        messages = [{"role": "user", "content": "Before"}]
        first = self.capture.capture(messages, "a" * 64, [])
        messages[0]["content"] = "After"
        next_cut = self.capture.capture(messages, "a" * 64, [])
        self.assertEqual(next_cut["change"], "RESET")
        self.assertEqual(next_cut["reusedSources"], 0)
        self.assertGreater(next_cut["generation"], first["generation"])
        self.assertNotEqual(next_cut["sources"][0]["sha256"], first["sources"][0]["sha256"])

    def test_rewind_binding_and_native_schema_changes_retire_the_prefix(self):
        messages = [{"role": "user", "content": "One"}, {"role": "assistant", "content": "Two"}]
        prior = self.capture.capture(messages, "a" * 64, [])
        for next_messages, binding, tools in [(messages[:1], "a" * 64, []), (messages[:1], "b" * 64, []), (messages[:1], "b" * 64, [{"name": "new-tool"}])]:
            current = self.capture.capture(next_messages, binding, tools)
            self.assertEqual(current["change"], "RESET")
            self.assertGreater(current["generation"], prior["generation"])
            self.assertIsNone(current["newToolResults"])
            prior = current

    def test_source_limits_and_unsupported_shapes_retire_metadata_without_returning_content(self):
        first = self.capture.capture([{"role": "user", "content": "Before"}], "a" * 64, [])
        self.assertEqual(self.capture.capture([{}] * 4097, "a" * 64, []), {"version": 1, "status": "UNAVAILABLE", "reason": "SOURCE_LIMIT"})
        self.assertEqual(self.capture.capture(["Private source"], "a" * 64, []), {"version": 1, "status": "UNAVAILABLE", "reason": "UNSUPPORTED_SOURCE"})
        next_cut = self.capture.capture([{"role": "user", "content": "Before"}], "a" * 64, [])
        self.assertEqual(next_cut["change"], "RESET")
        self.assertGreater(next_cut["generation"], first["generation"])
        with self.assertRaises(OverflowError):
            self.module.fingerprint({"content": "Native source too large for remaining bytes"}, 8)

    def test_deep_or_cyclic_native_content_is_unavailable_without_escaping_the_observer(self):
        first = self.capture.capture([{"role": "user", "content": "Original"}], "a" * 64, [])
        deep = []
        for _ in range(1100):
            deep = [deep]
        self.assertEqual(self.capture.capture([{"role": "tool", "content": deep}], "a" * 64, []), {"version": 1, "status": "UNAVAILABLE", "reason": "SOURCE_LIMIT"})
        cycle = []
        cycle.append(cycle)
        self.assertEqual(self.capture.capture([{"role": "tool", "content": cycle}], "a" * 64, []), {"version": 1, "status": "UNAVAILABLE", "reason": "UNSUPPORTED_SOURCE"})
        self.assertEqual(self.capture.capture([{"role": "user", "content": "\ud800"}], "a" * 64, []), {"version": 1, "status": "UNAVAILABLE", "reason": "UNSUPPORTED_SOURCE"})
        recovered = self.capture.capture([{"role": "user", "content": "Original"}], "a" * 64, [])
        self.assertEqual(recovered["change"], "RESET")
        self.assertGreater(recovered["generation"], first["generation"])


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
        self.host_calls = []
        self.m04_snapshot = None
        self.compaction_commit = True
        self.on_compaction_commit = None

    def tearDown(self):
        self.proc.terminate()
        self.proc.wait(timeout=10)
        for stream in (self.proc.stdin, self.proc.stdout, self.proc.stderr):
            stream.close()
        self.tmp.cleanup()

    def request(self, method, params, error_code=None, events=None):
        self.counter += 1
        self.proc.stdin.write(json.dumps({"id": self.counter, "method": method, "params": params}) + "\n")
        self.proc.stdin.flush()
        while True:
            try:
                frame = self.frames.get(timeout=30)
            except queue.Empty:
                self.fail("Worker timed out: " + "".join(self.stderr[-30:]))
            if events is not None:
                events.append(frame)
            if "hostCall" in frame:
                call = frame["hostCall"]
                self.host_calls.append(call["name"])
                result = {"acquired": True} if call["name"] == "$background.acquire" else self.m04_snapshot if call["name"] == "$context.tools.snapshot" else {}
                if call["name"] == "$context.compaction.commit":
                    if self.on_compaction_commit is not None:
                        self.on_compaction_commit()
                    result = {"version": 1, "accepted": self.compaction_commit, "planDigest": call["args"]["planDigest"]}
                self.proc.stdin.write(json.dumps({"hostResult": {"id": call["id"], "result": result}}) + "\n")
                self.proc.stdin.flush()
            elif frame.get("id") == self.counter:
                if error_code is not None:
                    self.assertEqual(frame.get("error", {}).get("code"), error_code, frame)
                    return frame["error"]
                self.assertNotIn("error", frame, frame)
                return frame["result"]

    def hello(self, review=False, config=None, managed_review=False):
        return self.request("hello", {"home": self.tmp.name, "managedReview": managed_review, "acpCommand": sys.executable, "acpArgs": ["-I", "-S", "-B", str(Path(__file__).resolve()), "scripted-acp"], "dependencyRoot": str(ROOT / ".harness-hermes-python-deps"), "config": config or {"auxiliary": {"background_review": {"enabled": review}}}})

    def until_settled(self):
        events = []
        while True:
            try:
                frame = self.frames.get(timeout=45)
            except queue.Empty:
                self.fail("No settlement: " + "".join(self.stderr[-30:]))
            if "hostCall" in frame:
                call = frame["hostCall"]
                self.host_calls.append(call["name"])
                result = {"acquired": True} if call["name"] == "$background.acquire" else self.m04_snapshot if call["name"] == "$context.tools.snapshot" else {}
                self.proc.stdin.write(json.dumps({"hostResult": {"id": call["id"], "result": result}}) + "\n")
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

    def test_m04_progressive_hook_filters_host_schemas_at_the_original_acp_boundary(self):
        self.hello(config={"tools": {"tool_search": {"enabled": "off"}}, "auxiliary": {"background_review": {"enabled": False}}})
        self.m04_snapshot = {"names": ["m04_direct_fixture"]}
        names = ["m04_direct_fixture", "m04_deferred_fixture"]
        params = {
            "ctx": {"threadId": "m04-exposure", "runId": "m04-first", "epoch": 1},
            "sessionId": "m04-exposure", "modelId": "fixture-model", "accountId": None,
            "prompt": "M04_EXPOSURE_FIXTURE", "hostTools": [
                {"name": name, "description": "Synthetic host tool", "parameters": {"type": "object"}} for name in names
            ], "progressiveTools": True, "maxIterations": 2,
            "skillPolicy": {"enabled": False}, "sessionPath": self.session_path("m04-exposure"),
        }
        self.request("agent.start", params)
        events = self.until_settled()
        self.assertIn("$context.tools.snapshot", self.host_calls)
        self.assertEqual(events[-1]["data"]["text"], "M04 visibility: direct=1, deferred=0")
        self.m04_snapshot = {"names": names}
        params["ctx"] = {"threadId": "m04-exposure", "runId": "m04-second", "epoch": 2}
        self.request("agent.start", params)
        events = self.until_settled()
        self.assertEqual(events[-1]["data"]["text"], "M04 visibility: direct=1, deferred=1")

    def test_original_summary_compaction_executes_with_the_retained_dependency_subset(self):
        self.hello(config={"compression": {"enabled": True, "protect_first_n": 0, "protect_last_n": 4, "abort_on_summary_failure": True}, "auxiliary": {"background_review": {"enabled": False}}})
        history = [{"role": "user" if index % 2 == 0 else "assistant", "content": (f"Declared synthetic checkpoint {index}: approved edits retain their reviewed SHA and stale work needs new review. " * 8)} for index in range(12)]
        params = {"ctx": {"threadId": "compact-fixture", "runId": "first", "epoch": 1}, "modelId": "fixture-model", "accountId": None, "prompt": "PLAIN_REPLY_ONLY", "history": history, "hostTools": [], "maxIterations": 2, "skillPolicy": {"enabled": False}, "sessionPath": self.session_path("compact-fixture")}
        self.request("agent.start", params)
        self.until_settled()
        before = self.request("agent.history", {})["messages"]
        # The scripted ACP process owns every completion; this broker address is never used.
        result = self.request("agent.compact", {**params, "brokerURL": "http://127.0.0.1:1", "jobKey": "synthetic-unused"})
        errors = Path(self.tmp.name) / "logs/errors.log"
        self.assertTrue(result["compacted"], errors.read_text(encoding="utf8")[-6000:] if errors.exists() else result)
        self.assertLess(len(result["messages"]), len(before))
        self.assertEqual(result["messages"], json.loads(Path(params["sessionPath"]).read_text(encoding="utf8"))["messages"])
        self.assertEqual(self.host_calls, ["$transport.usage", "$transport.observation", "$transport.usage", "$transport.observation"])

    def test_m04_admitted_system_instructions_reach_original_acp_and_changed_prefix_rebuilds_the_agent(self):
        self.hello()
        params = {"ctx": {"threadId": "m04-instructions", "runId": "one", "epoch": 1},
                  "modelId": "fixture-model", "accountId": None, "prompt": "M04_INSTRUCTION_FIXTURE",
                  "systemPrompt": "Host policy. M04_INSTRUCTION_ONE_SENTINEL", "hostTools": [], "maxIterations": 2,
                  "skillPolicy": {"enabled": False}, "sessionPath": self.session_path("m04-instructions")}
        self.request("agent.start", params)
        first = self.until_settled()[-1]["data"]
        self.assertEqual(first["text"], "Project instructions: first=1, second=0")
        before = self.request("agent.history", {})["messages"]
        params["systemPrompt"] = "Host policy. M04_INSTRUCTION_TWO_SENTINEL"
        params["ctx"] = {"threadId": "m04-instructions", "runId": "two", "epoch": 2}
        self.request("agent.start", params)
        second = self.until_settled()[-1]["data"]
        self.assertEqual(second["text"], "Project instructions: first=0, second=1")
        self.assertNotEqual(first["agentInstance"], second["agentInstance"])
        self.assertEqual(self.request("agent.history", {})["messages"][:len(before)], before)
        params["ctx"] = {"threadId": "m04-instructions", "runId": "three", "epoch": 3}
        self.request("agent.start", params)
        third = self.until_settled()[-1]["data"]
        self.assertEqual(third["agentInstance"], second["agentInstance"])
        self.assertEqual(third["text"], "Project instructions: first=0, second=1")

    def test_m04_original_request_cut_reuses_only_an_unchanged_native_prefix(self):
        self.hello()
        params = {"ctx": {"threadId": "m04-native-cut", "runId": "one", "epoch": 1},
                  "modelId": "fixture-model", "accountId": None, "prompt": "PLAIN_REPLY_ONLY private-first-input",
                  "systemPrompt": "Stable host policy.", "hostTools": [], "maxIterations": 2,
                  "skillPolicy": {"enabled": False}, "sessionPath": self.session_path("m04-native-cut"),
                  "contextCapture": {"apiVersion": 1, "bindingDigest": "a" * 64}}
        self.request("agent.start", params)
        first_events = self.until_settled()
        first = next(event["data"] for event in first_events if event.get("event") == "model_request")["nativeContextCut"]
        self.assertEqual(first["change"], "RESET")
        self.assertGreater(first["sourceCount"], 0)
        self.assertEqual(first["reusedSources"], 0)
        self.assertNotIn("private-first-input", json.dumps(first))
        params["ctx"] = {"threadId": "m04-native-cut", "runId": "two", "epoch": 2}
        params["prompt"] = "PLAIN_REPLY_ONLY private-next-input"
        self.request("agent.start", params)
        second_events = self.until_settled()
        second = next(event["data"] for event in second_events if event.get("event") == "model_request")["nativeContextCut"]
        self.assertEqual(second["change"], "APPEND")
        self.assertEqual(second["generation"], first["generation"])
        self.assertEqual(second["previousDigest"], first["revisionDigest"])
        self.assertEqual(second["reusedSources"], first["sourceCount"])
        self.assertEqual(len(second["sources"]), second["sourceCount"] - first["sourceCount"])
        self.assertNotIn("private-next-input", json.dumps(second))
        params["ctx"] = {"threadId": "m04-native-cut", "runId": "three", "epoch": 3}
        params["systemPrompt"] = "Changed approved instructions."
        params["contextCapture"]["bindingDigest"] = "b" * 64
        self.request("agent.start", params)
        third_events = self.until_settled()
        third = next(event["data"] for event in third_events if event.get("event") == "model_request")["nativeContextCut"]
        self.assertEqual(third["change"], "RESET")
        self.assertGreater(third["generation"], second["generation"])
        self.assertEqual(third["reusedSources"], 0)

    def test_source_cut_cas_rejects_stale_compact_and_applies_matching_digest(self):
        self.hello(config={"compression": {"enabled": True, "protect_first_n": 0, "protect_last_n": 4, "abort_on_summary_failure": True}, "auxiliary": {"background_review": {"enabled": False}}})
        history = [{"role": "user" if index % 2 == 0 else "assistant", "content": (f"CAS fixture segment {index}: the worker must refuse a stale digest and only replace the exact approved history. " * 8)} for index in range(12)]
        params = {"ctx": {"threadId": "compact-cas", "runId": "first", "epoch": 1}, "modelId": "fixture-model", "accountId": None, "prompt": "PLAIN_REPLY_ONLY", "history": history, "hostTools": [], "maxIterations": 2, "skillPolicy": {"enabled": False}, "sessionPath": self.session_path("compact-cas")}
        self.request("agent.start", params)
        self.until_settled()
        snapshot = self.request("agent.history", {})
        self.assertIn("historySha256", snapshot)
        expected = hashlib.sha256(json.dumps(snapshot["messages"], sort_keys=True, default=str).encode("utf8")).hexdigest()
        self.assertEqual(snapshot["historySha256"], expected)
        stale = self.request("agent.compact", {**params, "brokerURL": "http://127.0.0.1:1", "jobKey": "synthetic-unused", "expectedHistorySha256": hashlib.sha256(b"stale-source-cut").hexdigest()})
        self.assertFalse(stale["compacted"])
        self.assertTrue(stale["mismatch"])
        self.assertEqual(stale["historySha256"], expected)
        self.assertEqual(self.request("agent.history", {})["messages"], snapshot["messages"])
        self.assertEqual(json.loads(Path(params["sessionPath"]).read_text(encoding="utf8"))["messages"], snapshot["messages"])
        applied = self.request("agent.compact", {**params, "brokerURL": "http://127.0.0.1:1", "jobKey": "synthetic-unused", "expectedHistorySha256": expected})
        errors = Path(self.tmp.name) / "logs/errors.log"
        self.assertTrue(applied["compacted"], errors.read_text(encoding="utf8")[-6000:] if errors.exists() else applied)
        self.assertLess(len(applied["messages"]), len(snapshot["messages"]))
        self.assertEqual(applied["messages"], json.loads(Path(params["sessionPath"]).read_text(encoding="utf8"))["messages"])

    def protected_compaction_fixture(self, distinct_turns=True, extra_user_text=""):
        self.hello(config={"compression": {"enabled": True, "protect_first_n": 0, "protect_last_n": 2, "abort_on_summary_failure": True}, "auxiliary": {"background_review": {"enabled": False}}})
        history = [{"role": "user", "content": "M04_UNRESOLVED_REQUIREMENT: retain the old API and evidence source src/api.ts revision 7." + extra_user_text}]
        for index in range(6):
            history += [{"role": "assistant", "content": f"Old explanatory paragraph {index}: " + "This completed investigation may be summarized. " * 80}]
            if distinct_turns:
                history += [{"role": "user", "content": f"Completed question {index}; continue with the retained API constraint."}]
        history += [{"role": "assistant", "content": None, "tool_calls": [{"id": "m04-read", "type": "function", "function": {"name": "repository_read", "arguments": '{"resourceId":"approved"}'}}]},
                    {"role": "tool", "tool_call_id": "m04-read", "content": "M04_SOURCE_EVIDENCE: verified revision 7"},
                    {"role": "user", "content": "M04_RECENT_USER: preserve this exact 日本語 text."}]
        params = {"ctx": {"threadId": "m04-protected", "runId": "first", "epoch": 1}, "modelId": "fixture-model", "accountId": None, "prompt": "PLAIN_REPLY_ONLY", "history": history,
                  "hostTools": [], "maxIterations": 2, "skillPolicy": {"enabled": False}, "sessionPath": self.session_path("m04-protected")}
        self.request("agent.start", params)
        self.until_settled()
        source = self.request("agent.history", {})
        last_user = max(index for index, message in enumerate(source["messages"]) if message.get("role") == "user")
        kept = [index for index, message in enumerate(source["messages"]) if message.get("role") in ("user", "system", "developer", "tool") or message.get("tool_calls") or index >= last_user]
        plan = {"version": 1, "candidateId": "candidate-protected", "owner": {"threadId": "m04-protected", "runId": "compact-run", "epoch": 2, "workspaceId": "workspace", "modelId": "fixture-model", "accountId": None,
                 "generation": 1, "instructionDigest": "b" * 64, "toolRegistryDigest": "c" * 64}, "sourceSha256": source["historySha256"], "retainedIndices": kept,
                "references": [{"kind": "PENDING_APPROVAL", "id": "request:approval", "revision": 3, "digest": "d" * 64}], "maxRetainedBytes": 65536}
        protection = {"plan": plan, "planDigest": hashlib.sha256(json.dumps(plan, ensure_ascii=False, separators=(",", ":")).encode("utf8")).hexdigest()}
        compact = {**params, "brokerURL": "http://127.0.0.1:1", "jobKey": "synthetic-unused", "expectedHistorySha256": source["historySha256"], "compactionProtection": protection,
                   "compactionContext": {key: plan["owner"][key] for key in ("threadId", "runId", "epoch")}}
        return params, source, plan, compact

    def test_m04_protected_compaction_retains_exact_records_and_a_separate_original_archive(self):
        params, source, plan, compact = self.protected_compaction_fixture()
        applied = self.request("agent.compact", compact)
        receipt = applied.get("protection")
        self.assertIn("M04_UNRESOLVED_REQUIREMENT", json.dumps(applied["messages"]), "Native compaction discarded the unresolved user requirement")
        self.assertTrue(applied["compacted"], receipt)
        public = lambda message: {key: value for key, value in message.items() if not key.startswith("_")}
        after = [public(message) for message in applied["messages"]]
        position = 0
        for index in plan["retainedIndices"]:
            expected = public(source["messages"][index])
            self.assertIn(expected, after[position:], "Protected native record was lost or reordered")
            position = after.index(expected, position) + 1
        self.assertIsInstance(receipt, dict, "Native application lacks a checked protection/archive receipt")
        self.assertEqual(receipt["status"], "APPLIED")
        self.assertEqual(receipt["sourceSha256"], source["historySha256"])
        self.assertIn("$context.compaction.commit", self.host_calls)
        self.assertIn("request:approval", json.dumps(applied["messages"]))
        archive = Path(params["sessionPath"] + ".history-" + source["historySha256"] + ".json")
        self.assertEqual(json.loads(archive.read_text(encoding="utf8")), source["messages"])
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), source["historySha256"])
        self.assertEqual(self.request("agent.history", {})["messages"], applied["messages"])
        self.assertEqual(json.loads(Path(params["sessionPath"]).read_text(encoding="utf8"))["messages"], applied["messages"])
        self.assertLess(receipt["afterBytes"], receipt["beforeBytes"])

    def test_m04_protection_rejects_wrong_maintenance_run_and_epoch_before_summary(self):
        params, source, _plan, compact = self.protected_compaction_fixture()
        calls = list(self.host_calls)
        for key, value in (("runId", "wrong-maintenance"), ("epoch", 3)):
            with self.subTest(field=key):
                attempt = json.loads(json.dumps(compact))
                plan = attempt["compactionProtection"]["plan"]
                plan["owner"][key] = value
                attempt["compactionProtection"]["planDigest"] = hashlib.sha256(json.dumps(plan, ensure_ascii=False, separators=(",", ":")).encode("utf8")).hexdigest()
                failure = self.request("agent.compact", attempt, error_code="ProtectionError")
                self.assertIn("SOURCE_MISMATCH", failure["message"])
                self.assertEqual(self.host_calls, calls)
                self.assertEqual(self.request("agent.history", {})["messages"], source["messages"])
                self.assertFalse(Path(params["sessionPath"] + ".history-" + source["historySha256"] + ".json").exists())

    def test_m04_protection_requires_an_explicit_same_thread_maintenance_context(self):
        params, source, _plan, compact = self.protected_compaction_fixture()
        calls = list(self.host_calls)
        for context in (None, {**compact["compactionContext"], "threadId": "other-thread"}, {**compact["compactionContext"], "epoch": True}):
            with self.subTest(context=context):
                failure = self.request("agent.compact", {**compact, "compactionContext": context}, error_code="ProtectionError")
                self.assertIn("SOURCE_MISMATCH", failure["message"])
                self.assertEqual(self.host_calls, calls)
                self.assertEqual(self.request("agent.history", {})["messages"], source["messages"])
                self.assertFalse(Path(params["sessionPath"] + ".history-" + source["historySha256"] + ".json").exists())

    def test_m04_protection_cannot_replace_the_retained_source_context(self):
        params, source, _plan, compact = self.protected_compaction_fixture()
        calls = list(self.host_calls)
        for key, value in (("runId", "wrong-source-run"), ("epoch", 2)):
            with self.subTest(field=key):
                failure = self.request("agent.compact", {**compact, "ctx": {**compact["ctx"], key: value}}, error_code="PermissionError")
                self.assertIn("Maintenance context does not own this source session", failure["message"])
                self.assertEqual(self.host_calls, calls)
                self.assertEqual(self.request("agent.history", {})["messages"], source["messages"])
                self.assertFalse(Path(params["sessionPath"] + ".history-" + source["historySha256"] + ".json").exists())

    def test_m04_protection_refuses_when_native_normalization_makes_the_old_prose_part_of_a_required_tool_group(self):
        params, source, _plan, compact = self.protected_compaction_fixture(distinct_turns=False)
        refused = self.request("agent.compact", compact)
        self.assertFalse(refused["compacted"])
        self.assertEqual(refused["protection"]["reason"], "NO_REDUCTION")
        self.assertNotIn("$context.compaction.commit", self.host_calls)
        self.assertEqual(self.request("agent.history", {})["messages"], source["messages"])
        self.assertEqual(json.loads(Path(params["sessionPath"]).read_text(encoding="utf8"))["messages"], source["messages"])

    def test_m04_protection_refuses_changed_archive_after_host_commit_wait(self):
        params, source, _plan, compact = self.protected_compaction_fixture()
        archive = Path(params["sessionPath"] + ".history-" + source["historySha256"] + ".json")
        self.on_compaction_commit = lambda: archive.write_bytes(b"changed archived source")
        refused = self.request("agent.compact", compact)
        self.assertFalse(refused["compacted"])
        self.assertEqual(refused["protection"]["reason"], "ARCHIVE_FAILED")
        self.assertIsNone(refused["protection"]["archiveRef"])
        self.assertIsNone(refused["protection"]["archiveSha256"])
        self.assertIn("$context.compaction.commit", self.host_calls)
        self.assertEqual(self.request("agent.history", {})["messages"], source["messages"])
        self.assertEqual(json.loads(Path(params["sessionPath"]).read_text(encoding="utf8"))["messages"], source["messages"])

    def test_m04_protection_overflow_never_starts_summary_or_native_mutation(self):
        params, source, _plan, compact = self.protected_compaction_fixture(extra_user_text="x" * 65536)
        calls = list(self.host_calls)
        failure = self.request("agent.compact", compact, error_code="ProtectionError")
        self.assertIn("PROTECTION_LIMIT", failure["message"])
        self.assertEqual(self.host_calls, calls)
        self.assertEqual(self.request("agent.history", {})["messages"], source["messages"])
        self.assertFalse(Path(params["sessionPath"] + ".history-" + source["historySha256"] + ".json").exists())

    def test_m04_required_checkpoint_failure_blocks_protected_summary_and_archive(self):
        params, source, _plan, compact = self.protected_compaction_fixture()
        compact["memoryCheckpoint"] = {"apiVersion": 2, "required": True}
        calls = len(self.host_calls)
        self.request("agent.compact", compact, error_code="RuntimeError")
        self.assertEqual(self.host_calls[calls:], ["$memory.checkpoint"])
        self.assertEqual(self.request("agent.history", {})["messages"], source["messages"])
        self.assertFalse(Path(params["sessionPath"] + ".history-" + source["historySha256"] + ".json").exists())

    def test_m04_revoked_commit_retains_the_archive_but_never_changes_active_native_history(self):
        params, source, _plan, compact = self.protected_compaction_fixture()
        self.compaction_commit = False
        refused = self.request("agent.compact", compact)
        self.assertFalse(refused["compacted"], "A revoked host owner reached native history mutation")
        self.assertEqual(refused["protection"]["status"], "REFUSED")
        self.assertEqual(refused["protection"]["reason"], "HOST_REVOKED")
        self.assertIn("$context.compaction.commit", self.host_calls)
        self.assertEqual(self.request("agent.history", {})["messages"], source["messages"])
        self.assertEqual(json.loads(Path(params["sessionPath"]).read_text(encoding="utf8"))["messages"], source["messages"])
        archive = Path(params["sessionPath"] + ".history-" + source["historySha256"] + ".json")
        self.assertEqual(json.loads(archive.read_text(encoding="utf8")), source["messages"])

    def test_completed_approved_write_reaches_original_post_edit_and_automatic_stop_gate(self):
        self.hello()
        project = Path(self.tmp.name) / "project"
        project.mkdir()
        path = project / "App.tsx"
        path.write_text('export const App = () => <button>Continue</button>;\n', encoding="utf-8")
        params = {"ctx": {"threadId": "approved-write", "runId": "prepare", "epoch": 1}, "sessionId": "approved-write", "modelId": "fixture-model", "accountId": None, "prompt": "PLAIN_REPLY_ONLY", "hostTools": [], "maxIterations": 4, "skillPolicy": {"enabled": False}, "sessionPath": self.session_path("approved-write"), "integrations": {"enabled": ["impeccable"]}, "projectRoot": str(project)}
        self.request("agent.start", params)
        first = self.until_settled()
        self.assertFalse(any(frame.get("event") == "integration_hook" for frame in first))
        origin = {**params["ctx"], "sessionPath": params["sessionPath"], "modelId": params["modelId"], "accountId": None, "projectId": "project", "workspaceId": "workspace", "projectRoot": str(project)}
        params["ctx"] = {"threadId": "approved-write", "runId": "receipt", "epoch": 2}
        params["inputIds"] = ["operation-result:approved"]
        receipt = {"operationId": "approved", "revision": 1, "inputId": params["inputIds"][0], "origin": origin, "delivery": params["ctx"], "path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}
        params["completedWrites"] = [receipt]
        self.request("agent.start", params)
        events = self.until_settled()
        diagnostics = [frame["data"]["diagnostic"] for frame in events if frame.get("event") == "write_hook"]
        self.assertEqual([row["status"] for row in diagnostics], ["applied"], events)
        executions = [frame["data"] for frame in events if frame.get("event") == "integration_hook"]
        self.assertEqual([(row["event"], row["exitCode"]) for row in executions], [("PostToolUse", 0), ("Stop", 0)])
        self.assertEqual(events[-1]["data"]["engineClass"], "run_agent.AIAgent")
        # Reusing the delivery batch in another turn must not re-run a write hook.
        params["ctx"] = {"threadId": "approved-write", "runId": "stale", "epoch": 3}
        self.request("agent.start", params)
        replay = self.until_settled()
        self.assertFalse(any(frame.get("event") == "integration_hook" for frame in replay))
        self.assertEqual([frame["data"]["diagnostic"]["status"] for frame in replay if frame.get("event") == "write_hook"], ["stale"])
        # Valid custody with a freshly disabled integration gets an explicit skip.
        params["ctx"] = {"threadId": "approved-write", "runId": "disabled", "epoch": 4}
        receipt["origin"] = {**origin, "runId": "stale", "epoch": 3}
        receipt["delivery"] = params["ctx"]
        params["integrations"] = {"enabled": []}
        self.request("agent.start", params)
        disabled = self.until_settled()
        self.assertEqual([frame["data"]["diagnostic"]["status"] for frame in disabled if frame.get("event") == "write_hook"], ["disabled"])
        self.assertFalse(any(frame.get("event") == "integration_hook" for frame in disabled))

    def test_ten_plain_iterations_launch_the_original_review_fork(self):
        self.hello(review=True, managed_review=True)
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
        self.assertEqual(self.host_calls.count("$background.acquire"), 1)
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

    def test_original_curator_consolidation_reads_then_patches_an_eligible_skill(self):
        self.hello(config={"auxiliary": {"background_review": {"enabled": False}, "curator": {"provider": "harness", "model": "fixture-model"}}})
        document = "---\nname: curator-source\ndescription: Maintain verified source procedures.\n---\n\nCURATOR_ORIGINAL_PROCEDURE\n"
        created = self.request("skills.manage", {"action": "create", "name": "curator-source", "content": document})
        self.assertTrue(created["success"], created)
        adopted = self.request("skills.flags", {"name": "curator-source", "managed": True})
        self.assertTrue(adopted["success"], adopted)
        before = self.request("skills.inspect", {"name": "curator-source"})
        self.assertEqual(before["usage"]["created_by"], "agent")
        self.assertFalse(before["usage"]["pinned"])
        self.assertEqual(before["usage"]["state"], "active")
        owner = {"ctx": {"threadId": "curator", "runId": "curator"}, "modelId": "fixture-model", "hostTools": [], "skillPolicy": {"enabled": True, "allowWrites": True}}
        self.request("agent.start", {**owner, "prompt": "PLAIN_REPLY_ONLY: prepare the retained curator owner."})
        self.until_settled()
        events = []
        self.request("skills.curate", {**owner, "consolidate": True, "brokerURL": "http://127.0.0.1/unused", "jobKey": "fixture-curator"}, events=events)
        state = json.loads((Path(self.tmp.name) / "skills/.curator_state").read_text(encoding="utf8"))
        self.assertIn("last_report_path", state, state)
        report_dir = Path(state["last_report_path"])
        report = json.loads((report_dir / "run.json").read_text(encoding="utf8"))
        requests = [event for event in events if event.get("event") == "model_request"]
        self.assertEqual(len(requests), 3, report)
        self.assertTrue(all(event["ctx"]["phase"] == "background_review" for event in requests), requests)
        expected = document.replace("CURATOR_ORIGINAL_PROCEDURE", "Read the original skill before applying a verified patch.")
        path = Path(self.tmp.name) / "skills/curator-source/SKILL.md"
        self.assertEqual(path.read_text(encoding="utf8"), expected)
        self.assertEqual(self.request("skills.inspect", {"name": "curator-source"})["document"], expected)
        self.assertIsNone(report["llm_error"], report)
        self.assertEqual(report["model"], "fixture-model")
        self.assertEqual(report["provider"], "harness")
        self.assertEqual(report["llm_final"], "Curator source review completed.")
        self.assertEqual([call["name"] for call in report["tool_calls"]], ["skill_view", "skill_manage"])
        self.assertEqual(json.loads(report["tool_calls"][0]["arguments"]), {"name": "curator-source"})
        self.assertEqual(json.loads(report["tool_calls"][1]["arguments"])["action"], "patch")
        self.assertEqual(report["tool_call_counts"], {"skill_view": 1, "skill_manage": 1})
        self.assertIn("llm: Curator source review completed.", state["last_run_summary"])
        self.assertNotIn("LLM pass error", (report_dir / "REPORT.md").read_text(encoding="utf8"))

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
