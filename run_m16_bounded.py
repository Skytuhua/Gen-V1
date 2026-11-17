#!/usr/bin/env python3
"""Run one M16 gate command, write its bounded log with the required
argv/cwd/exitCode/termination header, and print the command record as JSON."""
import json, subprocess, sys, time
from datetime import datetime, timezone

LOG_CAP = 60000
CWD = 'C:/Users/Administrator/repos/Gen-V1-m16-v6'
EXE = 'C:/Users/Administrator/AppData/Local/pnpm/node.exe'

def iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

def run(argv, log_path, cap=LOG_CAP):
    started_ms = int(time.time() * 1000)
    exec_argv = ['pnpm.cmd'] + argv[1:] if argv[0] == 'pnpm' else argv
    try:
        proc = subprocess.run(exec_argv, cwd=CWD, capture_output=True, text=True, timeout=7200, errors='replace')
        out = (proc.stdout or '') + (('\n' + proc.stderr) if proc.stderr else '')
        exit_code, termination = proc.returncode, 'NONE'
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or '') + (exc.stderr or '')
        exit_code, termination = 124, 'TIMEOUT'
    ended_ms = int(time.time() * 1000)
    body = out[-cap:] if len(out) > cap else out
    header = f'argv: {json.dumps(argv, separators=(",", ":"))}\ncwd: {CWD}\nexitCode: {exit_code}\ntermination: {termination}\n'
    with open(log_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(header + '\n' + body)
    record = {
        'argv': argv,
        'cwdIdentity': CWD,
        'executableIdentity': EXE if argv[0] == 'node' else argv[0],
        'startedAt': iso(started_ms),
        'endedAt': iso(ended_ms),
        'exitCode': exit_code,
        'termination': termination,
        'boundedLogRef': log_path,
    }
    print(json.dumps(record))
    return exit_code

if __name__ == '__main__':
    argv = json.loads(sys.argv[1])
    sys.exit(run(argv, sys.argv[2]))
