@echo off
setlocal
set "RUNTIME=%~dp0node_modules\electron\dist\electron.exe"
set "APP=%USERPROFILE%\.gen-main-app-20261104"
set "HOST=%USERPROFILE%\.gen-main-host-20261104-02"
set "NODE=%~dp0.harness-company-csp-release-20261103-01\desktop-release-0.6.3\win-unpacked\resources\node\node.exe"
if not exist "%RUNTIME%" exit /b 1
if not exist "%APP%\main.mjs" exit /b 1
if not exist "%HOST%\approved-job.json" exit /b 1
if not exist "%NODE%" exit /b 1
set "HARNESS_DESKTOP_TEST_DATA_DIR=%USERPROFILE%\.gen-main"
set "HARNESS_DESKTOP_HOST_ROOT=%HOST%"
set "HARNESS_DESKTOP_NODE_PATH=%NODE%"
set "HARNESS_COMPANY_PORT=45196"
set "HARNESS_COMPANY_DATA_DIR="
set "GEN_COMPANY_SERVICE_ORIGIN=http://127.0.0.1:52555"
set "GEN_COMPANY_SERVICE_TOKEN="
set "GEN_COMPANY_SERVICE_TOKEN_FILE=%LOCALAPPDATA%\Maritime\company-control\pilot-read.token"
set "GEN_COMPANY_APPROVED_JOB_FILE=%HOST%\approved-job.json"
set "GEN_COMPANY_PLANNING_INTAKE=false"
set "GEN_COMPANY_WORK_PLANS=false"
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
set "NODE_PATH="
start "" /D "%APP%" "%RUNTIME%" "%APP%" --company >nul 2>&1
