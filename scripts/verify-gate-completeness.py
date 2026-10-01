#!/usr/bin/env python3
r"""
scripts/verify-gate-completeness.py — caught a gate step no roster row claims.

WHY
===

`scripts/gates.json` is the manifest of gates: for each one it records which
`step "..."` in check.sh runs it. `check-gate-runners.py` checks the OTHER direction —
that every label DECLARED in the roster resolves to a real step.

NOTHING checked that every step is DECLARED. The gap is invisible from the manifest
side: a step with no row simply is not in the list being iterated, so no tool that
walks the roster can see it. Round 148 found one such step by accident (the core-size
ratchet, which had run for months unrostered); round 149 matched every step against
every label and found seven, including `script tests` — a whole suite that had been red
for an unknown period BECAUSE nothing ran it, and was still unclaimed after it was wired.

WHAT IT CHECKS
==============

Every `step "<name>"` in scripts/check.sh is claimed by a label in gates.json, EXACTLY.
Exact is the right test here and prefix-matching is not, and the difference is measured
rather than assumed: `check-gate-runners.py` accepts a prefix because some steps are
spelled with a decorator ('clippy workspace', 'no-raw-params (ADR #7 Phase 4)'), and a
space is both a decorator separator and a word boundary. That looseness is correct in
that direction (it validates labels the roster already names) and WRONG in this one:
while the `migration` row declared the bare label "migration", the resolver reported
`migration smoke test` as claimed by prefix while `migration idempotency` was claimed by
nothing at all. Demanding an exact claim is what makes the omission visible.

The tree satisfies that today — 118 of 118 steps claimed exactly, 0 by prefix alone —
so this gate starts green, which is the property round 109 established a new gate needs.

Exit 0 clean, 1 unclaimed step(s), 2 usage or self-test failure.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECK_SH = ROOT / "scripts" / "check.sh"
GATES_JSON = ROOT / "scripts" / "gates.json"

# `step "<name>" <retry-cmd> <cmd>` — the name is the first quoted field.
STEP_RE = re.compile(r'(?m)^step\s+"([^"]+)"')


def check_steps(text: str) -> list[str]:
    return STEP_RE.findall(text)


def declared_labels(manifest: dict) -> list[str]:
    out: list[str] = []
    for gate in manifest.get("gates", []):
        for labels in (gate.get("runners") or {}).values():
            out.extend(labels)
    return out


def unclaimed(steps: list[str], labels: list[str]) -> list[str]:
    """Steps no label names EXACTLY. Prefix matching is deliberately NOT used."""
    known = set(labels)
    return [s for s in steps if s not in known]


def _self_test() -> int:
    """Both directions on the shape that hid a real gate.

    Case 2 is the defect: `migration idempotency` is a step whose only 'claim' was the
    PREFIX `migration`, which `check-gate-runners.py` accepts. This gate must reject it,
    because that is the omission it exists to find.
    """
    steps = ["migration smoke test", "migration idempotency", "merged lines"]
    cases: list[tuple[str, list[str], int]] = [
        # `steps` has three entries, so every expectation counts the ones left over.
        ("a step named exactly by a label is claimed",
         ["migration smoke test", "migration idempotency", "merged lines"], 0),
        ("a step covered only by a PREFIX is NOT claimed",
         ["migration", "merged lines"], 2),
        ("naming one of two sibling steps leaves the other",
         ["migration smoke test", "merged lines"], 1),
        ("naming both siblings claims both",
         ["migration smoke test", "migration idempotency", "merged lines"], 0),
        ("an empty roster claims nothing", [], 3),
    ]
    bad = 0
    for name, labels, want in cases:
        got = len(unclaimed(steps, labels))
        if got != want:
            bad += 1
            print("  %-52s FAIL want=%d got=%d" % (name, want, got))
        else:
            print("  %-52s ok" % name)
    print("SELF-TEST %s (%d cases, no files touched)"
          % ("FAILED" if bad else "OK", len(cases)))
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="run the extractor cases and exit; touches no files")
    args = ap.parse_args()
    if args.self_test:
        return _self_test()

    for path in (CHECK_SH, GATES_JSON):
        if not path.is_file():
            print("refused: %s does not exist" % path)
            return 2

    steps = check_steps(CHECK_SH.read_text(encoding="utf-8", errors="replace"))
    manifest = json.loads(GATES_JSON.read_text(encoding="utf-8"))
    labels = declared_labels(manifest)
    missing = unclaimed(steps, labels)

    for name in missing:
        print("  unclaimed step: %r -- no gates.json row names it" % name)
    print("checked %d check.sh step(s) against %d declared runner label(s)"
          % (len(steps), len(labels)))
    if missing:
        print("FAIL: %d step(s) no roster row claims. A step with no row is invisible "
              "to verify-ci-docs-drift.py, which iterates the gates PRESENT in the "
              "manifest -- so it can never be reported as required-but-unenforced."
              % len(missing))
        return 1
    print("OK: every check.sh step is named by a gates.json runner label")
    return 0


if __name__ == "__main__":
    sys.exit(main())
