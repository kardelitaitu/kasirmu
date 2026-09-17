#!/usr/bin/env bash
# scripts/test-tdd.sh — Fast TDD loop: compile+test the current crate only
#
# Uses the `[profile.tdd]` from workspace Cargo.toml which inherits from
# `dev` but sets `debug = false` and `incremental = true` for the fastest
# possible edit-compile-test cycle.
#
# Usage:
#   bash scripts/test-tdd.sh                     # auto-detect crate from cwd (nextest)
#   bash scripts/test-tdd.sh -p crates/kasirmu-core   # specific crate (a DIRECTORY, not a package name)
#   bash scripts/test-tdd.sh --vanilla           # use cargo test instead of nextest
#   bash scripts/test-tdd.sh --watch             # watch mode (needs cargo-watch)
#
# Environment:
#   CARGO=/path/to/cargo   override toolchain detection entirely
#
# Recommended for local TDD workflow:
#   $ cd crates/kasirmu-core
#   $ bash scripts/test-tdd.sh --watch

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

export CARGO_PROFILE=tdd

# ── Toolchain resolution ─────────────────────────────────────────────────────
#
# Bare `cargo` is not enough in this repo. The same workspace is driven
# from PowerShell, from Git Bash (where .githooks/pre-commit runs) and
# from WSL bash, and each sees a different PATH. This script used to call
# `cargo` directly and died with `exec: cargo: not found` under WSL bash.
#
# The dangerous case is not the miss, it is a WRONG hit: a WSL *login*
# shell puts a native-Linux cargo on PATH (here rust 1.95.0/Linux) while
# the repo's target/ dir was built by the Windows toolchain (1.96.0).
# Using it silently rebuilds the whole workspace for another platform and
# ignores every cached artifact. So resolution is explicit and ordered,
# and a mount/toolchain mismatch is reported instead of hidden.
#
# .githooks/pre-commit solved the same problem for rustup; keep the two
# in sync if a new shell shows up.

repo_on_windows_mount() {
  case "$PROJECT_ROOT" in
    /mnt/[A-Za-z]/* | /mnt/[A-Za-z]) return 0 ;;
    *) return 1 ;;
  esac
}

find_cargo() {
  local c base cand
  if c="$(command -v cargo 2>/dev/null)"; then
    printf '%s\n' "$c"
    return 0
  fi
  # Windows rustup shims, seen from Git Bash (/c/...) or WSL (/mnt/c/...).
  for base in /c/Users/* /mnt/[A-Za-z]/Users/*; do
    for cand in "$base/.cargo/bin/cargo.exe" "$base/.cargo/bin/cargo"; do
      if [ -x "$cand" ]; then
        printf '%s\n' "$cand"
        return 0
      fi
    done
  done
  # Native rustup default (Linux/macOS dev boxes).
  if [ -x "$HOME/.cargo/bin/cargo" ]; then
    printf '%s\n' "$HOME/.cargo/bin/cargo"
    return 0
  fi
  return 1
}

if [ -n "${CARGO:-}" ]; then
  CARGO_BIN="$CARGO"
else
  CARGO_BIN="$(find_cargo || true)"
fi

if [ -z "${CARGO_BIN:-}" ]; then
  echo "test-tdd: cargo not found on PATH, in the Windows rustup dir, or in \$HOME/.cargo/bin." >&2
  echo "  Install Rust (https://rustup.rs) or set CARGO=/path/to/cargo." >&2
  exit 127
fi

cargo_targets_windows() {
  case "$1" in
    /mnt/[A-Za-z]/* | /[Cc]/* | *.exe) return 0 ;;
    *) return 1 ;;
  esac
}

if repo_on_windows_mount && ! cargo_targets_windows "$CARGO_BIN"; then
  echo "test-tdd: WARNING — repo is on a Windows mount ($PROJECT_ROOT) but the selected" >&2
  echo "          cargo is a native WSL/Linux one: $CARGO_BIN" >&2
  echo "          This rebuilds the workspace for Linux and ignores the Windows target/." >&2
  echo "          Set CARGO=/mnt/c/Users/<you>/.cargo/bin/cargo.exe to use the repo's toolchain." >&2
fi

# ── Flags ────────────────────────────────────────────────────────────────────

USE_NEXTEST=true
WATCH_MODE=false
TARGET_CRATE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p)
      if [ $# -lt 2 ] || [ -z "${2:-}" ]; then
        echo "test-tdd: -p takes a crate DIRECTORY, e.g. -p crates/kasirmu-core" >&2
        exit 1
      fi
      TARGET_CRATE="$2"
      shift 2
      ;;
    --vanilla) USE_NEXTEST=false; shift ;;
    --watch) WATCH_MODE=true; shift ;;
    -h | --help)
      sed -n '2,20p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "test-tdd: unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

# ── Crate selection ──────────────────────────────────────────────────────────

if [ -z "$TARGET_CRATE" ]; then
  CURRENT_DIR="$(pwd)"
  DIR="$CURRENT_DIR"
  while [ "$DIR" != "$PROJECT_ROOT" ] && [ "$DIR" != "/" ]; do
    if [ -f "$DIR/Cargo.toml" ] && grep -q '^\[package\]' "$DIR/Cargo.toml" 2>/dev/null; then
      TARGET_CRATE="$DIR"
      break
    fi
    DIR="$(dirname "$DIR")"
  done

  if [ -z "$TARGET_CRATE" ]; then
    echo "test-tdd: could not auto-detect a crate from $CURRENT_DIR" >&2
    echo "  Specify one with: bash scripts/test-tdd.sh -p crates/kasirmu-core" >&2
    echo "  (-p takes a directory path, not a package name)" >&2
    exit 1
  fi
fi

MANIFEST="$TARGET_CRATE/Cargo.toml"
if [ ! -f "$MANIFEST" ]; then
  echo "test-tdd: no Cargo.toml at $TARGET_CRATE/" >&2
  echo "  -p takes a crate DIRECTORY (crates/kasirmu-core, platform/sync), not a package name (oz-core)." >&2
  exit 1
fi

# ── Subcommand availability ──────────────────────────────────────────────────

if [ "$USE_NEXTEST" = "true" ] && ! "$CARGO_BIN" nextest --version >/dev/null 2>&1; then
  echo "test-tdd: cargo-nextest is not installed for $CARGO_BIN — falling back to cargo test"
  echo "          (install with: cargo install cargo-nextest --locked)"
  USE_NEXTEST=false
fi

if [ "$WATCH_MODE" = "true" ] && ! "$CARGO_BIN" watch --version >/dev/null 2>&1; then
  echo "test-tdd: --watch needs cargo-watch, which is not installed for $CARGO_BIN." >&2
  echo "          Install it (cargo install cargo-watch) or drop --watch." >&2
  exit 127
fi

echo "test-tdd: cargo=$CARGO_BIN"
echo "test-tdd: profile=tdd (debug=false, incremental=true)"
echo "test-tdd: crate=$TARGET_CRATE"

# ── Run ──────────────────────────────────────────────────────────────────────

if [ "$WATCH_MODE" = "true" ]; then
  echo "test-tdd: watch mode — re-running on .rs changes"
  if [ "$USE_NEXTEST" = "true" ]; then
    exec "$CARGO_BIN" watch -x "nextest run --manifest-path $MANIFEST"
  else
    exec "$CARGO_BIN" watch -x "test --manifest-path $MANIFEST"
  fi
elif [ "$USE_NEXTEST" = "true" ]; then
  exec "$CARGO_BIN" nextest run --manifest-path "$MANIFEST"
else
  exec "$CARGO_BIN" test --manifest-path "$MANIFEST"
fi
