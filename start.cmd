@echo off
rem Double-click to start Habla. Edge opens after the server is up.
cd /d "%~dp0"
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start msedge http://localhost:3000"
node server.js
pause
