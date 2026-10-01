"""Fail when a crate's measured line coverage drops below its recorded floor.

Why this exists.  `scripts/coverage.sh` produces a report and enforces nothing:
it prints a percentage and exits 0 whatever the number is.  So the repo has had
coverage *instrumentation* for a long time and no coverage *gate*, and the
distinction matters -- a report nobody reads cannot fire.  `todo-codebase-
reliability.md` P1-2 records the same gap, and its own text supplies the rule
this script obeys: "an unrecorded threshold is not a threshold".

What the floor IS, and is not.  A ratchet, not a target.  Each floor sits two
percentage points below the value measured on 2026-09-27, so the gate freezes
the level reached and fires on a regression, without demanding work nobody
agreed to fund.  A gate set to an aspirational number goes red on day one, and
a gate that is red on day one is a gate people learn to ignore.

Why PER-CRATE rather than one workspace figure.  P1-2 says it outright: "a
global average hides the crates that matter".  Measured at the same time:
foundation 99.4%, kasirmu-core 83.8%, modules-inventory 78.4%,
platform-sync 68.7% (workspace 73.9%).  A single 70% floor would pass with
platform-sync -- the crate this checklist calls the highest-risk surface --
falling a full point, because foundation's 99.4% would carry it.

What this does NOT do.  It does not run coverage; `cargo llvm-cov` does, and it
aborts on ANY failing test, so coverage is coupled to suite greenness by
construction (measured 2026-09-27: an unrelated in-flight test failure in
kasirmu-bridge aborted a workspace run).  This script only grades a JSON report
that a prior run produced, which keeps the gate cheap, offline and testable.

Run:
    python scripts/verify-coverage-floors.py                    # uses coverage-probe.json
    python scripts/verify-coverage-floors.py --json path.json   # grade a specific report
    python scripts/verify-coverage-floors.py --self-test        # prove both directions
Exit 0 = every named crate at or above its floor, 1 = a crate below, missing, or
the report unreadable.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FLOORS_PATH = ROOT / "scripts" / "coverage-floors.json"
DEFAULT_REPORT = ROOT / "coverage-probe.json"

# The report is keyed on repository-relative path prefixes. Kept beside the
# floors so a crate that moves is one edit, not two.
CRATE_PREFIXES = {
    "foundation": "foundation/",
    "kasirmu-core": "crates/kasirmu-core/",
    "modules-inventory": "modules/inventory/",
    "platform-sync": "platform/sync/",
}


def load_floors(path: Path) -> dict[str, float]:
    """Read the recorded floors, refusing a manifest with none."""
    doc = json.loads(path.read_text(encoding="utf-8"))
    floors = doc.get("floors") or {}
    if not floors:
        raise ValueError(f"{path} declares no floors")
    return {k: float(v) for k, v in floors.items()}


def crate_line_pct(report: dict, prefix: str) -> tuple[float, int, int] | None:
    """Line coverage for one crate prefix, or None when nothing matched.

    Returns (percent, covered, total). None is deliberately distinct from 0.0:
    a crate whose files vanished from the report is a different failure from a
    crate that is merely uncovered, and conflating them would report an empty
    measurement as a catastrophic one.

    Summing covered/total across files rather than averaging per-file
    percentages is what makes a large uncovered file count proportionally. A
    mean-of-percentages would weight a 5-line file the same as a 5000-line one.
    """
    covered = 0
    total = 0
    matched = 0
    for f in report["data"][0].get("files", []):
        p = f["filename"].replace("\\", "/")
        if p.startswith(prefix) or f"/{prefix}" in p:
            matched += 1
            lines = f["summary"]["lines"]
            covered += lines["covered"]
            total += lines["count"]
    if matched == 0 or total == 0:
        return None
    return (100.0 * covered / total, covered, total)


def grade(report: dict, floors: dict[str, float]) -> tuple[int, list[str]]:
    """Grade a report against the floors. Returns (exit_code, messages)."""
    messages: list[str] = []
    failed = False

    for crate in sorted(floors):
        prefix = CRATE_PREFIXES.get(crate)
        if prefix is None:
            messages.append(
                f"FAIL  {crate}: a floor is recorded but CRATE_PREFIXES has no "
                f"path for it, so it was never measured"
            )
            failed = True
            continue

        measured = crate_line_pct(report, prefix)
        if measured is None:
            messages.append(
                f"FAIL  {crate}: no files under {prefix!r} in the report -- "
                f"either the crate moved or the report is from a partial run"
            )
            failed = True
            continue

        pct, covered, total = measured
        floor = floors[crate]
        if pct + 1e-9 < floor:
            shortfall = floor - pct
            messages.append(
                f"FAIL  {crate}: {pct:.1f}% < floor {floor:.1f}% "
                f"({covered}/{total} lines, short by {shortfall:.1f} points)"
            )
            failed = True
        else:
            messages.append(f"ok    {crate}: {pct:.1f}% >= {floor:.1f}%")

    # A workspace figure is reported, never gated -- it is context for the
    # reader, and gating it would reintroduce the masking P1-2 warns about.
    all_cov = sum(f["summary"]["lines"]["covered"] for f in report["data"][0]["files"])
    all_tot = sum(f["summary"]["lines"]["count"] for f in report["data"][0]["files"])
    if all_tot:
        messages.append(
            f"      workspace total: {100.0 * all_cov / all_tot:.1f}% "
            f"({all_cov}/{all_tot} lines) -- informational, not gated"
        )

    return (1 if failed else 0), messages


# ── Self-test: both directions, on synthetic reports ─────────────────

def _report(entries: dict[str, tuple[int, int]]) -> dict:
    """Build a minimal llvm-cov-shaped report from {path: (covered, count)}."""
    return {
        "data": [
            {
                "files": [
                    {
                        "filename": path,
                        "summary": {"lines": {"count": count, "covered": cov}},
                    }
                    for path, (cov, count) in entries.items()
                ]
            }
        ]
    }


def self_test() -> int:
    """Prove the gate fires on a shortfall and stays quiet when satisfied.

    A gate proven only in the pass direction is decoration. Each case below
    plants the failure it must catch.
    """
    failures: list[str] = []

    def expect(label: str, cond: bool) -> None:
        print(f"  {'ok  ' if cond else 'FAIL'}  {label}")
        if not cond:
            failures.append(label)

    floors = {"foundation": 97.0, "platform-sync": 66.0}

    # (1) everything comfortably above its floor -> exit 0.
    healthy = _report(
        {
            "foundation/src/a.rs": (980, 1000),      # 98%
            "platform/sync/src/b.rs": (700, 1000),   # 70%
        }
    )
    code, msgs = grade(healthy, floors)
    expect("a healthy report exits 0", code == 0)
    expect("  ...and says so per crate", any("ok    foundation" in m for m in msgs))
    expect(
        "  ...and reports the workspace total as informational, ungated",
        any("not gated" in m for m in msgs),
    )

    # (2) a crate below its floor -> exit 1, and the message NAMES it.
    regressed = _report(
        {
            "foundation/src/a.rs": (980, 1000),
            "platform/sync/src/b.rs": (600, 1000),   # 60% < 66
        }
    )
    code, msgs = grade(regressed, floors)
    expect("a crate below its floor exits 1", code == 1)
    expect("  ...and the shortfall names the crate", any("FAIL  platform-sync" in m for m in msgs))
    expect("  ...and states the shortfall", any("short by" in m for m in msgs))
    expect(
        "  ...and the OTHER crate still reports ok, so blame is not global",
        any("ok    foundation" in m for m in msgs),
    )

    # (3) a crate absent from the report -> exit 1, distinguished from 0%.
    partial = _report({"foundation/src/a.rs": (980, 1000)})
    code, msgs = grade(partial, floors)
    expect("a crate missing from the report exits 1", code == 1)
    expect(
        "  ...and says it was not measured, not that it is uncovered",
        any("no files under" in m for m in msgs),
    )

    # (4) the workspace average CANNOT carry a failing crate. This is the
    #     masking P1-2 warns about: foundation at 99% would lift a 60%
    #     platform-sync well past any single workspace floor of ~70%.
    mixed = _report(
        {
            "foundation/src/a.rs": (9900, 10000),    # 99%
            "platform/sync/src/b.rs": (600, 1000),   # 60%
        }
    )
    workspace_pct = 100.0 * (9900 + 600) / (10000 + 1000)
    code, _ = grade(mixed, floors)
    expect(
        f"a {workspace_pct:.0f}% workspace average still fails the 60% crate",
        workspace_pct > 90.0 and code == 1,
    )

    # (5) a floor recorded with no path mapping is a silent hole -> must fail.
    code, msgs = grade(healthy, {"foundation": 97.0, "ghost-crate": 50.0})
    expect("a floor with no CRATE_PREFIXES entry exits 1", code == 1)
    expect(
        "  ...and names the unmapped crate rather than skipping it",
        any("ghost-crate" in m and "never measured" in m for m in msgs),
    )

    # (6) a weight-sensitive check: summing must not become averaging.
    #     One 10-line file at 100% must NOT offset a 1000-line file at 60%.
    skewed = _report(
        {
            "foundation/tiny.rs": (10, 10),
            "platform/sync/big.rs": (600, 1000),
        }
    )
    code, _ = grade(skewed, {"platform-sync": 66.0})
    expect("many small covered lines cannot mask one large uncovered file", code == 1)

    print()
    if failures:
        print(f"self-test: FAIL ({len(failures)})")
        return 1
    print("self-test: all cases passed -- fires on a shortfall, quiet when met, "
          "and a workspace average cannot carry a failing crate")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--json", type=Path, default=DEFAULT_REPORT,
                    help=f"llvm-cov JSON report to grade (default: {DEFAULT_REPORT})")
    ap.add_argument("--floors", type=Path, default=FLOORS_PATH,
                    help=f"floors manifest (default: {FLOORS_PATH})")
    ap.add_argument("--self-test", action="store_true",
                    help="prove the gate fires in both directions, then exit")
    ns = ap.parse_args()

    if ns.self_test:
        return self_test()

    try:
        floors = load_floors(ns.floors)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"FAIL  cannot read the floors manifest {ns.floors}: {e}", file=sys.stderr)
        return 1

    try:
        report = json.loads(ns.json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(
            f"FAIL  cannot read the coverage report {ns.json}: {e}\n"
            f"Generate one with:\n"
            f"  cargo llvm-cov --workspace --all-features \\\n"
            f"    --exclude kasirmu-app --exclude kasirmu-mobile \\\n"
            f"    --json --output-path {ns.json}",
            file=sys.stderr,
        )
        return 1

    if not report.get("data") or not report["data"][0].get("files"):
        print(
            f"FAIL  {ns.json} contains no measured files -- an empty report "
            f"reads as 0% everywhere, which is a broken run, not a coverage result",
            file=sys.stderr,
        )
        return 1

    code, messages = grade(report, floors)
    for m in messages:
        print(m)
    print()
    if code:
        print(
            "coverage floors: FAIL. If the loss is intended, lower the floor in "
            "scripts/coverage-floors.json and update _measured in the same commit "
            "-- the manifest documents why that must be deliberate."
        )
    else:
        print("coverage floors: OK.")
    return code


if __name__ == "__main__":
    sys.exit(main())
