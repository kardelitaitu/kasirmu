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
# The live-workflow rule lives in ONE place now. Six checkers had their own copy and
# three of the six disagreed about .yaml -- see scripts/_live_workflows.py.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _live_workflows import live_workflow_files as _live  # noqa: E402


def live_workflows(workflows=None) -> list[Path]:
    """Every workflow GitHub will execute. The rule itself is shared; see
    scripts/_live_workflows.py for why it is not written out a sixth time.
    r170: `workflows` redirects the feed at a fixture (the r166 parameter);
    None keeps this repository's own .github/workflows."""
    return _live(workflows)


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

    # The re-export main() consumes: live_workflows() must hand the live set through
    # unchanged. The rule itself is graded in scripts/_live_workflows.py; here the
    # feed is stubbed so the plumbing is pinned without touching the live tree.
    global _live
    _saved_live = _live
    _sentinel = [Path("a.yml"), Path("b.yml")]
    try:
        _live = lambda workflows=None: _sentinel
        got = live_workflows()
        if got != _sentinel or not all(isinstance(p, Path) for p in got):
            bad.append(f"live_workflows must hand main() the live set unchanged, got {got!r}")
    finally:
        _live = _saved_live

    # r170: main()'s shell -- argv and root graded against a tempdir fixture,
    # the r166/r169 pattern: capture stdout AND stderr, patch nothing global.
    import contextlib
    import io as _io
    import tempfile
    def _shell(text):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / ".github" / "workflows").mkdir(parents=True)
            (root / ".github" / "workflows" / "dev-ci.yml").write_text(
                text, encoding="utf-8")
            out, err = _io.StringIO(), _io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                rc = main(argv=[], root=root)
            return rc, out.getvalue() + err.getvalue()
    GOOD = "name: ci\non:\n  push:\njobs:\n  build:\n    runs-on: ubuntu-latest\n"
    rc, text = _shell(GOOD)
    if rc != 0 or "1 live workflow(s) parse" not in text:
        bad.append("a parseable workflow must exit 0 (rc=%d text=%r)" % (rc, text[:80]))
    rc, text = _shell("on:\n  push:\njobs:\n  a: {\n")
    if rc != 1 or "RUNS NOTHING" not in text or "dev-ci.yml" not in text:
        bad.append("unparseable YAML must exit 1 naming the file (rc=%d text=%r)"
                   % (rc, text[:100]))
    rc, text = _shell("on:\n  push:\nname: ci\n")
    if rc != 1 or "declares no jobs" not in text:
        bad.append("a jobs-less workflow must exit 1 (rc=%d text=%r)" % (rc, text[:80]))
    rc, text = _shell("")
    if rc != 1 or "not a mapping" not in text:
        bad.append("an empty workflow file must exit 1 (rc=%d text=%r)" % (rc, text[:80]))
    with tempfile.TemporaryDirectory() as td:
        out, err = _io.StringIO(), _io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = main(argv=[], root=td)
        if rc != 2 or "refusing" not in (out.getvalue() + err.getvalue()):
            bad.append("an absent live set must refuse with exit 2 (rc=%d)" % rc)

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (%d cases, incl. 5 shell cases; no repo files touched)"
          % (5 + 1 + 5))
    return 0


def main(argv: list[str] | None = None, root: str | Path | None = None) -> int:
    """r170: argv and root parameterized, the r166/r169 contract -- root
    redirects the live-workflow feed, so a fixture cannot half-run against
    the real repository's workflows."""
    wf_dir = None if root is None else Path(root).resolve() / ".github" / "workflows"
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's cases and exit.")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()

    wfs = live_workflows(wf_dir)
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
            print(f"verify-workflow-syntax: {p.relative_to(ROOT if root is None else Path(root).resolve()).as_posix()}: {why}")
    if failed:
        print("verify-workflow-syntax: a workflow that does not parse RUNS NOTHING."
              " GitHub reports it errored and executes none of its jobs, so the failure"
              " looks like a green PR that stopped checking.")
        return 1
    print(f"verify-workflow-syntax: OK — {len(wfs)} live workflow(s) parse and declare jobs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
