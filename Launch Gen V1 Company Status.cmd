@echo off
setlocal
set "PREVIEW=%~dp0.harness-company-csp-release-20261103-01\desktop-release-0.6.3\win-unpacked"
set "HOST=%~dp0"
set "TOKEN_FILE=%LOCALAPPDATA%\Maritime\company-control\owner-read.token"
if not exist "%PREVIEW%\Gen V1.exe" (
  echo The Gen V1 0.6.3 preview binary is missing.
  pause
  exit /b 1
)
if not exist "%HOST%apps\server\company-main.ts" (
  echo The current Company host source is missing.
  pause
  exit /b 1
)
if not exist "%TOKEN_FILE%" (
  echo The separate Company owner credential file is unavailable. Contact the company operator.
  pause
  exit /b 1
)
set "HARNESS_DESKTOP_TEST_DATA_DIR=%USERPROFILE%\.gen-v1-company-status"
set "HARNESS_COMPANY_PORT=45194"
set "HARNESS_DESKTOP_HOST_ROOT=%HOST%"
set "HARNESS_DESKTOP_NODE_PATH="
set "HARNESS_COMPANY_DATA_DIR="
set "GEN_COMPANY_SERVICE_ORIGIN=http://127.0.0.1:52555"
set "GEN_COMPANY_SERVICE_TOKEN="
set "GEN_COMPANY_SERVICE_TOKEN_FILE=%TOKEN_FILE%"
set "GEN_COMPANY_PLANNING_INTAKE=false"
set "GEN_COMPANY_WORK_PLANS=false"
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
echo Gen V1 Company Status: 0.6.3 native preview with current development host; status only.
start "" /D "%PREVIEW%" "%PREVIEW%\Gen V1.exe" --company
