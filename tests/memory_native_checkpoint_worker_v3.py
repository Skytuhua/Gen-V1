"""Original pinned Hermes compaction via scripted ACP, offline with unmeasured spend.

The source agent, worker, checkpoint channel and native compactor execute unchanged.
Only model responses and host persistence receipts are supplied by this fixture.
"""
import json
from pathlib import Path
import queue
import unittest
import hermes_source_worker as source_fixture

REQUIRED = {'apiVersion': 2, 'required': True}


class NativeCheckpointWorker(unittest.TestCase):
    def setUp(self):
        source_fixture.WorkerFixture.setUp(self)
        self.checkpoints = []
        self.checkpoint_error = False

    tearDown = source_fixture.WorkerFixture.tearDown
    hello = source_fixture.WorkerFixture.hello
    session_path = source_fixture.WorkerFixture.session_path

    def send(self, method, params):
        self.counter += 1
        self.proc.stdin.write(json.dumps({'id': self.counter, 'method': method, 'params': params}) + '\n')
        self.proc.stdin.flush()
        return self.counter

    def frame(self):
        try:
            return self.frames.get(timeout=30)
        except queue.Empty:
            self.fail('Worker timed out: ' + ''.join(self.stderr[-20:]))

    def answer_host(self, frame):
        call = frame['hostCall']
        self.host_calls.append(call['name'])
        result = {}
        if call['name'] == '$memory.checkpoint':
            self.checkpoints.append(call)
            if self.checkpoint_error:
                result = {'error': {'code': 'PERSISTENCE_DENIED', 'message': 'Durable persistence failed'}}
            else:
                result = {'result': {'apiVersion': 2, 'requestId': call['args']['requestId'], 'checkpointId': 'fixture-checkpoint', 'digest': 'a' * 64, 'persisted': True}}
        else:
            result = {'result': {}}
        self.proc.stdin.write(json.dumps({'hostResult': {'id': call['id'], **result}}) + '\n')
        self.proc.stdin.flush()

    def request(self, method, params, error_code=None, events=None):
        request_id = self.send(method, params)
        while True:
            frame = self.frame()
            if events is not None:
                events.append(frame)
            if 'hostCall' in frame:
                self.answer_host(frame)
            elif frame.get('id') == request_id:
                if error_code:
                    self.assertEqual(frame.get('error', {}).get('code'), error_code, frame)
                    return frame['error']
                self.assertNotIn('error', frame)
                return frame['result']

    def until_settled(self):
        while True:
            frame = self.frame()
            if 'hostCall' in frame:
                self.answer_host(frame)
            if frame.get('event') == 'settled':
                self.assertNotIn('error', frame['data'], frame)
                return frame

    def conversation(self):
        hello = self.hello(config={'compression': {'enabled': True, 'protect_first_n': 0, 'protect_last_n': 4, 'abort_on_summary_failure': True}, 'auxiliary': {'background_review': {'enabled': False}}})
        self.assertEqual(hello['memoryCheckpoint'], {'apiVersion': 2, 'hostOwned': True})
        params = {'ctx': {'threadId': 'memory-native', 'runId': 'first', 'epoch': 1}, 'modelId': 'fixture-model', 'accountId': None, 'prompt': 'PLAIN_REPLY_ONLY',
                  'history': [{'role': 'user' if n % 2 == 0 else 'assistant', 'content': (f'Offline accepted constraint {n}: persistence before compaction. ' * 16)} for n in range(12)],
                  'hostTools': [], 'maxIterations': 2, 'skillPolicy': {'enabled': False}, 'sessionPath': self.session_path('memory-native'), 'memoryCheckpoint': REQUIRED}
        self.assertTrue(self.request('agent.start', params)['accepted'])
        self.until_settled()
        self.host_calls.clear()
        return {**params, 'brokerURL': 'http://127.0.0.1:1', 'jobKey': 'scripted-unused'}

    def test_actual_native_summary_runs_after_the_matching_host_receipt(self):
        params = self.conversation()
        before = self.request('agent.history', {})['messages']
        result = self.request('agent.compact', params)
        self.assertTrue(result['compacted'])
        self.assertEqual(self.host_calls, ['$memory.checkpoint', '$transport.usage', '$transport.observation'])
        self.assertEqual(len(self.checkpoints), 1)
        request = self.checkpoints[0]['args']
        self.assertEqual(request['ctx'], params['ctx'])
        self.assertEqual(request['reason'], 'manual')
        self.assertEqual(request['sessionPath'], params['sessionPath'])
        self.assertNotIn('Offline accepted constraint', json.dumps(request))
        self.assertLess(len(result['messages']), len(before))
        self.assertEqual(json.loads(Path(params['sessionPath']).read_text(encoding='utf-8'))['messages'], result['messages'])

    def test_persistence_failure_prevents_native_inference_and_preserves_exact_history(self):
        params = self.conversation()
        before = self.request('agent.history', {})['messages']
        saved = Path(params['sessionPath']).read_bytes()
        self.checkpoint_error = True
        self.request('agent.compact', params, error_code='RuntimeError')
        self.assertEqual(self.host_calls, ['$memory.checkpoint'])
        self.assertEqual(self.request('agent.history', {})['messages'], before)
        self.assertEqual(Path(params['sessionPath']).read_bytes(), saved)

    def test_cancellation_while_persistence_is_pending_blocks_native_compaction(self):
        params = self.conversation()
        before = self.request('agent.history', {})['messages']
        request_id = self.send('agent.compact', params)
        while True:
            frame = self.frame()
            if 'hostCall' in frame:
                self.assertEqual(frame['hostCall']['name'], '$memory.checkpoint')
                break
            self.assertNotEqual(frame.get('id'), request_id, frame)
        cancel_id = self.send('agent.cancel', {})
        replies = {}
        while request_id not in replies or cancel_id not in replies:
            frame = self.frame()
            self.assertNotIn('hostCall', frame, frame)
            if 'id' in frame:
                replies[frame['id']] = frame
        self.assertEqual(replies[request_id]['error']['code'], 'RuntimeError')
        self.assertTrue(replies[cancel_id]['result']['accepted'])
        self.assertEqual(self.request('agent.history', {})['messages'], before)


if __name__ == '__main__':
    unittest.main()
