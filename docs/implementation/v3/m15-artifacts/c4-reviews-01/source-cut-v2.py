import argparse, hashlib, json, os, pathlib, subprocess

p = argparse.ArgumentParser()
p.add_argument('mode', choices=['capture', 'verify'])
p.add_argument('path')
p.add_argument('--repo', default='/workspace/scratch/1b47eb428672/m15-v3')
p.add_argument('--accepted-base', default='b4aa2caa5a3cedb29a0fddb510e49b5abd802a73')
a = p.parse_args()
root = pathlib.Path(a.repo)
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root)

paths = sorted(set(x.decode() for x in git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split(b'\0') if x))
files = []
for name in paths:
    if name.startswith('docs/'):
        continue
    path = root / name
    info = path.lstat()
    if path.is_symlink():
        data = os.readlink(path).encode()
        kind = 'symlink'
    elif path.is_file():
        data = path.read_bytes()
        kind = 'regular'
    else:
        raise RuntimeError('Unexpected source entry: ' + name)
    files.append({'path': name, 'kind': kind, 'mode': oct(info.st_mode & 0o777), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
subprocess.run(['git', 'merge-base', '--is-ancestor', a.accepted_base, 'HEAD'], cwd=root, check=True)
value = {
    'schemaVersion': 2,
    'scope': 'All tracked and nonignored untracked repository paths outside docs; dependencies and generated ignored assets retain separate setup provenance. The parent and accepted main base are explicit; no pending merge is required.',
    'head': git('rev-parse', 'HEAD').decode().strip(),
    'acceptedBase': a.accepted_base,
    'files': files,
}
target = pathlib.Path(a.path)
if a.mode == 'capture':
    target.parent.mkdir(parents=True, exist_ok=True)
    target.open('x').write(json.dumps(value, indent=2) + '\n')
else:
    expected = json.loads(target.read_bytes())
    if expected != value:
        old = {x['path']: x for x in expected['files']}
        new = {x['path']: x for x in files}
        changed = sorted(k for k in old.keys() | new.keys() if old.get(k) != new.get(k))
        raise RuntimeError('Source changed during execution: ' + json.dumps(changed))
print(json.dumps({'mode': a.mode, 'sourceFiles': len(files), 'bytes': sum(x['bytes'] for x in files), 'sourceCutSha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'head': value['head'], 'acceptedBase': value['acceptedBase']}))
