from pathlib import Path
import hashlib
import subprocess

root = Path('/workspace/scratch/1b47eb428672/m15-publication/c4/review-admission-01')
repo = Path('/workspace/scratch/1b47eb428672/m15-v3')
report = root / 'application.json'
helper = root / 'apply-admission.py'
assert root.resolve(strict=True) == root
assert all(not parent.is_symlink() for parent in report.parents)
assert report.resolve() == report and not report.is_relative_to(repo.resolve(strict=True))
assert not report.exists() and not report.is_symlink()
assert hashlib.sha256(helper.read_bytes()).hexdigest() == '7e443d3f85bba57bea8a052c17991a1dcd76ba79c74d23a3cd424b54e5d91d8f'
subprocess.run(['python3', str(helper), '--manifest', str(root / 'admission-manifest.json'),
    '--expect-sha256', '148aae6ebca4aee6295598ce98acf53e8280dec80ae0d55f1339aef20a71da2f',
    '--repo', str(repo), '--report', str(report), '--apply'], check=True)
