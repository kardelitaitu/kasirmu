#!/usr/bin/env bash
# scripts/android-preflight.sh
#
# Preflight guard for the Android tablet build (apps/mobile-tauri). Fails fast,
# with the exact remediation, on the environment traps documented in
# apps/mobile-tauri/AGENTS.md and .agents/skills/android-apk-build/SKILL.md:
#
#   1. PATHEXT unset in Git Bash          -> tauri CLI dies in ~2 s
#   2. Gradle JVM not JDK 21              -> buildSrc config dies on the
#      (Android Studio's JBR tracks        `JavaVersion.parse` of the raw
#      the newest JDK, measured 25.0.3)    version string
#   3. ANDROID_HOME / ANDROID_NDK_HOME unset or missing
#   4. aarch64-linux-android rust target missing; cargo-ndk absent
#   5. CARGO_BUILD_JOBS capped (user scope or process) -> ~10x slower builds
#   6. shared %TEMP% in use               -> WebSocket RPC race between
#      concurrent `cargo tauri android` invocations (advisory)
#
# Precedence note (matches Gradle): `org.gradle.java.home` in
# ~/.gradle/gradle.properties WINS over JAVA_HOME. The check therefore
# validates the pin when present and only falls back to JAVA_HOME when the
# pin is absent; a wrong JAVA_HOME with a valid pin is a warning, not a
# failure, because Gradle never sees it.
#
# Usage (Git Bash on Windows — never WSL):
#   bash scripts/android-preflight.sh
#   or from PowerShell:
#   & 'C:\Program Files\Git\bin\bash.exe' -c 'bash scripts/android-preflight.sh'
#
# Exit codes: 0 = all fatal checks passed (warnings may exist), 1 = fatal.
set -o pipefail

FAILED=0

fail() { printf 'FAIL: %s\n\n' "$*"; FAILED=1; }
warn() { printf 'WARN: %s\n' "$*"; }
ok()   { printf 'ok:   %s\n' "$*"; }
note() { printf 'note: %s\n' "$*"; }

# Normalize a Windows path for use inside Git Bash (no-op elsewhere).
to_unix() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

# java_major <java-home>  -> prints the major version ("21") or "" if the
# home does not contain a runnable java. Reads stderr on purpose: java
# -version reports its version there.
java_major() {
  local home cand
  home="$(to_unix "$1")"
  for cand in "$home/bin/java" "$home/bin/java.exe"; do
    if [ -e "$cand" ]; then
      local out v
      out="$("$cand" -version 2>&1)" || { printf ''; return; }
      v="$(printf '%s\n' "$out" | sed -n 's/.*version "\([0-9][0-9]*\)\..*/\1/p' | head -n 1)"
      printf '%s' "$v"
      return
    fi
  done
  printf ''
}

printf '== Android build preflight ==\n\n'

# ── 1. PATHEXT (Git Bash only; MSYSTEM is set under Git Bash, absent elsewhere) ─
if [ -n "${MSYSTEM:-}" ] && [ -z "${PATHEXT:-}" ]; then
  fail "PATHEXT is unset — 'cargo tauri android' dies in ~2 s with 'The PATHEXT environment variable isn't set'.
      Fix: export PATHEXT='.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC'"
else
  ok "PATHEXT is set"
fi

# ── 2. Effective Gradle JVM must be JDK 21 ─────────────────────────────────────
GRADLE_PROPS="${HOME}/.gradle/gradle.properties"
PIN=""
if [ -f "$GRADLE_PROPS" ]; then
  # Accepts both `key=value` and `key value`, strips CR and surrounding quotes.
  PIN="$(sed -n 's/^[[:space:]]*org\.gradle\.java\.home[[:space:]]*[=][[:space:]]*\(.*\)$/\1/p' "$GRADLE_PROPS" \
    | head -n 1 | tr -d '\r' | sed 's/^"\(.*\)"$/\1/')"
fi

JH_MAJ=""
if [ -n "$PIN" ]; then
  JH_MAJ="$(java_major "$PIN")"
  if [ "$JH_MAJ" = "21" ]; then
    ok "org.gradle.java.home pin -> JDK $JH_MAJ ($PIN)"
  else
    fail "org.gradle.java.home in $GRADLE_PROPS does not point at a runnable JDK 21 (got '${JH_MAJ:-nothing}' at $PIN).
      Fix: set it to the JDK 21 path, e.g. org.gradle.java.home=C:/Users/<you>/AppData/Local/Programs/Java/jdk-21.0.12.1+1"
  fi
  # With a valid pin Gradle ignores JAVA_HOME, but the stale value still misleads
  # tooling that reads it directly (and every human who trusts it) — warn only.
  if [ -n "${JAVA_HOME:-}" ]; then
    JH_MAJ="$(java_major "$JAVA_HOME")"
    if [ "$JH_MAJ" != "21" ]; then
      warn "JAVA_HOME points at a non-21 JVM (major='${JH_MAJ:-missing}': $JAVA_HOME). The gradle.properties pin wins for Gradle, but fix the user-scope JAVA_HOME (HKCU\\Environment) and reopen the terminal — never Android Studio's JBR, which measured 25.0.3."
    else
      ok "JAVA_HOME -> JDK $JH_MAJ"
    fi
  fi
else
  if [ -z "${JAVA_HOME:-}" ]; then
    fail "JAVA_HOME is unset and no org.gradle.java.home pin exists in $GRADLE_PROPS.
      Fix: setx JAVA_HOME 'C:\\Users\\<you>\\AppData\\Local\\Programs\\Java\\jdk-21.0.12.1+1' (user scope), then open a new terminal.
      Durable alternative: add org.gradle.java.home=<jdk-21 path> to $GRADLE_PROPS — it takes precedence over JAVA_HOME."
  else
    JH_MAJ="$(java_major "$JAVA_HOME")"
    if [ "$JH_MAJ" = "21" ]; then
      ok "JAVA_HOME -> JDK $JH_MAJ ($JAVA_HOME)"
    else
      fail "JAVA_HOME is not a JDK 21 (major='${JH_MAJ:-missing}': $JAVA_HOME). Android Studio's bundled JBR tracks the newest JDK and breaks Gradle configuration ('> 25.0.3' during ':buildSrc').
      Fix: setx JAVA_HOME '<jdk-21 path>' (user scope), open a new terminal, or pin org.gradle.java.home in $GRADLE_PROPS."
    fi
  fi
fi

# ── 3. Android SDK / NDK ───────────────────────────────────────────────────────
if [ -z "${ANDROID_HOME:-}" ]; then
  fail "ANDROID_HOME is unset.
      Fix: setx ANDROID_HOME 'C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk' (user scope), then open a new terminal."
elif [ ! -d "$(to_unix "$ANDROID_HOME")" ]; then
  fail "ANDROID_HOME points at a missing directory: $ANDROID_HOME"
else
  ok "ANDROID_HOME -> $ANDROID_HOME"
fi

if [ -z "${ANDROID_NDK_HOME:-}" ]; then
  fail "ANDROID_NDK_HOME is unset (expected e.g. <SDK>\\ndk\\30.0.14904198).
      Fix: setx ANDROID_NDK_HOME '<SDK>\\ndk\\30.0.14904198' (user scope), then open a new terminal."
elif [ ! -d "$(to_unix "$ANDROID_NDK_HOME")" ]; then
  fail "ANDROID_NDK_HOME points at a missing directory: $ANDROID_NDK_HOME"
else
  ok "ANDROID_NDK_HOME -> $ANDROID_NDK_HOME"
fi

# ── 4. Rust cross-compile prerequisites ────────────────────────────────────────
if command -v rustup >/dev/null 2>&1; then
  if rustup target list --installed 2>/dev/null | grep -q '^aarch64-linux-android$'; then
    ok "rust target aarch64-linux-android installed"
  else
    fail "rust target aarch64-linux-android is missing.
      Fix: rustup target add aarch64-linux-android"
  fi
else
  warn "rustup not found on PATH — cannot verify the aarch64-linux-android target."
fi
if command -v cargo-ndk >/dev/null 2>&1; then
  ok "cargo-ndk found"
else
  warn "cargo-ndk not found on PATH.
      Fix: cargo install cargo-ndk"
fi

# ── 5. CARGO_BUILD_JOBS cap (process scope, then user scope) ───────────────────
CBJ_SRC=""
if [ -n "${CARGO_BUILD_JOBS:-}" ]; then
  CBJ_SRC="process environment"
elif command -v reg.exe >/dev/null 2>&1 \
  && reg.exe query "HKCU\\Environment" /v CARGO_BUILD_JOBS >/dev/null 2>&1; then
  CBJ_SRC="user scope (HKCU\\Environment)"
fi
if [ -n "$CBJ_SRC" ]; then
  warn "CARGO_BUILD_JOBS is set in the $CBJ_SRC — it silently caps cargo parallelism (~10x slower cross-compile on a many-thread CPU).
      Fix (user scope): [Environment]::SetEnvironmentVariable('CARGO_BUILD_JOBS',\$null,'User'), then open a new terminal.
      Check: [Environment]::GetEnvironmentVariable('CARGO_BUILD_JOBS','User')   # expect nothing"
else
  ok "CARGO_BUILD_JOBS not capped"
fi

# ── 6. Shared %TEMP% — WebSocket RPC race between concurrent tauri CLI runs ────
case "$(to_unix "${TMP:-${TEMP:-}}")" in
  */AppData/Local/Temp|*/AppData/Local/Temp/)
    note "TMP/TEMP is the host-shared temp dir — two concurrent 'cargo tauri android' runs clobber each other's <identifier>-server-addr file and :app:rustBuild* panics with 'failed to read CLI options / ConnectionRefused'.
      Fix for the second run: export TMP=/tmp/tauri-cli-\$\$ TEMP=\$TMP TMPDIR=\$TMP"
    ;;
  "" ) note "TMP/TEMP unset — cargo will use its default temp resolution." ;;
  * ) ok "TMP is a per-process dir ($(to_unix "${TMP:-}"))" ;;
esac

printf '\n'
if [ "$FAILED" -ne 0 ]; then
  printf 'Preflight FAILED — fix the FAIL lines above, then re-run.\n'
  exit 1
fi
printf 'Preflight OK — environment is ready for the Android build.\n'
exit 0
