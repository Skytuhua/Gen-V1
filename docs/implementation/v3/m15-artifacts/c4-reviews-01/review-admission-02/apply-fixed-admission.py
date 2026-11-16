#!/usr/bin/env python3
"""One fixed, reviewed additive copy. Default is read-only; --apply is explicit."""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import stat
import subprocess
import sys

REPO = Path('/workspace/scratch/1b47eb428672/m15-v3')
SOURCE_ROOT = Path('/workspace/scratch/1b47eb428672/m15-publication')
HERE = SOURCE_ROOT / 'c4/review-admission-02'
SELF = HERE / 'apply-fixed-admission.py'
RESULT = HERE / 'application.json'
DEST_ROOT = REPO / 'docs/implementation/v3/m15-artifacts/c4-reviews-01'
EXPECTED_HEAD = 'eeda4a89879aa1f3baaa04e60dd4a2d9c520761c'
CUT = REPO / 'docs/implementation/v3/m15-artifacts/c4-validation-final-03/source-cut.json'
CUT_SHA = '0c4ceab16a33448876d38b5a3d4e1877c0adf7d267cb587dfa60853db21ff260'
PRIOR = SOURCE_ROOT / 'c4/review-admission-01/admission-manifest.json'
PRIOR_SHA = '148aae6ebca4aee6295598ce98acf53e8280dec80ae0d55f1339aef20a71da2f'
MANIFESTS = (
    ('admission-manifest.json', '0f3587320e84e918195ac3001ed70feebddac33b5354b989fc93fd937e626a9c', 36, 1336448),
    ('final-addendum-manifest.json', '60f98c3019ca2792fbb23bad4599893fc77039c4dfb35d524e2d43862d5980b9', 5, 1062071),
    ('metadata-admission-manifest.json', 'ba5691f6c1c5a1e38027fff8a907e275b1c21311460dcfed4d489efae50a9d43', 2, 19888),
)
TOTAL_FILES, TOTAL_BYTES = 43, 2418407
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
READ_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
CREATE_FLAGS = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(path):
    path = Path(path)
    require(path.is_absolute() and str(path) == os.path.normpath(str(path)), 'Noncanonical absolute path')
    require(path.resolve(strict=False) == path, 'Symlink or noncanonical ancestor: ' + str(path))
    return path


def parent_fd(path, create=False, made_dirs=None):
    """Open every ancestor without following symlinks; create only review subdirs."""
    path = canonical(path)
    fd, prefix = os.open('/', DIR_FLAGS), Path('/')
    try:
        for part in path.parent.parts[1:]:
            prefix = prefix / part
            try:
                next_fd = os.open(part, DIR_FLAGS, dir_fd=fd)
            except FileNotFoundError:
                if not create:
                    raise
                require(prefix.is_relative_to(DEST_ROOT), 'Missing protected ancestor: ' + str(prefix))
                try:
                    os.mkdir(part, 0o755, dir_fd=fd)
                    if made_dirs is not None:
                        made_dirs.append(prefix)
                except FileExistsError:
                    pass
                next_fd = os.open(part, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_regular(path, limit=None):
    fd_parent = parent_fd(path)
    try:
        fd = os.open(Path(path).name, READ_FLAGS, dir_fd=fd_parent)
    finally:
        os.close(fd_parent)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode), 'Not a regular file: ' + str(path))
        if limit is not None:
            require(before.st_size <= limit, 'Unexpected file size: ' + str(path))
        chunks, size = [], 0
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            require(limit is None or size <= limit, 'File grew while reading: ' + str(path))
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'File changed while reading: ' + str(path))
        return b''.join(chunks), stat.S_IMODE(after.st_mode)
    finally:
        os.close(fd)


def absent(path):
    try:
        fd = parent_fd(path)
    except FileNotFoundError:
        return
    try:
        try:
            os.stat(Path(path).name, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        raise RuntimeError('Destination already exists: ' + str(path))
    finally:
        os.close(fd)


def checked_json(path, wanted):
    data, _ = read_regular(path, 2 * 1024 * 1024)
    require(digest(data) == wanted, 'Manifest/source-cut digest differs: ' + str(path))
    return json.loads(data)


def relative_name(value):
    require(isinstance(value, str) and value and '\\' not in value, 'Invalid relative path')
    path = PurePosixPath(value)
    require(not path.is_absolute() and path.as_posix() == value and all(x not in ('', '.', '..', '.git') for x in path.parts), 'Noncanonical relative path')
    return value


def validate_entry(entry, destination_must_be_new=True):
    require(set(entry) == {'src', 'dest', 'sha256', 'bytes', 'sourceMode', 'role'}, 'Unexpected entry fields')
    src = canonical(Path(entry['src']))
    require(str(src) == entry['src'] and src.is_relative_to(SOURCE_ROOT), 'Source outside fixed evidence root')
    dest = canonical(REPO / relative_name(entry['dest']))
    require(dest.is_relative_to(DEST_ROOT) and dest != DEST_ROOT, 'Destination outside fixed review root')
    require(entry['sourceMode'] == 0o644 and type(entry['bytes']) is int and entry['bytes'] >= 0, 'Unexpected mode or size')
    data, mode = read_regular(src, entry['bytes'])
    require(len(data) == entry['bytes'] and digest(data) == entry['sha256'] and mode == entry['sourceMode'], 'Source identity differs: ' + str(src))
    data.decode('utf-8')
    require(b'\0' not in data, 'Unexpected binary evidence')
    if destination_must_be_new:
        absent(dest)
    return dest, data, mode


def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO)


def identity():
    head = git('rev-parse', 'HEAD').decode().strip()
    require(head == EXPECTED_HEAD, 'Local HEAD changed')
    index = canonical(Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip()))
    data, _ = read_regular(index)
    return {'head': head, 'indexSha256': digest(data)}


def verify_source(cut):
    require(cut['schemaVersion'] == 2 and cut['head'] == EXPECTED_HEAD and
            cut['acceptedBase'] == 'b4aa2caa5a3cedb29a0fddb510e49b5abd802a73', 'Wrong tested cut identity')
    names = sorted({x.decode() for x in git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split(b'\0') if x and not x.startswith(b'docs/')})
    require(names == [x['path'] for x in cut['files']], 'Non-documentation source membership changed')
    total = 0
    for entry in cut['files']:
        name = relative_name(entry['path'])
        require(not name.startswith('docs/') and entry['kind'] == 'regular', 'Unexpected tested source kind')
        data, mode = read_regular(REPO / name, entry['bytes'])
        require(len(data) == entry['bytes'] and digest(data) == entry['sha256'] and mode == int(entry['mode'], 8), 'Tested source changed: ' + name)
        total += len(data)
    require(len(names) == 2391 and total == 55491032, 'Tested cut totals differ')
    return {'sha256': CUT_SHA, 'files': len(names), 'bytes': total}


def verify_prior(prior):
    require(prior['fileCount'] == 134 and prior['totalBytes'] == 1163319, 'Prior admission totals differ')
    for entry in prior['files']:
        path = canonical(REPO / relative_name(entry['dest']))
        require(path.is_relative_to(REPO / 'docs/implementation/v3/m15-artifacts'), 'Unexpected prior destination')
        data, mode = read_regular(path, entry['bytes'])
        require(len(data) == entry['bytes'] and digest(data) == entry['sha256'] and mode == entry['sourceMode'], 'Prior admitted evidence changed: ' + entry['dest'])


def create_file(path, data, mode, created, made_dirs, allowed):
    require(path in allowed or path == RESULT, 'Write outside fixed approved destinations')
    absent(path)
    fd_parent = parent_fd(path, create=path != RESULT, made_dirs=made_dirs)
    try:
        fd = os.open(path.name, CREATE_FLAGS, mode, dir_fd=fd_parent)
    finally:
        os.close(fd_parent)
    created.append((path, digest(data), len(data), mode))
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    actual, actual_mode = read_regular(path, len(data))
    require(actual == data and actual_mode == mode, 'Written evidence differs: ' + str(path))


def cleanup(created, made_dirs):
    retained = []
    for path, wanted, length, mode in reversed(created):
        try:
            data, actual_mode = read_regular(path, length)
            require(digest(data) == wanted and len(data) == length and actual_mode == mode, 'Changed new file')
            fd = parent_fd(path)
            try:
                os.unlink(path.name, dir_fd=fd)
            finally:
                os.close(fd)
        except Exception:
            retained.append(str(path))
    for path in reversed(made_dirs):
        try:
            fd = parent_fd(path)
            try:
                os.rmdir(path.name, dir_fd=fd)
            finally:
                os.close(fd)
        except Exception:
            retained.append(str(path))
    return retained


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply only the three fixed sealed manifests')
    args = parser.parse_args()
    require(canonical(Path(__file__)) == SELF, 'Helper invoked through a different path')
    require(not RESULT.is_relative_to(REPO) and RESULT.parent == HERE, 'Result path is not the fixed outside path')
    absent(RESULT)
    before = identity()
    prior = checked_json(PRIOR, PRIOR_SHA)
    verify_prior(prior)
    cut = checked_json(CUT, CUT_SHA)
    source = verify_source(cut)
    entries, selected = [], []
    for name, wanted, count, total in MANIFESTS:
        manifest = checked_json(HERE / name, wanted)
        require(manifest['schemaVersion'] == 1 and manifest['kind'] == 'EXPLICIT_NEW_FILE_ADMISSION', 'Unexpected manifest schema')
        require(manifest['repository'] == str(REPO) and manifest['sourceRoot'] == str(SOURCE_ROOT) and manifest['expectedHead'] == EXPECTED_HEAD, 'Manifest scope differs')
        require(manifest['fileCount'] == count == len(manifest['files']) and manifest['totalBytes'] == total == sum(x['bytes'] for x in manifest['files']), 'Manifest totals differ')
        for entry in manifest['files']:
            entries.append(entry)
            selected.append(validate_entry(entry))
    names = [entry['dest'] for entry in entries]
    require(len(names) == len(set(names)) == TOTAL_FILES and sum(len(x[1]) for x in selected) == TOTAL_BYTES, 'Combined admission differs')
    require(not set(names).intersection(x['dest'] for x in prior['files']), 'New admission overlaps prior evidence')
    allowed = {x[0] for x in selected}
    report = {'schemaVersion': 1, 'operation': 'APPLY' if args.apply else 'PREFLIGHT_ONLY', 'status': 'PASS',
              'manifestDigests': {name: wanted for name, wanted, _, _ in MANIFESTS}, 'files': TOTAL_FILES, 'bytes': TOTAL_BYTES,
              'sourceCut': source, 'before': before, 'prior134Preserved': True, 'publicManifestModified': False,
              'indexWrites': 0, 'sourceWrites': 0, 'remoteMutations': 0}
    if not args.apply:
        require(identity() == before, 'HEAD/index changed during preflight')
        print(json.dumps(report, indent=2))
        return
    created, made_dirs = [], []
    try:
        for path, data, mode in selected:
            create_file(path, data, mode, created, made_dirs, allowed)
        verify_prior(prior)
        require(verify_source(cut) == source, 'Source changed during admission')
        require(digest(read_regular(CUT)[0]) == CUT_SHA, 'Tested source-cut record changed')
        after = identity()
        require(after == before, 'HEAD/index changed during admission')
        for path, wanted, length, mode in created:
            data, actual_mode = read_regular(path, length)
            require(digest(data) == wanted and len(data) == length and actual_mode == mode, 'Created evidence changed')
        report.update({'after': after, 'repositoryWrites': len(created), 'sourceUnchanged': True,
                       'completedAt': datetime.now(timezone.utc).isoformat()})
        create_file(RESULT, (json.dumps(report, indent=2)+'\n').encode(), 0o644, [], [], set())
        print(json.dumps(report, indent=2))
    except Exception as exc:
        retained = cleanup(created, made_dirs)
        failure = {'schemaVersion': 1, 'operation': 'APPLY', 'status': 'FAIL', 'error': str(exc),
                   'retainedNewFiles': retained, 'priorEvidenceOverwritten': False, 'indexWrites': 0, 'sourceWrites': 0}
        try:
            create_file(RESULT, (json.dumps(failure, indent=2)+'\n').encode(), 0o644, [], [], set())
        except Exception as report_error:
            failure['fixedReportError'] = str(report_error)
        print(json.dumps(failure, indent=2), file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
