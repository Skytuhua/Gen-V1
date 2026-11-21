#!/usr/bin/env python3
"""Compare existing Vitest JSON observations. Never launches or changes tests.

Identity is relative file path + exact fullName + one-based occurrence for
duplicate names. Worktree-root replacement is only used for a second, explicitly
labelled failure-message comparison; original messages remain in the output.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re


ROOT = pathlib.Path(__file__).resolve().parents[4]


def load(path):
    raw = path.read_bytes()
    return json.loads(raw), {"path": str(path), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def inventory(report, root):
    cases = {}
    duplicates = []
    files = {}
    root = root.resolve()
    for suite in report["testResults"]:
        source = pathlib.Path(suite["name"])
        relative = source.relative_to(root).as_posix() if source.is_absolute() else source.as_posix()
        if relative in files:
            raise ValueError(f"Duplicate file report cannot be safely matched: {relative}")
        files[relative] = {"status": suite["status"], "message": suite.get("message", ""), "assertionCount": len(suite["assertionResults"])}
        frequencies = collections.Counter(case["fullName"] for case in suite["assertionResults"])
        occurrences = collections.Counter()
        duplicates.extend({"file": relative, "fullName": name, "count": count} for name, count in frequencies.items() if count > 1)
        for case in suite["assertionResults"]:
            name = case["fullName"]
            occurrences[name] += 1
            key = (relative, name, occurrences[name])
            cases[key] = {
                "file": relative, "fullName": name, "occurrence": occurrences[name],
                "status": case["status"], "failureMessages": case.get("failureMessages", []),
                "duplicateName": frequencies[name] > 1,
            }
    return cases, files, duplicates


def normalize(messages, roots):
    output = []
    for message in messages:
        for root in sorted(set(str(path.resolve()) for path in roots), key=len, reverse=True):
            message = message.replace(root, "<WORKTREE>")
        output.append(message)
    return output


def unhandled(path, log_path):
    if path and path.is_file():
        data, source = load(path)
        return {"status": "RECORDED", "source": source, **data}
    evidence = []
    log_source = None
    if log_path and log_path.is_file():
        raw = log_path.read_bytes()
        log_source = {"path": str(log_path), "sha256": hashlib.sha256(raw).hexdigest()}
        for line in raw.decode("utf8", errors="replace").splitlines():
            if re.search(r"Unhandled Errors|Unhandled Rejection|Uncaught Exception|caught \d+ unhandled", line, re.I):
                evidence.append(line[:4096])
    return {
        "status": "UNKNOWN", "unhandledErrorCount": None, "logSource": log_source,
        "retainedLogObservations": evidence,
        "reason": "The installed Vitest JSON reporter does not serialize unhandledErrors. Missing text in a retained log cannot establish zero unhandled errors.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=pathlib.Path, default=ROOT / "docs/implementation/v3/m12-logs/baseline-fcaa52-vitest.json")
    parser.add_argument("--candidate", type=pathlib.Path, default=ROOT / "docs/implementation/v3/m12-artifacts/candidate-vitest.json")
    parser.add_argument("--baseline-root", type=pathlib.Path, default=ROOT.parent / "m12-base-fcaa52")
    parser.add_argument("--candidate-root", type=pathlib.Path, default=ROOT)
    parser.add_argument("--baseline-unhandled", type=pathlib.Path)
    parser.add_argument("--candidate-unhandled", type=pathlib.Path, default=ROOT / "docs/implementation/v3/m12-artifacts/candidate-vitest-unhandled.json")
    parser.add_argument("--baseline-log", type=pathlib.Path, default=ROOT / "docs/implementation/v3/m12-logs/baseline-03-full-test-loader.log")
    parser.add_argument("--candidate-log", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, default=ROOT / "docs/implementation/v3/m12-artifacts/unit-baseline-comparison.json")
    parser.add_argument("--markdown", type=pathlib.Path, default=ROOT / "docs/implementation/v3/m12-artifacts/unit-baseline-comparison.md")
    args = parser.parse_args()
    base, base_source = load(args.baseline)
    candidate, candidate_source = load(args.candidate)
    before, base_files, base_duplicates = inventory(base, args.baseline_root)
    after, candidate_files, candidate_duplicates = inventory(candidate, args.candidate_root)
    records = []
    groups = collections.defaultdict(list)
    transitions = collections.Counter()
    message_comparisons = collections.Counter()
    roots = [args.baseline_root, args.candidate_root]
    skipped = {"skipped", "pending", "todo", "disabled"}

    for number, key in enumerate(sorted(before.keys() | after.keys()), 1):
        old, new = before.get(key), after.get(key)
        old_status, new_status = old["status"] if old else "ABSENT", new["status"] if new else "ABSENT"
        reference = f"assertion-{number}"
        record = {"id": reference, "file": key[0], "fullName": key[1], "occurrence": key[2], "baselineStatus": old_status, "candidateStatus": new_status,
                  "duplicateName": bool(old and old["duplicateName"] or new and new["duplicateName"])}
        transitions[(old_status, new_status)] += 1
        if old_status == "failed" or new_status == "failed":
            old_messages = old["failureMessages"] if old else []
            new_messages = new["failureMessages"] if new else []
            record["baselineFailureMessages"] = old_messages
            record["candidateFailureMessages"] = new_messages
        if old_status == "failed" and new_status == "failed":
            groups["inheritedFailingAssertions"].append(reference)
            exact = old_messages == new_messages
            normalized = normalize(old_messages, roots) == normalize(new_messages, roots)
            first_lines = [m.split("\n", 1)[0] for m in old_messages] == [m.split("\n", 1)[0] for m in new_messages]
            comparison = "EXACT" if exact else "WORKTREE_ROOT_ONLY" if normalized else "CHANGED"
            record["failureMessageComparison"] = {"classification": comparison, "firstLinesEqual": first_lines}
            message_comparisons[comparison] += 1
            message_comparisons["FIRST_LINES_EQUAL" if first_lines else "FIRST_LINES_CHANGED"] += 1
        elif new_status == "failed":
            groups["candidateOnlyFailures"].append(reference)
            record["failureTransition"] = "NEW_ASSERTION_FAILED" if old is None else "PASSED_TO_FAILED" if old_status == "passed" else "PREVIOUSLY_NOT_PASSED_TO_FAILED"
        elif old_status == "failed":
            groups["baseOnlyFailures"].append(reference)
            record["failureTransition"] = "FAILED_TO_PASSED" if new_status == "passed" else "FAILED_TO_ABSENT" if new is None else "FAILED_TO_NOT_EXECUTED" if new_status in skipped else "OTHER"
        if old is None:
            groups["candidateAddedAssertions"].append(reference)
        if new is None:
            groups["candidateRemovedAssertions"].append(reference)
        if old_status in skipped and new_status in skipped:
            groups["sharedNotExecuted"].append(reference)
        elif new_status in skipped:
            groups["candidateNewlyNotExecuted"].append(reference)
        elif old_status in skipped:
            groups["baselineNotExecutedNowExecutedOrAbsent"].append(reference)
        records.append(record)

    expected_groups = ["inheritedFailingAssertions", "candidateOnlyFailures", "baseOnlyFailures", "candidateAddedAssertions", "candidateRemovedAssertions", "sharedNotExecuted", "candidateNewlyNotExecuted", "baselineNotExecutedNowExecutedOrAbsent"]
    for key in expected_groups:
        groups.setdefault(key, [])
    file_records = [{"file": name, "baseline": base_files.get(name), "candidate": candidate_files.get(name)} for name in sorted(base_files.keys() | candidate_files.keys())]
    base_unhandled = unhandled(args.baseline_unhandled, args.baseline_log)
    candidate_unhandled = unhandled(args.candidate_unhandled, args.candidate_log)
    result = {
        "version": 1, "mode": "EXISTING_REPORT_COMPARISON_ONLY",
        "matching": {"identity": ["relativeFile", "exactFullName", "occurrenceInReportedFile"],
                     "duplicatePolicy": "Duplicate full names retain separate one-based occurrences in reported source order. Parameter identity cannot be proved from the JSON if duplicate test order changed.",
                     "messagePolicy": "Preserve raw failure messages. Separately compare exact bytes and worktree-root-only normalization. No line-number, timing, temporary-path or wording normalization.",
                     "causalityLimit": "A same-named failing assertion is inherited as an observed failure, not automatically as an identical root cause. Candidate-only failures require source diagnosis."},
        "sources": {"baseline": base_source, "candidate": candidate_source},
        "reportedTotals": {"baseline": {key: value for key, value in base.items() if key.startswith("num") or key == "success"}, "candidate": {key: value for key, value in candidate.items() if key.startswith("num") or key == "success"}},
        "assertionTotals": {"baseline": len(before), "candidate": len(after), "baselineStatuses": dict(collections.Counter(case["status"] for case in before.values())), "candidateStatuses": dict(collections.Counter(case["status"] for case in after.values()))},
        "classificationCounts": {key: len(groups[key]) for key in expected_groups},
        "inheritedFailureMessageCounts": dict(message_comparisons),
        "statusTransitions": [{"baseline": old, "candidate": new, "count": count} for (old, new), count in sorted(transitions.items())],
        "duplicateNames": {"baseline": base_duplicates, "candidate": candidate_duplicates},
        "groups": dict(groups), "assertions": records, "files": file_records,
        "unhandledErrors": {"baseline": base_unhandled, "candidate": candidate_unhandled,
                            "inheritance": "UNDETERMINED" if base_unhandled["status"] != "RECORDED" else "COMPARE_RECORDED_MESSAGES"},
    }
    for source in [args.baseline, args.candidate, args.baseline_unhandled, args.candidate_unhandled, args.baseline_log, args.candidate_log]:
        if source and source.resolve() in {args.output.resolve(), args.markdown.resolve()}:
            raise ValueError("Comparison output cannot overwrite input evidence")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    by_id = {record["id"]: record for record in records}

    def failure_table(group):
        rows = ["| File | Exact test name | Transition | First failure line |", "|---|---|---|---|"]
        for identifier in groups[group]:
            record = by_id[identifier]
            messages = record.get("candidateFailureMessages") or record.get("baselineFailureMessages") or [""]
            first = messages[0].split("\n", 1)[0]
            escaped = [str(value).replace("|", "\\|").replace("\n", " ") for value in [record["file"], record["fullName"], f"{record['baselineStatus']} → {record['candidateStatus']}", first]]
            rows.append("| " + " | ".join(escaped) + " |")
        return "\n".join(rows) if len(rows) > 2 else "None."

    totals = result["assertionTotals"]
    transition_lines = "\n".join(f"| {item['baseline']} | {item['candidate']} | {item['count']} |" for item in result["statusTransitions"])
    count_lines = "\n".join(f"| {name} | {count} |" for name, count in result["classificationCounts"].items())
    markdown = f"""# Accepted-base and candidate unit comparison

This report compares existing JSON observations and launches no tests. Exact identity is relative file path, full test name and duplicate occurrence. The full JSON retains both original failure messages, every status transition and duplicate-name limitations.

Baseline: {totals['baseline']} assertions, statuses `{json.dumps(totals['baselineStatuses'], sort_keys=True)}`.
Candidate: {totals['candidate']} assertions, statuses `{json.dumps(totals['candidateStatuses'], sort_keys=True)}`.

| Classification | Count |
|---|---:|
{count_lines}

Matching failed assertions do not by themselves prove an identical root cause. Inherited failure message comparisons: `{json.dumps(result['inheritedFailureMessageCounts'], sort_keys=True)}`. Only worktree roots are normalized in the labelled secondary comparison.

## Status transitions

| Baseline | Candidate | Assertions |
|---|---|---:|
{transition_lines}

## Candidate-only failures requiring source diagnosis

{failure_table('candidateOnlyFailures')}

## Base-only failures

Failures that became skipped or absent are shown separately from failures that now pass.

{failure_table('baseOnlyFailures')}

## Unhandled errors

Baseline observation: `{base_unhandled['status']}`, count `{base_unhandled.get('unhandledErrorCount')}`.
Candidate observation: `{candidate_unhandled['status']}`, count `{candidate_unhandled.get('unhandledErrorCount')}`.
Unhandled-error inheritance: `{result['unhandledErrors']['inheritance']}`. The installed Vitest JSON reporter omits these errors, so an absent baseline sidecar cannot establish zero.

## Source report identities

Baseline SHA256: `{base_source['sha256']}`.
Candidate SHA256: `{candidate_source['sha256']}`.
"""
    args.markdown.parent.mkdir(parents=True, exist_ok=True)
    args.markdown.write_text(markdown)
    print(json.dumps({"output": str(args.output), "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(), "markdown": str(args.markdown), "counts": result["classificationCounts"], "statusTransitions": result["statusTransitions"], "unhandled": {"baseline": base_unhandled["status"], "candidate": candidate_unhandled["status"], "candidateCount": candidate_unhandled.get("unhandledErrorCount")}}, indent=2))


if __name__ == "__main__":
    main()
