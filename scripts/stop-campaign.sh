#!/usr/bin/env bash
# Stops the running honggfuzz overnight campaign. Invoked by stop-hfuzz.bat.
#
# Signals the campaign inside WSL and waits up to 15s for its TERM trap to
# finish (the trap writes a partial report + DONE marker into
# crash_reports/), then force-kills anything still alive.
#
# The [x] bracket trick keeps pkill/pgrep from matching this script's own
# command line (and the patterns never appear verbatim here).

echo "Stopping the honggfuzz campaign..."

# TERM the campaign's inner bash ONLY (cmdline starts with
# `bash ./run_overnight.sh`). Its TERM trap kills the fuzz tree, writes
# DONE, and exits 130. Do NOT TERM the outer wrapper bash -lc at the same
# time: doing so kills the inner bash before its trap can run (verified
# empirically - pkill'ing both bashes produces no DONE, while TERM'ing the
# inner alone completes the trap in ~30ms). The outer bash exits on its own
# once the inner is gone.
pkill -TERM -f '^bash \./run_overnight\.sh' 2>/dev/null
# Belt-and-braces: make sure honggfuzz + workers die even if the trap
# missed them (they live under the space-free build dir).
pkill -f '[o]z-hfuzz-target' 2>/dev/null
pkill -x honggfuzz 2>/dev/null

i=0
# Grace period for the campaign's TERM trap to finish (honggfuzz's
# graceful shutdown with many workers + report writing can take a while).
while pgrep -f '[r]un_overnight\.sh|[o]z-hfuzz-target|honggfuzz' >/dev/null 2>&1 && [ "$i" -lt 60 ]; do
    sleep 0.5
    i=$((i + 1))
done

if pgrep -f '[r]un_overnight\.sh|[o]z-hfuzz-target|honggfuzz' >/dev/null 2>&1; then
    pkill -9 -f '[r]un_overnight\.sh' 2>/dev/null
    pkill -9 -f '[o]z-hfuzz-target' 2>/dev/null
    pkill -9 -x honggfuzz 2>/dev/null
    echo "  [WARN] force-killed after 30s grace period"
else
    echo "  [OK] campaign processes stopped inside WSL"
fi

# Fallback: if the campaign's TERM trap did not get to write DONE (e.g. it
# was force-killed), mark the newest campaign dir as interrupted ourselves.
# Note: assumes the default report root (tools/fuzz/hfuzz/crash_reports).
latest=$(ls -dt tools/fuzz/hfuzz/crash_reports/*/ 2>/dev/null | head -1)
if [ -n "$latest" ] && [ ! -f "$latest/DONE" ]; then
    {
        echo "status:   interrupted (stopped by stop-hfuzz.bat)"
        echo "finished: $(date '+%F %T %Z')"
        echo "crashes:  unknown (trap did not write SUMMARY)"
        echo
        echo "Note: the campaign was stopped externally; run"
        echo "triage_crashes.sh for whatever was captured before the stop."
    } > "$latest/DONE"
    printf '%s\n' "$latest" > tools/fuzz/hfuzz/crash_reports/LATEST
    echo "  [WARN] wrote interrupted DONE marker (campaign trap did not fire)"
fi
