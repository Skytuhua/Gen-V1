"""Linux x86_64 confinement installed before any program source is evaluated.

The mount namespace is owned by the host's pinned bubblewrap launcher. This
module adds an irreversible syscall allowlist and a hard process address-space
ceiling. It is not a substitute for that namespace or the host's approval.
"""
import ctypes
import errno
import os
import platform
import resource

MAX_MEMORY_BYTES = 128 * 1024 * 1024


class _Filter(ctypes.Structure):
    _fields_ = [("code", ctypes.c_ushort), ("jt", ctypes.c_ubyte),
                ("jf", ctypes.c_ubyte), ("k", ctypes.c_uint)]


class _Program(ctypes.Structure):
    _fields_ = [("length", ctypes.c_ushort), ("filter", ctypes.POINTER(_Filter))]


def install(memory_bytes):
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise RuntimeError("Unsupported Python confinement platform")
    if type(memory_bytes) is not int or not 0 < memory_bytes <= MAX_MEMORY_BYTES:
        raise ValueError("Invalid Python memory ceiling")
    # All setup happens before the filter; the guest cannot change these limits.
    resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
    os.closerange(3, 1024)
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    # File operations see only the explicit namespace mounts. Network, process
    # creation/execution, namespace changes, IPC, ptrace, signals, ioctl, BPF,
    # io_uring, descriptor duplication and resource-limit changes are absent.
    allowed = {
        0, 1, 3, 5, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20,
        21, 23, 24, 25, 26, 27, 28, 35, 39, 60, 63, 74, 75, 76, 77,
        78, 79, 80, 82, 83, 84, 87, 89, 95, 96, 97, 98, 99, 100,
        102, 104, 107, 108, 127, 131, 217, 218, 228, 230, 231, 257,
        258, 262, 263, 264, 267, 269, 270, 271, 273, 280, 285, 295,
        296, 318, 332, 334, 439,
    }
    # Validate audit architecture first, then reject the x32 syscall namespace.
    instructions = [(0x20, 0, 0, 4), (0x15, 1, 0, 0xC000003E),
                    (0x06, 0, 0, 0x80000000), (0x20, 0, 0, 0),
                    (0x35, 0, 1, 0x40000000),
                    (0x06, 0, 0, 0x00050000 | errno.EPERM)]
    for number in sorted(allowed):
        instructions.extend([(0x15, 0, 1, number), (0x06, 0, 0, 0x7FFF0000)])
    instructions.append((0x06, 0, 0, 0x00050000 | errno.EPERM))
    filters = (_Filter * len(instructions))(*(_Filter(*row) for row in instructions))
    program = _Program(len(instructions), filters)
    if libc.prctl(38, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "no_new_privs unavailable")
    if libc.syscall(ctypes.c_long(317), ctypes.c_ulong(1), ctypes.c_ulong(0), ctypes.byref(program)) != 0:
        raise OSError(ctypes.get_errno(), "seccomp filter unavailable")
