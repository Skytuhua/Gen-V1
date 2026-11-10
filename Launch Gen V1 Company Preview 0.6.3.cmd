@echo off
setlocal
set "PREVIEW=%~dp0.harness-company-csp-release-20261103-01\desktop-release-0.6.3\win-unpacked"
if not exist "%PREVIEW%\Gen V1.exe" (
  echo The Gen V1 0.6.3 preview folder is missing. Keep it beside this launcher.
  pause
  exit /b 1
)
set "HARNESS_DESKTOP_TEST_DATA_DIR=%USERPROFILE%\.gen-v1-company-preview-063"
set "HARNESS_COMPANY_PORT=45193"
set "HARNESS_DESKTOP_HOST_ROOT="
set "HARNESS_DESKTOP_NODE_PATH="
set "HARNESS_COMPANY_DATA_DIR="
set "GEN_COMPANY_SERVICE_ORIGIN="
set "GEN_COMPANY_SERVICE_TOKEN="
set "GEN_COMPANY_PLANNING_INTAKE="
set "GEN_COMPANY_WORK_PLANS="
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
start "" /D "%PREVIEW%" "%PREVIEW%\Gen V1.exe" --company
