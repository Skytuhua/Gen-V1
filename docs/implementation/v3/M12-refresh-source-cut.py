#!/usr/bin/env python3
"""Refresh M12 source custody after a worktree source freeze.

Run from any directory: python3 docs/implementation/v3/M12-refresh-source-cut.py
Only the three named source-custody JSON files are replaced. This does not run
acceptance tests, change source, approve production use, or record a final commit.
The prior audit is immutable input. Repeated runs differ only in observedAt when
the source bytes and repository identity have not changed.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from datetime import datetime, timezone


ROOT = Path(__file__).resolve().parents[3]
DIRECTORY = "docs/implementation/v3"
PRIOR = f"{DIRECTORY}/m12-artifacts/prior-audit"
LOCK_PATH = f"{DIRECTORY}/M12-source-lock.json"
AUDIT_PATH = f"{DIRECTORY}/M12-source-audit.json"
CUT_PATH = f"{DIRECTORY}/M12-candidate-source-cut.json"
SCRIPT_PATH = f"{DIRECTORY}/M12-refresh-source-cut.py"
UPSTREAM_REPORT = f"{DIRECTORY}/m12-artifacts/upstream-source-review.md"
BASE = "fcaa52f7fcdc9f39420118a79f9a8250ba83c563"
ANCESTOR = "a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54"
ORIGIN = "https://github.com/Skytuhua/Gen-V1.git"
BRANCH = "agent/m12-v3"
PRIOR_LOCK_DIGEST = "49b7563a4d8a550be9c6fb51624b7eebe7d3ceb8743b0021745ec734e67314e3"
SOURCE_GATE = "LOCALLY_RESOLVED_CONTRACTS_REVIEW_PENDING"

# These unchanged boundaries supplement the retained 63-file inspection. All
# changed existing product/test/config paths are also inspected at the base.
NAMED_INTEGRATION_TARGETS = (
    ".gitattributes",
    "packages/capabilities/schemas.ts",
    "packages/runtime/index.ts",
    "packages/runtime-pi/input-envelope.ts",
    "tests/fixtures/linux-path-guard/native.mjs",
)

# Contract versions are always calculated from the CURRENT defining file.
# M04/M10 names deliberately identify the locally implemented M12 subset.
LOCAL_CONTRACTS = (
    ("M03.BoundFileReadSubset", "packages/core/file-access.ts", (
        "tests/linux-bound-read-v3.test.ts", "tests/project-trust-v3.test.ts",
        "tests/linux-path-guard.test.ts", "tests/planning.test.ts")),
    ("M04.ToolDisclosureSubset", "packages/core/tool-disclosure.ts", (
        "tests/tool-program-prerequisites-v3.test.ts", "tests/tool-program-transport-v3.test.ts")),
    ("M10.PrivateToolResultV1", "packages/contracts/tool-results.ts", (
        "tests/tool-program-prerequisites-v3.test.ts", "tests/tool-program-recovery-v3.test.ts")),
    ("M10.ToolResultStoreSubset", "packages/core/tool-results.ts", (
        "tests/tool-program-prerequisites-v3.test.ts", "tests/tool-program-replay-v3.test.ts",
        "tests/tool-program-recovery-v3.test.ts")),
    ("M12.ToolProgramV1", "packages/contracts/tool-program.ts", (
        "tests/tool-program-v3.test.ts", "tests/tool-program-backend-v3.test.ts",
        "tests/tool-program-replay-v3.test.ts", "tests/python-kernel-v3.test.ts",
        "tests/python-program-backend-v3.test.ts")),
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def git(*args: str, data: bytes | None = None, cwd: Path = ROOT) -> bytes:
    result = subprocess.run(["git", *args], cwd=cwd, input=data, capture_output=True)
    require(result.returncode == 0,
            f"Git source-custody command failed: {args!r}: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout


def text_git(*args: str, cwd: Path = ROOT) -> str:
    return git(*args, cwd=cwd).decode().strip()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def blob_hash(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def encode(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def relative_file(path: str) -> Path:
    candidate = ROOT / path
    require(not Path(path).is_absolute() and ".." not in Path(path).parts,
            f"Expected repository-relative path: {path}")
    require(not candidate.is_symlink() and candidate.is_file(), f"Expected regular source file: {path}")
    require(candidate.resolve().is_relative_to(ROOT), f"Source escaped the worktree: {path}")
    return candidate


def changed_paths() -> list[str]:
    tracked = git("diff", "--name-only", "--no-renames", "-z", BASE, "--").split(b"\0")
    untracked = git("ls-files", "--others", "--exclude-standard", "-z").split(b"\0")
    # Generated evidence is intentionally excluded to prevent digest cycles.
    # Every changed path outside docs/ is included, including root config/assets.
    return sorted({path.decode() for path in tracked + untracked
                   if path and not path.decode().startswith("docs/")})


def atomic_write(path: str, data: bytes) -> None:
    target = ROOT / path
    descriptor, temporary = tempfile.mkstemp(prefix=target.name + ".", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    observed_at = datetime.now(timezone.utc).isoformat(timespec="microseconds")
    prior_lock_bytes = relative_file(f"{PRIOR}/M12-source-lock.json").read_bytes()
    require(sha256(prior_lock_bytes) == PRIOR_LOCK_DIGEST, "The retained original source lock changed")
    prior_lock = json.loads(prior_lock_bytes)
    prior_audit = json.loads(relative_file(f"{PRIOR}/M12-source-audit.json").read_bytes())
    repository = prior_audit["repository"]
    require(prior_lock["schemaVersion"] == 3 and len(prior_lock["inspectedPaths"]) == 63,
            "Expected the exact original 63-entry SourceLockV3")
    require(prior_lock["executionBaseSha"] == repository["baseSha"] == BASE, "Accepted base changed")
    require(prior_lock["auditAncestorSha"] == repository["auditAncestorSha"] == ANCESTOR,
            "Audit ancestor changed")
    require(repository["origin"] == text_git("remote", "get-url", "origin") == ORIGIN, "Origin changed")
    require(repository["branch"] == text_git("branch", "--show-current") == BRANCH, "Worktree branch changed")
    require(Path(repository["worktree"]).resolve() == ROOT, "Audited worktree identity changed")
    git("merge-base", "--is-ancestor", ANCESTOR, BASE)
    for commit in prior_lock["acceptedDependencyCommits"]:
        git("merge-base", "--is-ancestor", commit, BASE)
    original = Path(repository["originalCheckout"])
    require(text_git("status", "--porcelain", cwd=original) == "", "Original checkout is no longer clean")
    # Read solely to check the original checkout. No candidate HEAD is recorded.
    require(text_git("rev-parse", "HEAD", cwd=original) == BASE, "Original checkout no longer matches the base")

    base_blobs: dict[str, str | None] = {}
    captured: dict[str, bytes] = {}
    metadata: dict[str, dict] = {}

    def base_blob(path: str) -> str | None:
        if path not in base_blobs:
            entry = git("ls-tree", "-z", BASE, "--", path)
            if not entry:
                base_blobs[path] = None
            else:
                require(entry.count(b"\0") == 1, f"Ambiguous base path: {path}")
                header, actual_path = entry[:-1].split(b"\t", 1)
                _mode, kind, identity = header.split()
                require(kind == b"blob" and actual_path.decode() == path, f"Expected exact base blob: {path}")
                base_blobs[path] = identity.decode()
        return base_blobs[path]

    def current(path: str) -> dict:
        if path not in metadata:
            data = relative_file(path).read_bytes()
            identity = blob_hash(data)
            require(text_git("hash-object", "--", path) == identity,
                    f"Git filters or concurrent edits changed exact-byte hashing: {path}")
            captured[path] = data
            metadata[path] = {"path": path, "blobSha": identity, "sha256": sha256(data), "bytes": len(data)}
        return dict(metadata[path])

    old_entries = prior_lock["inspectedPaths"]
    old_paths = {entry["path"] for entry in old_entries}
    require(len(old_paths) == 63, "The retained original inspection has duplicate paths")
    for entry in old_entries:
        require(base_blob(entry["path"]) == entry["blobSha"], f"Retained base blob mismatch: {entry['path']}")

    changed = changed_paths()
    new_existing = sorted((set(NAMED_INTEGRATION_TARGETS) |
                           {path for path in changed if base_blob(path) is not None}) - old_paths)
    inspected = [dict(entry) for entry in old_entries]
    for path in new_existing:
        identity = base_blob(path)
        require(identity is not None, f"Named integration target absent at base: {path}")
        inspected.append({"path": path, "blobSha": identity})
    drift = []
    for entry in inspected:
        actual = current(entry["path"])
        if actual["blobSha"] != entry["blobSha"]:
            drift.append({"path": entry["path"], "fromBlob": entry["blobSha"], "toBlob": actual["blobSha"],
                          "note": "Exact accepted-base to local M12 continuation change. The user authorized completing M12 and its necessary prerequisite repairs; independent review and production approval remain pending."})

    old_sources = {entry["name"]: entry["path"] for entry in prior_audit["contractSources"]}
    specifications = [(entry["name"], old_sources[entry["name"]], list(entry["testIds"]))
                      for entry in prior_lock["publicContracts"]]
    for name, path, tests in specifications:
        if name == "M01.CapabilityFlags":
            tests.append("tests/tool-program-integration-v3.test.ts")
        if name == "M02.ToolEffectLedger":
            tests.extend(["tests/tool-program-authority-v3.test.ts", "tests/tool-program-v3.test.ts",
                          "tests/tool-program-replay-v3.test.ts", "tests/tool-program-recovery-v3.test.ts"])
    specifications.extend((name, path, list(tests)) for name, path, tests in LOCAL_CONTRACTS)
    public_contracts, contract_sources = [], []
    for name, path, tests in specifications:
        actual = current(path)
        tests = list(dict.fromkeys(tests))
        for test in tests:
            current(test)
        baseline = base_blob(path)
        scope = ("LOCAL_M12_REQUIRED_SUBSET" if name.startswith(("M03.Bound", "M04.", "M10."))
                 else "LOCAL_M12_PROTOCOL" if name.startswith("M12.")
                 else "ACCEPTED_BASE_CONTRACT_WITH_LOCAL_CHANGES" if baseline != actual["blobSha"]
                 else "ACCEPTED_BASE_CONTRACT_UNCHANGED")
        public_contracts.append({"name": name, "version": actual["blobSha"], "testIds": tests})
        contract_sources.append({"name": name, **actual, "baseBlobSha": baseline, "scope": scope,
                                 "independentReview": "PENDING", "testIds": tests})

    lock = {"schemaVersion": 3, "auditAncestorSha": ANCESTOR, "executionBaseSha": BASE,
            "inspectedPaths": inspected, "publicContracts": public_contracts,
            "acceptedDependencyCommits": list(prior_lock["acceptedDependencyCommits"]),
            "approvedDrift": sorted(drift, key=lambda entry: entry["path"])}
    lock_bytes = encode(lock)

    paths = sorted({entry["path"] for entry in inspected} | set(changed) |
                   {path for _name, path, _tests in specifications} |
                   {test for _name, _path, tests in specifications for test in tests})
    entries = []
    for path in paths:
        actual, baseline = current(path), base_blob(path)
        roles = []
        if path in old_paths:
            roles.append("RETAINED_BASE_INSPECTION")
        if path in new_existing:
            roles.append("ADDITIONAL_EXISTING_INTEGRATION")
        if path in changed:
            roles.append("CHANGED_PRODUCT_TEST_OR_CONFIG")
        if path in NAMED_INTEGRATION_TARGETS:
            roles.append("NAMED_INTEGRATION_TARGET")
        if any(path == source for _name, source, _tests in specifications):
            roles.append("CONTRACT_DEFINITION")
        if any(path in tests for _name, _source, tests in specifications):
            roles.append("CONTRACT_TEST")
        entries.append({**actual, "baseBlobSha": baseline, "trackedAtBase": baseline is not None,
                        "existsInWorktree": True, "change": "ADDED" if baseline is None else
                        "UNCHANGED" if baseline == actual["blobSha"] else "MODIFIED", "roles": roles})
    proposed = [{**entry, "basePathStatus": "ABSENT", "worktreePathStatus": "PRESENT"}
                for entry in entries if not entry["trackedAtBase"]]

    prior_artifacts = [current(f"{PRIOR}/{name}") for name in
                       ("M12-source-lock.json", "M12-source-audit.json", "M12-verification.json", "M12-handoff.md")]
    upstream_report = current(UPSTREAM_REPORT)
    upstream = [dict(entry) for entry in prior_audit["upstreamSources"] if entry["label"] != "E03"]
    e03_path = "packages/runtime-hermes/worker.py"
    e03 = git("show", f"{ANCESTOR}:{e03_path}")
    e03_blob = text_git("rev-parse", f"{ANCESTOR}:{e03_path}")
    require(blob_hash(e03) == e03_blob == "a1fe7014a0ad6b570e88e8db4d867bf9d8c6ee0b", "E03 ancestor blob changed")
    upstream.append({"label": "E03", "repository": repository["requested"], "commitSha": ANCESTOR,
                     "path": e03_path, "blobSha": e03_blob, "sha256": sha256(e03), "utf8Bytes": len(e03),
                     "verification": "Read from the local Git object database at the retained audit ancestor; recomputed Git blob SHA-1 matched the pinned blob."})
    package = json.loads(captured["package.json"])
    source_lock_digest = sha256(lock_bytes)
    cut = {"schemaVersion": 1, "bundleId": "M12", "observedAt": observed_at,
           "executionBaseSha": BASE, "auditAncestorSha": ANCESTOR, "sourceLockDigest": source_lock_digest,
           "scope": "Every changed product/test/config path outside docs/, every retained base inspection, named integration targets, and current contract definitions/tests. Generated M12 evidence outputs are excluded to avoid digest cycles.",
           "hashSemantics": "blobSha is Git SHA-1 of the exact worktree file bytes, verified against git hash-object; sha256 and bytes describe those same bytes. No current HEAD or final commit is recorded.",
           "changedProductTestConfigPaths": changed, "namedIntegrationTargets": list(NAMED_INTEGRATION_TARGETS),
           "files": entries, "independentReview": "PENDING", "productionApproval": False}
    cut_bytes = encode(cut)
    audit = {
        "schemaVersion": 2, "bundleId": "M12", "sourceGate": SOURCE_GATE, "observedAt": observed_at,
        "repository": dict(repository),
        "scope": "M12 candidate source custody and local prerequisite-subset inventory after the user-authorized implementation continuation. This refresh is not an entire-codebase audit, a rerun of acceptance tests, independent approval, or full M04/M10 acceptance.",
        "sourceLockDigest": source_lock_digest,
        "sourceCut": {"path": CUT_PATH, "sha256": sha256(cut_bytes), "files": len(entries),
                      "changedProductTestConfigFiles": len(changed)},
        "refresh": {"script": current(SCRIPT_PATH), "command": ["python3", SCRIPT_PATH],
                    "instruction": "Rerun after the final source freeze, then refresh verification.sourceLockDigest, dependencyContracts, the complete changed-file inventory and artifact integrity. This script never edits verification, handoff or verifier files."},
        "priorAudit": {"scope": "Preserved original read-only prerequisite audit, including its failed baseline, access failures and rejected publication attempt; none is converted into a current pass.",
                       "observedAt": prior_audit["observedAt"], "sourceGate": prior_audit["sourceGate"],
                       "originalInspectedBlobCount": 63, "artifacts": prior_artifacts},
        "inspection": {"retainedOriginalBaseBlobs": 63, "additionalExistingIntegrationPaths": new_existing,
                       "totalInspectedBaseBlobs": len(inspected), "approvedDriftCount": len(drift),
                       "authorization": "User continuation authorized completion of M12 and necessary prerequisite fixes. approvedDrift records these exact base-to-worktree bytes; it does not grant independent or production approval."},
        "contractSources": contract_sources,
        "dependencies": [
            {"contract": "M01", "acceptedOnBase": True, "localScope": "Existing evidence/store contracts plus default-off M12 flag registrations.", "runtimeAcceptance": "RECORDED_SEPARATELY_IN_IMPLEMENTATION_EVIDENCE", "reviewStatus": "PENDING"},
            {"contract": "M02", "acceptedOnBase": True, "localScope": "Existing authority/ledger contract extended for complete owner/definition equality, parent invocation linkage, per-call cancellation, and private program argument/error handling. ToolEffectLedger version is the current defining-file blob.", "runtimeAcceptance": "RECORDED_SEPARATELY_IN_IMPLEMENTATION_EVIDENCE", "reviewStatus": "PENDING"},
            {"contract": "M03", "acceptedOnBase": True, "localScope": "Existing execution-decision contract plus locally implemented descriptor-bound Linux granted byte reads and explicitly selected bounded JS/Python backends. The original namespace/credential guards remain independent; no whole-executor 128 MiB claim is made.", "runtimeAcceptance": "LOCAL_NATIVE_TEST_EVIDENCE_ONLY", "productionBackendApproval": False, "reviewStatus": "PENDING"},
            {"contract": "M04", "acceptedOnBase": False, "fullMilestoneAcceptance": "NOT_ESTABLISHED", "localScope": "Locally implemented and tested M12-required ToolDisclosure subset: current-owner metadata, explicit disclosure, reviewed READ/READ_RETRYABLE allowlist and complete definition digests. This does not accept the full M04 draft or general progressive-disclosure milestone.", "runtimeAcceptance": "LOCAL_REQUIRED_SUBSET_TESTED_REVIEW_PENDING", "contractNames": ["M04.ToolDisclosureSubset"]},
            {"contract": "M10", "acceptedOnBase": False, "fullMilestoneAcceptance": "NOT_ESTABLISHED", "localScope": "Locally implemented and tested M12-required private result subset: immutable owner/program/grant-bound references, atomic receipt settlement, quotas, retained failed outcomes and bounded byte-range inspection. This does not establish full M10 acceptance.", "runtimeAcceptance": "LOCAL_REQUIRED_SUBSET_TESTED_REVIEW_PENDING", "contractNames": ["M10.PrivateToolResultV1", "M10.ToolResultStoreSubset"]},
        ],
        "historicalSourceDrift": prior_audit["historicalSourceDrift"],
        "m04PullRequest": {**prior_audit["m04PullRequest"], "observationScope": "Historical metadata retained from the prior audit; not refreshed by this local script.", "acceptedAsDependency": False},
        "proposedFiles": proposed,
        "featureFlags": [{"key": key, "registered": True, "enabled": False,
                          "reason": "Default-off candidate registration; final runtime flag assertions are recorded separately. No activation is authorized by source custody."}
                         for key in ("tools.jsReadProgramV1", "tools.durableReplayExperimentV1", "tools.pythonKernelV1")],
        "platform": {"host": "linux-x64", "nodeVersion": subprocess.check_output(["node", "--version"], cwd=ROOT, text=True).strip(),
                     "declaredPackageManager": package["packageManager"], "pythonApprovedForM12": False,
                     "boundedExecutionScope": {"javascript": "GUEST_WASM_LINEAR", "python": "INTERPRETER_ADDRESS_SPACE", "wholeExecutorMemoryLimitBytes": None},
                     "windowsInstalledDesktop": "NOT_RUN", "productionBackendApproval": False},
        "upstreamSourceReview": upstream_report, "upstreamSources": upstream,
        "upstreamAccess": "Pinned GitHub file/blob retrieval succeeded in the retained audit. Public web opens failed with DisabledError. This refresh revalidates E03 locally and hashes the retained upstream report; it does not refetch or substitute upstream APIs.",
        "verificationOutcome": "OWNED_BY_IMPLEMENTATION_EVIDENCE_NOT_REASSESSED_BY_SOURCE_REFRESH",
        "releaseApproval": False, "productionApproval": False, "independentReview": "PENDING",
    }

    # Refuse a mixed cut if another task edited a captured file or its inventory
    # during collection. The parent reruns this after all source owners finish.
    require(changed_paths() == changed, "Changed-source inventory moved during collection; rerun after source freeze")
    for path, data in captured.items():
        require(relative_file(path).read_bytes() == data, f"Source changed during collection: {path}; rerun after source freeze")
    atomic_write(LOCK_PATH, lock_bytes)
    # Derive the final digest from the written file, as the canonical verifier does.
    written_lock_digest = sha256(relative_file(LOCK_PATH).read_bytes())
    require(written_lock_digest == source_lock_digest, "Written source-lock digest mismatch")
    source_lock_digest = written_lock_digest
    cut["sourceLockDigest"] = written_lock_digest
    audit["sourceLockDigest"] = written_lock_digest
    cut_bytes = encode(cut)
    audit["sourceCut"]["sha256"] = sha256(cut_bytes)
    atomic_write(CUT_PATH, cut_bytes)
    atomic_write(AUDIT_PATH, encode(audit))
    print(json.dumps({"sourceGate": SOURCE_GATE, "sourceLockDigest": source_lock_digest,
                      "retainedBaseBlobs": 63, "inspectedBaseBlobs": len(inspected),
                      "approvedDrift": len(drift), "currentContracts": len(public_contracts),
                      "sourceCutFiles": len(entries), "proposedFilesPresent": len(proposed),
                      "productionApproval": False}, indent=2))


if __name__ == "__main__":
    main()
