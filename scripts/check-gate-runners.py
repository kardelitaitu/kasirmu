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

  - CI steps against `- name: <step>` IN THE DECLARED JOB. Whole-file matching
    was replaced 2026-11-08: a step present in the workflow but under a
    DIFFERENT job passed the old matcher, and drift's dangling_ci_refs checks
    job EXISTENCE only (verify-ci-docs-drift.py:326), so the containment
    promise was unchecked. Measured before wiring: 63 declared steps across 18
    jobs in dev-ci.yml, zero misfiled -- but four of 171 distinct step names
    span 2-5 jobs (shared setup like "Install cargo-nextest"), so whole-file
    matching had real ambiguity to misresolve. A row naming any workflow other
    than dev-ci.yml is REFUSED rather than resolved against the wrong file (all
    116 ci-bearing rows name dev-ci.yml today, so the refusal is latent).
  - REVERSE direction on the ci axis: every CI step that RUNS a checker script
    must resolve to the roster or check.sh -- a step invoking scripts/<x> with
    no row naming it, no gates.json mention of <x>, and no check.sh presence is
    a finding, across EVERY file in .github/workflows (the axis is CI, not one
    file). Wired 2026-11-08, measured first: 146 distinct (step,
    script) invocations across 5 files, zero unrecorded; the one prose mention
    (a website prebuild script named inside the Route step's comment) is
    removed by whole-line comment stripping, and website.yml's deploy step
    (wrangler-deploy.sh) is exempt via the explicit TOOLING_SCRIPTS allowlist
    -- deploy scripts are not gates. Both drift and this checker iterate
    gates, so only a step-first walk can see a step with no row -- the
    founding blind spot, closed on its last open axis.
  - PARITY guard on the reverse walk (2026-11-08): per file, the raw `- name:`
    list-item count must equal the parsed step count or the checker REFUSES --
    a shape change that made the parser miss steps would otherwise silently
    under-report the very findings this walk exists to catch.
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


def cross_job_step_names(job_steps: dict[str, list[str]]) -> list[tuple[str, list[str]]]:
    """Step names that appear under MORE THAN ONE job, with the jobs.

    Shared setup steps are legitimate -- these are exactly the names the old
    whole-file matcher could resolve from the wrong job, which is why
    job-scoped resolution exists. Census, not a finding (2026-11-08: four of
    171 distinct names, e.g. "Install cargo-nextest" in three jobs)."""
    owners: dict[str, list[str]] = {}
    for job, steps in job_steps.items():
        for st in steps:
            owners.setdefault(st, []).append(job)
    return sorted((st, js) for st, js in owners.items() if len(js) > 1)


def parse_parity(text: str, parsed_count: int) -> bool:
    """True when the parser collected every `- name:` list item the file shows.

    The reverse walk is only as honest as the step parse: a workflow whose
    step items sit at an indent the parser does not visit would be SILENTLY
    under-reported (a blind spot rebuilt by a shape change). Parity compares
    the raw list-item count against the parsed step count and lets main()
    refuse on mismatch -- a loud refusal beats a quiet partial walk."""
    return len(re.findall(r"^\s+- name:\s", text, re.M)) == parsed_count


def workflow_steps_with_runs(text: str) -> dict[str, list[tuple[str, str]]]:
    """Parse the workflow into {job: [(step name, run text)]}.

    Same walk as the step-name parser, but also captures each step's `run:`
    payload -- a single-line `run: cmd`, or a `run: |` block's lines collected
    while more-indented than the `run:` key (blank lines pass through). Steps
    driven by `uses:` carry an empty run. Comment lines are kept verbatim here;
    unclaimed_ci_invocations strips them, because dev-ci.yml's Route step
    MENTIONS a website prebuild script in prose (the one measured false
    positive, 2026-11-08)."""
    jobs: dict[str, list[tuple[str, str]]] = {}
    in_jobs = False
    cur = None
    step = None
    collecting = False
    run_indent = 0
    for line in text.splitlines():
        if re.match(r"^jobs:\s*$", line):
            in_jobs = True
            cur = None
            step = None
            collecting = False
            continue
        if not in_jobs:
            continue
        m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if m:
            cur = m.group(1)
            jobs[cur] = []
            step = None
            collecting = False
            continue
        if line and not line[0].isspace():
            in_jobs = False
            cur = None
            step = None
            collecting = False
            continue
        m = re.match(r"^\s+- name:\s*(.*?)\s*$", line)
        if m and cur is not None:
            step = [m.group(1).strip().strip('"'), ""]
            jobs[cur].append(step)
            collecting = False
            continue
        if step is None:
            continue
        if collecting:
            if line.strip() == "":
                step[1] += "\n"
                continue
            indent = len(line) - len(line.lstrip())
            if indent < run_indent:
                collecting = False
            else:
                step[1] += line.strip() + "\n"
            continue
        m = re.match(r"^(\s+)run:\s*(.*?)\s*$", line)
        if m and not step[1]:
            rest = m.group(2)
            if rest and not rest.startswith(("|", ">")):
                step[1] = rest + "\n"
            else:
                run_indent = len(m.group(1)) + 2
                collecting = True
    return {job: [(nm, r) for nm, r in steps]
            for job, steps in jobs.items()}


def workflow_job_steps(text: str) -> dict[str, list[str]]:
    """Parse the workflow into {job: [step names]}, list items only.

    GitHub Actions job keys sit at two-space indent under the top-level `jobs:`
    key; a step name is a `- name:` LIST ITEM inside the job. A bare `name:`
    (job-level metadata) is not a list item and is not collected -- the old
    whole-file extraction could not tell the two apart."""
    return {job: [name for name, _ in steps]
            for job, steps in workflow_steps_with_runs(text).items()}


def non_devci_workflows(gates) -> list[tuple[str, str]]:
    """Rows declaring a workflow this checker does not parse.

    CI resolution reads dev-ci.yml only; a row naming another workflow would
    otherwise have its steps resolved against the WRONG file's names. Measured
    2026-11-08: all 116 ci-bearing rows name dev-ci.yml, so the refusal in main()
    is latent, not live."""
    return [(g.get("id", "?"), g["ci"]["workflow"])
            for g in gates
            if isinstance((g.get("ci") or {}).get("workflow"), str)
            and g["ci"]["workflow"] != "dev-ci.yml"]


# Deploy/build tooling that CI runs but which is not a gate. EXPLICIT and dated:
# an addition must name the script's reader and why it is not a checker. Measured
# 2026-11-08: one member -- website.yml#Deploy runs wrangler-deploy.sh, which
# reads CLOUDFLARE_API_TOKEN and exits 1 without it (scripts/wrangler-deploy.sh:52-70).
TOOLING_SCRIPTS = {"wrangler-deploy.sh"}


def unclaimed_ci_invocations(runs, declared_steps, roster_text, sh_text):
    """CI steps invoking a checker script that NOTHING records.

    The reverse direction on the ci axis: gate_findings resolves declared ->
    actual; this walks ACTUAL -> declared, so a checker CI runs can no longer
    escape every gate-iterating checker. An invocation is blind-spot-free when
    any one of these holds: a row names the step in ci.steps, the script name
    appears anywhere in gates.json (a needle or self-test resolves to it), or
    the script runs in check.sh (where verify-gate-completeness enforces the
    claim), or the script is in TOOLING_SCRIPTS (deploy/build helpers are not
    gates). Whole-line comments are stripped first -- prose mentions of other
    scripts are not invocations. Measured 2026-11-08 across ALL workflow files:
    146 distinct (step, script) invocations, zero genuinely unrecorded."""
    out = []
    for job, steps in sorted(runs.items()):
        for name, run in steps:
            if not run or name in declared_steps:
                continue
            body = "\n".join(l for l in run.splitlines()
                             if not l.lstrip().startswith("#"))
            for m in re.finditer(
                    r"((?:scripts/|.agents/skills/[a-z0-9-]+/scripts/)"
                    r"[A-Za-z0-9_./-]+\.(?:py|mjs|sh|ps1))", body):
                script = m.group(1).split("/")[-1]
                if script in TOOLING_SCRIPTS or script in roster_text or script in sh_text:
                    continue
                out.append((job, name, script))
    return out


def gate_findings(gates, job_steps: dict[str, list[str]], sh_steps: list[str],
                  inline_markers=None):
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
        ci = g.get("ci") or {}
        steps = ci.get("steps") or []
        if steps:
            allowed = job_steps.get(ci.get("job"))
            if allowed is None:
                out.append((gid, "ci-job", ci.get("job")))
            else:
                for step in steps:
                    if step not in allowed:
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
             [{"id": "cov", "ci": {"workflow": "dev-ci.yml", "job": "a",
                                  "steps": ["Nope"]}}],
             {"a": ["Real"]}, [])],
         ["Nope"]),
        ("a stale check.sh runner is reported",
         [x[2] for x in gate_findings(
             [{"id": "cov", "runners": {"check.sh": ["Nope"]}}], {}, ["Real"])],
         ["Nope"]),
        ("a step in the declared job resolves",
         gate_findings(
             [{"id": "g", "ci": {"workflow": "dev-ci.yml", "job": "a",
                                  "steps": ["X"]}}], {"a": ["X"]}, []),
         []),
        ("a step in the file but a DIFFERENT job does NOT resolve",
         [x[2] for x in gate_findings(
             [{"id": "g", "ci": {"workflow": "dev-ci.yml", "job": "a",
                                  "steps": ["X"]}}], {"a": ["Y"], "b": ["X"]}, [])],
         ["X"]),
        ("a declared job missing from the workflow is a finding",
         [x[1:] for x in gate_findings(
             [{"id": "g", "ci": {"workflow": "dev-ci.yml", "job": "ghost",
                                  "steps": ["X"]}}], {"a": ["X"]}, [])],
         [("ci-job", "ghost")]),
        ("rows without ci steps are not job-checked",
         gate_findings(
             [{"id": "g", "ci": {"workflow": "dev-ci.yml", "job": "a"}}], {}, []),
         []),
        ("workflow_job_steps collects list items only, drops strays",
         workflow_job_steps("jobs:" + chr(10) + '  - name: Stray' + chr(10)
                            + "  a:" + chr(10)
                            + "    steps:" + chr(10) + '      - name: "X"'
                            + chr(10) + "    name: NotAStep" + chr(10) + "  b:"
                            + chr(10) + "    runs-on: z" + chr(10)),
         {"a": ["X"], "b": []}),
        ("a non-devci workflow is refused",
         non_devci_workflows(
             [{"id": "a", "ci": {"workflow": "dev-ci.yml"}},
              {"id": "b", "ci": {"workflow": "website.yml"}}]),
         [("b", "website.yml")]),
        ("workflow_steps_with_runs captures runs",
         workflow_steps_with_runs("jobs:" + chr(10) + "  a:" + chr(10)
                                  + "    steps:" + chr(10) + "      - name: One"
                                  + chr(10) + "        run: python3 scripts/x.py"
                                  + chr(10) + "      - name: Two" + chr(10)
                                  + "        env:" + chr(10) + "          E: v"
                                  + chr(10) + "        run: |" + chr(10)
                                  + "          python3 scripts/y.py" + chr(10)
                                  + "          # see scripts/z.py" + chr(10)
                                  + "        working-directory: ui" + chr(10)
                                  + "  b:" + chr(10) + "    runs-on: z"
                                  + chr(10)),
         {"a": [("One", "python3 scripts/x.py\n"),
                ("Two", "python3 scripts/y.py\n# see scripts/z.py\n")],
          "b": []}),
        ("an unrecorded CI invocation is a finding",
         unclaimed_ci_invocations(
             {"a": [("Ghost", "python3 scripts/ghost-check.py\n")]}, set(),
             "", ""),
         [("a", "Ghost", "ghost-check.py")]),
        ("a script known to the roster or check.sh is not a finding",
         unclaimed_ci_invocations(
             {"a": [("A", "python3 scripts/known.py\n"),
                    ("B", "python3 scripts/other.py\n")]}, set(),
             '"known.py"', "other.py --flag"),
         []),
        ("a comment-only mention is not an invocation",
         unclaimed_ci_invocations(
             {"a": [("C", "# runs scripts/ghost-check.py\n")]}, set(), "", ""),
         []),
        ("a tooling script is exempt",
         unclaimed_ci_invocations(
             {"a": [("Deploy", "bash scripts/wrangler-deploy.sh\n")]},
             set(), "", ""),
         []),
        ("parity holds when every list item is collected",
         parse_parity("jobs:" + chr(10) + "  a:" + chr(10) + "    steps:"
                      + chr(10) + "      - name: X" + chr(10), 1), True),
        ("a missed list item fails parity",
         parse_parity("jobs:" + chr(10) + "  a:" + chr(10) + "    steps:"
                      + chr(10) + "      - name: X" + chr(10), 2), False),
        ("a commented mention is not a list item",
         parse_parity("# - name: prose" + chr(10), 0), True),
        ("a step named by a row is skipped",
         unclaimed_ci_invocations(
             {"a": [("Named", "python3 scripts/ghost-check.py\n")]},
             {"Named"}, "", ""),
         []),
        ("a shared step name is listed with its jobs",
         cross_job_step_names({"a": ["X"], "b": ["X", "Y"]}),
         [("X", ["a", "b"])]),
        ("disjoint job steps are not listed",
         cross_job_step_names({"a": ["X"], "b": ["Y"]}), []),
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

    roster_text = roster.read_text(encoding="utf-8")
    gates = json.loads(roster_text)["gates"]
    ci_text = workflow.read_text(encoding="utf-8", errors="replace")
    sh_text = check_sh.read_text(encoding="utf-8", errors="replace")

    wrong_wf = non_devci_workflows(gates)
    if wrong_wf:
        for gid, wf in wrong_wf:
            print("REFUSED: gate '%s' names workflow '%s'; this checker resolves"
                  " CI claims against dev-ci.yml only -- extend the reader before"
                  " trusting any resolution here." % (gid, wf), file=sys.stderr)
        return 2

    job_steps = workflow_job_steps(ci_text)
    sh_steps = SH_STEP_RE.findall(sh_text)

    findings = gate_findings(gates, job_steps, sh_steps, inline_markers=sh_text)

    declared_sh = [s for g in gates
                   for s in (g.get("runners", {}).get("check.sh") or [])]
    prefixes = prefix_resolutions(declared_sh, sh_steps)

    if not args.quiet:
        print("checked %d gate(s) against %d CI step(s) in %d job(s) and"
              " %d check.sh step(s)"
              % (len(gates), sum(len(v) for v in job_steps.values()),
                 len(job_steps), len(sh_steps)))

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

    collisions = cross_job_step_names(job_steps)
    if collisions and not args.quiet:
        print("  note: %d CI step name(s) appear under more than one job (shared"
              " setup; the ambiguity job-scoped resolution removes):" % len(collisions))
        for name, js in collisions:
            print("    %r <- %s" % (name, ", ".join(js)))

    declared_ci = {s for g in gates
                   for s in ((g.get("ci") or {}).get("steps") or [])}
    wf_dir = root / ".github/workflows"
    wf_files = sorted(wf_dir.glob("*.yml")) + sorted(wf_dir.glob("*.yaml"))
    unclaimed = []
    for wf_path in wf_files:
        wf_text = wf_path.read_text(encoding="utf-8", errors="replace")
        runs = workflow_steps_with_runs(wf_text)
        if not parse_parity(wf_text, sum(len(v) for v in runs.values())):
            print("REFUSED: %s shows more `- name:` list items than the step"
                  " parser collected -- the file outgrew the parser's shape."
                  % wf_path.name, file=sys.stderr)
            print("A partial walk would under-report unrecorded invocations -- "
                  "extend the parser rather than trust it here.", file=sys.stderr)
            return 2
        unclaimed.extend(
            (wf_path.name,) + hit
            for hit in unclaimed_ci_invocations(
                workflow_steps_with_runs(wf_text), declared_ci, roster_text,
                sh_text))

    rc = 0
    if findings:
        print("%d declared runner(s) do not resolve:" % len(findings))
        for gid, runner, step in findings:
            print("  %s -> %s: %r" % (gid, runner, step))
        print("")
        print("A runner label that names no step is a claim nothing checks. Either the")
        print("runner was renamed, or the roster is stale -- resolve which before trusting")
        print("the roster as the source of truth for gate names.")
        rc = 1

    if unclaimed:
        print("%d CI checker invocation(s) recorded nowhere:" % len(unclaimed))
        for wf, job, name, script in unclaimed:
            print("  [%s/%s] %r :: %s" % (wf, job, name, script))
        print("")
        print("A checker CI runs that no row names and check.sh never runs is invisible")
        print("to every gate-iterating checker -- the founding blind spot, ci edition.")
        print("Add a row, name the step in one, or move the checker under check.sh.")
        rc = 1

    if rc:
        return rc

    if not args.quiet:
        print("every declared runner resolves; %d workflow file(s) walked with"
              " %d tooling exemption(s)" % (len(wf_files), len(TOOLING_SCRIPTS)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
