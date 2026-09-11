@echo off
setlocal
cd /d "%~dp0"
call npm.cmd ci
if errorlevel 1 goto failed
call npm.cmd run db:prepare
if errorlevel 1 goto failed
echo Next.js setup completed. Run 04_start_nextjs.bat.
pause
exit /b 0
:failed
echo Setup failed. Check the error above.
pause
exit /b 1
