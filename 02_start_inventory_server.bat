@echo off
setlocal
cd /d "%~dp0"
set INVENTORY_BIND_HOST=0.0.0.0
set INVENTORY_PORT=5000

echo ========================================
echo        Inventory server
echo ========================================
echo.
echo Same-network access: http://THIS-PC-IP:5000
echo Press Ctrl+C to stop the server.
echo.

where python >nul 2>nul
if %errorlevel%==0 (
    python app.py
) else (
    py -3 app.py
)

pause
