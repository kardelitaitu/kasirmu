"""Prove the R36-01 fix by running the anchor test under several host timezones.

Node resolves the process zone from TZ at startup, so a single vitest run can
never demonstrate host-independence -- the assertion that looks green on a UTC
runner is exactly the one that was red on a UTC+7 workstation. This runs the
same file under each zone and requires identical results.

Before the fix this script fails: isoToday(null) used the device calendar, so
TZ=Asia/Jakarta and TZ=Pacific/Kiritimati disagree with TZ=UTC near day
boundaries. That is the regression being pinned.
"""
from __future__ import annotations

import io
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "ui"
# R36-01's pure anchor test, plus R36-05's component-level one: the dashboard
# renders its default range into <input type=date>, so asserting on the DOM is
# the only way to prove the whole plumbing (fetch -> state -> re-seed -> render)
# is host-independent, not just the helper in isolation.
TESTS = [
    "src/__tests__/analyticsTimezoneAnchor.test.ts",
    "src/__tests__/DashboardScreen.test.tsx",
    "src/__tests__/SalesReportScreen.test.tsx",
    "src/__tests__/CustomReportScreen.test.tsx",
    "src/__tests__/MenuEngineeringScreen.test.tsx",
    # Added in 0.0.37. AnalyticsScreen is the screen R36-01 was originally about,
    # and it was the one anchoring screen with no component-level test: its store
    # fetch hit real invoke, rejected, and storeTz silently stayed null, so only
    # the UTC fallback was ever exercised across 2000 lines of tests. Registering
    # it here is what makes the new test mean anything -- a file that is never
    # replayed under another zone cannot demonstrate host-independence.
    "src/__tests__/AnalyticsScreen.test.tsx",
]

# Chosen to straddle the date line and both sides of UTC, and to include the
# zone that broke PR #95. Kiritimati is UTC+14 -- the largest offset that can
# put the local calendar a full day ahead of UTC.
#
# DO NOT TRIM THIS LIST WITHOUT REDOING THIS ARITHMETIC. A given zone only
# disagrees with UTC during part of the day: local date differs from the UTC
# date when UTC-time-of-day is below |offset| for west zones, and at or above
# 24-|offset| for east zones. So:
#   Los_Angeles (UTC-7/-8) differs while UTC < 17:00 (16:00 in winter)
#   Kiritimati  (UTC+14)   differs once UTC >= 10:00
# Those two windows overlap and together cover all 24 hours, so at least one
# zone always disagrees -- the check is sensitive no matter when it runs.
# Jakarta is kept because it is the zone that actually broke PR #95, not
# because it adds coverage. Dropping both LA and Kiritimati would leave the
# check passing at some hours and failing at others, which is the worst
# possible property for a regression gate.
ZONES = ["UTC", "Asia/Jakarta", "Pacific/Kiritimati", "America/Los_Angeles"]

NPMX = "npm.cmd" if os.name == "nt" else "npm"

from concurrent.futures import ThreadPoolExecutor

results: dict[str, str] = {}
failed = False

def check_zone(tz: str) -> tuple[str, str, bool]:
    env = {**os.environ, "TZ": tz}
    r = subprocess.run(
        [NPMX, "exec", "--silent", "--", "vitest", "run", *TESTS, "--reporter=json"],
        cwd=UI, env=env, capture_output=True, text=True,
    )
    out = r.stdout
    start = out.find("{")
    end = out.rfind("}")
    summary = "PARSE-ERROR"
    zone_failed = False
    if start != -1 and end > start:
        import json
        try:
            data = json.loads(out[start:end + 1])
            passed = data.get("numPassedTests", 0)
            broken = data.get("numFailedTests", 0)
            summary = f"{passed} passed, {broken} failed"
            if broken:
                zone_failed = True
                for res in data.get("testResults", []):
                    for a in res.get("assertionResults", []):
                        if a.get("status") == "failed":
                            summary += " | FAIL: " + a.get("title", "?")[:60]
        except Exception as exc:  # noqa: BLE001
            summary = f"PARSE-ERROR ({exc})"
            zone_failed = True
    else:
        zone_failed = True
        summary = f"NO JSON (exit {r.returncode}) :: " + (r.stderr or out)[-200:]
    return (tz, summary, zone_failed)

is_ci = os.environ.get("CI") is not None
max_concurrency = 1 if is_ci else 2

print(f"=== timezone invariance ({len(TESTS)} file(s) x {len(ZONES)} zones, concurrency={max_concurrency}) ===")
with ThreadPoolExecutor(max_workers=max_concurrency) as pool:
    for tz, summary, zone_failed in pool.map(check_zone, ZONES):
        results[tz] = summary
        if zone_failed:
            failed = True
        print(f"  TZ={tz:22s} {summary}")



print()
distinct = set(results.values())
if len(distinct) == 1 and not failed:
    print(f"PASS: identical result under {len(ZONES)} host zones -> {distinct.pop()}")
    sys.exit(0)

# Two different findings used to print the same headline, and only one of them is
# about the host zone. If every zone failed IDENTICALLY, the zone cannot be the
# variable: the same cases failed under UTC+14, UTC-7, UTC+7 and UTC. That is an
# ordinary red (or a run that did not finish), and calling it timezone dependence
# sends the next reader after a bug that is not there.
#
# Measured 2026-09-20, in a checkout where several lanes commit every few minutes.
# This tool printed "194 passed, 51 failed" in all four zones at once and the
# headline named the host timezone. The truth was a neighbour's in-flight file:
# `ui/src/__tests__/SalesReportScreen.test.tsx` was being edited in the same
# working tree. The failing run finished at ~13:12:05, that file's next write
# landed at 13:12:26, and the identical suite passed 51/51 at 13:12:48 -- so the
# failing window is exactly the peer's broken intermediate, and the file has been
# dirty ever since. Eleven later runs of these six files returned 245 passed /
# 0 failed in every zone, and four back-to-back concurrent-pair experiments (two
# zones in parallel, which is exactly what the local concurrency=2 path does)
# reproduced nothing -- so the parallelism is not the cause either. Zone
# dependence is the DISAGREEMENT between zones, which is what `distinct` measures;
# that is the case this gate exists for.
if len(distinct) > 1:
    print("FAIL: the anchored range depends on the host timezone.")
else:
    print("FAIL: every zone failed IDENTICALLY, so the host timezone is not the variable.")
    print("      This is a red run, but not the regression this gate exists to catch: read the")
    print("      failures below as an ordinary test failure, or as a run that did not complete.")
    print("      Only DIFFERING results across zones indicate timezone dependence.")
for tz, s in results.items():
    print(f"  {tz:22s} {s}")
sys.exit(1)
