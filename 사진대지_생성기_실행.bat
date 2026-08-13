@echo off
rem 2026-08-13: 서버를 pythonw(콘솔 없는 파이썬)로 띄우도록 변경.
rem   예전: start /min python app.py  -> 검은 창이 작업표시줄에 계속 남았다.
rem 서버 종료는 따로 안 해도 된다 — 브라우저 창을 닫으면 app.py 워치독이 끈다.
rem
rem 이 bat도 실행할 때 cmd 창이 잠깐 뜬다. 그것도 싫으면 옆의 "사진대지_생성기.vbs"를 쓸 것
rem (완전히 창 없이 뜬다). 바로가기는 vbs 쪽으로 만드는 걸 권장.
setlocal
cd /d "%~dp0"

powershell -NoProfile -Command "try { Invoke-WebRequest -Uri http://127.0.0.1:5183/ -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not %errorlevel%==0 (
    start "" /b pythonw.exe app.py

    :waitloop
    timeout /t 1 /nobreak >nul
    powershell -NoProfile -Command "try { Invoke-WebRequest -Uri http://127.0.0.1:5183/ -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
    if not %errorlevel%==0 goto waitloop
)

start "" http://127.0.0.1:5183/
