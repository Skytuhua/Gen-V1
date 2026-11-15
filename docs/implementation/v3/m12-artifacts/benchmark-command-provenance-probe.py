#!/usr/bin/env python3
"""Check the evidence-only distinction between a rerun recipe and an observed launch.

Run this read-only probe through the command recorder. A pre-fix assertion failure
is an intended red fixture, not a successful benchmark or an EXPECTED_NEGATIVE
command status. Actual invocation linkage is checked separately by the evidence
controller after the enclosing recorded command has exited.
"""
from pathlib import Path
import hashlib
import json


ROOT = Path(__file__).resolve().parents[4]
ARTIFACT = ROOT / "docs/implementation/v3/m12-artifacts/aggregation-benchmark.json"
REPRODUCTION_COMMAND = [
    "corepack", "pnpm@10.30.3", "exec", "vitest", "run",
    "tests/tool-program-benchmark-v3.test.ts",
]
COMMAND_EVIDENCE_NOTE = (
    "reproductionCommand is a standalone rerun recipe, not the command observed "
    "for this measurement. The outer command recorder and "
    "benchmark-execution-link.json identify the actual launch, working directory, "
    "timestamps and exit."
)


def main() -> None:
    raw = ARTIFACT.read_bytes()
    report = json.loads(raw)
    provenance = report["provenance"]
    assert isinstance(provenance, dict), "Benchmark provenance must be an object"
    assert "command" not in provenance, (
        "M12_BENCHMARK_PROVENANCE_COMMAND_IS_NOT_OBSERVED: the static standalone "
        "recipe must not be presented as provenance.command for a combined or "
        "repository-wide invocation"
    )
    assert provenance.get("reproductionCommand") == REPRODUCTION_COMMAND, (
        "The pinned standalone recipe must be explicitly labelled reproductionCommand"
    )
    assert provenance.get("commandEvidenceNote") == COMMAND_EVIDENCE_NOTE, (
        "Benchmark provenance must explicitly distinguish the rerun recipe from "
        "actual outer-recorder evidence"
    )
    print(json.dumps({
        "check": "M12_BENCHMARK_COMMAND_PROVENANCE",
        "status": "PASS",
        "scope": "Metadata meaning only; no new benchmark execution or production approval",
        "artifact": str(ARTIFACT.relative_to(ROOT)),
        "artifactSHA256": hashlib.sha256(raw).hexdigest(),
        "benchmarkBeganAt": provenance.get("beganAt"),
        "benchmarkFinishedAt": provenance.get("finishedAt"),
        "reproductionCommand": provenance["reproductionCommand"],
        "actualInvocationSource": "Separate completed outer command record and benchmark-execution-link.json",
    }, indent=2))


if __name__ == "__main__":
    main()
