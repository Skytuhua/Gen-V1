# Gen company host on Linux (OPS-01)

This is the existing `apps/server/company-main.ts` packaged for Linux x64. It
runs in the foreground, binds **127.0.0.1 only**, and uses the existing company
profile lease and graceful shutdown. It does not start a second harness,
manager, scheduler or model. The later trusted manager-composition seam is
outside this first status-only snapshot; original Hermes remains unchanged.

The package contains Node **24.22.2**, the existing renderer, the compiled host,
its original source inputs, and the exact installed production dependency tree
for Fastify **5.12.7**, Ajv **8.18.0** and Zod **4.6.6**. `manifest.json` records
every input, package version and payload file hash. Dependency licenses stay
with their packages; Node's license is under `runtime/LICENSE`.

No Docker, global Node, Python, npm install or download is required to run this
status-only host. Node's existing Linux x64 runtime requires a compatible glibc
Linux installation. Local proof uses Ubuntu 24.04 under WSL2, not Maritime.

## Build from a reviewed source snapshot

Use the existing repository tools and a **new** output directory outside the source tree. Bulk files
belong on D: on this workstation. The script compiles the existing entry with
the already installed esbuild 0.25.12; it never installs dependencies or changes
the repository's package manifest/lockfile. A prebuilt `dist/web` is required.

```powershell
pnpm exec tsx scripts/package-company-host.ts --output-root D:\GenCompanyRelease --node-archive D:\node-v24.22.2-linux-x64.tar.xz
```

The Node archive is the official
[`node-v24.22.2-linux-x64.tar.xz`](https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz),
SHA-256 `48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75`.
Existing package directories and archives are preserved. Source-boundary changes
require review rather than silently adding another runtime to this package.

## Start, stop and restart

Extract the archive into an operator-owned directory on a native Linux filesystem,
not a Windows-mounted drive. Check its `.sha256`
sidecar before extraction. Keep private state and credentials outside the
package and outside shared/exFAT storage.

```sh
umask 077
sha256sum -c gen-v1-company-host-0.6.3-linux-x64.tar.gz.sha256
tar --no-same-owner --no-same-permissions -xzf gen-v1-company-host-0.6.3-linux-x64.tar.gz
cd gen-v1-company-host-0.6.3-linux-x64
chmod 700 bin/start.sh runtime/bin/node
export HARNESS_COMPANY_DATA_DIR="$HOME/.local/state/gen-company-ops01"
export HARNESS_COMPANY_PORT=4319
./bin/start.sh
```

Stop with **Ctrl+C**, or send **SIGTERM** to that foreground process and await
its exit. Restart the same command with the same separate state directory.
There is no PID-file supervisor or system service to install.

For an operator-authorized Company Control listener on that **same Linux host**:

```sh
export GEN_COMPANY_SERVICE_ORIGIN=http://127.0.0.1:52555
export GEN_COMPANY_SERVICE_TOKEN_FILE="$HOME/.config/company/owner-read.token"
unset GEN_COMPANY_SERVICE_TOKEN
export GEN_COMPANY_PLANNING_INTAKE=false
export GEN_COMPANY_WORK_PLANS=false
./bin/start.sh
```

The credential file must be private to the operator, contain only its existing
printable token (no newline), and remain host-only. Do not copy the workstation's
real credential into a test package. Without an authorized listener and current
credential, status is unavailable. Loopback remains enforced; remote ingress,
Maritime deployment, E01/account admission and employee execution need their
separate authorities and acceptance. Local Linux fixture proof closes none of
those gates. The Windows Company Status app and sealed 0.6.3 installer are separate.

The finite local package check passed two launches/status reads/clean stops with
the same Linux state directory, using a synthetic loopback counterpart and no
real credentials. An earlier Windows-mounted exFAT run verified payload bytes
but missed the 15-second readiness deadline; that failure remains recorded.
The same archive passed on WSL's native Linux filesystem without increasing the
deadline. This does not establish the exact cause of the mounted-drive timeout.
