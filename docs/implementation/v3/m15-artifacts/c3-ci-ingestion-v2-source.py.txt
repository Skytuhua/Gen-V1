#!/usr/bin/env python3
"""Seal one known M15 CI ZIP and its provenance outside the repository. No network."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import unicodedata
import zipfile

REPOSITORY = "skytuhua-org/Gen-V1"
WORKFLOW = ".github/workflows/m15-evidence.yml"
BRANCH = "agent/m15-v3"
ACCEPTED_BASE = "49cd633273a3f61c14a4191a9877e99ab23ec88f"
ACCEPTED_TREE = "2ecdb4c95fc6b604159257a125064ad585b966e5"
LOG_ROOT = "docs/implementation/v3/m15-logs/"
KINDS = {
    "native": {"job": "M15 native contracts (Windows, exact branch head)", "source": "test-results/m15/native-source.json", "receipts": [("", "native")]},
    "root-browser": {"job": "M15 root browser comparison (Windows, accepted base and exact branch head)", "source": "test-results/m15/root-comparison-source.json", "receipts": [("baseline/", "root-baseline"), ("", "root-candidate")]},
    "browser": {"job": "M15 browser contracts (Windows and installed Edge, exact branch head)", "source": "test-results/m15/browser-source.json", "receipts": [("", name) for name in ("workbench", "workbench-app", "saved-drafts", "chat-view-modes", "artifact-acknowledgment", "scoped-conversation", "ui-shell-overlays", "ui-shell-controls", "usage-context", "agents-workspace", "agents-actual-app", "workspace-host", "saved-layout-chooser", "usage-app-integration", "desktop-surfaces", "split-browser")]},
    "full-shard": {"job": "M15 full repository (Windows, exact branch head, shard {shard}/4)", "source": "test-results/m15/full-source.json", "receipts": [("", "full-shard-{shard}")]},
}

ADDED_BROWSER_SUITES = ("workspace-host", "saved-layout-chooser", "usage-app-integration", "desktop-surfaces")
SPLIT_BROWSER_FLAGS = {"GEN_SPLIT_RENDERER_BROWSER": "1", "GEN_SPLIT_APP_BROWSER": "1", "GEN_TEST_BROWSER_CHANNEL": "msedge"}
SPLIT_BROWSER_TESTS = ["tests/split-workspace-renderer.test.ts", "tests/split-app-browser.test.ts"]
SPLIT_BROWSER_SOURCE = "test-results/m15/split-browser-source.json"
SPLIT_BROWSER_RESULT = "test-results/m15/split-browser-results.json"
SPLIT_BROWSER_COMMAND = """$ErrorActionPreference = 'Stop'
$env:GEN_SPLIT_RENDERER_BROWSER = '1'
$env:GEN_SPLIT_APP_BROWSER = '1'
$env:GEN_TEST_BROWSER_CHANNEL = 'msedge'
$node = (Get-Command node).Source
$head = git rev-parse HEAD
if ($head -ne $env:GITHUB_SHA) { throw 'The split browser source does not match the pushed head.' }
New-Item -ItemType Directory -Force test-results/m15 | Out-Null
[ordered]@{
  head = $head
  tree = (git rev-parse 'HEAD^{tree}')
  event = $env:GITHUB_EVENT_NAME
  ref = $env:GITHUB_REF
  runId = $env:GITHUB_RUN_ID
  runAttempt = $env:GITHUB_RUN_ATTEMPT
  runner = "$($env:RUNNER_OS)-$($env:RUNNER_ARCH)"
  nodeExecutable = $node
  node = (& $node --version)
  edgePath = $env:M15_EDGE_PATH
  edgeVersion = $env:M15_EDGE_VERSION
  flags = [ordered]@{
    GEN_SPLIT_RENDERER_BROWSER = $env:GEN_SPLIT_RENDERER_BROWSER
    GEN_SPLIT_APP_BROWSER = $env:GEN_SPLIT_APP_BROWSER
    GEN_TEST_BROWSER_CHANNEL = $env:GEN_TEST_BROWSER_CHANNEL
  }
  testFiles = @('tests/split-workspace-renderer.test.ts', 'tests/split-app-browser.test.ts')
  maxWorkers = 1
  recordedAt = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 test-results/m15/split-browser-source.json
& $node node_modules/vitest/vitest.mjs run tests/split-workspace-renderer.test.ts tests/split-app-browser.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=test-results/m15/split-browser-results.json
exit $LASTEXITCODE"""


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_bytes().decode("utf-8-sig"))


def write_json(path, value):
    data = (json.dumps(value, ensure_ascii=True, indent=2) + "\n").encode("ascii")
    Path(path).write_bytes(data)
    return {"bytes": len(data), "sha256": sha256(data)}


def normalized_member(info):
    name = info.orig_filename
    require(isinstance(name, str) and name and "\0" not in name and "\\" not in name and not name.startswith("/"), f"Unsafe ZIP path: {name!r}")
    parts = name.rstrip("/").split("/")
    require(all(part and part not in (".", "..") and not part.endswith((".", " ")) and ":" not in part and not any(ord(character) < 32 for character in part) for part in parts), f"Unsafe ZIP path component: {name!r}")
    require(all(not re.fullmatch(r"(?i)(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", part) for part in parts), f"Reserved Windows ZIP path: {name!r}")
    require(not info.flag_bits & 1, f"Encrypted ZIP entry is unsupported: {name}")
    mode = (info.external_attr >> 16) & 0xFFFF
    kind = stat.S_IFMT(mode)
    directory = info.is_dir()
    require(kind in ((0, stat.S_IFDIR) if directory else (0, stat.S_IFREG)), f"Symlink or special ZIP entry is forbidden: {name}")
    require(not directory or info.file_size == 0, f"Directory has payload bytes: {name}")
    return "/".join(parts), directory, mode


def extract_zip(archive, destination, max_files, max_member_bytes, max_total_bytes):
    records, names, nodes, members = [], {}, {}, set()
    with zipfile.ZipFile(archive) as source:
        infos = source.infolist()
        require(len(infos) <= max_files, "ZIP entry count exceeds the configured bound")
        require(sum(item.file_size for item in infos) <= max_total_bytes, "ZIP expanded size exceeds the configured bound")
        prepared = []
        for item in infos:
            path, directory, mode = normalized_member(item)
            require(item.file_size <= max_member_bytes, f"ZIP member exceeds the configured bound: {path}")
            require(item.file_size <= max(1, item.compress_size) * 1000, f"ZIP member compression ratio exceeds the configured bound: {path}")
            parts = path.split("/")
            for index in range(1, len(parts) + 1):
                spelling = "/".join(parts[:index])
                key = unicodedata.normalize("NFC", spelling).casefold()
                require(key not in names or names[key] == spelling, f"Case or Unicode path collision: {path}")
                names[key] = spelling
                leaf = index == len(parts)
                if not leaf or directory:
                    require(nodes.get(key) != "file", f"File/directory path collision: {path}")
                    nodes[key] = "directory"
                else:
                    require(key not in nodes, f"Duplicate or directory/file ZIP entry: {path}")
                    nodes[key] = "file"
            require(key not in members, f"Duplicate ZIP member: {path}")
            members.add(key)
            prepared.append((item, path, directory, mode))
        for item, path, directory, mode in prepared:
            target = destination / path
            record = {"path": path, "kind": "directory" if directory else "file", "zipMode": oct(mode), "zipCreateSystem": item.create_system, "zipDateTime": list(item.date_time), "compressedBytes": item.compress_size, "bytes": item.file_size, "crc32": f"{item.CRC:08x}"}
            if directory:
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                git_digest = hashlib.sha1(f"blob {item.file_size}\0".encode("ascii"))
                total = 0
                with source.open(item) as reader, target.open("xb") as writer:
                    while chunk := reader.read(1024 * 1024):
                        total += len(chunk)
                        require(total <= item.file_size, f"ZIP member exceeds declared size: {path}")
                        writer.write(chunk)
                        digest.update(chunk)
                        git_digest.update(chunk)
                require(total == item.file_size, f"ZIP member is truncated: {path}")
                record.update(sha256=digest.hexdigest(), gitBlob=git_digest.hexdigest())
            records.append(record)
    return records


def kind_contract(args):
    require(args.kind in KINDS, "Unknown artifact kind")
    shard = getattr(args, "shard", None)
    if args.kind == "full-shard":
        require(type(shard) is int and 1 <= shard <= 4, "Full-repository artifact requires --shard 1, 2, 3 or 4")
    else:
        require(shard is None, "--shard is valid only for a full-repository artifact")
    spec = KINDS[args.kind]
    artifact_kind = f"full-shard-{shard}-of-4" if args.kind == "full-shard" else args.kind
    return {"job": spec["job"].format(shard=shard), "source": spec["source"], "receipts": [(prefix, label.format(shard=shard)) for prefix, label in spec["receipts"]], "artifactName": f"m15-{artifact_kind}-{args.head}-{args.run_id}-{args.attempt}"}


def full_test_command(shard):
    return f"$ErrorActionPreference = 'Stop'\npnpm test --maxWorkers=2 --shard={shard}/4 --reporter=default --reporter=json --outputFile=test-results/m15/full-results.json\nexit $LASTEXITCODE"


def split_test_command():
    return SPLIT_BROWSER_COMMAND


def validate_metadata(args, run, artifact, jobs):
    require(run["id"] == args.run_id and run["run_attempt"] == args.attempt, "Workflow run or attempt differs from the selected result")
    require(run["repository"]["full_name"] == REPOSITORY and run["path"].split("@", 1)[0] == WORKFLOW, "Workflow repository or path differs")
    require(run["event"] == "push" and run["head_branch"] == BRANCH, "Workflow trigger or branch differs")
    require(run["status"] == "completed", "Workflow result is not complete yet")
    require(run.get("head_sha") == args.head, "Workflow metadata does not identify the exact pushed head")
    contract = kind_contract(args)
    require(artifact["name"] == contract["artifactName"] and artifact["expired"] is False, "Artifact name or run/attempt identity differs, or artifact has expired")
    require(type(artifact["id"]) is int and artifact["id"] > 0 and artifact["workflow_run"]["id"] == args.run_id, "Artifact is not from the selected workflow run")
    if artifact["workflow_run"].get("head_sha"):
        require(artifact["workflow_run"]["head_sha"] == run["head_sha"], "Artifact and run source metadata differ")
    matching = [item for item in jobs["jobs"] if item["name"] == contract["job"]]
    require(len(matching) == 1, "Expected workflow job is missing or duplicated")
    job = matching[0]
    require(job["run_id"] == args.run_id and job["run_attempt"] == args.attempt and job["status"] == "completed", "Job result belongs to another run/attempt or is incomplete")
    return job


def validate_sources(args, extracted):
    primary_source = kind_contract(args)["source"]
    expected = [("test-results/m15/checkout-source.json", args.head, args.tree), (primary_source, args.head, args.tree)]
    if args.kind == "root-browser":
        expected.append(("test-results/m15/root-baseline-source.json", ACCEPTED_BASE, ACCEPTED_TREE))
    if args.kind == "browser":
        expected.append((SPLIT_BROWSER_SOURCE, args.head, args.tree))
    records, missing = [], []
    for path, head, tree in expected:
        local = extracted / path
        if not local.is_file():
            missing.append(path)
            continue
        value = read_json(local)
        require((value["head"], value["tree"], str(value["runId"]), str(value["runAttempt"])) == (head, tree, str(args.run_id), str(args.attempt)), f"Tested source identity differs: {path}")
        require(value.get("event") == "push" and value.get("ref") == "refs/heads/" + BRANCH, f"Source event or branch differs: {path}")
        if head == args.head:
            require(value["runner"] == "Windows-X64", f"Unexpected target runner: {path}")
            if path == primary_source and args.kind == "browser":
                require(value.get("edgePath") and value.get("edgeVersion"), "Browser source lacks the observed Edge executable/version")
            if args.kind == "browser" and path == SPLIT_BROWSER_SOURCE:
                require(value.get("flags") == SPLIT_BROWSER_FLAGS, "Split browser activation flags or explicit Edge override differ")
                require(value.get("testFiles") == SPLIT_BROWSER_TESTS and value.get("maxWorkers") == 1, "Split browser file selection or worker count differs")
                require(value.get("edgePath") and value.get("edgeVersion") and value.get("nodeExecutable"), "Split browser source lacks observed runtime/browser identities")
            if path == primary_source and args.kind == "root-browser":
                require(value["acceptedBase"] == ACCEPTED_BASE, "Root comparison uses another baseline")
            if path == "test-results/m15/checkout-source.json":
                require(value.get("acceptedBase") == ACCEPTED_BASE, "Checkout source uses another reviewed base")
            if path == primary_source and args.kind == "full-shard":
                require((value.get("shard"), value.get("shardCount"), value.get("maxWorkers")) == (args.shard, 4, 2), "Full-repository shard/worker identity differs")
                require(value.get("selection") == "all repository Vitest tests; no test-file or test-name filters", "Full-repository source record declares another selection")
                require(value.get("packageTestScript") == "pnpm build:credential-lease && pnpm build:widgets && vitest run", "Full-repository source record uses another package test script")
        records.append({"path": path, "sha256": sha256(local.read_bytes()), "observed": value})
    return {"status": "MATCH" if not missing else "INCOMPLETE", "records": records, "missing": missing}


def validate_receipts(args, extracted):
    expected, observed, missing = [], [], []
    for prefix, label in kind_contract(args)["receipts"]:
        path = f"{prefix}{LOG_ROOT}c3-windows-{label}-{args.run_id}-{args.attempt}.json"
        expected.append(path)
        local = extracted / path
        if not local.is_file():
            missing.append(path)
            continue
        value = read_json(local)
        require(value["status"] in ("PASS", "FAIL", "BLOCKED", "NOT_RUN", "EXPECTED_NEGATIVE") and value["termination"] in ("NONE", "TIMEOUT", "CANCELLED", "SPAWN_ERROR"), f"Unknown command status: {path}")
        require(value["exitCode"] is None or type(value["exitCode"]) is int, f"Invalid command exit: {path}")
        require(isinstance(value["argv"], list) and value["argv"] and all(isinstance(item, str) and item for item in value["argv"]), f"Invalid command arguments: {path}")
        if value["status"] in ("PASS", "EXPECTED_NEGATIVE"):
            require(value["exitCode"] == 0 and value["termination"] == "NONE", f"Successful receipt lacks observed zero exit: {path}")
        if value["status"] == "EXPECTED_NEGATIVE":
            require(value.get("expectedNegative", {}).get("observed") is True and value["expectedNegative"].get("assertedFailure"), f"Expected-negative receipt lacks proof: {path}")
        if args.kind == "full-shard":
            arguments = value["argv"]
            require(arguments[0].replace("\\", "/").rsplit("/", 1)[-1].casefold() == "pwsh.exe", "Full-repository recorder did not launch the declared PowerShell executable")
            require(arguments[1:5] == ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] and len(arguments) == 6, "Full-repository command wrapper differs")
            require(arguments[5].replace("\r\n", "\n").strip() == full_test_command(args.shard), "Full-repository command is filtered, changed, or belongs to another shard")
        if args.kind == "browser" and label in ADDED_BROWSER_SUITES:
            arguments = value["argv"]
            require(arguments[0].replace("\\", "/").rsplit("/", 1)[-1].casefold() == "node.exe", "Added browser suite did not launch the declared Node executable")
            require(arguments[1:] == ["--import", "tsx", "scripts/test-browser.ts", "--suite", label], "Added browser suite command is filtered or selects another suite")
        if args.kind == "browser" and label == "split-browser":
            arguments = value["argv"]
            require(arguments[0].replace("\\", "/").rsplit("/", 1)[-1].casefold() == "pwsh.exe", "Split browser recorder did not launch the declared PowerShell executable")
            require(arguments[1:5] == ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] and len(arguments) == 6, "Split browser command wrapper differs")
            require(arguments[5].replace("\r\n", "\n").strip() == split_test_command(), "Split browser command flags, channel, selection or reporting differ")
        expected_log = path[:-5] + ".log"
        require(prefix + value["boundedLogRef"] == expected_log, f"Receipt log points outside its immutable attempt: {path}")
        log = (extracted / expected_log).read_bytes()
        require(sha256(log) == value["logDigest"], f"Receipt log digest differs: {path}")
        argv = json.dumps(value["argv"], ensure_ascii=False, separators=(",", ":"))
        header = f"argv: {argv}\ncwd: {value['cwdIdentity']}\nexitCode: {json.dumps(value['exitCode'])}\ntermination: {value['termination']}\n".encode("utf-8")
        require(log.startswith(header), f"Receipt log observation header differs: {path}")
        require(datetime.fromisoformat(value["endedAt"].replace("Z", "+00:00")) >= datetime.fromisoformat(value["startedAt"].replace("Z", "+00:00")), f"Receipt timing differs: {path}")
        observed.append({"path": path, "sha256": sha256(local.read_bytes()), "status": value["status"], "exitCode": value["exitCode"], "termination": value["termination"], "log": expected_log, "logSha256": value["logDigest"]})
    actual = [path.relative_to(extracted).as_posix() for path in extracted.rglob("c3-windows-*.json") if path.parent.as_posix().endswith(LOG_ROOT.rstrip("/"))]
    unexpected = sorted(set(actual) - set(expected))
    return {"observed": observed, "missing": missing, "additionalRetainedReceipts": unexpected}


def validate_full_result(args, extracted):
    if args.kind != "full-shard":
        return None
    path = "test-results/m15/full-results.json"
    local = extracted / path
    if not local.is_file():
        return {"status": "INCOMPLETE", "missing": [path]}
    value = read_json(local)
    require(type(value.get("success")) is bool and isinstance(value.get("testResults"), list), "Full-repository JSON result shape differs")
    keys = ("numTotalTestSuites", "numPassedTestSuites", "numFailedTestSuites", "numPendingTestSuites", "numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests")
    require(all(type(value.get(key)) is int and value[key] >= 0 for key in keys), "Full-repository JSON counts are missing or invalid")
    names = [item.get("name") for item in value["testResults"]]
    require(all(isinstance(name, str) and name for name in names) and len(names) == len(set(names)), "Full-repository test-file results are unnamed or duplicated")
    return {"status": "PRESENT", "path": path, "sha256": sha256(local.read_bytes()), "success": value["success"], "counts": {key: value[key] for key in keys}, "reportedTestFileCount": len(names), "reportedTestFiles": names, "note": "JSON is retained as reported. Suite totals include nested describe blocks and are not test-file counts; ingestion does not grant full-suite PASS."}


def validate_split_result(args, extracted):
    if args.kind != "browser":
        return None
    local = extracted / SPLIT_BROWSER_RESULT
    if not local.is_file():
        return {"status": "INCOMPLETE", "missing": [SPLIT_BROWSER_RESULT]}
    value = read_json(local)
    keys = ("numTotalTestSuites", "numPassedTestSuites", "numFailedTestSuites", "numPendingTestSuites", "numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests")
    require(type(value.get("success")) is bool and isinstance(value.get("testResults"), list), "Split browser JSON result shape differs")
    require(all(type(value.get(key)) is int and value[key] >= 0 for key in keys), "Split browser JSON counts are missing or invalid")
    files, not_executed = [], []
    for item in value["testResults"]:
        name = item.get("name", "").replace("\\", "/")
        matches = [path for path in SPLIT_BROWSER_TESTS if name == path or name.endswith("/" + path)]
        require(len(matches) == 1 and matches[0] not in files, "Split browser result has an unexpected or duplicated test file")
        files.append(matches[0])
        assertions = item.get("assertionResults")
        require(isinstance(assertions, list), "Split browser assertions are missing")
        if not assertions or any(test.get("status") not in ("passed", "failed") for test in assertions):
            not_executed.append(matches[0])
    missing = sorted(set(SPLIT_BROWSER_TESTS) - set(files))
    incomplete = bool(missing or not_executed or value["numPendingTests"] or value["numTodoTests"] or not value["numTotalTests"])
    return {"status": "INCOMPLETE" if incomplete else "PRESENT", "path": SPLIT_BROWSER_RESULT, "sha256": sha256(local.read_bytes()), "success": value["success"], "counts": {key: value[key] for key in keys}, "reportedTestFiles": files, "missingTestFiles": missing, "filesWithUnexecutedAssertions": not_executed, "note": "Both explicitly enabled split files are required. Missing or skipped bodies remain incomplete; a retained failing result is not relabeled, and ingestion grants no test PASS."}


def ingest(args):
    out = Path(args.out).resolve()
    require(not out.exists() and not out.is_relative_to(Path(args.repo).resolve()), "Output must be a new directory outside the repository")
    require(args.run_id > 0 and args.attempt > 0 and re.fullmatch(r"[0-9a-f]{40}", args.head) and re.fullmatch(r"[0-9a-f]{40}", args.tree), "Invalid expected run or source identity")
    metadata = {"run": Path(args.run_json).read_bytes(), "artifact": Path(args.artifact_json).read_bytes(), "jobs": Path(args.jobs_json).read_bytes()}
    run, artifact, jobs = (json.loads(metadata[name].decode("utf-8-sig")) for name in ("run", "artifact", "jobs"))
    job = validate_metadata(args, run, artifact, jobs)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ci-ingestion-", dir=out.parent) as temporary:
        folder = Path(temporary)
        archive = folder / "archive.zip"
        digest, size = hashlib.sha256(), 0
        with Path(args.zip).open("rb") as source, archive.open("xb") as target:
            original = os.fstat(source.fileno())
            require(stat.S_ISREG(original.st_mode) and original.st_size <= args.max_archive_bytes, "Input archive is not a bounded regular file")
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                require(size <= args.max_archive_bytes, "Archive grew beyond the configured bound")
                digest.update(chunk)
                target.write(chunk)
            final = os.fstat(source.fileno())
            require((original.st_size, original.st_mtime_ns, original.st_ctime_ns) == (final.st_size, final.st_mtime_ns, final.st_ctime_ns) and size == original.st_size, "Input archive changed while copying")
        archive_sha = digest.hexdigest()
        require(size == artifact["size_in_bytes"], "Downloaded ZIP length differs from GitHub artifact metadata")
        declared_digest = artifact.get("digest")
        if declared_digest is not None:
            require(declared_digest == "sha256:" + archive_sha, "Downloaded ZIP digest differs from GitHub artifact metadata")
        extracted = folder / "extracted"
        extracted.mkdir()
        records = extract_zip(archive, extracted, args.max_files, args.max_member_bytes, args.max_total_bytes)
        sources = validate_sources(args, extracted)
        receipts = validate_receipts(args, extracted)
        full_result = validate_full_result(args, extracted)
        split_result = validate_split_result(args, extracted)
        metadata_records = []
        for name, raw in metadata.items():
            path = f"github-{name}.json"
            (folder / path).write_bytes(raw)
            metadata_records.append({"path": path, "bytes": len(raw), "sha256": sha256(raw)})
        identity = write_json(folder / "files.json", records)
        result = {"schemaVersion": 2, "ingestionStatus": "BYTES_VERIFIED", "testOutcome": "Read original job conclusions and command statuses; ingestion does not grant a passing test result.", "repository": REPOSITORY, "workflow": WORKFLOW, "head": args.head, "tree": args.tree, "runId": args.run_id, "runAttempt": args.attempt, "runConclusion": run.get("conclusion"), "artifactId": artifact["id"], "artifactName": artifact["name"], "kind": args.kind, "shard": getattr(args, "shard", None), "shardCount": 4 if args.kind == "full-shard" else None, "event": "push", "acceptedBase": ACCEPTED_BASE, "jobId": job["id"], "jobConclusion": job.get("conclusion"), "archive": {"path": "archive.zip", "bytes": size, "sha256": archive_sha, "githubDigest": declared_digest, "githubDigestVerified": declared_digest is not None}, "metadata": metadata_records, "files": {"path": "files.json", "entries": len(records), **identity}, "sourceValidation": sources, "commands": receipts, "fullRepositoryResult": full_result, "ingestedAt": datetime.now(timezone.utc).isoformat(), "ingestionHelperSha256": sha256(Path(__file__).read_bytes())}
        result.update(workflowEvidenceRevision="c3-v2", splitBrowserResult=split_result)
        sealed = write_json(folder / "ingestion.json", result)
        (folder / "ingestion.sha256").write_text(sealed["sha256"] + "\n", encoding="ascii")
        os.rename(folder, out)
    return {"output": str(out), "manifestSha256": sealed["sha256"], "archiveSha256": archive_sha, "sourceStatus": sources["status"], "observedReceipts": len(receipts["observed"]), "missingReceipts": len(receipts["missing"]), "runConclusion": run.get("conclusion"), "jobConclusion": job.get("conclusion")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("zip", "run-json", "artifact-json", "jobs-json", "head", "tree", "out"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--kind", choices=tuple(KINDS), required=True)
    parser.add_argument("--shard", type=int, help="Required only for full-shard; integer 1 through 4")
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--attempt", type=int, required=True)
    parser.add_argument("--repo", default="/workspace/scratch/1b47eb428672/m15-v3")
    parser.add_argument("--max-archive-bytes", type=int, default=512 * 1024 * 1024)
    parser.add_argument("--max-files", type=int, default=20000)
    parser.add_argument("--max-member-bytes", type=int, default=256 * 1024 * 1024)
    parser.add_argument("--max-total-bytes", type=int, default=2 * 1024 * 1024 * 1024)
    args = parser.parse_args()
    print(json.dumps(ingest(args), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        raise SystemExit(f"CI artifact ingestion rejected: {error}")
