@echo off
setlocal EnableDelayedExpansion
REM ===========================================================================
REM  deploy-website.bat -- build and deploy the kasir.mu website to Cloudflare.
REM
REM  WHY THIS EXISTS
REM
REM  Typing  bash scripts/wrangler-deploy.sh  in a Windows shell does NOT run
REM  Git Bash. C:\Windows\System32\bash.exe -- the WSL launcher, shipped with
REM  every Windows 10/11 install that has WSL -- sits earlier on PATH than
REM  Git's own bash.exe. So `bash` starts Ubuntu instead, and Ubuntu's PATH
REM  contains no Windows Node at all: the build ran under /usr/bin/node
REM  v18.19.1 (Ubuntu's apt build) while the calling shell happily reported
REM  v22.23.2. Nothing in the output said so until the build failed on
REM  `--experimental-strip-types`. Measured 2026-10-12.
REM
REM  The website needs Node >= 22.6 (root .nvmrc pins 24, to match CI).
REM
REM  This file removes both ambiguities: it pins a modern Node onto PATH, and
REM  runs the real deploy script through Git Bash located by absolute path.
REM  All arguments pass through unchanged, so
REM
REM      deploy-website.bat --message "auth-nav hint" --tag v1.2.3
REM
REM  behaves exactly like scripts/wrangler-deploy.sh.
REM
REM  Credentials: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, read by the
REM  shell script from the repo-root .env. Full procedure and the post-deploy
REM  checks: docs/operations/website-auth-nav-deploy.md
REM
REM  Try it first with:  deploy-website.bat --dry-run
REM ===========================================================================

cd /d "%~dp0" || exit /b 1

REM --- 1. Put a modern Node first on PATH -----------------------------------
REM Order of preference: an explicit override, then nvm-for-windows' own
REM NVM_SYMLINK (set by `nvm use`), then this box's usual symlink folder.
REM If none of those exist we fall back to whatever node is already on PATH
REM and let step 2 judge it.
set "NODEDIR="
if defined KASIRMU_NODEDIR if exist "%KASIRMU_NODEDIR%\node.exe" set "NODEDIR=%KASIRMU_NODEDIR%"
if not defined NODEDIR if defined NVM_SYMLINK if exist "%NVM_SYMLINK%\node.exe" set "NODEDIR=%NVM_SYMLINK%"
if not defined NODEDIR if exist "C:\nvm4w\nodejs\node.exe" set "NODEDIR=C:\nvm4w\nodejs"
if defined NODEDIR set "PATH=%NODEDIR%;%PATH%"

REM --- 2. Fail fast below the Node floor ------------------------------------
where node >nul 2>nul || (
  echo [deploy] ERROR: no node.exe on PATH.
  echo [deploy]         Install Node ^>= 22.6, or set KASIRMU_NODEDIR to its folder.
  exit /b 1
)
set "RAW=" & set "MIN="
for /f "tokens=1,2 delims=." %%a in ('node --version 2^>nul') do (
  set "RAW=%%a" & set "MIN=%%b"
)
if defined RAW set "RAW=!RAW:v=!"
if not defined MIN set "MIN=0"
if not defined RAW (
  echo [deploy] ERROR: could not read `node --version`.
  exit /b 1
)
if !RAW! LSS 22 goto badnode
if !RAW! EQU 22 if !MIN! LSS 6 goto badnode
echo [deploy] Node !RAW!.!MIN! -- ok

REM --- 3. Locate Git Bash by absolute path ---------------------------------
set "BASH="
if defined KASIRMU_BASH if exist "%KASIRMU_BASH%" set "BASH=%KASIRMU_BASH%"
if not defined BASH if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles%\Git\usr\bin\bash.exe" set "BASH=%ProgramFiles%\Git\usr\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set "BASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if not defined BASH (
  echo [deploy] ERROR: Git Bash not found in the usual places.
  echo [deploy]         Install Git for Windows, or set KASIRMU_BASH to its bash.exe.
  exit /b 1
)
for /f "tokens=*" %%v in ('npm --version 2^>nul') do set "NPMVER=%%v"
echo [deploy] npm   !NPMVER!
echo [deploy] bash  !BASH!

REM --- 4. Dry run ----------------------------------------------------------
REM Proves the toolchain this batch file will actually use, without building
REM or deploying anything.
if /i "%~1"=="--dry-run" (
  echo [deploy] DRY RUN -- would execute:
  echo [deploy]   "!BASH!" scripts\wrangler-deploy.sh %*
  echo [deploy] Node resolved from: !NODEDIR!
  exit /b 0
)

REM --- 5. Deploy -----------------------------------------------------------
"%BASH%" "scripts/wrangler-deploy.sh" %*
exit /b %ERRORLEVEL%

:badnode
echo [deploy] ERROR: Node !RAW!.!MIN! is older than 22.6, which the website build needs.
echo [deploy]         Cause of the "node: bad option: --experimental-strip-types" failure.
echo [deploy]         Install a newer Node, e.g. `nvm install 24`, or set
echo [deploy]         KASIRMU_NODEDIR to a folder whose node.exe is ^>= 22.6.
exit /b 1
