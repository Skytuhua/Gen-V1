"""Run the real Worker startup steps without a model or a foreground thread."""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("harness_revocation_worker", ROOT / "packages/runtime-hermes/worker.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IntegrationRevocation(unittest.TestCase):
    def test_disable_survives_both_rpc_startup_orders_and_allows_a_later_enable(self):
        for refresh_first in (False, True):
            with self.subTest(refresh_first=refresh_first), tempfile.TemporaryDirectory(prefix="hermes-revoke-") as home:
                worker = module.Worker()
                worker.ready = True
                worker.home = Path(home)
                worker.event = lambda *_: None
                worker.integrations = SimpleNamespace(refresh=lambda config, _: config)
                captured = {"ctx": {"threadId": "source", "runId": "old", "epoch": 1},
                            "modelId": "openai/scripted", "integrationRevision": 0,
                            "integrations": {"enabled": ["humanizer"], "ponytailMode": "full"}}

                def disable():
                    return worker.dispatch("integrations.refresh", {"config": {"enabled": [], "ponytailMode": "off"},
                        "disabledIds": ["humanizer"], "integrationRevision": 1})

                if refresh_first:
                    self.assertEqual(disable()["enabled"], [])
                self.assertTrue(worker.start(captured)["accepted"])
                self.assertFalse(worker.thread.is_alive())
                if not refresh_first:
                    self.assertEqual(disable()["enabled"], [])
                # Execute run() itself; stop immediately after its integration initialization.
                with patch.object(worker, "binding_identity", side_effect=RuntimeError("fixture initialization complete")), contextlib.redirect_stderr(io.StringIO()):
                    worker.run(captured)
                self.assertEqual(worker.integration_config["enabled"], [])

                later = {**captured, "ctx": {"threadId": "source", "runId": "later", "epoch": 2}, "integrationRevision": 1}
                self.assertTrue(worker.start(later)["accepted"])
                with patch.object(worker, "binding_identity", side_effect=RuntimeError("fixture initialization complete")), contextlib.redirect_stderr(io.StringIO()):
                    worker.run(later)
                self.assertEqual(worker.integration_config["enabled"], ["humanizer"])


if __name__ == "__main__":
    unittest.main()
