@echo off
title Santa Attic
cd /d "%~dp0"
set "PORT=8777"

set "PY=py"
py -V >NUL 2>NUL
if errorlevel 1 set "PY=python"
%PY% -V >NUL 2>NUL
if errorlevel 1 goto nopy

echo.
echo    Santa Attic
echo    folder : %cd%
echo    url    : http://localhost:%PORT%/index.html
echo.

start "attic-server" /min %PY% -m http.server %PORT%
timeout /t 2 /nobreak >NUL
start "" "http://localhost:%PORT%/index.html"

echo    Browser opened.
echo    Press any key here to stop the server.
pause >NUL
taskkill /fi "WINDOWTITLE eq attic-server*" /f >NUL 2>NUL
exit /b 0

:nopy
echo.
echo    [!] Python 3 not found.
echo        Install Python 3, or serve this folder with any static web server.
echo.
pause
exit /b 1
