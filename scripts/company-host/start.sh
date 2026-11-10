#!/bin/sh
set -eu
umask 077
unset NODE_OPTIONS NODE_PATH ELECTRON_RUN_AS_NODE HARNESS_DESKTOP_LAUNCH_TOKEN
package_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "${HARNESS_COMPANY_DATA_DIR:-}" in
  /*) ;;
  *) echo 'Set HARNESS_COMPANY_DATA_DIR to a separate absolute Linux state directory.' >&2; exit 1 ;;
esac
if [ "$("$package_root/runtime/bin/node" --version)" != 'v24.22.2' ]; then
  echo 'This company package requires its pinned Node 24.22.2 runtime.' >&2
  exit 1
fi
exec "$package_root/runtime/bin/node" "$package_root/apps/server/company-main.mjs"
