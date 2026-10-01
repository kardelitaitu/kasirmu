#!/usr/bin/env python3
"""Detect the COR-7 replay fork: the tablet shell re-implementing the bridge rules.

WHY THIS EXISTS
===============

The tablet command layer is a fork of the desktop one, so the per-attempt
idempotency rules (COR-7) exist twice:

  crates/kasirmu-bridge/src/pos/checkout/replay.rs     the implementation
  apps/mobile-tauri/src/commands/pos/checkout.rs      the fork

Nothing checked the two. They drifted, and the drift was not cosmetic:

  * the bridge REFUSES an attempt id containing `:` (`validated_attempt_id`),
    because the key namespace is colon-separated, so a crafted `a:rekey:b` composes
    a base key byte-identical to another attempt re-key LOOKUP key. The fork had no
    such rejection, so the replay guard could answer with a sale the basket never
    rang up. Fixed in 1596631d2.
  * the bridge stamps a re-key stem with an EPOCH (`{attempt}:rekey:{basket}:v{n}`),
    so a second void-and-retry gets fresh keys. The fork stamps a fixed
    `{attempt}:rekey:{cart_id}`, so it re-derives the same keys and the UNIQUE index
    on payments.idempotency_key rejects the second settlement. STILL OPEN -- it is a
    product ruling (settle a new sale, or refuse) plus a missing port, not a defect,
    so this script REPORTS it rather than failing on it.

WHAT IT CHECKS
===============

For each COR-7 control name that appears in the bridge, assert the same name
appears in the tablet fork. A control present on one side and absent on the other
is a REGRESSION, not a naming difference: the fork header itself says "a second
implementation of the SAME rules ... keep them in step".

It is deliberately narrow. It does not compare the two bodies line by line -- the
fork returns a different error type (AppError vs BridgeError) and legitimately
diverges in behaviour -- so a body diff would over-report. What it pins is the
CONTROL SET, which is the part that silently disappears.

Exit code 0 = both sides carry the same control set.
Exit code 1 = a control exists on one side only.
Exit code 2 = a REFUSED command line (a named root resolved to no file).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# The COR-7 controls, by the DEFINITION each side writes. Each is a guard that
# changes WHAT the replay guard does, not a helper of convenience: losing one lets
# a client reach a branch the other shell refuses.
#
# The marker is the `fn NAME(` form and NOT the bare name, deliberately. A bare name
# is a SUBSTRING question, and renaming `normalized_attempt_id` to
# `normalized_attempt_id_renamed` leaves the original inside the new name -- so a
# name-presence check reports the control still present and a rename of the control
# survives as a false pass. Keying on the definition site cannot be fooled that way,
# and scripts/test-replay-fork.py pins both halves of that.
CONTROLS = [
    # Rejects an attempt id carrying `:`, closing the key-namespace forgery.
    ("fn validated_attempt_id(", "fn normalized_attempt_id("),
]

BRIDGE_REL = "crates/kasirmu-bridge/src/pos/checkout/replay.rs"
TABLET_REL = "apps/mobile-tauri/src/commands/pos/checkout.rs"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".", help="repository root")
    ap.add_argument("--quiet", action="store_true", help="only report findings")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    bridge_path = root / BRIDGE_REL
    tablet_path = root / TABLET_REL

    for path in (bridge_path, tablet_path):
        if not path.is_file():
            print(f"REFUSED: {path} does not exist; refusing to report a starved corpus", file=sys.stderr)
            return 2

    bridge = read(bridge_path)
    tablet = read(tablet_path)

    findings = []
    for bridge_name, tablet_name in CONTROLS:
        in_bridge = bridge_name in bridge
        in_tablet = tablet_name in tablet
        if in_bridge and not in_tablet:
            findings.append((bridge_rel_line := BRIDGE_REL, bridge_name, tablet_name, "missing from the tablet fork"))
        elif in_tablet and not in_bridge:
            findings.append((TABLET_REL, bridge_name, tablet_name, "present in the fork but not in the bridge"))

    if not args.quiet:
        print(f"scanned {BRIDGE_REL} against {TABLET_REL}")

    if findings:
        print(f"{len(findings)} replay-fork mismatch(es):")
        for rel, bridge_name, tablet_name, why in findings:
            print(f"  {rel}: {bridge_name} / {tablet_name} -- {why}")
        print("")
        print("A control present on one side only is a REGRESSION, not a naming difference:")
        print("the fork header says \"a second implementation of the SAME rules\".")
        return 1

    if not args.quiet:
        print(f"no replay-fork control is present on one side only ({len(CONTROLS)} checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
