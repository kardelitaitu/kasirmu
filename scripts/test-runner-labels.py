#!/usr/bin/env python3
"""Regression test: a gates.json runner label must name a step that exists.

Why this exists. gates.json declares, per gate, which local runner steps implement
it. The checker used to test that with `has_needle()`, which is ANY-of: a gate
listing three labels was satisfied by one. So deleting two of them left the manifest
asserting guards that no longer existed, and `verify-ci-docs-drift.py` still printed
"0 drift item(s)". Demonstrated against this repo's own gate -- `ci-docs-drift`
declares both "ci docs drift" and "ci docs drift self-test", and removing the
self-test step from check.sh changed nothing.

The fix is `missing_needles()`, which reports every label that matches nothing. This
test is what stops that regressing, and it is written as a fixture rather than a
unit test because the property under test is about the whole checker's verdict.

Two traps this had to be built around, both of which produced confident wrong
answers before they were understood:

  * The fixture must contain the CHECKER ITSELF. ROOT is derived from
    `Path(__file__).resolve().parent.parent`, not from cwd, so running the real
    script with cwd=tmp makes it read the untouched repo and report "0 drift" for a
    mutation it never saw -- a false negative with the same shape as the bug being
    tested for. Case 0 exists purely to prove the fixture is live.
  * Needles match by SUBSTRING, so a short label cannot fail while a longer label
    containing it exists: renaming `step "ci docs drift"` is invisible until
    `step "ci docs drift self-test"` goes too. That is inherent to the needle design
    and worth knowing rather than working around.

Run: python3 scripts/test-runner-labels.py
"""
from __future__ import annotations

import io
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHECKER = "scripts/verify-ci-docs-drift.py"


def checker_inputs() -> list[str]:
    """Every ROOT-relative file the checker declares, read from its own source.

    Derived rather than listed. A hand-maintained copy set omitted
    docs/releases/checklist.md, and the control then reported 27 MISSING JOBS that
    the real repo does not -- a fixture artifact indistinguishable from a checker
    defect. If the gate gains an input, this follows it automatically.
    """
    src = io.open(REPO / CHECKER, encoding="utf-8").read()
    out = []
    for m in re.finditer(r"^([A-Z_]+)\s*=\s*ROOT\s*/\s*(.+)$", src, re.M):
        parts = re.findall(r'"([^"]+)"', m.group(2))
        if parts:
            out.append("/".join(parts))
    return out


def fixture(check_sh_text: str | None = None) -> Path:
    tmp = Path(tempfile.mkdtemp())
    for rel in [CHECKER] + checker_inputs():
        src = REPO / rel
        if not src.is_file():
            continue
        dst = tmp / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        io.open(dst, "w", encoding="utf-8", newline="").write(
            io.open(src, encoding="utf-8").read())
    if check_sh_text is not None:
        io.open(tmp / "scripts/check.sh", "w", encoding="utf-8", newline="").write(
            check_sh_text)
    wf = tmp / ".github/workflows"
    wf.mkdir(parents=True, exist_ok=True)
    # Both shapes. *.yml is what GitHub runs; *.yml.bak is what marks a documented
    # matrix row as history rather than as a missing guard. Copying only *.yml
    # turned 27 legitimately-retired jobs into MISSING JOBS inside the fixture, so
    # the control disagreed with the repo for reasons unrelated to the test.
    for w in (REPO / ".github/workflows").iterdir():
        if w.suffix in (".yml", ".bak"):
            (wf / w.name).write_bytes(w.read_bytes())
    return tmp


def run(tmp: Path) -> str:
    r = subprocess.run([sys.executable, str(tmp / CHECKER)],
                       capture_output=True, text=True,
                       encoding="utf-8", errors="replace", cwd=str(tmp))
    return r.stdout + r.stderr


def count(out: str) -> int:
    m = re.search(r"(\d+) drift item", out)
    return int(m.group(1)) if m else -1


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    orig = io.open(REPO / "scripts/check.sh", encoding="utf-8").read()
    real = run(REPO)
    base = count(real)
    if base < 0:
        print("  cannot read the checker's drift count from the live repo; "
              "refusing to compare against an unknown baseline")
        return 2

    bad: list[str] = []

    def expect(cond: bool, label: str, detail: str = "") -> None:
        print(f"  {'ok  ' if cond else 'FAIL'}  {label}")
        if not cond:
            bad.append(label)
            for ln in str(detail).splitlines()[:6]:
                if ln.strip():
                    print(f"        {ln.strip()[:108]}")

    # 0. Liveness. Without this every result below could be the checker reading the
    #    real repo instead of the fixture and agreeing with itself.
    garbage = (orig.replace('step "ci docs drift"', 'step "ZZZ REMOVED GATE"', 1)
                   .replace('step "ci docs drift self-test"',
                            'step "ZZZ REMOVED SELF-TEST"', 1))
    out0 = run(fixture(garbage))
    expect(count(out0) > base,
           "fixture is actually read (a mangled check.sh adds findings)", out0)

    # 1. Control: an untouched fixture must match the repo exactly.
    out1 = run(fixture())
    expect(count(out1) == base,
           f"unmodified fixture matches the repo ({base} item(s))", out1)

    # 2. Deleting one label of a two-label gate. This is the case ANY-of let through.
    kept = [ln for ln in orig.splitlines()
            if 'step "ci docs drift self-test"' not in ln]
    expect(len(kept) < len(orig), "the self-test step was found to delete")
    out2 = run(fixture("\n".join(kept) + "\n"))
    expect(count(out2) > base,
           "deleting a declared runner step ADDS a finding", out2)
    expect("ci docs drift self-test" in out2,
           "  ... and names the label that went missing", out2)

    # 3. Renaming is the same defect wearing a different hat.
    ren = orig.replace('step "agents mirrors self-test"',
                       'step "agents mirrors selftest"', 1)
    expect(ren != orig, "the agents-mirrors self-test step was found")
    out3 = run(fixture(ren))
    expect(count(out3) > base,
           "renaming a declared runner step ADDS a finding", out3)

    # 4. A single-label gate must still be caught. panic-inventory is announced with
    #    `echo -n` rather than step(), so this also covers the second label form.
    gone = orig.replace('echo -n "panic-inventory scan', 'echo -n "ZZZ panic scan', 1)
    expect(gone != orig, "the panic-inventory echo label was found")
    out4 = run(fixture(gone))
    expect(count(out4) > base,
           "removing a single-label gate's only step ADDS a finding", out4)

    print()
    if bad:
        print(f"  {len(bad)} failure(s):")
        for b in bad:
            print(f"    {b}")
        return 1
    print("  runner labels are enforced per-needle, and the fixture is provably live")
    return 0


if __name__ == "__main__":
    sys.exit(main())
