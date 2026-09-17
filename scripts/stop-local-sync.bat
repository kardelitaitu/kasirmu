@echo off
REM ============================================================================
REM  stop-local-sync.bat — stops and removes the OZ-POS Docker sync containers.
REM
REM  Run from project root (or from the scripts/ folder via double-click).
REM  Runs `docker compose down` to shut down pos-cloud-server and optional
REM  pos-cloud-db containers cleanly while keeping your data volumes intact.
REM ============================================================================
setlocal

REM `%~dp0` is the directory containing this bat (project root).
cd /d "%~dp0.."

echo Stopping OZ-POS Cloud Sync Server Docker containers...
docker compose down

if errorlevel 1 (
    echo.
    echo ERROR: Failed to stop Docker Compose containers. Check if Docker Desktop is running.
    pause
    exit /b 1
)

echo.
echo ============================================================================
echo  OZ-POS Local Sync Server containers have been stopped cleanly.
echo  (Your database volume /data/kasir.db is preserved for next time)
echo ============================================================================
echo.

pause
endlocal
