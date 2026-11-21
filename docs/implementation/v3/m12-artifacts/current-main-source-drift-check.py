#!/usr/bin/env python3
"""Verify recorded source drift without merging or changing source/ref state.

Exit zero means immutable-source/evidence custody checks passed. It does not
establish integration compatibility with the newly observed main revision.
"""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[4]
directory = root / 'docs/implementation/v3'
artifact_path = directory / 'm12-artifacts/current-main-source-drift.json'
artifact = json.loads(artifact_path.read_text())


def git(*args):
    return subprocess.check_output(['git', *args], cwd=root).decode().strip()


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


assert artifact['schemaVersion'] == 1
assert artifact['kind'] == 'M12_CURRENT_MAIN_SOURCE_DRIFT'
assert artifact['disposition'] == 'BLOCKED_SOURCE_DRIFT'
assert artifact['revisions'] == {
    'acceptedBase': 'fcaa52f7fcdc9f39420118a79f9a8250ba83c563',
    'reviewedM12': 'd55433f2231597d0efe7515b187e237e11b7ac95',
    'currentMain': '5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42',
}
assert artifact['proofBoundary']['acceptedEvidenceEstablishesNewMainCompatibility'] is False
assert artifact['proofBoundary']['combinedTreeExecutedDuringThisAudit'] is False
assert artifact['proofBoundary']['productionActivationAuthorizedByThisAudit'] is False
for revision in artifact['revisions'].values():
    assert git('cat-file', '-t', revision) == 'commit'
git('merge-base', '--is-ancestor', artifact['acceptedAuditAncestorSha'], artifact['revisions']['acceptedBase'])
git('merge-base', '--is-ancestor', artifact['revisions']['acceptedBase'], artifact['revisions']['currentMain'])

assert len({item['path'] for item in artifact['blobs']}) == len(artifact['blobs'])
verified = 0
for item in artifact['blobs']:
    for role, revision in artifact['revisions'].items():
        entry = git('ls-tree', '--format=%(objecttype) %(objectname)', revision, '--', item['path'])
        expected = item[role]
        assert entry == (f'blob {expected}' if expected else ''), (role, item['path'], entry, expected)
        verified += 1
    same = item['acceptedBase'] == item['currentMain'] if item['acceptedBase'] is not None and item['currentMain'] is not None else None
    assert item['currentMainEqualsAcceptedBase'] is same

for retained in artifact['proofBoundary']['retainedSourceProof']:
    path = root / retained['path']
    assert sha256(path) == retained['sha256'], str(path)
    assert json.loads(path.read_text())['executionBaseSha'] == artifact['revisions']['acceptedBase']
cut = json.loads((directory / 'M12-candidate-source-cut.json').read_text())
for item in cut['files']:
    path = root / item['path']
    assert sha256(path) == item['sha256'], item['path']
    assert path.stat().st_size == item['bytes'], item['path']
    assert git('hash-object', item['path']) == item['blobSha'], item['path']
assert git('diff', '--name-only', artifact['revisions']['reviewedM12'], '--', '.', ':!docs') == ''
assert not [path for path in git('ls-files', '--others', '--exclude-standard').splitlines() if not path.startswith('docs/')]

log_path = directory / 'm12-logs/source-02-current-main-merge-preview.log'
record = json.loads((directory / 'm12-artifacts/command-records.json').read_text()).get('source-02-current-main-merge-preview')
if record is None:
    record = json.loads(Path('<tmp>/m12-command-records/source-02-current-main-merge-preview.json').read_text())
assert sha256(log_path) == record['logDigest']
header_text, body = log_path.read_text().split('\n\n', 1)
header = json.loads(header_text)
assert header['argv'] == ['git', 'merge-tree', '--write-tree', '--name-only', '--messages', artifact['revisions']['reviewedM12'], artifact['revisions']['currentMain']]
assert header['cwd'] == str(root) == record['cwdIdentity']
assert header['exitCode'] == record['exitCode'] == 1
assert header['termination'] == record['termination'] == 'NONE'
assert record['status'] == 'FAIL'
assert header['truncated'] is False
preview, _messages = body.split('\n\n', 1)
tree, *conflicts = preview.splitlines()
assert tree == '7fbcf03cd6c43fbd1d9f9c9a41e09610ac8d3557'
assert conflicts == artifact['reportedMergeConflicts']['paths']
assert len(conflicts) == 4
original = root.parent / 'Gen-V1'
assert git('-C', str(original), 'status', '--porcelain') == ''
assert git('-C', str(original), 'rev-parse', 'HEAD') == artifact['revisions']['acceptedBase']
assert git('branch', '--show-current') == 'agent/m12-v3'

print(json.dumps({
    'auditCustody': 'PASS',
    'integrationDisposition': 'BLOCKED_SOURCE_DRIFT',
    'verifiedRevisionPathPairs': verified,
    'unchangedReviewedSourceEntries': len(cut['files']),
    'actualMergePreviewExit': header['exitCode'],
    'conflictingPaths': conflicts,
    'combinedIntegrationExecuted': False,
    'productionActivationAuthorized': False,
    'artifactSha256': sha256(artifact_path),
}, indent=2))
