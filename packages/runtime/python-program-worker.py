"""Pinned persistent Python kernel. Every stdout frame is untrusted at the host."""
import importlib.util
import json
import math
import os
import sys
from types import MappingProxyType

MAX_FRAME_BYTES = 8 * 1024 * 1024
MAX_OUTPUT_BYTES = 256 * 1024
_read = os.read
_write = os.write
_exit = os._exit
_input_buffer = bytearray()
_generation = None
_active = None
_globals = {"__name__": "__program__"}


def _read_frame():
    while True:
        newline = _input_buffer.find(b"\n")
        if newline >= 0:
            line = bytes(_input_buffer[:newline])
            del _input_buffer[:newline + 1]
            return json.loads(line)
        chunk = _read(0, min(65536, MAX_FRAME_BYTES + 1 - len(_input_buffer)))
        if not chunk:
            raise EOFError()
        _input_buffer.extend(chunk)
        if len(_input_buffer) > MAX_FRAME_BYTES:
            raise ValueError("Private input frame exceeds its bound")


def _plain(value, depth=0):
    if depth > 64:
        raise ValueError("JSON value is too deep")
    if value is None or type(value) in (bool, int, str):
        return value
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError("Non-finite JSON number")
        return value
    if type(value) in (list, tuple):
        return [_plain(item, depth + 1) for item in value]
    if type(value) in (dict, MappingProxyType):
        if any(type(key) is not str for key in value):
            raise ValueError("JSON object keys must be strings")
        return {key: _plain(item, depth + 1) for key, item in value.items()}
    raise ValueError("Only JSON result values are supported")


def _send(frame):
    encoded = json.dumps(frame, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf8") + b"\n"
    if len(encoded) > MAX_FRAME_BYTES:
        raise ValueError("Private output frame exceeds its bound")
    while encoded:
        written = _write(1, encoded)
        encoded = encoded[written:]


def _identity():
    return {"generation": _generation, "requestId": _active["requestId"]}


def _fatal(code):
    try:
        _send({"type": "error", **_identity(), "code": code})
    finally:
        _exit(70)


def _freeze(value):
    if type(value) is dict:
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if type(value) is list:
        return tuple(_freeze(item) for item in value)
    return value


class _Output:
    encoding = "utf-8"

    def write(self, value):
        if type(value) is not str:
            raise TypeError("Text output requires a string")
        if _active is None:
            return len(value)
        size = len(value.encode("utf8"))
        if _active["outputBytes"] + size > _active["maxOutputBytes"]:
            _fatal("OUTPUT_LIMIT")
        _active["outputBytes"] += size
        # The host counts these bytes and discards their text. No StringIO and
        # no automatic stdout-to-model result path exists.
        for offset in range(0, len(value), 2048):
            _send({"type": "output", **_identity(), "text": value[offset:offset + 2048]})
        return len(value)

    def flush(self):
        pass

    def isatty(self):
        return False


class _Tools:
    def call(self, name, args):
        if type(name) is not str or not name or len(name) > 200 or type(args) not in (dict, MappingProxyType):
            raise ValueError("Invalid tool call")
        stable_key = "call:" + str(_active["callCount"])
        _active["callCount"] += 1
        _send({"type": "call", **_identity(), "stableCallKey": stable_key, "name": name, "args": _plain(args)})
        delivery = _read_frame()
        if (type(delivery) is not dict or delivery.get("type") != "delivery" or
                delivery.get("generation") != _generation or delivery.get("requestId") != _active["requestId"] or
                delivery.get("stableCallKey") != stable_key):
            _fatal("PROGRAM_PROTOCOL")
        if "error" in delivery:
            raise RuntimeError("The host tool did not produce a usable result")
        return delivery.get("value")


def _main():
    global _generation, _active
    init = _read_frame()
    if (type(init) is not dict or set(init) != {"type", "generation", "memoryBytes"} or init["type"] != "init" or
            type(init["generation"]) is not int or init["generation"] < 1):
        raise ValueError("Invalid kernel initialization")
    _generation = init["generation"]
    spec = importlib.util.spec_from_file_location("_m12_confinement", "/m12/confinement.py")
    confinement = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(confinement)
    confinement.install(init["memoryBytes"])
    output = _Output()
    sys.stdout = sys.stderr = sys.__stdout__ = sys.__stderr__ = output
    _send({"type": "ready", "generation": _generation, "protocolVersion": 1})
    while True:
        frame = _read_frame()
        if (type(frame) is not dict or set(frame) != {"type", "generation", "requestId", "source", "inputValues", "maxOutputBytes"} or
                frame["type"] != "execute" or frame["generation"] != _generation or
                type(frame["requestId"]) is not str or not 1 <= len(frame["requestId"]) <= 200 or
                type(frame["source"]) is not str or type(frame["inputValues"]) is not list or
                type(frame["maxOutputBytes"]) is not int or not 0 < frame["maxOutputBytes"] <= MAX_OUTPUT_BYTES):
            raise ValueError("Invalid cell frame")
        _active = {"requestId": frame["requestId"], "maxOutputBytes": frame["maxOutputBytes"], "outputBytes": 0, "callCount": 0}
        _globals.pop("result", None)
        _globals["inputs"] = _freeze(frame["inputValues"])
        _globals["tools"] = _Tools()
        try:
            exec(compile(frame["source"], "<python-program>", "exec"), _globals, _globals)
            value = _plain(_globals.get("result"))
            _send({"type": "result", **_identity(), "value": value})
        except MemoryError:
            _fatal("MEMORY_LIMIT")
        except BaseException:
            # Do not disclose private tool values through tracebacks/messages.
            _send({"type": "error", **_identity(), "code": "PYTHON_ERROR"})
        finally:
            _active = None


if __name__ == "__main__":
    try:
        _main()
    except EOFError:
        pass
    except BaseException:
        _exit(71)
