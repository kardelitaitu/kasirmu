#!/usr/bin/env bash
set -e

echo "=== Building UI dist-mobile ==="
cd /c/dev/kasirmu/ui
npm run build:mobile

echo "=== Preparing Android build environment ==="
mkdir -p /c/dev/kasirmu/.tmp-build
touch /c/dev/kasirmu/apps/mobile-tauri/src/lib.rs

export PATHEXT='.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC'
export SystemRoot='C:\WINDOWS'
export COMSPEC='C:\WINDOWS\system32\cmd.exe'
export ProgramData='C:\ProgramData'
export APPDATA='C:\Users\Dika\AppData\Roaming'
export ProgramFiles='C:\Program Files'
export JAVA_HOME='C:\Users\Dika\AppData\Local\Programs\Java\jdk-21.0.12.1+1'
export ANDROID_HOME='C:\Users\Dika\AppData\Local\Android\Sdk'
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/30.0.14904198"
export TMP='C:\dev\kasirmu\.tmp-build'
export TEMP='C:\dev\kasirmu\.tmp-build'
export TMPDIR='C:\dev\kasirmu\.tmp-build'

cd /c/dev/kasirmu/apps/mobile-tauri
LOG=/c/dev/kasirmu/.tmp-build/tauri-build.log
echo "Starting cargo tauri android build at $(date +'START %T')..."
{ date +'START %T'; pwd; } > "$LOG"
cargo tauri android build --apk --target aarch64 --features devtools -c '{"build":{"beforeBuildCommand":null}}' >> "$LOG" 2>&1 < /dev/null
EXIT_CODE=$?
echo "EXITCODE:$EXIT_CODE" >> "$LOG"
date +'END %T' >> "$LOG"
tail -n 35 "$LOG"

if [ $EXIT_CODE -ne 0 ]; then
  echo "Build failed with exit code $EXIT_CODE"
  exit $EXIT_CODE
fi

echo "=== Build succeeded! ==="
