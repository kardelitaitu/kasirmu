@echo off
REM ============================================================================
REM  generate-local-api-key.bat — generates a local API token for kasir.mu sync.
REM
REM  Run after `scripts\start-local-sync.bat` is up and running.
REM  Calls `POST http://localhost:3099/api/v1/tokens` to create a JWT
REM  token using the local server secret. Copy the output and paste it into
REM  Settings -> Cloud Sync -> API Key inside your POS application.
REM ============================================================================
setlocal

echo Generating API Key from local sync server (http://localhost:3099)...
echo.

powershell -NoProfile -Command "$ErrorActionPreference='Stop'; try { $r = (Invoke-RestMethod -Uri 'http://localhost:3099/api/v1/tokens' -Method Post -Body '{\"label\":\"local-pos-client\",\"expiry_hours\":8760}' -ContentType 'application/json').token; Write-Host '============================================================================' -ForegroundColor Cyan; Write-Host 'Your Local API Key (valid for 1 year):' -ForegroundColor Green; Write-Host ''; Write-Host $r -ForegroundColor Yellow; Write-Host ''; Write-Host 'Copy the token string above and paste it into Settings -> Cloud Sync -> API Key' -ForegroundColor White; Write-Host '============================================================================' -ForegroundColor Cyan } catch { Write-Host 'ERROR: Failed to generate token. Please ensure scripts\start-local-sync.bat is running.' -ForegroundColor Red; exit 1 }"

if errorlevel 1 (
    echo.
    echo Make sure Docker Desktop is running and scripts\start-local-sync.bat has completed.
)

echo.
pause
endlocal
