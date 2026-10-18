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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    root = repo_root()
    gp = root / GATES
    try:
        data = json.loads(gp.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print("check-gate-runners: cannot read %s: %s" % (GATES, exc), file=sys.stderr)
        return 2

    gates = data.get("gates") or []
    steps = check_sh_steps(root)
    problems = []
    checked = 0

    for g in gates:
        if g.get("status") != "required":
            continue
        checked += 1
        gid = g.get("id", "?")
        runners = g.get("runners") or {}
        reachable = False
        ci_broken = False
        detail = []

        for name, listed in runners.items():
            listed = listed or []
            if name == "check.sh":
                live = [s for s in listed if s in steps]
                dead = [s for s in listed if s not in steps]
                if live:
                    reachable = True
                if dead:
                    detail.append("check.sh step(s) not in %s: %s"
                                  % (CHECK_SH, ", ".join(dead)))
            elif npm_script_exists(root, name, listed):
                reachable = True
            else:
                detail.append("runner %r names neither a file nor an npm script "
                              "that defines %s" % (name, ", ".join(listed) or "anything"))

        ci = g.get("ci")
        if ci:
            wf = root / ".github" / "workflows" / str(ci.get("workflow", ""))
            job = ci.get("job")
            # A BAD ci block is a finding in its own right, not merely a
            # non-contribution. The first version only *added* reachability and
            # never removed it, so a gate whose check.sh step was fine but whose
            # ci block named a nonexistent job still reported reachable -- the
            # exact under-reporting this checker exists to prevent, one level up.
            if not wf.is_file():
                detail.append("ci workflow %r does not exist" % ci.get("workflow"))
                ci_broken = True
            else:
                jobs = workflow_jobs(wf)
                if jobs and job and job not in jobs:
                    detail.append("ci job %r is not defined in %s" % (job, wf.name))
                    ci_broken = True
                elif jobs and job:
                    reachable = True
                elif not jobs:
                    detail.append("could not parse jobs from %s" % wf.name)

        if not reachable or ci_broken:
            problems.append((gid, detail or ["no runners and no ci block"]))
        elif detail and args.verbose:
            print("  note %-22s %s" % (gid, "; ".join(detail)))

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
