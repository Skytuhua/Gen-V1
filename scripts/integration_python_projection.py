"""Read-only wheel-authenticated projection of the v1 integration payload.

The historical lock remains the authority for every installed byte except pip's
machine-dependent RECORD files. Wheel archives supply ownership, never a cache
RECORD. No wheel code, entry point, installer, or dependency is executed here.
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import re
import stat
import sys
import zipfile
from email.parser import BytesParser
from pathlib import Path
from urllib.parse import urlsplit

PREFIX = ".harness-integrations-python-deps/"
MAX_FILES = 20_000
MAX_BYTES = 1024 * 1024 * 1024
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
OMITTED_DIRECTORIES = {"__pycache__", "bin", "Scripts"}
BOOKKEEPING = {"RECORD", "REQUESTED", "direct_url.json"}


class ProjectionError(ValueError):
    def __init__(self, message: str, diagnosis: dict | None = None):
        super().__init__(message)
        self.diagnosis = diagnosis


def _fail(message: str) -> None:
    raise ProjectionError(message)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _path(value: str, *, directory: bool = False) -> str:
    if not isinstance(value, str):
        _fail("Invalid Python payload path")
    value = value[:-1] if directory and value.endswith("/") else value
    if (not value or len(value) > 4096 or "\\" in value or ":" in value
            or any(ord(char) < 32 for char in value)
            or any(part in {"", ".", ".."} for part in value.split("/"))
            or len(value.split("/")) > 48):
        _fail("Unsafe Python payload or wheel member path")
    return value


def _ordinary(path: Path, *, directory: bool = False):
    info = path.lstat()
    if (stat.S_ISLNK(info.st_mode)
            or getattr(info, "st_file_attributes", 0) & 0x400
            or (not stat.S_ISDIR(info.st_mode) if directory else not stat.S_ISREG(info.st_mode))
            or (not directory and info.st_nlink != 1)):
        _fail("Python payload requires ordinary single-link files and directories")
    return info


def _read(path: Path, limit: int = MAX_FILE_BYTES) -> bytes:
    before = _ordinary(path)
    if before.st_size > limit:
        _fail("Python payload file exceeds its byte bound")
    data = path.read_bytes()
    after = _ordinary(path)
    if (len(data) != before.st_size or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)):
        _fail("Python payload file changed while reading")
    return data


def _json(data: bytes):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                _fail("Duplicate Python lock or projection JSON key")
            result[key] = value
        return result
    return json.loads(data.decode("utf-8"), object_pairs_hook=unique)


def _row(path: str, data: bytes) -> dict:
    return {"path": path, "bytes": len(data), "sha256": _sha(data)}


def _walk(directory: Path) -> dict[str, dict]:
    result = {}
    aliases = set()
    total = 0

    def visit(current: Path, parts: tuple[str, ...]):
        nonlocal total
        if len(parts) > 48:
            _fail("Python payload nesting exceeds its bound")
        _ordinary(current, directory=True)
        for entry in sorted(current.iterdir(), key=lambda item: item.name):
            if entry.name in OMITTED_DIRECTORIES or re.search(r"\.py[co]$", entry.name, re.I):
                continue
            relative = _path("/".join((*parts, entry.name)))
            info = entry.lstat()
            if stat.S_ISDIR(info.st_mode):
                visit(entry, (*parts, entry.name))
                continue
            data = _read(entry)
            key = PREFIX + relative
            if key.casefold() in aliases:
                _fail("Python payload contains colliding paths")
            aliases.add(key.casefold())
            total += len(data)
            if len(result) >= MAX_FILES or total > MAX_BYTES:
                _fail("Python payload exceeds its file or byte bound")
            result[key] = _row(key, data)
    visit(directory, ())
    return result


def _diagnosis(expected: dict[str, dict], actual: dict[str, dict]) -> dict:
    added = [actual[key] for key in sorted(actual.keys() - expected.keys())]
    missing = [expected[key] for key in sorted(expected.keys() - actual.keys())]
    changed = [{"path": key, "expectedBytes": expected[key]["bytes"],
                "actualBytes": actual[key]["bytes"], "expectedSha256": expected[key]["sha256"],
                "actualSha256": actual[key]["sha256"]}
               for key in sorted(expected.keys() & actual.keys()) if expected[key] != actual[key]]
    truncated = any(len(rows) > 100 for rows in (added, missing, changed))
    return {"expectedFiles": len(expected), "actualFiles": len(actual),
            "addedCount": len(added), "missingCount": len(missing), "changedCount": len(changed),
            "added": added[:100], "missing": missing[:100], "changed": changed[:100],
            "truncated": truncated}


def _identity(metadata: bytes) -> tuple[str, str]:
    message = BytesParser().parsebytes(metadata)
    if len(message.get_all("Name", [])) != 1 or len(message.get_all("Version", [])) != 1:
        _fail("Python distribution metadata has an ambiguous identity")
    return re.sub(r"[-_.]+", "-", message["Name"]).lower(), message["Version"]


def _record_path(relative: str) -> bool:
    return bool(re.fullmatch(r"[^/]+\.dist-info/RECORD", relative))


def _spread(member: str, info_directory: str) -> str | None:
    parts = member.split("/")
    if parts[0].endswith(".dist-info") and parts[0] != info_directory:
        _fail("Wheel claims a foreign distribution metadata directory")
    if parts[0].endswith(".data"):
        if parts[0] != info_directory.removesuffix(".dist-info") + ".data" or len(parts) < 3:
            _fail("Wheel data has an invalid distribution owner or path")
        scheme = parts[1]
        if scheme == "scripts":
            return None  # The legacy bundle does not ship generated console launchers.
        if scheme not in {"purelib", "platlib", "data"}:
            _fail("Wheel uses an unsupported installation path scheme")
        parts = parts[2:]
    if parts[0].endswith(".dist-info") and parts[0] != info_directory:
        _fail("Spread wheel member claims a foreign distribution metadata directory")
    if any(part in OMITTED_DIRECTORIES for part in parts) or re.search(r"\.py[co]$", parts[-1], re.I):
        return None
    return _path("/".join(parts))


def _wheel_members(archive: Path, distribution: dict, info_directory: str,
                   expected: dict[str, dict], claimed: dict[str, str]) -> set[str]:
    data = _read(archive, MAX_ARCHIVE_BYTES)
    if _sha(data) != distribution["wheelSha256"]:
        _fail("Pinned wheel archive checksum mismatch: " + archive.name)
    with zipfile.ZipFile(io.BytesIO(data)) as wheel:
        members = {}
        aliases = set()
        unpacked = 0
        for member in wheel.infolist():
            name = _path(member.filename, directory=member.is_dir())
            alias = name.casefold()
            if alias in aliases:
                _fail("Duplicate or colliding wheel member path")
            aliases.add(alias)
            mode = member.external_attr >> 16
            if (stat.S_IFMT(mode) not in {0, stat.S_IFREG, stat.S_IFDIR}
                    or member.flag_bits & 1):
                _fail("Wheel member is a link, special file, or encrypted entry")
            if member.is_dir():
                continue
            unpacked += member.file_size
            if member.file_size > MAX_FILE_BYTES or unpacked > MAX_BYTES or len(members) >= MAX_FILES:
                _fail("Wheel archive exceeds its bounded member payload")
            with wheel.open(member) as stream:
                contents = stream.read(MAX_FILE_BYTES + 1)
            if len(contents) != member.file_size:
                _fail("Wheel member byte count changed")
            members[name] = contents
        record_name = info_directory + "/RECORD"
        if record_name not in members or info_directory + "/METADATA" not in members:
            _fail("Wheel is missing its owned RECORD or distribution metadata")
        if _identity(members[info_directory + "/METADATA"]) != (distribution["name"], distribution["version"]):
            _fail("Wheel distribution identity differs from the original lock")
        rows = {}
        for row in csv.reader(io.StringIO(members[record_name].decode("utf-8"), newline=""), strict=True):
            if len(row) != 3:
                _fail("Malformed wheel RECORD row")
            name = _path(row[0])
            if name in rows:
                _fail("Duplicate wheel RECORD member")
            rows[name] = row
        if set(rows) != set(members):
            _fail("Wheel RECORD does not cover exactly its archive members")
        owned = set()
        for name, contents in members.items():
            row = rows[name]
            if name == record_name:
                if row[1:] != ["", ""]:
                    _fail("Wheel RECORD self entry must not contain a digest")
                continue
            algorithm, separator, digest = row[1].partition("=")
            if algorithm not in {"sha256", "sha384", "sha512"} or not separator:
                _fail("Wheel member has no supported RECORD checksum")
            actual_digest = base64.urlsafe_b64encode(hashlib.new(algorithm, contents).digest()).decode().rstrip("=")
            if digest != actual_digest or row[2] != str(len(contents)):
                _fail("Wheel member content differs from its RECORD checksum")
            relative = _spread(name, info_directory)
            if relative is None:
                continue
            if _record_path(relative):
                _fail("Wheel member aliases an installed RECORD authority")
            key = PREFIX + relative
            if key not in expected or _row(key, contents) != expected[key]:
                _fail("Wheel member content differs from the original payload lock: " + relative)
            if key in claimed:
                _fail("Duplicate wheel ownership of runtime file: " + relative)
            claimed[key] = info_directory
            owned.add(key)
        return owned


def project_python_payload(root: Path | str, wheel_directory: Path | str) -> dict:
    root, wheel_directory = Path(root).absolute(), Path(wheel_directory).absolute()
    _ordinary(root, directory=True)
    _ordinary(wheel_directory, directory=True)
    lock_bytes = _read(root / "third-party/integrations/PYTHON_LOCK.json", 8 * 1024 * 1024)
    lock = _json(lock_bytes)
    if lock.get("version") != 1 or lock.get("python") != "3.14" or not isinstance(lock.get("files"), list):
        _fail("Unsupported original Python integration lock")
    expected = {}
    aliases = set()
    for row in lock["files"]:
        key = _path(row.get("path"))
        if (not key.startswith(PREFIX) or type(row.get("bytes")) is not int or row["bytes"] < 0
                or row["bytes"] > MAX_FILE_BYTES or not re.fullmatch(r"[a-f0-9]{64}", row.get("sha256", ""))
                or set(row) != {"path", "bytes", "sha256"} or key.casefold() in aliases):
            _fail("Invalid or colliding original Python lock file")
        expected[key] = row
        aliases.add(key.casefold())
    if not expected or len(expected) > MAX_FILES or sum(row["bytes"] for row in expected.values()) > MAX_BYTES:
        _fail("Original Python lock exceeds its payload bounds")
    if lock.get("bytes") != sum(row["bytes"] for row in expected.values()):
        _fail("Original Python lock byte total differs")
    actual = _walk(root / PREFIX.removesuffix("/"))
    diagnosis = _diagnosis(expected, actual)
    try:
        infos = {key[len(PREFIX):].split("/")[0] for key in expected
                 if re.fullmatch(r"[^/]+\.dist-info/METADATA", key[len(PREFIX):])}
        for key, row in expected.items():
            if not _record_path(key[len(PREFIX):]) and actual.get(key) != row:
                _fail("Missing or changed locked non-RECORD payload file: " + key[len(PREFIX):])
        for key in actual.keys() - expected.keys():
            relative = key[len(PREFIX):].split("/")
            if len(relative) != 2 or relative[0] not in infos or relative[1] not in BOOKKEEPING:
                _fail("Unexpected undeclared Python payload file: " + key[len(PREFIX):])
        distributions = lock.get("distributions")
        if not isinstance(distributions, list) or len(distributions) != len(infos):
            _fail("Python distribution inventory differs from its lock")
        by_identity = {}
        for info in infos:
            identity = _identity(_read(root / PREFIX / info / "METADATA"))
            if identity in by_identity:
                _fail("Duplicate Python distribution metadata identity")
            by_identity[identity] = info
            if PREFIX + info + "/RECORD" not in expected or PREFIX + info + "/INSTALLER" not in expected:
                _fail("Original Python distribution bookkeeping is incomplete")
        claimed = {}
        generated = {}
        wheel_receipts = []
        seen_distributions = set()
        seen_archives = set()
        for distribution in distributions:
            identity = (distribution.get("name"), distribution.get("version"))
            source = urlsplit(distribution.get("sourceUrl", ""))
            filename = source.path.rsplit("/", 1)[-1]
            if (identity not in by_identity or identity in seen_distributions
                    or source.scheme != "https" or source.netloc != "files.pythonhosted.org"
                    or source.query or source.fragment
                    or not re.fullmatch(r"[A-Za-z0-9_.+-]+\.whl", filename)
                    or not re.fullmatch(r"[a-f0-9]{64}", distribution.get("wheelSha256", ""))
                    or filename.casefold() in seen_archives):
                _fail("Invalid pinned wheel distribution identity")
            seen_distributions.add(identity)
            seen_archives.add(filename.casefold())
            info = by_identity[identity]
            owned = _wheel_members(wheel_directory / filename, distribution, info, expected, claimed)
            for name in ("INSTALLER", "REQUESTED"):
                key = PREFIX + info + "/" + name
                if key not in expected:
                    continue
                if key in claimed:
                    _fail("Wheel claims installer-generated bookkeeping")
                if name == "REQUESTED":
                    if expected[key] != _row(key, b""):
                        _fail("Original REQUESTED bookkeeping is not empty")
                    generated[key] = ""
                claimed[key] = info
                owned.add(key)
            record_key = PREFIX + info + "/RECORD"
            output_rows = [(key[len(PREFIX):], "sha256=" + base64.urlsafe_b64encode(bytes.fromhex(expected[key]["sha256"])).decode().rstrip("="), str(expected[key]["bytes"])) for key in owned]
            output_rows.append((record_key[len(PREFIX):], "", ""))
            buffer = io.StringIO(newline="")
            csv.writer(buffer, lineterminator="\r\n").writerows(sorted(output_rows))
            generated[record_key] = buffer.getvalue()
            claimed[record_key] = info
            wheel_receipts.append({"name": identity[0], "version": identity[1], "sha256": distribution["wheelSha256"]})
        if set(claimed) != set(expected):
            _fail("Authenticated wheel ownership does not cover the complete original lock")
        files = []
        for key, row in expected.items():
            if key in generated:
                files.append({**_row(key, generated[key].encode("utf-8")), "content": generated[key]})
            else:
                files.append({**row, "source": str(root / key)})
        receipt = {"version": 2, "mode": "wheel-canonical-record-v2", "sourceLockSha256": _sha(lock_bytes),
                   "wheels": wheel_receipts, "files": [{key: row[key] for key in ("path", "bytes", "sha256")} for row in files]}
        return {"files": files, "bytes": sum(row["bytes"] for row in files), "receipt": receipt, "inputDiagnosis": diagnosis}
    except ProjectionError as error:
        error.diagnosis = diagnosis
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--wheel-directory", required=True)
    arguments = parser.parse_args()
    try:
        result = project_python_payload(arguments.root, arguments.wheel_directory)
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
    except (OSError, ValueError, zipfile.BadZipFile, csv.Error) as error:
        diagnosis = getattr(error, "diagnosis", None)
        if diagnosis is not None:
            print("HARNESS_PYTHON_INPUT_DIAGNOSIS=" + json.dumps(diagnosis, ensure_ascii=True, separators=(",", ":")), file=sys.stderr)
        print("Python integration projection failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)
