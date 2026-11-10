@echo off
setlocal
set "APP=%~dp0.harness-company-csp-release-20261103-01\desktop-release-0.6.3\win-unpacked\Gen V1.exe"
set "HOST=%USERPROFILE%\.gen-v1-host-20261104-01"
set "NODE=%~dp0.harness-company-csp-release-20261103-01\desktop-release-0.6.3\win-unpacked\resources\node\node.exe"
if not exist "%APP%" exit /b 1
if not exist "%HOST%\apps\server\main.ts" exit /b 1
if not exist "%HOST%\dist\web\index.html" exit /b 1
if not exist "%NODE%" exit /b 1
set "HARNESS_DESKTOP_TEST_DATA_DIR="
set "HARNESS_DESKTOP_HOST_ROOT=%HOST%"
set "HARNESS_DESKTOP_NODE_PATH=%NODE%"
set "HARNESS_DATA_DIR=%LOCALAPPDATA%\GenerativeHarness"
set "HARNESS_DESKTOP_PORT=4317"
set "HARNESS_DESKTOP_WIDGET_PORT=4318"
set "GEN_COMPANY_SERVICE_ORIGIN="
set "GEN_COMPANY_SERVICE_TOKEN="
set "GEN_COMPANY_SERVICE_TOKEN_FILE="
set "GEN_COMPANY_APPROVED_JOB_FILE="
set "GEN_COMPANY_PLANNING_INTAKE="
set "GEN_COMPANY_WORK_PLANS="
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
set "NODE_PATH="
start "" /D "%HOST%" "%APP%" >nul 2>&1
