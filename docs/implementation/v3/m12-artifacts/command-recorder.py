import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import subprocess
import sys
import time

root = Path('/workspace/scratch/dbebe44a9817/m12-v3')
os.environ['PATH'] = '<tmp>/m12-bin:' + os.environ['PATH']
cwd = Path(os.environ.get('M12_COMMAND_CWD', str(root)))
logs = root / 'docs/implementation/v3/m12-logs'
records = Path('<tmp>/m12-command-records')
logs.mkdir(parents=True, exist_ok=True)
records.mkdir(parents=True, exist_ok=True)
identifier, seconds, *argv = sys.argv[1:]
assert re.fullmatch(r'[a-z0-9-]+', identifier)
assert argv
assert not (logs / (identifier + '.log')).exists(), 'Never overwrite an attempt'
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
deadline = time.monotonic() + float(seconds)
termination = 'NONE'
output = bytearray()
limit = 32768
truncated = False
resolved = shutil.which(argv[0])
try:
    process = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    while selector.get_map():
        if time.monotonic() > deadline and process.poll() is None:
            termination = 'TIMEOUT'
            os.killpg(process.pid, signal.SIGKILL)
        for key, _ in selector.select(timeout=0.2):
            chunk = os.read(key.fd, 65536)
            if not chunk:
                selector.unregister(key.fileobj)
                continue
            output.extend(chunk)
            if len(output) > limit:
                output = output[:limit // 2] + output[-limit // 2:]
                truncated = True
            live = Path('<tmp>/m12-running-logs'); live.mkdir(exist_ok=True)
            (live / (identifier + '.txt')).write_bytes(output)
    code = process.wait()
except OSError as error:
    termination = 'SPAWN_ERROR'
    code = None
    output = bytearray(str(error).encode())
ended = datetime.datetime.now(datetime.timezone.utc).isoformat()
body = output.decode('utf-8', errors='replace')
body = re.sub(r'(?i)(authorization\s*:\s*(?:bearer|token)\s+)\S+', r'\1[REDACTED]', body)
body = re.sub(r'(https?://)[^/@\s]+:[^/@\s]+@', r'\1[REDACTED]@', body)
header = {'argv': argv, 'cwd': str(cwd), 'startedAt': started, 'endedAt': ended, 'exitCode': code, 'termination': termination, 'truncated': truncated}
log = json.dumps(header, indent=2) + '\n\n' + body
if truncated:
    log += '\n[Retained first and last 16 KiB; middle output omitted.]\n'
path = logs / (identifier + '.log')
path.write_text(log)
record = {
    'argv': argv, 'cwdIdentity': str(cwd),
    'executableIdentity': str(Path(resolved).resolve()) if resolved else argv[0],
    'startedAt': started, 'endedAt': ended, 'exitCode': code,
    'termination': termination,
    'status': ('PASS' if code == 0 else 'FAIL') if termination == 'NONE' else 'BLOCKED',
    'boundedLogRef': str(path.relative_to(root)),
    'logDigest': hashlib.sha256(path.read_bytes()).hexdigest(),
}
(records / (identifier + '.json')).write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
print(body[-5000:])
sys.exit(code if code is not None and code >= 0 else 1)
