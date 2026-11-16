import datetime, hashlib, json, os, pathlib, signal, subprocess, sys, time
root=pathlib.Path('/workspace/scratch/36f66011d961/m05-restored')
out=pathlib.Path('/workspace/scratch/36f66011d961/m05-local-checks')
out.mkdir(exist_ok=True)
name=sys.argv[1]
argv=sys.argv[2:]
if not argv or not name.replace('-','').isalnum(): raise SystemExit('invalid fixed check')
start=datetime.datetime.now(datetime.timezone.utc).isoformat()
before=subprocess.check_output(['git','rev-parse','HEAD^{tree}'],cwd=root,text=True).strip()
source_diff=subprocess.check_output(['git','diff','HEAD','--binary'],cwd=root)
beg=time.monotonic()
process=subprocess.Popen(argv,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
termination='NONE'
try: raw=process.communicate(timeout=240)[0]
except subprocess.TimeoutExpired:
    termination='TIMEOUT';os.killpg(process.pid,signal.SIGKILL);raw=process.communicate()[0]
end=datetime.datetime.now(datetime.timezone.utc).isoformat()
fullhash=hashlib.sha256(raw).hexdigest()
text=raw.decode('utf-8','replace')
bounded=text.encode()
if len(bounded)>65536:
    marker=b'\n[bounded output: middle omitted; complete raw hash in metadata]\n'
    bounded=bounded[:32700]+marker+bounded[-32000:]
    bounded=bounded.decode('utf-8','replace').encode()
logref='docs/implementation/v3/m05-logs/'+name+'.log'
command=dict(argv=argv,cwdIdentity=str(root),executableIdentity=subprocess.check_output(['which',argv[0]],text=True).strip(),startedAt=start,endedAt=end,exitCode=process.returncode,termination=termination,status='PASS' if process.returncode==0 and termination=='NONE' else 'FAIL',boundedLogRef=logref,logDigest=hashlib.sha256(bounded).hexdigest())
phases=['PLATFORM_BROWSER'] if 'playwright' in argv else ['PLATFORM_NATIVE_STORAGE_AND_INSTALLED_DESKTOP'] if any('installed-native-save' in a for a in argv) else ['REGRESSION_REQUIRED'] if 'vitest' in argv else ['BUILD_AND_SETUP']
meta=dict(schemaVersion=1,command=command,capture='Actual restored Linux process output; no reconstructed CI step envelope',committedTreeBefore=before,workingDiffSha256=hashlib.sha256(source_diff).hexdigest(),captureScriptSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),elapsedMs=round((time.monotonic()-beg)*1000),rawOutputBytes=len(raw),rawOutputSha256=fullhash,excerptInputBytes=len(raw),excerptInputSha256=fullhash,transformations=[] if bounded==raw else ['UTF-8 replacement and/or bounded first/last excerpt'],phaseIds=phases)
(out/(name+'.log')).write_bytes(bounded)
(out/(name+'.meta.json')).write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta))
print(bounded.decode(),end='')
sys.exit(0)

