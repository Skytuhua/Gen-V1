#!/usr/bin/env python3
"""Verify curated log provenance and refresh receipt digests without rewriting observations."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / "docs/implementation/v6/M10"
RECEIPTS = EVIDENCE / "receipts-postmerge.jsonl"
PROVENANCE = EVIDENCE / "logs-pm/provenance-map.json"

entries = {
    entry["summaryPath"]: entry for entry in json.loads(PROVENANCE.read_text())["entries"]
}
receipts = [json.loads(line) for line in RECEIPTS.read_text().splitlines()]

for receipt in receipts:
    ref = receipt["boundedLogRef"]
    entry = entries[ref]
    summary_digest = hashlib.sha256((ROOT / ref).read_bytes()).hexdigest()
    if summary_digest != entry["summarySha256"]:
        raise ValueError(f"Curated log digest does not match provenance: {ref}")
    if receipt["originalOutputDigest"] != entry["originalSha256"]:
        raise ValueError(f"Original log digest does not match provenance: {ref}")
    receipt["logDigest"] = summary_digest

RECEIPTS.write_text("".join(json.dumps(receipt) + "\n" for receipt in receipts))
print(f"Verified {len(receipts)} curated receipts against their original and summary digests.")
