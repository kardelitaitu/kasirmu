#!/usr/bin/env bash
# scripts/coverage.sh — generate Rust + UI coverage reports in coverage/.
#
# Outputs (relative to workspace root):
#   coverage/rust/index.html   # cargo-llvm-cov HTML report
#   coverage/rust/coverage.json
#   coverage/rust/lcov.info
#   coverage/ui/index.html     # vitest v8 HTML report
#   coverage/ui/coverage-final.json
#   coverage/ui/lcov.info
#
# Usage:
#   bash scripts/coverage.sh           # both Rust + UI
#   bash scripts/coverage.sh rust      # Rust only
#   bash scripts/coverage.sh ui        # UI only
#
# Requirements:
#   rust: cargo install cargo-llvm-cov
#         # On Debian/Ubuntu: apt install llvm-tools (for llvm-cov + llvm-profdata)
#         # On macOS:        brew install llvm  (then add to PATH: export PATH="$(brew --prefix llvm)/bin:$PATH")
#         # On Windows:      choco install llvm  (llvm-cov ships in the llvm package)
#   ui:   npm ci --no-audit --no-fund --ignore-scripts (handled by the test:coverage npm script)
#
# Why llvm-cov and not tarpaulin:
#   - tarpaulin is Linux-only (uses ptrace); llvm-cov works on every OS the project targets.
#   - llvm-cov uses LLVM source-based instrumentation; wider and more accurate than tarpaulin.
#   - The .tarpaulin.toml file is kept for Linux-only quick runs.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

target="${1:-all}"

step() {
    printf '\n\033[1;34m▶ %s\033[0m\n' "$1"
}

err() {
    printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2
}

# Track hard-failures across both targets so callers see the full picture.
ERRORS=()

# ── Rust coverage ───────────────────────────────────────────────────────
if [[ "$target" == "all" || "$target" == "rust" ]]; then
    step "Rust coverage via cargo-llvm-cov → coverage/rust/"
    if ! command -v cargo-llvm-cov >/dev/null 2>&1; then
        err "cargo-llvm-cov not installed. Install with: cargo install cargo-llvm-cov"
        err "On Linux you also need llvm-tools: apt install llvm-tools (or equivalent)."
        ERRORS+=("rust: cargo-llvm-cov missing")
    elif ! command -v llvm-cov >/dev/null 2>&1 && ! command -v llvm-cov-14 >/dev/null 2>&1 && ! command -v llvm-cov-15 >/dev/null 2>&1 && ! command -v llvm-cov-16 >/dev/null 2>&1; then
        err "llvm-cov (or versioned llvm-cov-NN) not on PATH. Install with:"
        err "  Debian/Ubuntu: apt install llvm-tools"
        err "  macOS:        brew install llvm && export PATH=\"\$(brew --prefix llvm)/bin:\$PATH\""
        err "  Windows:      choco install llvm"
        ERRORS+=("rust: llvm-cov missing")
    else
        mkdir -p coverage/rust
        # Trim coverage scope to the library + test code in the same way the
        # CI `rust` job does. `cargo-llvm-cov` 0.8.x rejects combining
        # `--html`/`--text`/`--json` flags, so we add `--text` separately
        # (uses stdout, no extra output file). The HTML report is the
        # implicit default when `--output-dir` is set.
        cargo llvm-cov \
            --workspace \
            --all-features \
            --exclude kasirmu-app \
            --exclude kasirmu-mobile \
            --text \
            --output-dir "$ROOT/coverage/rust"
        step "rust done → coverage/rust/index.html (text summary above)"
    fi
fi

# ── UI coverage ──────────────────────────────────────────────────────────
if [[ "$target" == "all" || "$target" == "ui" ]]; then
    step "UI coverage via vitest → coverage/ui/"
    if [[ ! -d ui/node_modules ]]; then
        err "ui/node_modules missing. Run: cd ui && npm ci --no-audit --no-fund --ignore-scripts"
        ERRORS+=("ui: ui/node_modules missing")
    elif [[ ! -f ui/node_modules/.bin/vitest ]]; then
        err "ui/node_modules/.bin/vitest missing. Run: cd ui && npm ci --no-audit --no-fund --ignore-scripts"
        ERRORS+=("ui: vitest not installed")
    else
        (cd ui && npm run test:coverage)
        step "ui done → coverage/ui/index.html"
    fi
fi

# ── Summary ──────────────────────────────────────────────────────────────
step "coverage report: $ROOT/coverage/{rust,ui}/index.html"

if (( ${#ERRORS[@]} > 0 )); then
    err "coverage failed:"
    for e in "${ERRORS[@]}"; do
        err "  - $e"
    done
    exit 1
fi
