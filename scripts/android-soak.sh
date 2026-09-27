#!/usr/bin/env bash
# scripts/android-soak.sh
#
# R5 (todo-android-4gb-optimization-audit.md §3): the soak leg, as a script.
#
# Samples the tablet app's resident set over adb across a background/doze cycle
# and reports min / mean / max. Fails only when a threshold is given and a
# sample exceeds it.
#
# WHY THE THRESHOLD IS OPT-IN. §5.2 of the audit: "The soak gate (R5) fails
# closed on a flaky adb sample. It needs a generous threshold plus a recorded
# baseline, or it will be disabled by the first person it blocks. A gate that
# gets disabled is worse than no gate, because it reads as coverage." §5.3 adds
# that it "needs a recorded baseline before it can fail meaningfully". So the
# default mode is BASELINE: sample, report, exit 0. Enforcement is `--max-rss-mb`.
# Run it once with no threshold, read the max, then set the threshold above it.
#
# WHY IT MEASURES THE DOZE CYCLE, NOT SCREEN-ON. §6 retired the 8-hour screen-on
# idle test for two reasons that still hold: the Android 15 dataSync window caps
# a foreground service at 6h per 24h, and keeping the screen awake removes the
# very condition the Low Memory Killer test claims to measure. This script
# instead forces device idle (`dumpsys deviceidle force-idle`), which is the
# scenario a real idle cashier station hits.
#
# WHY THIS IS NOT WIRED INTO .github/workflows/android.yml (YET). That workflow
# compiles an APK and asserts one exists. It has NO device and NO emulator step,
# and its own header records that it has never been run at all. Adding a 30-60
# minute leg that needs a real device would add an unrunnable job to an
# unrunnable workflow. Ship the instrument first; wire the leg when a device
# runner exists and a baseline has been recorded.
#
# Usage (Git Bash on Windows — see android-preflight.sh for the env vars Tauri
# needs; this script itself only needs adb):
#   bash scripts/android-soak.sh                       # 30 min baseline run
#   bash scripts/android-soak.sh --minutes 45 --interval 30
#   bash scripts/android-soak.sh --max-rss-mb 320      # enforce
#   bash scripts/android-soak.sh --minutes 30 --out soak.csv
#
# Exit codes:
#   0 = completed; either no threshold was given, or every sample was under it
#   1 = a sample exceeded --max-rss-mb
#   2 = precondition or sampling failure (no adb, no device, app not running,
#       or a meminfo dump that could not be parsed)
set -o pipefail

PACKAGE="mu.kasir.mobile"
MINUTES=30
INTERVAL=60
MAX_MB=""
OUT=""
USE_DOZE=1

die() { printf 'FAIL: %s\n' "$*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  # Every value-taking option checks arity first: a bare `shift 2` on a
  # trailing `--minutes` fails, leaves $# unchanged, and spins forever.
  case "$1" in
    --package)    [ $# -ge 2 ] || die "--package needs a value"
                  PACKAGE="$2";   shift 2 ;;
    --minutes)    [ $# -ge 2 ] || die "--minutes needs a value"
                  MINUTES="$2";   shift 2 ;;
    --interval)   [ $# -ge 2 ] || die "--interval needs a value"
                  INTERVAL="$2";  shift 2 ;;
    --max-rss-mb) [ $# -ge 2 ] || die "--max-rss-mb needs a value"
                  MAX_MB="$2";    shift 2 ;;
    --out)        [ $# -ge 2 ] || die "--out needs a value"
                  OUT="$2";       shift 2 ;;
    --no-doze)    USE_DOZE=0;     shift ;;
    -h|--help)    sed -n '2,40p' "$0"; exit 0 ;;
    *)            die "unknown option: $1 (try --help)" ;;
  esac
done

# Validate each on its own: a single combined pattern like `*[!0-9]*:*[!0-9]*`
# only fires when BOTH halves are bad, so `--minutes abc` fell through to the
# arithmetic test and leaked `[: abc: integer expected` before its own message.
for v in "$MINUTES" "$INTERVAL"; do
  case "$v" in ''|*[!0-9]*) die "--minutes and --interval must be positive integers" ;; esac
done
[ "$MINUTES" -gt 0 ] || die "--minutes must be > 0"
[ "$INTERVAL" -gt 0 ] || die "--interval must be > 0"
if [ -n "$MAX_MB" ]; then
  case "$MAX_MB" in ''|*[!0-9]*) die "--max-rss-mb must be a positive integer" ;; esac
  [ "$MAX_MB" -gt 0 ] || die "--max-rss-mb must be > 0"
fi

# ── Preconditions ───────────────────────────────────────────────────────
command -v adb >/dev/null 2>&1 || die "adb is not on PATH"

DEVICES="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
COUNT="$(printf '%s\n' "$DEVICES" | grep -c .)"
[ "$COUNT" -eq 1 ] || die "expected exactly one adb device, found $COUNT"

PID="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
[ -n "$PID" ] || die "$PACKAGE is not running on the device — start it first"

# ── Doze: enter now, and ALWAYS leave ───────────────────────────────────
# A trap, not a closing line: a Ctrl-C or a mid-run failure must not leave the
# device pinned in idle, which is a state the next person inherits silently.
if [ "$USE_DOZE" -eq 1 ]; then
  adb shell dumpsys deviceidle force-idle >/dev/null 2>&1
  RESTORE="adb shell dumpsys deviceidle unforce >/dev/null 2>&1"
  trap 'eval "$RESTORE"' EXIT INT TERM
fi

# ── Sampling ────────────────────────────────────────────────────────────
# `dumpsys meminfo` reports PSS on every API level and RSS on newer ones. RSS
# is what §3 asks for, so prefer it, but never silently substitute: the metric
# actually parsed is printed with every run.
extract_kb() {
  local out="$1" v
  v="$(printf '%s\n' "$out" | grep -oE 'TOTAL[[:space:]]+RSS:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' | tail -n1)"
  if [ -n "$v" ]; then printf 'RSS %s\n' "$v"; return 0; fi
  v="$(printf '%s\n' "$out" | grep -oE 'TOTAL[[:space:]]+PSS:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' | tail -n1)"
  if [ -n "$v" ]; then printf 'PSS %s\n' "$v"; return 0; fi
  v="$(printf '%s\n' "$out" | grep -oE '^[[:space:]]*TOTAL:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' | tail -n1)"
  if [ -n "$v" ]; then printf 'TOTAL %s\n' "$v"; return 0; fi
  printf 'NONE 0\n'
}

TOTAL_SEC=$((MINUTES * 60))
SAMPLES=$((TOTAL_SEC / INTERVAL))
[ "$SAMPLES" -gt 0 ] || die "--interval is longer than the whole run"

printf 'Soak: pkg=%s pid=%s for %sm, every %ss (%s samples)%s%s\n\n' \
  "$PACKAGE" "$PID" "$MINUTES" "$INTERVAL" "$SAMPLES" \
  "$([ "$USE_DOZE" -eq 1 ] && printf ', doze forced' || printf ', doze NOT forced')" \
  "$([ -n "$MAX_MB" ] && printf ', threshold %sMB' "$MAX_MB" || printf ', BASELINE (no threshold)')"

METRIC="unknown"
SUM=0; MIN=""; MAX=""; BREACH=0; N=0
: > "${OUT:-/dev/null}"
[ -n "$OUT" ] && printf 'index,elapsed_s,metric,kb,mb\n' > "$OUT"

i=0
while [ "$i" -lt "$SAMPLES" ]; do
  DUMP="$(adb shell dumpsys meminfo "$PACKAGE" 2>/dev/null)"
  read -r M KB <<EOF
$(extract_kb "$DUMP")
EOF
  if [ "$M" = "NONE" ] || [ -z "$KB" ]; then
    # Fail loud rather than record a 0. A zero would drag the mean down and
    # read as "the app used no memory", which is worse than no sample at all.
    die "sample $((i+1)): could not parse a TOTAL RSS/PSS row from 'dumpsys meminfo $PACKAGE'"
  fi
  METRIC="$M"
  MB=$((KB / 1024))
  SUM=$((SUM + KB))
  N=$((N + 1))
  [ -z "$MIN" ] || [ "$KB" -lt "$MIN" ] && MIN=$((KB))
  [ -z "$MAX" ] || [ "$KB" -gt "$MAX" ] && MAX=$((KB))
  if [ -n "$MAX_MB" ] && [ "$MB" -gt "$MAX_MB" ]; then BREACH=$((BREACH + 1)); fi
  printf '  [%3d/%3d] %5ds  %6s KB  %5s MB\n' "$((i+1))" "$SAMPLES" "$((i * INTERVAL))" "$KB" "$MB"
  [ -n "$OUT" ] && printf '%d,%d,%s,%d,%d\n' "$((i+1))" "$((i * INTERVAL))" "$METRIC" "$KB" "$MB" >> "$OUT"
  i=$((i + 1))
  [ "$i" -lt "$SAMPLES" ] && sleep "$INTERVAL"
done

MEAN=$((SUM / N))
printf '\n-- %s over %d sample(s) --\n' "$METRIC" "$N"
printf 'min  %6s KB  %5s MB\n' "$MIN" "$((MIN / 1024))"
printf 'mean %6s KB  %5s MB\n' "$MEAN" "$((MEAN / 1024))"
printf 'max  %6s KB  %5s MB\n' "$MAX" "$((MAX / 1024))"
[ -n "$OUT" ] && printf '\nCSV: %s\n' "$OUT"

if [ -n "$MAX_MB" ]; then
  if [ "$BREACH" -gt 0 ]; then
    printf '\nSOAK FAILED: %d of %d sample(s) exceeded %s MB (max %s MB).\n' \
      "$BREACH" "$N" "$MAX_MB" "$((MAX / 1024))" >&2
    exit 1
  fi
  printf '\nSOAK PASSED: all %d sample(s) under %s MB.\n' "$N" "$MAX_MB"
else
  printf '\nBASELINE (exit 0, nothing enforced). Record this max, then re-run with\n' >&2
  printf '  --max-rss-mb <a generous value above it> to make it a gate.\n' >&2
fi
exit 0
