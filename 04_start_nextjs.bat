@echo off
setlocal
cd /d "%~dp0"
call npm.cmd run db:prepare
if errorlevel 1 goto failed
echo Open http://localhost:3000
echo Press Ctrl+C to stop.
call npm.cmd run dev
:failed
pause
