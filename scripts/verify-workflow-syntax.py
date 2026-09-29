#!/usr/bin/env python3
"""verify-workflow-syntax.py -- every live workflow must be parseable YAML.

WHY THIS IS SEPARATE FROM THE SHELL GATE
=========================================
scripts/verify-shell-syntax.sh's sibling, verify-shell-syntax.py, catches a shell file
that does not parse. This is the same failure with a much larger blast radius: a
.github/workflows/*.yml that is not valid YAML does not run AT ALL. GitHub reports the
workflow as errored and executes none of its jobs, so every check in it stops
happening -- and the symptom is not a red PR, it is a green one that stopped checking.

That is why this exists rather than "trusting" the existing workflow tooling.
verify-release-workflow.py parses release.yml with PyYAML, but only release.yml:
dev-ci.yml, android.yml and website.yml had no syntax check of any kind. And
verify-ci-docs-drift.py, which walks the whole workflow graph, is deliberately
line-based and never hands a file to a YAML parser -- a choice that was sound when
its sibling avoided the dependency, and which is now stale because this script and
verify-release-workflow.py both take it.

The attic is NOT covered, and that is correct rather than an omission: a retired
.bak is never executed, so its syntax cannot affect anything. The same rule
verify-ci-docs-rift.py applies when it scopes a claim to a live workflow.

Exit 0 all parse, 1 at least one does not, 2 could not run the check.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows"


def live_workflows() -> list[Path]:
    """Every top-level .yml AND .yaml. Files under attic/ are retired and never run.

    Both extensions because that is GitHub's rule, not a guess and not a snapshot: it
    executes any .yml or .yaml at the top of .github/workflows/. This globbed *.yml
    only, which happens to be right today because all four live workflows use that
    extension, and would have silently skipped a .yaml one added tomorrow. Same shape
    as the VENDORED directory list in verify-shell-syntax, which is why that was replaced
    by git ls-files: an extension list that must be maintained to stay true is a pending
    failure, and a failure nobody is told about.
    """
    if not WF.is_dir():
        return []
    return sorted(p for p in list(WF.glob("*.yml")) + list(WF.glob("*.yaml"))
                  if p.is_file())


def check(path: Path) -> str:
    """Return "" when the file parses, else the parser's message."""
    try:
        import yaml
    except ImportError as exc:
        raise SystemExit("verify-workflow-syntax: PyYAML is unavailable: " + str(exc))
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace"))
    except yaml.YAMLError as exc:
        return str(exc).replace("\n", " ")
    # A workflow that parses but is not a mapping is not a workflow GitHub can run, and
    # "parsed fine" would be the most misleading possible green.
    if not isinstance(doc, dict):
        return "parses, but the top level is " + type(doc).__name__ + ", not a mapping"
    if "jobs" not in doc:
        return "parses, but declares no jobs: key"
    if not isinstance(doc.get("jobs"), dict) or not doc["jobs"]:
        return "parses, but jobs is empty or not a mapping"
    return ""


def self_test() -> int:
    """Pure: a good workflow and three broken ones, all synthetic, none written."""
    try:
        import yaml
    except ImportError:
        print("SELF-TEST SKIPPED: PyYAML unavailable", file=sys.stderr)
        return 2

    bad: list[str] = []

    def parses(text: str) -> bool:
        try:
            yaml.safe_load(text)
            return True
        except yaml.YAMLError:
            return False

    good = "name: ci\non:\n  push:\njobs:\n  build:\n    runs-on: ubuntu-latest\n"
    if not parses(good):
        bad.append("a well-formed workflow must parse")

    # The shape this gate exists to catch: a workflow whose YAML is broken, so GitHub
    # runs none of its jobs and the PR goes green without being checked.
    if parses("on:\n  push:\njobs:\n  a: {\n"):
        bad.append("a workflow with an unclosed brace must NOT parse")

    # These two are valid YAML and INVALID as workflows, which is the distinction that
    # matters: "it parsed" is the most misleading possible green. check() rejects both
    # on shape, so they are asserted through check()'s own predicate rather than
    # through parses() -- testing a weaker reimplementation of the rule would have
    # missed exactly the case this case exists for.
    for label, text, why in (
            ("jobs is a list", "on:\n  push:\njobs:\n  - a\n  - b\n", "empty or not a mapping"),
            ("no jobs key", "on:\n  push:\nname: ci\n", "declares no jobs")):
        try:
            doc = yaml.safe_load(text)
        except yaml.YAMLError:
            doc = None
        usable = isinstance(doc, dict) and isinstance(doc.get("jobs"), dict) and bool(doc["jobs"])
        if usable:
            bad.append(f"{label} must be rejected as unusable, not reported as parsing")

    # And the non-mapping cases, which are the false green this script refuses to give.
    for label, text in (("a bare list", "- a\n- b\n"),
                        ("a scalar", "just-a-string\n")):
        try:
            got = yaml.safe_load(text)
        except yaml.YAMLError:
            got = None
        if isinstance(got, dict):
            bad.append(f"{label} must not load as a mapping")

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (5 cases, no files touched)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's cases and exit.")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    wfs = live_workflows()
    if not wfs:
        print("verify-workflow-syntax: no live workflow found under .github/workflows --"
              " refusing to report clean, because a gate that sees nothing must never"
              " read as a gate that found nothing.", file=sys.stderr)
        return 2

    failed = False
    for p in wfs:
        why = check(p)
        if why:
            failed = True
            print(f"verify-workflow-syntax: {p.relative_to(ROOT).as_posix()}: {why}")
    if failed:
        print("verify-workflow-syntax: a workflow that does not parse RUNS NOTHING."
              " GitHub reports it errored and executes none of its jobs, so the failure"
              " looks like a green PR that stopped checking.")
        return 1
    print(f"verify-workflow-syntax: OK — {len(wfs)} live workflow(s) parse and declare jobs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
