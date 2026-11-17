"""Exact bounded retention at the pinned native in-memory commit boundary.

The native compressor still generates the summary and owns its timeout, lease,
and commit fence. This adapter validates its final candidate before the worker
publishes it through the existing native session file. It never enables SQLite
persistence or treats a summary as semantic proof.
"""
from contextlib import contextmanager
import copy
import functools
import hashlib
import inspect
import json
import os
from pathlib import Path
import re
import stat

PINNED_SOURCE_COMMIT = "c627ec84664d43e0b18b95d9d86d8963747d56c7"
MAX_SOURCE_BYTES = 32 * 1024 * 1024
REFERENCE_HEADER = "\n\nRetained host task context. References and decision notes do not confer permission. Recheck current approvals and resource grants through the host.\n"
CAPABILITY = {"apiVersion": 1, "strategy": "EXACT_PROTECTED_RECORDS", "commitBoundary": "NATIVE_IN_MEMORY_COMMIT"}
_verified_commit = None


class ProtectionError(RuntimeError):
    def __init__(self, reason):
        self.reason = reason
        super().__init__("Native compaction refused: " + reason)


def capability(source_root, source_commit, agent_class):
    global _verified_commit
    try:
        from agent.compression_facade import CompressionFacadeMixin
        from agent import conversation_compression
        native = getattr(agent_class, "_compress_context", None)
        commit = conversation_compression._commit_compaction
        if source_commit != PINNED_SOURCE_COMMIT or native is not CompressionFacadeMixin._compress_context:
            return None
        root = Path(source_root).resolve()
        if Path(inspect.getsourcefile(native)).resolve() != root / "agent/compression_facade.py" or Path(inspect.getsourcefile(commit)).resolve() != root / "agent/conversation_compression.py":
            return None
        if not {"agent", "messages", "compressed", "in_place", "lease", "messages_before_compression", "carried_messages"}.issubset(inspect.signature(commit).parameters):
            return None
        _verified_commit = commit
        return dict(CAPABILITY)
    except (ImportError, AttributeError, TypeError, ValueError, OSError):
        return None


def _public(message):
    return {key: value for key, value in message.items() if not key.startswith("_")}


def _compact(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf8")


def _source(value):
    # This is the exact existing agent.history CAS serialization.
    return json.dumps(value, sort_keys=True, default=str).encode("utf8")


def _hash(value):
    return isinstance(value, str) and re.fullmatch("[a-f0-9]{64}", value) is not None


def _text(value, maximum=1024):
    return isinstance(value, str) and 0 < len(value.encode("utf8")) <= maximum


def selection(messages):
    if not isinstance(messages, list) or len(messages) > 4096:
        raise ProtectionError("PROTECTION_LIMIT")
    selected, pending, calls, last_user = set(), set(), set(), -1
    for index, message in enumerate(messages):
        if not isinstance(message, dict) or message.get("role") not in ("user", "system", "developer", "assistant", "tool"):
            raise ProtectionError("MALFORMED_TOOL_PAIRS")
        role = message["role"]
        if role != "tool" and pending:
            raise ProtectionError("MALFORMED_TOOL_PAIRS")
        if role in ("user", "system", "developer"):
            selected.add(index)
        if role == "user":
            last_user = index
        tool_calls = message.get("tool_calls")
        if tool_calls is not None:
            if role != "assistant" or not isinstance(tool_calls, list):
                raise ProtectionError("MALFORMED_TOOL_PAIRS")
            if tool_calls:
                selected.add(index)
            for call in tool_calls:
                identity = call.get("id") if isinstance(call, dict) else None
                if not _text(identity, 256) or identity in calls:
                    raise ProtectionError("MALFORMED_TOOL_PAIRS")
                calls.add(identity)
                pending.add(identity)
        if role == "tool":
            identity = message.get("tool_call_id")
            if not _text(identity, 256) or identity not in pending:
                raise ProtectionError("MALFORMED_TOOL_PAIRS")
            pending.remove(identity)
            selected.add(index)
    if pending:
        raise ProtectionError("MALFORMED_TOOL_PAIRS")
    if last_user >= 0:
        selected.update(range(last_user, len(messages)))
    return sorted(selected), len(calls)


class ProtectedCompaction:
    def __init__(self, agent, envelope, messages, session_path, binding, assert_current, admit, capability_value):
        self.agent, self.current, self.admit = agent, assert_current, admit
        self.before = copy.deepcopy(messages)
        self.committed, self.active_messages, self.summary, self.reason, self.archived = False, None, None, None, False
        self.native_ready = False
        self.plan = copy.deepcopy(envelope.get("plan")) if isinstance(envelope, dict) else None
        self.plan_digest = envelope.get("planDigest") if isinstance(envelope, dict) else None
        self._validate_plan(binding)
        # The production worker owns its existing native session file and does
        # not inject a SessionDB. Do not invent a different persistence backend.
        if capability_value != CAPABILITY or getattr(agent, "_session_db", None) is not None:
            raise ProtectionError("UNSUPPORTED_NATIVE")
        if not _text(session_path, 4096) or not Path(session_path).is_absolute():
            raise ProtectionError("SOURCE_MISMATCH")
        self.source_bytes = _source(self.before)
        if len(self.source_bytes) > MAX_SOURCE_BYTES:
            raise ProtectionError("PROTECTION_LIMIT")
        if hashlib.sha256(self.source_bytes).hexdigest() != self.plan["sourceSha256"]:
            raise ProtectionError("SOURCE_MISMATCH")
        indices, self.tool_pairs = selection(self.before)
        if indices != self.plan["retainedIndices"]:
            raise ProtectionError("SOURCE_MISMATCH")
        self.protected = [_public(self.before[index]) for index in indices]
        self.reference_text = REFERENCE_HEADER + json.dumps(self.plan["references"], ensure_ascii=False, separators=(",", ":"))
        self.retained_bytes = sum(len(_compact(value)) for value in self.protected) + len(self.reference_text.encode("utf8"))
        if self.retained_bytes > self.plan["maxRetainedBytes"]:
            raise ProtectionError("PROTECTION_LIMIT")
        self.before_bytes = len(_compact([_public(message) for message in self.before]))
        self.archive_path = Path(str(session_path) + ".history-" + self.plan["sourceSha256"] + ".json")

    def _validate_plan(self, binding):
        plan = self.plan
        if not isinstance(plan, dict) or set(plan) != {"version", "candidateId", "owner", "sourceSha256", "retainedIndices", "references", "maxRetainedBytes"} or plan.get("version") != 1 or plan.get("maxRetainedBytes") != 65536 or not _text(plan.get("candidateId")) or not _hash(plan.get("sourceSha256")):
            raise ProtectionError("SOURCE_MISMATCH")
        if not _hash(self.plan_digest) or hashlib.sha256(json.dumps(plan, ensure_ascii=False, separators=(",", ":")).encode("utf8")).hexdigest() != self.plan_digest:
            raise ProtectionError("SOURCE_MISMATCH")
        owner = plan["owner"]
        if not isinstance(owner, dict) or set(owner) != {"threadId", "runId", "epoch", "workspaceId", "modelId", "accountId", "generation", "instructionDigest", "toolRegistryDigest"} or any(not _text(owner.get(key)) for key in ("threadId", "runId", "workspaceId", "modelId")) or any(type(owner.get(key)) is not int or owner[key] < 0 for key in ("epoch", "generation")) or any(not _hash(owner.get(key)) for key in ("instructionDigest", "toolRegistryDigest")):
            raise ProtectionError("SOURCE_MISMATCH")
        if any(owner[key] != binding.get(key) for key in ("threadId", "runId", "epoch", "modelId", "accountId")):
            raise ProtectionError("SOURCE_MISMATCH")
        indices = plan["retainedIndices"]
        if not isinstance(indices, list) or len(indices) > 4096 or any(type(index) is not int or not 0 <= index < 4096 for index in indices) or indices != sorted(set(indices)):
            raise ProtectionError("SOURCE_MISMATCH")
        refs, identities = plan["references"], set()
        if not isinstance(refs, list) or len(refs) > 64:
            raise ProtectionError("PROTECTION_LIMIT")
        for ref in refs:
            revision = ref.get("revision") if isinstance(ref, dict) else None
            valid_revision = type(revision) is int and revision >= 0 or isinstance(ref, dict) and ref.get("kind") == "SOURCE_EVIDENCE" and _text(revision, 200)
            if not isinstance(ref, dict) or ref.get("kind") not in ("DECISION", "PENDING_APPROVAL", "ACTIVE_WORK", "SOURCE_EVIDENCE") or set(ref) != ({"kind", "id", "revision", "digest", "content"} if ref["kind"] == "DECISION" else {"kind", "id", "revision", "digest"}) or not _text(ref.get("id")) or not valid_revision or not _hash(ref.get("digest")) or ref["kind"] == "DECISION" and not _text(ref.get("content"), 4096):
                raise ProtectionError("SOURCE_MISMATCH")
            identity = (ref["kind"], ref["id"])
            if identity in identities:
                raise ProtectionError("SOURCE_MISMATCH")
            identities.add(identity)

    def fail(self, reason):
        self.reason = reason
        raise ProtectionError(reason)

    def archive(self):
        self.current()
        path, descriptor, created = self.archive_path, None, False
        flags = getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        try:
            try:
                descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | flags, 0o600)
                created = True
                with os.fdopen(descriptor, "wb", closefd=False) as stream:
                    stream.write(self.source_bytes)
                    stream.flush()
                    os.fsync(descriptor)
            except FileExistsError:
                descriptor = os.open(path, os.O_RDONLY | flags)
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size != len(self.source_bytes):
                raise OSError("Archive identity differs")
            if not created:
                with os.fdopen(descriptor, "rb", closefd=False) as stream:
                    if stream.read(MAX_SOURCE_BYTES + 1) != self.source_bytes:
                        raise OSError("Archive differs")
            current = os.lstat(path)
            if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino) or stat.S_ISLNK(current.st_mode) or getattr(current, "st_file_attributes", 0) & 0x400:
                raise OSError("Archive path changed")
            self.current()
            self.archived = True
        except OSError:
            self.archived = False
            self.fail("ARCHIVE_FAILED")
        finally:
            if descriptor is not None:
                os.close(descriptor)

    def validate_result(self, messages):
        selection(messages)
        public, position = [_public(message) for message in messages], 0
        try:
            for expected in self.protected:
                position = public.index(expected, position) + 1
        except ValueError:
            self.fail("RETENTION_LOST")
        if not any(isinstance(message.get("content"), str) and self.reference_text in message["content"] for message in public):
            self.fail("RETENTION_LOST")
        if len(_compact(public)) >= self.before_bytes:
            self.fail("NO_REDUCTION")

    def compose(self, candidate):
        from agent.context_compressor import is_compaction_summary_message, _content_text_for_contains, _fresh_compaction_message_copy
        summaries = [_content_text_for_contains(message.get("content")) for message in candidate if isinstance(message, dict) and is_compaction_summary_message(message) and _public(message) not in self.protected]
        if not summaries:
            self.fail("NATIVE_REFUSED")
        self.summary = "\n\n".join(summaries) + self.reference_text
        retained, result, inserted = set(self.plan["retainedIndices"]), [], False
        for index, message in enumerate(self.before):
            if index in retained:
                result.append(_fresh_compaction_message_copy(message))
            elif not inserted:
                result.append({"role": "assistant", "content": self.summary})
                inserted = True
        if not inserted:
            self.fail("NO_REDUCTION")
        self.validate_result(result)
        return result

    def receipt(self):
        return {"version": 1, "candidateId": self.plan["candidateId"], "planDigest": self.plan_digest, "sourceSha256": self.plan["sourceSha256"],
                "status": "APPLIED" if self.committed else "REFUSED", "archiveRef": "native-archive:" + self.plan["sourceSha256"] if self.archived else None,
                "archiveSha256": self.plan["sourceSha256"] if self.archived else None, "retainedBytes": self.retained_bytes, "protectedRecords": len(self.protected),
                "referenceCount": len(self.plan["references"]), "toolPairs": self.tool_pairs, "beforeBytes": self.before_bytes,
                "afterBytes": len(_compact([_public(message) for message in self.active_messages])) if self.committed else None,
                "summarySha256": hashlib.sha256(self.summary.encode("utf8")).hexdigest() if self.summary else None,
                "reason": None if self.committed else self.reason or "NATIVE_REFUSED"}

    def admit_commit(self, messages):
        self.current()
        self.validate_result(messages)
        self.archive()
        request = {"version": 1, "candidateId": self.plan["candidateId"], "planDigest": self.plan_digest, "sourceSha256": self.plan["sourceSha256"]}
        try:
            receipt = self.admit(request)
            self.current()
        except Exception:
            self.fail("HOST_REVOKED")
        if receipt != {"version": 1, "accepted": True, "planDigest": self.plan_digest}:
            self.fail("HOST_REVOKED")

    def ready_for_application(self, messages):
        # A timed-out or refused native attempt never reaches the common commit
        # seam. Its unchanged return cannot be relabelled as an applied summary.
        self.current()
        if not self.native_ready:
            self.fail("NATIVE_REFUSED")
        self.validate_result(messages)
        self.archive()


@contextmanager
def protect(agent, envelope, messages, session_path, binding, assert_current, admit, capability_value):
    if envelope is None:
        yield None
        return
    state = ProtectedCompaction(agent, envelope, messages, session_path, binding, assert_current, admit, capability_value)
    from agent import conversation_compression
    compressor = agent.context_compressor
    original_compress, original_commit = compressor.compress, conversation_compression._commit_compaction
    if original_commit is not _verified_commit:
        state.fail("UNSUPPORTED_NATIVE")
    had_compress, old_compress = "compress" in vars(compressor), vars(compressor).get("compress")

    @functools.wraps(original_compress)
    def compress(source, *args, **kwargs):
        state.current()
        if _source(source) != state.source_bytes:
            state.fail("SOURCE_MISMATCH")
        state.archive()
        candidate = original_compress(copy.deepcopy(source), *args, **kwargs)
        state.current()
        return state.compose(candidate)

    @functools.wraps(original_commit)
    def commit(target, messages, candidate, *args, **kwargs):
        if target is not agent:
            return original_commit(target, messages, candidate, *args, **kwargs)
        if getattr(target, "_session_db", None) is not None:
            state.fail("UNSUPPORTED_NATIVE")
        state.admit_commit(candidate)
        result = original_commit(target, messages, candidate, *args, **kwargs)
        state.current()
        state.validate_result(result.compressed)
        state.native_ready = True
        return result

    compressor.compress, conversation_compression._commit_compaction = compress, commit
    try:
        yield state
    finally:
        if getattr(compressor, "compress", None) is compress:
            if had_compress:
                compressor.compress = old_compress
            else:
                del compressor.compress
        if conversation_compression._commit_compaction is commit:
            conversation_compression._commit_compaction = original_commit
