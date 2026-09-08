#!/usr/bin/env python3
"""check-ci-claims.py - fail when a live doc asserts CI facts the workflows contradict.

Four real findings produced this check, all in one session:
  - website/README.md said CI deploys on every push to main via a workflow that had been
    retired to .bak. GitHub never executes a .bak file, and dev-ci.yml has no push trigger
    at all, so pushing ran nothing.
  - CONTRIBUTING.md credited a CI coverage job with uploading artifacts. A coverage job
    exists only in ci.yml.bak.
  - ui/e2e/README.md described the e2e job in a retired workflow in present tense. No live
    workflow defines e2e, and AGENTS.md itself says E2E is not enforced in CI.
  - docs/releases/checklist.md made the OPPOSITE error: it dismissed release-validate as
    dead because release.yml had once been renamed to .bak and was later restored, so the
    doc denied a gate that really does run.

Both directions are one class: a document asserting something about CI that the workflow
files contradict. verify-ci-docs-drift.py does not cover it - it compares docs to
scripts/gates.json and never reads the workflow graph - so nothing looked at both sides.

A .yml.bak contributes nothing, because GitHub only reads *.yml. Docs may still discuss
retirement, so a line already hedged in the right direction is not a finding. Suppress
deliberate historical text with  <!-- ci-claim: ok: reason -->  on the line or above it.

Usage: check-ci-claims.py [--verbose] [--self-test]
Exit 0 clean, 1 findings, 2 if no live workflow or job could be read - a CI checker that
sees nothing must never report clean.
"""
import argparse
import os
import re
import subprocess
import sys

WF_DIR = ".github/workflows"
NOT_JOB = set(["push", "pull_request", "workflow_dispatch", "workflow_call", "schedule",
              "tags", "branches", "branches-ignore", "paths", "paths-ignore", "types",
              "jobs", "on", "env", "defaults", "permissions", "concurrency", "name",
              "run", "steps", "uses", "with", "needs", "if", "strategy", "matrix",
              "timeout-minutes", "runs-on", "contents", "actions", "id-token",
              "deployments", "inputs", "outputs", "container", "secrets"])
STOP_WORDS = set(["yml", "bak", "sh", "py", "rs", "md", "ci", "true", "false", "main",
                  "tag", "ok", "the", "job", "step", "gate"])
SKIP_DIR = ("docs/archived", "/archived", "node_modules", "references", "target/", "dist/")
JOURNAL_SUFFIX = ("-journal.md", ".md.bak", ".bak")
HEDGE = ("no longer", "used to", "retire", "does not run", "never run", "not run",
         "not enforced", "no such", "there is no", "no job named", "absent", "inert",
         "dead", "only in", "existed", "formerly", "was removed", "no live", "nothing",
         "never executed", "never executes")
NL = chr(10)
BS = chr(92)


HEDGE2 = (".bak", "retire", "claimed as enforced", "was claimed", "it is not",
        "not true", "does not exist", "does not enforce", "no job", "defines",
        "contains an", "never defines")

def job_block(name, step):
    return "  " + name + ":" + NL + "    steps:" + NL + "      - name: " + step + NL


def jobs_only(lines):
    """Return only the region below the top-level jobs: key, or [] if absent.

    Without this a 2-space key under env:, with: or strategy: that sits above a steps:
    list is read as a job, so the live job set comes back containing CARGO_TERM_COLOR,
    RUSTFLAGS, SCCACHE_GHA_ENABLED and cancel-in-progress. A checker whose ground
    truth is noise flags honest sentences about real jobs and clears false ones about
    fake jobs, so scoping the region carries the tool. Pattern-match second."""
    for i, l in enumerate(lines):
        if l.rstrip() == "jobs:" and i + 1 < len(lines):
            return lines[i:]
    return []


def parse_ci(files):
    """files: {workflow_basename: text} -> {name: set(job)}. A job is a 2-space key that
    carries its own steps/uses/services list, so trigger metadata never counts as a job."""
    jobs = {}
    for nm, txt in files.items():
        lines = jobs_only(txt.split(NL))
        found = set()
        for i, l in enumerate(lines):
            m = re.match("^  ([A-Za-z][A-Za-z0-9_-]*):", l)
            if not m or m.group(1) in NOT_JOB:
                continue
            body = NL.join(lines[i:i + 80])
            if re.search("^    (steps|uses|services):", body, re.M):
                found.add(m.group(1))
        jobs[nm] = found
    return jobs


def load_live():
    files, baks = {}, set()
    if not os.path.isdir(WF_DIR):
        return {}, set(), baks
    for f in sorted(os.listdir(WF_DIR)):
        if f.endswith(".yml"):
            files[f[:-4]] = open(os.path.join(WF_DIR, f), encoding="utf-8",
                                 errors="replace").read()
        elif f.endswith(".yml.bak"):
            baks.add(f[:-8])
    return parse_ci(files), set(files), baks


def wf_refs(line):
    return [m.group(1) for m in re.finditer("workflows/([A-Za-z0-9_.-]+?)[.]yml", line + " ")]


def job_refs(line):
    return [m.group(1) for m in re.finditer("`([a-z][a-z0-9_-]{2,24})`", line)]


def claims_job(line, nm):
    q = "`" + nm + "`"
    pats = [q + " job", "job named " + q, "the " + q + " job", q + " step"]
    return any(p in line.lower() for p in pats)


def check_text(text, jobs, live, baks, all_jobs):
    """Pure over one document string plus parsed CI state. -> [(line_no, message)]."""
    out = []
    lines = text.split(NL)
    for i, l in enumerate(lines):
        if "ci-claim: ok" in l or (i > 0 and "ci-claim: ok" in lines[i - 1]):
            continue
        low = l.lower()
        hedged = any(h in low for h in HEDGE) or any(h in low for h in HEDGE2)
        for nm in wf_refs(l):
            if nm in live or hedged:
                continue
            if nm in baks:
                out.append((i + 1, "treats " + nm + ".yml as CI, but only " + nm +
                            ".yml.bak exists and GitHub never executes a .bak file"))
            else:
                out.append((i + 1, "names " + nm + ".yml, which exists neither live nor as"
                            " a .bak"))
        if "job" in low and not hedged:
            for nm in job_refs(l):
                if nm in NOT_JOB or nm in STOP_WORDS or nm in all_jobs:
                    continue
                if claims_job(l, nm):
                    out.append((i + 1, "claims a job named " + nm + " that no live workflow"
                                " defines (live jobs: " + ", ".join(sorted(all_jobs)) + ")"))
    return out


def tracked_docs():
    try:
        out = subprocess.run(["git", "ls-files", "--", "*.md"], stdout=subprocess.PIPE,
                             text=True, errors="replace").stdout.split()
    except OSError:
        return []
    res = []
    for p in out:
        q = p.replace(BS, "/")
        if q.startswith(WF_DIR) or q.endswith(JOURNAL_SUFFIX):
            continue
        if any(x in q for x in SKIP_DIR):
            continue
        res.append(q)
    return res


HDR = "jobs:" + NL
JOBS = HDR + job_block("changes", "a") + job_block("static-gates", "b") + job_block("i18n", "c")
RJOBS = HDR + job_block("release-validate", "d") + job_block("release-build", "e")

SELF = [
    ("retired workflow cited as live", {"dev-ci.yml": JOBS}, {"dev-ci"}, {"website"},
     "CI deploys via `.github/workflows/website.yml`", True),
    ("live workflow cited", {"dev-ci.yml": JOBS}, {"dev-ci"}, set(),
     "see `.github/workflows/dev-ci.yml`", False),
    ("workflow that exists nowhere", {"dev-ci.yml": JOBS}, {"dev-ci"}, set(),
     "run `.github/workflows/security.yml` weekly", True),
    ("retirement prose allowed", {"dev-ci.yml": JOBS}, {"dev-ci"}, {"website"},
     "website.yml was retired to .bak and no longer runs", False),
    ("phantom job", {"dev-ci.yml": JOBS}, {"dev-ci"}, set(),
     "The `coverage` job uploads the artifact", True),
    ("real job passes", {"dev-ci.yml": JOBS}, {"dev-ci"}, set(),
     "The `static-gates` job runs the gate", False),
    ("job in another live workflow", {"dev-ci.yml": JOBS, "release.yml": RJOBS},
     {"dev-ci", "release"}, set(), "The `release-validate` job gates the tag", False),
    ("hedged absence allowed", {"dev-ci.yml": JOBS}, {"dev-ci"}, set(),
     "The `e2e` job no longer exists", False),
    ("denying a live job is allowed", {"dev-ci.yml": JOBS}, {"dev-ci"}, set(),
     "there is no `deploy` job here", False),
    ("pragma suppresses", {"dev-ci.yml": JOBS}, {"dev-ci"}, set(),
     "The `audit` job runs weekly <!-- ci-claim: ok: quoted history -->", False),
]


def self_test():
    bad = 0
    for name, files, live, baks, line, expect in SELF:
        jj = parse_ci(files)
        all_jobs = set()
        for s in jj.values():
            all_jobs |= s
        got = bool(check_text(line, jj, live, baks, all_jobs))
        if got != expect:
            bad += 1
            print("  FAIL " + name + ": expected flag=" + str(expect) + ", got " + str(got))
        else:
            print("  ok   " + name)
    if bad:
        print("SELF-TEST FAILED (" + str(bad) + " of " + str(len(SELF)) + ")")
        return 1
    print("SELF-TEST OK (" + str(len(SELF)) + " cases, no files touched)")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    jobs, live, baks = load_live()
    all_jobs = set()
    for s in jobs.values():
        all_jobs |= s
    if not live or not all_jobs:
        print("check-ci-claims: cannot read any live workflow or job; refusing to report"
              + " clean", file=sys.stderr)
        return 2
    total, hit = 0, 0
    for p in tracked_docs():
        try:
            text = open(p, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        f = check_text(text, jobs, live, baks, all_jobs)
        if f:
            hit += 1
            total += len(f)
            for ln, why in f:
                print(p + ":" + str(ln) + ": " + why)
                if a.verbose:
                    print("    | " + text.split(NL)[ln - 1].strip()[:140])
    print("check-ci-claims: " + str(total) + " finding(s) in " + str(hit) + " doc(s); "
          + str(len(all_jobs)) + " live job(s) in " + str(len(live)) + " workflow(s)")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
