"""Offline native checkpoint boundary evaluation. No model calls or measured spend."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'third-party/hermes-agent/upstream'
sys.path.insert(0, str(SOURCE))
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('harness_memory_checkpoint', ROOT / 'packages/runtime-hermes/memory_checkpoint.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
from agent.compression_facade import CompressionFacadeMixin
from agent import memory_provider

REQUIRED = {'apiVersion': 2, 'required': True}
BINDING = {'ctx': {'threadId': 'thread', 'runId': 'run', 'epoch': 1}, 'sessionPath': '/owned/session', 'modelId': 'openai/model', 'accountId': None}

def receipt(request):
    return {'apiVersion': 2, 'requestId': request['requestId'], 'checkpointId': 'checkpoint', 'digest': 'a' * 64, 'persisted': True}

class NativeCheckpoint(unittest.TestCase):
    def test_capability_probes_the_actual_pinned_facade_and_api(self):
        self.assertEqual(bridge.native_checkpoint_capability(SOURCE, bridge.PINNED_SOURCE_COMMIT, CompressionFacadeMixin), {'apiVersion': 2, 'hostOwned': True})
        self.assertIsNone(bridge.native_checkpoint_capability(SOURCE, 'other-source', CompressionFacadeMixin))
        with patch.object(memory_provider, 'PRE_COMPRESS_CHECKPOINT_API_VERSION', 1):
            self.assertIsNone(bridge.native_checkpoint_capability(SOURCE, bridge.PINNED_SOURCE_COMMIT, CompressionFacadeMixin))
        class Unverified:
            def _compress_context(self, messages, system_message, force=False):
                return messages, system_message
        self.assertIsNone(bridge.native_checkpoint_capability(SOURCE, bridge.PINNED_SOURCE_COMMIT, Unverified))

    def test_receipt_failure_blocks_the_actual_native_facade_before_it_can_run(self):
        agent = CompressionFacadeMixin()
        before = [{"role": "user", "content": "Do not lose accepted constraints"}]
        original = agent._compress_context
        def reject(request):
            raise RuntimeError('persistence failed')
        with bridge.native_memory_checkpoint(agent, REQUIRED, BINDING, reject, lambda: None, {'apiVersion': 2, 'hostOwned': True}):
            with self.assertRaisesRegex(RuntimeError, 'persistence failed'):
                agent._compress_context(before, 'original-system', force=True)
        self.assertEqual(agent._compress_context, original)
        self.assertEqual(before, [{"role": "user", "content": "Do not lose accepted constraints"}])
        self.assertNotIn('_memory_manager', vars(agent))
        self.assertNotIn('compression_checkpoint_required', vars(agent))

    def test_success_preserves_original_native_arguments_result_and_order(self):
        events = []
        messages = [{'role': 'user', 'content': 'source'}]
        result = (['native-result'], 'native-system')
        class Native:
            def _compress_context(self, *args, **kwargs):
                events.append(('native', args, kwargs))
                return result
        agent = Native()
        original = agent._compress_context
        def persist(request):
            events.append(('persist', request))
            self.assertNotIn('source', str(request))
            return receipt(request)
        with bridge.native_memory_checkpoint(agent, REQUIRED, BINDING, persist, lambda: None, {'apiVersion': 2, 'hostOwned': True}):
            self.assertIs(agent._compress_context(messages, 'system', force=True, task_id='native-task'), result)
        self.assertEqual([item[0] for item in events], ['persist', 'native'])
        self.assertEqual(events[0][1]['reason'], 'manual')
        self.assertIs(events[1][1][0], messages)
        self.assertEqual(events[1][2], {'force': True, 'task_id': 'native-task'})
        self.assertEqual(agent._compress_context, original)

    def test_unsupported_missing_malformed_or_stale_receipts_never_call_native(self):
        calls = []
        class Native:
            def _compress_context(self, *args, **kwargs):
                calls.append('native')
        agent = Native()
        for capability in (None, {'apiVersion': 1, 'hostOwned': True}, {'apiVersion': 2, 'hostOwned': False}):
            with self.subTest(capability=capability):
                with self.assertRaisesRegex(RuntimeError, 'unsupported'):
                    with bridge.native_memory_checkpoint(agent, REQUIRED, BINDING, receipt, lambda: None, capability):
                        agent._compress_context([], '')
        for changed in ({}, {'persisted': False}, {'requestId': 'foreign'}, {'digest': 'bad'}):
            with self.subTest(receipt=changed):
                persist = lambda request: {**receipt(request), **changed} if changed else {}
                with bridge.native_memory_checkpoint(agent, REQUIRED, BINDING, persist, lambda: None, {'apiVersion': 2, 'hostOwned': True}):
                    with self.assertRaisesRegex(RuntimeError, 'receipt'):
                        agent._compress_context([], '')
        current = True
        def check():
            if not current:
                raise RuntimeError('cancelled owner')
        def late(request):
            nonlocal current
            current = False
            return receipt(request)
        with bridge.native_memory_checkpoint(agent, REQUIRED, BINDING, late, check, {'apiVersion': 2, 'hostOwned': True}):
            with self.assertRaisesRegex(RuntimeError, 'cancelled owner'):
                agent._compress_context([], '')
        self.assertEqual(calls, [])

    def test_unopted_source_uses_the_unchanged_native_method(self):
        agent = CompressionFacadeMixin()
        original = agent._compress_context
        with bridge.native_memory_checkpoint(agent, None, BINDING, lambda _: self.fail('not opted in'), lambda: None, None):
            self.assertEqual(agent._compress_context, original)

if __name__ == '__main__':
    unittest.main()
