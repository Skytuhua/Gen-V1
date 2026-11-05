"""Real bundled-source hook verification; no model or network calls."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / ".harness-hermes-python-deps"), str(ROOT / "third-party/hermes-agent/upstream")]
from agent.safe_worker_policy import _bind_worker_config
_bind_worker_config({"plugins": {"enabled": False}, "skills": {"external_dirs": [], "inline_shell": False, "template_vars": False}})
spec = importlib.util.spec_from_file_location("bundled_integration_adapter", ROOT / "packages/integrations/hermes.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="harness-real-integration-hooks-")
        self.home = Path(self.temp.name)
        os.environ["HERMES_HOME"] = str(self.home)
        self.adapter = module.BundledIntegrations(ROOT, self.home)

    def tearDown(self):
        self.adapter.dispose()
        self.temp.cleanup()

    def test_original_bootstrap_recovers_after_compaction_without_duplicate_context(self):
        self.adapter.refresh({"enabled": ["superpowers"]}, str(ROOT))
        first = self.adapter.manager.invoke_hook("pre_llm_call", is_first_turn=True, conversation_history=[])
        self.assertEqual(len(first), 1)
        context = first[0]["context"]
        self.assertIn("superpowers:using-superpowers bootstrap for hermes", context)
        replay = self.adapter.manager.invoke_hook("pre_llm_call", is_first_turn=False, conversation_history=[{"api_content": context}])
        self.assertEqual(replay, [])
        compacted = self.adapter.manager.invoke_hook("pre_llm_call", is_first_turn=False, conversation_history=[{"content": "Summary without bootstrap"}])
        self.assertEqual(compacted, first)
        self.assertIsNotNone(self.adapter.manager.find_plugin_skill("superpowers:brainstorming"))

    def test_original_ponytail_modes_and_disable_revoke_future_hooks_and_skills(self):
        self.adapter.refresh({"enabled": ["ponytail"], "ponytailMode": "lite"}, str(ROOT))
        first = self.adapter.manager.invoke_hook("pre_llm_call", conversation_history=[])
        self.assertIn("level: lite", first[0]["context"])
        self.assertEqual(self.adapter.manager.invoke_hook("pre_llm_call", conversation_history=[{"api_content": first[0]["context"]}]), [])
        compacted = self.adapter.manager.invoke_hook("pre_llm_call", conversation_history=[{"content": "Compacted summary"}])
        self.assertEqual(compacted, first)
        self.adapter.refresh({"enabled": ["ponytail"], "ponytailMode": "ultra"}, str(ROOT))
        switched = self.adapter.manager.invoke_hook("pre_llm_call", conversation_history=[{"api_content": first[0]["context"]}])
        self.assertIn("level: ultra", switched[0]["context"])
        self.adapter.refresh({"enabled": [], "ponytailMode": "off"}, str(ROOT))
        self.assertEqual(self.adapter.manager.invoke_hook("pre_llm_call", conversation_history=[]), [])
        self.assertIsNone(self.adapter.manager.find_plugin_skill("ponytail:ponytail"))

    def test_genuine_skills_keep_sidecars_and_are_immutable(self):
        self.adapter.refresh({"enabled": ["humanizer", "emil", "graphify"]}, str(ROOT))
        skill = self.adapter.manager.find_plugin_skill("emil:animate")
        self.assertTrue((skill.parent / "RECIPES.md").is_file())
        with self.assertRaises(PermissionError):
            self.adapter.assert_mutable({"name": "emil:animate"})
        self.adapter.assert_mutable({"name": "learned-user-skill"})

    def test_original_impeccable_callback_receives_only_successful_host_write_aliases(self):
        self.adapter.refresh({"enabled": ["impeccable"]}, str(ROOT))
        original = self.adapter.modules["impeccable"]
        events = []
        original._run_hook = lambda launcher, cwd, event, timeout: events.append(event) or {"hookSpecificOutput": {"additionalContext": "real hook adapter findings"}}
        result = self.adapter.manager.invoke_hook("transform_tool_result", tool_name="file_write", args={"path": "apps/web/src/App.tsx"}, result=json.dumps({"resolved_path": str(ROOT / "apps/web/src/App.tsx")}), session_id="test")
        self.assertEqual(events[0]["tool_name"], "Write")
        self.assertIn("impeccable", json.loads(result[0]))
        self.adapter.manager.invoke_hook("transform_tool_result", tool_name="file_write", args={"path": "failed.tsx"}, result=json.dumps({"error": "write failed"}), session_id="test")
        self.assertEqual(len(events), 1)
        self.adapter.manager.invoke_hook("pre_verify", session_id="test")
        self.assertEqual(events[-1]["hook_event_name"], "Stop")

    def test_original_impeccable_hooks_invoke_the_real_pinned_engine(self):
        project = self.home / "project"
        project.mkdir()
        path = project / "App.tsx"
        path.write_text('export const App = () => <button>Continue</button>;\n', encoding="utf-8")
        self.adapter.refresh({"enabled": ["impeccable"]}, str(project))
        original = self.adapter.modules["impeccable"]
        run_engine = self.adapter._run_engine
        receipts = []

        def record_engine(argv, **kwargs):
            event = json.loads(kwargs["input"])
            result = run_engine(argv, **kwargs)
            receipts.append((event["hook_event_name"], result.returncode))
            return result

        original.subprocess.run = record_engine
        self.adapter.manager.invoke_hook("transform_tool_result", tool_name="file_patch", args={"path": str(path)}, result=json.dumps({"files_modified": [str(path)]}), session_id="real-engine")
        self.adapter.manager.invoke_hook("pre_verify", session_id="real-engine")
        self.assertEqual(receipts, [("PostToolUse", 0), ("Stop", 0)])
        self.assertEqual(self.adapter.processes, {})

    def write_fixture(self):
        from agent.turn_explainers import TurnExplainersMixin
        project = self.home / "project"
        project.mkdir()
        path = project / "App.tsx"
        path.write_text("export const App = () => <button>Continue</button>;\n", encoding="utf8")
        self.adapter.refresh({"enabled": ["impeccable"]}, str(project))
        agent = SimpleNamespace(session_id="owner", _turn_failed_file_mutations={}, _turn_file_mutation_paths=set())
        agent._record_file_mutation_result = lambda *a, **kw: TurnExplainersMixin._record_file_mutation_result(agent, *a, **kw)
        receipt = {"operationId": "approved", "revision": 1, "inputId": "operation-result:approved", "origin": {"modelId": "model", "projectRoot": str(project)}, "delivery": {"runId": "receipt"}, "path": str(path), "sha256": module.hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}
        return agent, path, receipt

    def test_fail_open_none_is_not_reported_as_success_and_ledger_is_still_original(self):
        agent, path, receipt = self.write_fixture()
        reports = []
        self.adapter.write_transform = lambda **kwargs: None
        self.adapter.bind_completed_writes(agent, [receipt], lambda: True, reports.append)
        self.adapter.manager.invoke_hook("pre_llm_call", session_id="owner", task_id="receipt", model="model")
        self.assertEqual([row["status"] for row in reports], ["failed"])
        self.assertIn(str(path), agent._turn_file_mutation_paths)
        self.adapter.manager.invoke_hook("pre_llm_call", session_id="owner", task_id="receipt", model="model")
        self.assertEqual(len(reports), 1)

    def test_changed_bytes_and_cancelled_owner_do_not_seed_the_original_ledger(self):
        agent, path, receipt = self.write_fixture()
        reports = []
        path.write_text("changed", encoding="utf8")
        self.adapter.bind_completed_writes(agent, [receipt], lambda: True, reports.append)
        self.adapter.manager.invoke_hook("pre_llm_call", session_id="owner", task_id="receipt", model="model")
        self.assertEqual([row["status"] for row in reports], ["stale"])
        self.assertFalse(agent._turn_file_mutation_paths)
        self.adapter.bind_completed_writes(agent, [receipt], lambda: False, reports.append)
        self.adapter.manager.invoke_hook("pre_llm_call", session_id="owner", task_id="receipt", model="model")
        self.assertEqual([row["status"] for row in reports], ["stale", "stale"])
        self.assertFalse(agent._turn_file_mutation_paths)

    def test_late_cancelled_callback_cannot_mutate_a_new_turn_or_report_success(self):
        agent, path, receipt = self.write_fixture()
        reports, entered, release = [], threading.Event(), threading.Event()
        alive = [True]
        def delayed(**kwargs):
            entered.set()
            release.wait(5)
            return None
        self.adapter.write_transform = delayed
        self.adapter.bind_completed_writes(agent, [receipt], lambda: alive[0], reports.append)
        callback = threading.Thread(target=lambda: self.adapter.manager.invoke_hook("pre_llm_call", session_id="owner", task_id="receipt", model="model"))
        callback.start()
        try:
            self.assertTrue(entered.wait(5))
            alive[0] = False
            agent._turn_file_mutation_paths = set()
            self.adapter.cancel_hook_processes()
        finally:
            release.set()
            callback.join(5)
        self.assertFalse(callback.is_alive())
        self.assertFalse(agent._turn_file_mutation_paths)
        self.assertEqual([row["status"] for row in reports], ["stale"])


if __name__ == "__main__":
    unittest.main()
