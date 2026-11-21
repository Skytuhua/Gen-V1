from pathlib import Path
import hashlib, json, subprocess, tarfile
root=Path.cwd()
cache=Path('<tmp>/m12-node-headers');cache.mkdir(exist_ok=True)
version=subprocess.check_output(['node','--version'],text=True).strip()
name=f'node-{version}-headers.tar.gz'
base=f'https://nodejs.org/download/release/{version}/'
for filename in ['SHASUMS256.txt',name]:
    subprocess.run(['curl','--fail','--location','--max-time','90','--silent','--show-error',base+filename,'--output',str(cache/filename)],check=True)
expected=next(line.split()[0] for line in (cache/'SHASUMS256.txt').read_text().splitlines() if line.split()[-1]==name)
actual=hashlib.sha256((cache/name).read_bytes()).hexdigest()
assert actual==expected,(actual,expected)
print(json.dumps({'node':version,'headersSource':base+name,'headersSHA256':actual,'dependency':'existing locked node-pty@1.1.0'},indent=2),flush=True)
with tarfile.open(cache/name) as archive: archive.extractall(cache,filter='data')
gyp=root/'node_modules/.pnpm/node-gyp@12.4.0/node_modules/node-gyp/bin/node-gyp.js'
subprocess.run(['node',str(gyp),'rebuild','--directory',str(root/'node_modules/node-pty'),'--nodedir',str(cache/f'node-{version}')],check=True)
subprocess.run(['node','-e',"const pty=require('node-pty'); const p=pty.spawn('/bin/sh',['-c','printf m12-native-ready'],{name:'xterm',cols:80,rows:24,env:{}});let out='';p.onData(d=>out+=d);p.onExit(e=>{if(e.exitCode!==0||!out.includes('m12-native-ready'))process.exit(1);console.log('Native PTY smoke passed');});"],check=True)
