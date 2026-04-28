@echo off
setlocal

cd /d C:\dev\maryland-edwait-predictor\expresscare-dashboard

REM --- Already-complete shortcut ---
if exist scripts\data\ors-grind-complete.txt (
    echo Already complete. Exiting.
    exit /b 0
)

REM --- Ensure log directory exists ---
if not exist scripts\data\ors-logs mkdir scripts\data\ors-logs

REM --- Today's date for log filename ---
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"`) do set TODAY=%%d

REM --- Run the ORS grinder (quota-aware; exits cleanly when daily quota hit) ---
echo [%TODAY%] Starting ORS drive-time grind...
model\venv\Scripts\python.exe model\gravity\compute_drive_times.py >> scripts\data\ors-logs\%TODAY%.log 2>&1

REM --- Update status file; exit code 42 means matrix is complete ---
model\venv\Scripts\python.exe scripts\check_matrix_status.py >> scripts\data\ors-logs\%TODAY%.log 2>&1
set STATUS_CODE=%errorlevel%

if %STATUS_CODE% equ 42 (
    echo [%TODAY%] Matrix complete. Running build_gravity_model.py...
    model\venv\Scripts\python.exe model\gravity\build_gravity_model.py >> scripts\data\ors-logs\%TODAY%.log 2>&1

    echo [%TODAY%] Running upload_results.py...
    model\venv\Scripts\python.exe model\gravity\upload_results.py >> scripts\data\ors-logs\%TODAY%.log 2>&1

    for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "Get-Date -Format o"`) do set ISOTIME=%%t
    echo %ISOTIME% ORS grind complete; build and upload finished. > scripts\data\ors-grind-complete.txt

    schtasks /change /tn "ExpressCareORSGrind" /disable >nul 2>&1
    echo [%TODAY%] Scheduled task disabled.
)

echo [%TODAY%] Done. See scripts\data\ors-status.txt for one-line status.
endlocal
exit /b 0
