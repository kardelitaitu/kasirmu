#!/usr/bin/env bash
# scripts/report-flaky.sh — Detect flaky tests by running them multiple times
#
# Runs the test suite N times (default: 3) and reports any test that
# fails intermittently. Uses cargo-nextest for faster execution.
#
# Usage:
#   bash scripts/report-flaky.sh                    # full suite × 3
#   bash scripts/report-flaky.sh -p kasirmu-core         # single crate × 3
#   bash scripts/report-flaky.sh --runs 5           # full suite × 5
#   bash scripts/report-flaky.sh --filter test_name # pattern match
#
# Output:
#   - Per-run summary: pass/fail counts
#   - Final report: list of test names that failed in at least 1 run
#     but passed in at least 1 other (true flaky candidates)
#
# The flaky test quarantine process is documented in CONTRIBUTING.md.
#
# NOTE: JSON parsing depends on cargo-nextest's --message-format json
# schema (cargo test events with type/event/outcome fields). If the
# format changes in a future nextest version, the grep pipeline below
# may need updating.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RUNS=3
EXTRA_ARGS=()
CRATE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --runs) RUNS="$2"; shift 2 ;;
        -p) CRATE="$2"; EXTRA_ARGS+=(-p "$2"); shift 2 ;;
        --filter) EXTRA_ARGS+=(-E "$2"); shift 2 ;;
        *) EXTRA_ARGS+=("$1"); shift ;;
    esac
done

RESULTS_DIR="target/flaky-reports"
mkdir -p "$RESULTS_DIR"

echo "=== Flaky Test Detection ==="
echo "  Runs: $RUNS"
echo "  Crate: ${CRATE:-workspace}"
echo "  Report: $RESULTS_DIR/"
echo ""

declare -A test_results

for run in $(seq 1 "$RUNS"); do
    echo "--- Run $run/$RUNS ---"
    LOG="$RESULTS_DIR/run-${run}.log"

    if cargo nextest run "${EXTRA_ARGS[@]}" --message-format json 2>&1 | tee "$LOG"; then
        echo "  Run $run: PASS"
    else
        echo "  Run $run: FAIL (see $LOG)"
    fi
    echo ""
done

# Collect failing test names from each run
echo "=== Flaky Test Report ==="
echo ""
echo "Collecting per-run results..."

declare -A failed_in_run

for run in $(seq 1 "$RUNS"); do
    LOG="$RESULTS_DIR/run-${run}.log"
    if [ -f "$LOG" ]; then
        while IFS= read -r line; do
            # nextest JSON output: "name" field in "test" events with result "fail"
            if echo "$line" | grep -q '"type":"test"' && echo "$line" | grep -q '"event":"finished"' && echo "$line" | grep -q '"outcome":"fail"'; then
                test_name=$(echo "$line" | grep -o '"name":"[^"]*"' | head -1 | sed 's/"name":"//;s/"//')
                if [ -n "$test_name" ]; then
                    failed_in_run["$run|$test_name"]=1
                    test_results["$test_name"]=$(( ${test_results["$test_name"]:-0} + 1 ))
                fi
            fi
        done < "$LOG"
    fi
done

# Find tests that failed in some runs but not all (true flaky candidates)
echo "Flaky candidates (failed in at least 1 run, passed in at least 1):"
echo ""

flaky_count=0
for test_name in "${!test_results[@]}"; do
    fail_count="${test_results[$test_name]}"
    if [ "$fail_count" -gt 0 ] && [ "$fail_count" -lt "$RUNS" ]; then
        flaky_count=$((flaky_count + 1))
        echo "  [$fail_count/$RUNS fails] $test_name"
    fi
done

echo ""
if [ "$flaky_count" -eq 0 ]; then
    echo "No flaky tests detected across $RUNS runs."
else
    echo "$flaky_count flaky test(s) found."
    echo ""
    echo "Next steps (see CONTRIBUTING.md):"
    echo "  1. Tag the test with #[cfg_attr(feature = \"slow-tests\", ignore)]"
    echo "  2. Open an issue with the flaky-report label"
    echo "  3. If critical path, investigate root cause (race, shared state, timing)"
fi
