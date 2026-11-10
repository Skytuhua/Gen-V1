#!/bin/sh
set -eu
umask 077
unset NODE_OPTIONS NODE_PATH ELECTRON_RUN_AS_NODE HARNESS_DESKTOP_LAUNCH_TOKEN
package_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "${HARNESS_COMPANY_DATA_DIR:-}" in
  /*) ;;
  *) echo 'Set a separate absolute HARNESS_COMPANY_DATA_DIR on native Linux storage.' >&2; exit 1 ;;
esac
[ "$("$package_root/runtime/bin/node" --version)" = 'v24.22.2' ] || exit 1
[ "$("$package_root/hermes-python/bin/python3.14" -I -S -B -c 'import sys; print(sys.version.split()[0])')" = '3.14.10' ] || exit 1
export HARNESS_HERMES_PYTHON="$package_root/hermes-python/bin/python3.14"
export PATH="$package_root/runtime/bin:$PATH"
exec "$package_root/runtime/bin/node" --import "$package_root/node_modules/tsx/dist/loader.mjs" "$package_root/apps/server/company-manager-main.ts"
