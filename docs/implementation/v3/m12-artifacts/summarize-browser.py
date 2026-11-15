#!/usr/bin/env python3
"""Summarize existing Playwright JSON reports; never launch tests or a browser.

Default mode requires a completed recorder record. --allow-running may produce
an explicitly INCOMPLETE scratch summary while the runner is still active.
Failure exits remain FAIL, including missing Chrome/Edge. A successful summary
generation command does not mean that the summarized browser command passed.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess


ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])")
MESSAGE_LIMIT = 1000
ERROR_LIMIT = 3


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source(path: Path, root: Path, raw: bytes | None = None) -> dict:
    if raw is None:
        raw = path.read_bytes()
    try:
        ref = str(path.resolve().relative_to(root))
    except ValueError:
        ref = str(path.resolve())
    return {"path": str(path.resolve()), "ref": ref, "sha256": sha256(raw), "bytes": len(raw)}


def clean(text: str) -> str:
    return ANSI.sub("", text)


def errors(values: list) -> tuple[list[dict], str, int]:
    messages = []
    for value in values:
        if isinstance(value, dict):
            text = value.get("message") or value.get("value") or value.get("stack") or json.dumps(value, ensure_ascii=False)
        else:
            text = str(value)
        text = clean(str(text))
        if text and text not in messages:
            messages.append(text)
    bounded = [{"message": text[:MESSAGE_LIMIT], "characters": len(text), "truncated": len(text) > MESSAGE_LIMIT,
                "fullMessageSha256": sha256(text.encode())} for text in messages[:ERROR_LIMIT]]
    return bounded, "\n".join(messages), max(0, len(messages) - ERROR_LIMIT)


def reason(message: str, status: str) -> str:
    text = message.lower()
    missing = "not found" in text or "doesn't exist" in text or "does not exist" in text
    if missing and ("distribution 'msedge'" in text or "distribution \"msedge\"" in text or "/msedge/" in text):
        return "MISSING_EDGE_BINARY"
    if missing and ("distribution 'chrome'" in text or "distribution \"chrome\"" in text or "/google/chrome/" in text):
        return "MISSING_CHROME_BINARY"
    if missing and ("chromium" in text or "headless_shell" in text) and ("browser" in text or "executable" in text):
        return "MISSING_CHROMIUM_BINARY"
    if "webserver" in text or "web server" in text or "config.webserver" in text:
        return "WEB_SERVER_FAILURE"
    if "browsertype.launch" in text or "browser launch" in text:
        return "BROWSER_LAUNCH_FAILURE"
    if status == "timedOut" or "test timeout of" in text:
        return "TEST_TIMEOUT"
    if status == "interrupted":
        return "INTERRUPTED"
    if status == "skipped":
        return "SKIPPED"
    if status == "passed":
        return "PASSED"
    return "TEST_OR_REPORT_ERROR" if message else "NO_EXECUTION_RESULT"


def flatten(nodes: list, parents: tuple[str, ...] = ()):
    for node in nodes:
        title = node.get("title", "")
        path = parents + ((title,) if title else ())
        for spec in node.get("specs", []):
            yield spec, path + (spec.get("title", ""),)
        yield from flatten(node.get("suites", []), path)


def case_summary(spec: dict, test: dict, title_path: tuple[str, ...], index: int) -> dict:
    attempts = []
    for result in test.get("results", []):
        raw_errors = list(result.get("errors", []))
        if result.get("error"):
            raw_errors.append(result["error"])
        bounded, message, omitted = errors(raw_errors)
        attempts.append({"retry": result.get("retry"), "status": result.get("status"),
                         "classification": reason(message, result.get("status", "")),
                         "durationMs": result.get("duration"), "startedAt": result.get("startTime"),
                         "workerIndex": result.get("workerIndex"), "parallelIndex": result.get("parallelIndex"),
                         "errors": bounded, "additionalErrorsOmitted": omitted})
    annotations = test.get("annotations", [])
    skipped = test.get("status") == "skipped"
    declared_skip = test.get("expectedStatus") == "skipped" or any(a.get("type") in {"skip", "fixme"} for a in annotations)
    outcome = {"expected": "EXPECTED", "unexpected": "FAIL", "flaky": "FLAKY", "skipped": "SKIPPED"}.get(test.get("status"), "UNKNOWN")
    return {"id": spec.get("id"), "instanceIndex": index, "file": spec.get("file"),
            "line": spec.get("line"), "column": spec.get("column"), "titlePath": list(title_path),
            "projectId": test.get("projectId"), "projectName": test.get("projectName"),
            "expectedStatus": test.get("expectedStatus"), "playwrightStatus": test.get("status"),
            "outcome": outcome, "specOk": spec.get("ok"),
            "classification": attempts[-1]["classification"] if attempts else "NO_EXECUTION_RESULT",
            "skipDisposition": ("DECLARED_SKIP" if declared_skip else "UNEXECUTED_OR_RUNTIME_SKIP") if skipped else None,
            "skipReasons": [clean(str(a.get("description", "")))[:MESSAGE_LIMIT] for a in annotations if a.get("type") in {"skip", "fixme"}],
            "attempts": attempts}


def registry(root: Path) -> tuple[list[dict], dict]:
    path = root / "scripts/browser-suites.ts"
    before = path.read_bytes()
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node is needed only to read the existing typed suite registry")
    # browser-suites.ts contains registry data and validation functions only.
    # Importing it does not import test-browser.ts or launch Playwright.
    argv = [node, "--import", "tsx", "--input-type=module", "-e",
            "import {browserSuites} from './scripts/browser-suites.ts'; process.stdout.write(JSON.stringify(browserSuites));"]
    result = subprocess.run(argv, cwd=root, check=True, capture_output=True, text=True, timeout=20)
    if path.read_bytes() != before:
        raise RuntimeError("Suite registry changed during metadata capture")
    suites = json.loads(result.stdout)
    if len({row["name"] for row in suites}) != len(suites):
        raise RuntimeError("Duplicate suite name in the existing registry")
    return suites, {"source": source(path, root, before), "metadataOnlyCommand": argv}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[4])
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--command-record", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--suite", help="Restrict to one named suite, for example the separately completed M12 run")
    parser.add_argument("--preserve-report", type=Path, help="Copy the exact single-suite raw JSON report to this evidence path")
    parser.add_argument("--allow-running", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    run = (root / args.run_dir).resolve()
    output = (root / args.output).resolve()
    record_path = (root / args.command_record).resolve()
    rows, registry_info = registry(root)
    if args.suite:
        rows = [row for row in rows if row["name"] == args.suite]
        if not rows:
            raise RuntimeError("Unknown requested suite")
    if args.preserve_report and len(rows) != 1:
        raise RuntimeError("Raw-report preservation requires exactly one named suite")

    command = None
    log_text = ""
    log_source = None
    completed = False
    if record_path.exists():
        record_bytes = record_path.read_bytes()
        command = json.loads(record_bytes)
        log_path = root / command["boundedLogRef"]
        log_bytes = log_path.read_bytes()
        if sha256(log_bytes) != command["logDigest"]:
            raise RuntimeError("Recorder log digest does not match the completed command record")
        log_source = source(log_path, root, log_bytes)
        log_text = clean(log_bytes.decode("utf-8"))
        if str(run) not in log_text:
            raise RuntimeError("Completed command log does not identify this browser run directory")
        completed = bool(command.get("endedAt")) and command.get("exitCode") is not None
    if not completed and not args.allow_running:
        raise RuntimeError("The browser command has not completed; refusing a final summary")
    failures = {}
    for match in re.finditer(r"Failed browser suites: ([^\r\n]+)", log_text):
        failures.update({name.strip(): int(code) for name, code in re.findall(r"([^,]+?) \(exit (-?\d+)\)", match.group(1))})
    # The runner continues every suite and prints this list at normal completion.
    exit_list_complete = completed and command.get("termination") == "NONE" and (command["exitCode"] == 0 or bool(failures))
    suites = []
    case_counts, attempt_counts, classifications, suite_counts = Counter(), Counter(), Counter(), Counter()
    declared_stats = Counter()
    inconsistencies = []
    for row in rows:
        name = row["name"]
        report_path = run / name / "results.json"
        entry = {"name": name, "config": row["config"], "specs": row["specs"],
                 "selectedProject": row.get("project"), "suiteEnvironment": row.get("env", {}),
                 "exitCode": failures.get(name, 0) if exit_list_complete else None,
                 "exitCodeBasis": "completed runner failed-suite list" if exit_list_complete else "not yet available",
                 "report": None, "reportStats": None, "cases": [], "errors": []}
        config_path = root / row["config"]
        entry["configSourceAtSummaryTime"] = source(config_path, root) if config_path.exists() else None
        if not report_path.exists():
            entry["status"] = "FAIL" if entry["exitCode"] not in {None, 0} else "NO_REPORT"
            entry["classification"] = "MISSING_JSON_REPORT"
            entry["reportAvailability"] = "MISSING"
        else:
            raw = report_path.read_bytes()
            entry["report"] = source(report_path, root, raw)
            try:
                report = json.loads(raw)
            except json.JSONDecodeError as error:
                entry["status"] = "FAIL" if completed else "INCOMPLETE"
                entry["classification"] = "INVALID_JSON_REPORT"
                entry["reportAvailability"] = "INVALID"
                entry["errors"] = errors([str(error)])[0]
            else:
                entry["reportAvailability"] = "PRESENT"
                entry["reportStats"] = report.get("stats", {})
                entry["playwrightVersion"] = report.get("config", {}).get("version")
                entry["projects"] = [{key: project.get(key) for key in ("id", "name", "timeout", "retries", "repeatEach", "metadata")}
                                     for project in report.get("config", {}).get("projects", [])]
                bounded, message, omitted = errors(report.get("errors", []))
                entry["errors"], entry["additionalErrorsOmitted"] = bounded, omitted
                for spec, titles in flatten(report.get("suites", [])):
                    for index, test in enumerate(spec.get("tests", [])):
                        case = case_summary(spec, test, titles, index)
                        entry["cases"].append(case)
                        case_counts[case["playwrightStatus"] or "unknown"] += 1
                        classifications[case["classification"]] += 1
                        for attempt in case["attempts"]:
                            attempt_counts[attempt["status"] or "unknown"] += 1
                stats = entry["reportStats"]
                for key in ("expected", "unexpected", "flaky", "skipped"):
                    declared_stats[key] += stats.get(key, 0)
                    actual = sum(case["playwrightStatus"] == key for case in entry["cases"])
                    if actual != stats.get(key, 0):
                        inconsistencies.append({"suite": name, "field": key, "reportStats": stats.get(key, 0), "enumeratedCases": actual})
                failed = entry["exitCode"] not in {None, 0} or bool(entry["errors"]) or stats.get("unexpected", 0) > 0
                entry["status"] = "FAIL" if failed else "SKIPPED" if entry["cases"] and all(case["playwrightStatus"] == "skipped" for case in entry["cases"]) else "PASS" if entry["cases"] else "NO_CASES"
                entry["classification"] = reason(message, "") if entry["errors"] else "CASE_RESULTS"
                entry["caseClassifications"] = dict(sorted(Counter(case["classification"] for case in entry["cases"]).items()))
                if args.preserve_report:
                    preserved = (root / args.preserve_report).resolve()
                    if preserved == report_path:
                        raise RuntimeError("Preserved evidence must not overwrite the runner's original report")
                    if preserved.exists() and preserved.read_bytes() != raw:
                        raise RuntimeError("Refusing to replace different preserved raw evidence")
                    preserved.parent.mkdir(parents=True, exist_ok=True)
                    preserved.write_bytes(raw)
                    entry["preservedReport"] = source(preserved, root, raw)
        suite_counts[entry["status"]] += 1
        suites.append(entry)

    present_names = {path.parent.name for path in run.glob("*/results.json")}
    expected_names = {row["name"] for row in rows}
    missing = [row["name"] for row in suites if row.get("reportAvailability") != "PRESENT"]
    command_failed = completed and (command["exitCode"] != 0 or command.get("termination") != "NONE")
    status = "INCOMPLETE" if not completed else "FAIL" if command_failed or suite_counts["FAIL"] or missing or inconsistencies else "PASS"
    summary = {
        "schemaVersion": 1, "kind": "RECORDED_BROWSER_RUN_SUMMARY", "status": status,
        "generatedAt": datetime.now(timezone.utc).isoformat(), "runDirectory": str(run),
        "commandCompleted": completed, "allExpectedReportsPresent": not missing,
        "command": ({**command, "recordSource": source(record_path, root), "logSource": log_source} if command else None),
        "runnerSourceAtSummaryTime": source(root / "scripts/test-browser.ts", root),
        "registry": registry_info, "scope": args.suite or "ALL_REGISTERED_SUITES",
        "summaryScript": source(Path(__file__), root),
        "counts": {"expectedSuites": len(rows), "reportsPresent": len(rows) - len(missing),
                   "suiteStatuses": dict(sorted(suite_counts.items())), "cases": sum(case_counts.values()),
                   "playwrightCaseStatuses": dict(sorted(case_counts.items())), "reportedStats": dict(sorted(declared_stats.items())),
                   "attemptStatuses": dict(sorted(attempt_counts.items())), "caseClassifications": dict(sorted(classifications.items()))},
        "missingOrInvalidReportSuites": missing,
        "unexpectedReportDirectories": sorted(present_names - expected_names) if not args.suite else [],
        "reportCountInconsistencies": inconsistencies, "suites": suites,
        "interpretation": [
            "Nonzero browser command and suite exits remain FAIL. Missing browser binaries are classified separately, never converted to passing or skipped checks.",
            "Every reported project/repeat test case and retry status is retained. Declared skips and unexecuted/runtime skips remain separate from missing-browser launch failures.",
            "Raw JSON source paths, sizes and SHA-256 hashes bind the summary to the reports. Failure messages are ANSI-stripped and bounded; full message hashes and raw sources preserve attribution.",
            "No test, browser, fixture server, installation or application runtime is launched by this script. It imports only the existing suite registry for metadata.",
            "Runner, registry and configuration hashes describe summary-time files. A long-running browser invocation does not itself prove that every suite ran on one immutable source cut.",
            "This artifact excludes trace ZIPs, screenshots and fixture-session contents. A summary-generation exit zero is evidence-processing success, not a browser acceptance pass.",
        ],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": source(output, root), "status": status, "counts": summary["counts"], "commandCompleted": completed}, indent=2))


if __name__ == "__main__":
    main()
