@echo off
setlocal
set "PREVIEW=%~dp0.harness-company-csp-release-20261103-01\desktop-release-0.6.3\win-unpacked"
set "CAPSULE=%USERPROFILE%\.gen-v1-approved-job-host-20261104-01"
if not exist "%PREVIEW%\Gen V1.exe" exit /b 1
if not exist "%CAPSULE%\approved-job.json" exit /b 1
if not exist "%LOCALAPPDATA%\Maritime\company-control\pilot-read.token" exit /b 1
set "HARNESS_DESKTOP_TEST_DATA_DIR=%USERPROFILE%\.gen-v1-approved-job-read"
set "HARNESS_COMPANY_PORT=45195"
set "HARNESS_DESKTOP_HOST_ROOT=%CAPSULE%"
set "HARNESS_DESKTOP_NODE_PATH="
set "HARNESS_COMPANY_DATA_DIR="
set "GEN_COMPANY_SERVICE_ORIGIN=http://127.0.0.1:52555"
set "GEN_COMPANY_SERVICE_TOKEN="
set "GEN_COMPANY_SERVICE_TOKEN_FILE=%LOCALAPPDATA%\Maritime\company-control\pilot-read.token"
set "GEN_COMPANY_APPROVED_JOB_FILE=%CAPSULE%\approved-job.json"
set "GEN_COMPANY_PLANNING_INTAKE=false"
set "GEN_COMPANY_WORK_PLANS=false"
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
start "" /D "%PREVIEW%" "%PREVIEW%\Gen V1.exe" --company >nul 2>&1
