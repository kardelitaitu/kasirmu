@echo off
REM ============================================================================
REM  start-desktop.bat — launches the kasir.mu desktop client in dev mode.
REM
REM  Run from project root (or any directory). It will cd to the Rust crate,
REM  then `cargo tauri dev` which builds the Rust binary in debug profile,
REM  starts Vite on the devUrl defined in apps/desktop-tauri/tauri.conf.json,
REM  and bridges them via the Tauri Webview. UI edits under ui/src/*.tsx hot-
REM  reload via HMR; Rust edits under apps/desktop-tauri/src/ trigger a
REM  rebuild.
REM
REM  DO NOT REPLACE THE COMMAND WITHOUT READING THIS:
REM    - `cargo tauri dev` (current) = debug Rust + dev Vite + HMR. The
REM      process stays alive until the terminal window closes. Use this for
REM      iterating on code.
REM    - `cargo tauri build`         = release .exe + bundled installer with
REM      NSIS/MSI, no HMR, terminals close immediately on completion. Use
REM      `cargo tauri build --debug` if you want a debug .exe without
REM      leaving dev mode (still no HMR though).
REM    - DO NOT remove `pause`. The console host closes the window on its
REM      own when the script exits, hiding any startup error from you.
REM    - DO NOT change `cd /d "%~dp0..\apps\desktop-tauri"`. cargo locates
REM      Cargo.toml via CWD; without this, running the bat from any directory
REM      fails with "could not find Cargo.toml". (The `..` appeared when this
REM      file moved from the repo root into scripts/ in f3d9cca6 -- the warning
REM      quoted the pre-move path for a while, which would have sent anyone
REM      "restoring" it straight back to that error.)
REM    - `setlocal` / `endlocal` keep env-var changes scoped to this run.
REM      Do NOT add global `set` lines without bounding them between them.
REM    - `%~dp0` is the directory containing this bat (now `scripts\`); the
REM      `..\apps\desktop-tauri` suffix is resolved relative to that, so the
REM      bat works no matter which directory it is invoked from. Do NOT replace
REM      with an absolute path that ties it to one developer's machine layout.
REM
REM  NOTE ON `beforeDevCommand` IN apps\desktop-tauri\tauri.conf.json:
REM  tauri-cli does NOT run it from the crate directory this bat cd's into.
REM  It runs the child with the working directory set to the FRONTEND
REM  directory derived from `frontendDist` -- here `ui\` -- so
REM  `npm run dev --prefix ../ui` is CORRECT even though it reads one level
REM  short from apps\desktop-tauri. "Correcting" it to `../../ui` makes npm
REM  look for C:\dev\ui\package.json, and the dev server never starts.
REM  (Measured 2026-09-28: `--prefix ../ui` resolves to C:\dev\kasirmu\ui and
REM  npm finds kasirmu-ui; `--prefix ../../ui` fails with ENOENT on
REM  C:\dev\ui\package.json.)
REM
REM  PREREQS (you install these once, this bat does none of it):
REM    - Node.js + npm            (node / npm on PATH)
REM    - Rust toolchain           (rustup + stable)
REM    - Tauri CLI                (cargo install tauri-cli)
REM    - UI dependencies          (cd ui && npm install, once)
REM
REM  STALE-PORT HANDLING (auto on every startup, Windows only):
REM  Any stale dev-server (typically a leftover `node` from a crashed `vite`)
REM  holding port 1420 is killed via scripts\free-dev-port.ps1, which:
REM    - Covers both IPv4 and IPv6 listeners/bound sockets.
REM    - Prints one line per kill so port-cleanup is observable in the console.
REM    - Exits 0 when clean (incl. nothing to do) or 1 if a holder cannot be
REM      stopped (e.g. SYSTEM-owned); the bat surfaces a warning below.
REM  Manual fallback if you want to debug the kill step itself:
REM      powershell.exe -ExecutionPolicy Bypass -NoProfile ^
REM        -File "%~dp0free-dev-port.ps1" -Port 1420
REM  (%~dp0 IS scripts\ now, so there is no `scripts\` prefix on the suffix --
REM  adding one doubles the directory and the -File argument resolves to a path
REM  inside scripts\scripts\, which does not exist.)
REM
REM  PREVIOUS-INSTANCE HANDLING (auto on every startup, Windows only):
REM  scripts\stop-desktop-instances.ps1 kills `kasirmu-app.exe` /
REM  `kasirmu-mobile.exe` and then WAITS until the locks they held are actually
REM  free -- polling, not sleeping a fixed guess. See the comment at the call
REM  site below for why the wait, not the kill, is the half that decides
REM  whether the next launch works.
REM ============================================================================
setlocal

REM cd /d into the desktop-tauri crate so cargo finds Cargo.toml.
REM `%~dp0` is this bat's own directory (scripts\); `..\apps\desktop-tauri` is relative
REM to that, which keeps the bat independent of its invocation CWD.
cd /d "%~dp0..\apps\desktop-tauri"

REM Auto-clear any stale dev process bound to the Vite port (default 1420).
REM The .ps1 prints [OK]/[WARN]/[FAIL] lines per holder so this is visible.
echo Checking for stale dev processes on port 1420...
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0free-dev-port.ps1" -Port 1420
if errorlevel 1 (
    echo [WARNING] Could not cleanly free port 1420. Tauri may fail to start.
)
REM Stop the complete app process tree, not just the Rust parent. WebView2 keeps
REM renderer/GPU utility children alive after `taskkill /IM` alone; they retain the
REM EBWebView profile lock and the replacement fails with HRESULT 0x800700AA.
REM
REM The WAIT is the load-bearing half, and scripts\stop-desktop-instances.ps1
REM owns it: `taskkill /F /T` returns as soon as the processes die, but Windows
REM releases what they held -- the memory-mapped SQLite -shm sidecar and the
REM EBWebView profile lock -- LAZILY, measurably later. Launching straight into
REM that window is what produced HRESULT 0x800700AA and "unable to open
REM database file" from the setup hook on 2026-09-28. A fixed `timeout /t 3`
REM was the first fix and is only a guess; the script VERIFIES instead:
REM it polls until no kasir.mu process and no own WebView2 child remain,
REM attributing WebView2 children by the `mu.kasir.app` marker in their
REM --user-data-dir so it never touches Windows Search's. It exits 0 as soon
REM as the locks are free -- including when nothing was running, so a clean
REM start pays nothing -- and 1 only at its deadline, which is what the
REM warning below reports. Do NOT reintroduce a bare `taskkill` here: the
REM wait is what makes the next launch work.
echo Stopping any previous kasir.mu instance and waiting for its locks...
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0stop-desktop-instances.ps1"
if errorlevel 1 (
    echo [WARNING] A previous instance may still hold the database or WebView2 lock.
    echo           Launching anyway; the app now retries the database open itself.
)

REM Sync connectivity: the debug build auto-provisions a connection to the
REM cloud server (https://license.kasir.mu). The health endpoint check
REM below just confirms the cloud is reachable before launching — a warning
REM here means the cloud server is unreachable but the app will still start
REM and show a red sync indicator until connectivity is restored.
echo Checking cloud sync backend on https://license.kasir.mu...
curl -s -m 3 -o nul https://license.kasir.mu/api/health >nul 2>&1
if errorlevel 1 (
    echo [WARNING] Cloud sync backend NOT reachable at https://license.kasir.mu.
    echo           The app will start, but sync will be unavailable.
) else (
    echo [OK] Cloud sync backend reachable at https://license.kasir.mu
)

cargo tauri dev

REM Keep the window open so any startup error from the line above
REM stays readable instead of scrolling off into a closed console.
pause

endlocal
