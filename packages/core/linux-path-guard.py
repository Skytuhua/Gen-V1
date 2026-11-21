"""Trusted OS setup for directory custody; never an inference/admission loader.

Requires root/CAP_SYS_ADMIN. Runs Gen without capabilities in a private mount
namespace, mapping inaccessible backing ownership into the runtime UID. The
ordinary acquire/release protocol pins directories with kernel bind mounts.
"""
import argparse
import ctypes
import errno
import fcntl
import hashlib
import json
import os
import re
import selectors
import signal
import socket
import stat
import sys
import time
import uuid

LIBC = ctypes.CDLL(None, use_errno=True)
LIMIT = 65536


def checked(result):
    if result < 0:
        raise OSError(ctypes.get_errno(), "Linux directory custody operation failed")
    return result


def syscall(number, *arguments):
    return checked(LIBC.syscall(ctypes.c_long(number), *arguments))


class MountAttr(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in ("set", "clear", "propagation", "userns")]


class CustodyUncertain(PermissionError):
    pass


class ResourceLimit(PermissionError):
    pass


def mount_records():
    def decode(value):
        return re.sub(r"\\(040|011|012|134)", lambda match: chr(int(match[1], 8)), value)
    with open('/proc/self/mountinfo', encoding='utf-8') as mounts:
        result = []
        for line in mounts:
            mount, filesystem = line.split(' - ', 1)
            parts = mount.split()
            result.append(dict(id=parts[0], dev=parts[2], root=decode(parts[3]), path=decode(parts[4]), flags=parts[5].split(','), filesystem=filesystem.split()[0]))
        return result


def mount_id(fd):
    with open(f'/proc/self/fdinfo/{fd}', encoding='ascii') as info:
        return next(line.split()[1] for line in info if line.startswith('mnt_id:'))


def within(root, path):
    return path == root or path.startswith(root.rstrip('/') + '/')


def mount_readonly(fd, enabled):
    attributes = MountAttr(1 if enabled else 0, 0 if enabled else 1, 0, 0)
    # Change existing mounts recursively; creating a new cover leaves old FDs writable.
    syscall(442, ctypes.c_int(fd), ctypes.c_char_p(b''), ctypes.c_uint(0x1000 | 0x8000), ctypes.byref(attributes), ctypes.c_size_t(ctypes.sizeof(attributes)))


def identity_namespace(uid, gid, storage_uid, storage_gid):
    ready_r, ready_w = os.pipe()
    stop_r, stop_w = os.pipe()
    child = os.fork()
    if child == 0:
        try:
            os.close(ready_r)
            os.close(stop_w)
            os.unshare(0x10000000)  # CLONE_NEWUSER, mapping installed by trusted parent.
            os.write(ready_w, b"1")
            os.read(stop_r, 1)
        finally:
            os._exit(0)
    os.close(ready_w)
    os.close(stop_r)
    try:
        if os.read(ready_r, 1) != b"1":
            raise PermissionError("User namespace unavailable")
        for name, value in (
            ("setgroups", "deny"),
            ("uid_map", f"0 0 1\n{storage_uid} {uid} 1\n"),
            ("gid_map", f"0 0 1\n{storage_gid} {gid} 1\n"),
        ):
            with open(f"/proc/{child}/{name}", "w", encoding="ascii") as target:
                target.write(value)
        return os.open(f"/proc/{child}/ns/user", os.O_RDONLY | os.O_CLOEXEC)
    finally:
        os.close(ready_r)
        os.close(stop_w)
        os.waitpid(child, 0)


def private_profile(root, uid, gid):
    if os.geteuid() != 0 or os.uname().machine != "x86_64" or not 0 < uid < 2**31 or not 0 < gid < 2**31:
        raise PermissionError("Trusted Linux x64 setup is required")
    if not os.path.isabs(root) or os.path.normpath(root) != root or root == "/":
        raise PermissionError("Use a canonical private profile")
    # The operator must reserve this UID for this one managed process tree.
    # Unrelated same-UID processes could otherwise access its /proc view.
    for name in os.listdir('/proc'):
        if not name.isdecimal():
            continue
        try:
            with open(f'/proc/{name}/status', encoding='ascii') as process:
                for line in process:
                    if line.startswith('Uid:') and uid in map(int, line.split()[1:]):
                        raise PermissionError('Runtime UID is already in use')
        except FileNotFoundError:
            pass
    current = "/"
    for name in root.split("/")[1:]:
        current = os.path.join(current, name)
        info = os.lstat(current)
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
            raise PermissionError("Ordinary private ancestry is required")
        if current != root and (info.st_uid != 0 or info.st_mode & 0o022):
            raise PermissionError("Private profile ancestors must be root-owned and non-writable")
    info = os.stat(root)
    if info.st_uid in (0, uid) or info.st_gid in (0, gid) or info.st_mode & 0o077:
        raise PermissionError("Backing ownership must differ from runtime ownership and be private")
    with open('/proc/self/mountinfo', encoding='utf-8') as mounts:
        filesystem = None
        longest = -1
        for line in mounts:
            mount, kind = line.split(' - ', 1)
            target = mount.split()[4]
            for escaped, value in (('\\040', ' '), ('\\011', '\t'), ('\\012', '\n'), ('\\134', '\\')):
                target = target.replace(escaped, value)
            if (target == '/' or root == target or root.startswith(target + '/')) and len(target) > longest:
                filesystem, longest = kind.split()[0], len(target)
        if filesystem != 'ext4':
            raise PermissionError('This guarded runtime requires its verified local ext4 storage')
    backing = os.open(root, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    os.unshare(0x00020000)  # CLONE_NEWNS; no mounts propagate to the host.
    checked(LIBC.mount(None, b"/", None, 0x40000 | 0x4000, None))
    namespace = identity_namespace(uid, gid, info.st_uid, info.st_gid)
    mount = -1
    try:
        mount = syscall(428, ctypes.c_int(-100), ctypes.c_char_p(os.fsencode(root)), ctypes.c_uint(1 | os.O_CLOEXEC))
        attributes = MountAttr(1 << 20, 0, 0, namespace)  # MOUNT_ATTR_IDMAP
        syscall(442, ctypes.c_int(mount), ctypes.c_char_p(b""), ctypes.c_uint(0x1000), ctypes.byref(attributes), ctypes.c_size_t(ctypes.sizeof(attributes)))
        syscall(429, ctypes.c_int(mount), ctypes.c_char_p(b""), ctypes.c_int(-100), ctypes.c_char_p(os.fsencode(root)), ctypes.c_uint(4))
    finally:
        if mount >= 0:
            os.close(mount)
        os.close(namespace)
    if os.stat(root).st_uid != uid or os.stat(root).st_gid != gid:
        raise PermissionError("Kernel ownership mapping unavailable")
    return backing


class DirectoryGuard:
    def __init__(self, root, uid):
        self.root, self.uid, self.groups, self.pins = root, uid, {}, {}
        self.readonly_pins: set = set()
        self.credentials, self.barriers = {}, {}
        # Applied mounts whose cleanup unwind failed stay fenced outside the
        # pin ledger; quarantining them stops acquisitions borrowing the
        # anomalous mount while the state is unresolved.
        self.quarantined: set = set()
        # Failed-acquisition rollback pins that stayed fenced keep a named
        # cleanup owner here — recorded, not releasable as a lease.
        self.unresolved: dict = {}

    def record_unresolved(self, owner, paths):
        if paths:
            self.unresolved[owner] = self.unresolved.get(owner, []) + paths

    def credential_parent(self, auth):
        if not isinstance(auth, str) or not auth.startswith(self.root + '/') or not re.fullmatch(r'(?:manager-runtime/)?(?:(?!manager-|\.\.?(?=/|$))[^/]+/)*accounts/provider-auth-[a-f0-9]{64}/pi/auth\.json', auth[len(self.root) + 1:]):
            raise PermissionError('A named account credential path is required')
        return os.path.dirname(auth)

    def prepare_credential(self, auth):
        parent = self.credential_parent(auth)
        if parent in self.credentials:
            return
        held, fd = [], -1
        try:
            for part in self.components(parent):
                self.pin(part)
                held.append(part)
            fd = os.open(parent, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            self.credentials[parent] = dict(path=parent, fd=fd, mount=mount_id(fd), identity=os.fstat(fd), held=held)
            fd = -1  # Preparation retains its own ancestry pins before any native access.
        except BaseException:
            if fd >= 0:
                os.close(fd)
            self.record_unresolved(parent, self.release_paths(held))
            raise

    def credential_mounts(self, prepared, readonly):
        records = mount_records()
        target = next(record for record in records if record['id'] == prepared['mount'])
        parent = prepared['path']
        current = os.stat(parent, follow_symlinks=False)
        original = prepared['identity']
        if target['path'] != parent or (current.st_dev, current.st_ino) != (original.st_dev, original.st_ino) or current.st_uid != self.uid or current.st_mode & 0o022:
            raise PermissionError('Credential mount identity changed')
        descendants = []
        for record in records:
            if within(parent, record['path']):
                relative = os.path.relpath(record['path'], parent)
                expected = target['root'] if relative == '.' else os.path.join(target['root'], relative)
                info = os.stat(record['path']).st_mode
                # A ledgered read-only leaf (a pinned child-write marker or an
                # explicit read-only file) is the guard's own custody: it stays
                # fenced instead of tracking the barrier's readonly state.
                leaf = record['path'] in self.readonly_pins and stat.S_ISREG(info)
                if record['path'] not in self.pins or record['dev'] != target['dev'] or record['root'] != expected or record['filesystem'] != 'ext4' or not (stat.S_ISDIR(info) or leaf) or ('ro' in record['flags']) != (readonly or leaf):
                    raise PermissionError('Unsupported credential submount')
                descendants.append(record['id'])
            elif record['dev'] == target['dev'] and (within(record['root'], target['root']) or within(target['root'], record['root'])) and not within(record['path'], parent) and 'ro' not in record['flags']:
                raise PermissionError('Writable credential mount alias')
        return set(descendants)

    def credential_processes(self, prepared, mounts):
        parent = prepared['path']
        auth = parent + '/auth.json'
        identity = os.stat(auth, follow_symlinks=False)
        if not stat.S_ISREG(identity.st_mode) or identity.st_nlink != 1 or identity.st_uid != self.uid:
            raise PermissionError('An existing ordinary credential inode is required')
        namespace = os.stat('/proc/self/ns/mnt').st_ino

        def runtime_tasks():
            result, examined = {}, 0
            processes = [name for name in os.listdir('/proc') if name.isdecimal()]
            if len(processes) > 8192:
                raise PermissionError('Process inventory exceeds its bound')
            for process in processes:
                task_root = '/proc/' + process + '/task'
                try:
                    threads = os.listdir(task_root)
                except (FileNotFoundError, ProcessLookupError):
                    continue
                examined += len(threads)
                if examined > 32768:
                    raise PermissionError('Thread inventory exceeds its bound')
                for thread in threads:
                    if not thread.isdecimal():
                        raise PermissionError('Unknown thread inventory')
                    base = task_root + '/' + thread
                    try:
                        with open(base + '/status', encoding='ascii') as status:
                            fields = dict(line.split(':', 1) for line in status if ':' in line)
                        owners = tuple(map(int, fields['Uid'].split()))
                        if self.uid not in owners:
                            continue
                        if owners != (self.uid,) * 4 or int(fields['Tgid']) != int(process):
                            raise PermissionError('Runtime thread ownership differs')
                        with open(base + '/stat', encoding='ascii') as stream:
                            started = stream.read().rsplit(')', 1)[1].split()[19]
                        result[base] = (owners, started)
                    except (FileNotFoundError, ProcessLookupError):
                        # A selected runtime disappearing is caught by the final inventory.
                        continue
            if not result:
                raise PermissionError('Runtime thread inventory unavailable')
            return result

        before = runtime_tasks()
        for base in before:
            try:
                if os.stat(base + '/ns/mnt').st_ino != namespace:
                    raise PermissionError('Runtime thread mount namespace differs')
                names = os.listdir(base + '/fd')
                if len(names) > 4096 or any(not name.isdecimal() for name in names):
                    raise PermissionError('Runtime descriptor inventory exceeds its bound')
                endpoints = [base + '/fd/' + name for name in names] + [base + '/cwd', base + '/root']
                for entry in endpoints:
                    target, info = os.readlink(entry), os.stat(entry)
                    # Include covered ancestry: openat on an old accounts/profile FD
                    # can skip later child bind mounts, even before auth.json existed.
                    relevant = target.startswith('/') and (within(parent, target) or within(target, parent))
                    relevant = relevant or (info.st_dev, info.st_ino) == (identity.st_dev, identity.st_ino)
                    if not relevant:
                        continue
                    if stat.S_ISDIR(info.st_mode) and info.st_uid != self.uid and not info.st_mode & 0o077:
                        # FD4 is the deliberately inaccessible foreign-owned 0700
                        # backing root. Its directory cannot be traversed by this UID.
                        continue
                    if not target.startswith('/') or target.endswith(' (deleted)'):
                        raise PermissionError('Unknown credential descriptor target')
                    held = os.open(entry, os.O_PATH | os.O_CLOEXEC)
                    visible = -1
                    try:
                        visible = os.open(target, os.O_PATH | os.O_NOFOLLOW | os.O_CLOEXEC)
                        current = os.fstat(visible)
                        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino) or mount_id(held) != mount_id(visible):
                            raise PermissionError('Preexisting credential ancestry descriptor alias')
                    finally:
                        if visible >= 0:
                            os.close(visible)
                        os.close(held)
                if set(os.listdir(base + '/fd')) != set(names) or os.stat(base + '/ns/mnt').st_ino != namespace:
                    raise PermissionError('Runtime thread descriptors changed during scan')
            except (FileNotFoundError, ProcessLookupError):
                raise PermissionError('Runtime thread changed during scan') from None
        if runtime_tasks() != before:
            raise PermissionError('Runtime thread inventory changed during scan')

    def acquire_credential(self, auth, duration):
        parent = self.credential_parent(auth)
        if type(duration) is not int or not 1 <= duration <= 300000 or parent not in self.credentials or any(value['parent'] == parent for value in self.barriers.values()):
            raise PermissionError('Credential parent is unavailable')
        prepared = self.credentials[parent]
        mounts = self.credential_mounts(prepared, False)
        self.credential_processes(prepared, mounts)
        held = [record['path'] for record in mount_records() if record['id'] in mounts]
        pinned = []
        try:
            for path in held:
                self.pin(path)
                pinned.append(path)
        except BaseException:
            self.record_unresolved(parent, self.release_paths(pinned))
            raise
        identifier = uuid.uuid4().hex
        barrier = dict(parent=parent, mounts=mounts, held=held, expires=time.monotonic() + duration / 1000, fenced=False)
        self.barriers[identifier] = barrier
        try:
            mount_readonly(prepared['fd'], True)
            barrier['fenced'] = True
            if self.credential_mounts(prepared, True) != mounts:
                raise PermissionError('Credential mount set changed')
            self.credential_processes(prepared, mounts)
            try:
                os.lstat(auth + '.lock')
            except FileNotFoundError:
                return identifier, sorted(mounts)
            raise PermissionError('A native credential lock is present')
        except BaseException:
            self.release_credential(identifier)
            raise

    def release_credential(self, identifier):
        barrier = self.barriers[identifier]
        if barrier['fenced']:
            prepared = self.credentials[barrier['parent']]
            try:
                if self.credential_mounts(prepared, True) != barrier['mounts']:
                    raise PermissionError('Credential mount set changed')
                mount_readonly(prepared['fd'], False)
                for path in barrier['held']:
                    # The recursive un-fence also clears each leaf pin's
                    # permanent fence; restore it so custody matches the ledger.
                    if path in self.readonly_pins:
                        leaf = os.open(path, os.O_PATH | os.O_NOFOLLOW | os.O_CLOEXEC)
                        try:
                            mount_readonly(leaf, True)
                        finally:
                            os.close(leaf)
                barrier['fenced'] = False
                if self.credential_mounts(prepared, False) != barrier['mounts']:
                    raise PermissionError('Credential restoration did not settle')
            except BaseException as error:
                raise CustodyUncertain('Retain credential custody') from error
        unresolved = self.release_paths(barrier['held'])
        if unresolved:
            # Keep the barrier owning exactly the paths that stayed fenced —
            # a refused cleanup must not claim the fence released.
            barrier['held'] = unresolved
            raise CustodyUncertain('Retain credential custody')
        del self.barriers[identifier]

    def components(self, path):
        if not isinstance(path, str) or len(path) > 4096 or "\0" in path or os.path.normpath(path) != path or not (path == self.root or path.startswith(self.root + "/")):
            raise PermissionError("Outside private profile")
        current = self.root
        result = [current]
        for name in path[len(self.root):].split("/"):
            if name:
                current += "/" + name
                result.append(current)
        return result

    def pin(self, path):
        if path in self.quarantined:
            raise PermissionError('Path retains quarantined cleanup state')
        if path in self.pins:
            self.pins[path] += 1
            return
        if any(value['fenced'] and within(value['parent'], path) for value in self.barriers.values()):
            raise PermissionError('Credential mount set is fenced')
        fd = os.open(path, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            info = os.fstat(fd)
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != self.uid or info.st_mode & 0o022:
                raise PermissionError("Private ordinary directory required")
            mounted = False
            if path != self.root:
                name = os.fsencode(f"/proc/self/fd/{fd}")
                checked(LIBC.mount(name, name, None, 4096, None))  # Mandatory rename/unlink protection.
                mounted = True
            try:
                after = os.stat(path, follow_symlinks=False)
                if (after.st_dev, after.st_ino) != (info.st_dev, info.st_ino):
                    raise PermissionError("Directory identity changed")
            except BaseException:
                if mounted:
                    try:
                        checked(LIBC.umount2(os.fsencode(path), 2))
                    except BaseException:
                        # The mount stays applied but unledgered; quarantine the
                        # path so acquisitions cannot borrow the anomaly.
                        self.quarantined.add(path)
                raise
            self.pins[path] = 1
        finally:
            os.close(fd)

    def release_paths(self, paths):
        # Each pin releases independently; unresolved paths keep their ledger
        # entry and fence. A still-held child's ancestors stay held — releasing
        # them would strand the child mount under a detached parent — while
        # independent paths release normally. Returns the paths that remain
        # held so the caller can retain lease ownership for a retry.
        unresolved = []
        for path in sorted(paths, key=lambda value: value.count("/"), reverse=True):
            if path not in self.pins:
                continue  # Consumed by an owned remove/replace.
            # A still-held child — unresolved this pass or quarantined from a
            # failed unwind — keeps its ancestors held; siblings release.
            if any(held.startswith(path + "/") for held in unresolved) or any(quarantined.startswith(path + "/") for quarantined in self.quarantined):
                unresolved.append(path)
                continue
            if self.pins[path] == 1:
                try:
                    if path != self.root:
                        # MNT_DETACH: release ends the lease like a handle close even
                        # while a child still maps or roots inside the mount.
                        checked(LIBC.umount2(os.fsencode(path), 2))
                except BaseException:
                    unresolved.append(path)
                    continue
                del self.pins[path]
                self.readonly_pins.discard(path)
            else:
                self.pins[path] -= 1
        return unresolved

    def drop_pin(self, path, writable_only=False):
        if path not in self.pins:
            return
        if any(quarantined.startswith(path + "/") for quarantined in self.quarantined):
            raise PermissionError("Quarantined child retains ancestry custody")
        if self.pins[path] != 1:
            raise PermissionError("Path is pinned by another guard lease")
        if writable_only and path in self.readonly_pins:
            raise PermissionError("Destination retains a read-only lease")
        checked(LIBC.umount2(os.fsencode(path), 2))
        del self.pins[path]
        self.readonly_pins.discard(path)

    def pin_leaf(self, path, read_only, expected=None, empty=False):
        if path in self.quarantined:
            raise PermissionError('Path retains quarantined cleanup state')
        if path in self.pins:
            self.pins[path] += 1
            return
        if any(value['fenced'] and within(value['parent'], path) for value in self.barriers.values()):
            raise PermissionError('Credential mount set is fenced')
        fd = os.open(path, os.O_PATH | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != self.uid:
                raise PermissionError("Private ordinary file required")
            if empty and info.st_size:
                raise PermissionError("Guarded file is not empty")
            if expected is not None and expected != (str(info.st_dev), str(info.st_ino)):
                raise PermissionError("Directory identity mismatch")
            name = os.fsencode(f"/proc/self/fd/{fd}")
            checked(LIBC.mount(name, name, None, 4096, None))  # Rename/unlink protection, like directory pins.
            try:
                if read_only:
                    bound = os.open(path, os.O_PATH | os.O_NOFOLLOW | os.O_CLOEXEC)
                    try:
                        attributes = MountAttr(1, 0, 0, 0)  # MOUNT_ATTR_RDONLY on the bind mount itself
                        syscall(442, ctypes.c_int(bound), ctypes.c_char_p(b""), ctypes.c_uint(0x1000), ctypes.byref(attributes), ctypes.c_size_t(ctypes.sizeof(attributes)))
                    finally:
                        os.close(bound)
                after = os.stat(path, follow_symlinks=False)
                if (after.st_dev, after.st_ino) != (info.st_dev, info.st_ino):
                    raise PermissionError("File identity changed")
            except BaseException:
                try:
                    checked(LIBC.umount2(os.fsencode(path), 2))
                except BaseException:
                    # The mount stays applied but unledgered; quarantine the
                    # path so acquisitions cannot borrow the anomaly.
                    self.quarantined.add(path)
                raise
            self.pins[path] = 1
            if read_only:
                self.readonly_pins.add(path)
        finally:
            os.close(fd)

    def tree(self, path, metadata_import, manifest, held):
        entries_limit = 100000 if metadata_import else 10000
        bytes_limit = 8 * 1024 * 1024 * 1024 if metadata_import else 64 * 1024 * 1024
        visited = 0
        total = 0
        stack = [(path, 0)]
        while stack:
            directory, depth = stack.pop()
            if depth > 64:
                raise ResourceLimit("Metadata depth limit exceeded")
            with os.scandir(directory) as listing:
                children = list(listing)
            for child in children:
                visited += 1
                if visited > entries_limit:
                    raise ResourceLimit("Metadata entry limit exceeded")
                is_link = child.is_symlink()
                is_dir = child.is_dir(follow_symlinks=False)
                is_file = child.is_file(follow_symlinks=False)
                info = child.stat(follow_symlinks=False)
                if is_link or not (is_dir or is_file):
                    raise PermissionError("Redirected metadata is unsupported")
                if is_dir:
                    self.pin(child.path)
                    size = 0
                    stack.append((child.path, depth + 1))
                else:
                    self.pin_leaf(child.path, True)
                    size = info.st_size
                held.append(child.path)
                if size > bytes_limit - total:
                    raise ResourceLimit("Snapshot byte limit exceeded")
                total += size
                manifest.append({"path": child.path, "directory": is_dir, "dev": str(info.st_dev), "ino": str(info.st_ino), "size": size})

    def remove_owned(self, path, dev, ino, empty, directory):
        self.components(path)
        if not isinstance(dev, str) or not isinstance(ino, str) or not re.fullmatch(r"\d+", dev) or not re.fullmatch(r"\d+", ino):
            raise PermissionError("Invalid ownership identity")
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            return  # Missing, replaced or busy: preserve it.
        is_dir = stat.S_ISDIR(info.st_mode)
        if stat.S_ISLNK(info.st_mode) or is_dir != directory or (not is_dir and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1)) or (dev, ino) != (str(info.st_dev), str(info.st_ino)):
            return
        if not is_dir and empty and info.st_size:
            return  # Keep a hot rollback journal as recovery evidence.
        self.drop_pin(path, writable_only=True)
        if is_dir:
            os.rmdir(path)
        else:
            os.unlink(path)

    def replace_owned(self, source, destination, dev, ino, expected_hash, target_dev, target_ino, target_hash):
        self.components(source)
        self.components(destination)
        if os.path.dirname(source) != os.path.dirname(destination):
            raise PermissionError("Replacement must remain in its guarded directory")
        for value in (dev, ino):
            if not isinstance(value, str) or not re.fullmatch(r"\d+", value):
                raise PermissionError("Invalid ownership identity")
        if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            raise PermissionError("Invalid source digest")

        def digest(fd):
            result = hashlib.sha256()
            while True:
                chunk = os.read(fd, 1024 * 1024)
                if not chunk:
                    break
                result.update(chunk)
            return result.hexdigest()

        fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or (dev, ino) != (str(info.st_dev), str(info.st_ino)):
                raise PermissionError("Replacement source identity changed")
            if digest(fd) != expected_hash:
                raise PermissionError("Replacement source bytes changed")
            if target_hash is not None:
                if not isinstance(target_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", target_hash) or not isinstance(target_dev, str) or not isinstance(target_ino, str):
                    raise PermissionError("Invalid destination identity")
                target = os.open(destination, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
                try:
                    target_info = os.fstat(target)
                    if not stat.S_ISREG(target_info.st_mode) or target_info.st_nlink != 1 or (target_dev, target_ino) != (str(target_info.st_dev), str(target_info.st_ino)) or target_info.st_size > 8 * 1024 * 1024:
                        raise PermissionError("Replacement destination identity changed")
                    if digest(target) != target_hash:
                        raise PermissionError("Replacement destination bytes changed")
                finally:
                    os.close(target)
            after = os.stat(source, follow_symlinks=False)
            if (after.st_dev, after.st_ino) != (info.st_dev, info.st_ino):
                raise PermissionError("Replacement source identity changed")
            self.drop_pin(source)
            self.drop_pin(destination, writable_only=True)
            os.replace(source, destination)
        finally:
            os.close(fd)

    def request(self, request):
        if not isinstance(request, dict) or not isinstance(request.get("id"), str) or len(request["id"]) > 128:
            raise PermissionError("Invalid guard request")
        command = request.get("command")
        if command == "hello" and set(request) == {"command", "id"}:
            return {"id": request["id"], "protocol": "gen-linux-directory-guard.v1", "root": self.root}
        if command == 'credential-prepare' and set(request) == {'command', 'id', 'authPath'}:
            self.prepare_credential(request['authPath'])
            return {'id': request['id']}
        if command == 'credential-acquire' and set(request) == {'command', 'id', 'authPath', 'maxHoldMs'}:
            identifier, mounts = self.acquire_credential(request['authPath'], request['maxHoldMs'])
            return {'id': request['id'], 'leaseId': identifier, 'mountIds': mounts}
        if command == 'credential-release' and set(request) == {'command', 'id', 'leaseId'}:
            self.release_credential(request['leaseId'])
            return {'id': request['id']}
        if command == "release" and set(request) == {"command", "id"}:
            if request["id"] not in self.groups:
                raise PermissionError("Unknown guard group")
            unresolved = self.release_paths(self.groups[request["id"]])
            if unresolved:
                # A cleanup refusal is not a release: the lease keeps
                # ownership of exactly the paths that stayed fenced so a
                # retry resumes without double-decrementing released ones.
                self.groups[request["id"]] = unresolved
                raise PermissionError("Guard cleanup did not settle")
            # Keep the id as a cleanup-only owner until ancillary credential
            # cleanup settles: a retry must resume the ancillary stage instead
            # of failing on an unknown group, and the empty ledger can neither
            # re-drop settled paths nor act as an ordinary acquisition.
            self.groups[request["id"]] = []
            pending = False
            if all(not held for held in self.groups.values()) and not self.barriers:
                # Credential ancestry pins are scope-scoped: drop them once no
                # guarded scope remains so fixture trees stay replaceable.
                for parent, prepared in list(self.credentials.items()):
                    unresolved = self.release_paths(prepared["held"])
                    if unresolved:
                        prepared["held"] = unresolved
                        pending = True
                    else:
                        os.close(prepared["fd"])
                        del self.credentials[parent]
            if pending:
                # Ancillary credential cleanup is explicitly uncertain — the
                # stage is not complete and the prepared entries keep custody.
                raise CustodyUncertain('Ancillary credential cleanup did not settle')
            del self.groups[request["id"]]
            return {"id": request["id"], "entries": []}
        elif command == "acquire" and set(request) == {"command", "id", "paths"}:
            entries = request["paths"]
            if not isinstance(entries, list) or not 0 < len(entries) <= 256 or request["id"] in self.groups:
                raise PermissionError("Invalid directory group")
            held = []
            manifest = []
            try:
                for entry in entries:
                    if (not isinstance(entry, dict)
                            or set(entry) - {"path", "leaf", "dev", "ino", "empty", "tree", "readOnly", "allowChildWrites", "childWriteRoot", "gitMetadataImport"}
                            or not isinstance(entry.get("leaf"), bool)
                            or entry.get("leaf") and entry.get("tree")
                            or entry.get("gitMetadataImport") and (not entry.get("tree") or entry.get("leaf") or not entry.get("readOnly"))):
                        raise PermissionError("Unsupported Linux guard policy")
                    path = entry["path"]
                    components = self.components(path)
                    if "childWriteRoot" in entry:
                        self.components(entry["childWriteRoot"])
                        if path != entry["childWriteRoot"] and not path.startswith(entry["childWriteRoot"] + "/"):
                            raise PermissionError("Invalid child write scope")
                    expected = None
                    if "dev" in entry or "ino" in entry:
                        if "dev" not in entry or "ino" not in entry:
                            raise PermissionError("Directory identity mismatch")
                        expected = (str(entry["dev"]), str(entry["ino"]))
                    if entry.get("leaf") and not os.path.isdir(path):
                        for part in components[:-1]:
                            self.pin(part)
                            held.append(part)
                        self.pin_leaf(path, bool(entry.get("readOnly")), expected, bool(entry.get("empty")))
                        held.append(path)
                    else:
                        # A non-leaf entry pins ancestors (and the path when it is a
                        # directory); the file itself is never pinned — matching the
                        # Windows guard, which leaves write targets unfenced.
                        allow_child = bool(entry.get("allowChildWrites"))
                        for index, part in enumerate(components):
                            last = index == len(components) - 1
                            if not last or allow_child or os.path.isdir(part):
                                self.pin(part)
                                held.append(part)
                        info = os.stat(path, follow_symlinks=False) if os.path.isdir(path) else None
                        if expected is not None and info is not None and expected != (str(info.st_dev), str(info.st_ino)):
                            raise PermissionError("Directory identity mismatch")
                        if entry.get("allowChildWrites") and info is not None:
                            marker = path + "/.harness-directory-guard"
                            try:
                                marker_fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
                                os.close(marker_fd)
                                os.chown(marker, info.st_uid, info.st_gid)
                            except FileExistsError:
                                pass
                            self.pin_leaf(marker, True)
                            held.append(marker)
                        if entry.get("tree") and info is not None:
                            self.tree(path, bool(entry.get("gitMetadataImport")), manifest, held)
                self.groups[request["id"]] = held
            except BaseException:
                self.record_unresolved(request["id"], self.release_paths(held))
                raise
            return {"id": request["id"], "entries": manifest}
        elif command == "removeOwned" and set(request) == {"command", "id", "path", "dev", "ino", "empty", "directory"}:
            self.remove_owned(request["path"], request["dev"], request["ino"], bool(request["empty"]), bool(request["directory"]))
            return {"id": request["id"], "entries": []}
        elif command == "replaceOwned" and (set(request) == {"command", "id", "source", "destination", "dev", "ino", "sha256"} or set(request) == {"command", "id", "source", "destination", "dev", "ino", "sha256", "targetDev", "targetIno", "targetSha256"}):
            self.replace_owned(request["source"], request["destination"], request["dev"], request["ino"], request["sha256"], request.get("targetDev"), request.get("targetIno"), request.get("targetSha256"))
            return {"id": request["id"], "entries": []}
        else:
            raise PermissionError("Unsupported guard operation")


def launch(options):
    root = options.state_root
    backing = private_profile(root, options.uid, options.gid)
    guard = DirectoryGuard(root, options.uid)
    guard.pin(root)  # Profile identity remains anchored for the process lifetime.
    checked(LIBC.prctl(36, 1, 0, 0, 0))  # CHILD_SUBREAPER: keep pins until descendants are gone.
    parent, child = socket.socketpair()
    channel_fd = fcntl.fcntl(child.fileno(), fcntl.F_DUPFD_CLOEXEC, 10)
    backing_fd = fcntl.fcntl(backing, fcntl.F_DUPFD_CLOEXEC, 10)
    pid = os.fork()
    if pid == 0:
        try:
            os.dup2(channel_fd, 3, inheritable=True)
            os.dup2(backing_fd, 4, inheritable=True)
            os.closerange(5, os.sysconf("SC_OPEN_MAX"))
            os.setsid()
            os.setgroups([])
            for capability in range(64):
                if LIBC.prctl(24, capability, 0, 0, 0) != 0 and ctypes.get_errno() != errno.EINVAL:
                    raise PermissionError("Cannot drop capability bounding set")
            os.setresgid(options.gid, options.gid, options.gid)
            os.setresuid(options.uid, options.uid, options.uid)
            checked(LIBC.prctl(38, 1, 0, 0, 0))  # NO_NEW_PRIVS
            env = dict(os.environ)
            for name in ("NODE_OPTIONS", "NODE_PATH", "NODE_CHANNEL_FD", "ELECTRON_RUN_AS_NODE"):
                env.pop(name, None)
            env.update(HOME=root, USERPROFILE=root, HARNESS_COMPANY_DATA_DIR=root, HARNESS_HERMES_PYTHON=sys.executable)
            os.chdir(root)
            os.execve(options.command[0], options.command, env)
        except BaseException:
            os.write(2, b"The unprivileged Gen process could not start.\n")
            os._exit(1)
    child.close()
    os.close(channel_fd)
    os.close(backing_fd)
    os.close(backing)
    stopped = None
    deadline = None

    def terminate(_signal=None, _frame=None):
        nonlocal deadline
        deadline = deadline or time.monotonic() + 10
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    signal.signal(signal.SIGTERM, terminate)
    signal.signal(signal.SIGINT, terminate)
    selector = selectors.DefaultSelector()
    selector.register(parent, selectors.EVENT_READ)
    buffer = b""
    connected = True
    channel_lost_at = None
    while True:
        while True:
            try:
                ended, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                return stopped if stopped is not None else 1
            if not ended:
                break
            if ended == pid:
                stopped = os.waitstatus_to_exitcode(status)
                deadline = time.monotonic() + 10
        if channel_lost_at is not None and stopped is None and deadline is None and time.monotonic() - channel_lost_at >= 0.5:
            terminate()
        if deadline:
            with open(f"/proc/self/task/{os.getpid()}/children", encoding="ascii") as children:
                for value in children.read().split():
                    try:
                        os.kill(int(value), signal.SIGKILL if time.monotonic() >= deadline else signal.SIGTERM)
                    except ProcessLookupError:
                        pass
        for key, _ in selector.select(0.1):
            data = key.fileobj.recv(LIMIT + 1)
            if not data:
                selector.unregister(parent)
                connected = False
                # Node closes inherited descriptors just before normal process exit.
                # Keep every mount pinned while allowing that exit to settle.
                channel_lost_at = time.monotonic()
                continue
            buffer += data
            if len(buffer) > LIMIT:
                raise PermissionError("Guard request limit")
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                request = json.loads(line)
                try:
                    reply = guard.request(request)
                except CustodyUncertain:
                    reply = {"id": request.get("id"), "error": "CREDENTIAL_BARRIER_UNCERTAIN"}
                except ResourceLimit as error:
                    reply = {"id": request.get("id"), "error": "RESOURCE_LIMIT", "message": str(error)}
                except PermissionError as error:
                    reply = {"id": request.get("id"), "error": "CAPABILITY_DENIED", "message": str(error)}
                except (OSError, ValueError, KeyError, TypeError, StopIteration):
                    reply = {"id": request.get("id"), "error": "CAPABILITY_DENIED"}
                if connected:
                    parent.sendall(json.dumps(reply, ensure_ascii=True).encode("ascii") + b"\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Trusted Linux directory-custody setup; no inference authority")
    parser.add_argument("--uid", type=int, required=True)
    parser.add_argument("--gid", type=int, required=True)
    parser.add_argument("--state-root", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command[:1] == ["--"]:
        args.command = args.command[1:]
    if not args.command or not os.path.isabs(args.command[0]):
        parser.error("An absolute verified Node command is required")
    try:
        sys.exit(launch(args))
    except Exception:
        # Never serialize configuration, credential paths or native exception data.
        os.write(2, b"Trusted Linux directory custody could not be established.\n")
        sys.exit(1)
