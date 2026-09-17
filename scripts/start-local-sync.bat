@echo off
REM ============================================================================
REM  start-local-sync.bat — launches the OZ-POS local sync server in Docker.
REM
REM  Run from project root (or from the scripts/ folder via double-click).
REM  Checks if Docker Desktop is installed and running; if stopped, attempts
REM  to auto-start Docker Desktop. Once ready, runs `docker compose up -d`
REM  with --project-directory . and the ops/docker/ compose files (see below).
REM  to build and start the headless `pos-cloud-server` container on port 3099.
REM
REM  Usage (SQLite — default, no external DB container needed):
REM    start-local-sync.bat
REM
REM  Usage (PostgreSQL profile — launches pg container + server):
REM    start-local-sync.bat --pg
REM
REM  To stop the server at any time, double-click `stop-local-sync.bat` or run:
REM    docker compose down
REM ============================================================================
setlocal EnableExtensions

cd /d "%~dp0.."
set "SYNC_PORT=%OZ_API_PORT%"
if not defined SYNC_PORT set "SYNC_PORT=3099"

echo [1/4] Checking Docker CLI availability...
where docker >nul 2>&1
if not errorlevel 1 goto check_daemon

echo.
echo ERROR: Docker command not found on PATH!
echo Please install Docker Desktop from https://www.docker.com/products/docker-desktop/
echo.
pause
exit /b 1

:check_daemon
echo [1/4] Checking Docker engine/daemon status...
docker info >nul 2>&1
if not errorlevel 1 goto docker_ready

echo Docker daemon is currently stopped.
if not exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" goto docker_missing

echo Attempting to auto-start Docker Desktop...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
echo Waiting for Docker Desktop engine to initialize (this may take 15-45 seconds)...

set /a attempts=0
:docker_wait_loop
ping 127.0.0.1 -n 6 >nul
docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
set /a attempts+=1
if %attempts% gtr 15 goto docker_timeout
echo   Still waiting for Docker daemon... (%attempts%/15)
goto docker_wait_loop

:docker_timeout
echo.
echo ERROR: Timed out waiting for Docker Desktop to start.
echo Please check Docker Desktop manually from the Windows taskbar.
pause
exit /b 1

:docker_missing
echo.
echo ERROR: Docker daemon is not running and Docker Desktop executable could not be found.
echo Please open Docker Desktop manually and run this script again.
pause
exit /b 1

:docker_ready
echo Docker engine is running!
echo.
echo [2/4] Validating Docker Compose configuration and required secrets...
if "%~1"=="--pg" goto validate_pg_config
docker compose --project-directory . -f ops/docker/docker-compose.yml -f ops/docker/docker-compose.override.yml config --quiet
if errorlevel 1 goto compose_config_failed
goto launch_sqlite

:validate_pg_config
docker compose --project-directory . -f ops/docker/docker-compose.yml -f ops/docker/docker-compose.override.yml -f ops/docker/docker-compose.pg.yml config --quiet
if errorlevel 1 goto compose_config_failed

goto launch_pg

:launch_sqlite
echo.
echo [3/4] Launching OZ-POS Cloud Sync Server (SQLite default)...
docker compose --project-directory . -f ops/docker/docker-compose.yml -f ops/docker/docker-compose.override.yml up -d --build
if errorlevel 1 goto compose_failed
goto wait_ready

:launch_pg
echo.
echo [3/4] Launching OZ-POS Cloud Sync Server (PostgreSQL)...
docker compose --project-directory . -f ops/docker/docker-compose.yml -f ops/docker/docker-compose.override.yml -f ops/docker/docker-compose.pg.yml up -d --build
if errorlevel 1 goto compose_failed
goto wait_ready

:compose_config_failed
echo.
echo ERROR: Docker Compose configuration is invalid or a required secret is missing.
echo Set OZ_API_SECRET and OZ_LICENSE_PRIVATE_KEY before starting.
echo For PostgreSQL mode, also set PG_PASSWORD.
echo See .env.example and docs/operations/docker-deployment.md.
pause
exit /b 1

:compose_failed
echo.
echo ERROR: Docker Compose failed to build or launch the container.
echo Please check the error messages above.
pause
exit /b 1

:wait_ready
where curl.exe >nul 2>&1
if not errorlevel 1 goto readiness_loop
echo.
echo ERROR: curl.exe is required to verify the local sync API readiness.
echo Install curl or add it to PATH, then run this script again.
pause
exit /b 1

:readiness_loop
echo.
echo [4/4] Waiting for health and token endpoints on port %SYNC_PORT%...
set /a readiness_attempts=0
:readiness_probe
curl.exe --silent --show-error --fail --max-time 5 "http://localhost:%SYNC_PORT%/api/v1/health" >nul 2>&1
if errorlevel 1 goto readiness_retry
curl.exe --silent --show-error --fail --max-time 5 -X POST "http://localhost:%SYNC_PORT%/api/v1/tokens" -H "Content-Type: application/json" -d "{\"label\":\"pos-local-readiness\"}" >nul 2>&1
if not errorlevel 1 goto compose_success

:readiness_retry
set /a readiness_attempts+=1
if %readiness_attempts% geq 20 goto readiness_failed
echo   API is not ready yet (%readiness_attempts%/20)...
ping 127.0.0.1 -n 3 >nul
goto readiness_probe

:readiness_failed
echo.
echo ERROR: Docker containers started, but the health or token endpoint did not become ready.
echo Check logs with: docker compose --project-directory . -f ops/docker/docker-compose.yml logs --tail=100 pos-cloud-server
echo.
pause
exit /b 1

:compose_success
echo.
echo ============================================================================
echo  OZ-POS Local Sync Server is running and ready!
echo.
echo  - API Endpoint:    http://localhost:%SYNC_PORT%
echo  - Health Check:    http://localhost:%SYNC_PORT%/api/v1/health
echo  - Live Logs:       docker compose --project-directory . -f ops/docker/docker-compose.yml logs -f pos-cloud-server
echo  - Stop Server:     Run stop-local-sync.bat or docker compose --project-directory . -f ops/docker/docker-compose.yml down
echo.
echo  To test cloud sync in your POS app, go to Settings -^> Sync / Multi-store
echo  and set the Sync Server URL to: http://localhost:%SYNC_PORT%
echo ============================================================================
echo.

pause
endlocal
