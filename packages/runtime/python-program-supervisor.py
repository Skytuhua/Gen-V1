"""Pinned host supervisor. No program source or tool values enter this process.

The guest owns stdin/stdout/stderr only. A separate, non-inherited control fd
lets the host pause its exact pidfd before accepting an untrusted result frame.
The supervisor never executes guest Python or treats stdout as control data.
"""
import json
import os
import resource
import select
import signal
import subprocess
import time

CONTROL_FD = 3
MAX_CONTROL_BYTES = 64 * 1024
_buffer = bytearray()
_pidfd = None
_guest_pid = None
_guest_start = None
_launcher = None


def _send(value):
    data = json.dumps(value, separators=(",", ":")).encode("utf8") + b"\n"
    if len(data) > 8192:
        raise ValueError("Control response too large")
    while data:
        written = os.write(CONTROL_FD, data)
        data = data[written:]


def _receive():
    while True:
        newline = _buffer.find(b"\n")
        if newline >= 0:
            value = json.loads(bytes(_buffer[:newline]))
            del _buffer[:newline + 1]
            if type(value) is not dict or type(value.get("id")) is not str or not 1 <= len(value["id"]) <= 200:
                raise ValueError("Invalid supervisor request")
            return value
        readable, _, _ = select.select([CONTROL_FD] + ([_pidfd] if _pidfd is not None else []), [], [])
        if _pidfd is not None and _pidfd in readable:
            raise RuntimeError("Owned interpreter exited")
        chunk = os.read(CONTROL_FD, min(8192, MAX_CONTROL_BYTES + 1 - len(_buffer)))
        if not chunk:
            raise EOFError()
        _buffer.extend(chunk)
        if len(_buffer) > MAX_CONTROL_BYTES:
            raise ValueError("Supervisor request too large")


def _state(pid=None):
    # /proc belongs to the trusted host supervisor, never to the guest mounts.
    with open("/proc/" + str(_guest_pid if pid is None else pid) + "/stat", encoding="utf8") as handle:
        text = handle.read(8192)
    fields = text[text.rfind(")") + 2:].split()
    if len(fields) < 22:
        raise RuntimeError("Interpreter state unavailable")
    return {"state": fields[0], "parent": int(fields[1]), "threads": int(fields[17]), "start": fields[19]}


def _owned_single_process(state):
    if state["start"] != _guest_start or state["parent"] != _launcher.pid or state["threads"] != 1:
        raise RuntimeError("Interpreter process identity changed")
    root = "/proc/" + str(_guest_pid)
    if os.listdir(root + "/task") != [str(_guest_pid)]:
        raise RuntimeError("Unexpected interpreter threads")
    # This host does not expose task/<pid>/children. Enumerate real /proc stat
    # parent identities instead. As namespace PID 1, all orphan descendants
    # would reparent here. Any unavailable/oversized view fails closed.
    processes = [pid for pid in os.listdir("/proc") if pid.isdigit()]
    if len(processes) > 4096:
        raise RuntimeError("Host process view exceeds the verification bound")
    for pid in processes:
        try:
            child = _state(int(pid))
        except FileNotFoundError:
            continue  # Unrelated host processes may exit during enumeration.
        if child["parent"] == _guest_pid:
            raise RuntimeError("Unexpected interpreter descendants")


def _launch(request):
    global _launcher, _pidfd, _guest_pid, _guest_start
    if set(request) != {"id", "type", "executable", "argv", "cwd"} or request["type"] != "launch":
        raise ValueError("Invalid supervisor launch")
    if (type(request["executable"]) is not str or not request["executable"].startswith("/") or
            type(request["cwd"]) is not str or not request["cwd"].startswith("/") or
            type(request["argv"]) is not list or not 1 <= len(request["argv"]) <= 256 or
            any(type(arg) is not str or len(arg) > 4096 or "\0" in arg for arg in request["argv"])):
        raise ValueError("Invalid supervisor launch paths")
    read_fd, write_fd = os.pipe2(os.O_CLOEXEC)
    try:
        # close_fds excludes CONTROL_FD. The guest can never acknowledge its
        # own pause or ask this supervisor to resume an idle interpreter.
        _launcher = subprocess.Popen([request["executable"], "--info-fd", str(write_fd), *request["argv"]],
            cwd=request["cwd"], env={"LANG": "C.UTF-8"}, stdin=0, stdout=1, stderr=2,
            close_fds=True, pass_fds=(write_fd,))
    finally:
        os.close(write_fd)
    data = bytearray()
    try:
        while True:
            chunk = os.read(read_fd, min(4096, 8193 - len(data)))
            if not chunk:
                raise RuntimeError("Launcher process identity unavailable")
            data.extend(chunk)
            if len(data) > 8192:
                raise ValueError("Launcher metadata too large")
            try:
                info = json.loads(data)
                break
            except json.JSONDecodeError:
                continue
    finally:
        os.close(read_fd)
    if type(info) is not dict or type(info.get("child-pid")) is not int or info["child-pid"] <= 1:
        raise ValueError("Invalid launcher process identity")
    _guest_pid = info["child-pid"]
    _pidfd = os.pidfd_open(_guest_pid)
    _guest_start = _state()["start"]


def _pause():
    # pidfd signaling cannot target a reused numeric PID. SIGSTOP is neither
    # catchable nor blockable by program code. Seccomp denies threads/forks.
    signal.pidfd_send_signal(_pidfd, signal.SIGSTOP)
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        state = _state()
        _owned_single_process(state)
        if state["state"] == "T":
            return
        if state["state"] in ("X", "Z"):
            raise RuntimeError("Interpreter exited while pausing")
        time.sleep(0.002)
    raise RuntimeError("Interpreter stop was not confirmed")


def _resume():
    state = _state()
    _owned_single_process(state)
    if state["state"] != "T":
        raise RuntimeError("Interpreter was not paused at admission")
    signal.pidfd_send_signal(_pidfd, signal.SIGCONT)


def _cleanup():
    if _pidfd is not None:
        try:
            signal.pidfd_send_signal(_pidfd, signal.SIGKILL)
        except ProcessLookupError:
            pass
        finally:
            os.close(_pidfd)
    if _launcher is not None:
        try:
            _launcher.wait(timeout=2)
        except subprocess.TimeoutExpired:
            _launcher.kill()
            _launcher.wait(timeout=2)


def _main():
    # The interpreter's 128 MiB RLIMIT_AS is a separate guest boundary. This
    # trusted helper also has a fixed ceiling; no whole-executor cap is claimed.
    # The launcher inherits this first ceiling. Lower the supervisor's own cap
    # after fork so the guest can still select its approved ceiling up to 128 MiB.
    resource.setrlimit(resource.RLIMIT_AS, (128 * 1024 * 1024, 128 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    current = None
    try:
        current = _receive()
        _launch(current)
        resource.setrlimit(resource.RLIMIT_AS, (64 * 1024 * 1024, 64 * 1024 * 1024))
        _send({"type": "ack", "id": current["id"]})
        while True:
            current = None
            current = _receive()
            if set(current) != {"type", "id"} or current["type"] not in ("pause", "resume"):
                raise ValueError("Invalid supervisor operation")
            if current["type"] == "pause":
                _pause()
            else:
                _resume()
            _send({"type": "ack", "id": current["id"]})
    except EOFError:
        pass
    except BaseException:
        if current is not None:
            try:
                _send({"type": "error", "id": current["id"]})
            except BaseException:
                pass
        raise
    finally:
        _cleanup()


if __name__ == "__main__":
    try:
        _main()
    except BaseException:
        os._exit(72)
