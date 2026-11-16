#!/usr/bin/env python3
"""New offline M05 installed-artifact review validator, not a recovered helper.

Only reads immutable inputs/Git objects. Writes a new report only when --report is
explicit. No network, package execution, artifact extraction, source or ledger writes.
Version 3 adds an explicit exact-head push-event rule. It does not admit an
artifact until all unchanged semantic receipt predicates pass on actual evidence.
"""
import argparse
import datetime as dt
import hashlib
import io
import json
import ntpath
import pathlib
import re
import stat
import subprocess
import sys
import zipfile

PASS = 'PASS_INSTALLED_DEFAULT_OFF_RETAINED_MEMORY_ONLY'
REPO = 'skytuhua-org/Gen-V1'
REPO_ID = 1442565952
JOB = 'Installed desktop memory retention'
VERIFY_STEP = 'Verify installed default-off memory retention and restart'
PACKAGE_STEP = 'Package the production Windows installer'
SHA = re.compile(r'^[0-9a-f]{64}$')
OID = re.compile(r'^[0-9a-f]{40}$')
ID = re.compile(r'^[a-zA-Z0-9:_.-]{1,200}$')
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
EXPECTED_STEPS = [
    (1, 'installed-default-off-read'), (1, 'exact-pinned-source'),
    (1, 'review-edit-accept-reject'), (1, 'rejected-record-retained'),
    (1, 'explicit-redacted-export'), (1, 'forget-tombstone'),
    (1, 'review-command-observation'), (1, 'post-exit-storage'),
    (2, 'installed-default-off-read'), (2, 'restart-retained-review'),
    (2, 'restart-tombstone'), (2, 'review-command-observation'),
    (2, 'post-exit-storage'),
]
SAVE_PHASES = ['ready', 'dialog-found', 'file-name-set', 'save-invoked', 'dialog-closed', 'target-released']
PNG_NAMES = [
    'installed-main.png', 'installed-settings.png', 'installed-official-connections.png',
    'installed-memory-source.png', 'installed-memory-reviewed.png', 'installed-memory-rejected.png',
    'installed-memory-forgotten.png', 'installed-memory-restart-reviewed.png',
    'installed-memory-restart-tombstone.png',
]
FIXTURE = {
    'projectId': 'installed-memory-project', 'threadId': 'installed-memory-thread',
    'initialText': 'Use UTC for installed retention reports.',
    'editedText': 'Use ISO 8601 UTC dates for installed retention reports.',
    'sourceText': 'Pinned source: use UTC for installed retention reports.\n<script>window.installedMemorySourceExecuted=true</script>',
    'acceptText': 'Keep the installed retention checklist with the project.',
    'rejectText': 'Proposed: publish the disposable retention checklist globally.',
    'sensitiveText': 'Private disposable retention note: keep the amber launch schedule local.',
}
SOURCE_ASSERTIONS = [
    {'claim': 'Each launch uses a fresh random nonce and checks it with Browser.getBrowserCommandLine; exact executable and main surface are checked after connection and again for page custody.', 'retained': 'verifiedOwner, pid, executable, ports and main-page observations', 'notRetained': 'Full nonce and browser argv are not serialized.', 'source': 'scripts/verify-installed-desktop.ts; scripts/portable-verification.ts'},
    {'claim': 'Clean exit signal is null and the owned backend health endpoint has stopped before post-exit Store reads and the completed launch row.', 'retained': 'exitCode, passed and ordered post-exit-storage row', 'notRetained': 'Launch signalCode and individual health responses are not serialized.', 'source': 'scripts/verify-installed-desktop.ts'},
    {'claim': 'The same evidence directory/profile is physically revalidated before each launch/action/readback and after exit.', 'retained': 'Seed dev/ino/path identities; native destination identity; samePhysicalProfile', 'notRetained': 'A second independent filesystem snapshot is not part of the artifact.', 'source': 'scripts/installed-memory-retention.ts; scripts/installed-native-save.ts'},
    {'claim': 'Native Save worker closes with code zero and no signal only after six ordered stages and the release handshake following production saved acknowledgement/readback.', 'retained': 'Six native Save phases, process ticks, HWND, PID, saved bytes/digest and lease-held boolean', 'notRetained': 'Worker exit/signal and exact UIA control success objects are source-asserted, not separately serialized.', 'source': 'scripts/installed-native-save.ts; scripts/installed-memory-retention.ts'},
    {'claim': 'Main-owned export admission requires exact live main frame, trusted origin, contents, data URL, filename, one-use grant and terminal native completion byte count.', 'retained': 'admitted=true and saved completion filename/bytes/digest', 'notRetained': 'Full frame/origin/URL grant is intentionally not serialized.', 'source': 'apps/desktop/memory-export.ts; apps/desktop/main.ts'},
    {'claim': 'Full installed file manifest equals the expected unpacked payload, with only the two documented installer-owned extras excluded.', 'retained': 'Matching complete inventory counts, aggregate bytes and SHA256', 'notRetained': 'The full installed file list and installed payload bytes are not uploaded.', 'source': 'scripts/verify-installed-desktop.ts'},
    {'claim': 'Post-exit storage asserts the edited text, rejected review decision, tombstone and null model/account/active run; usage/modelRequests are empty.', 'retained': 'Post-exit zero counts, flags and samePhysicalProfile', 'notRetained': 'A raw profile database is not uploaded.', 'source': 'scripts/installed-memory-retention.ts'},
]

def digest(data): return hashlib.sha256(data).hexdigest()
def blob(data): return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
def jbytes(value, sort=False): return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=sort).encode('utf-8')
def store_digest(value): return digest(jbytes(value, sort=True))
def integer(value, minimum=0, maximum=2**53-1): return type(value) is int and minimum <= value <= maximum
def wpath(value): return ntpath.normpath(value).rstrip('\\/').lower()
def same_path(a, b): return isinstance(a, str) and isinstance(b, str) and wpath(a) == wpath(b)
def below(root, value):
    return isinstance(value, str) and wpath(value).startswith(wpath(root) + '\\')
def ordinary_windows(value):
    return isinstance(value, str) and re.fullmatch(r'[A-Za-z]:\\[^\x00-\x1f]*', value) is not None and ':' not in value[2:] and ntpath.normpath(value) == value
def timestamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
def object_pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value: raise ValueError('Duplicate JSON property')
        value[key] = item
    return value
def parse(data): return json.loads(data.decode('utf-8'), object_pairs_hook=object_pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
def require(value, code):
    if not value: raise ValueError(code)
def exact_keys(value, keys): return isinstance(value, dict) and set(value) == set(keys)

class Admission:
    def __init__(self, repo, config, config_path):
        self.repo = pathlib.Path(repo).resolve()
        self.cfg = config
        self.base = config_path.parent
        self.errors = []
        self.checks = []
        self.identities = {}
        self.data = {}
        self.source_bytes = {}
        self.members = {}
        self.roles = {}
        self.summary = {}

    def check(self, name, callback):
        before = len(self.errors)
        try: callback()
        except (ValueError, KeyError, TypeError, IndexError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as exc:
            # No receipt text or raw input is echoed in validation errors.
            code = str(exc) if isinstance(exc, ValueError) and re.fullmatch(r'[A-Z0-9_:.\-]+', str(exc)) else type(exc).__name__.upper()
            self.errors.append({'check': name, 'code': code})
        self.checks.append({'check': name, 'status': 'PASS' if len(self.errors) == before else 'FAIL'})

    def read_bound(self, name, limit=4*1024*1024):
        desc = self.cfg['inputs'][name]
        require(isinstance(desc, dict) and SHA.fullmatch(desc['sha256']) and integer(desc['bytes'], 1, limit), 'INVALID_INPUT_BINDING')
        path = pathlib.Path(desc['path'])
        if not path.is_absolute(): path = self.base / path
        require(not path.is_symlink() and path.is_file() and path.stat().st_size == desc['bytes'], 'INPUT_SIZE_OR_TYPE')
        raw = path.read_bytes()
        require(digest(raw) == desc['sha256'], 'INPUT_SHA256_MISMATCH')
        if 'gitBlobSha' in desc: require(blob(raw) == desc['gitBlobSha'], 'INPUT_GIT_BLOB_MISMATCH')
        self.identities[name] = {**desc, 'path': str(path.resolve())}
        return raw

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.PIPE)

    def inputs(self):
        require(self.cfg['schemaVersion'] == 1 and self.cfg['scope'] == 'NEW_OFFLINE_INSTALLED_ADMISSION_INPUTS', 'INPUT_SCHEMA')
        for key in ('headSha', 'treeSha', 'checkoutSha'): require(OID.fullmatch(self.cfg[key]) is not None, 'IMMUTABLE_COMMIT_REQUIRED')
        for key in ('runId', 'jobId', 'artifactId', 'runAttempt'): require(integer(self.cfg[key], 1), 'POSITIVE_ID_REQUIRED')
        for name in ('ciReceipt', 'sourceBindings', 'reviewedSourceProfile', 'artifactMetadata', 'commandMeta', 'visualReview'):
            self.data[name] = parse(self.read_bound(name))
        self.data['commandLogBytes'] = self.read_bound('commandLog', 65536)
        self.data['archiveBytes'] = self.read_bound('archive', 8*1024*1024)

    def sources(self):
        cfg, bindings, profile = self.cfg, self.data['sourceBindings'], self.data['reviewedSourceProfile']
        require(bindings['headSha'] == cfg['headSha'] and bindings['treeSha'] == cfg['treeSha'] and bindings['repository'] == REPO and bindings['repositoryId'] == REPO_ID, 'SOURCE_BINDING_SCOPE')
        rows = bindings['sourceBindings']
        require(len(rows) == bindings['sourceBindingCount'] == len(profile['requiredPaths']) == 34, 'SOURCE_BINDING_COUNT')
        require(len({row['path'] for row in rows}) == 34 and {row['path'] for row in rows} == set(profile['requiredPaths']), 'SOURCE_BINDING_PATH_SET')
        require(self.git('rev-parse', cfg['headSha']+'^{tree}').decode().strip() == cfg['treeSha'], 'SOURCE_TREE_MISMATCH')
        for row in rows:
            raw = self.git('show', cfg['headSha']+':'+row['path'])
            require(len(raw) == row['bytes'] and digest(raw) == row['sha256'] and blob(raw) == row['gitBlobSha'], 'SOURCE_BLOB_MISMATCH')
            self.source_bytes[row['path']] = raw
        require(profile['status'] == 'SOURCE_REVIEW_ONLY_NO_EXECUTION_ADMISSION' and profile['schemaVersion'] == 1, 'SOURCE_PROFILE_NOT_REVIEWED')
        for path, expected in profile['reviewedSemanticSources'].items():
            require(path in self.source_bytes and digest(self.source_bytes[path]) == expected, 'SEMANTIC_SOURCE_CHANGED_REVIEW_REQUIRED')
        require(profile['expectedObservationOrder'] == [list(item) for item in EXPECTED_STEPS], 'SOURCE_PROFILE_SEQUENCE')
        require(profile['nativeSavePhases'] == SAVE_PHASES and profile['fixture'] == FIXTURE, 'SOURCE_PROFILE_SEMANTICS')
        flags = self.source_bytes['packages/core/capability-flags.ts'].decode()
        # The already hash-pinned implementation initializes the finite registry
        # to false; its M05 defaults are not literal object properties.
        require('this.values.set(definition.key as K, false);' in flags and '"memory.projectV1"' in flags and '"memory.externalRecallExperimentV1"' in flags, 'PRODUCTION_DEFAULT_REGISTRY_CHANGED')
        candidate = cfg.get('finalDocumentationHeadSha')
        if candidate:
            require(OID.fullmatch(candidate), 'INVALID_DOCUMENTATION_COMMIT')
            paths = self.git('diff', '--name-only', cfg['headSha'], candidate).decode().splitlines()
            require(all(path.startswith('docs/') for path in paths), 'NON_DOCUMENTATION_DRIFT')
            for row in rows: require(self.git('rev-parse', candidate+':'+row['path']).decode().strip() == row['gitBlobSha'], 'DOCUMENTATION_SOURCE_DRIFT')
        self.summary['sourceBindingsVerified'] = 34

    def ci(self):
        cfg, ci = self.cfg, self.data['ciReceipt']
        require(ci['repository'] == REPO and ci['repositoryId'] == REPO_ID and ci['headSha'] == cfg['headSha'] and ci['treeSha'] == cfg['treeSha'], 'CI_SOURCE_IDENTITY')
        run = ci['workflow']
        require(run['id'] == cfg['runId'] and run['run_attempt'] == cfg['runAttempt'] and run['path'] == '.github/workflows/ci.yml', 'CI_RUN_IDENTITY')
        require(run['definitionSha256'] == digest(self.source_bytes['.github/workflows/ci.yml']), 'CI_WORKFLOW_BYTES')
        checkout = ci['testedCheckout']
        expected_event = cfg.get('expectedEvent', 'pull_request')
        expected_branch = cfg.get('expectedBranch')
        require(expected_event in ('pull_request', 'push'), 'CI_EVENT_UNSUPPORTED')
        require(expected_branch == 'agent/m05-v3' if expected_event == 'push' else expected_branch is None, 'CI_EXPECTED_BRANCH')
        require(run['event'] == expected_event, 'CI_EVENT_MISMATCH')
        require(checkout['commitSha'] == cfg['checkoutSha'] and checkout['treeSha'] == cfg['treeSha'] and checkout['matchesPublishedTree'] is True, 'CI_CHECKOUT_IDENTITY')
        if expected_event == 'push':
            require(run['head_branch'] == expected_branch and cfg['checkoutSha'] == cfg['headSha'], 'CI_PUSH_EXACT_HEAD')
        else:
            require(cfg['headSha'] in checkout['parents'], 'CI_PR_PARENT_IDENTITY')
        jobs = ci['jobs']
        require(len(jobs) == 9 and all(job['checkedOutCommit'] == cfg['checkoutSha'] and job['headSha'] == cfg['headSha'] and job['runId'] == cfg['runId'] for job in jobs), 'CI_JOB_CHECKOUTS')
        selected = [job for job in jobs if job['id'] == cfg['jobId'] and job['name'] == JOB]
        require(len(selected) == 1, 'INSTALLED_JOB_IDENTITY')
        self.data['installedJob'] = selected[0]
        self.summary['ciJobOutcomes'] = {'success': sum(j['conclusion'] == 'success' for j in jobs), 'failure': sum(j['conclusion'] == 'failure' for j in jobs)}
        require(ci['complete'] is True and run['status'] == 'completed' and run['conclusion'] == 'success' and all(j['status'] == 'completed' and j['conclusion'] == 'success' for j in jobs), 'CI_NOT_ALL_NINE_SUCCESS')

    def command(self):
        cfg, ci, meta = self.cfg, self.data['ciReceipt'], self.data['commandMeta']
        job = next(j for j in ci['jobs'] if j['id'] == cfg['jobId'])
        steps = {s['name']: s for s in job['steps']}
        require(meta['receiptSha256'] == self.identities['ciReceipt']['sha256'] and meta['runId'] == cfg['runId'] and meta['runAttempt'] == cfg['runAttempt'] and meta['headSha'] == cfg['headSha'], 'COMMAND_RECEIPT_BINDING')
        require(meta['job']['id'] == cfg['jobId'] and meta['job']['name'] == JOB and meta['testedCheckout'] == ci['testedCheckout'] and meta['step'] == steps[VERIFY_STEP], 'COMMAND_JOB_STEP_BINDING')
        require(meta['rawJobLogDigest'] == job['rawLogDigest'] and meta['rawJobLogBytes'] == job['rawLogBytes'] and meta['rawJobLogRef'] == job['rawLogRef'], 'COMMAND_RAW_LOG_BINDING')
        cmd, log = meta['command'], self.data['commandLogBytes']
        require(cmd['logDigest'] == digest(log), 'INSTALLED_COMMAND_LOG_DIGEST')
        require(cmd['startedAt'] == meta['step']['started_at'] and cmd['endedAt'] == meta['step']['completed_at'] and timestamp(cmd['startedAt']) <= timestamp(cmd['endedAt']), 'COMMAND_STEP_TIMES')
        require(meta['timingBasis'] == 'OBSERVED_CI_STEP_ENVELOPE', 'COMMAND_TIME_SCOPE')
        script = self.source_bytes['.github/workflows/ci.yml'].decode()
        block = script.split('      - name: '+VERIFY_STEP+'\n', 1)[1].split('\n      - name:', 1)[0]
        actual_script = '\n'.join(line[10:] for line in block.splitlines()[1:] if line.startswith('          ')).strip()
        require(actual_script == meta['observedScript'].strip(), 'COMMAND_WORKFLOW_SCRIPT_MISMATCH')
        marker = [line.split('HARNESS_INSTALLED_VERIFY_ARGV=', 1)[1] for line in log.decode().splitlines() if re.search(r'Z HARNESS_INSTALLED_VERIFY_ARGV=\{', line)]
        require(len(marker) == 1, 'ACTUAL_ARGV_MARKER_MISSING')
        emitted = parse(marker[0].encode())
        require([emitted['executable'], *emitted['args']] == cmd['argv'], 'ACTUAL_ARGV_MARKER_MISMATCH')
        self.data['command'] = cmd
        self.summary['command'] = {'argvMatchedActualMarker': True, 'stepEnvelopeMatched': True, 'rawJobLogDigest': meta['rawJobLogDigest'], 'observedExitCode': cmd['exitCode'], 'observedStatus': cmd['status'], 'timingBasis': meta['timingBasis']}
        require(all(steps[n]['status'] == 'completed' and steps[n]['conclusion'] == 'success' for n in (PACKAGE_STEP, VERIFY_STEP)), 'REQUIRED_INSTALLED_STEP_FAILED')
        require(cmd['status'] == 'PASS' and cmd['exitCode'] == 0 and cmd['termination'] == 'NONE', 'INSTALLED_COMMAND_NOT_PASS')

    def archive(self):
        cfg, api, raw = self.cfg, self.data['artifactMetadata'], self.data['archiveBytes']
        candidates = api.get('artifacts', [api])
        matches = [a for a in candidates if a['id'] == cfg['artifactId']]
        require(len(matches) == 1, 'ARTIFACT_IDENTITY')
        a = matches[0]
        require(a['name'] == f"installed-memory-{cfg['runId']}-{cfg['runAttempt']}" and a['size_in_bytes'] == len(raw) and a['digest'] == 'sha256:'+digest(raw), 'ARTIFACT_BYTES')
        require(a['workflow_run']['id'] == cfg['runId'] and a['workflow_run']['head_sha'] == cfg['headSha'] and a['workflow_run']['repository_id'] == REPO_ID and a['workflow_run']['head_repository_id'] == REPO_ID, 'ARTIFACT_RUN_BINDING')
        roles, metadata = {}, []
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            require(1 <= len(entries) <= 32 and sum(e.file_size for e in entries) <= 16*1024*1024, 'ARCHIVE_BOUNDS')
            seen = set()
            for entry in entries:
                path = entry.filename
                require(path not in seen and not entry.is_dir() and not path.startswith('/') and '\\' not in path and ':' not in path and all(p not in ('', '.', '..') for p in path.split('/')), 'ARCHIVE_MEMBER_PATH')
                require(entry.file_size <= 4*1024*1024 and not entry.flag_bits & 1 and entry.compress_type in (0, 8) and not stat.S_ISLNK(entry.external_attr >> 16), 'ARCHIVE_MEMBER_TYPE')
                seen.add(path)
                data = archive.read(entry)  # stdlib verifies decompression and CRC.
                self.members[path] = data
                row = {'path': path, 'bytes': len(data), 'sha256': digest(data), 'gitBlobSha': blob(data), 'crc32': f'{entry.CRC:08x}'}
                metadata.append(row)
                name = pathlib.PurePosixPath(path).name
                role = None
                if re.fullmatch(r'\.harness-desktop-installed/run-[0-9]+-[0-9a-f-]{36}/(?:verification\.json|owner\.json|installed-memory-redacted-export\.json|[a-z0-9-]+\.png)', path):
                    role = {'verification.json': 'main', 'owner.json': 'owner', 'installed-memory-redacted-export.json': 'export'}.get(name)
                    if name.endswith('.png'): require(data[:8] == b'\x89PNG\r\n\x1a\n', 'PNG_SIGNATURE')
                elif re.fullmatch(r'\.harness-packaged-providers/run-[0-9]+-[0-9a-f-]{36}/verification\.json', path): role = 'providers'
                elif re.fullmatch(r'\.harness-installed-package/desktop-release-[A-Za-z0-9.-]+/build-manifest\.json', path): role = 'build'
                elif re.fullmatch(r'\.harness-installed-package/desktop-stage-[0-9]+/desktop-host/third-party/integrations/PYTHON_INSTALLATION_V2\.json', path): role = 'canonical'
                else: raise ValueError('UNEXPECTED_ARCHIVE_MEMBER')
                if role:
                    require(role not in roles, 'DUPLICATE_ARTIFACT_ROLE')
                    roles[role] = path
                    self.data[role] = parse(data)
        require(set(roles) >= {'main', 'owner', 'providers', 'build', 'canonical'}, 'INCOMPLETE_INSTALLED_ARTIFACT')
        self.roles = roles
        self.summary['artifact'] = {'id': cfg['artifactId'], 'bytes': len(raw), 'sha256': digest(raw), 'members': metadata}

    def installation(self):
        r, owner, build, cmd = self.data['main'], self.data['owner'], self.data['build'], self.data['commandMeta']['command']
        require(r['memoryRetentionRequested'] is True and r['inference'] is False and r['auth'] is False, 'WRONG_INSTALLED_SCOPE')
        require(owner == {'setup': r['setup'], 'setupSha256': r['setupSha256'], 'installDirectory': r['installDirectory'], 'guid': r['nsisGuid']}, 'INSTALLER_OWNER_BINDING')
        require(ordinary_windows(r['setup']) and ordinary_windows(r['expectedUnpacked']) and ordinary_windows(r['installDirectory']), 'INSTALL_PATH_FORM')
        workspace = cmd['cwdIdentity']
        require(below(workspace, r['setup']) and below(workspace, r['expectedUnpacked']) and ntpath.dirname(r['installDirectory']) == workspace and re.fullmatch(r'\.harness-app-[0-9a-f]{12}', ntpath.basename(r['installDirectory'])), 'INSTALL_PATH_SCOPE')
        require(cmd['argv'] == ['pnpm', 'exec', 'tsx', 'scripts/verify-installed-desktop.ts', r['setup'], r['expectedUnpacked'], '--project-memory-retention'], 'COMMAND_SETUP_SCOPE')
        files = build['files']
        require(len(files) == 1 and same_path(ntpath.join(workspace, files[0]['file']), r['setup']) and files[0]['sha256'] == r['setupSha256'] and integer(files[0]['bytes'], 1), 'BUILD_SETUP_BINDING')
        package = parse(self.source_bytes['package.json'])
        require(r['version'] == package['version'], 'INSTALLED_VERSION')
        guid = bytearray(hashlib.sha1(bytes.fromhex('50e065bc313411e69bab38c9862bdaf3')+b'local.generativeharness.desktop').digest()[:16]); guid[6]=(guid[6]&15)|80; guid[8]=(guid[8]&63)|128
        hx=guid.hex(); expected_guid='-'.join((hx[:8],hx[8:12],hx[12:16],hx[16:20],hx[20:]))
        require(r['nsisGuid'] == expected_guid, 'APPLICATION_GUID')
        initial = r['preflight']
        require(initial['entries'] == [] and initial['runningAppPids'] == [] and all(x['present'] is False for x in initial['shortcuts']) and initial['updaterCache']['present'] is False, 'NONEXCLUSIVE_INSTALL_PREFLIGHT')
        stages = [o['stage'] for o in r['preflightObservations']]
        require(len(stages) <= 256 and stages[:3] == ['before-install','pre-install-recheck','after-install'] and stages[3] == 'before-uninstall' and stages[-1] == 'after-uninstall' and all(x == 'after-uninstall-poll' for x in stages[4:-1]) and len(stages[4:-1]) >= 1, 'PREFLIGHT_ORDER')
        for o in r['preflightObservations']:
            require(o['status'] == 'completed' and o['timeoutMs'] == 60000 and integer(o['elapsedMs']), 'INCOMPLETE_PREFLIGHT')
        obs = r['installerObservation']
        require(obs['phase'] == 'installer' and obs['status'] == 'completed' and obs['timeoutMs'] == 1200000 and obs['failure'] is None and obs['terminationRequested'] is False and integer(obs['pid'],1,2147483647), 'INSTALLER_NOT_NATURAL_COMPLETION')
        require(all(obs[k]['code'] == 0 and obs[k]['signal'] is None and integer(obs[k]['elapsedMs']) for k in ('exit','close')) and obs['exit']['elapsedMs'] <= obs['close']['elapsedMs'] <= obs['elapsedMs'], 'INSTALLER_EXIT_CLOSE')
        require(r['installCommand']['exitCode'] == 0 and integer(r['installCommand']['elapsedMs'],1), 'INSTALLER_COMMAND')
        entries=r['installedRegistry']; require(1<=len(entries)<=8, 'REGISTRY_BOUNDS')
        require(all(e['hive']=='HKCU' and e['view'] in (32,64) and e['kind'] in ('install','uninstall') for e in entries), 'REGISTRY_PER_USER')
        require({e['kind'] for e in entries} == {'install','uninstall'}, 'REGISTRY_MISSING_ROLE')
        for e in entries:
            if e['kind']=='install': require(same_path(e['values']['InstallLocation'],r['installDirectory']), 'REGISTRY_INSTALL_LOCATION')
            else:
                require(e['values']['DisplayVersion']==r['version'], 'REGISTRY_VERSION')
                match=re.fullmatch(r'"([^"\r\n\0]+)"(?:\s+/currentuser)?\s*',e['values']['UninstallString'])
                require(match and same_path(match[1],ntpath.join(r['installDirectory'],'Uninstall Gen V1.exe')), 'REGISTRY_UNINSTALLER')
        expected, actual=r['expectedPayload'],r['payloadCustody']
        require(actual['matches'] is True and all(actual[k]==expected[k] for k in ('files','bytes','sha256')) and integer(expected['files'],1,150000) and integer(expected['bytes'],1,4*1024**3) and SHA.fullmatch(expected['sha256']) and integer(expected['maxInstalledPathLength'],1,259), 'FULL_PAYLOAD_MISMATCH')
        self.summary['installation']={'installerElapsedMs':obs['elapsedMs'],'naturalExit':True,'fullPayload':actual,'maxInstalledPathLength':expected['maxInstalledPathLength'],'retainedFullFileList':False}

    def canonical(self):
        canonical, build = self.data['canonical'], self.data['build']['integrationPython']
        lock_raw=self.source_bytes['third-party/integrations/PYTHON_LOCK.json']; lock=parse(lock_raw)
        require(canonical['version']==2 and canonical['mode']==build['mode']=='wheel-canonical-record-v2' and canonical['sourceLockSha256']==build['sourceLockSha256']==digest(lock_raw), 'CANONICAL_LOCK')
        wheels=[{'name':d['name'],'version':d['version'],'sha256':d['wheelSha256']} for d in lock['distributions']]
        require(len(wheels)==91 and canonical['wheels']==build['wheels']==wheels and build['projectionSha256']==digest(self.members[self.roles['canonical']]), 'CANONICAL_WHEELS')
        original={f['path']:f for f in lock['files']}; projected={f['path']:f for f in canonical['files']}
        require(len(original)==len(lock['files'])==len(projected)==len(canonical['files'])==7415 and set(original)==set(projected), 'CANONICAL_PATH_SET')
        record=lambda path: re.search(r'[^/]+\.dist-info/RECORD$',path) is not None
        nonrecords=[p for p in original if not record(p)]
        require(len(nonrecords)==7324 and all(original[p]==projected[p] for p in nonrecords), 'CANONICAL_PROTECTED_FILES')
        require(all(exact_keys(f,('path','bytes','sha256')) and integer(f['bytes']) and SHA.fullmatch(f['sha256']) for f in projected.values()), 'CANONICAL_FILE_IDENTITIES')
        self.summary['canonical']={'wheels':91,'files':7415,'protectedNonRecordFiles':7324,'sourceLockSha256':digest(lock_raw),'projectionSha256':build['projectionSha256'],'wheelArchiveReexecution':False}

    def providers(self):
        p,r=self.data['providers'],self.data['main']
        require(r['providerVerification']['passed'] is True and p['passed'] is True and p['auth'] is False and p['inference'] is False and 'error' not in p and same_path(p['packageRoot'],r['installDirectory']), 'PROVIDER_RECEIPT_STATUS')
        cmd=self.data['commandMeta']['command']; provider_member=self.roles['providers']
        require(same_path(ntpath.join(cmd['cwdIdentity'],provider_member.replace('/','\\')),r['providerVerification']['receipt']), 'PROVIDER_RECEIPT_PATH')
        host=ntpath.join(r['installDirectory'],'resources','host')
        require(p['inventory']==['claude-code','gemini-cli','cursor-sdk'] and p['node']['version']==self.data['build']['nodeVersion'] and same_path(p['node']['path'],ntpath.join(r['installDirectory'],'resources','node','node.exe')) and SHA.fullmatch(p['nodeSha256']), 'PROVIDER_NODE_INVENTORY')
        required={'claudeSdk','claudeNative','geminiBundle','cursorSdk','cursorNative'}
        require(set(p['roots'])==required and len(p['custody'])==5 and {c['distribution'] for c in p['custody']}==required, 'PROVIDER_CUSTODY_SET')
        for c in p['custody']:
            files=c['files']; require(c['matches'] is True and same_path(c['packagedRoot'],p['roots'][c['distribution']]) and below(host,c['packagedRoot']), 'PROVIDER_CUSTODY_SCOPE')
            require(len(files)<=20000 and len({f['path'] for f in files})==len(files) and files==sorted(files,key=lambda f:f['path']), 'PROVIDER_FILE_ORDER')
            for f in files: require(exact_keys(f,('path','bytes','sha256')) and integer(f['bytes']) and SHA.fullmatch(f['sha256']) and all(x not in ('','.','..') for x in f['path'].split('/')) and not f['path'].startswith('/') and '\\' not in f['path'], 'PROVIDER_FILE_IDENTITY')
            require(sum(f['bytes'] for f in files)==c['bytes'] and digest(jbytes(files))==c['sha256'], 'PROVIDER_CUSTODY_DIGEST')
        checks=p['checks']; require([c['provider'] for c in checks]==p['inventory'], 'PROVIDER_CHECK_ORDER')
        for c in checks: require(c['auth'] is False and c['inference'] is False and below(host,c['entry']) and integer(c['elapsedMs']) and c['arguments']==([] if c['provider']=='cursor-sdk' else ['--version']), 'PROVIDER_CHECK_SCOPE')
        cursor=checks[2]; boot=cursor['bootstrap']
        require(cursor['versionOutput']=='1.0.38' and boot['credentialStore']=='empty-memory' and boot['authStatus']=='logged-out' and boot['agentCreate'] is True and boot['networkRequests']==0 and boot['sandboxExecution'] is False and boot['nativeHelper']['arguments']==['--version'] and same_path(boot['nativeHelper']['entry'],ntpath.join(p['roots']['cursorNative'],'bin','rg.exe')), 'CURSOR_BOOTSTRAP')
        self.summary['providers']={'checks':3,'fullDistributionCustody':5,'cursorInstrumentedBootstrapFetches':0,'globalProviderNetworkCalls':None,'paidModelSpend':None}

    def seed(self):
        r=self.data['main']; memory=r['memoryRetention']; seed=memory['seed']; self.data['seed']=seed
        require(memory['version']==1 and memory['hostDefaultOff'] is True and memory['providerNetworkCalls'] is None, 'RETAINED_MEMORY_DEFAULT_OFF')
        require(seed['projectId']==FIXTURE['projectId'] and seed['threadId']==FIXTURE['threadId'] and set(seed['items'])=={'edit','accept','reject','forget'}, 'MEMORY_SEED_SCOPE')
        root=seed['evidenceRoot']['path']; require(ordinary_windows(root), 'EVIDENCE_ROOT_PATH')
        mainpath=ntpath.join(self.data['commandMeta']['command']['cwdIdentity'],self.roles['main'].replace('/','\\'))
        require(same_path(ntpath.dirname(mainpath),root) and same_path(seed['profile']['path'],ntpath.join(root,'host')) and same_path(seed['project']['path'],ntpath.join(root,'memory-project')), 'SAME_PROFILE_PATH_BINDING')
        for d in ('evidenceRoot','profile','project'): require(exact_keys(seed[d],('path','dev','ino')) and all(isinstance(seed[d][k],str) and seed[d][k].isdigit() for k in ('dev','ino')), 'PHYSICAL_IDENTITY_SHAPE')
        require(seed['profileId']==store_digest({'path':seed['profile']['path'],'dev':seed['profile']['dev'],'ino':seed['profile']['ino']}), 'PROFILE_ID_DIGEST')
        require(seed['projectIdentity']==store_digest({'profileId':seed['profileId'],'projectId':seed['projectId'],'physical':{'dev':seed['project']['dev'],'ino':seed['project']['ino']}}), 'PROJECT_IDENTITY_DIGEST')
        sources={'edit':FIXTURE['sourceText'],'accept':FIXTURE['acceptText'],'reject':FIXTURE['rejectText'],'forget':FIXTURE['sensitiveText']}
        require(len({v['id'] for v in seed['items'].values()})==4, 'SEED_ITEM_UNIQUENESS')
        for kind,item in seed['items'].items():
            require(UUID.fullmatch(item['id']) and item['revision']==(2 if kind in ('edit','forget') else 1), 'SEED_REVISION')
            ref=item['source']; require(exact_keys(ref,('ownerThreadId','sourceKind','sourceId','sourceRevision','capturedSeq','digest','observedStatus')) and ref['ownerThreadId']==seed['threadId'] and ref['sourceKind']=='MESSAGE' and ref['sourceId']=='installed-memory-source-'+kind and ref['observedStatus']=='REPORTED' and integer(ref['capturedSeq']) and SHA.fullmatch(ref['sourceRevision']) and ref['digest']==digest(sources[kind].encode()), 'SEED_SOURCE_REFERENCE')
        self.summary['seed']={'sameProfileDigestVerified':True,'projectIdentityVerified':True,'projectId':seed['projectId'],'threadId':seed['threadId'],'sources':'Four exact test-owned MESSAGE source digests; sourceRevision timestamp preimage is not serialized.'}

    def launches(self):
        r=self.data['main']; launches=r['launches']; readiness=r['launchReadiness']
        require(len(launches)==2 and [x['iteration'] for x in launches]==[1,2], 'TWO_COMPLETED_LAUNCHES_REQUIRED')
        require(len(readiness)==2 and [x['iteration'] for x in readiness]==[1,2], 'TWO_READINESS_RECEIPTS_REQUIRED')
        require(launches[0]['ports']==launches[1]['ports'], 'RESTART_ORIGIN_CHANGED')
        for launch,ready in zip(launches,readiness):
            require(launch['mode']=='personal' and launch['verifiedOwner'] is True and launch['passed'] is True and launch['exitCode']==0 and integer(launch['pid'],1,2147483647) and same_path(launch['executable'],ntpath.join(r['installDirectory'],'Gen V1.exe')), 'LAUNCH_OWNER_OR_EXIT')
            require(exact_keys(launch['ports'],('hostPort','widgetPort','debugPort')) and all(integer(p,1,65535) for p in launch['ports'].values()) and len(set(launch['ports'].values()))==3, 'LAUNCH_PORTS')
            require(ready['pid']==launch['pid'] and ready['status']=='ready' and ready['timeoutMs']==80000, 'LAUNCH_READINESS_OWNER')
            events=ready['observations']; require(events and events[-1]['phase']=='ready' and not any(e['phase']=='failed' for e in events), 'LAUNCH_READINESS_FAILED')
            require(all(e['process']=={'alive':True,'exitCode':None,'signalCode':None} for e in events) and all(integer(e['elapsedMs']) for e in events) and [e['elapsedMs'] for e in events]==sorted(e['elapsedMs'] for e in events) and events[-1]['elapsedMs']<80000 and events[-1]['pages']['ownedOrigin']>=1, 'LAUNCH_READINESS_LIVENESS')
        self.summary['launches']={'completed':2,'samePorts':True,'sameProfile':'Source-bound profile revalidation plus both post-exit rows','nonce':'Fresh and exact-match source assertion; values not serialized','cleanSignalsAndBackendStop':'Source assertions before completed rows'}

    def memory(self):
        observations=self.data['main']['memoryRetention']['observations']; seed=self.data['seed']; items=seed['items']
        require([(o.get('iteration'),o.get('step')) for o in observations]==EXPECTED_STEPS, 'THIRTEEN_ORDERED_MEMORY_OBSERVATIONS_REQUIRED')
        self.data['observations']={(o['iteration'],o['step']):o for o in observations}
        get=lambda i,s:self.data['observations'][(i,s)]
        for i,count,tombs in ((1,4,0),(2,3,1)):
            o=get(i,'installed-default-off-read'); require(o['available'] is False and o['enabled'] is False and o['accountId'] is None and o['itemCount']==count and o['tombstoneCount']==tombs, 'DEFAULT_OFF_VIEW')
        source=get(1,'exact-pinned-source'); require(source['itemId']==items['edit']['id'] and source['source']==items['edit']['source'] and all(source[k] is True for k in ('capturedTextMatched','changedMessageNotSubstituted','inertText')), 'EXACT_PINNED_SOURCE')
        for i,s in ((1,'review-edit-accept-reject'),(2,'restart-retained-review')):
            o=get(i,s); require(o['editedRevision']==3 and o['acceptedRevision']==2 and o['rejectedState']=='EXPIRED', 'REVIEW_RESTART_REVISION')
        for i,s in ((1,'forget-tombstone'),(2,'restart-tombstone')):
            require(get(i,s)['tombstone']=={'itemId':items['forget']['id'],'deletionRevision':3,'purgeStatus':'PENDING'}, 'FORGET_TOMBSTONE_RESTART')
        for i in (1,2):
            commands=get(i,'review-command-observation'); require(commands['commandTypes']==[] and commands['providerNetworkCalls'] is None, 'UNEXPECTED_MODEL_OR_HOST_COMMAND')
            o=get(i,'post-exit-storage'); require(o['samePhysicalProfile'] is True and o['available'] is False and o['enabled'] is False and all(o[k]==0 for k in ('accountCount','activeRunCount','usageOwners')) and o['providerNetworkCalls'] is None, 'POST_EXIT_MEMORY_STORAGE')
            require(o['recordCounts']==dict.fromkeys(['outbox','modelRequest','projectMemoryAuxiliaryUsage','projectMemoryRequestUsage','projectMemoryExtraction'],0), 'POST_EXIT_AUXILIARY_RECORDS')
        for o in observations:
            if 'screenshot' in o:
                shot=o['screenshot']; name=shot['file']; path=str(pathlib.PurePosixPath(self.roles['main']).parent/name)
                require(name in PNG_NAMES and path in self.members and len(self.members[path])==shot['bytes'] and digest(self.members[path])==shot['sha256'], 'MEMORY_SCREENSHOT_BINDING')
        self.summary['memory']={'observations':13,'editedRevision':3,'acceptedRevision':2,'rejectedState':'EXPIRED','tombstoneRevision':3,'purgeStatus':'PENDING','providerNetworkCalls':None,'paidModelSpend':None}

    def export_and_save(self):
        seed=self.data['seed']; items=seed['items']; obs=next((o for o in self.data['main']['memoryRetention']['observations'] if o['step']=='explicit-redacted-export'),None)
        require(obs is not None and 'export' in self.roles, 'SAVED_EXPORT_NOT_RECORDED')
        raw=self.members[self.roles['export']]; value=self.data['export']
        require(1<=len(raw)<=1048576 and obs['file']=='installed-memory-redacted-export.json' and len(raw)==obs['bytes'] and digest(raw)==obs['sha256'], 'SAVED_EXPORT_BYTES')
        require(obs['redacted'] is True and obs['sensitiveItemRedacted'] is True and obs['sourceBodiesAbsent'] is True and exact_keys(value,('scope','redacted','items','tombstones')) and value['redacted'] is True, 'REDACTED_EXPORT_SCHEMA')
        scope=value['scope']; expected_binding=store_digest({'projectIdentity':seed['projectIdentity'],'threadId':seed['threadId'],'accountId':None,'epoch':1,'runId':None,'modelId':None,'workspaceId':None,'workspaceIdentity':None})
        require(scope=={'projectId':seed['projectId'],'projectIdentity':seed['projectIdentity'],'threadId':seed['threadId'],'accountId':None,'bindingDigest':expected_binding}, 'EXPORT_SCOPE_BINDING')
        require(value['tombstones']==[] and len(value['items'])==4 and len({i['id'] for i in value['items']})==4, 'EXPORT_ITEM_SET')
        expected={'edit':(3,'ACCEPTED',FIXTURE['editedText']),'accept':(2,'ACCEPTED',FIXTURE['acceptText']),'reject':(2,'EXPIRED',FIXTURE['rejectText']),'forget':(2,'ACCEPTED','[redacted]')}
        byid={i['id']:i for i in value['items']}
        for kind,(rev,state,text) in expected.items():
            item=byid[items[kind]['id']]
            require(exact_keys(item,('id','revision','kind','state','text','sourceDigests')) and item['revision']==rev and item['kind']=='CONSTRAINT' and item['state']==state and item['text']==text and item['sourceDigests']==[items[kind]['source']['digest']], 'EXPORT_ITEM_CONTENT')
        require(FIXTURE['sensitiveText'].encode() not in raw and FIXTURE['sourceText'].encode() not in raw, 'SOURCE_OR_SENSITIVE_BODY_IN_EXPORT')
        require(raw==(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode(), 'EXPORT_NOT_CANONICAL_JSON')
        save=obs['nativeSave']; launch=self.data['main']['launches'][0]
        require(save['downloadBehavior']=='default' and save['downloadBehaviorResetAcknowledged'] is True and save['owner']['pid']==launch['pid'] and same_path(save['owner']['executable'],launch['executable']), 'NATIVE_SAVE_OWNER_OR_CDP_BEHAVIOR')
        dest=save['destination']; require(dest=={'file':'installed-memory-redacted-export.json','evidenceRoot':seed['evidenceRoot'],'absentBeforeDispatch':True,'regularFileReadBack':True,'identityLeaseHeldThroughReadback':True}, 'NATIVE_SAVE_DESTINATION')
        complete=save['completion']; require(complete=={'status':'saved','admitted':True,'filename':'project-memory-'+seed['projectId']+'.json','bytes':len(raw),'sha256':digest(raw)}, 'NATIVE_SAVE_COMPLETION')
        dialog=save['dialog']; require(dialog['status']=='completed' and dialog['pid']==launch['pid'] and dialog['dialogTitle']=='Export project memory' and 'failure' not in dialog and re.fullmatch(r'[0-9]{15,20}',dialog['processStartTicks']) and re.fullmatch(r'-?[1-9][0-9]{0,19}',dialog['dialogHandle']), 'NATIVE_DIALOG_NOT_COMPLETED')
        events=dialog['events']; require([e['phase'] for e in events]==SAVE_PHASES, 'NATIVE_DIALOG_SIX_PHASES')
        elapsed=0
        for index,e in enumerate(events):
            require(exact_keys(e,('phase','pid','processStartTicks','dialogHandle','elapsedMs')) and e['pid']==launch['pid'] and e['processStartTicks']==dialog['processStartTicks'] and e['dialogHandle']==(None if index==0 else dialog['dialogHandle']) and integer(e['elapsedMs'],elapsed,75000), 'NATIVE_DIALOG_EVENT_CUSTODY')
            elapsed=e['elapsedMs']
        self.summary['nativeSave']={'status':'saved','phases':SAVE_PHASES,'bytes':len(raw),'sha256':digest(raw),'ordinaryDialog':True,'cdpDownloadInterception':False,'identityLeaseThroughReadback':True,'externalProviderDeletion':'NOT_SUPPORTED'}

    def cleanup(self):
        r=self.data['main']; c=r['cleanup']
        require(c['status']=='uninstalled-owned-installation' and c['command']['exitCode']==0 and integer(c['command']['elapsedMs']) and all(c[k]=='absent' for k in ('shortcuts','installationKeys','nativeProcesses')), 'OWNED_CLEANUP_NOT_COMPLETE')
        cache=c['cache']; require(cache['status']=='not-created' or cache['status']=='removed-owned-exact-file' and cache['sha256']==r['setupSha256'], 'OWNED_CACHE_NOT_COMPLETE')
        require(r['passed'] is True and 'error' not in r, 'INSTALLED_RECEIPT_FAILED')
        self.summary['cleanup']={'status':c['status'],'uninstallerElapsedMs':c['command']['elapsedMs'],'cacheStatus':cache['status']}

    def visuals(self):
        v=self.data['visualReview']; cfg=self.cfg
        require(v['source']['headSha']==cfg['headSha'] and v['source']['treeSha']==cfg['treeSha'] and v['source']['id']==cfg['runId'] and v['source']['actualCheckoutSha']==cfg['checkoutSha'], 'VISUAL_REVIEW_SOURCE')
        require(v['artifact']['id']==cfg['artifactId'] and v['artifact']['bytes']==len(self.data['archiveBytes']) and v['artifact']['sha256']==digest(self.data['archiveBytes']), 'VISUAL_REVIEW_ARTIFACT')
        require(isinstance(v['status'],str) and v['status'].startswith('PASS_'), 'VISUAL_REVIEW_NOT_PASS')
        expected={str(pathlib.PurePosixPath(self.roles['main']).parent/n) for n in PNG_NAMES}
        actual={p for p in self.members if p.endswith('.png')}
        require(actual==expected and len(v['images'])==9 and {i['originalMember'] for i in v['images']}==expected, 'SUCCESS_SCREENSHOT_SET')
        for image in v['images']:
            data=self.members[image['originalMember']]
            require(image['visuallyInspected'] is True and image['bytes']==len(data) and image['sha256']==digest(data) and image['gitBlobSha']==blob(data) and isinstance(image['observations'],list) and image['observations'], 'IMAGE_REVIEW_BINDING')
        self.summary['visualReview']={'images':9,'independentReviewSha256':self.identities['visualReview']['sha256'],'limit':'Renderer PNG review is not itself proof of native OS dialog presence; that comes from native Save receipt and source.'}

    def run(self):
        self.check('input-byte-bindings',self.inputs)
        if len(self.data)<8: return self.report()
        self.check('immutable-reviewed-source',self.sources)
        self.check('actual-ci-run-and-checkout',self.ci)
        self.check('actual-command-and-raw-log-provenance',self.command)
        self.check('original-archive-and-member-custody',self.archive)
        for name,callback in [('natural-installation-and-full-payload',self.installation),('canonical-python-custody',self.canonical),('packaged-provider-custody',self.providers),('physical-default-off-seed',self.seed),('two-clean-owned-launches',self.launches),('thirteen-memory-observations',self.memory),('ordinary-native-save-and-exact-export',self.export_and_save),('owned-cleanup-and-overall-success',self.cleanup),('independent-renderer-image-review',self.visuals)]: self.check(name,callback)
        return self.report()

    def report(self):
        return {'schemaVersion':1,'validator':'new-offline-installed-admission-v3-event-bound','validatorSha256':digest(pathlib.Path(__file__).read_bytes()),'recordedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'status':PASS if not self.errors else 'REJECTED_INSTALLED_ADMISSION','scope':'Only actual default-off retained memory review, ordinary native Save, Forget and same-profile restart. No release approval or feature activation.','repository':REPO,'headSha':self.cfg.get('headSha'),'treeSha':self.cfg.get('treeSha'),'checkoutSha':self.cfg.get('checkoutSha'),'runId':self.cfg.get('runId'),'jobId':self.cfg.get('jobId'),'artifactId':self.cfg.get('artifactId'),'inputs':self.identities,'checks':self.checks,'errors':self.errors,'verifiedFacts':self.summary,'sourceAssertedNotSeparatelySerialized':SOURCE_ASSERTIONS,'remainingGates':{'fullEnabledInstalledMemory':'NOT_RUN','liveRepeatedTaskStudy':'NOT_RUN','providerNetworkCalls':None,'paidModelSpend':None,'reviewerApproval':False},'executionLimits':['This validator performs an offline evidence check, not a Windows launch, install, dialog interaction or test run.','Source bindings must be refreshed and independently reviewed after any semantically relevant source change.','The lost prior admission helper is neither reconstructed nor represented as executed.','No hypothetical successful receipt is manufactured or used to test the positive path.']}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',required=True)
    parser.add_argument('--inputs',required=True)
    parser.add_argument('--report',help='Write only this new scratch JSON, refusing overwrite.')
    args=parser.parse_args(); config_path=pathlib.Path(args.inputs).resolve()
    raw=config_path.read_bytes(); require(len(raw)<=65536,'INPUT_CONFIG_BOUND')
    result=Admission(args.repo,parse(raw),config_path).run()
    result['inputConfig']={'path':str(config_path),'bytes':len(raw),'sha256':digest(raw)}
    text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if args.report:
        with pathlib.Path(args.report).open('x',encoding='utf-8',newline='\n') as f:f.write(text)
    print(text,end='')
    return 0 if result['status']==PASS else 1

if __name__=='__main__':
    sys.exit(main())
