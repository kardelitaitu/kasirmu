"""Prove the R36-01 fix by running the anchor test under several host timezones.

Node resolves the process zone from TZ at startup, so a single vitest run can
never demonstrate host-independence -- the assertion that looks green on a UTC
runner is exactly the one that was red on a UTC+7 workstation. This runs the
same file under each zone and requires identical results.

Before the fix this script fails: isoToday(null) used the device calendar, so
TZ=Asia/Jakarta and TZ=Pacific/Kiritimati disagree with TZ=UTC near day
boundaries. That is the regression being pinned.

WHAT IS ACTUALLY BEING PROVEN, and by what
==========================================
Running the tests under four (now five) zones proves nothing on its own. A zone only
disagrees with UTC during part of the day, so the gate is sensitive only if the chosen
offsets COVER ALL 24 HOURS between them. Trim a zone and the gate still runs, still
passes, and simply stops noticing host dependence for part of every day -- which is
why ZONES carries a comment forbidding exactly that edit, and why the arithmetic is
what --self-test checks.

  --self-test   Asserts the sensitivity arithmetic and the zone preflight. Pure: no
                file is written and no vitest is started. Dispatched ABOVE the
                module-level run at the bottom, which is why this file has no main().
  zone_probe()  Runs before the expensive loop and fails if this host does not honour
                a zone name. An unrecognised TZ does not error in Node -- it falls back
                and the run still PASSES, which would silently remove a window. Costs
                microseconds here and a whole CI job if discovered afterwards.

Corrected 2026-09-29: the ZONES comment previously mis-derived the west-zone rule and
claimed full 24-hour coverage that did not exist -- there was a 07:00-10:00 blind spot
every day. Pacific/Honolulu (UTC-10, no DST) closes it. See the ZONES comment for the
full derivation.
"""
from __future__ import annotations

import io
import os
import subprocess
import sys
import time
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
    # Added 2026-09-30 with the UTC row-date repair. This file holds the pure
    # data-layer cases: monthDayIntensities day-of-month key and
    # yearlyWeekIntensities Monday-ordinal band, both of which read a date the
    # BACKEND sent. Those are host-dependent in a way the range is not -- a
    # window anchored correctly still routes a row into the wrong cell when the
    # row own date is parsed in the device zone -- and unlike the range they
    # disagree on the WEST side of UTC only, so AnalyticsScreen, whose failures
    # were all east-of-UTC month rollover, would not have caught it.
    "src/__tests__/analytics-data.test.ts",
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
# COST, since each zone is one full vitest invocation and dev-ci runs them at
# concurrency 1: adding Honolulu took this from four zones to five, roughly +25% CI
# wall-clock. Los Angeles is now redundant for the 24-hour property and is kept only
# for daylight-saving coverage, so it is the line to cut if runtime ever matters. The
# self-test below asserts which zones are load-bearing, so this trade is checkable
# rather than remembered.
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
    #
    # THE COST OF KEEPING IT, which was not written down when Honolulu was added. This
    # gate runs one full vitest invocation PER ZONE, so going from four zones to five
    # cost roughly 25% more wall-clock in CI (dev-ci runs at concurrency 1, so the zones
    # are sequential). That was accepted without saying so, which is not a decision,
    # it is an omission. The trade is explicit here so it can be revisited:
    #   keep LA  -> the only DST-crossing zone is exercised, at ~25% CI time
    #   drop LA  -> back to four zones and no cost, losing DST coverage entirely
    # The sensitivity property is satisfied either way, which is exactly why the
    # choice is about coverage and cost rather than correctness. If this gate's
    # runtime ever becomes the thing that needs attention, LA is the line to cut and
    # nothing else.
    without_la = {k: v for k, v in ZONE_OFFSETS.items() if k != "America/Los_Angeles"}
    want("Los Angeles is redundant for sensitivity", sensitivity_gap(without_la), [])

    # The ZONE PREFLIGHT, which the cases above cannot reach: it runs after the dispatch
    # by design, so without these it was shipped unexercised on every host. These assert
    # the property the preflight itself asserts -- a zone the host honours SHIFTS local
    # time, and a name it does not recognise does not -- so CI verifies the preflight's
    # happy path even on a host where it could not be run by hand.
    if hasattr(time, "tzset"):
        want("UTC reports a zero offset", honoured_offset("UTC"), 0)
        # A name no tzdata has falls back to UTC, which is the signature the preflight
        # keys on. If this ever returns non-zero, the preflight's whole test is wrong.
        want("an unrecognised zone name reports zero",
             honoured_offset("Not/ARealZone"), 0)
        for z in ZONES:
            if z == "UTC":
                continue
            off = honoured_offset(z)
            if off == 0:
                bad.append(f"preflight: {z!r} is not honoured by this host (offset 0) -- "
                           f"it would run under a fallback and silently lose its window")
    # Where time.tzset is absent the preflight reports SKIPPED and returns 0, and the
    # arithmetic above is the only thing this self-test can assert. Said here rather
    # than left to look like coverage that does not exist.

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
    # Report what ACTUALLY ran. The preflight cases are conditional on time.tzset, so
    # a fixed count would claim coverage this host did not perform -- the same small
    # untruth this file's own history is about.
    ran = 8 + (5 if hasattr(time, "tzset") else 0)
    skipped = "" if hasattr(time, "tzset") else \
        " (preflight cases SKIPPED: no time.tzset on this host)"
    print(f"SELF-TEST OK ({ran} cases{skipped}, no files touched, vitest never run)")
    return 0


def honoured_offset(tz: str) -> int:
    """Seconds the host's local time sits WEST of UTC after applying TZ=tz.

    0 means the host did not move: either the zone is UTC, or the name is unknown and
    the platform fell back. Those two are indistinguishable from the offset alone, which
    is why the caller treats a ZERO offset as a failure for any zone that should not be
    UTC -- an unresolvable name is the only other way to get there.

    Uses time.tzset, which is Unix-only; see zone_probe() for what happens without it.
    """
    saved = os.environ.get("TZ")
    try:
        os.environ["TZ"] = tz
        time.tzset()
        return time.timezone
    finally:
        if saved is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = saved
        time.tzset()


def zone_probe() -> int:
    """Fail if any zone in ZONES is not honoured by this host, BEFORE the vitest run.

    Added 2026-09-29 alongside the Honolulu fix, because that fix could otherwise be
    undone invisibly. If a zone name is unknown, Node does not error -- it falls back and
    the vitest run happens under UTC or system local time while still reporting PASS.
    That is the SAME blind spot the ZONES arithmetic exists to close, arriving by a
    different route: a typo, or a zone missing from a minimal tzdata, would silently
    remove a sensitivity window and leave every other gate green. The sensitivity
    self-test cannot see it, because it checks the ARITHMETIC, not whether the host
    honours the name.

    Ordering is the point: this costs microseconds, while the run below costs one
    vitest invocation per zone. Learning a zone is dead after four expensive runs wastes
    a CI job to discover what a free check already knew.

    The test is that a non-UTC zone must SHIFT local time. A zero offset is the only
    signature an unresolvable name can produce, since UTC is the universal fallback.
    On a platform without time.tzset this reports that it SKIPPED rather than
    pretending to have verified anything -- a check that silently no-ops is the same
    class of quiet it exists to prevent.
    """
    if not hasattr(time, "tzset"):
        print("check-tz-invariance: zone preflight SKIPPED -- time.tzset is unavailable"
              " here, so zone NAMES were not verified against this host. The 24-hour"
              " sensitivity arithmetic is still enforced -- by this run, immediately"
              " below, and again by --self-test -- so the only thing skipped is whether"
              " this host honours each name. A name it silently ignores runs the tests"
              " under a fallback and still passes, which is why that is the half worth"
              " saying out loud rather than the half that is covered twice.")
        return 0
    dead: list[str] = []
    for tz in ZONES:
        if tz == "UTC":
            continue
        if honoured_offset(tz) == 0:
            dead.append(tz)
    if dead:
        print("check-tz-invariance: zone preflight FAILED -- this host does not honour: "
              + ", ".join(dead))
        print("  A zone that does not resolve runs under a fallback and still passes, which"
              " silently removes a sensitivity window. Fix the name or the tzdata before"
              " trusting a green here.")
        return 1
    print(f"check-tz-invariance: zone preflight OK -- {len(ZONES)} zone(s) honoured.")
    return 0

# Dispatch ABOVE the module-level vitest run further down this file. Placing it there
# rather than at the bottom is the whole reason --self-test is safe here: every other
# checker dispatches from main(), and this file has no main(), because one vitest
# invocation per zone executes on import. Five zones, not four: Pacific/Honolulu was
# added 2026-09-29 to close a 07:00-10:00 blind spot the original four left open.
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

# Preflight BEFORE the expensive loop: a dead zone name must be caught here, not
# after one vitest invocation per zone has already been spent.
#
# sys.exit(zone_probe()), NOT a bare call: zone_probe returns 1 to mean "stop", and a
# discarded return value would print the failure and then run the expensive loop anyway
# -- a preflight that warns and proceeds is not a preflight. Exiting here is also the
# only place a non-zero code can reach the caller, since this file has no main().
if zone_probe() != 0:
    sys.exit(1)

# And the SENSITIVITY check at gate time, not only in --self-test. Until 2026-09-29 this
# ran nowhere except the self-test, which a static audit found by asking which of a
# self-test's callees are referenced nowhere else. The consequence was specific: someone
# could trim ZONES to the zones that pass right now, every gate run would stay green,
# and the blind hours would reopen -- because zone_probe() asks whether the host
# HONOURS a zone, which is a different question from whether the chosen set is SENSITIVE.
# Cost is arithmetic on a five-entry dict, so there is no reason for the gate's own run
# to stay silent about the property the whole file exists to provide.
_gap = sensitivity_gap(ZONE_OFFSETS)
if _gap:
    print("check-tz-invariance: SENSITIVITY FAILURE — no zone disagrees with UTC "
          "during: " + ", ".join(f"{a:02d}:00-{b:02d}:00" for a, b in _gap))
    print("  The gate runs, passes, and cannot see a host-date bug in those hours. "
          "Add a zone whose window covers the gap, or widen an existing one.")
    sys.exit(1)
print(f"check-tz-invariance: sensitivity OK — {len(ZONES)} zone(s) cover all 24 hours.")

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
