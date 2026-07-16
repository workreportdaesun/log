@echo off
setlocal
cd /d "%~dp0"

echo Checking server status...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri http://127.0.0.1:5183/ -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
    echo Server is already running.
) else (
    echo Starting server...
    start "PhotoSheetServer" /min python app.py

    :waitloop
    timeout /t 1 /nobreak >nul
    powershell -NoProfile -Command "try { Invoke-WebRequest -Uri http://127.0.0.1:5183/ -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
    if not %errorlevel%==0 goto waitloop
    echo Server started.
)

start "" http://127.0.0.1:5183/
