import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess

BASE = 'b4aa2caa5a3cedb29a0fddb510e49b5abd802a73'
ORIGINAL = '399cde39ff4ee82272c7a7700944325c44b36070'
PREFIX = 'docs/implementation/v3/'
ARTIFACTS = PREFIX + 'm15-artifacts/'
LOGS = PREFIX + 'm15-logs/'
TESTED_PARENT = 'eeda4a89879aa1f3baaa04e60dd4a2d9c520761c'
PUBLISHED_PARENT = '98db97d1d0a1910f47879f0e3d54477bcc59feed'
PUBLICATION_DELTA_ARCHIVE = ARTIFACTS + 'external-publication-cut-98db97d/archive-manifest.json'
PUBLICATION_DELTA_ARCHIVE_SHA256 = '37ea9450c8c2667eb2d8ae409c2ca6c6851257c0be64778aed98698bb2fe4954'
PUBLICATION_DELTA_PATHS = [PREFIX + 'M15-source-cut.json', PREFIX + 'M15-validation-summary.json']
ARCHIVES = [
    ('publication-cut-01', 'fd17d9f1b3931eb2b974b86ccc5a3892da47ba33', 16),
    ('publication-cut-02', 'a1349b0a7ffa1420566da9c7770faf80d6be5bf3', 17),
    ('publication-cut-03', '3f68a8f1bc1ca5a588862571d905163861e94492', 18),
    ('external-publication-cut-0f487aa', '0f487aa82fba616131d7f9e547076d3a14d67f48', 34),
    ('external-publication-cut-364d3f5', '364d3f552c23668c3894d04f4a6443808cc2b17a', 20),
    ('external-publication-cut-0822648', '082264877e3bb61e8c87f257ccd831b5c1438472', 22),
]

parser = argparse.ArgumentParser()
parser.add_argument('--parent', required=True)
parser.add_argument('--published-parent', required=True)
parser.add_argument('--tested-cut', type=Path, required=True)
parser.add_argument('--tested-cut-sha256', required=True)
parser.add_argument('--tested-public-manifest', type=Path, required=True)
args = parser.parse_args()
root = Path.cwd()
original = root.parent / 'gen-v1'
env = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}

def require(value, message):
    if not value:
        raise RuntimeError(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(*argv, cwd=root):
    return subprocess.check_output(['git', *argv], cwd=cwd, env=env)

def rev(value, cwd=root):
    return git('rev-parse', value, cwd=cwd).decode().strip()

def read_tree(commit):
    result = {}
    for raw in git('ls-tree', '-r', '-z', commit).split(b'\0'):
        if not raw:
            continue
        header, name = raw.split(b'\t', 1)
        mode, kind, oid = header.decode().split()
        result[name.decode()] = (mode, kind, oid)
    return result

require(args.parent == TESTED_PARENT, 'Unexpected tested-context parent.')
require(args.published_parent == PUBLISHED_PARENT, 'Unexpected published parent.')
require(rev('HEAD') == args.parent, 'Tested-context HEAD changed.')
require(git('rev-list', '--parents', '-n', '1', args.published_parent).decode().split() == [args.published_parent, args.parent], 'Published parent is not the exact admitted direct child.')
subprocess.run(['git', 'merge-base', '--is-ancestor', args.parent, args.published_parent], check=True, env=env)
require(not Path(git('rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD').decode().strip()).exists(), 'Unexpected unfinished merge.')
require(not git('ls-files', '-u'), 'Unresolved index entries.')
subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, args.parent], check=True, env=env)
require(rev('HEAD', original) == ORIGINAL and not git('status', '--porcelain', cwd=original), 'Original checkout changed.')
lock = sha(Path('pnpm-lock.yaml').read_bytes())
ci = sha(Path('.github/workflows/ci.yml').read_bytes())
require(lock == '2269337714e848fd47cca88f898e6d9fd5f70e276a04061e435546ddc9eb9fb9', 'Lockfile changed.')
require(ci == '49c2af68e504addc4e4ecf01f1ac2bd5f2f9d1c9c82dd56afbc47a69d48aa804', 'Ordinary CI changed.')

archives = []
for folder, commit, count in ARCHIVES:
    path = Path(ARTIFACTS) / folder / 'archive-manifest.json'
    raw = path.read_bytes()
    manifest = json.loads(raw)
    require(manifest.get('sourceCommit', manifest.get('publishedCommit')) == commit, 'Archive commit differs: ' + folder)
    require(manifest.get('sourceTree', manifest.get('publishedTree')) == rev(commit + '^{tree}'), 'Archive tree differs: ' + folder)
    tree = read_tree(commit)
    rows = manifest['files']
    sources = [row.get('sourcePath', row.get('path')) for row in rows]
    required = {name for name in tree if Path(name).parent.as_posix() == PREFIX.rstrip('/') and Path(name).name.startswith('M15-')}
    historical_ids = {
        'external-publication-cut-0f487aa': ['reconcile-lint', 'reconcile-typecheck', 'reconcile-focused-vitest', 'reconcile-e2e-workbench', 'reconcile-e2e-workbench-app', 'reconcile-e2e-chat-view-modes', 'reconcile-e2e-saved-drafts', 'reconcile-full-vitest'],
        'external-publication-cut-364d3f5': ['reconcile-full-vitest'],
        'external-publication-cut-0822648': ['reconcile-full-vitest', 'reconcile-linux-vitest'],
    }.get(folder, [])
    required |= {LOGS + identifier + suffix for identifier in historical_ids for suffix in ['.json', '.log']}
    require(len(rows) == count and len(set(sources)) == count and required == set(sources), 'Archive membership differs: ' + folder)
    for row, source in zip(rows, sources):
        destination_name = row.get('archivedPath', row.get('archive'))
        destination = Path(destination_name)
        require(source.startswith(PREFIX), 'Unexpected archive source prefix.')
        expected_destination = path.parent / source.removeprefix(PREFIX)
        require(destination_name == expected_destination.as_posix(), 'Noncanonical archive destination.')
        require(not any(parent.is_symlink() for parent in destination.parents if parent != Path('.')), 'Archive parent is a symlink.')
        require(stat.S_ISREG(destination.lstat().st_mode), 'Archive entry is not a regular file.')
        data = destination.read_bytes()
        require(len(data) == row['bytes'] and sha(data) == row['sha256'], 'Archive digest differs: ' + str(destination))
        require(data == git('show', commit + ':' + source), 'Archive differs from published bytes: ' + source)
        if 'blob' in row:
            require((row['mode'], row['kind'], row['blob']) == tree[source], 'Archive Git identity differs: ' + source)
    archives.append({'path': str(path), 'sourceCommit': commit, 'files': count, 'sha256': sha(raw)})

# This is an exact two-document publication delta, not a general source-drift allowance.
tested_tree = read_tree(args.parent)
published_tree = read_tree(args.published_parent)
delta_paths = sorted(name for name in set(tested_tree) | set(published_tree) if tested_tree.get(name) != published_tree.get(name))
require(delta_paths == PUBLICATION_DELTA_PATHS, 'Incoming publication delta exceeds the admitted two documentation paths.')
delta_path = Path(PUBLICATION_DELTA_ARCHIVE)
require(not any(parent.is_symlink() for parent in delta_path.parents if parent != Path('.')), 'Publication delta archive parent is a symlink.')
require(stat.S_ISREG(delta_path.lstat().st_mode), 'Publication delta manifest is not a regular file.')
delta_raw = delta_path.read_bytes()
require(sha(delta_raw) == PUBLICATION_DELTA_ARCHIVE_SHA256, 'Publication delta manifest digest differs.')
delta = json.loads(delta_raw)
require(type(delta.get('schemaVersion')) is int and delta['schemaVersion'] == 1 and delta.get('kind') == 'EXACT_INCOMING_DOCUMENT_DELTA', 'Publication delta manifest schema differs.')
require(delta.get('sourceCommit') == args.published_parent and delta.get('sourceTree') == rev(args.published_parent + '^{tree}') and delta.get('previousCommit') == args.parent, 'Publication delta identity differs.')
require(delta.get('deltaPaths') == PUBLICATION_DELTA_PATHS and delta.get('productSourceDelta') == [] and delta.get('testExecutionCreated') is False, 'Publication delta scope differs.')
delta_rows = delta['files']
require(len(delta_rows) == 2 and [row['sourcePath'] for row in delta_rows] == PUBLICATION_DELTA_PATHS, 'Publication delta archive membership differs.')
for row in delta_rows:
    source = row['sourcePath']
    expected_destination = delta_path.parent / source.removeprefix(PREFIX)
    require(row['archivedPath'] == expected_destination.as_posix(), 'Noncanonical publication delta destination.')
    destination = Path(row['archivedPath'])
    require(not any(parent.is_symlink() for parent in destination.parents if parent != Path('.')), 'Publication delta destination parent is a symlink.')
    info = destination.lstat()
    identity = published_tree[source]
    require(identity[1] == 'blob' and identity[0] in ('100644', '100755') and (row['mode'], row['kind'], row['blob']) == identity, 'Publication delta Git identity differs: ' + source)
    require(stat.S_ISREG(info.st_mode) and bool(info.st_mode & 0o111) == (identity[0] == '100755'), 'Publication delta destination type/mode differs: ' + source)
    data = destination.read_bytes()
    require(len(data) == row['bytes'] and sha(data) == row['sha256'], 'Publication delta archive bytes/digest differ: ' + source)
    require(data == git('show', args.published_parent + ':' + source), 'Publication delta archive differs from exact Git bytes: ' + source)
publication_delta = {'path': PUBLICATION_DELTA_ARCHIVE, 'sha256': sha(delta_raw), 'previousCommit': args.parent,
    'sourceCommit': args.published_parent, 'sourceTree': rev(args.published_parent + '^{tree}'),
    'files': 2, 'deltaPaths': delta_paths, 'testExecutionCreated': False}

entries = {}
for row in git('ls-files', '--stage', '-z').split(b'\0'):
    if row:
        header, name = row.split(b'\t', 1)
        mode, oid, stage = header.decode().split()
        require(stage == '0', 'Unmerged entry.')
        entries[name.decode()] = (mode, oid)
retained = 0
for name, (mode, kind, oid) in published_tree.items():
    if not name.startswith((LOGS, ARTIFACTS)):
        continue
    require(kind == 'blob' and mode in ('100644', '100755'), 'Unexpected historical file mode.')
    require(entries.get(name) == (mode, oid), 'Published evidence index changed: ' + name)
    path = Path(name)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and bool(info.st_mode & 0o111) == (mode == '100755'), 'Published evidence type/mode changed: ' + name)
    data = path.read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    require(actual == oid, 'Published evidence bytes changed: ' + name)
    retained += 1

cut_raw = args.tested_cut.read_bytes()
require(sha(cut_raw) == args.tested_cut_sha256, 'Tested cut digest differs.')
cut = json.loads(cut_raw)
require(cut['head'] == args.parent and cut['acceptedBase'] == BASE, 'Tested cut identity differs.')
names = {x.decode() for x in git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split(b'\0') if x}
current_source = {name for name in names if not name.startswith('docs/') and name != 'scripts/public-source-files.json'}
tested_source = {row['path'] for row in cut['files'] if row['path'] != 'scripts/public-source-files.json'}
require(current_source == tested_source, 'Non-document source membership differs after validation.')
for row in cut['files']:
    if row['path'] == 'scripts/public-source-files.json':
        continue
    path = Path(row['path'])
    info = path.lstat()
    kind = 'symlink' if stat.S_ISLNK(info.st_mode) else 'regular' if stat.S_ISREG(info.st_mode) else 'other'
    data = os.readlink(path).encode() if kind == 'symlink' else path.read_bytes()
    require((kind, oct(info.st_mode & 0o777), len(data), sha(data)) == (row['kind'], row['mode'], row['bytes'], row['sha256']), 'Tested source changed: ' + row['path'])

manifest = json.loads(Path('scripts/public-source-files.json').read_bytes())
tested_manifest_raw = args.tested_public_manifest.read_bytes()
cut_manifest = [row for row in cut['files'] if row['path'] == 'scripts/public-source-files.json']
require(len(cut_manifest) == 1 and sha(tested_manifest_raw) == cut_manifest[0]['sha256'], 'Tested public manifest preimage differs.')
tested_manifest = json.loads(tested_manifest_raw)
require(set(manifest) == set(tested_manifest) == {'version', 'source', 'runtime'}, 'Public manifest schema changed.')
require(type(manifest['version']) is int and type(tested_manifest['version']) is int and manifest['version'] == tested_manifest['version'] == 1, 'Public manifest version changed.')
require(manifest['runtime'] == tested_manifest['runtime'], 'Runtime admission membership changed after testing.')
require(set(tested_manifest['source']) <= set(manifest['source']), 'Previously admitted source paths were removed.')
for key in ['source', 'runtime']:
    require(manifest[key] == sorted(set(manifest[key])), 'Public manifest is not sorted and unique.')
    for name in manifest[key]:
        require(isinstance(name, str) and name and len(name) <= 1024 and not any(ord(char) < 32 or ord(char) == 127 or char in '\\:%?#*<>|"' for char in name), 'Invalid public path syntax.')
        require(not name.startswith('/') and all(part and part not in ('.', '..') and part[-1] not in '. ' for part in name.split('/')), 'Noncanonical public path.')
require(set(manifest['runtime']) <= set(manifest['source']), 'Runtime is not a source subset.')
require(len(manifest['runtime']) == 228, 'Runtime admission changed without review.')
require(Path('scripts/public-source.ts').read_bytes() == git('show', BASE + ':scripts/public-source.ts'), 'Public source admission contract changed.')
changed = set(git('diff', '--name-only', BASE).decode().splitlines()) | set(git('ls-files', '--others', '--exclude-standard').decode().splitlines())
require(changed <= set(manifest['source']), 'Current changed paths missing explicit admission: ' + str(sorted(changed - set(manifest['source']))))
subprocess.run(['git', '-c', 'core.whitespace=cr-at-eol', 'diff', '--check', BASE, '--', '.', ':(exclude)' + LOGS + '**', ':(exclude)' + ARTIFACTS + '**'], env=env, check=True)
print(json.dumps({'status': 'PASS', 'originalCheckout': 'clean', 'originalHead': ORIGINAL, 'parent': args.parent,
    'testedContextHead': args.parent, 'publishedParent': args.published_parent, 'incomingPublicationDelta': publication_delta,
    'acceptedBase': BASE, 'archives': archives, 'publishedEvidenceFilesUnchanged': retained,
    'lockfileSha256': lock, 'ordinaryCiSha256': ci, 'testedCutSha256': args.tested_cut_sha256,
    'testedNonManifestSourceFilesUnchanged': len(current_source), 'publicSourceEntries': len(manifest['source']),
    'publicRuntimeEntries': len(manifest['runtime']), 'allCurrentChangesAdmitted': True,
    'authoredWhitespace': 'PASS', 'sourceContinuityLimit': 'Only the explicit public source manifest may change after this tested cut; documentation is separately hashed by the evidence controller.'}, indent=2))
