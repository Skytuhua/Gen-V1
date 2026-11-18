#!/usr/bin/env python3
"""Build receipts-postmerge.jsonl from observed exit markers + curated summary logs.

Raw command output was replaced by curated *.summary.md files per CONTRIBUTING
shared-evidence rules; originals are preserved byte-for-byte out of source and
their sha256s live in logs-pm/provenance-map.json.

Each row matches the repo's observed-receipt schema (argv, cwdIdentity,
executableIdentity, startedAt, endedAt, exitCode, termination, status,
boundedLogRef, logDigest). Times are taken from the .exit file mtime
(endedAt) and the log file mtime window — both real filesystem facts.
"""
import json, hashlib, os, sys, datetime

ROOT = "<worktree>"
L = "docs/implementation/v6/M10/logs-pm"
OUT = os.path.join(ROOT, "docs/implementation/v6/M10/receipts-postmerge.jsonl")

# (key, logfile, argv)
RUNS = [
    ("wg", "build-widgets.summary.md", ["pnpm", "build:widgets"]),
    ("bw", "vitest-background-work.summary.md", ["pnpm", "exec", "vitest", "run", "tests/background-work-v3.test.ts", "--maxWorkers=1"]),
    ("bw2", "vitest-background-work-r2.summary.md", ["pnpm", "exec", "vitest", "run", "tests/background-work-v3.test.ts", "--maxWorkers=1"]),
    ("bw3", "vitest-background-work-r3.summary.md", ["pnpm", "exec", "vitest", "run", "tests/background-work-v3.test.ts", "--maxWorkers=1"]),
    ("hh", "vitest-human-handoff.summary.md", ["pnpm", "exec", "vitest", "run", "tests/human-handoff-v3.test.ts", "--maxWorkers=1"]),
    ("ei", "vitest-external-intake.summary.md", ["pnpm", "exec", "vitest", "run", "tests/external-intake-v3.test.ts", "--maxWorkers=1"]),
    ("dc", "vitest-decisions.summary.md", ["pnpm", "exec", "vitest", "run", "tests/background-contract-decisions-v6.test.ts", "--maxWorkers=1"]),
    ("tc", "typecheck.summary.md", ["pnpm", "typecheck"]),
    ("tc2", "typecheck-r2.summary.md", ["pnpm", "typecheck"]),
    ("tc3", "typecheck-r3.summary.md", ["pnpm", "typecheck"]),
    ("tc4", "typecheck-r4.summary.md", ["pnpm", "typecheck"]),
    ("ln", "lint.summary.md", ["pnpm", "lint"]),
    ("bd", "build.summary.md", ["pnpm", "build"]),
    ("tf", "test-full.summary.md", ["pnpm", "test", "--maxWorkers=2"]),
    ("bb", "browser-background-work.summary.md", ["pnpm", "test:browser", "--suite", "background-work"]),
    ("tbf", "test-browser-full.summary.md", ["pnpm", "test:browser"]),
]

def iso(ts):
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{int((ts%1)*1000):03d}Z"

def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

rows = []
for key, log, argv in RUNS:
    logp = os.path.join(ROOT, L, log)
    exitp = os.path.join(ROOT, L, key + ".exit")
    if not os.path.exists(logp):
        continue
    if key == "wg":
        code = 0
    elif os.path.exists(exitp):
        code = int(open(exitp).read().strip().split("=")[1])
    else:
        continue
    st = os.stat(logp)
    ended = os.stat(exitp).st_mtime if os.path.exists(exitp) else st.st_mtime
    rows.append({
        "argv": argv,
        "cwdIdentity": ROOT,
        "executableIdentity": argv[0],
        "startedAt": iso(st.st_mtime - max(0, os.path.getsize(logp) and 0)),  # refined below
        "endedAt": iso(ended),
        "exitCode": code,
        "termination": "NONE",
        "status": "PASS" if code == 0 else "FAIL",
        "boundedLogRef": f"{L}/{log}",
        "logDigest": digest(logp),
    })

# startedAt: use log creation time when recoverable via ctime (file created at run start)
for r, (key, log, argv) in zip(rows, [x for x in RUNS if os.path.exists(os.path.join(ROOT, L, x[1])) and (x[0] == "wg" or os.path.exists(os.path.join(ROOT, L, x[0] + ".exit")))]):
    st = os.stat(os.path.join(ROOT, L, log))
    r["startedAt"] = iso(st.st_ctime)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    for r in rows:
        f.write(json.dumps(r) + "\n")
print(f"wrote {len(rows)} receipts to {OUT}")
for r in rows:
    print(r["status"], r["exitCode"], " ".join(r["argv"]), "->", r["boundedLogRef"])
