"""Private JSONL host for the unmodified, pinned Hermes engine.

This file supplies transport, host authority and DTO boundaries only. Agent loops,
learning, skill validation/mutation, review, curation and ledgers run upstream.
Launch with Python -I -S -B; dependencies are an explicit isolated target.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import stat
import sys
import threading
import traceback
from types import SimpleNamespace
import uuid
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "third-party/hermes-agent/upstream"
COMMIT = "c627ec84664d43e0b18b95d9d86d8963747d56c7"
MAX_FRAME_BYTES = 32 * 1024 * 1024
class SourceConflictError(RuntimeError):
    code = "STALE_SKILL"
WIRE = sys.stdout
WIRE.reconfigure(encoding="utf-8", errors="strict", newline="\n")
sys.stdin.reconfigure(encoding="utf-8", errors="strict")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
# Upstream console output must never be confused with protocol frames.
sys.stdout = sys.stderr
WRITE_LOCK = threading.Lock()


def emit(frame):
    data = json.dumps(frame, ensure_ascii=False, default=_json_default, allow_nan=False)
    if len(data.encode("utf-8")) > MAX_FRAME_BYTES:
        raise ValueError("Worker response exceeds the 32MiB transport bound")
    with WRITE_LOCK:
        WIRE.write(data + "\n")
        WIRE.flush()


def _json_default(value):
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"Non-JSON source value: {type(value).__name__}")


def parse_result(value):
    return json.loads(value) if isinstance(value, str) else value


class Worker:
    def __init__(self):
        self.ready = False
        self.home = None
        self.agent = None
        self.ctx = None
        self.params = {}
        self.history = []
        self.thread = None
        self.state_lock = threading.RLock()
        self.pending = {}
        self.pending_lock = threading.Lock()
        self.host_names = set()
        self.policy = {}
        self.cancelled = threading.Event()
        self.agent_identity = None
        self.agent_instance = None
        self.followups = {}
        self.native_usage = []
        self.transport_sequence = 0
        self.session_key = None
        self.foreground_active = False
        self.active_owner = False
        self.transport_lock = threading.Lock()
        self.skill_lock = threading.RLock()
        self.home_identity = None

    def guard_home(self):
        """Application namespace guard; original source is not an OS sandbox."""
        if self.home is None:
            return
        for path in [*reversed(self.home.parents), self.home]:
            if os.path.lexists(path):
                self.check_node(path)
        if not self.home.exists():
            return
        info = os.lstat(self.home)
        identity = (info.st_dev, info.st_ino)
        if self.home_identity is not None and identity != self.home_identity:
            raise PermissionError("The owned Hermes home was replaced")
        for directory, directories, files in os.walk(self.home, followlinks=False):
            for name in directories + files:
                self.check_node(Path(directory) / name)

    @staticmethod
    def check_node(path):
        info = os.lstat(path)
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise PermissionError("The Hermes home contains a linked or reparse node")
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise PermissionError("The Hermes home contains a linked file")
        if not stat.S_ISREG(info.st_mode) and not stat.S_ISDIR(info.st_mode):
            raise PermissionError("The Hermes home contains a non-file node")

    def current_ctx(self):
        context = dict(self.ctx or {})
        provenance = sys.modules.get("tools.skill_provenance")
        context["phase"] = "background_review" if provenance and provenance.is_background_review() else "foreground"
        return context

    def event(self, name, data):
        emit({"event": name, "ctx": self.current_ctx(), "data": data})

    def host_call(self, name, args):
        call_id = uuid.uuid4().hex
        result = queue.Queue(maxsize=1)
        with self.pending_lock:
            self.pending[call_id] = result
        try:
            emit({"hostCall": {"id": call_id, "name": name, "args": args, "ctx": self.current_ctx()}})
            while True:
                try:
                    response = result.get(timeout=0.2)
                    if "error" in response:
                        raise RuntimeError(str(response["error"].get("message", "Host call failed")))
                    return response.get("result")
                except queue.Empty:
                    if self.cancelled.is_set():
                        raise RuntimeError("Host call cancelled")
        finally:
            with self.pending_lock:
                self.pending.pop(call_id, None)

    def receive_host_result(self, response):
        with self.pending_lock:
            result = self.pending.get(response.get("id"))
        if result is not None:
            try:
                result.put_nowait(response)
            except queue.Full:
                pass  # Duplicate replies cannot acquire another call's ownership.

    def hello(self, params):
        if self.ready:
            raise RuntimeError("hello is single-use; launch a fresh worker for a new profile")
        home = Path(params["home"])
        if not home.is_absolute():
            raise ValueError("home must be an app-owned absolute path")
        if str(home).startswith(("\\\\", "//")):
            raise PermissionError("Hermes home must be a local app-owned path")
        self.home = Path(os.path.abspath(home))
        self.guard_home()
        self.home.mkdir(parents=True, exist_ok=True)
        self.guard_home()
        info = os.lstat(self.home)
        self.home_identity = (info.st_dev, info.st_ino)
        workspace = self.home / "workspace"
        workspace.mkdir(exist_ok=True)
        os.chdir(workspace)
        os.environ.update({"HERMES_HOME": str(self.home), "HOME": str(self.home), "USERPROFILE": str(self.home),
                           "APPDATA": str(self.home / "roaming"), "LOCALAPPDATA": str(self.home / "local"),
                           "PYTHON_MANAGER_AUTOMATIC_INSTALL": "false",
                           "HERMES_DISABLE_LAZY_INSTALLS": "1", "PYTHONDONTWRITEBYTECODE": "1",
                           "PYTHONIOENCODING": "utf-8"})
        dependencies = Path(params.get("dependencyRoot") or ROOT / ".harness-hermes-python-deps").resolve()
        if not dependencies.is_dir():
            raise RuntimeError("Isolated Hermes dependencies are missing; install runtime-requirements.txt into dependencyRoot")
        sys.path[:0] = [str(dependencies), str(SOURCE)]
        config = copy.deepcopy(params.get("config") or {})
        config.setdefault("security", {})["allow_lazy_installs"] = False
        config.setdefault("skills", {}).update(inline_shell=False, template_vars=False)
        config["skills"]["external_dirs"] = []
        config.setdefault("memory", {}).update(memory_enabled=False, user_profile_enabled=False)
        # Only the host's own tool registry is allowed to reach external resources.
        config["mcp_servers"] = {}
        config["plugins"] = {"enabled": False}
        from agent.safe_worker_policy import _bind_worker_config
        _bind_worker_config(config)
        from agent.acp_client import ACPClient
        from providers.base import ProviderProfile
        from providers import register_provider
        worker = self

        class HostACPClient(ACPClient):
            """Original ACP parsing/session machinery plus actual host usage accounting."""
            def _create_chat_completion(client_self, **kwargs):
                # The native-account broker owns one completion at a time. Keep
                # auxiliary source callers' request/usage frames paired too.
                with worker.transport_lock:
                    return client_self._host_completion(**kwargs)

            def _host_completion(client_self, **kwargs):
                worker.transport_sequence += 1
                sequence = worker.transport_sequence
                input_ids = []
                if worker.current_ctx()["phase"] == "foreground":
                    input_ids.extend(worker.params.get("inputIds") or [])
                    from agent.interrupt_control import _steer_fates
                    fates = _steer_fates(worker.agent) if worker.agent is not None else {}
                    with worker.state_lock:
                        input_ids.extend(ticket for ticket in list(worker.followups) if fates.get(ticket) is True)
                worker.event("model_request", {"inputIds": list(dict.fromkeys(input_ids)), "sequence": sequence})
                response = super()._create_chat_completion(**kwargs)
                usage = worker.host_call("$transport.usage", {"jobKey": worker.params.get("jobKey"), "sequence": sequence}) or {}
                worker.native_usage.append({"sequence": sequence, "phase": worker.current_ctx()["phase"], "usage": usage or None})
                # Absent usage stays unknown at the host. Hermes requires a numeric
                # namespace internally; never emit its compatibility zeros as paid proof.
                if isinstance(usage, dict) and isinstance(usage.get("inputTokens"), int) and isinstance(usage.get("outputTokens"), int):
                    response.usage = SimpleNamespace(prompt_tokens=usage["inputTokens"], completion_tokens=usage["outputTokens"],
                        total_tokens=usage["inputTokens"] + usage["outputTokens"],
                        prompt_tokens_details=SimpleNamespace(cached_tokens=usage.get("cacheReadTokens", 0)))
                return response

            def _handle_server_message(client_self, msg, **kwargs):
                # The bundled ACP server exposes text only. Deny unsolicited ACP
                # filesystem/terminal requests even if a future server changes.
                if "id" in msg and msg.get("method"):
                    process = kwargs.get("process")
                    if process and process.stdin:
                        process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "Host capabilities are not exposed over ACP"}}) + "\n")
                        process.stdin.flush()
                    return True
                return super()._handle_server_message(msg, **kwargs)

        class HarnessProfile(ProviderProfile):
            def create_client(profile_self, **kwargs):
                return HostACPClient(**kwargs)

        self.acp_command = params["acpCommand"]
        self.acp_args = params.get("acpArgs") or []
        register_provider(HarnessProfile(name="harness", auth_type="external_process", api_mode="chat_completions",
            base_url="acp://harness", process_command=self.acp_command, process_args=tuple(self.acp_args),
            supports_streaming=False, supports_health_check=False, supports_model_listing=False))
        from run_agent import AIAgent
        from tools.registry import registry
        self.Agent = AIAgent
        self.registry = registry
        self.source_handlers = {}
        for name in ("skills_list", "skill_view", "skill_manage"):
            entry = registry.get_entry(name)
            if entry is None:
                raise RuntimeError("Original Hermes skill tool missing: " + name)
            self.source_handlers[name] = entry.handler
            def guarded(args, _name=name, **kw):
                return self.skill_tool(_name, args, kw)
            registry.register(name=name, toolset=entry.toolset, schema=entry.schema, handler=guarded, check_fn=entry.check_fn, override=True)
        self.ready = True
        return {"protocolVersion": 1, "sourceCommit": COMMIT, "pythonVersion": sys.version.split()[0],
                "engineClass": "run_agent.AIAgent", "methods": METHODS}

    def guard_skill(self, args, write=False):
        if self.policy.get("enabled") is False:
            raise PermissionError("Skill learning is disabled by the host")
        if write and self.policy.get("allowWrites") is not True:
            raise PermissionError("Skill writes are disabled for this role")
        disabled = set(self.policy.get("disabledNames") or [])
        protected = set(self.policy.get("protectedNames") or [])
        operations = args.get("operations")
        entries = operations if isinstance(operations, list) else [args]
        for entry in entries:
            if not isinstance(entry, dict):
                continue  # Original schema validation owns malformed operations.
            name = entry.get("name") or args.get("name") or ""
            names = {name, name.rsplit("/", 1)[-1]}
            from tools import skill_manager_tool as manager
            found = manager._find_skill(name) if name else None
            target = found["path"].resolve() if found else None
            if target is not None:
                names.add(target.name)
                if target.is_relative_to(self.home / "skills"):
                    names.add(target.relative_to(self.home / "skills").as_posix())
                declared = manager._read_frontmatter_name(target / "SKILL.md")
                if declared:
                    names.add(declared)
            restricted = disabled | (protected if write else set())
            resolved_restricted = any((flagged := manager._find_skill(alias)) and flagged["path"].resolve() == target for alias in restricted) if target else False
            from tools.skill_usage import get_record
            flags = [get_record(alias) for alias in names if alias]
            source_restricted = any(record.get("harness_enabled") is False or write and record.get("harness_protected") is True for record in flags)
            if restricted.intersection(names) or resolved_restricted or source_restricted:
                raise PermissionError("Skill is disabled or protected by the host")

    def skill_tool(self, name, args, kw):
        with self.skill_lock:
            try:
                self.guard_home()
                self.guard_skill(args, write=name == "skill_manage")
                result = self.source_handlers[name](args, **kw)
                self.guard_home()
                if name == "skill_manage":
                    self.event("library", {"reason": "skill_manage", "result": parse_result(result)})
                return result
            except PermissionError as exc:
                return json.dumps({"success": False, "error": str(exc)})

    def check_expected(self, expected):
        from tools import skill_manager_tool as manager
        for name, before in (expected or {}).items():
            if before is None:
                if manager._find_skill(name) is not None:
                    raise SourceConflictError("Source package now exists")
                continue
            current = self.skills("skills.inspect", {"name": name})
            usage = current["usage"]
            actual = {"documentHash": current["fileHashes"].get("SKILL.md"), "fileHashes": current["fileHashes"],
                "enabled": usage.get("harness_enabled", True), "protected": usage.get("harness_protected", False),
                "state": usage.get("state", "active"), "tip": current["versions"][0]["id"] if current["versions"] else None}
            if actual != before:
                raise SourceConflictError("Canonical source changed before the user write")

    def register_host_tools(self, tools):
        for name in self.host_names:
            self.registry.deregister(name)
        self.host_names.clear()
        for value in tools:
            schema = copy.deepcopy(value.get("function", value))
            name = schema["name"]
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]{0,127}", name) or self.registry.get_entry(name) is not None:
                raise ValueError("Host tool name is invalid or collides with Hermes: " + name)
            schema.setdefault("parameters", {"type": "object", "properties": {}})
            def handler(args, _name=name, **kw):
                result = self.host_call(_name, args)
                return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
            self.registry.register(name=name, toolset="harness", schema=schema, handler=handler)
            self.host_names.add(name)

    def start(self, params):
        with self.state_lock:
            self.guard_home()
            if self.active_owner:
                raise RuntimeError("An agent or its review is still active")
            session_key = params.get("sessionPath") or params.get("sessionId") or (params.get("ctx") or {}).get("threadId")
            changed_session = self.session_key != session_key
            if not changed_session and self.history and params.get("accountId") != self.params.get("accountId"):
                raise PermissionError("Source history belongs to another account")
            history = copy.deepcopy(params.get("history", [] if changed_session else self.history))
            if params.get("sessionPath"):
                thread = (params.get("ctx") or {}).get("threadId")
                if not isinstance(thread, str) or not thread:
                    raise ValueError("A sessionPath requires a sealed thread identity")
                expected = self.home / "sessions" / (hashlib.sha256(thread.encode("utf-8")).hexdigest() + ".json")
                if Path(os.path.abspath(params["sessionPath"])) != expected:
                    raise PermissionError("sessionPath must match the app-owned thread session")
                expected.parent.mkdir(exist_ok=True)
            if "history" not in params and params.get("sessionPath") and Path(params["sessionPath"]).is_file() and (self.agent is None or changed_session):
                saved = json.loads(Path(params["sessionPath"]).read_text(encoding="utf-8"))
                if saved.get("format") != "hermes-source-session-v1" or saved.get("sourceCommit") != COMMIT:
                    raise ValueError("Session file is not a pinned Hermes source session")
                ownership = saved.get("ownership")
                if ownership is None and saved.get("identity"):
                    legacy = json.loads(saved["identity"])
                    ownership = self.history_ownership(legacy)
                if ownership != self.history_ownership(params):
                    raise PermissionError("Saved source session belongs to another thread or account")
                history = saved["messages"]
            self.params = dict(params)
            self.ctx = params.get("ctx")
            self.policy = copy.deepcopy(params.get("skillPolicy") or {})
            self.history = history
            self.session_key = session_key
            self.cancelled.clear()
            self.followups = {}
            self.native_usage = []
            # Environment cannot switch while any original source owner is live.
            for name, key in (("HARNESS_HERMES_BROKER_URL", "brokerURL"), ("HARNESS_HERMES_JOB_KEY", "jobKey"), ("HARNESS_HERMES_MODEL_ID", "modelId")):
                if params.get(key):
                    os.environ[name] = str(params[key])
                else:
                    os.environ.pop(name, None)
            self.thread = threading.Thread(target=self.run, args=(params,), name="HermesForeground", daemon=True)
            self.active_owner = True
            # The command acknowledgement precedes every event from this owner.
            return {"accepted": True}

    def run(self, params):
        data = {"engineClass": "run_agent.AIAgent"}
        try:
            # Real source constructor, real source conversation loop and review path.
            self.guard_home()
            identity = self.binding_identity(params)
            if self.agent is None or self.agent_identity != identity:
                if self.agent is not None:
                    self.agent.close()
                self.register_host_tools(params.get("hostTools") or [])
                options = {}
                if "maxIterations" in params:
                    options["max_iterations"] = params["maxIterations"]
                self.agent = self.Agent(provider="harness", api_mode="chat_completions", base_url="acp://harness", api_key="harness-process",
                acp_command=self.acp_command, acp_args=self.acp_args, model=params["modelId"],
                enabled_toolsets=["harness"] + (["skills"] if self.policy.get("enabled") is not False else []),
                quiet_mode=True, verbose_logging=False, skip_context_files=True, load_soul_identity=False, skip_memory=True,
                skip_background_review=self.policy.get("enabled") is False, cwd=str(self.home / "workspace"),
                session_id=str(params.get("sessionId") or (self.ctx or {}).get("threadId") or uuid.uuid4().hex),
                ephemeral_system_prompt=params.get("systemPrompt"),
                reasoning_config={"enabled": params.get("thinkingLevel") not in (None, "off"), "effort": params.get("thinkingLevel") or "medium"},
                event_callback=lambda event, payload: self.event("source", {"name": event, "payload": payload}),
                tool_start_callback=lambda *a, **kw: self.event("tool_start", {"args": a, "kwargs": kw}),
                tool_complete_callback=lambda *a, **kw: self.event("tool_complete", {"args": a, "kwargs": kw}),
                interim_assistant_callback=lambda *a, **kw: self.event("assistant", {"args": a, "kwargs": kw}), **options)
                self.agent_identity = identity
                self.agent_instance = uuid.uuid4().hex
            if self.cancelled.is_set():
                data["cancelled"] = True
                return
            self.agent.background_review_callback = lambda summary: self.event("review", {"summary": summary})
            self.event("started", {"engineClass": "run_agent.AIAgent", "agentInstance": self.agent_instance,
                "itersSinceSkill": self.agent._iters_since_skill, "tools": sorted(self.agent.valid_tool_names)})
            self.foreground_active = True
            try:
                result = self.agent.run_conversation(params.get("prompt", ""), conversation_history=self.history,
                    task_id=str((self.ctx or {}).get("runId") or "harness"))
            finally:
                self.foreground_active = False
            self.history = copy.deepcopy(result.get("messages") or self.agent._last_messages or [])
            data["result"] = result
            data.update(text=result.get("final_response", ""), sessionPath=params.get("sessionPath"),
                usage=[item for item in self.native_usage if item["phase"] == "foreground"], agentInstance=self.agent_instance, itersSinceSkill=self.agent._iters_since_skill)
            self.save_session()
            self.event("foreground_settled", data)
        except Exception as exc:
            data["error"] = {"code": type(exc).__name__, "message": str(exc)}
            traceback.print_exc(file=sys.stderr)
        finally:
            review = getattr(self.agent, "_background_review_run", None) if self.agent else None
            if review is not None:
                self.event("review_started", {})
                if "error" in data:
                    try:
                        from agent.background_review import cancel_background_review_for_live_turn
                        cancel_background_review_for_live_turn(self.agent, message="source foreground failed", tool_reason="source foreground failed")
                    except Exception:
                        traceback.print_exc(file=sys.stderr)
                if not review.request_done.wait(timeout=10):
                    self.event("cleanup_pending", {"reason": "Original review has not confirmed request settlement"})
                    # Retain both this live owner and its account binding. The
                    # host may cancel the process tree; a timeout is not a release.
                    review.request_done.wait()
                self.event("review_settled", {})
            with self.state_lock:
                data["unconsumedInputIds"] = [ticket for ticket in self.followups if self.agent and self.agent.withdraw_steer(ticket)]
                data["usage"] = list(self.native_usage)
                self.event("library", {"reason": "settled"})
                self.active_owner = False
                self.event("settled", data)

    def save_session(self):
        self.guard_home()
        path = self.params.get("sessionPath")
        if path:
            from utils import atomic_json_write
            atomic_json_write(Path(path), {"format": "hermes-source-session-v1", "sourceCommit": COMMIT,
                "identity": self.agent_identity, "sessionId": self.agent.session_id if self.agent else None,
                "ownership": self.history_ownership(self.params),
                "messages": self.history})
            self.guard_home()

    @staticmethod
    def binding_identity(params):
        binding = {key: params.get(key) for key in ("sessionId", "sessionPath", "modelId", "accountId", "thinkingLevel", "hostTools", "skillPolicy", "systemPrompt", "maxIterations")}
        binding["threadId"] = (params.get("ctx") or {}).get("threadId")
        return json.dumps(binding, sort_keys=True)

    @staticmethod
    def history_ownership(params):
        return {"threadId": (params.get("ctx") or {}).get("threadId") or params.get("threadId"),
                "accountId": params.get("accountId"), "sessionPath": params.get("sessionPath"), "sourceCommit": COMMIT}

    def cancel(self):
        self.cancelled.set()
        agent = self.agent
        if agent is not None:
            agent.interrupt("Host cancelled the run", hard_cancel=True)
            from agent.background_review import cancel_background_review_for_live_turn
            cancel_background_review_for_live_turn(agent)
            if getattr(agent, "client", None):
                agent.client.close()
        return {"accepted": True}

    def cancel_background(self):
        agent = self.agent
        if agent is None:
            return {"cancelled": True}
        from agent.background_review import cancel_background_review_for_live_turn
        review = getattr(agent, "_background_review_run", None)
        cancel_background_review_for_live_turn(agent)
        if review is not None and not review.request_done.wait(timeout=10):
            # The source's foreground-priority timeout is not evidence that the
            # host may release a native-account/process owner.
            raise RuntimeError("Background review has not settled; retain its owner")
        return {"cancelled": True}

    def bind_maintenance(self, params, allow_restored=False):
        with self.state_lock:
            if self.active_owner:
                raise RuntimeError("Maintenance requires an idle retained source agent")
            if self.agent is None and allow_restored:
                thread = (params.get("ctx") or {}).get("threadId")
                if not isinstance(thread, str) or not thread:
                    raise PermissionError("Maintenance requires an owned thread")
                expected = self.home / "sessions" / (hashlib.sha256(thread.encode("utf-8")).hexdigest() + ".json")
                if not params.get("sessionPath") or Path(os.path.abspath(params["sessionPath"])) != expected:
                    raise PermissionError("Maintenance source path does not match its thread")
                self.guard_home()
                saved = json.loads(expected.read_text(encoding="utf-8"))
                ownership = saved.get("ownership")
                if ownership is None and saved.get("identity"):
                    ownership = self.history_ownership(json.loads(saved["identity"]))
                if saved.get("sourceCommit") != COMMIT or ownership != self.history_ownership(params):
                    raise PermissionError("Maintenance history belongs to another source owner")
                self.params = dict(params)
                self.ctx = params.get("ctx")
                self.policy = copy.deepcopy(params.get("skillPolicy") or {})
                self.history = saved["messages"]
            elif self.agent is None:
                raise RuntimeError("Compaction requires a retained source agent")
            for key in ("modelId", "accountId", "sessionPath"):
                if params.get(key) != self.params.get(key):
                    raise PermissionError("Maintenance belongs to another source session binding")
            if params.get("ctx") is not None and params["ctx"] != self.ctx:
                raise PermissionError("Maintenance context does not own this source session")
            if not params.get("brokerURL") or not params.get("jobKey"):
                raise ValueError("Maintenance requires a captured native broker owner")
            for name, key in (("HARNESS_HERMES_BROKER_URL", "brokerURL"), ("HARNESS_HERMES_JOB_KEY", "jobKey")):
                self.params[key] = params[key]
                os.environ[name] = str(params[key])
            self.params["inputIds"] = []
            self.followups = {}
            self.native_usage = []
            self.cancelled.clear()
            self.active_owner = True

    def skills(self, method, params, _guard=True):
        if _guard:
            self.guard_home()
        from tools import skills_tool as st, skill_manager_tool as sm, skill_usage as su, skill_ledger as sl, write_approval as wa
        if method == "skills.snapshot":
            catalog = {"skills": st.find_all_skills(skip_disabled=True), "usage": su.load_usage(), "archived": su.list_archived_skill_names()}
            names = {row["name"] for row in catalog["skills"]} | set(catalog["archived"])
            inspections = {}
            for name in sorted(names):
                value = self.skills("skills.inspect", {"name": name}, _guard=False)
                inspections[name] = {key: item for key, item in value.items() if key not in {"document", "content", "frontmatter"}}
            self.guard_home()
            return {"catalog": catalog, "inspections": inspections, "proposals": wa.list_pending(wa.SKILLS)}
        if method == "skills.compose":
            from agent.skill_utils import parse_frontmatter
            from hermes_yaml import safe_dump
            document = params.get("document") or ""
            metadata, previous_body = parse_frontmatter(document)
            body = params.get("content", previous_body)
            if "oldText" in params or "newText" in params:
                if "content" in params or type(params.get("oldText")) is not str or type(params.get("newText")) is not str:
                    raise ValueError("Choose a body rewrite or one complete text patch")
                from tools.fuzzy_match import fuzzy_find_and_replace
                body, count, strategy, error = fuzzy_find_and_replace(previous_body, params["oldText"], params["newText"])
                if error:
                    raise ValueError(error)
            changed = False
            for key in ("name", "description"):
                if key in params and metadata.get(key) != params[key]:
                    metadata[key] = params[key]
                    changed = True
            if document.startswith("---") and not changed:
                prefix = document[:len(document) - len(previous_body)]
                return {"document": prefix + body, "content": body, "frontmatter": metadata}
            return {"document": "---\n" + safe_dump(metadata, sort_keys=False) + "---\n\n" + body, "content": body, "frontmatter": metadata}
        if method == "skills.list":
            return {"skills": st.find_all_skills(skip_disabled=True), "usage": su.load_usage(), "archived": su.list_archived_skill_names()}
        if method == "skills.view":
            return parse_result(st.skill_view(params["name"], file_path=params.get("file_path"), preprocess=False))
        if method == "skills.inspect":
            from agent.skill_utils import parse_frontmatter
            found = sm._find_skill(params["name"])
            if found is None:
                archived = su._match_skill_dir(su._archive_dir().rglob("SKILL.md"), params["name"])
                found = {"path": archived} if archived else None
            versions = sl.list_entries(skill=params["name"])
            revision = sl.get_entry(params["revisionId"]) if params.get("revisionId") else None
            if params.get("revisionId") and (revision is None or revision.get("skill") != params["name"]):
                raise ValueError("Revision does not belong to this skill")
            if revision is not None:
                # Original entries contain changed paths only. This is the UI's
                # read projection of those original blobs, not a new writer.
                state = {}
                for item in reversed(versions):
                    after = {part["path"]: part for part in item.get("after") or []}
                    for part in item.get("before") or []:
                        if part["path"] not in after:
                            state.pop(part["path"], None)
                    state.update(after)
                    if item["id"] == revision["id"]:
                        break
                snapshots = list(state.values())
                main = next((item for item in snapshots if Path(item["path"]).name == "SKILL.md"), None)
                if main is None:
                    raise ValueError("Revision has no after-state SKILL.md")
                directory = Path(main["path"]).parent.resolve()
                if not directory.is_relative_to((self.home / "skills").resolve()):
                    raise PermissionError("Only app-owned skill packages can be inspected")
                data = sl.read_blob(main["sha256"])
                if data is None:
                    raise ValueError("Revision blob is unavailable")
                document = data.decode("utf-8-sig")
                files = [Path(item["path"]).relative_to(directory).as_posix() for item in snapshots]
            elif found is not None:
                directory = found["path"].resolve()
                if not directory.is_relative_to((self.home / "skills").resolve()):
                    raise PermissionError("Only app-owned skill packages can be inspected")
                document = (directory / "SKILL.md").read_text(encoding="utf-8-sig")
                files = [p.relative_to(directory).as_posix() for p in sorted(directory.rglob("*")) if p.is_file() and p.resolve().is_relative_to(directory)]
            else:
                raise ValueError("Skill does not exist")
            metadata, body = parse_frontmatter(document)
            result = {"name": metadata.get("name", params["name"]), "description": metadata.get("description", ""),
                "category": st._get_category_from_path(directory / "SKILL.md"), "document": document, "content": body, "frontmatter": metadata,
                "files": files, "usage": su.get_record(params["name"]), "versions": versions}
            if revision:
                result["fileHashes"] = {Path(item["path"]).relative_to(directory).as_posix(): item["sha256"] for item in snapshots}
            else:
                hashes = {}
                for relative in files:
                    hasher = hashlib.sha256()
                    with (directory / relative).open("rb") as source_file:
                        while chunk := source_file.read(1024 * 1024):
                            hasher.update(chunk)
                    hashes[relative] = hasher.hexdigest()
                result["fileHashes"] = hashes
            if params.get("file_path"):
                target, error = sm._resolve_supporting_file(directory, params["file_path"])
                if error:
                    raise ValueError(error.get("error", "Invalid supporting file"))
                if revision:
                    item = next((item for item in snapshots if Path(item["path"]).resolve() == target.resolve()), None)
                    data = sl.read_blob(item["sha256"]) if item else None
                    if data is None:
                        raise ValueError("Supporting file is absent in this revision")
                    result["fileContent"] = data.decode("utf-8-sig")
                else:
                    result["fileContent"] = target.read_text(encoding="utf-8-sig")
                result["filePath"] = params["file_path"]
            return result
        if method == "skills.stage":
            result = wa.stage_write(wa.SKILLS, params["payload"], summary=params.get("summary", "Imported pending skill write"), origin=params.get("origin", "foreground"))
        elif method == "skills.import":
            # Existing committed host library bytes were already accepted. This
            # explicit migration RPC uses the source's normal approved replay;
            # pending legacy proposals use skills.stage and remain pending.
            result = parse_result(sm.apply_skill_pending(params["payload"]))
        elif method == "skills.manage":
            # This is a direct, authorized user library RPC. Model calls go
            # exclusively through the guarded original registry handler above.
            result = parse_result(sm.apply_skill_pending(params))
        elif method == "skills.flags":
            name = params["name"]
            for key in ("enabled", "protected", "pinned", "archived", "managed", "legacyFresh"):
                if key in params and type(params[key]) is not bool:
                    raise ValueError("Skill flags must be actual booleans")
            legacy = params.get("legacyUsage")
            def stamp(value):
                if value is None:
                    return None
                if type(value) is not str:
                    raise ValueError("Legacy timestamps must be ISO text")
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    raise ValueError("Legacy timestamps require a timezone")
                return parsed.astimezone(timezone.utc)
            if legacy is not None:
                if (type(legacy) is not dict or type(legacy.get("id")) is not str or not legacy["id"]
                        or any(type(legacy.get(key)) is not int or legacy[key] < 0 for key in ("count", "patchCount"))):
                    raise ValueError("Legacy usage must contain verified counters and an import identity")
                for key in ("createdAt", "updatedAt", "lastUsedAt"):
                    stamp(legacy.get(key))
            if any(key in params for key in ("enabled", "protected", "pinned", "legacyUsage")):
                def apply_controls(record):
                    baseline = record.get("harness_pin_baseline")
                    if type(baseline) is not bool:
                        baseline = bool(record.get("pinned", False))
                    if "pinned" in params:
                        baseline = params["pinned"]
                    for key in ("enabled", "protected"):
                        if key in params:
                            record["harness_" + key] = params[key]
                    controlled = record.get("harness_enabled") is False or record.get("harness_protected") is True
                    record["pinned"] = baseline or controlled
                    record["harness_pin_baseline"] = baseline if controlled else None
                    if legacy is not None and not record.get("harness_legacy_usage"):
                        fresh = params.get("legacyFresh") is True
                        for old, new in (("count", "use_count"), ("patchCount", "patch_count")):
                            record[new] = legacy[old] if fresh else max(int(record.get(new) or 0), legacy[old])
                        for old, new, earliest in (("createdAt", "created_at", True), ("lastUsedAt", "last_used_at", False), ("updatedAt", "last_patched_at", False)):
                            if old == "updatedAt" and legacy["patchCount"] == 0:
                                continue
                            previous, incoming = stamp(record.get(new)), stamp(legacy.get(old))
                            if fresh or incoming is not None and (previous is None or (incoming < previous if earliest else incoming > previous)):
                                record[new] = legacy.get(old)
                        record["harness_legacy_usage"] = copy.deepcopy(legacy)
                    return True
                if not su._mutate(name, apply_controls, require_curation_eligible=True):
                    return {"success": False, "message": "Original Hermes usage writer refused the atomic control update"}
            if params.get("managed") is True:
                ok, message = su.adopt_skill(name)
                if not ok:
                    return {"success": False, "message": message}
            if params.get("archived") is True:
                ok, message = su.archive_skill(name)
                result = {"success": ok, "message": message}
            elif params.get("archived") is False:
                ok, message = su.restore_skill(name)
                result = {"success": ok, "message": message}
            else:
                result = {"success": True, "record": su.get_record(name)}
        elif method == "skills.versions":
            return sl.list_entries(skill=params.get("name"), limit=params.get("limit"))
        elif method == "skills.rollback":
            ok, message = sl.rollback_entry(params["id"])
            result = {"success": ok, "message": message}
        elif method == "skills.proposals":
            return wa.list_pending(wa.SKILLS)
        elif method == "skills.decide":
            if type(params.get("approve")) is not bool:
                raise ValueError("Approval must be an explicit boolean")
            if not re.fullmatch(r"[0-9a-f]{8}", params["id"]):
                raise ValueError("Invalid upstream pending identifier")
            pending = wa.get_pending(wa.SKILLS, params["id"])
            if pending is None:
                raise ValueError("Pending source write does not exist")
            if params.get("approve"):
                result = parse_result(sm.apply_skill_pending(pending["payload"]))
                if result.get("success"):
                    wa.discard_pending(wa.SKILLS, params["id"])
            else:
                result = {"success": wa.discard_pending(wa.SKILLS, params["id"])}
        elif method == "skills.curate":
            from agent.curator import run_curator_review, _resolve_review_runtime
            if type(params.get("consolidate", False)) is not bool or type(params.get("dryRun", False)) is not bool:
                raise ValueError("Curation options must be actual booleans")
            if params.get("consolidate"):
                from hermes_cli.config import load_config_readonly
                binding = _resolve_review_runtime(load_config_readonly())
                if binding.provider != "harness" or binding.model != params.get("modelId") or binding.explicit_api_key or binding.explicit_base_url:
                    raise PermissionError("Original curator routing does not match the captured native model")
                self.bind_maintenance(params, allow_restored=True)
                try:
                    result = run_curator_review(synchronous=True, dry_run=params.get("dryRun", False), consolidate=True)
                finally:
                    with self.state_lock:
                        self.active_owner = False
            else:
                result = run_curator_review(synchronous=True, dry_run=params.get("dryRun", False), consolidate=False)
        else:
            raise ValueError("Unknown skills method")
        self.guard_home()
        self.event("library", {"reason": method})
        return result

    def dispatch(self, method, params):
        if method == "hello":
            return self.hello(params)
        if not self.ready:
            raise RuntimeError("hello must succeed before using the worker")
        if method == "learn.prompt":
            from agent.learn_prompt import build_learn_prompt
            return {"prompt": build_learn_prompt(params.get("request", ""))}
        if method.startswith("skills."):
            from tools.skill_ledger import set_ledger_actor, reset_ledger_actor
            def invoke():
                token = set_ledger_actor("user") if method in {"skills.manage", "skills.import", "skills.flags", "skills.rollback", "skills.decide"} else None
                try:
                    self.check_expected(params.get("expected"))
                    return self.skills(method, {key: value for key, value in params.items() if key != "expected"})
                finally:
                    if token is not None:
                        reset_ledger_actor(token)
            if method == "skills.curate" and params.get("consolidate"):
                return invoke()  # The original fork's tool threads acquire skill_lock themselves.
            with self.skill_lock:
                return invoke()
        if method == "agent.start":
            return self.start(params)
        if method == "agent.followUp":
            with self.state_lock:
                if not self.agent or not self.foreground_active:
                    return {"accepted": False}
                ticket = params.get("inputId") or uuid.uuid4().hex
                if ticket in self.followups:
                    raise ValueError("Follow-up input already belongs to this run")
                accepted = bool(self.agent.steer(params["prompt"], ticket=ticket))
                if accepted:
                    self.followups[ticket] = params["prompt"]
                return {"accepted": accepted, "inputId": ticket}
        if method == "agent.cancel":
            return self.cancel()
        if method == "agent.cancelBackground":
            return self.cancel_background()
        if method == "agent.history":
            return {"messages": copy.deepcopy(self.history)}
        if method == "agent.compact":
            self.bind_maintenance(params)
            try:
                self.guard_home()
                if getattr(self.agent, "client", None):
                    self.agent.client.close()
                before = copy.deepcopy(self.history)
                messages, _ = self.agent._compress_context(copy.deepcopy(before), self.agent._cached_system_prompt or "", force=True)
                self.history = messages
                self.save_session()
                return {"messages": messages, "compacted": messages != before, "usage": list(self.native_usage)}
            finally:
                with self.state_lock:
                    self.active_owner = False
        if method == "agent.dispose":
            self.cancel()
            if self.thread and self.thread.is_alive():
                self.thread.join(timeout=10)
            if self.thread and self.thread.is_alive():
                raise RuntimeError("Hermes has not settled; owner must retain its process lease")
            if self.agent:
                self.agent.close()
                self.agent = None
            return {"disposed": True}
        raise ValueError("Unknown worker method: " + method)


METHODS = ["hello", "learn.prompt", "skills.list", "skills.snapshot", "skills.view", "skills.inspect", "skills.compose", "skills.manage", "skills.import", "skills.stage", "skills.flags", "skills.versions", "skills.rollback", "skills.proposals", "skills.decide", "skills.curate", "agent.start", "agent.followUp", "agent.cancel", "agent.cancelBackground", "agent.history", "agent.compact", "agent.dispose"]


def main():
    worker = Worker()
    def serve(request):
        request_id = request.get("id")
        try:
            method = request["method"]
            result = worker.dispatch(method, request.get("params") or {})
            emit({"id": request_id, "result": result})
            if method == "agent.start":
                worker.thread.start()
        except Exception as exc:
            emit({"id": request_id, "error": {"code": getattr(exc, "code", type(exc).__name__), "message": str(exc)}})
    # Keep stdin available to return native tool/usage results while an RPC
    # (curation/compaction/cancellation included) is waiting for actual source work.
    executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="HermesRPC")
    try:
        for line in sys.stdin:
            request_id = None
            try:
                if len(line.encode("utf-8")) > MAX_FRAME_BYTES:
                    raise ValueError("Worker request exceeds 32MiB")
                request = json.loads(line)
                if "hostResult" in request:
                    worker.receive_host_result(request["hostResult"])
                    continue
                request_id = request["id"]
                if request.get("method") == "hello":
                    # Upstream bootstrap legitimately reconfigures Windows stdio.
                    # Do that before another thread blocks reading the same stream.
                    serve(request)
                else:
                    executor.submit(serve, request)
            except Exception as exc:
                emit({"id": request_id, "error": {"code": type(exc).__name__, "message": str(exc)}})
    finally:
        worker.cancelled.set()
        if worker.agent:
            try:
                worker.cancel()
                worker.agent.close()
            except Exception:
                pass
        executor.shutdown(wait=False, cancel_futures=True)


if __name__ == "__main__":
    main()
