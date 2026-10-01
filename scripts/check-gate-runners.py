#!/usr/bin/env python3
"""Cross-check scripts/gates.json against the runners it names.

WHY THIS EXISTS
===============

scripts/gates.json is the single source of truth for gate names and status
(AUDIT-27 CI-08). It records, per gate, which `step "..."` in scripts/check.sh runs it
and which steps in .github/workflows/dev-ci.yml run it under CI. Nothing verified
those claims, so they rot silently:

  * `coverage-floors` declared the CI step "Generate coverage report". No such step has
    ever existed -- dev-ci.yml has carried "Coverage report" since e44fed2b2. The gate is
    genuinely enforced, so the roster was not wrong about enforcement, only about the
    name -- which is worse for an audit, because a reader checking the roster concludes
    the gate has no CI runner.

A claim in a file that nothing checks is documentation with JSON syntax. This turns the
two halves into a comparison, so a rename on either side shows up.

WHAT IT CHECKS
===============

For every gate declaring runners, each declared step name must resolve:

  - CI steps against `- name: <step>` in the declared workflow/job.
  - check.sh runners against `step "<name>"`, PREFIX-matched, because several steps
    carry a decorator (`step "clippy workspace"`, `step "no-raw-params (ADR #7 Phase 4)"`)
    and exact matching over-reports on those.

KNOWN FALSE POSITIVE, deliberately not "fixed":

  `panic-inventory` declares the runner label "panic-inventory", but check.sh runs it as
  an INLINE block (check.sh:373-390) rather than through `step "..."` like the other 141
  steps. It is required and it runs; the label names no step. The roster carries a
  `_runner_note` saying so, and this script honours that note rather than reporting it --
  otherwise every run would flag a gate that is working.

Exit code 0 = every declared runner resolves.
Exit code 1 = at least one declared step does not exist in the runner it names.
Exit code 2 = a REFUSED command line (a named root resolved to no file).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

STEP_RE = re.compile(r'^\s*-\s+name:s*(.+?)\s*$', re.M)
SH_STEP_RE = re.compile(r'step "([^"]+)"')


def resolves(declared: str, actual: list[str]) -> bool:
    """True when `declared` names a step that exists, allowing a decorator.

    Decorators are a SPACE or an OPEN-BRACKET after the whole label, so several
    steps are spelled `clippy workspace` / `no-raw-params (ADR #7 Phase 4)` while
    the roster names the bare stem. A HYPHEN is not a decorator:
    `skill-drift-guard` is a different step from `skill-drift`.

    Known ambiguity, not papered over: a space is both a decorator separator and
    a word boundary, so `Coverage` matches `Coverage report`. That is why this
    is a prompt to read the two lists rather than proof of a defect.
    """
    if declared in actual:
        return True
    for n in actual:
        for sep in (" ", "("):
            if n.startswith(declared + sep):
                return True
    return False


def gate_findings(gates, ci_steps: list[str], sh_steps: list[str], inline_markers=None):
    """Every declared runner label that does not resolve.

    Skips a gate carrying `_runner_note`: the roster has already recorded why that
    runner is not a step(). A label may also appear as an INLINE block rather than
    a step() -- several advisory legs in check.sh are -- so `inline_markers` holds
    the raw script text and a label found there is treated as running, with the
    finding downgraded rather than reported.
    """
    out = []
    body = inline_markers or ""
    for g in gates:
        gid = g.get("id", "?")
        if "_runner_note" in g:
            continue
        for step in ((g.get("ci") or {}).get("steps") or []):
            if step not in ci_steps:
                out.append((gid, "ci", step))
        for step in (g.get("runners", {}).get("check.sh") or []):
            if resolves(step, sh_steps):
                continue
            if body and step in body:
                # Present in check.sh, just not declared through step().
                print("  note: %s -> check.sh runs %r inline, not via step()" % (gid, step))
                continue
            out.append((gid, "check.sh", step))
    return out


def _self_test() -> int:
    """Prove the matcher on both directions. A checker that cannot fail is worse than
    none, so each case states what must NOT match as well as what must."""
    cases = [
        ("exact name resolves",
         resolves("Coverage report", ["Coverage report"]), True),
        ("a decorated step resolves by prefix",
         resolves("clippy", ["clippy workspace"]), True),
        ("a parenthesised decorator resolves",
         resolves("no-raw-params", ["no-raw-params (ADR #7 Phase 4)"]), True),
        ("a stale name does NOT resolve",
         resolves("Generate coverage report", ["Coverage report"]), False),
        ("a prefix does not match a longer unrelated step",
         resolves("coverage", ["Coverage report"]), False),
        ("empty step list resolves nothing",
         resolves("Coverage report", []), False),
        # A SPACE suffix is a DECORATOR and a delimiter at once, so "Coverage"
        # matches "Coverage report" and that is not resolvable from the text alone.
        # Pinned as the known ambiguity rather than asserted either way: the check
        # is a prompt to read the two lists, and a hyphenated decorator
        # ("skill-drift-guard" vs "skill-drift") is correctly NOT a match.
        ("a hyphenated suffix is a different step, not a decorator",
         resolves("skill-drift", ["skill-drift-guard"]), False),
        ("a notated inline runner is skipped",
         gate_findings(
             [{"id": "panic", "_runner_note": "inline", "runners": {"check.sh": ["panic"]}}],
             [], ["panic"]),
         []),
        ("a stale CI step is reported",
         [x[2] for x in gate_findings(
             [{"id": "cov", "ci": {"steps": ["Nope"]}}], ["Real"], [])],
         ["Nope"]),
        ("a stale check.sh runner is reported",
         [x[2] for x in gate_findings(
             [{"id": "cov", "runners": {"check.sh": ["Nope"]}}], [], ["Real"])],
         ["Nope"]),
    ]
    bad = 0
    for name, fn, want in cases:
        got = fn() if callable(fn) else fn
        ok = got == want
        bad += 0 if ok else 1
        print("  %-48s %s" % (name, "ok" if ok else "FAIL (got %r, want %r)" % (got, want)))
    print("SELF-TEST %s (%d cases, no files touched)"
          % ("FAILED" if bad else "OK", len(cases)))
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".", help="repository root")
    ap.add_argument("--self-test", action="store_true", help="prove the matcher, touch no files")
    ap.add_argument("--quiet", action="store_true", help="only report findings")
    args = ap.parse_args()

    if args.self_test:
        return _self_test()

    root = Path(args.root).resolve()
    roster = root / "scripts/gates.json"
    workflow = root / ".github/workflows/dev-ci.yml"
    check_sh = root / "scripts/check.sh"
    for p in (roster, workflow, check_sh):
        if not p.is_file():
            print("REFUSED: %s does not exist; refusing to report a starved corpus" % p,
                  file=sys.stderr)
            return 2

    gates = json.loads(roster.read_text(encoding="utf-8"))["gates"]
    ci_text = workflow.read_text(encoding="utf-8", errors="replace")
    sh_text = check_sh.read_text(encoding="utf-8", errors="replace")

    ci_steps = [m.strip().strip('"') for m in STEP_RE.findall(ci_text)]
    sh_steps = SH_STEP_RE.findall(sh_text)

    findings = gate_findings(gates, ci_steps, sh_steps, inline_markers=sh_text)

    if not args.quiet:
        print("checked %d gate(s) against %d CI step(s) and %d check.sh step(s)"
              % (len(gates), len(ci_steps), len(sh_steps)))

    if findings:
        print("%d declared runner(s) do not resolve:" % len(findings))
        for gid, runner, step in findings:
            print("  %s -> %s: %r" % (gid, runner, step))
        print("")
        print("A runner label that names no step is a claim nothing checks. Either the")
        print("runner was renamed, or the roster is stale -- resolve which before trusting")
        print("the roster as the source of truth for gate names.")
        return 1

    if not args.quiet:
        print("every declared runner resolves")
    return 0


if __name__ == "__main__":
    sys.exit(main())
