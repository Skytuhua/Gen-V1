"""Fixed, checksum-admitted upstream skills/hooks; no ambient plugin discovery.

The original algorithms stay in their vendored modules. This adapter supplies
host scope, edit-tool aliases, compaction recovery and owned process teardown.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from types import SimpleNamespace

IDS = frozenset({"humanizer", "emil", "impeccable", "graphify", "promptfoo", "biome", "superpowers", "spec-kit", "context7", "ponytail"})
MODES = frozenset({"off", "lite", "full", "ultra"})
BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for hermes"
WRITE_ALIASES = {"file_write": "write_file", "file_patch": "patch", "file_edit": "patch", "apply_patch": "patch"}


def _file(root: Path, name: str) -> Path:
    if not name or "\\" in name or ":" in name or any(part in {"", ".", ".."} for part in name.split("/")):
        raise ValueError("Invalid bundled integration path")
    path = root.joinpath(*name.split("/"))
    if not path.resolve().is_relative_to(root.resolve()):
        raise PermissionError("Bundled integration leaves its immutable root")
    for node in [path, *path.parents]:
        if node == root.parent:
            break
        info = node.lstat()
        if node.is_symlink() or getattr(info, "st_file_attributes", 0) & 0x400:
            raise PermissionError("Linked bundled integrations are forbidden")
    if path.stat().st_nlink != 1:
        raise PermissionError("Hard-linked bundled integration is forbidden")
    return path


class BundledIntegrations:
    def __init__(self, root: Path, home: Path):
        from hermes_cli.plugins import get_plugin_manager
        self.root, self.home = Path(root).resolve(), Path(home).resolve()
        self.manifest = json.loads(_file(self.root, "third-party/integrations/manifest.json").read_text(encoding="utf-8"))
        self.definitions = {item["id"]: item for item in self.manifest["integrations"]}
        if set(self.definitions) != IDS:
            raise PermissionError("Bundled integration registry differs from the allowlist")
        self.manager = get_plugin_manager()
        # This manager is populated below from exact admitted modules only.
        self.manager._discovered = True
        self.modules, self.handles, self.enabled = {}, {}, set()
        self.condition = threading.Condition(threading.RLock())
        self.active, self.processes = {}, {}
        self.project_root = str(self.home / "workspace")
        self.mode = "full"
        self.disposed = False
        self.completed_writes = None
        self.write_transform = None
        self.engine_context = threading.local()
        self.on_hook_execution = None
        self.hook_owner_guard = None

    def bind_completed_writes(self, agent, receipts, guard, report):
        """Private host admission, consumed once after Hermes resets its turn ledger."""
        with self.condition:
            self.completed_writes = (agent, receipts, guard, report)
            self.hook_owner_guard = guard

    def _completed_write_context(self, **kwargs):
        with self.condition:
            batch, self.completed_writes = self.completed_writes, None
        if batch is None:
            return None
        agent, receipts, guard, report = batch
        deadline = time.monotonic() + 20
        findings = []
        for receipt in receipts:
            diagnostic = {key: receipt.get(key) for key in ("operationId", "revision", "inputId")}
            status, message = "stale", "The completed write no longer matches its source owner."
            try:
                origin, delivery = receipt["origin"], receipt["delivery"]
                if not guard() or kwargs.get("session_id") != agent.session_id or kwargs.get("task_id") != delivery["runId"] or kwargs.get("model") != origin["modelId"]:
                    raise PermissionError(message)
                if "impeccable" not in self.enabled or self.disposed:
                    status, message = "disabled", "Impeccable is disabled."
                    raise PermissionError(message)
                path, root = Path(receipt["path"]), Path(origin["projectRoot"])
                if not path.is_absolute() or not root.is_absolute() or root.resolve() != Path(self.project_root).resolve() or not path.resolve().is_relative_to(root.resolve()):
                    raise PermissionError(message)
                for node in (path, *path.parents):
                    info = node.lstat()
                    if node.is_symlink() or getattr(info, "st_file_attributes", 0) & 0x400:
                        raise PermissionError(message)
                info = path.stat()
                if not path.is_file() or info.st_nlink != 1 or info.st_size != receipt["bytes"] or info.st_size > 32 * 1024 * 1024:
                    raise PermissionError(message)
                digest = hashlib.sha256()
                with path.open("rb") as stream:
                    while chunk := stream.read(1024 * 1024):
                        if time.monotonic() >= deadline:
                            raise TimeoutError("The completed-write batch reached its deadline")
                        if not guard():
                            raise PermissionError(message)
                        digest.update(chunk)
                if time.monotonic() >= deadline:
                    raise TimeoutError("The completed-write batch reached its deadline")
                if digest.hexdigest() != receipt["sha256"] or not guard():
                    raise PermissionError(message)
                result = json.dumps({"bytes_written": receipt["bytes"], "resolved_path": str(path), "sha256": receipt["sha256"]})
                # Seed the ORIGINAL ledger before the slow native detector; Stop uses it.
                agent._record_file_mutation_result("write_file", {"path": str(path)}, result, False, task_id=delivery["runId"])
                self.engine_context.guard, self.engine_context.deadline, self.engine_context.proof = guard, deadline, None
                transformed = self.write_transform(tool_name="write_file", args={"path": str(path)}, result=result, session_id=agent.session_id)
                proof = self.engine_context.proof
                if not guard():
                    raise PermissionError(message)
                status = "applied" if proof and proof["exitCode"] == 0 else "failed"
                message = "Original PostToolUse engine exited successfully." if status == "applied" else "The original callback did not confirm a successful native hook."
                if isinstance(transformed, str):
                    text = json.loads(transformed).get("impeccable")
                    if isinstance(text, str):
                        findings.append(text[:16000])
            except PermissionError:
                pass
            except Exception:
                status, message = "failed", "The post-edit hook failed; the approved write remains succeeded."
            finally:
                self.engine_context.guard = None
                self.engine_context.deadline = None
            report({**diagnostic, "status": status, "message": message})
        return {"context": "\n\n".join(findings)[:16000]} if findings else None

    def cancel_hook_processes(self):
        with self.condition:
            self.completed_writes = None
            for process in list(self.processes.values()):
                self._stop_process(process)

    def _verify(self, item):
        for file in item["files"]:
            data = _file(self.root, file["path"]).read_bytes()
            if len(data) != file["bytes"] or hashlib.sha256(data).hexdigest() != file["sha256"]:
                raise PermissionError("Bundled integration checksum mismatch: " + file["path"])

    def _import(self, ident, relative):
        path = _file(self.root, relative)
        name = "_harness_bundled_" + ident.replace("-", "_") + "_" + hashlib.sha256(str(self.home).encode()).hexdigest()[:12]
        spec = importlib.util.spec_from_file_location(name, path)
        if spec is None or spec.loader is None:
            raise RuntimeError("Cannot import admitted bundled integration")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        self.modules[ident] = module
        return module

    def _guarded(self, ident, name, callback):
        def invoke(**kwargs):
            with self.condition:
                if ident not in self.enabled or self.disposed:
                    return None
                self.active[ident] = self.active.get(ident, 0) + 1
            try:
                if ident == "superpowers" and name == "pre_llm_call":
                    history = kwargs.get("conversation_history") or []
                    if any(isinstance(message, dict) and BOOTSTRAP_MARKER in str(message.get("api_content", message.get("content", ""))) for message in history):
                        return None
                    kwargs["is_first_turn"] = True
                if ident == "impeccable" and name == "transform_tool_result":
                    kwargs["tool_name"] = WRITE_ALIASES.get(kwargs.get("tool_name"), kwargs.get("tool_name"))
                return callback(**kwargs)
            finally:
                with self.condition:
                    self.active[ident] -= 1
                    self.condition.notify_all()
        return invoke

    def _stop_process(self, process):
        if process.poll() is not None:
            return
        if os.name == "nt":
            subprocess.run([str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/taskkill.exe"), "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            process.kill()

    def _run_engine(self, argv, **kwargs):
        expected = self.root / "third-party/integrations/impeccable/engine/impeccable.exe"
        if argv != [str(expected), "hook"]:
            raise PermissionError("Native hook process is outside the admitted engine")
        timeout = min(float(kwargs.pop("timeout", 30)), 30)
        guard = getattr(self.engine_context, "guard", None)
        deadline = getattr(self.engine_context, "deadline", None)
        if guard and not guard():
            raise PermissionError("The hook owner was cancelled")
        if deadline is not None:
            timeout = min(timeout, deadline - time.monotonic())
            if timeout <= 0:
                raise TimeoutError("The completed-write hook batch reached its deadline")
        data = kwargs.pop("input", None)
        kwargs.pop("capture_output", None)
        state = self.home / "integration-data/impeccable"
        state.mkdir(parents=True, exist_ok=True)
        env = {key: os.environ[key] for key in ("SystemRoot", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATH") if key in os.environ}
        env.update(HOME=str(state), USERPROFILE=str(state), APPDATA=str(state / "roaming"),
                   LOCALAPPDATA=str(state / "local"), XDG_CONFIG_HOME=str(state / "config"),
                   IMPECCABLE_HOOK_HARNESS="hermes")
        kwargs["env"] = env
        kwargs.update(stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        with self.condition:
            if "impeccable" not in self.enabled:
                raise RuntimeError("Impeccable was disabled")
            if self.hook_owner_guard and not self.hook_owner_guard():
                raise PermissionError("The native hook owner was cancelled")
            process = subprocess.Popen(argv, **kwargs)
            self.processes[process.pid] = process
        try:
            stdout, stderr = process.communicate(data, timeout=timeout)
            proof = {"event": json.loads(data)["hook_event_name"], "exitCode": process.returncode}
            self.engine_context.proof = proof
            if self.on_hook_execution:
                self.on_hook_execution(proof)
            return subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)
        except subprocess.TimeoutExpired:
            self._stop_process(process)
            process.communicate()
            raise
        finally:
            with self.condition:
                self.processes.pop(process.pid, None)
                self.condition.notify_all()

    def _load(self, ident):
        from hermes_cli.plugins import LoadedPlugin, PluginContext, PluginManifest
        item = self.definitions[ident]
        self._verify(item)
        manifest = PluginManifest(name=ident, version=item["version"], source="bundled", path=str(self.root / "third-party/integrations" / ident))
        native = PluginContext(manifest, self.manager)
        handles = self.handles[ident] = []
        owner = self

        class Context:
            def register_skill(self, name, path, **kwargs):
                path = Path(path).resolve()
                admitted = {str(_file(owner.root, skill["path"]).resolve()) for skill in item["skills"]}
                if str(path) not in admitted:
                    raise PermissionError("Skill was not admitted by the bundled registry")
                handle = native.register_skill(name, path, **kwargs)
                handles.append(handle)
                return handle

            def register_hook(self, name, callback, **kwargs):
                admitted = set(item["capabilities"]["hooks"])
                if ident == "ponytail":
                    admitted.add("pre_gateway_dispatch")
                if name not in admitted:
                    raise PermissionError("Hook was not admitted by the bundled registry")
                handle = native.register_hook(name, owner._guarded(ident, name, callback), **kwargs)
                handles.append(handle)
                if ident == "impeccable" and name == "transform_tool_result":
                    owner.write_transform = callback
                return handle

            def register_command(self, name, callback, **kwargs):
                if name not in item["capabilities"]["commands"]:
                    raise PermissionError("Command was not admitted by the bundled registry")
                handle = native.register_command(ident + ":" + name, callback, **kwargs)
                handles.append(handle)
                return handle

            def inject_message(self, *_args, **_kwargs):
                return False  # The host owns user-message admission.

            def session_cwd(self):
                return owner.project_root

        context = Context()
        module = None
        if ident == "superpowers":
            module = self._import(ident, "third-party/integrations/superpowers/.hermes-plugin/__init__.py")
            module.register(context)
        elif ident == "ponytail":
            module = self._import(ident, "third-party/integrations/ponytail/__init__.py")
            module._current_mode = self.mode
            module.register(context)
        else:
            for skill in item["skills"]:
                context.register_skill(skill["name"], _file(self.root, skill["path"]), description=skill["description"])
            if ident == "impeccable":
                module = self._import(ident, "third-party/integrations/impeccable/hook/__init__.py")
                module._find_launcher = lambda _start: str(self.root / "third-party/integrations/impeccable/engine/impeccable.exe")
                module.subprocess = SimpleNamespace(run=self._run_engine)
                module.register(context)
                handles.append(native.register_hook("pre_llm_call", self._guarded(ident, "pre_llm_call", self._completed_write_context)))
        self.manager._plugins[ident] = LoadedPlugin(manifest=manifest, module=module, enabled=True)

    def refresh(self, config: dict, project_root: str | None = None):
        if not isinstance(config, dict) or set(config) - {"enabled", "ponytailMode"}:
            raise ValueError("Invalid admitted integration configuration")
        enabled = config.get("enabled", [])
        if not isinstance(enabled, list) or any(item not in IDS for item in enabled) or len(set(enabled)) != len(enabled):
            raise ValueError("Invalid admitted integration identifiers")
        mode = config.get("ponytailMode", "full")
        if mode not in MODES:
            raise ValueError("Invalid Ponytail mode")
        if project_root is not None and not Path(project_root).is_absolute():
            raise ValueError("Integration project scope must be absolute")
        requested = set(enabled)
        with self.condition:
            if self.disposed:
                raise RuntimeError("Bundled integrations disposed")
            removed = self.enabled - requested
            self.enabled = requested
            self.mode = mode
            if project_root:
                self.project_root = str(Path(project_root).resolve())
            for ident in removed:
                for handle in reversed(self.handles.pop(ident, [])):
                    if handle is not None:
                        handle.dispose()
                self.manager._plugins.pop(ident, None)
            if "impeccable" in removed:
                batch, self.completed_writes = self.completed_writes, None
                if batch:
                    for receipt in batch[1]:
                        batch[3]({**{key: receipt.get(key) for key in ("operationId", "revision", "inputId")}, "status": "disabled", "message": "Impeccable was disabled before its post-edit callback."})
                for process in list(self.processes.values()):
                    self._stop_process(process)
            deadline = time.monotonic() + 35
            while any(self.active.get(ident, 0) for ident in removed):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError("Native integration hook has not drained")
                self.condition.wait(min(remaining, 0.2))
            for ident in sorted(requested):
                if ident not in self.handles:
                    try:
                        self._load(ident)
                    except Exception:
                        self.enabled.discard(ident)
                        for handle in reversed(self.handles.pop(ident, [])):
                            if handle is not None:
                                handle.dispose()
                        raise
            if "ponytail" in self.modules:
                self.modules["ponytail"]._current_mode = mode
        return {"enabled": sorted(self.enabled), "ponytailMode": self.mode}

    def assert_mutable(self, args: dict):
        for entry in args.get("operations", [args]):
            name = str(entry.get("name", args.get("name", ""))) if isinstance(entry, dict) else ""
            if name.removeprefix("plugin:").partition(":")[0] in IDS and ":" in name:
                raise PermissionError("Bundled integration skills are immutable")

    def owns_skill(self, name: str) -> bool:
        return isinstance(name, str) and ":" in name and name.removeprefix("plugin:").partition(":")[0] in IDS

    def local_skill_view(self, name: str, file_path=None, task_id=None):
        if not self.owns_skill(name):
            raise PermissionError("Skill is outside the admitted integration namespaces")
        namespace = name.removeprefix("plugin:").partition(":")[0]
        with self.condition:
            if namespace not in self.enabled:
                return json.dumps({"success": False, "error": "Bundled integration is disabled"})
            # Original plugin-skill path returns before local-skill usage/dependency
            # recording. Preprocessing is explicitly disabled by the host.
            from tools.skills_tool import skill_view
            return skill_view(name, file_path=file_path, task_id=task_id, preprocess=False)

    def local_skill_list(self):
        with self.condition:
            return self.manager.list_plugin_skill_metadata()

    def dispose(self):
        if self.disposed:
            return
        self.refresh({"enabled": [], "ponytailMode": "off"})
        self.disposed = True
