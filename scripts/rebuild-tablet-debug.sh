# scripts/rebuild-tablet-debug.sh — rebuild the tablet debug APK with an explicit,
# in-tree TMP. Run it through Git Bash: bash scripts/rebuild-tablet-debug.sh
#
# Two things this script exists to get right, both learned the hard way:
#
#  1. TMP must resolve INSIDE the checkout. Under a restricted sandbox the spawned
#     cargo/rustc children are denied writes to the system temp dir even though the
#     calling shell can write there ("Access is denied (os error 5)"), and the same
#     rule is what scripts/check.sh's guard now enforces for the test binaries.
#     See docs/records/audits/2026-10-19-ungraded-citations-and-a-guard-that-
#     measured-the-wrong-process.md §3.
#
#  2. The MSYS/Git-Bash environment must not leak in half-set. Git Bash's defaults
#     make Tauri's Windows toolchain discovery fall over, so the Windows variables
#     below are exported explicitly. They are written down here rather than
#     re-derived per session.
#
# PREREQUISITES (checked, not assumed): Android SDK + NDK resolvable via
# ANDROID_HOME, JAVA_HOME pointing at a JDK, and ui/node_modules installed.
# The NDK is taken from the highest installed version, never a pinned number.

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
tmp_dir="$repo_root/.tmp-build"
mkdir -p "$tmp_dir"

fail() { echo "ERROR: $*" >&2; exit 1; }

# ── Prerequisites ────────────────────────────────────────────────────────────
: "${ANDROID_HOME:?ANDROID_HOME must point at the Android SDK root}"
: "${JAVA_HOME:?JAVA_HOME must point at a JDK}"
[ -d "$repo_root/ui/node_modules" ] \
  || fail "ui/node_modules is missing — run 'npm ci' in ui/ first"

ndk_root="$ANDROID_HOME/ndk"
[ -d "$ndk_root" ] || fail "no NDK under $ndk_root — install one via sdkmanager"
ndk_dir="$(ls -1 "$ndk_root" | sort -V | tail -n 1)"
export ANDROID_NDK_HOME="$ndk_root/$ndk_dir"
export NDK_HOME="$ANDROID_NDK_HOME"

# ── Git Bash environment repair ──────────────────────────────────────────────
export PATHEXT='.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC'
export SystemRoot="${SystemRoot:-C:\\WINDOWS}"
export COMSPEC="${COMSPEC:-$SystemRoot/system32/cmd.exe}"
export ProgramData="${ProgramData:-C:\\ProgramData}"
export APPDATA="${APPDATA:-$USERPROFILE/AppData/Roaming}"
export ProgramFiles="${ProgramFiles:-C:\\Program Files}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# ── In-tree TMP, for the shell AND every child process ───────────────────────
export TMP="$tmp_dir"
export TEMP="$tmp_dir"
export TMPDIR="$tmp_dir"

echo "==> Building UI dist-mobile"
( cd "$repo_root/ui" && npm run build:mobile )

# Touch lib.rs so cargo always re-runs the Tauri link step; without it a UI-only
# rebuild produces a stale APK that looks like the change did not apply.
touch "$repo_root/apps/mobile-tauri/src/lib.rs"

log="$tmp_dir/tauri-debug-build.log"
echo "==> cargo tauri android build --debug (log: $log)"
cd "$repo_root/apps/mobile-tauri"
{
  date +'START %T'
  pwd
} > "$log"

set +e
cargo tauri android build --debug --apk --target aarch64 --features devtools \
  -c '{"build":{"beforeBuildCommand":null}}' >> "$log" 2>&1 < /dev/null
exit_code=$?
set -e

echo "EXITCODE:$exit_code" >> "$log"
date +'END %T' >> "$log"
tail -n 35 "$log"

if [ "$exit_code" -ne 0 ]; then
  echo "Build failed with exit code $exit_code" >&2
  exit "$exit_code"
fi

echo "=== Build succeeded ==="
