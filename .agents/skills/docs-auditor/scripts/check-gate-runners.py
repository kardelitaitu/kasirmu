#!/usr/bin/env python3
"""Fail when a gate can be marked required but no runner can reach it.

WHY THIS EXISTS
    `scripts/gates.json` says `status: "required"` to mean *this must pass before a
    change lands*. That is only true if something can actually run it. Two ways the
    claim silently stops being true, both measured on 2026-10-19:

      * a `check.sh` runner naming a step that does not exist -- `rust-clippy`
        declared `clippy` while the script defines `clippy workspace`, so a
        name-matching sweep saw an unwired gate where one was wired;
      * no `ci` block and no other runner at all -- six docs checkers were
        `required` with only a `check.sh` step, i.e. required of a developer who
        remembers to run it by hand.

    Every other consistency checker compares docs to workflows
    (verify-ci-docs-drift.py) or prose claims to gates (verify-agents-mirrors.py).
    None asks whether a gate CAN BE RUN, which is the question this file answers.
    See docs/records/audits/2026-10-19-required-gates-without-runners.md.

WHAT COUNTS AS A RUNNER
    A required gate passes if ANY of these holds:
      * a declared `check.sh` step that literally appears in scripts/check.sh;
      * a declared runner for another script, where that script exists;
      * a `ci` block naming a workflow that exists and a job that the parsed
        workflow actually defines.

    A `ci` block naming a workflow that is absent, or a job that does not exist in
    it, is a finding -- that is a gate claiming enforcement nothing provides.

EXIT CODES
    0  every required gate has a reachable runner
    1  findings
    2  usage or parse error
"""
import argparse
import json
import pathlib
import re
import sys

GATES = "scripts/gates.json"
CHECK_SH = "scripts/check.sh"


def repo_root():
    """<root>/.agents/skills/docs-auditor/scripts/ -> four parents up."""
    guess = pathlib.Path(__file__).resolve().parents[4]
    if (guess / ".git").exists() or (guess / "Cargo.toml").is_file():
        return guess
    raise SystemExit("cannot resolve repo root from %s" % __file__)


def check_sh_steps(root: pathlib.Path) -> set:
    p = root / CHECK_SH
    if not p.is_file():
        return set()
    text = p.read_text(encoding="utf-8", errors="replace")
    return set(re.findall(r'^\s*step "([^"]+)"', text, re.M))


def workflow_jobs(path: pathlib.Path) -> set:
    """Job keys of a workflow, without a YAML dependency.

    Top-level `jobs:` then its 2-space-indented keys. Deliberately shallow: a
    false MISSING would be worse than a missed finding, so anything unparseable
    returns an empty set and the caller reports it as unreadable instead.
    """
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return set()
    out, in_jobs = set(), False
    for line in text.split("\n"):
        if re.match(r"^jobs:\s*$", line):
            in_jobs = True
            continue
        if in_jobs:
            if re.match(r"^\S", line) and not line.startswith("#"):
                if not line.strip():
                    continue
                break
            m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
            if m:
                out.add(m.group(1))
    return out


def npm_script_exists(root, script_name: str, inner=()) -> bool:
    """True when an npm script of that name exists and defines what is claimed.

    The first version of this file required every non-`check.sh` runner to be a
    FILE, so the `e2e` gate — reachable through `ui` -> `npm run check:all`,
    which itself runs the `e2e` script — was reported unreachable. A gate that is
    genuinely wired must not be flagged, or the checker trains people to ignore it.
    """
    for pkg in (root / "ui" / "package.json", root / "website" / "package.json",
                root / "package.json"):
        if not pkg.is_file():
            continue
        try:
            scripts = (json.loads(pkg.read_text(encoding="utf-8")).get("scripts") or {})
        except ValueError:
            continue
        if script_name not in scripts:
            continue
        if not inner:
            return True
        # The named runner must actually reach the inner gate. Two shapes:
        #   (a) it calls another npm script, e.g. "check:all": "... && npm run e2e"
        #   (b) it delegates to a node script whose own gate() list names the leg,
        #       e.g. check:all -> scripts/check-ui.mjs -> gate("E2E tests (...)")
        # (b) is the one that matters here and is why a literal substring test on
        # the package.json body was wrong: it reported the genuinely-wired `e2e`
        # gate as unreachable.
        body = str(scripts.get(script_name, ""))
        hay = body
        for m in re.finditer(r"([\w./-]+\.mjs)", body):
            js = root / m.group(1).replace("../", "")
            if js.is_file():
                hay += "\n" + js.read_text(encoding="utf-8", errors="replace")
        return all(x.lower() in hay.lower() or x == script_name for x in inner)
    return False


#: Workflow bodies and the job keys that must come out of them.
#: workflow_jobs() is a hand-rolled shallow YAML reader, and a false MISSING here is
#: worse than a missed finding -- it reports a genuinely-wired gate as unreachable and
#: trains the reader to ignore the checker. Both directions are pinned.
JOB_CASES = (
    ("simple jobs", "jobs:\n  build:\n    runs-on: x\n  test:\n    runs-on: x\n", {"build", "test"}),
    # A job key with a trailing comment is still a job key.
    ("a comment line inside jobs is skipped", "jobs:\n  # a note\n  build:\n    runs-on: x\n", {"build"}),
    # A job whose value starts on the same line (a flow mapping) is NOT matched by the
    # shallow reader, and that is deliberate: reporting unreadable beats inventing a key.
    ("inline job value is not invented", "jobs:\n  build: {runs-on: x}\n", set()),
    # The block ends at the next top-level key.
    ("stops at the next top-level key", "jobs:\n  build:\n    runs-on: x\nenv:\n  test: 1\n", {"build"}),
    # No jobs key at all is an empty set, and the caller reports that as unreadable.
    ("no jobs block", "name: ci\non: push\n", set()),
    # A step key four spaces deep is not a job. NOTE, measured rather than assumed: this
    # case does NOT redden if the indent regex is loosened from "  " to \s+, because the
    # deeper line is never reached -- the loop breaks at the first non-indented line, and a
    # 4-space key sits under an already-matched 2-space parent, so the cursor has moved on.
    # The regex is therefore REDUNDANT with the break, not load-bearing, and no case can
    # distinguish it. Kept anyway: it states the intended nesting depth, and costs nothing
    # if a later edit removes the break.
    (
        "a deeper key is a step, not a job",
        "jobs:\n  build:\n    runs-on: x\n    steps:\n      - run: echo\n",
        {"build"},
    ),
    # And the block still ends at the next top-level key even after a nested map.
    (
        "nested maps do not leak keys",
        "jobs:\n  build:\n    strategy:\n      matrix:\n        os: [x]\n    runs-on: x\n",
        {"build"},
    ),
)


#: (gates, steps, expected_problem_ids) -- the reachability decision itself.
#: `steps` stands in for the labels scripts/check.sh actually defines.
REACH_CASES = (
    (
        "a step that exists makes the gate reachable",
        [{"id": "a", "status": "required", "runners": {"check.sh": ["live step"]}}],
        {"live step"},
        [],
    ),
    (
        "a step that does not exist is a finding -- the rust-clippy shape",
        [{"id": "a", "status": "required", "runners": {"check.sh": ["clippy"]}}],
        {"clippy workspace"},
        ["a"],
    ),
    (
        "one live step among dead ones is still reachable",
        [{"id": "a", "status": "required", "runners": {"check.sh": ["live step", "gone"]}}],
        {"live step"},
        [],
    ),
    (
        "a gate with no runners at all is a finding",
        [{"id": "a", "status": "required", "runners": {}}],
        {"live step"},
        ["a"],
    ),
    (
        "an advisory gate is not graded",
        [{"id": "a", "status": "advisory", "runners": {}}],
        set(),
        [],
    ),
    (
        "a bad ci job is a finding even when a live step exists",
        [{"id": "a", "status": "required", "runners": {"check.sh": ["live step"]},
          "ci": {"workflow": "wf.yml", "job": "nope"}}],
        {"live step"},
        ["a"],
    ),
    (
        "a good ci job is reachable without any step",
        [{"id": "a", "status": "required", "runners": {},
          "ci": {"workflow": "wf.yml", "job": "build"}}],
        set(),
        [],
    ),
)


def workflow_jobs_from_text(text: str) -> set:
    """workflow_jobs() over a STRING, so the cases need no file."""
    out, in_jobs = set(), False
    for line in text.split(chr(10)):
        if re.match(r"^jobs:\s*$", line):
            in_jobs = True
            continue
        if in_jobs:
            if re.match(r"^\S", line) and not line.startswith("#"):
                if not line.strip():
                    continue
                break
            m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
            if m:
                out.add(m.group(1))
    return out


def reachability(gates, steps, workflow_jobs_lookup, npm_lookup):
    """(problem_ids, checked) for a gate list. Injected lookups keep it file-free."""
    problems, checked = [], 0
    for g in gates:
        if g.get("status") != "required":
            continue
        checked += 1
        reachable = False
        ci_broken = False
        for name, listed in (g.get("runners") or {}).items():
            listed = listed or []
            if name == "check.sh":
                if [x for x in listed if x in steps]:
                    reachable = True
            elif npm_lookup(name, listed):
                reachable = True
        ci = g.get("ci")
        if ci:
            jobs = workflow_jobs_lookup(ci.get("workflow"))
            job = ci.get("job")
            if jobs is None:
                ci_broken = True
            elif jobs and job and job not in jobs:
                ci_broken = True
            elif jobs and job:
                reachable = True
        if not reachable or ci_broken:
            problems.append(g.get("id", "?"))
    return problems, checked


def self_test() -> int:
    """Grade the YAML reader and the reachability rule; report EVERY failure."""
    bad = []
    for name, text, expected in JOB_CASES:
        got = workflow_jobs_from_text(text)
        if got != expected:
            bad.append("  jobs %s: expected %r, got %r" % (name, expected, got))
    workflows = {"wf.yml": {"build", "test"}}
    for name, gates, steps, expected in REACH_CASES:
        # None stands for an absent workflow, which main() reports as unreadable.
        get_jobs = lambda wf: workflows.get(wf)
        got, _ = reachability(gates, steps, get_jobs, lambda n, l: False)
        if got != expected:
            bad.append("  reach %s: expected %r, got %r" % (name, expected, got))
    # The root resolver, graded live: repo_root() is what main() aims at the gates
    # manifest, and a gutted one must turn the self-test red rather than leave every
    # read pointing at None.
    try:
        rp = repo_root()
        rooted = rp is not None and rp.is_dir() and (
            (rp / ".git").exists() or (rp / "Cargo.toml").is_file())
    except SystemExit:
        rooted = False
    if not rooted:
        bad.append("  repo_root: did not resolve to a checkout-shaped directory")
    if bad:
        sys.stderr.write("SELF-TEST WRONG:" + chr(10) + chr(10).join(bad) + chr(10))
        return 2
    print("SELF-TEST OK (%d cases, live tree untouched)"
          % (len(JOB_CASES) + len(REACH_CASES) + 1))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--self-test", action="store_true",
                    help="run this checker's cases and exit")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    # Grade both rules before the manifest. A YAML reader that stopped matching would
    # report every ci block as unparseable (noisy, and people stop reading), while a
    # reachability rule that always said True would report a clean tree -- the silent
    # direction this checker exists to prevent.
    rc = self_test()
    if rc:
        sys.stderr.write("RULES WENT DEAF: not trusting the manifest scan below." + chr(10))
        return rc

    root = repo_root()
    gp = root / GATES
    try:
        data = json.loads(gp.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print("check-gate-runners: cannot read %s: %s" % (GATES, exc), file=sys.stderr)
        return 2

    gates = data.get("gates") or []
    steps = check_sh_steps(root)

    def _jobs_for(workflow_name):
        """Job keys for a workflow, or None when the workflow itself is absent."""
        wf = root / ".github" / "workflows" / str(workflow_name or "")
        if not wf.is_file():
            return None
        return workflow_jobs(wf)

    # The SAME function the self-test grades -- not a copy of it. A duplicate loop here
    # would leave the cases testing code the gate does not run, which is the "a checker
    # that cannot fail" trap one level up.
    problems_ids, checked = reachability(
        gates, steps, _jobs_for, lambda n, l: npm_script_exists(root, n, l))

    # Rebuild the human-readable detail for the gates that failed. Kept separate from
    # the decision so the decision stays gradeable.
    problems = []
    for g in gates:
        gid = g.get("id", "?")
        if gid not in problems_ids:
            if args.verbose and g.get("status") == "required":
                pass
            continue
        detail = []
        for name, listed in (g.get("runners") or {}).items():
            listed = listed or []
            if name == "check.sh":
                dead = [x for x in listed if x not in steps]
                if dead:
                    detail.append("check.sh step(s) not in %s: %s" % (CHECK_SH, ", ".join(dead)))
            elif not npm_script_exists(root, name, listed):
                detail.append("runner %r names neither a file nor an npm script "
                              "that defines %s" % (name, ", ".join(listed) or "anything"))
        ci = g.get("ci")
        if ci:
            jobs = _jobs_for(ci.get("workflow"))
            job = ci.get("job")
            if jobs is None:
                detail.append("ci workflow %r does not exist" % ci.get("workflow"))
            elif jobs and job and job not in jobs:
                detail.append("ci job %r is not defined in %s" % (job, ci.get("workflow")))
            elif not jobs:
                detail.append("could not parse jobs from %s" % ci.get("workflow"))
        problems.append((gid, detail or ["no runners and no ci block"]))
    print("check-gate-runners: %d required gate(s), %d with a reachable runner"
          % (checked, checked - len(problems)))
    if problems:
        print("")
        for gid, detail in problems:
            print("  UNREACHABLE %-22s %s" % (gid, "; ".join(detail)))
        print("")
        print("A gate marked required that nothing can run is a claim, not an enforcement.")
        print("Add it to scripts/check.sh (and name the step exactly) or give it a ci block.")
        return 1
    print("OK: every required gate names a runner this tree can reach.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
