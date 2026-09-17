#!/usr/bin/env bash
#
# OZ-POS Flamegraph Profiling Helper (Linux/macOS)
#
# Wraps cargo-flamegraph with sane defaults for OZ-POS targets.
# Supports profiling benchmarks, binaries, and running processes by PID.
#
# Usage:
#   bash scripts/profile.sh --bench transaction_commit
#   bash scripts/profile.sh --bin oz-cloud-server
#   bash scripts/profile.sh --pid 1234 --freq 1999
#   bash scripts/profile.sh --list
#   bash scripts/profile.sh --help
#
# Flags:
#   --bench <name>    Benchmark target (e.g. transaction_commit, barcode_lookup)
#   --bin <name>      Binary package name (e.g. oz-pos-app, oz-cloud-server)
#   --pid <pid>       Attach to running process by PID (requires root/sudo)
#   --freq <hz>       Sampling frequency in Hz (default: 997)
#   --output <path>   Output SVG path (auto-named if omitted)
#   --root            Elevate via sudo for kernel-level stacks (PID profiling)
#   --list            List available benchmark targets
#   --help, -h        Show this help message
#
# Examples:
#   bash scripts/profile.sh --bench transaction_commit
#   bash scripts/profile.sh --bin oz-pos-app
#   bash scripts/profile.sh --pid 1234 --freq 1999 --root
#   bash scripts/profile.sh --list

set -euo pipefail

cd "$(dirname "$0")/.."
SCRIPT_DIR="$(dirname "$0")"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
WHITE='\033[1;37m'
GRAY='\033[0;90m'
NC='\033[0m'

# ── Parse arguments ────────────────────────────────────────────────────
BENCH=""
BINARY=""
PID=""
FREQ=997
OUTPUT=""
ROOT=false
LIST=false
HELP=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --bench)
            BENCH="$2"
            shift 2
            ;;
        --bin)
            BINARY="$2"
            shift 2
            ;;
        --pid)
            PID="$2"
            shift 2
            ;;
        --freq)
            FREQ="$2"
            shift 2
            ;;
        --output)
            OUTPUT="$2"
            shift 2
            ;;
        --root)
            ROOT=true
            shift
            ;;
        --list)
            LIST=true
            shift
            ;;
        --help|-h)
            HELP=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Run 'bash scripts/profile.sh --help' for usage."
            exit 1
            ;;
    esac
done

# ── Help / List ────────────────────────────────────────────────────────
if $HELP || [[ $# -eq 0 && -z "$BENCH" && -z "$BINARY" && -z "$PID" && $LIST == false ]]; then
    head -30 "$0" | sed 's/^# //; s/^#//; 1,2d'
    exit 0
fi

if $LIST; then
    echo -e "${CYAN}Available benchmark targets (crates/kasirmu-core/benches/):${NC}"
    for f in crates/kasirmu-core/benches/*.rs; do
        base=$(basename "$f" .rs)
        echo -e "  ${GREEN}- $base${NC}"
    done
    echo ""
    echo -e "${YELLOW}Usage: bash scripts/profile.sh --bench <name>${NC}"
    exit 0
fi

# ── Validate arguments ────────────────────────────────────────────────
if [[ -z "$BENCH" && -z "$BINARY" && -z "$PID" ]]; then
    echo -e "${RED}ERROR: Specify one of --bench, --bin, or --pid.${NC}"
    echo -e "${YELLOW}Run 'bash scripts/profile.sh --help' for usage.${NC}"
    exit 1
fi

# ── Ensure cargo-flamegraph is installed ───────────────────────────────
echo -e "${CYAN}==> Checking cargo-flamegraph...${NC}"
if ! command -v cargo-flamegraph &>/dev/null; then
    echo -e "${YELLOW}    cargo-flamegraph not found. Installing...${NC}"
    cargo install flamegraph
    echo -e "${GREEN}    cargo-flamegraph installed.${NC}"
else
    echo -e "${GREEN}    cargo-flamegraph found.${NC}"
fi

# ── Resolve output path ────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

if [[ -n "$OUTPUT" ]]; then
    OUTPUT_FILE="$OUTPUT"
elif [[ -n "$BENCH" ]]; then
    OUTPUT_FILE="flamegraph-$BENCH-$TIMESTAMP.svg"
elif [[ -n "$BINARY" ]]; then
    OUTPUT_FILE="flamegraph-$BINARY-$TIMESTAMP.svg"
elif [[ -n "$PID" ]]; then
    OUTPUT_FILE="flamegraph-pid$PID-$TIMESTAMP.svg"
else
    OUTPUT_FILE="flamegraph-$TIMESTAMP.svg"
fi

# ── Root / PID warning ─────────────────────────────────────────────────
if [[ -n "$PID" && $ROOT == false ]]; then
    echo ""
    echo -e "${YELLOW}NOTE: PID profiling on Linux requires CAP_SYS_PTRACE or root.${NC}"
    echo -e "${YELLOW}      If perf_event_open fails, re-run with --root.${NC}"
    echo ""
fi# ── Build and run command ──────────────────────────────────────────────

echo ""
echo -e "${CYAN}=============================================${NC}"
echo -e "${CYAN} OZ-POS Flamegraph Profiling${NC}"
echo -e "${CYAN}=============================================${NC}"

# Build argument array (safe — no eval)
CMD=(cargo flamegraph)

if [[ -n "$BENCH" ]]; then
    echo -e "  ${WHITE}Target:${NC}  benchmark '${BENCH}'"
    echo -e "  ${WHITE}Freq:${NC}    ${FREQ} Hz"
    echo -e "  ${WHITE}Output:${NC}  ${OUTPUT_FILE}"
    CMD+=(--bench "$BENCH")
elif [[ -n "$BINARY" ]]; then
    echo -e "  ${WHITE}Target:${NC}  binary '${BINARY}'"
    echo -e "  ${WHITE}Freq:${NC}    ${FREQ} Hz"
    echo -e "  ${WHITE}Output:${NC}  ${OUTPUT_FILE}"
    CMD+=(--bin "$BINARY")
elif [[ -n "$PID" ]]; then
    echo -e "  ${WHITE}Target:${NC}  PID ${PID}"
    echo -e "  ${WHITE}Freq:${NC}    ${FREQ} Hz"
    echo -e "  ${WHITE}Output:${NC}  ${OUTPUT_FILE}"
    CMD+=(--pid "$PID")
fi

CMD+=(--frequency "$FREQ" --output "$OUTPUT_FILE")

echo ""
if $ROOT; then
    echo -e "${GRAY}Running: sudo ${CMD[*]}${NC}"
    echo ""
    sudo "${CMD[@]}"
else
    echo -e "${GRAY}Running: ${CMD[*]}${NC}"
    echo ""
    "${CMD[@]}"
fi
EXIT_CODE=$?

# ── Check result ───────────────────────────────────────────────────────
if [[ $EXIT_CODE -eq 0 ]]; then
    echo ""
    echo -e "${GREEN}SUCCESS: Flamegraph generated:${NC}"
    echo -e "${GREEN}  ${OUTPUT_FILE}${NC}"

    if [[ -f "$OUTPUT_FILE" ]]; then
        SIZE_KB=$(du -k "$OUTPUT_FILE" | cut -f1)
        echo -e "  ${GRAY}Size: ${SIZE_KB} KB${NC}"
    fi

    echo ""
    echo -e "${CYAN}View the SVG in any browser.${NC}"
else
    echo ""
    echo -e "${RED}ERROR: Flamegraph generation failed (exit code ${EXIT_CODE}).${NC}"
    echo ""
    echo -e "${YELLOW}Common issues:${NC}"
    echo -e "${YELLOW}  - Missing debug symbols: Build with 'debug = 1' in Cargo.toml${NC}"
    echo -e "${YELLOW}  - PID profiling requires root or CAP_SYS_PTRACE${NC}"
    echo -e "${YELLOW}  - perf_event_open may be restricted in containers${NC}"
    echo -e "${YELLOW}  - Try: cargo flamegraph --help${NC}"
    exit 1
fi
