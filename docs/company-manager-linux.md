# Linux Gen company manager runtime

This package includes the reviewed `company-manager-main.ts` entry, shared
company lifecycle, existing manager composition/journal/tools, original Hermes
engine, isolated CPython and the existing Pi subscription transport. It does not
replace Gen's engine or select Maritime's separate employee Codex CLI.

Pins: Node 24.22.2; CPython 3.14.10 (Astral standalone 20261026); Gen Hermes
`c627ec84664d43e0b18b95d9d86d8963747d56c7`; Pi coding agent/AI 1.4.0;
`openai-codex/gpt-6.1-sol`, `max`. The existing npm lock resolutions/overrides
and all 33 original Hermes Python distribution pins are retained. Build tools
are pnpm 10.30.3 and uv 0.13.5. Python's portable distribution and its licenses
are provided by [python-build-standalone](https://github.com/astral-sh/python-build-standalone/releases/tag/20261026).
No dependencies are downloaded at runtime.

## Authority and current limits

`company-manager-main.ts` calls the existing `launchCompanyManagerHost` with
**no authority**. The host runs, but manager availability remains false and it
creates no manager journal/engine. No JSON, environment switch or browser
setting can install an inference permit. Actual admission/current-policy
checks, company account identity/leases and accounting must come from genuine
trusted programmatic composition owned by Company Control. Personal accounts
and sessions are never supplied by this package.

Linux directory custody requires the trusted OS setup below. Ordinary Linux
launches without that kernel boundary still fail closed. The original archive
predates this support; its raw worker hello does not establish guarded-engine
readiness. No advisory lock or metadata check replaces kernel protection.
This support does not establish whole-process containment, model authentication,
admitted/live E01 or cloud execution.

## Build and run

Build bulk files on a **native Linux filesystem** backed by D: on this workstation.
Use new input/work/output paths. The preparer selects only runtime source,
exact pinned Hermes source, the verified renderer and required production npm
dependencies. It excludes accounts, profiles, `.env` and global agent settings.
The frozen npm install ignores lifecycle scripts; Python installs binary wheels
only into the package's isolated dependency root.

```text
pnpm exec tsx scripts/package-company-manager.ts prepare <source-root> <new-inputs-dir> <verified-web-dir> <downloads.json>
<pinned-linux-node> <inputs-dir>/build-manager.mjs build <inputs-dir> <new-native-linux-work-dir> <output.tar.gz>
```

`downloads.json` contains only public archive paths keyed `node`, `python`, `uv`
and `pnpm`. The preparer verifies their fixed SHA-256 values from the script,
the existing dependency lock and original Hermes manifest before staging.
The built artifact has its own file/source manifest and SHA-256 sidecar.
The earlier 52 MB status-only archive remains separate and unchanged.

After verifying the archive sidecar, extract it into an operator-owned native
Linux directory and run:

```sh
umask 077
export HARNESS_COMPANY_DATA_DIR="$HOME/.local/state/gen-company-manager"
export HARNESS_COMPANY_PORT=4320
./bin/start-manager.sh
```

Stop with Ctrl+C or SIGTERM and await the process exit; restart the same command
with the same separate profile. The default listener remains loopback-only.
Optional genuine status reads use the existing same-host service origin and
protected token-file path. Leave raw token values unset and write flags false.
Neither those reads nor the public approved-job selection grant manager authority.

The native approved-job preview, its isolated profile, installed 0.5.1 and the
sealed 0.6.3 Windows installer are independent of this package. A new conversation
frontend must arrive through its separately owned source/web handoff.

## Verified local candidate

The 2026-11-04 candidate is
`D:/GenerativeHarnessVerification/gen-company-manager-linux-20261104-01/release/gen-v1-company-manager-0.6.3-linux-x64.tar.gz`
(133,296,796 bytes), SHA-256
`b3402c76efbcac89ce79aa5a10d2d2d069051ff97b999e232fcbf20534bf2c4d`.
It includes the previously verified approved-job renderer; the newer manager
conversation frontend is a separate pending handoff.

A fresh extraction on Ubuntu 24.04.5 WSL2's native filesystem verified all
30,603 manifest entries, all 33 Python distributions, the Pi SDK import and
the original Python worker's `hello` identifying `run_agent.AIAgent`. Two
manager-entry launches read a synthetic loopback status counterpart and stopped
normally with exit 0, retaining the same profile lease across restart. Each
launch kept manager availability false, rejected proposals with 503, and created
no manager state directories. No real credentials, models or cloud resources
were used. Four package checks and scoped TypeScript validation also passed.

The same check observed `CAPABILITY_DENIED` before the guarded Linux Hermes
home action could run. Raw Python import/hello is dependency proof, not proof
that the guarded engine or an admitted manager can run. Native Linux storage
custody and genuine admission/account/accounting composition remain unfinished.
This is not Maritime deployment or installed Windows acceptance.

## Guarded Linux startup

`packages/core/linux-path-guard.py` is a fixed root-operated setup helper, not a
setuid program or inference authority. It creates a private mount namespace and
an idmapped profile. Backing ownership differs from the runtime UID, so an
ordinary process outside that namespace cannot open the backing storage. The
helper pins acquired directories with bind mounts; the kernel rejects their
rename/removal with `EBUSY`. New lock directories and atomic file saves remain
available. Child Gen/Python/Pi processes run as the reserved non-root UID with
all capabilities dropped and `NoNewPrivs=1`.

The operator must reserve that UID exclusively for this process tree. Setup
rejects an already-used UID, writable/non-root-owned ancestors, redirected
profiles, shared backing permissions, and unavailable kernel operations. The
TypeScript client verifies the actual mount table, capability state and both
kernel views of the same inode (different mapped/backing owners) before using
the broker. A browser setting or inherited environment value cannot provide
those properties.

Linux support is deliberately limited to the ordinary directory guards used by
Hermes home and account-profile startup. File/tree guards and identity-based
remove/replace operations remain denied. It does not enable personal project
tools on Linux or provide their missing containment.

For an operator-approved host with available idmapped mounts/CAP_SYS_ADMIN,
first create a new private backing profile under root-owned, non-writable
ancestors. Example IDs below must be reserved by that operator; no OS account,
authentication or model grant is created by these commands:

```sh
install -d -m 0711 /data/gen-manager
install -d -m 0700 -o 62002 -g 62002 /data/gen-manager/state
export HARNESS_COMPANY_PORT=4320
./hermes-python/bin/python3.14 -I -S -B ./packages/core/linux-path-guard.py \
  --uid 62001 --gid 62001 --state-root /data/gen-manager/state -- \
  "$PWD/runtime/bin/node" --import "$PWD/node_modules/tsx/dist/loader.mjs" \
  "$PWD/apps/server/company-manager-main.ts"
```

Do not run Gen itself as root. Stop the helper with SIGTERM; it forwards the
signal to the unchanged company lifecycle and retains custody until descendants
exit. Restart with the same reserved IDs/profile. No permit is installed and the
manager remains unavailable without genuine programmatic authority.

Local native checks now reach the original **guarded** Hermes `AIAgent` hello,
Pi's actual credential lock and local session creation. Two clean runs and two
guarded manager-host SIGTERM/restart cycles passed without models or real
credentials. Native checks also reject rename, symlink/hardlink aliases, access
through the unmapped backing descriptor, an unprotected launch, and reuse of an
occupied runtime UID. A child namespace cannot unmount the pin. The initial
normal-exit/socket-close race is retained as a failed run and was corrected.
The Windows guard implementation is unchanged; 49 focused regression checks
passed after generating their missing existing widget prerequisite.

CONTROL separately demonstrated the kernel primitives on its actual E01 host.
That observation is not installation or execution of this Gen implementation;
its network enforcement/admission and manager account/accounting remain separate
unfinished gates.
