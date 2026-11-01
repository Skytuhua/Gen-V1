"""Source custody and original Hermes behavior; no credentials or model calls."""
import hashlib
import importlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / 'third-party' / 'hermes-agent'
SOURCE = VENDOR / 'upstream'
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / '.harness-hermes-python-deps'))
sys.path.insert(0, str(SOURCE))


class OriginalHermesSource(unittest.TestCase):
    def test_every_vendored_file_matches_its_official_blob_and_sha256(self):
        manifest = json.loads((VENDOR / 'UPSTREAM_MANIFEST.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['commit'], 'c627ec84664d43e0b18b95d9d86d8963747d56c7')
        self.assertGreater(len(manifest['files']), 100)
        for item in manifest['files']:
            data = (SOURCE / item['path']).read_bytes()
            self.assertEqual(len(data), item['bytes'], item['path'])
            self.assertEqual(hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest(), item['gitBlob'], item['path'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), item['sha256'], item['path'])

    def test_learn_executes_the_original_function(self):
        module = importlib.import_module('agent.learn_prompt')
        self.assertTrue(Path(module.__file__).resolve().is_relative_to(SOURCE))
        prompt = module.build_learn_prompt('what we just verified')
        self.assertIn('what we just verified', prompt)
        self.assertIn('Hermes', prompt)
        self.assertIn('60 characters', prompt)

    def test_fuzzy_patching_executes_the_original_function(self):
        module = importlib.import_module('tools.fuzzy_match')
        self.assertTrue(Path(module.__file__).resolve().is_relative_to(SOURCE))
        value, count, strategy, error = module.fuzzy_find_and_replace('one\n  two\nthree\n', 'one\n two', 'updated')
        self.assertIsNone(error)
        self.assertEqual(count, 1)
        self.assertIn('updated', value)

    def test_source_batch_limit_remains_twenty(self):
        module = importlib.import_module('tools.skill_manager_batch')
        self.assertTrue(Path(module.__file__).resolve().is_relative_to(SOURCE))
        self.assertEqual(module._BATCH_MAX_OPS, 20)

    def test_original_acp_parser_preserves_object_arguments_without_double_encoding(self):
        module = importlib.import_module('agent.acp_openai_bridge')
        arguments = {'operations': [{'action': 'create', 'name': 'protocol-proof',
                     'content': '# Quoted "source"\n\nPreserve Unicode: café.\n'}]}
        raw = '<tool_call>' + json.dumps({'id': 'proof', 'type': 'function',
              'function': {'name': 'skill_manage', 'arguments': arguments}}, ensure_ascii=False) + '</tool_call>'
        calls, cleaned = module.extract_tool_calls_from_text(raw)
        self.assertEqual(len(calls), 1)
        self.assertEqual(json.loads(calls[0].function.arguments), arguments)
        self.assertEqual(cleaned, '')


if __name__ == '__main__':
    unittest.main()
