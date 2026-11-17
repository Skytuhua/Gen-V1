#!/usr/bin/env python3
"""Regenerate docs/implementation/v3/M16-verification.json for the M16
follow-up candidate: swap in fresh command records (new timestamps, exit codes
and log digests), recompute changedFiles, keep phases/cases/locks verbatim.
Usage: python gen_m16_evidence.py records.json"""
import json, hashlib, subprocess, os, sys

ROOT = 'C:/Users/Administrator/repos/Gen-V1-m16-v6'
BASE = 'f20b92c636f9ba749a2a2ac027a9e1f053574198'
VPATH = 'docs/implementation/v3/M16-verification.json'

def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()

def git(*args):
    return subprocess.run(['git', '-c', 'core.longpaths=true'] + list(args), cwd=ROOT, capture_output=True, text=True).stdout.strip()

records = json.load(open(sys.argv[1], encoding='utf-8'))
by_log = {}
for r in records:
    r['logDigest'] = sha(os.path.join(ROOT, r['boundedLogRef']))
    r.setdefault('status', 'PASS' if r['exitCode'] == 0 else 'FAIL')
    by_log[r['boundedLogRef']] = r

doc = json.load(open(os.path.join(ROOT, VPATH), encoding='utf-8'))
assert doc['baseSha'] == BASE
swapped = 0
for phase in doc['phases']:
    for i, cmd in enumerate(phase.get('commands', [])):
        ref = cmd['boundedLogRef']
        if ref in by_log:
            phase['commands'][i] = by_log[ref]
            swapped += 1
expected = 8  # 3 vitest (x2 phases) -> C1:3, C2: 1 vitest+3 pnpm, FULL: 3 vitest+2 pnpm = 10
print('swapped commands:', swapped)

changed = git('diff', '--name-only', BASE).split('\n') + git('ls-files', '--others', '--exclude-standard').split('\n')
doc['changedFiles'] = sorted({p for p in changed if p and os.path.exists(os.path.join(ROOT, p))})
doc['sourceLockDigest'] = sha(os.path.join(ROOT, 'docs/implementation/v3/M16-source-lock.json'))
assert doc['reviewerApproval'] is False
assert all(f['enabled'] is False for f in doc['flags'])

open(os.path.join(ROOT, VPATH), 'w', encoding='utf-8').write(json.dumps(doc, indent=2) + '\n')
print('changedFiles:', len(doc['changedFiles']))
print('sourceLockDigest:', doc['sourceLockDigest'])
print('wrote', VPATH)
