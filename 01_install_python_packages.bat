@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   Inventory - Python package installer
echo ========================================
echo.

where py >nul 2>&1
if not errorlevel 1 goto USE_PY

where python >nul 2>&1
if not errorlevel 1 goto USE_PYTHON

echo [ERROR] Python was not found.
echo Install Python 3 first and enable "Add Python to PATH".
echo Then run this file again.
pause
exit /b 1

:USE_PY
py -3 -m pip install -r "%~dp0requirements.txt"
if errorlevel 1 goto INSTALL_ERROR
goto INSTALL_OK

:USE_PYTHON
python -m pip install -r "%~dp0requirements.txt"
if errorlevel 1 goto INSTALL_ERROR
goto INSTALL_OK

:INSTALL_ERROR
echo.
echo [ERROR] Package installation failed.
echo Check the Internet connection and Python installation.
pause
exit /b 1

:INSTALL_OK
echo.
echo [OK] Package installation completed.
pause
exit /b 0
