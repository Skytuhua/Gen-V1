"""Host-owned pre-compaction receipt gate for the verified native Hermes facade.

This adapter does not install a memory provider, rewrite history, or change native
checkpoint configuration. The exact original compression method runs after receipt.
"""
from contextlib import contextmanager
import copy
import functools
import inspect
from pathlib import Path
import re
import uuid

PINNED_SOURCE_COMMIT = 'c627ec84664d43e0b18b95d9d86d8963747d56c7'


def native_checkpoint_capability(source_root, source_commit, agent_class):
    try:
        from agent.memory_provider import PRE_COMPRESS_CHECKPOINT_API_VERSION
        from agent.compression_facade import CompressionFacadeMixin
        native = getattr(agent_class, '_compress_context', None)
        if source_commit != PINNED_SOURCE_COMMIT or PRE_COMPRESS_CHECKPOINT_API_VERSION != 2:
            return None
        if native is not CompressionFacadeMixin._compress_context:
            return None
        if Path(inspect.getsourcefile(native)).resolve() != Path(source_root).resolve() / 'agent/compression_facade.py':
            return None
        if not {'self', 'messages', 'system_message', 'force', 'commit_fence'}.issubset(inspect.signature(native).parameters):
            return None
        return {'apiVersion': 2, 'hostOwned': True}
    except (ImportError, TypeError, ValueError, OSError):
        return None


def assert_checkpoint_capability(requirement, capability):
    if requirement is None:
        return False
    if not isinstance(requirement, dict) or set(requirement) != {'apiVersion', 'required'} or type(requirement.get('apiVersion')) is not int or requirement.get('apiVersion') != 2 or requirement.get('required') is not True or not isinstance(capability, dict) or set(capability) != {'apiVersion', 'hostOwned'} or type(capability.get('apiVersion')) is not int or capability.get('apiVersion') != 2 or capability.get('hostOwned') is not True:
        raise RuntimeError('Required native memory checkpoint capability is unsupported')
    return True


def _text(value, limit):
    return isinstance(value, str) and 0 < len(value.encode('utf-8')) <= limit


def _binding(value):
    value = copy.deepcopy(value)
    if not isinstance(value, dict) or set(value) != {'ctx', 'sessionPath', 'modelId', 'accountId'}:
        raise RuntimeError('Invalid native checkpoint owner binding')
    ctx = value['ctx']
    if not isinstance(ctx, dict) or set(ctx) != {'threadId', 'runId', 'epoch'} or not _text(ctx['threadId'], 512) or not _text(ctx['runId'], 512) or type(ctx['epoch']) is not int or ctx['epoch'] < 0:
        raise RuntimeError('Invalid native checkpoint context')
    if not _text(value['sessionPath'], 4096) or not _text(value['modelId'], 512) or not (value['accountId'] is None or _text(value['accountId'], 512)):
        raise RuntimeError('Invalid native checkpoint session binding')
    return value


def _receipt(value, request):
    if not isinstance(value, dict) or set(value) != {'apiVersion', 'requestId', 'checkpointId', 'digest', 'persisted'} or value.get('apiVersion') != 2 or value.get('requestId') != request['requestId'] or value.get('persisted') is not True or not _text(value.get('checkpointId'), 256) or not isinstance(value.get('digest'), str) or not re.fullmatch('[a-f0-9]{64}', value['digest']):
        raise RuntimeError('Host did not confirm a matching durable checkpoint receipt')


@contextmanager
def native_memory_checkpoint(agent, requirement, binding, persist, assert_current, capability):
    if not assert_checkpoint_capability(requirement, capability):
        yield
        return
    captured = _binding(binding)
    original = agent._compress_context
    had_override = '_compress_context' in vars(agent)
    previous = vars(agent).get('_compress_context')

    @functools.wraps(original)
    def checked(messages, system_message, *args, **kwargs):
        assert_current()
        request = {**copy.deepcopy(captured), 'apiVersion': 2, 'adapterId': 'hermes', 'requestId': uuid.uuid4().hex,
                   'reason': 'manual' if kwargs.get('force') else 'overflow' if kwargs.get('bypass_cooldown') else 'automatic'}
        value = persist(request)
        assert_current()
        _receipt(value, request)
        return original(messages, system_message, *args, **kwargs)

    agent._compress_context = checked
    try:
        yield
    finally:
        if getattr(agent, '_compress_context', None) is checked:
            if had_override:
                agent._compress_context = previous
            else:
                del agent._compress_context
