@echo off
cd /d "%~dp0..\..\ui"
call npm run build
exit /b 0
