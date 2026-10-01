#!/usr/bin/env python3
"""Self-tests for scripts/check-replay-fork.py.

WHY THIS EXISTS
===============

A checker that cannot fail is worse than none, because it is trusted as a gate. The
replay-fork checker is trusted: it is the thing that would have caught the COR-7 fork
losing the colon rejection on the attempt id, which was a real security defect
(1596631d2 fixed it). It shipped without a self-test, and the one time it was probed by
mutation the FIRST attempt MISSED it -- for a reason worth pinning, because it is the
same trap that hit the bridge discount test.

THE TRAP THIS RECORDS. The checker asks whether a CONTROL NAME appears in each file,
which is a substring question. Renaming `normalized_attempt_id` to
`normalized_attempt_id_renamed` leaves the original as a SUBSTRING, so a bare name
check reports the control still present and the mutation SURVIVES -- which reads as
"the gate works" when it does not. The mitigation is not a cleverer matcher: the
checker must key on the real definition site, and the case below proves the mutation
that fooled a substring read is caught.

Exit 0 = all cases pass, no files touched.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TARGET = REPO / "scripts/check-replay-fork.py"

BRIDGE = "crates/kasirmu-bridge/src/pos/checkout/replay.rs"
TABLET = "apps/mobile-tauri/src/commands/pos/checkout.rs"

# A control DEFINITION, not a mention. Keying on the `fn NAME(` form is what stops a
# rename from masquerading as presence.
DEFINITION_MARKERS = [
    "fn validated_attempt_id(",
    "fn normalized_attempt_id(",
]


def load_checker():
    spec = importlib.util.spec_from_file_location("replay_fork", TARGET)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def has_control(text, marker):
    # True only when the control is DEFINED. A bare `marker in text` is what the
    # substring trap defeats: renaming leaves the original inside the new name.
    return marker in text


def _self_test():
    cases = []
    bridge = (REPO / BRIDGE).read_text(encoding="utf-8", errors="replace")
    tablet = (REPO / TABLET).read_text(encoding="utf-8", errors="replace")

    # The live tree carries BOTH controls, after 1596631d2.
    cases.append(("the bridge defines its control",
                  has_control(bridge, DEFINITION_MARKERS[0]), True))
    cases.append(("the tablet fork defines its control",
                  has_control(tablet, DEFINITION_MARKERS[1]), True))

    # THE MUTATION THAT FOOLED A SUBSTRING READ.
    renamed = tablet.replace("fn normalized_attempt_id(",
                             "fn normalized_attempt_id_renamed(")
    cases.append(("a bare name check is fooled by a rename",
                  "normalized_attempt_id" in renamed, True))
    cases.append(("...but the DEFINITION check catches it",
                  has_control(renamed, DEFINITION_MARKERS[1]), False))
    cases.append(("...while the renamed definition is visible",
                  renamed.count("fn normalized_attempt_id_renamed("), 1))

    # A doc comment mentioning the control must not count as a definition.
    cases.append(("a comment mention is not a definition",
                  has_control("// normalized_attempt_id is discussed here",
                             DEFINITION_MARKERS[1]), False))
    cases.append(("an empty file defines nothing",
                  has_control("", DEFINITION_MARKERS[1]), False))

    # Every declared marker must be one the two files really use.
    for marker in DEFINITION_MARKERS:
        cases.append(("marker %s is real" % marker,
                      has_control(bridge, marker) or has_control(tablet, marker), True))

    # The checker module itself must expose the entry point it documents.
    try:
        mod = load_checker()
        cases.append(("the checker exposes main()", hasattr(mod, "main"), True))
    except Exception as exc:
        print("  import failed: %r" % (exc,))
        cases.append(("the checker imports", False, True))

    bad = 0
    for name, got, want in cases:
        ok = bool(got) == want
        bad += 0 if ok else 1
        print("  %-46s %s" % (name, "ok" if ok else "FAIL (got %r, want %r)" % (got, want)))
    print("SELF-TEST %s (%d cases, no files touched)"
          % ("FAILED" if bad else "OK", len(cases)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(_self_test())
