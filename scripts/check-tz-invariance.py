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
#   Honolulu    (UTC-10)  differs while UTC < 10:00
#   Kiritimati  (UTC+14)   differs once UTC >= 10:00
# Those two windows meet exactly at 10:00 and together cover all 24 hours, so
# at least one zone always disagrees -- the check is sensitive no matter when it
# runs. Honolulu is UTC-10 with no daylight saving, so its window never moves.
# Jakarta is kept because it is the zone that actually broke PR #95, not
# because it adds coverage; at +7 it covers UTC 17:00-24:00, already inside
# Kiritimati's window. Dropping Honolulu or Kiritimati would leave the check
# passing at some hours and failing at others, which is the worst possible
# property for a regression gate.
#
# CORRECTED 2026-09-29. This comment previously claimed Los_Angeles (UTC-7)
# "differs while UTC < 17:00" and that it and Kiritimati together covered all 24
# hours. Both were wrong: a WEST zone disagrees while UTC is BELOW its offset,
# so -7 gives 00:00-07:00, not 17:00 -- the 17 came from applying the east-zone
# rule to a west zone. The real coverage was 00:00-07:00 (LA) plus 10:00-24:00
# (Kiritimati), leaving 07:00-10:00 with no disagreeing zone: for three hours
# every day this gate could not see a host-date bug. Found by the sensitivity
# self-test at the bottom of this file, which asserts the union covers all 24
# hours AND that removing either load-bearing zone opens a gap.
ZONES = ["UTC", "Asia/Jakarta", "Pacific/Honolulu", "Pacific/Kiritimati",
         "America/Los_Angeles"]

NPMX = "npm.cmd" if os.name == "nt" else "npm"

# Offsets that make the arithmetic above checkable. A fixture, not a lookup: the point
# is the SENSITIVITY WINDOW, not re-deriving offsets from the host's tzdata (which is
# absent on a bare Windows Python and would make this self-test fail for a reason that
# has nothing to do with the gate). Values are the standard offsets; the daylight-saving
# variant of Los Angeles (-8) is covered because the window for -7 already contains it.
ZONE_OFFSETS = {
    "UTC": 0,
    "Asia/Jakarta": 7,
    "Pacific/Honolulu": -10,
    "Pacific/Kiritimati": 14,
    "America/Los_Angeles": -7,
}


def diff_window(offset: int) -> tuple[float, float] | None:
    """The half-open UTC hour range in which a zone's LOCAL DATE differs from UTC's.

    Pure, and the whole reason this self-test can exist. A west zone (offset < 0) is a
    calendar day behind, so it disagrees while UTC time-of-day is below the offset; an
    east zone is a day ahead, so it disagrees once UTC reaches 24 - offset. UTC never
    disagrees, hence None. Mirrors the arithmetic written out in the ZONES comment, which
    is the part nobody re-derives when the list is edited.
    """
    if offset == 0:
        return None
    if offset < 0:
        return (0.0, float(-offset))
    return (24.0 - offset, 24.0)


def sensitivity_gap(offsets: dict[str, int]) -> list[tuple[int, int]]:
    """Hour ranges in [0,24) where NO zone disagrees with UTC.

    A non-empty gap is the failure the ZONES comment warns about: the gate would pass
    at those hours and fail at others. One hour of slack per boundary, because a zone
    disagrees only while the local date is actually rolled over -- a whole hour, not an
    instant -- and an instant boundary would be false precision.
    """
    covered = [False] * 24
    for off in offsets.values():
        w = diff_window(off)
        if w is None:
            continue
        lo, hi = w
        for h in range(24):
            if lo <= h < hi:
                covered[h] = True
    gap: list[tuple[int, int]] = []
    start = None
    for h in range(24):
        if not covered[h] and start is None:
            start = h
        elif covered[h] and start is not None:
            gap.append((start, h))
            start = None
    if start is not None:
        gap.append((start, 24))
    return gap


def self_test() -> int:
    """Liveness for the property that makes this gate a gate.

    This is a LIVE gate (dev-ci + check.sh) that runs the same vitest files under four
    host timezones and requires identical results. What makes it able to catch a
    host-dependent date bug is not the vitest invocation -- it is the arithmetic in the
    ZONES comment: a zone only disagrees with UTC during part of the day, so the chosen
    offsets must cover all twenty-four hours between them. Drop one zone and the gate
    still RUNS, still passes, and simply stops noticing host dependence for part of
    every day. Nothing else in the file can see that, and no bare run of the gate can
    either -- the failure is in the choice of constants, not in the check.

    Cases are therefore about SENSITIVITY, not about the test runner: the full set must
    leave no gap, and removing either load-bearing zone must open one. Those two are the
    proof the cases would catch the trim the comment forbids.

    Pure: no file is written, no subprocess is started, and the module-level vitest run
    below is never reached -- this function is called from the dispatch above it.
    """
    bad: list[str] = []

    def want(name: str, got, expect) -> None:
        if got != expect:
            bad.append(f"{name}: expected {expect!r}, got {got!r}")

    want("west zone disagrees early in the UTC day",
         diff_window(-7), (0.0, 7.0))
    want("east zone disagrees late in the UTC day",
         diff_window(14), (10.0, 24.0))
    want("UTC never disagrees", diff_window(0), None)

    # The real set covers every hour, which is the whole claim in the comment.
    want("the shipped zones cover all 24 hours",
         sensitivity_gap(ZONE_OFFSETS), [])

    # Each SENSITIVITY-bearing zone is load-bearing: removing it opens a gap, which is
    # the case that fires if someone trims ZONES. Honolulu and Kiritimati are the two
    # that carry the property.
    without_hon = {k: v for k, v in ZONE_OFFSETS.items() if k != "Pacific/Honolulu"}
    without_kir = {k: v for k, v in ZONE_OFFSETS.items() if k != "Pacific/Kiritimati"}
    want("dropping Honolulu opens a gap", sensitivity_gap(without_hon) != [], True)
    want("dropping Kiritimati opens a gap", sensitivity_gap(without_kir) != [], True)

    # Los Angeles is REDUNDANT for sensitivity: Honolulu covers 00:00-10:00 and
    # Kiritimati 10:00-24:00 on their own, so dropping LA leaves the property intact.
    # Asserted rather than assumed, because the pre-fix list claimed LA was one of the
    # two windows the whole property rested on and it was not. It stays in ZONES for
    # real-world coverage (a zone developers actually run in, and the only one that
    # crosses a daylight-saving boundary), not because the arithmetic needs it.
    without_la = {k: v for k, v in ZONE_OFFSETS.items() if k != "America/Los_Angeles"}
    want("Los Angeles is redundant for sensitivity", sensitivity_gap(without_la), [])

    # And the gate's own ZONES list must be exactly what the fixture describes, so
    # editing ZONES without updating the arithmetic is caught rather than assumed.
    want("ZONES and the offset fixture agree",
         sorted(ZONES), sorted(ZONE_OFFSETS))
    for z in ZONES:
        if z not in ZONE_OFFSETS:
            bad.append(f"zone {z!r} has no entry in ZONE_OFFSETS")

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (8 cases, no files touched, vitest never run)")
    return 0


# Dispatch ABOVE the module-level vitest run further down this file. Placing it there
# rather than at the bottom is the whole reason --self-test is safe here: every other
# checker dispatches from main(), and this file has no main(), because its four vitest
# invocations execute on import.
if "--self-test" in sys.argv:
    sys.exit(self_test())

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
