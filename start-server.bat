@echo off
title Sigma Label LLC - Local Server
echo ========================================================
echo   Sigma Label LLC - Local Web Server
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in your PATH.
    echo Please install Node.js from https://nodejs.org to run the local server.
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0"

echo Starting server on http://localhost:3000 ...
echo Opening your browser to http://localhost:3000 ...
echo.
echo Press Ctrl+C anytime to stop the server.
echo ========================================================
echo.

start http://localhost:3000
node server.js

pause
