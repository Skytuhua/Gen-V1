# M12 Python confinement feasibility and backend review

## Current reviewed implementation

Captured on 2026-11-15T11:19:32.920Z after the lifecycle and preflight review fixes. The combined focused command passed 60/60 tests across three files: 23 backend cases, 16 actual M03/Service provider cases, and 21 core lifecycle cases. Core lifecycle cases use explicit synthetic executors. Native backend/provider cases use synthetic operator approval with the actual installed confined process and actual granted file reads. No production approval or feature flag was enabled.

```text
python <tmp>/m12-record-command.py python-native-28-review-regression 90 node node_modules/vitest/vitest.mjs run tests/python-kernel-v3.test.ts tests/python-program-backend-v3.test.ts tests/python-program-integration-v3.test.ts --maxWorkers=1
```

This command exited 0 normally in 23.35 seconds; the Vitest test duration was 22.94 seconds. It covers retained variables, explicit aggregates, private files across reset, actual M02 nested receipts and grants, cancellation, deadlines, confinement failures, forged-completion quiescence, and the new race and preflight regressions. It does not establish the result of the repository-wide typecheck, full unit suite, browser gates, or another platform.

### Runtime and memory scope

The final explicit configuration is `docs/implementation/v3/m12-artifacts/python-runtime-configuration.json`, SHA256 `635a66a02ac9a331c4e9e53d5fd3f54b089ee28d3921f98212f12d667e9f0311`. Its runtime fingerprint is `651716e63d7ded411b8069d1ef4135d60b1b5d97f8723eb77691ad7f4655ff4e`. This equals the last supervised fingerprint because the pinned interpreter, libraries, Python bootstrap and supervisor bytes did not change during the TypeScript lifecycle/preflight repairs. The artifact also records the final TypeScript and test source hashes, so that unchanged runtime fingerprint does not conceal host source changes.

The backend proof now declares `language: PYTHON`, `memoryScope: INTERPRETER_ADDRESS_SPACE`, `memoryLimitBytes: 134217728`, and `wholeExecutorMemoryLimitBytes: null`. The interpreter has an actual hard RLIMIT_AS ceiling of 128 MiB, including native allocations. The trusted supervisor has its own 64 MiB hard RLIMIT_AS after launch; the launcher inherits 128 MiB. There is no whole-executor aggregate memory, cgroup, or RSS proof. Linux x64 on this host is the supported measured platform; other platforms remain unsupported. `operatorApproved` remains false in the captured configuration.

### Reviewed lifecycle fixes

Initial and reset factories must win an exact post-await admission comparison before their executor acquires ownership. Stop, reset, rollback, recovery and exact owner revocation prevent a late factory from resurrecting READY or replacing a newer generation. A rejected late executor is disposed. The language check explicitly rejects a non-Python executor.

A per-owner selection token resolves competing create/reset operations. Cleanup custody remains recorded until the old process and active program have settled, including failed-cell and prepare-error paths. A concurrent later selection can revoke the earlier request, but cannot launch beside an incompletely stopped process. Reset of a previously selected key explicitly selects it exclusively and first stops the current different-key kernel. A shared per-process stop promise prevents repeated lifecycle cleanup from independently stopping the same executor.

The program ID returned by prepare is retained even when the kernel generation changed during authorization. Stop/reset races cancel that late PREPARED projection without dispatching source or altering the newer kernel state. The review cases test both stop and reset during preparation and assert no orphaned PREPARED program remains.

### Bounded cancellable preflight

The private working directory admits at most 4,096 filesystem nodes, including its root at depth zero, and depth at most 32. Directory reads stream through `opendir` with a batch size of 32. Exceeding either bound raises `PYTHON_DIRECTORY_LIMIT`, kills or invalidates the owned worker and prevents next-cell dispatch. A guest-sized whole-directory array is never allocated. The configured runtime tree separately permits at most 10,000 entries and depth 64, with regular runtime files capped at 256 MiB; its fingerprint algorithm retains the previous deterministic ordering.

The exact active cell, closed state, cancellation signal and absolute wall deadline are checked before and after filesystem waits and at file chunks. Teardown aborts runtime hash streams. An already issued operating-system filesystem read may settle after cancellation; it cannot initiate a later traversal step. The native tests have an actual prior cell create the over-limit files/depth. The late-read tests instrument real `lstat` results, hold one completed read, let cancellation or the deadline terminate the cell, then release it and assert no next filesystem read starts. They also assert the next-cell marker was never written.

### Current evidence and source identities

All red attempts are retained. Exit 1 in a red row records the reproduced defect, not a successful boundary proof. The current passing combined log is the final Python result for this source set.

| Evidence | Recorded log | Exit | Log SHA256 |
|---|---|---:|---|
| Late factory admission regressions | `docs/implementation/v3/m12-logs/python-kernel-19-admission-red.log` | 1 | `61a82412adeac4083bd27af95f51739f2f5d7c3c3887715a616656d132b66857` |
| Owner selection race regressions | `docs/implementation/v3/m12-logs/python-kernel-21-owner-races-red.log` | 1 | `859d83827b434ad6f65d4a46368191cc53bf7f1db35c1429b0bab463a8068d9a` |
| Late PREPARED projection regressions | `docs/implementation/v3/m12-logs/python-kernel-22-prepare-red.log` | 1 | `5877601d62fe8f4ef3dd89288d11f864501e30ffa5ebea314fc999a60d306834` |
| Failed-cell teardown custody regressions | `docs/implementation/v3/m12-logs/python-kernel-24-failure-custody-red.log` | 1 | `e0b337883cd9ac7528e940c407ee6165cc9fe1bfb3ca418b165acde365eca659` |
| All kernel lifecycle cases, 21 passed | `docs/implementation/v3/m12-logs/python-kernel-25-custody-green.log` | 0 | `43e9af93c1d92c6a922af2f2a96097ca2d6c862fa1fda041931cd88b76ef585c` |
| Unbounded and lingering scan regressions | `docs/implementation/v3/m12-logs/python-backend-26-preflight-red.log` | 1 | `396c1a42e6a7b01c4a1b2f1c8b8d1fa3002e6e16c37bf621afb6957c27702aa2` |
| Four preflight cases passed | `docs/implementation/v3/m12-logs/python-backend-27-preflight-green.log` | 0 | `55668f4af5fc9dcad0b1968f9de10d1ba054e5af9e5be952b52d8b950f465460` |
| Combined 60 cases passed | `docs/implementation/v3/m12-logs/python-native-28-review-regression.log` | 0 | `dd352292e2a23b51e268dc1003d10d87eb7b9840cde5d2e60c06feb255d0eb91` |
| Final runtime capture | `docs/implementation/v3/m12-logs/python-native-29-final-runtime-pins.log` | 0 | `6dec9db051974388aff640a651cd72b8b99ee0c703301cc68c4bd641e93605b0` |

| Source | Git blob SHA1 |
|---|---|
| `packages/runtime/python-program-worker.ts` | `f8fdabc27b59afff34819d216f46e6dfce46f897` |
| `packages/runtime/python-program-worker.py` | `8fac58ad109c048d54e6dbc8e7fdc79581738ca5` |
| `packages/runtime/python-confinement.py` | `c575926f3fd734227d68174bb80294eb40123cf6` |
| `packages/runtime/python-program-supervisor.py` | `75ddc93e19241ebbd94b5930049307f371ca68db` |
| `packages/core/python-program-provider.ts` | `f7b11614afd61ef46c5209833235d3bad78857d5` |
| `packages/core/python-kernels.ts` | `6b977ea29e3a4796f2b5fdf0f4a6e8d543f85881` |
| `tests/python-program-backend-v3.test.ts` | `9815bcd465fe2ab59f8507f50b9dad01dea926dc` |
| `tests/python-program-integration-v3.test.ts` | `6bdf5fa49db5bca9ede8ef4a16604cd2db177e41` |
| `tests/python-kernel-v3.test.ts` | `d1337f1aa6a25f9b72e6d0b37c15defb5cf949bd` |

## Historical feasibility and previous attempts

The following sections preserve the initial probes, older fingerprints, failed attempts and earlier handoff counts. References to a final or current result inside this historical record describe that earlier point in the work. The current reviewed result and explicit limitations are above.

### Result

A viable unprivileged Linux x86_64 design exists on this host: pinned Bubblewrap filesystem/user/PID/IPC/UTS namespaces plus a default-deny seccomp BPF filter and a hard RLIMIT_AS ceiling. Landlock is unavailable here. No installs or host security-policy changes were made.

Landlock syscall 444 with LANDLOCK_CREATE_RULESET_VERSION returned -1, errno 38 (ENOSYS). User namespace creation succeeded. Bubblewrap network namespace setup failed because this environment denies NETLINK_ROUTE socket creation. The viable design deliberately retains the existing network namespace while denying all socket creation and networking syscalls in seccomp before executing guest source. This is a composed namespace/syscall boundary; seccomp by itself is not a filesystem sandbox.

### Measured boundary

- Preliminary live matrix: 35/35 passed, exit 0. Files outside the image, proc-based escape paths and input symlink escapes returned ENOENT. Runtime/input writes returned EROFS. TCP, UDP, IPv6 and Unix sockets, process creation/exec, namespace/mount changes, ptrace, io_uring, BPF, x32 calls and limit changes returned EPERM.
- Hard process virtual-address-space ceiling: 134217728 bytes (128 MiB). An 8 MiB allocation succeeded; a 256 MiB allocation raised MemoryError. This is a real RLIMIT_AS bound on the Python process, not an aggregate cgroup memory or disk quota.
- Confirmed owned-process-group termination: readiness observed after 19.765 ms, process confirmed alive, then SIGKILL; wait and pipe closure completed after 0.712 ms, exit -9. This single observed latency is not a universal timing guarantee.
- Separate hard CPU-limit probe: a busy process was killed at about 3.227 seconds, exit 137, with RLIMIT_CPU=(3,3). The persistent production design uses fresh host wall-clock deadlines per cell because cumulative CPU limits do not reset between cells.
- Child environment contained only LANG, PWD and PYTHONDONTWRITEBYTECODE. The synthetic credential placed in the parent environment was absent. Only descriptors 0, 1 and 2 were open.
- Synthetic host credential and input fixtures remained unchanged.

### Installed identities

| Component | Path | SHA-256 |
|---|---|---|
| Bubblewrap 0.12.0 | /usr/bin/bwrap | 573236e5328ac2ebb08f59ae3a9805b4f8d12bdef14be8af4450d5463294985f |
| CPython 3.13.5 | /usr/bin/python3.13 | 889c603f0d17cb54060951bcf4c4f9b8c9ebd9e52b392c70209bbb9755d797d9 |

Platform observed: Linux 6.18.57 x86_64, uid/gid 1000, no effective capabilities, existing NoNewPrivs=1 and seccomp filtering. The available alternative managed Python was 3.12.14; it was not selected for the implementation.

### Implementation recommendation and limits

Use the explicitly configured and fingerprinted interpreter, Bubblewrap binary, complete stdlib tree (including bytecode and symlink identities), exact shared-library files, bootstrap and confinement source. Do not search PATH or approve an arbitrary discovered interpreter. Recheck fingerprints before cells. Bind the runtime files read-only, expose no host /proc, /home, credentials, session storage or broad /usr tree, remount the namespace root read-only, and bind only the explicitly approved private per-kernel directory at /work. Drop all capabilities, clear environment, close inherited descriptors and block fork/clone/exec and every unlisted syscall.

Fresh per-cell host limits must cover spawn/setup and execution, RPC count/concurrency and output. Protocol frames remain untrusted; request ID and generation must match the active cell, stable call identities are monotonic, private host input has an independent 8 MiB frame bound, output stays at 256 KiB, and cancellation waits for owned process/pipe closure. No Python replay is permitted. Reset kills interpreter state; an explicitly mounted private directory can retain files. RLIMIT_FSIZE limits individual files, but total retained disk usage is not capped by RLIMIT_AS.

The initial prototype allowed private scratch tmpfs; the implemented backend additionally remounts / read-only and its native tests check root writes return EROFS. External file links must be rejected before mounting the host-owned private directory. The native probes are Linux x86_64 evidence only. They do not approve production flags, prove Windows support, certify another machine or replace independent review of the final composed backend.

### Implementation test evidence

After the root authorized implementation, tests/python-program-backend-v3.test.ts was written before implementation. The red attempt was retained as docs/implementation/v3/m12-logs/python-backend-01-red.log (missing implementation module). The first real native implementation run passed all 15 cases, recorded in docs/implementation/v3/m12-logs/python-backend-02-green-attempt.log (SHA-256 716a0d82bccf7e111d167987fc7f3717b75d47003f2bb28017131cbefc219b8c). These tests label operator approval as synthetic and exercise the actual installed confinement boundary.

### Primary references consulted

- https://docs.kernel.org/userspace-api/landlock.html
- https://docs.kernel.org/userspace-api/seccomp_filter.html
- https://github.com/containers/bubblewrap
- https://man7.org/linux/man-pages/man2/getrlimit.2.html
- Installed headers: /usr/include/linux/landlock.h, /usr/include/linux/seccomp.h, /usr/include/linux/prctl.h, /usr/include/x86_64-linux-gnu/asm/unistd_64.h.

### Exact recorded probe commands and outputs

#### landlock_abi

```sh
/usr/bin/python3.13 -I -S -B -c 'import ctypes,json,os; c=ctypes.CDLL(None,use_errno=True); c.syscall.restype=ctypes.c_long; r=c.syscall(ctypes.c_long(444),ctypes.c_void_p(0),ctypes.c_size_t(0),ctypes.c_uint(1)); e=ctypes.get_errno(); print(json.dumps({'"'"'return'"'"':r,'"'"'errno'"'"':e,'"'"'error'"'"':os.strerror(e)}))'
```

Environment: `{"LANG": "C.UTF-8", "M12_SYNTHETIC_CREDENTIAL": "synthetic-environment-sentinel", "PATH": "/usr/bin:/bin"}`

Execution metadata:

```json
{
  "name": "landlock_abi",
  "exit_code": 0,
  "elapsed_ms": 23.403
}
```

Stdout:

```text
{"return": -1, "errno": 38, "error": "Function not implemented"}
```

Stderr:

```text

```

#### user_namespace

```sh
/usr/bin/unshare --user --map-root-user /usr/bin/true
```

Environment: `{"LANG": "C.UTF-8", "M12_SYNTHETIC_CREDENTIAL": "synthetic-environment-sentinel", "PATH": "/usr/bin:/bin"}`

Execution metadata:

```json
{
  "name": "user_namespace",
  "exit_code": 0,
  "elapsed_ms": 2.167
}
```

Stdout:

```text

```

Stderr:

```text

```

#### bubblewrap_network_namespace

```sh
/usr/bin/bwrap --unshare-user --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 --proc /proc --dev /dev /usr/bin/true
```

Environment: `{"LANG": "C.UTF-8", "M12_SYNTHETIC_CREDENTIAL": "synthetic-environment-sentinel", "PATH": "/usr/bin:/bin"}`

Execution metadata:

```json
{
  "name": "bubblewrap_network_namespace",
  "exit_code": 1,
  "elapsed_ms": 2.712
}
```

Stdout:

```text

```

Stderr:

```text
bwrap: loopback: Failed to create NETLINK_ROUTE socket: Operation not permitted
```

#### confined_matrix

```sh
/usr/bin/bwrap --unshare-user --unshare-pid --unshare-ipc --unshare-uts --die-with-parent --new-session --cap-drop ALL --clearenv --setenv LANG C.UTF-8 --setenv PYTHONDONTWRITEBYTECODE 1 --dir /usr --dir /usr/bin --dir /usr/lib --dir /lib --dir /lib/x86_64-linux-gnu --dir /lib64 --dir /input --ro-bind /usr/bin/python3.13 /usr/bin/python3.13 --ro-bind /usr/lib/python3.13 /usr/lib/python3.13 --ro-bind /lib/x86_64-linux-gnu/libc.so.6 /lib/x86_64-linux-gnu/libc.so.6 --ro-bind /lib/x86_64-linux-gnu/libm.so.6 /lib/x86_64-linux-gnu/libm.so.6 --ro-bind /lib/x86_64-linux-gnu/libz.so.1 /lib/x86_64-linux-gnu/libz.so.1 --ro-bind /lib/x86_64-linux-gnu/libexpat.so.1 /lib/x86_64-linux-gnu/libexpat.so.1 --ro-bind /lib/x86_64-linux-gnu/libffi.so.8 /lib/x86_64-linux-gnu/libffi.so.8 --ro-bind /lib64/ld-linux-x86-64.so.2 /lib64/ld-linux-x86-64.so.2 --ro-bind <tmp>/m12-python-probes/input /input --ro-bind <tmp>/m12-python-probes/bootstrap.py /bootstrap.py --size 16777216 --tmpfs /work --size 1048576 --tmpfs /tmp --chdir /work /usr/bin/python3.13 -I -S -B /bootstrap.py matrix
```

Environment: `{"LANG": "C.UTF-8", "M12_SYNTHETIC_CREDENTIAL": "synthetic-environment-sentinel", "PATH": "/usr/bin:/bin"}`

Execution metadata:

```json
{
  "name": "confined_matrix",
  "exit_code": 0,
  "elapsed_ms": 53.561
}
```

Stdout:

```text
{"env_keys": ["LANG", "PWD", "PYTHONDONTWRITEBYTECODE"], "kind": "baseline", "outside_environment_absent": true, "pid": 2, "socket_creation": true, "uid": 1000}
{"kind": "descriptors", "open_fds": [0, 1, 2]}
{"address_space": [134217728, 134217728], "cpu": [3, 3], "file_size": [1048576, 1048576], "kind": "limits"}
{"bpf_instructions": 155, "kind": "installed", "seccomp": true, "syscall_allowlist": [0, 1, 3, 5, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 35, 39, 60, 63, 74, 75, 76, 77, 78, 79, 80, 82, 83, 84, 87, 89, 95, 96, 97, 98, 99, 100, 102, 104, 107, 108, 127, 131, 217, 218, 228, 230, 231, 257, 258, 262, 263, 264, 267, 269, 270, 271, 273, 280, 285, 295, 296, 318, 332, 334, 439]}
{"kind": "case", "name": "approved_input_read", "passed": true}
{"kind": "case", "name": "private_scratch_read_write", "passed": true}
{"denied": true, "errno": 2, "error": "No such file or directory", "kind": "case", "name": "outside_profile_secret_read", "passed": true}
{"denied": true, "errno": 2, "error": "No such file or directory", "kind": "case", "name": "host_etc_passwd_read", "passed": true}
{"denied": true, "errno": 2, "error": "No such file or directory", "kind": "case", "name": "host_proc_root_escape", "passed": true}
{"denied": true, "errno": 2, "error": "No such file or directory", "kind": "case", "name": "host_proc_fd_escape", "passed": true}
{"denied": true, "errno": 2, "error": "No such file or directory", "kind": "case", "name": "input_absolute_symlink_escape", "passed": true}
{"denied": true, "errno": 2, "error": "No such file or directory", "kind": "case", "name": "input_relative_symlink_escape", "passed": true}
{"denied": true, "errno": 2, "error": "No such file or directory", "kind": "case", "name": "outside_profile_write", "passed": true}
{"denied": true, "errno": 30, "error": "Read-only file system", "kind": "case", "name": "read_only_input_write", "passed": true}
{"denied": true, "errno": 30, "error": "Read-only file system", "kind": "case", "name": "read_only_runtime_write", "passed": true}
{"denied": true, "errno": 1, "error": "Operation not permitted", "kind": "case", "name": "tcp_socket", "passed": true}
{"denied": true, "errno": 1, "error": "Operation not permitted", "kind": "case", "name": "udp_socket", "passed": true}
{"denied": true, "errno": 1, "error": "Operation not permitted", "kind": "case", "name": "ipv6_socket", "passed": true}
{"denied": true, "errno": 1, "error": "Operation not permitted", "kind": "case", "name": "unix_socket", "passed": true}
{"errno": 1, "kind": "case", "name": "connect_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "clone_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "fork_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "vfork_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "clone3_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "execve_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "execveat_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "unshare_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "setns_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "mount_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "ptrace_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "process_vm_readv_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "io_uring_setup_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "bpf_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "x32_socket_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "kill_syscall", "passed": true, "return_value": -1}
{"errno": 1, "kind": "case", "name": "raise_memory_limit_prlimit64", "passed": true, "return_value": -1}
{"bytes": 8388608, "kind": "case", "name": "small_allocation", "passed": true}
{"error": "MemoryError", "hard_address_space": 134217728, "kind": "case", "name": "memory_256_mib", "passed": true}
{"kind": "case", "name": "python_computation", "passed": true, "result": 333283335000, "sqrt": 9.0}
{"all_passed": true, "kind": "summary", "passed": 35, "total": 35}
```

Stderr:

```text

```

#### external_wall_clock_kill

```sh
/usr/bin/bwrap --unshare-user --unshare-pid --unshare-ipc --unshare-uts --die-with-parent --new-session --cap-drop ALL --clearenv --setenv LANG C.UTF-8 --setenv PYTHONDONTWRITEBYTECODE 1 --dir /usr --dir /usr/bin --dir /usr/lib --dir /lib --dir /lib/x86_64-linux-gnu --dir /lib64 --dir /input --ro-bind /usr/bin/python3.13 /usr/bin/python3.13 --ro-bind /usr/lib/python3.13 /usr/lib/python3.13 --ro-bind /lib/x86_64-linux-gnu/libc.so.6 /lib/x86_64-linux-gnu/libc.so.6 --ro-bind /lib/x86_64-linux-gnu/libm.so.6 /lib/x86_64-linux-gnu/libm.so.6 --ro-bind /lib/x86_64-linux-gnu/libz.so.1 /lib/x86_64-linux-gnu/libz.so.1 --ro-bind /lib/x86_64-linux-gnu/libexpat.so.1 /lib/x86_64-linux-gnu/libexpat.so.1 --ro-bind /lib/x86_64-linux-gnu/libffi.so.8 /lib/x86_64-linux-gnu/libffi.so.8 --ro-bind /lib64/ld-linux-x86-64.so.2 /lib64/ld-linux-x86-64.so.2 --ro-bind <tmp>/m12-python-probes/input /input --ro-bind <tmp>/m12-python-probes/bootstrap.py /bootstrap.py --size 16777216 --tmpfs /work --size 1048576 --tmpfs /tmp --chdir /work /usr/bin/python3.13 -I -S -B /bootstrap.py loop
```

Environment: `{"LANG": "C.UTF-8", "M12_SYNTHETIC_CREDENTIAL": "synthetic-environment-sentinel", "PATH": "/usr/bin:/bin"}`

Execution metadata:

```json
{
  "name": "external_wall_clock_kill",
  "ready_seen": true,
  "signal": "SIGKILL to owned process group",
  "exit_code": 137,
  "kill_to_exit_ms": 0.304,
  "timing_limitation": "First probe used TextIO buffering with selector and may have observed ready after CPU expiration; superseded by external_wall_clock_kill_confirmed binary pipe probe."
}
```

Stdout:

```text
{"env_keys": ["LANG", "PWD", "PYTHONDONTWRITEBYTECODE"], "kind": "baseline", "outside_environment_absent": true, "pid": 2, "socket_creation": true, "uid": 1000}
{"kind": "descriptors", "open_fds": [0, 1, 2]}
{"address_space": [134217728, 134217728], "cpu": [3, 3], "file_size": [1048576, 1048576], "kind": "limits"}
{"bpf_instructions": 155, "kind": "installed", "seccomp": true, "syscall_allowlist": [0, 1, 3, 5, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 35, 39, 60, 63, 74, 75, 76, 77, 78, 79, 80, 82, 83, 84, 87, 89, 95, 96, 97, 98, 99, 100, 102, 104, 107, 108, 127, 131, 217, 218, 228, 230, 231, 257, 258, 262, 263, 264, 267, 269, 270, 271, 273, 280, 285, 295, 296, 318, 332, 334, 439]}
{"kind": "ready", "mode": "loop"}
```

Stderr:

```text

```

#### hard_cpu_limit

```sh
/usr/bin/bwrap --unshare-user --unshare-pid --unshare-ipc --unshare-uts --die-with-parent --new-session --cap-drop ALL --clearenv --setenv LANG C.UTF-8 --setenv PYTHONDONTWRITEBYTECODE 1 --dir /usr --dir /usr/bin --dir /usr/lib --dir /lib --dir /lib/x86_64-linux-gnu --dir /lib64 --dir /input --ro-bind /usr/bin/python3.13 /usr/bin/python3.13 --ro-bind /usr/lib/python3.13 /usr/lib/python3.13 --ro-bind /lib/x86_64-linux-gnu/libc.so.6 /lib/x86_64-linux-gnu/libc.so.6 --ro-bind /lib/x86_64-linux-gnu/libm.so.6 /lib/x86_64-linux-gnu/libm.so.6 --ro-bind /lib/x86_64-linux-gnu/libz.so.1 /lib/x86_64-linux-gnu/libz.so.1 --ro-bind /lib/x86_64-linux-gnu/libexpat.so.1 /lib/x86_64-linux-gnu/libexpat.so.1 --ro-bind /lib/x86_64-linux-gnu/libffi.so.8 /lib/x86_64-linux-gnu/libffi.so.8 --ro-bind /lib64/ld-linux-x86-64.so.2 /lib64/ld-linux-x86-64.so.2 --ro-bind <tmp>/m12-python-probes/input /input --ro-bind <tmp>/m12-python-probes/bootstrap.py /bootstrap.py --size 16777216 --tmpfs /work --size 1048576 --tmpfs /tmp --chdir /work /usr/bin/python3.13 -I -S -B /bootstrap.py cpu
```

Environment: `{"LANG": "C.UTF-8", "M12_SYNTHETIC_CREDENTIAL": "synthetic-environment-sentinel", "PATH": "/usr/bin:/bin"}`

Execution metadata:

```json
{
  "name": "hard_cpu_limit",
  "exit_code": 137,
  "elapsed_ms": 3226.738
}
```

Stdout:

```text
{"env_keys": ["LANG", "PWD", "PYTHONDONTWRITEBYTECODE"], "kind": "baseline", "outside_environment_absent": true, "pid": 2, "socket_creation": true, "uid": 1000}
{"kind": "descriptors", "open_fds": [0, 1, 2]}
{"address_space": [134217728, 134217728], "cpu": [3, 3], "file_size": [1048576, 1048576], "kind": "limits"}
{"bpf_instructions": 155, "kind": "installed", "seccomp": true, "syscall_allowlist": [0, 1, 3, 5, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 35, 39, 60, 63, 74, 75, 76, 77, 78, 79, 80, 82, 83, 84, 87, 89, 95, 96, 97, 98, 99, 100, 102, 104, 107, 108, 127, 131, 217, 218, 228, 230, 231, 257, 258, 262, 263, 264, 267, 269, 270, 271, 273, 280, 285, 295, 296, 318, 332, 334, 439]}
{"kind": "ready", "mode": "cpu"}
```

Stderr:

```text

```

#### external_wall_clock_kill_confirmed

```sh
/usr/bin/bwrap --unshare-user --unshare-pid --unshare-ipc --unshare-uts --die-with-parent --new-session --cap-drop ALL --clearenv --setenv LANG C.UTF-8 --setenv PYTHONDONTWRITEBYTECODE 1 --dir /usr --dir /usr/bin --dir /usr/lib --dir /lib --dir /lib/x86_64-linux-gnu --dir /lib64 --dir /input --ro-bind /usr/bin/python3.13 /usr/bin/python3.13 --ro-bind /usr/lib/python3.13 /usr/lib/python3.13 --ro-bind /lib/x86_64-linux-gnu/libc.so.6 /lib/x86_64-linux-gnu/libc.so.6 --ro-bind /lib/x86_64-linux-gnu/libm.so.6 /lib/x86_64-linux-gnu/libm.so.6 --ro-bind /lib/x86_64-linux-gnu/libz.so.1 /lib/x86_64-linux-gnu/libz.so.1 --ro-bind /lib/x86_64-linux-gnu/libexpat.so.1 /lib/x86_64-linux-gnu/libexpat.so.1 --ro-bind /lib/x86_64-linux-gnu/libffi.so.8 /lib/x86_64-linux-gnu/libffi.so.8 --ro-bind /lib64/ld-linux-x86-64.so.2 /lib64/ld-linux-x86-64.so.2 --ro-bind <tmp>/m12-python-probes/input /input --ro-bind <tmp>/m12-python-probes/bootstrap.py /bootstrap.py --size 16777216 --tmpfs /work --size 1048576 --tmpfs /tmp --chdir /work /usr/bin/python3.13 -I -S -B /bootstrap.py loop
```

Environment: `{"LANG": "C.UTF-8", "M12_SYNTHETIC_CREDENTIAL": "synthetic-environment-sentinel", "PATH": "/usr/bin:/bin"}`

Execution metadata:

```json
{
  "name": "external_wall_clock_kill_confirmed",
  "ready_seen": true,
  "ready_after_ms": 19.765,
  "alive_before_kill": true,
  "signal": "SIGKILL to owned process group",
  "exit_code": -9,
  "kill_to_exit_ms": 0.712
}
```

Stdout:

```text
{"env_keys": ["LANG", "PWD", "PYTHONDONTWRITEBYTECODE"], "kind": "baseline", "outside_environment_absent": true, "pid": 2, "socket_creation": true, "uid": 1000}
{"kind": "descriptors", "open_fds": [0, 1, 2]}
{"address_space": [134217728, 134217728], "cpu": [3, 3], "file_size": [1048576, 1048576], "kind": "limits"}
{"bpf_instructions": 155, "kind": "installed", "seccomp": true, "syscall_allowlist": [0, 1, 3, 5, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 35, 39, 60, 63, 74, 75, 76, 77, 78, 79, 80, 82, 83, 84, 87, 89, 95, 96, 97, 98, 99, 100, 102, 104, 107, 108, 127, 131, 217, 218, 228, 230, 231, 257, 258, 262, 263, 264, 267, 269, 270, 271, 273, 280, 285, 295, 296, 318, 332, 334, 439]}
{"kind": "ready", "mode": "loop"}
```

Stderr:

```text

```

### Probe artifacts

`<tmp>/m12-python-probes/results.json` retains machine-readable full argv/output/exit evidence. `<tmp>/m12-python-probes/bootstrap.py` and `run_probes.py` are disposable prototypes, not production code.

```json
{
  "bootstrap.py": "6fbf66705c2f39f763393a3234499556d781698825a2527ca62e9d9f36bd2307",
  "run_probes.py": "0820c66b8e37b4af1a7532f4419e94160211f1aabdb9ef1e41b26ded02f6100d"
}
```

### Final backend handoff update

The implemented backend now passes 18 native tests. The final focused log is `docs/implementation/v3/m12-logs/python-backend-10-reset-green.log`, SHA-256 `0b5334a85c786ee62ec53575287ac8377f919a0e6e44aebcb29888578aeca126`. Added red/green checks prove small output budgets do not count the protocol envelope, private cwd dev/inode replacement invalidates reuse, and changing an existing process hard memory ceiling kills the old instance and requires explicit reset.

The current exact runtime configuration is `<tmp>/m12-python-probes/runtime-configuration.json`; its capture is retained in `python-backend-08-runtime-pins.log`. It intentionally records operatorApproved:false. Runtime fingerprint: `15af1b4f49689f41a12984dd2f0b7504cd88312b6cc9034d4cafd1aed24b657a`.

Typecheck attempt 03 found an unused import in the backend, which was removed. Attempt 06 reported no backend diagnostics and failed only on concurrent core/Service integration work (`tool-program-host.ts:95` and not-yet-added Service integration members). Full application regression and final combined typecheck remain the root integration workflow responsibilities. The first runtime-capture helper attempt used an external .ts file treated as CommonJS; the retained failed attempt 07 was corrected with .mts in passing attempt 08.


### Final supervised backend and M03 provider integration

The concrete implementation now includes a pinned host-only supervisor in `packages/runtime/python-program-supervisor.py`. A native regression proved that an untrusted Python program could forge its valid completion frame and continue changing `/work` after the host cleared its deadline. The retained failing log is `docs/implementation/v3/m12-logs/python-backend-11-completion-red.log` (SHA256 `6808b6aa381acfdd00f34d108e2276c865da852ff2b6695d294ec7563807c9a8`).

The repaired boundary does not treat a guest completion frame as proof that source execution returned. The separate trusted supervisor owns a pidfd for the interpreter, receives commands over a control fd that is not inherited by the guest, sends uncatchable SIGSTOP, and verifies actual stopped state, stable process identity, one thread, and no descendants before acknowledging pause. The host retains the original deadline until this acknowledgement. It queues a fresh cell request with a fresh host deadline before an explicit SIGCONT. A forged-completion program therefore stays quiescent between cells; if it ignores the next cell and resumes its old loop, the next cell deadline kills the namespace and requires reset. Guest fd 3 is absent, and kill, pidfd_open, and pidfd_send_signal syscalls are denied by the existing seccomp filter.

The current kernel does not expose `/proc/<pid>/task/<pid>/children`. A disposable trusted diagnostic retained that exact ENOENT in `python-backend-15-supervisor-native-state.log`. The implementation uses bounded actual `/proc/*/stat` parent identity enumeration, with the guest as namespace PID 1, instead. Diagnostic capture logs with exit 0 are transport captures, not successful confinement tests.

Memory evidence is deliberately scoped: the guest interpreter has a hard RLIMIT_AS of at most 128 MiB, including Python and native allocations; the trusted supervisor lowers its own hard RLIMIT_AS to 64 MiB after launching; bwrap inherits a 128 MiB hard RLIMIT_AS. No aggregate process-tree, cgroup, total-RSS, or host protocol-buffer memory cap is claimed. The private directory has per-file RLIMIT_FSIZE, not an aggregate retained-disk quota.

`createPythonProgramProvider({ runtime, platformProof, approved, configuration })` now composes actual M03 `evaluateExecution` with `pythonExecutionBackend.launch` and the same executor handle. Its host-only `configure(owner, toolRegistryDigest, protectedDataDir)` returns the pinned identity and generation factory. It pins owner, runtime/interpreter, exact profile, trust decision, policy flags, canonical cwd device/inode, tool registry, and protected storage identity. It rejects cwd equal to, within, surrounding, or aliasing protected host storage. The current host configuration and actual trust bytes are revalidated before every cell within that cell's wall deadline; env carries policy booleans only and never reaches the guest. No interpreter choice, host env, owner, or approval is accepted from model tool arguments.

The real Service integration uses actual `repository_read`, actual resource grants, and M02 receipts after the Linux descriptor-bound read prerequisite was repaired by the other agent. Tests verify the nested receipt points to `${programId}:attempt:1` and that this parent receipt exists. Successful cases retain only explicit aggregates in visible state, retain variables across successful cells, preserve files and clear variables on reset, never replay old cells, and invalidate on cancellation, trust change, grant revocation, host flag change, or quota failure. No synthetic domain read payload was substituted.

Latest focused native command:

```text
python <tmp>/m12-record-command.py python-native-17-combined-green 90 node node_modules/vitest/vitest.mjs run tests/python-program-backend-v3.test.ts tests/python-program-integration-v3.test.ts --maxWorkers=1
```

Result: exit 0, 35/35 tests passed across two files, 23.40 seconds. Log SHA256: `7917f94270fc76cbcfca566c64203dc0cedafe63a3244c78cab347f40308f023`. The 19 backend cases and 16 provider cases include the forged-completion regression and protected Store rejection. Global final typecheck/regression belongs to root. This agent retained the failed global typecheck attempts: external SIGKILL at default heap and V8 exhaustion at 1536 MiB; neither is a successful typecheck.

Updated explicit runtime pin artifact: `<tmp>/m12-python-probes/runtime-configuration-supervised.json`; captured by `python-native-18-runtime-pins.log` (SHA256 `2f59ea73f76a12104a169651c93afc217eb1e17b09f605e05a09e6c62dda6922`). Runtime fingerprint: `651716e63d7ded411b8069d1ef4135d60b1b5d97f8723eb77691ad7f4655ff4e`. Supervisor SHA256: `e9dc20e10f65cf4ef49e2c81e71882b687ce0fecdaf934ef161534133bea1a7e`. The artifact records `operatorApproved: false`; native test fixtures have explicit synthetic operator approval and actual process boundaries. No production flag or operator approval was enabled by this work.
