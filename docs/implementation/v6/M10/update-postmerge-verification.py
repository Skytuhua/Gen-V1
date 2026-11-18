#!/usr/bin/env python3
"""Append the session-5 post-merge phase + remainingGates entry to
docs/implementation/v3/M10-verification.json. Historical phases untouched."""
import json, os, sys

ROOT = "<worktree>"
VP = os.path.join(ROOT, "docs/implementation/v3/M10-verification.json")
RP = os.path.join(ROOT, "docs/implementation/v6/M10/receipts-postmerge.jsonl")

d = json.load(open(VP))
receipts = [json.loads(l) for l in open(RP)] if os.path.exists(RP) else []
by_key_log = {}
for r in receipts:
    by_key_log.setdefault(os.path.basename(r["boundedLogRef"]), r)

def rc(logname):
    r = by_key_log.get(logname)
    return r["status"] if r else "FAIL"

# case-id -> evidence log(s)
ev = {
    "bw": "vitest-background-work-r3.summary.md",
    "hh": "vitest-human-handoff.summary.md",
    "ei": "vitest-external-intake.summary.md",
    "dc": "vitest-decisions.summary.md",
}
CASES = {
    "M10-C01": "bw", "M10-C02": "bw", "M10-C03": "hh", "M10-C04": "ei",
    "M10-S01": "bw", "M10-S02": "bw", "M10-S03": "bw", "M10-S04": "bw",
    "M10-S05": "hh", "M10-S06": "bw", "M10-S07": None, "M10-S08": "bw",
    "M10-S09": "ei", "M10-S10": "ei", "M10-S11": "ei", "M10-S12": "bw",
    "M10-U01": "hh", "M10-U02": "hh", "M10-U03": "ei", "M10-U04": "hh",
    "M10-T01": "bw", "M10-T02": "bw", "M10-T03": "bw", "M10-T04": "hh",
    "M10-T05": "ei", "M10-T06": "bw",
    "M10-G01": "bw", "M10-G02": "bw", "M10-G03": "bw",
    "M10-D01": "dc", "M10-D02": "dc", "M10-D03": "dc", "M10-D04": "dc", "M10-D05": "dc",
}
cases = []
for cid, k in CASES.items():
    if k is None:
        cases.append({"id": cid, "status": "BLOCKED", "evidence": "HOLD_FORK_API unchanged; UNSUPPORTED_FORK verified"})
    else:
        cases.append({"id": cid, "status": rc(ev[k]), "evidence": "logs-pm/" + ev[k]})

phase_status = "PASS" if all(c["status"] in ("PASS", "BLOCKED") for c in cases) and \
    rc("vitest-background-work-r3.summary.md") == "PASS" and rc("vitest-human-handoff.summary.md") == "PASS" and \
    rc("vitest-external-intake.summary.md") == "PASS" and rc("vitest-decisions.summary.md") == "PASS" else "FAIL"

phase = {
    "id": "m10.postmerge-v6-s5",
    "status": phase_status,
    "requiredCases": cases,
    "commands": receipts,
    "artifactRefs": [
        "docs/implementation/v6/M10/receipts-postmerge.jsonl",
        "docs/implementation/v6/M10/handoff-postmerge.md",
        "docs/implementation/v6/M10/logs-pm/",
    ],
}

# replace if a previous run of this script already appended
d["phases"] = [p for p in d["phases"] if p["id"] != phase["id"]] + [phase]

note = ("Post-merge session-5 verification on captured origin/main 4aef753e (cut includes squash 016738f7 + "
        "follow-up 1d65ae1e #786): four targeted suites PASS (43+11+24+5=83), lint PASS, build PASS, "
        "scoped browser suite PASS 11/11, typecheck PASS on run-4 with NODE_OPTIONS=--max-old-space-size=3584 "
        "after three default-heap exit134 OOMs under load-avg~20; full pnpm test FAIL exit1 "
        "(330 env-bound failures across 59 non-M10 files: python3.14 absent, platform drivers, pty; no "
        "M10-scoped file failed); HOLD_SOURCE_DRIFT recorded for the stale pre-squash branch join "
        "(moot: all content on main).")
if note not in d["remainingGates"]:
    d["remainingGates"].append(note)

json.dump(d, open(VP, "w"), indent=2)
print("phase status:", phase_status, "| cases:", sum(1 for c in cases if c["status"]=="PASS"), "PASS,",
      sum(1 for c in cases if c["status"]=="BLOCKED"), "BLOCKED,", sum(1 for c in cases if c["status"]=="FAIL"), "FAIL")
