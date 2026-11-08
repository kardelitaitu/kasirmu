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
  - a CENSUS of the prefix population: labels resolving ONLY through the decorator
    rule are printed with their resolution kind, so the ambiguity the matcher itself
    flags is measured on every run instead of left as a prompt to read two lists
    (2026-11-08: three -- one decorated, two space-ambiguous; "feature registry" ->
    "feature registry parity" and "windows config" -> "windows config drift" are
    word-boundary shapes, not decorators, and the exact spellings are already declared
    by the local-matrix rows). Spelled exactly in the dedicated rows the same day
    (gates.json: "feature registry parity", "windows config drift",
    "no-raw-params (ADR #7 Phase 4)"), so the live census is now EMPTY and the
    decorator rule remains purely defensive.
  - a CENSUS of duplicate runner declarations: labels named by more than one gate
    are printed with the declaring ids, on both the check.sh and ci axes. One step
    can legitimately back several rows -- a 2026-09-29 batch row alongside a
    dedicated row -- so this is visibility, not a finding (2026-11-08: six on
    check.sh, zero on ci; four involve the local-matrix batch rows, two the
    checker-selftest-companions row; a seventh -- "core size ratchet", declared
    by both core-size and core-size-ratchet -- was two rows for one gate and the
    rows merged the same day).

KNOWN FALSE POSITIVE, deliberately not "fixed":

  `panic-inventory` declares the runner label "panic-inventory", but check.sh runs it as
  an INLINE block (check.sh:373-390) rather than through `step "..."` like the other 225
  steps (226 step lines measured 2026-11-08). It is required and it runs; the label names no step. The roster carries a
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
# Line-anchored, the same shape as verify-gate-completeness.py's STEP_RE: one
# canonical extraction of what a step IS. The old unanchored form matched
# `step "..."` anywhere in the text, so a COMMENT mentioning a step name would
# have counted as a step and let a stale needle resolve against a phantom --
# none today (measured 2026-11-08: both forms yield identical 226-match sets on
# the live check.sh), and now it cannot happen.
SH_STEP_RE = re.compile(r'(?m)^\s*step\s+"([^"]+)"')


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


def prefix_resolutions(declared_labels: list[str],
                       sh_steps: list[str]) -> list[tuple[str, str, str]]:
    """Declared labels that resolve ONLY through the decorator rule, with how.

    Returns (declared, actual, kind) triples: kind "decorated" for a
    parenthesised suffix -- with or without an intervening space, which is how
    the canonical case is actually spelled: "no-raw-params (ADR #7 Phase 4)" --
    and "space-ambiguous" for any other space suffix, the shape resolves()'s
    own docstring flags as unresolvable from text alone. Exact matches are not
    listed: the point is to make the prefix population VISIBLE on every run
    instead of leaving it as a prompt to read two lists by hand."""
    out = []
    for lab in sorted(set(declared_labels)):
        if lab in sh_steps:
            continue
        for n in sh_steps:
            if n.startswith(lab + "(") or n.startswith(lab + " ("):
                out.append((lab, n, "decorated"))
                break
            if n.startswith(lab + " "):
                out.append((lab, n, "space-ambiguous"))
                break
    return out


def duplicate_declarations(gates, axis: str) -> list[tuple[str, list[str]]]:
    """Runner labels declared by MORE THAN ONE gate, with the declaring ids.

    One step can legitimately back several rows -- a 2026-09-29 batch row
    (added to close unrowed steps) alongside the step's own dedicated row -- so
    this is a CENSUS, not a finding: the population should be visible without
    grepping the roster by hand. Repeats WITHIN one row's list are not
    represented here (measured zero 2026-11-08; a repeat says nothing new)."""
    owners: dict[str, set[str]] = {}
    for g in gates:
        gid = g.get("id", "?")
        if axis == "ci":
            needles = (g.get("ci") or {}).get("steps") or []
        else:
            needles = (g.get("runners") or {}).get("check.sh") or []
        for n in needles:
            owners.setdefault(n, set()).add(gid)
    return sorted((n, sorted(gs)) for n, gs in owners.items() if len(gs) > 1)


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
        ("a decorator-only resolution is listed",
         prefix_resolutions(["no-raw-params"], ["no-raw-params (ADR #7 Phase 4)"]),
         [("no-raw-params", "no-raw-params (ADR #7 Phase 4)", "decorated")]),
        ("an exact match is not listed",
         prefix_resolutions(["Coverage report"], ["Coverage report"]), []),
        ("a space suffix is listed as ambiguous",
         prefix_resolutions(["Coverage"], ["Coverage report"]),
         [("Coverage", "Coverage report", "space-ambiguous")]),
        ("a non-matching label is not listed",
         prefix_resolutions(["Nope"], ["Real"]), []),
        ("a comment-mentioned step is not counted",
         SH_STEP_RE.findall('# step "ghost" x' + chr(10) + 'step "real" c c' + chr(10)),
         ["real"]),
        ("a cross-row duplicate is listed",
         duplicate_declarations(
             [{"id": "a", "runners": {"check.sh": ["x"]}},
              {"id": "b", "runners": {"check.sh": ["x", "y"]}}], "check.sh"),
         [("x", ["a", "b"])]),
        ("a unique needle is not listed",
         duplicate_declarations(
             [{"id": "a", "runners": {"check.sh": ["x"]}}], "check.sh"), []),
        ("the ci axis is inspected separately",
         duplicate_declarations(
             [{"id": "a", "ci": {"steps": ["s"]}},
              {"id": "b", "ci": {"steps": ["s"]}}], "ci"),
         [("s", ["a", "b"])]),
        ("an empty roster lists nothing",
         duplicate_declarations([], "check.sh"), []),
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

    declared_sh = [s for g in gates
                   for s in (g.get("runners", {}).get("check.sh") or [])]
    prefixes = prefix_resolutions(declared_sh, sh_steps)

    if not args.quiet:
        print("checked %d gate(s) against %d CI step(s) and %d check.sh step(s)"
              % (len(gates), len(ci_steps), len(sh_steps)))

    if prefixes:
        print("  note: %d declared label(s) resolve by decorator prefix only:"
              % len(prefixes))
        for lab, act, kind in prefixes:
            print("    %r -> %r (%s)" % (lab, act, kind))

    for axis in ("check.sh", "ci"):
        dups = duplicate_declarations(gates, axis)
        if dups:
            print("  note: %d runner label(s) declared by more than one gate (%s axis):"
                  % (len(dups), axis))
            for lab, gs in dups:
                print("    %r <- %s" % (lab, ", ".join(gs)))

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
