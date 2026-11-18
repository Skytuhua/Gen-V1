#!/usr/bin/env python3
"""Build a byte-verified GitHub Git-data payload. Never stages or publishes."""
from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

REPOSITORY = "skytuhua-org/Gen-V1"
BRANCH = "agent/m15-v3"
ACCEPTED_BASE = "b4aa2caa5a3cedb29a0fddb510e49b5abd802a73"
PREFIX = "docs/implementation/v3/M15-"
LOG_PREFIX = "docs/implementation/v3/m15-logs/"
ARTIFACT_PREFIX = "docs/implementation/v3/m15-artifacts/"
LEGACY_RENDERER_SHA256 = "1b5485bbddc560dc0467411d8257005052e2701ba33e662547fa42cc99149a86"
MODES = {"100644": "blob", "100755": "blob", "120000": "blob", "160000": "commit"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def object_sha(kind, data):
    return hashlib.sha1(kind.encode("ascii") + b" " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("ascii")


def js_sorted(values):
    return sorted(values, key=lambda value: value.encode("utf-16-be"))


def checked_path(value):
    require(isinstance(value, str) and value and "\0" not in value, "Invalid empty or NUL path")
    require(not value.startswith("/") and all(part not in ("", ".", "..") for part in value.split("/")), f"Unsafe path: {value!r}")
    value.encode("utf-8", "strict")
    return value


def validate_command(command, path):
    """Mirror the pinned shared command schema and its result semantics."""
    fields = {"argv", "cwdIdentity", "executableIdentity", "startedAt", "endedAt", "exitCode", "termination", "status", "boundedLogRef", "logDigest"}
    require(isinstance(command, dict) and fields <= command.keys() and command.keys() <= fields | {"expectedNegative"}, f"Unexpected command schema: {path}")
    require(isinstance(command["argv"], list) and command["argv"] and all(isinstance(arg, str) and arg for arg in command["argv"]), f"Malformed command arguments: {path}")
    for key in ("cwdIdentity", "executableIdentity", "startedAt", "endedAt", "boundedLogRef"):
        require(isinstance(command[key], str) and command[key], f"Missing command identity {key}: {path}")
    digest = command["logDigest"]
    require(isinstance(digest, str) and len(digest) == 64 and all(character in "0123456789abcdef" for character in digest), f"Malformed command log digest: {path}")
    require(command["exitCode"] is None or type(command["exitCode"]) is int, f"Malformed command exit code: {path}")
    require(command["termination"] in ("NONE", "TIMEOUT", "CANCELLED", "SPAWN_ERROR"), f"Unknown command termination: {path}")
    require(command["status"] in ("PASS", "FAIL", "EXPECTED_NEGATIVE", "BLOCKED", "NOT_RUN"), f"Unknown command status: {path}")
    if "expectedNegative" in command:
        proof = command["expectedNegative"]
        require(isinstance(proof, dict) and set(proof) == {"assertedFailure", "observed"} and isinstance(proof["assertedFailure"], str) and proof["assertedFailure"] and proof["observed"] is True, f"Malformed expected-negative proof: {path}")
    if command["status"] in ("PASS", "EXPECTED_NEGATIVE"):
        require(command["termination"] == "NONE" and command["exitCode"] == 0, f"Successful command status lacks observed zero exit: {path}")
    if command["status"] == "EXPECTED_NEGATIVE":
        require("expectedNegative" in command, f"Expected-negative result lacks its asserted proof: {path}")


def validate_phase_status(phases):
    """Apply shared required-case rules and return the derived bundle status."""
    for phase in phases:
        require(phase["status"] in ("PASS", "FAIL", "BLOCKED", "NOT_RUN"), f"Unknown phase status: {phase['id']}")
        for case in phase["requiredCases"]:
            require(case["status"] in ("PASS", "FAIL", "EXPECTED_NEGATIVE", "NOT_RUN"), f"Unknown required-case status: {case['id']}")
        if phase["status"] == "PASS":
            require(phase["requiredCases"] and all(case["status"] not in ("FAIL", "NOT_RUN") for case in phase["requiredCases"]), f"PASS phase has absent or unmet required cases: {phase['id']}")
            require(any(command["status"] in ("PASS", "EXPECTED_NEGATIVE") for command in phase["commands"]), f"PASS phase lacks successful command evidence: {phase['id']}")
    if not phases:
        return "BLOCKED"
    if any(phase["status"] == "FAIL" or any(case["status"] == "FAIL" for case in phase["requiredCases"]) for phase in phases):
        return "FAIL"
    if all(phase["status"] == "PASS" for phase in phases):
        return "PASS"
    if any(phase["status"] == "PASS" for phase in phases):
        return "PARTIAL"
    return "BLOCKED"


@dataclass(frozen=True)
class PublicationBase:
    """Root-supplied actual published first parent and its measured Git tree."""
    head: str
    tree: str

    def __post_init__(self):
        for label, value in (("published parent", self.head), ("published tree", self.tree)):
            require(isinstance(value, str) and len(value) == 40 and all(character in "0123456789abcdef" for character in value), f"Invalid {label} SHA")
        require(self.head != ACCEPTED_BASE, "Published first parent must differ from the accepted base")


@dataclass(frozen=True)
class Entry:
    mode: str
    kind: str
    sha: str


def tree_sha(entries):
    """Reconstruct Git's exact directory objects without writing a Git object."""
    root = {}
    for path, entry in entries.items():
        checked_path(path)
        require(MODES.get(entry.mode) == entry.kind, f"Unsupported mode/type: {path}: {entry}")
        node = root
        parts = path.split("/")
        for part in parts[:-1]:
            child = node.setdefault(part, {})
            require(isinstance(child, dict), f"File/directory collision: {path}")
            node = child
        require(parts[-1] not in node, f"Duplicate or directory/file collision: {path}")
        node[parts[-1]] = entry

    def encode(node):
        members = []
        for name, value in node.items():
            if isinstance(value, dict):
                mode, kind, oid = "40000", "tree", encode(value)
            else:
                mode, kind, oid = value.mode, value.kind, value.sha
            name_bytes = name.encode("utf-8")
            members.append((name_bytes + (b"/" if kind == "tree" else b""), mode.encode("ascii") + b" " + name_bytes + b"\0" + bytes.fromhex(oid)))
        return object_sha("tree", b"".join(body for _, body in sorted(members)))

    return encode(root)


class Snapshot:
    """All write-tree/cache-tree writes go to external temporary copies."""
    def __init__(self, repo, scratch):
        self.repo = Path(repo).resolve()
        self.env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
        require(self.git("rev-parse", "--show-object-format").strip() == b"sha1", "This GitHub payload requires a SHA-1 repository")
        self.head = self.git("rev-parse", "HEAD").decode().strip()
        self.index_path = Path(self.git("rev-parse", "--path-format=absolute", "--git-path", "index").decode().strip())
        require(not self.git("rev-parse", "--shared-index-path").strip(), "Split indexes are unsupported; do not silently reinterpret the reviewed index")
        self.index_bytes = self.index_path.read_bytes()
        self.index_sha256 = sha256(self.index_bytes)
        self.temp = tempfile.TemporaryDirectory(prefix="index-snapshot-", dir=scratch)
        folder = Path(self.temp.name)
        index_copy, objects = folder / "index", folder / "objects"
        index_copy.write_bytes(self.index_bytes)
        objects.mkdir()
        actual_objects = self.git("rev-parse", "--path-format=absolute", "--git-path", "objects").decode().strip()
        alternate = os.pathsep.join(filter(None, (actual_objects, self.env.get("GIT_ALTERNATE_OBJECT_DIRECTORIES"))))
        self.env.update(GIT_INDEX_FILE=str(index_copy), GIT_OBJECT_DIRECTORY=str(objects), GIT_ALTERNATE_OBJECT_DIRECTORIES=alternate)
        self.entries = self.read_index()
        self.expected_tree = self.git("write-tree").decode().strip()
        require(tree_sha(self.entries) == self.expected_tree, "Independent index tree reconstruction differs from git write-tree")
        self.batch = subprocess.Popen(["git", "-C", str(self.repo), "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env)
        self.small_cache = {}
        self.hash_cache = {}

    def git(self, *args, allowed=(0,)):
        result = subprocess.run(["git", "-C", str(self.repo), *args], env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        require(result.returncode in allowed, f"git {' '.join(args)} failed: {result.stderr.decode('utf-8', 'replace').strip()}")
        return result.stdout

    def read_index(self):
        result = {}
        for row in self.git("ls-files", "--stage", "-z").split(b"\0"):
            if not row:
                continue
            header, raw_path = row.split(b"\t", 1)
            mode, oid, stage = header.decode("ascii").split()
            path = checked_path(raw_path.decode("utf-8", "strict"))
            require(stage == "0", f"Unmerged index entry: {path}")
            require(mode in MODES, f"Unsupported index mode: {path}: {mode}")
            require(path not in result, f"Duplicate index path: {path}")
            result[path] = Entry(mode, MODES[mode], oid)
        return result

    def read_tree(self, ref):
        result = {}
        for row in self.git("ls-tree", "-r", "-z", ref).split(b"\0"):
            if not row:
                continue
            header, raw_path = row.split(b"\t", 1)
            mode, kind, oid = header.decode("ascii").split()
            path = checked_path(raw_path.decode("utf-8", "strict"))
            result[path] = Entry(mode, kind, oid)
        require(tree_sha(result) == self.git("rev-parse", f"{ref}^{{tree}}").decode().strip(), f"Tree reconstruction mismatch: {ref}")
        return result

    def blob(self, oid):
        if oid in self.small_cache:
            return self.small_cache[oid]
        self.batch.stdin.write(oid.encode("ascii") + b"\n")
        self.batch.stdin.flush()
        header = self.batch.stdout.readline().decode("ascii").strip().split()
        require(len(header) == 3 and header[0] == oid and header[1] == "blob", f"Cannot read indexed blob: {oid}: {header}")
        size = int(header[2])
        data = self.batch.stdout.read(size)
        require(len(data) == size and self.batch.stdout.read(1) == b"\n", f"Truncated Git blob: {oid}")
        require(object_sha("blob", data) == oid, f"Blob identity mismatch: {oid}")
        self.hash_cache[oid] = (size, sha256(data))
        if size <= 160000:
            self.small_cache[oid] = data
        return data

    def file(self, path):
        checked_path(path)
        entry = self.entries.get(path)
        require(entry is not None and entry.kind == "blob", f"Reviewed indexed file missing: {path}")
        return self.blob(entry.sha)

    def hashed_file(self, path):
        entry = self.entries.get(path)
        require(entry is not None and entry.kind == "blob", f"Reviewed indexed file missing: {path}")
        if entry.sha not in self.hash_cache:
            self.blob(entry.sha)
        return self.hash_cache[entry.sha]

    def document(self, path):
        return json.loads(self.file(path).decode("utf-8", "strict"))

    def changed_paths(self, ref):
        rows = self.git("diff", "--cached", "--no-ext-diff", "--no-textconv", "--name-only", "-z", ref).split(b"\0")
        return js_sorted({checked_path(row.decode("utf-8", "strict")) for row in rows if row})

    def check_worktree(self):
        require(not self.git("diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z"), "Working tree differs from the frozen reviewed index")
        require(not self.git("ls-files", "--others", "--exclude-standard", "-z"), "Unreviewed untracked files remain in the repository")
        for row in self.git("ls-files", "-v", "-z").split(b"\0"):
            if row:
                require(row[:1] == b"H", f"Assume-unchanged, skip-worktree or unresolved index state is unsupported: {row!r}")

    def assert_unchanged(self):
        require(self.index_path.read_bytes() == self.index_bytes, "Real index changed during payload preparation")
        require(self.git("rev-parse", "HEAD").decode().strip() == self.head, "HEAD changed during payload preparation")
        self.check_worktree()

    def close(self):
        batch = getattr(self, "batch", None)
        if batch is not None:
            batch.stdin.close()
            batch.wait(timeout=10)
        self.temp.cleanup()


def validate_review(snapshot, accepted_base, accepted_entries):
    """Validate indexed M15 bytes and completeness, without rewriting summaries."""
    evidence = snapshot.document(PREFIX + "verification.json")
    lock = snapshot.document(PREFIX + "source-lock.json")
    cut = snapshot.document(PREFIX + "source-cut.json")
    artifacts = snapshot.document(PREFIX + "artifacts.json")["files"]
    plan = snapshot.document(PREFIX + "evidence-plan.json")
    summary = snapshot.document(PREFIX + "validation-summary.json")
    require(evidence["schemaVersion"] == 3 and evidence["bundleId"] == "M15-source-aware-workbench", "Unexpected M15 reviewed manifest identity")
    require(evidence["baseSha"] == lock["executionBaseSha"] == cut["executionBaseSha"] == plan["executionBaseSha"] == accepted_base, "Reviewed M15 manifest has not been reconciled to the accepted cut4 base")
    require(evidence["sourceLockDigest"] == sha256(snapshot.file(PREFIX + "source-lock.json")), "Indexed source-lock digest mismatch")
    changed = snapshot.changed_paths(accepted_base)
    require(evidence["changedFiles"] == changed, "Reviewed changedFiles differ from the complete final staged diff against accepted base")
    require(evidence["dependencyContracts"] == lock["publicContracts"], "Dependency contracts differ from indexed source lock")
    require(lock["auditAncestorSha"] == plan["auditAncestorSha"] and lock["acceptedDependencyCommits"] == plan["acceptedDependencyCommits"], "Source-lock ancestry differs from reviewed plan")
    for ancestor in [lock["auditAncestorSha"], *lock["acceptedDependencyCommits"]]:
        snapshot.git("merge-base", "--is-ancestor", ancestor, accepted_base)
    for item in [*lock["inspectedPaths"], *lock["publicContracts"]]:
        path = item.get("path", item.get("name"))
        require(path in accepted_entries and accepted_entries[path].sha == item.get("blobSha", item.get("version")), f"Accepted-base contract blob differs: {path}")
    require(lock["inspectedPaths"] == [{"path": path, "blobSha": accepted_entries[path].sha} for path in js_sorted(set(plan["inspectedPaths"]))], "Inspected-path lock differs from reviewed plan")
    require(lock["publicContracts"] == [{**item, "version": accepted_entries[item["name"]].sha} for item in plan["dependencyContracts"]], "Contract lock differs from reviewed plan")
    ancestor_entries = snapshot.read_tree(lock["auditAncestorSha"])
    drift = {item["path"]: item for item in lock["approvedDrift"]}
    expected_drift = {item["path"] for item in lock["inspectedPaths"] if item["path"] in ancestor_entries and ancestor_entries[item["path"]].sha != item["blobSha"]}
    require(len(drift) == len(lock["approvedDrift"]) and set(drift) == expected_drift, "Approved source drift list differs")
    for path, item in drift.items():
        require((item["fromBlob"], item["toBlob"]) == (ancestor_entries[path].sha, accepted_entries[path].sha), f"Approved source drift bytes differ: {path}")
    require(evidence["flags"] == [{"key": "ui.sourceWorkbenchV1", "enabled": False}] and evidence["reviewerApproval"] is False, "Publication must preserve the reviewed inactive, unapproved state")
    require(evidence["remainingGates"] == plan["remainingGates"], "Remaining gates differ from reviewed plan")

    implementation_paths = [path for path in changed if not path.startswith("docs/") and path in snapshot.entries]
    require([item["path"] for item in cut["files"]] == implementation_paths, "Indexed implementation source cut is incomplete or duplicated")
    for item in cut["files"]:
        size, digest = snapshot.hashed_file(item["path"])
        require((size, digest, snapshot.entries[item["path"]].sha) == (item["bytes"], item["sha256"], item["gitBlob"]), f"Indexed implementation bytes differ: {item['path']}")
    expected_artifacts = js_sorted([path for path in snapshot.entries if path.startswith(LOG_PREFIX) or path.startswith(ARTIFACT_PREFIX)] + [path for path in changed if path in snapshot.entries and path.startswith(PREFIX) and path.endswith(".md")] + [PREFIX + "evidence-plan.json"])
    require([item["path"] for item in artifacts] == expected_artifacts, "Indexed artifact manifest is incomplete or duplicated")
    for item in artifacts:
        require(snapshot.hashed_file(item["path"]) == (item["bytes"], item["sha256"]), f"Indexed artifact bytes differ: {item['path']}")

    records = []
    for path in js_sorted(snapshot.entries):
        if not path.startswith(LOG_PREFIX) or "/" in path[len(LOG_PREFIX):] or not path.endswith(".json"):
            continue
        if path == LOG_PREFIX + "renderer-performance-04.json":
            require(sha256(snapshot.file(path)) == LEGACY_RENDERER_SHA256, "Immutable legacy renderer exception changed")
            continue
        command = snapshot.document(path)
        validate_command(command, path)
        log = snapshot.file(command["boundedLogRef"])
        require(sha256(log) == command["logDigest"], f"Command log differs: {path}")
        argv = json.dumps(command["argv"], ensure_ascii=False, separators=(",", ":"))
        code = json.dumps(command["exitCode"])
        header = f"argv: {argv}\ncwd: {command['cwdIdentity']}\nexitCode: {code}\ntermination: {command['termination']}\n".encode("utf-8")
        require(log.startswith(header), f"Command observation header differs: {path}")
        start = datetime.fromisoformat(command["startedAt"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(command["endedAt"].replace("Z", "+00:00"))
        require(end >= start, f"Command timing differs: {path}")
        records.append({"id": path[len(LOG_PREFIX):-5], "receipt": path, "command": command})
    by_id = {record["id"]: record for record in records}
    used, phase_ids, case_ids, phases, assignments = set(), {"ATTEMPT_HISTORY"}, {"all-other-executed-attempts-retained"}, [], {}
    for phase in plan["phases"]:
        require(phase["id"] and phase["id"] not in phase_ids, "Duplicate reviewed phase")
        phase_ids.add(phase["id"])
        for case in phase["cases"]:
            require(case["id"] and case["id"] not in case_ids, "Duplicate reviewed case")
            case_ids.add(case["id"])
        commands = []
        for ident in phase["commandIds"]:
            require(ident in by_id and ident not in used, f"Missing or repeated reviewed command: {ident}")
            used.add(ident)
            assignments[ident] = phase["id"]
            commands.append(by_id[ident]["command"])
        for ref in phase["artifactRefs"]:
            require(ref in snapshot.entries or any(path.startswith(ref.rstrip("/") + "/") for path in snapshot.entries), f"Phase artifact missing: {ref}")
        phases.append({"id": phase["id"], "status": phase["status"], "requiredCases": phase["cases"], "artifactRefs": phase["artifactRefs"], "commands": commands})
    phases.append({"id": "ATTEMPT_HISTORY", "status": "PASS", "requiredCases": [{"id": "all-other-executed-attempts-retained", "status": "PASS", "evidence": "M15-command-index.json; failed setup, red fixtures and superseded runs keep their actual nonzero status."}], "artifactRefs": [PREFIX + "command-index.json"], "commands": [record["command"] for record in records if record["id"] not in used]})
    require(evidence["phases"] == phases, "Indexed phase evidence differs from receipts or reviewed plan")
    require(summary["bundleStatus"] == validate_phase_status(phases), "Reviewed bundle status differs from retained phase results")
    expected_index = [{"id": record["id"], "receipt": record["receipt"], "phase": assignments.get(record["id"], "ATTEMPT_HISTORY"), **{key: record["command"][key] for key in ("status", "exitCode", "startedAt", "endedAt")}} for record in records]
    require(snapshot.document(PREFIX + "command-index.json") == expected_index, "Indexed command index differs from actual receipts")
    require(summary["integrityStatus"] == "PASS" and summary["issues"] == [] and summary["sourceLockDigest"] == evidence["sourceLockDigest"] and summary["reviewerApproval"] is False, "Reviewed integrity summary does not attest these indexed bytes")
    require((summary["commandRecords"], summary["artifactHashes"], summary["implementationFiles"], summary["changedFiles"]) == (len(records), len(artifacts), len(cut["files"]), len(changed)), "Reviewed integrity counts differ from indexed manifest")
    require(snapshot.document("package.json")["packageManager"] == "pnpm@" + evidence["packageManagerVersion"], "Package-manager identity differs")
    return {"changedPaths": changed, "sourceLockDigest": evidence["sourceLockDigest"], "commandRecords": len(records), "artifactHashes": len(artifacts), "implementationFiles": len(cut["files"]), "bundleStatus": summary["bundleStatus"], "manifestSha256": sha256(snapshot.file(PREFIX + "verification.json"))}


def validate_retained_evidence(snapshot, published_entries):
    """C4 adds evidence without rewriting or deleting published history."""
    retained = [path for path in published_entries if path.startswith(LOG_PREFIX) or path.startswith(ARTIFACT_PREFIX)]
    for path in retained:
        require(snapshot.entries.get(path) == published_entries[path], f"Published evidence was removed, rewritten or had its mode changed: {path}")
    return len(retained)


def request_bytes(base_tree, elements):
    return json_bytes({"repository_full_name": REPOSITORY, "base_tree_sha": base_tree, "tree_elements": elements})


def plan_payload(snapshot, old, accepted, folder, inline_limit, request_limit, publication):
    published_shas = {entry.sha for entry in old.values() if entry.kind == "blob"}
    accepted_shas = {entry.sha for entry in accepted.values() if entry.kind == "blob"}
    known = published_shas | accepted_shas
    known_commits = {entry.sha for entry in [*old.values(), *accepted.values()] if entry.kind == "commit"}
    changed = sorted((path for path in set(old) | set(snapshot.entries) if old.get(path) != snapshot.entries.get(path)), key=lambda path: path.encode("utf-8"))
    deletes, references, inlines, aliases, blobs, reused, identities = [], [], [], [], [], [], []
    uploaded, inline_seen = {}, set()
    for path in changed:
        entry = snapshot.entries.get(path)
        if entry is None:
            previous = old[path]
            deletes.append({"path": path, "mode": previous.mode, "type": previous.kind, "sha": None})
            identities.append({"path": path, "operation": "delete", "previousMode": previous.mode, "previousSha": previous.sha})
            continue
        base_item = {"path": path, "mode": entry.mode, "type": entry.kind}
        if entry.kind == "commit":
            require(entry.sha in known_commits, f"New submodule commit availability has not been established: {path}")
            references.append({**base_item, "sha": entry.sha})
            identities.append({"path": path, "operation": "set", "mode": entry.mode, "type": entry.kind, "gitSha": entry.sha, "transport": "existing-commit"})
            continue
        data = snapshot.blob(entry.sha)
        identity = {"path": path, "operation": "set", "mode": entry.mode, "type": entry.kind, "gitSha": entry.sha, "bytes": len(data), "sha256": sha256(data)}
        if entry.sha in known:
            references.append({**base_item, "sha": entry.sha})
            reused.append({"path": path, "sha": entry.sha, "published": entry.sha in published_shas, "acceptedBase": entry.sha in accepted_shas})
            identities.append({**identity, "transport": "existing-blob"})
            continue
        try:
            content = data.decode("utf-8", "strict")
            binary = "\0" in content
        except UnicodeDecodeError:
            content, binary = None, True
        inline = {**base_item, "content": content}
        oversized = len(data) > inline_limit or len(request_bytes(publication.tree, [inline])) > request_limit
        if binary or oversized:
            if entry.sha not in uploaded:
                ident = len(blobs)
                encoded = base64.b64encode(data)
                name = f"blob-{ident}.b64"
                (folder / name).write_bytes(encoded)
                item = {"id": ident, "file": name, "sha": entry.sha, "bytes": len(data), "sha256": sha256(data), "encodedLength": len(encoded), "encodedSha256": sha256(encoded), "paths": []}
                blobs.append(item)
                uploaded[entry.sha] = item
            uploaded[entry.sha]["paths"].append(path)
            references.append({**base_item, "sha": entry.sha})
            identities.append({**identity, "transport": "new-base64-blob"})
        elif entry.sha in inline_seen:
            aliases.append({**base_item, "sha": entry.sha})
            identities.append({**identity, "transport": "earlier-inline-blob"})
        else:
            require(content.encode("utf-8") == data, f"UTF-8 round trip changed bytes: {path}")
            inline_seen.add(entry.sha)
            inlines.append(inline)
            identities.append({**identity, "transport": "new-inline-utf8"})

    state, groups, base_tree = dict(old), [], publication.tree
    def emit(items, phase):
        nonlocal base_tree
        if not items:
            return
        for item in items:
            if item.get("sha", "not-null") is None:
                require(item["path"] in state, f"Deletion target missing: {item['path']}")
                del state[item["path"]]
            else:
                oid = object_sha("blob", item["content"].encode("utf-8")) if "content" in item else item["sha"]
                state[item["path"]] = Entry(item["mode"], item["type"], oid)
        expected = tree_sha(state)
        ident = len(groups)
        data = json_bytes(items)
        name = f"tree-{ident}.json"
        wire = request_bytes(base_tree, items)
        require(len(wire) <= request_limit, f"Tree request exceeds bounded wire size: {ident}")
        (folder / name).write_bytes(data)
        groups.append({"id": ident, "file": name, "phase": phase, "baseTree": base_tree, "expectedTree": expected, "bytes": len(data), "sha256": sha256(data), "requestBytes": len(wire), "requestSha256": sha256(wire), "entries": len(items)})
        base_tree = expected
    # Separate deletion requests avoid file/directory replacement conflicts.
    # Inline aliases follow all inline groups so their objects already exist.
    for phase, items in (("delete", deletes), ("reuse-or-uploaded", references), ("inline", inlines), ("inline-alias", aliases)):
        current = []
        for item in items:
            require(len(request_bytes(base_tree, [item])) <= request_limit, f"Tree entry is too large: {item['path']}")
            if current and len(request_bytes(base_tree, current + [item])) > request_limit:
                emit(current, phase)
                current = []
            current.append(item)
        emit(current, phase)
    require(state == snapshot.entries and base_tree == snapshot.expected_tree, "Incremental payload does not reproduce the complete reviewed index tree")
    identity_data = json_bytes(identities)
    (folder / "file-identities.json").write_bytes(identity_data)
    return {"incrementalChangedFiles": len(changed), "deletions": len(deletes), "reusedBlobPaths": len(reused), "reusedBlobs": reused, "newInlineBlobs": len(inlines), "inlineAliasPaths": len(aliases), "blobs": blobs, "groups": groups, "fileIdentities": {"file": "file-identities.json", "bytes": len(identity_data), "sha256": sha256(identity_data)}}


def payload_file(folder, name):
    require(isinstance(name, str) and Path(name).name == name and name not in ("", ".", ".."), "Unsafe payload filename")
    return Path(folder) / name


def publication_from_manifest(manifest):
    """Validate the dynamic parent contract only after its manifest seal is checked."""
    require(manifest["schemaVersion"] == 3 and manifest["repository"] == REPOSITORY and manifest["branch"] == BRANCH, "Unexpected publication payload identity")
    publication = PublicationBase(manifest["parent"], manifest["baseTree"])
    require(manifest["additionalParents"] == [] and manifest["acceptedBase"] == ACCEPTED_BASE, "Accepted base or single-parent contract differs")
    final_tree = manifest["expectedTree"]
    require(isinstance(final_tree, str) and len(final_tree) == 40 and all(character in "0123456789abcdef" for character in final_tree), "Invalid final tree SHA")
    require(manifest["commitParameters"] == {"repository_full_name": REPOSITORY, "parent_sha": publication.head, "additional_parent_shas": [], "tree_sha": final_tree}, "Single-parent commit parameters differ")
    return publication


def verify_payload(folder, expected_manifest_sha256, publication, old=None, expected_entries=None):
    folder = Path(folder)
    raw = (folder / "manifest.json").read_bytes()
    require(sha256(raw) == expected_manifest_sha256 and (folder / "manifest.sha256").read_text("ascii").strip() == expected_manifest_sha256, "Payload manifest identity differs")
    manifest = json.loads(raw)
    require(publication_from_manifest(manifest) == publication, "Publication parent/tree contract differs from the root-supplied identity")
    require(manifest["helperSha256"] == sha256(Path(__file__).read_bytes()), "Payload preparation helper changed after sealing")
    meta = manifest["fileIdentities"]
    identity_bytes = payload_file(folder, meta["file"]).read_bytes()
    require((len(identity_bytes), sha256(identity_bytes)) == (meta["bytes"], meta["sha256"]), "File identity manifest bytes differ")
    identities = json.loads(identity_bytes)
    by_path = {item["path"]: item for item in identities}
    require(len(by_path) == len(identities) == manifest["incrementalChangedFiles"], "Changed path identity list is duplicated or incomplete")
    for item in identities:
        checked_path(item["path"])
    upload_shas = set()
    for ident, blob in enumerate(manifest["blobs"]):
        require(blob["id"] == ident and blob["sha"] not in upload_shas, "Blob upload sequence is duplicated or incomplete")
        encoded = payload_file(folder, blob["file"]).read_bytes()
        require((len(encoded), sha256(encoded)) == (blob["encodedLength"], blob["encodedSha256"]), f"Base64 payload bytes differ: {ident}")
        data = base64.b64decode(encoded, validate=True)
        require((len(data), sha256(data), object_sha("blob", data)) == (blob["bytes"], blob["sha256"], blob["sha"]), f"Decoded blob bytes differ: {ident}")
        upload_shas.add(blob["sha"])
        for path in blob["paths"]:
            require(by_path[path]["gitSha"] == blob["sha"] and by_path[path]["transport"] == "new-base64-blob", f"Blob path identity differs: {path}")
    state = dict(old) if old is not None else None
    previous, applied, available_inlines = publication.tree, set(), set()
    for ident, group in enumerate(manifest["groups"]):
        require(group["id"] == ident and group["baseTree"] == previous, "Tree chain is not contiguous")
        data = payload_file(folder, group["file"]).read_bytes()
        require((len(data), sha256(data)) == (group["bytes"], group["sha256"]), f"Tree payload bytes differ: {ident}")
        items = json.loads(data)
        require(len(items) == group["entries"] and json_bytes(items) == data, f"Tree JSON shape differs: {ident}")
        request = request_bytes(previous, items)
        require((len(request), sha256(request)) == (group["requestBytes"], group["requestSha256"]) and len(request) <= manifest["limits"]["treeRequestBytes"], f"Tree request bytes differ: {ident}")
        created_in_group = set()
        for item in items:
            path = checked_path(item["path"])
            require(path in by_path and path not in applied, f"Unexpected or repeated tree path: {path}")
            applied.add(path)
            identity = by_path[path]
            if item.get("sha", "not-null") is None:
                require(identity["operation"] == "delete" and (item["mode"], item["type"]) == (identity["previousMode"], MODES[identity["previousMode"]]), f"Deletion identity differs: {path}")
                if state is not None:
                    require(path in state and state[path].sha == identity["previousSha"], f"Deletion target differs: {path}")
                    del state[path]
                continue
            require(identity["operation"] == "set" and (item["mode"], item["type"]) == (identity["mode"], identity["type"]), f"Tree mode/type differs: {path}")
            if "content" in item:
                require("sha" not in item and identity["transport"] == "new-inline-utf8", f"Inline transport differs: {path}")
                raw_content = item["content"].encode("utf-8", "strict")
                oid = object_sha("blob", raw_content)
                require((len(raw_content), sha256(raw_content), oid) == (identity["bytes"], identity["sha256"], identity["gitSha"]), f"Inline bytes differ: {path}")
                created_in_group.add(oid)
            else:
                oid = item["sha"]
                require(oid == identity["gitSha"], f"Referenced Git object differs: {path}")
                if identity["transport"] == "new-base64-blob":
                    require(oid in upload_shas, f"Missing new blob upload: {path}")
                if identity["transport"] == "earlier-inline-blob":
                    require(oid in available_inlines, f"Inline alias precedes its blob creation: {path}")
            if state is not None:
                state[path] = Entry(item["mode"], item["type"], oid)
        available_inlines.update(created_in_group)
        if state is not None:
            require(tree_sha(state) == group["expectedTree"], f"Incremental Git tree differs: {ident}")
        previous = group["expectedTree"]
    require(applied == set(by_path) and previous == manifest["expectedTree"], "Complete payload path/tree identity differs")
    if expected_entries is not None:
        require(state == expected_entries, "Payload final entries differ from the reviewed index")
    return manifest


def prepare(args):
    publication = PublicationBase(args.published_parent, args.published_tree)
    out = Path(args.out).resolve()
    repo = Path(args.repo).resolve()
    require(not out.is_relative_to(repo), "Payload and helper outputs must remain outside the repository")
    require(not out.exists(), "Use a fresh output directory; publication payloads are immutable")
    out.parent.mkdir(parents=True, exist_ok=True)
    snapshot = Snapshot(repo, out.parent)
    try:
        snapshot.check_worktree()
        require(snapshot.expected_tree == args.expected_tree, "Final staged tree differs from the supplied reviewed git write-tree identity")
        require(snapshot.git("cat-file", "-t", publication.head).strip() == b"commit", "Published first parent is not a commit object")
        require(snapshot.git("rev-parse", f"{publication.head}^{{tree}}").decode().strip() == publication.tree, "Published parent/tree identity differs")
        snapshot.git("merge-base", "--is-ancestor", ACCEPTED_BASE, publication.head)
        old, accepted = snapshot.read_tree(publication.head), snapshot.read_tree(ACCEPTED_BASE)
        reviewed = validate_review(snapshot, ACCEPTED_BASE, accepted)
        reviewed["retainedPublishedEvidenceFiles"] = validate_retained_evidence(snapshot, old)
        with tempfile.TemporaryDirectory(prefix="payload-building-", dir=out.parent) as temporary:
            folder = Path(temporary)
            payload = plan_payload(snapshot, old, accepted, folder, args.inline_limit, args.request_limit, publication)
            manifest = {"schemaVersion": 3, "repository": REPOSITORY, "branch": BRANCH, "parent": publication.head, "additionalParents": [], "acceptedBase": ACCEPTED_BASE, "baseTree": publication.tree, "expectedTree": snapshot.expected_tree, "contextHead": snapshot.head, "indexSha256": snapshot.index_sha256, "sourceIdentity": reviewed, "preparedAt": datetime.now(timezone.utc).isoformat(), "helperSha256": sha256(Path(__file__).read_bytes()), "limits": {"inlineBytes": args.inline_limit, "treeRequestBytes": args.request_limit}, "commitParameters": {"repository_full_name": REPOSITORY, "parent_sha": publication.head, "additional_parent_shas": [], "tree_sha": snapshot.expected_tree}, **payload}
            encoded = (json.dumps(manifest, ensure_ascii=True, indent=2) + "\n").encode("ascii")
            (folder / "manifest.json").write_bytes(encoded)
            (folder / "manifest.sha256").write_text(sha256(encoded) + "\n", encoding="ascii")
            verify_payload(folder, sha256(encoded), publication, old, snapshot.entries)
            snapshot.assert_unchanged()
            os.rename(folder, out)
        print(json.dumps({"output": str(out), "expectedTree": snapshot.expected_tree, "manifestSha256": sha256((out / "manifest.json").read_bytes()), "reviewedChangedFiles": len(reviewed["changedPaths"]), "incrementalChangedFiles": payload["incrementalChangedFiles"], "reusedBlobPaths": payload["reusedBlobPaths"], "newBlobUploads": len(payload["blobs"]), "newInlineBlobs": payload["newInlineBlobs"], "treeGroups": len(payload["groups"]), "payloadBytes": sum(path.stat().st_size for path in out.iterdir())}, indent=2))
    finally:
        snapshot.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="/workspace/scratch/1b47eb428672/m15-v3")
    parser.add_argument("--out", required=True)
    parser.add_argument("--expected-tree", required=True, help="Root-supplied final git write-tree SHA after reviewed staging")
    parser.add_argument("--published-parent", required=True, help="Actual published parent SHA supplied by the root controller")
    parser.add_argument("--published-tree", required=True, help="Measured tree of the actual published parent")
    parser.add_argument("--inline-limit", type=int, default=160000)
    parser.add_argument("--request-limit", type=int, default=250000)
    args = parser.parse_args()
    require(len(args.expected_tree) == 40 and all(character in "0123456789abcdef" for character in args.expected_tree), "Invalid expected tree SHA")
    require(args.inline_limit > 0 and args.request_limit > 1000, "Invalid payload limits")
    prepare(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(f"Publication payload rejected: {error}", file=sys.stderr)
        raise SystemExit(1)
