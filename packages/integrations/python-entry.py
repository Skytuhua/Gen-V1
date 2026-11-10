"""Allowlisted entrypoints on the shared, relocated Python runtime; never pip."""
from pathlib import Path
import os
import runpy
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
DEPENDENCIES = ROOT / ".harness-integrations-python-deps"
if not DEPENDENCIES.is_dir():
    raise RuntimeError("Bundled integration Python dependencies are missing")
sys.path.insert(0, str(DEPENDENCIES))
# pywin32's wheel normally uses a .pth bootstrap. -I/-S intentionally avoids
# arbitrary .pth execution; admit only its fixed module/DLL directories here.
if os.name == "nt":
    sys.path[:0] = [str(DEPENDENCIES / name) for name in ("win32", "win32/lib", "pythonwin") if (DEPENDENCIES / name).is_dir()]
    _dll_directories = [os.add_dll_directory(str(DEPENDENCIES / "pywin32_system32"))] if (DEPENDENCIES / "pywin32_system32").is_dir() else []

command, *arguments = sys.argv[1:]
if command == "graphify-mcp":
    from graphify.serve import _main
    sys.argv = ["graphify-mcp", *arguments]
    _main()
elif command == "graphify":
    from graphify.__main__ import main
    sys.argv = ["graphify", *arguments]
    main()
elif command == "specify-worker":
    sys.argv = ["specify", *arguments]
    runpy.run_module("specify_cli.mcp_server._worker", run_name="__main__")
elif command == "specify":
    # Upstream's single allowlisted version child must use this same isolated
    # bootstrap: the packaged Python ._pth deliberately ignores PYTHONPATH.
    from specify_cli.mcp_server import executor
    def run_version_child(argv):
        expected = [sys.executable, "-P", "-m", "specify_cli.mcp_server._worker", "version", "--json"]
        if argv != expected:
            raise PermissionError("Unexpected Specify subprocess")
        return subprocess.run([sys.executable, "-I", "-S", "-B", str(Path(__file__).resolve()), "specify-worker", "version", "--json"], check=False, capture_output=True)
    executor._run_cli_process = run_version_child
    from specify_cli import main
    sys.argv = ["specify", *arguments]
    main()
else:
    raise PermissionError("Integration entrypoint is not admitted")
