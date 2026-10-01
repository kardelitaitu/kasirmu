#!/usr/bin/env python3
r"""
scripts/verify-gate-completeness.py — caught a gate step no roster row claims.

WHY
===

`scripts/gates.json` is the manifest of gates: for each one it records which
`step "..."` in check.sh runs it. `check-gate-runners.py` checks the OTHER direction —
that every label DECLARED in the roster resolves to a real step.

NOTHING checked that every step is DECLARED. The gap is invisible from the manifest
side: a step with no row simply is not in the list being iterated, so no tool that
walks the roster can see it. Round 148 found one such step by accident (the core-size
ratchet, which had run for months unrostered); round 149 matched every step against
every label and found seven, including `script tests` — a whole suite that had been red
for an unknown period BECAUSE nothing ran it, and was still unclaimed after it was wired.

WHAT IT CHECKS
==============

Every `step "<name>"` in scripts/check.sh is claimed by a label in gates.json, EXACTLY.
Exact is the right test here and prefix-matching is not, and the difference is measured
rather than assumed: `check-gate-runners.py` accepts a prefix because some steps are
spelled with a decorator ('clippy workspace', 'no-raw-params (ADR #7 Phase 4)'), and a
space is both a decorator separator and a word boundary. That looseness is correct in
that direction (it validates labels the roster already names) and WRONG in this one:
while the `migration` row declared the bare label "migration", the resolver reported
`migration smoke test` as claimed by prefix while `migration idempotency` was claimed by
nothing at all. Demanding an exact claim is what makes the omission visible.

The tree satisfies that today — 120 of 120 steps claimed exactly, 0 by prefix alone —
so this gate starts green, which is the property round 109 established a new gate needs.

WHAT ELSE THE ROSTER CLAIMS, and where each is checked (audited 2026-10-05, round 153).
This file covers three axes; the rest are covered elsewhere, and the point of listing them
is that the list was enumerated rather than assumed:

  runners      every label resolves to a step ......... check-gate-runners.py
  runners      every step is claimed by a label ........ THIS FILE (exact, not prefix)
  ci.workflow  the workflow file exists ............... THIS FILE
  ci.job       the job exists in that workflow ........ THIS FILE
  ci.step      the step exists in that job ............ THIS FILE
  self_test    the command names a real script that
               declares the flag ...................... THIS FILE
  status       one of required / advisory /
               required-on-push / retired ............ verify-ci-docs-drift.py load_gates()
  label        present on every gate .................. by construction; no gate lacks one
  _runner_note read by the resolver that needs it ..... check-gate-runners.py
  _note        read by the drift checker .............. verify-ci-docs-drift.py

  note, _parser_note  read by nobody, and both are correct as prose for a human reader
                      (`fuzz` carries a substantive note beside its _note; client-type-drift
                      explains why a naive parser breaks on its inputs).

`required-on-push` is a value load_gates() accepts and NO gate currently uses. That is a
handled-but-unused branch rather than a defect; noted so the next reader does not mistake
it for a typo in the enum.

This is the full field set of a gate record. If a NEW field is added, it is unvalidated by
definition until something reads it — which is the gap rounds 148-152 each closed one axis
at a time.

Exit 0 clean, 1 unclaimed step(s), 2 usage or self-test failure.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECK_SH = ROOT / "scripts" / "check.sh"
GATES_JSON = ROOT / "scripts" / "gates.json"

# `step "<name>" <retry-cmd> <cmd>` — the name is the first quoted field.
STEP_RE = re.compile(r'(?m)^step\s+"([^"]+)"')


def check_steps(text: str) -> list[str]:
    return STEP_RE.findall(text)


WORKFLOWS = ROOT / ".github" / "workflows"

# The complete field vocabulary of a gate record, and of its two sub-objects. Derived by
# enumerating what the manifest actually uses, then frozen here ON PURPOSE: the point is
# that adding a field requires editing this list, because an unrecognised key is how a
# claim goes missing without anything reporting it. Round 154 measured the failure --
# renaming `runners` to `runner` on one gate dropped its label from the declared set
# (166 -> 164), left the step it backed claimed by nothing, and EVERY checker still
# exited 0. A field is unvalidated by definition until something reads it.
GATE_FIELDS = frozenset({
    "id", "label", "status", "runners", "ci", "self_test",
    "note", "_note", "_runner_note", "_parser_note",
})
RUNNER_FIELDS = frozenset({"check.sh", "check:all"})
CI_FIELDS = frozenset({"workflow", "job", "step", "steps"})


def workflow_jobs(text: str) -> set[str]:
    """Job keys of a workflow file: two-space-indented names under `jobs:`."""
    m = re.search(r"(?m)^jobs:\s*$", text)
    if not m:
        return set()
    return set(re.findall(r"(?m)^  ([A-Za-z0-9_-]+):\s*$", text[m.end():]))


def job_steps(text: str, job: str) -> list[str] | None:
    """The `- name:` values inside one job's block, or None when the job is absent."""
    m = re.search(r"(?m)^  " + re.escape(job) + r":\s*$", text)
    if not m:
        return None
    rest = text[m.end():]
    nxt = re.search(r"(?m)^  [A-Za-z0-9_-]+:\s*$", rest)
    block = rest[:nxt.start()] if nxt else rest
    return re.findall(r"(?m)^\s*- name:\s*(.+?)\s*$", block)


def ci_findings_in(ci: dict, workflow_text: str) -> list[str]:
    """Findings for one gate's `ci` block against a workflow's text.

    Split out so the self-test can drive the REAL logic with a fixture workflow instead of
    reimplementing it -- see the note at its case loop. ci_claim_findings reads the files
    and delegates here, so there is exactly ONE implementation of the rule.
    """
    out: list[str] = []
    wf = ci.get("workflow")
    job = ci.get("job")
    if not wf or not job:
        return out
    if job not in workflow_jobs(workflow_text):
        out.append("ci.job %r is not a job in %s" % (job, wf))
        return out
    found = job_steps(workflow_text, job) or []
    step = ci.get("step")
    if step and step not in found:
        out.append("ci.step %r is not a step in %s/%s" % (step, wf, job))
    for one in (ci.get("steps") or []):
        if one not in found:
            out.append("ci.steps %r is not a step in %s/%s" % (one, wf, job))
    return out


def ci_claim_findings(manifest: dict) -> list[str]:
    """Gates whose `ci` block names a workflow, job or step that does not exist.

    The roster makes a finer claim than a `runners` label: a gate can say WHICH workflow
    and WHICH job runs it, and optionally WHICH step inside that job. Nothing validated
    the job axis before this -- `ftl-attrs` claimed job `i18n` while its step actually
    sits in `static-gates`, and every check passed, because the label-side validator only
    looks at `runners`.
    """
    out: list[str] = []
    for gate in manifest.get("gates", []):
        ci = gate.get("ci") or {}
        wf, job = ci.get("workflow"), ci.get("job")
        if not wf or not job:
            continue
        path = WORKFLOWS / wf
        if not path.is_file():
            out.append("%s: ci.workflow %r does not exist" % (gate.get("id"), wf))
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for finding in ci_findings_in(ci, text):
            out.append("%s: %s" % (gate.get("id"), finding))
    return out


def schema_findings(manifest: dict) -> list[str]:
    """Keys the manifest uses that no validator knows about.

    The failure this catches, measured in round 154: renaming a gate key -- `runners` to
    `runner` -- silently removes its runner claim. The label disappears from the declared
    set, the step it backed becomes claimed by nothing, and every checker exits 0, because
    an unknown key is simply not in any `get()` a validator performs.

    A misspelled key and a deliberately new field are indistinguishable to a reader, so
    both stop here: adding a field means adding it to the vocabulary above, which is the
    moment to decide what validates it.
    """
    out: list[str] = []
    for gate in manifest.get("gates", []):
        gid = gate.get("id")
        for key in sorted(set(gate) - GATE_FIELDS):
            out.append("%s: unknown gate field %r" % (gid, key))
        for key in sorted(set(gate.get("runners") or {}) - RUNNER_FIELDS):
            out.append("%s: unknown runners.* key %r" % (gid, key))
        for key in sorted(set(gate.get("ci") or {}) - CI_FIELDS):
            out.append("%s: unknown ci.* key %r" % (gid, key))
    return out


def declared_labels(manifest: dict) -> list[str]:
    out: list[str] = []
    for gate in manifest.get("gates", []):
        for labels in (gate.get("runners") or {}).values():
            out.extend(labels)
    return out


def unclaimed(steps: list[str], labels: list[str]) -> list[str]:
    """Steps no label names EXACTLY. Prefix matching is deliberately NOT used."""
    known = set(labels)
    return [s for s in steps if s not in known]


# A miniature workflow used by the ci-block cases above. Two jobs, and the step that
# `ftl-attrs` really lives in, so the cases exercise the defect as it actually occurred:
# a gate that named `i18n` while its step sat in `static-gates`.
STEP_TEXT = (
    "jobs:\n"
    "  i18n:\n"
    "    steps:\n"
    "      - name: i18n bundle parity\n"
    "      - name: Something else\n"
    "  static-gates:\n"
    "    steps:\n"
    "      - name: i18n bundle parity\n"
    "      - name: FTL attribute requests\n"
)


def selftest_findings(manifest: dict) -> list[str]:
    """Gates whose `self_test` command does not name a script that exists and takes the flag.

    Three gates record the exact command that proves them. Nothing read it: verify-selftests-
    wired.py infers wiring from SOURCE TEXT and never opens gates.json, so a drifted command
    here would be a claim no tool could falsify. This checks the two properties that make the
    claim meaningful -- the named script exists under scripts/, and it is invoked with
    `--self-test` -- without running it, since running is the runner job and a gate that
    shells out to other gates is a gate whose failure is hard to attribute.
    """
    out: list[str] = []
    for gate in manifest.get("gates", []):
        command = gate.get("self_test")
        if not command:
            continue
        gid = gate.get("id")
        if "--self-test" not in command:
            out.append("%s: self_test does not pass --self-test: %r" % (gid, command))
            continue
        m = re.search(r"(?:^|\s)(scripts/[A-Za-z0-9_.-]+)", command)
        if not m:
            out.append("%s: self_test names no script under scripts/: %r" % (gid, command))
            continue
        target = ROOT / m.group(1)
        if not target.is_file():
            out.append("%s: self_test runs %s, which does not exist" % (gid, m.group(1)))
        elif "--self-test" not in target.read_text(encoding="utf-8", errors="replace"):
            out.append("%s: self_test passes --self-test to %s, which does not declare it"
                       % (gid, m.group(1)))
    return out


def _self_test() -> int:
    """Both directions on the shape that hid a real gate.

    Case 2 is the defect: `migration idempotency` is a step whose only 'claim' was the
    PREFIX `migration`, which `check-gate-runners.py` accepts. This gate must reject it,
    because that is the omission it exists to find.
    """
    steps = ["migration smoke test", "migration idempotency", "merged lines"]
    cases: list[tuple[str, list[str], int]] = [
        # `steps` has three entries, so every expectation counts the ones left over.
        ("a step named exactly by a label is claimed",
         ["migration smoke test", "migration idempotency", "merged lines"], 0),
        ("a step covered only by a PREFIX is NOT claimed",
         ["migration", "merged lines"], 2),
        ("naming one of two sibling steps leaves the other",
         ["migration smoke test", "merged lines"], 1),
        ("naming both siblings claims both",
         ["migration smoke test", "migration idempotency", "merged lines"], 0),
        ("an empty roster claims nothing", [], 3),
    ]
    # The ci-block axis, on the defect that motivated it: a gate claiming the wrong job.
    ci_cases: list[tuple[str, dict, str, int]] = [
        ("a correct job and step resolve",
         {"workflow": "dev-ci.yml", "job": "static-gates", "step": "i18n bundle parity"},
         STEP_TEXT, 0),
        ("a job that does not exist is a finding",
         {"workflow": "dev-ci.yml", "job": "no-such-job", "step": "i18n bundle parity"},
         STEP_TEXT, 1),
        ("a step belonging to a DIFFERENT job is a finding",
         {"workflow": "dev-ci.yml", "job": "i18n", "step": "FTL attribute requests"},
         STEP_TEXT, 1),
        # A job absent from the workflow. The job-exists arm was unpinned until round 155:
        # disabling it survived the whole suite. ci_findings_in has three arms and each
        # now has a case, which is the property that made the other two mutations kill.
        # NO `step` KEY, deliberately: with a step present the step-arm reports one
        # finding of its own, so the COUNT is the same whether or not the job arm fires --
        # which is why the first version of this case left the job arm unpinned. Omitting
        # the step makes the job arm the only thing that can produce a finding.
        ("a job absent from the workflow is a finding",
         {"workflow": "dev-ci.yml", "job": "no-such-job"},
         STEP_TEXT, 1),
        # The PLURAL `ci.steps` LIST, which 18 gates use. This arm had no case until round
        # 155, and a mutation that emptied its loop survived the whole suite. The live run
        # DID catch a broken entry, so the function was never wrong -- the fixture pool was
        # just missing the one case that pins this arm.
        ("a good entry in the ci.steps LIST resolves",
         {"workflow": "dev-ci.yml", "job": "static-gates",
          "steps": ["FTL attribute requests"]},
         STEP_TEXT, 0),
        ("a bad entry in the ci.steps LIST is a finding",
         {"workflow": "dev-ci.yml", "job": "static-gates", "steps": ["No Such Step"]},
         STEP_TEXT, 1),
        # The missing-WORKFLOW arm is not covered here: it reads the filesystem, and every
        # case in this list goes through the pure helpers so a fixture cannot accidentally
        # assert against the real workflow files. That arm is exercised by the live run.
    ]
    # self_test claims, through the real function: it reads scripts/ from disk, so these
    # cases name scripts that genuinely exist rather than fabricated fixtures.
    # Schema cases, on the defect round 154 measured: a renamed key removes a claim and
    # every check still exits 0.
    schema_cases: list[tuple[str, dict, int]] = [
        ("a well-formed gate is clean",
         {"id": "g", "label": "G", "status": "required", "runners": {"check.sh": ["x"]}}, 0),
        ("a renamed runners key is a finding",
         {"id": "g", "label": "G", "status": "required", "runner": {"check.sh": ["x"]}}, 1),
        ("an unknown ci key is a finding",
         {"id": "g", "label": "G", "status": "required", "ci": {"workflow": "w", "jobs": "j"}}, 1),
        ("an unknown runners.* key is a finding",
         {"id": "g", "label": "G", "status": "required", "runners": {"check.shh": ["x"]}}, 1),
        ("ci.steps is a known key, not a typo of ci.step",
         {"id": "g", "label": "G", "status": "required", "ci": {"workflow": "w", "job": "j", "steps": []}}, 0),
    ]
    st_cases: list[tuple[str, str, int]] = [
        ("an accurate self_test command passes",
         "python3 scripts/verify-gate-completeness.py --self-test", 0),
        ("a command omitting the flag is a finding",
         "python3 scripts/verify-core-size.py", 1),
        ("a command naming no script is a finding",
         "python3 --self-test", 1),
        ("a command naming a missing script is a finding",
         "python3 scripts/no-such-checker.py --self-test", 1),
        ("a script that does not declare the flag is a finding",
         "python3 scripts/verify-docker-all.sh --self-test", 1),
    ]
    bad = 0
    for name, labels, want in cases:
        got = len(unclaimed(steps, labels))
        if got != want:
            bad += 1
            print("  %-52s FAIL want=%d got=%d" % (name, want, got))
        else:
            print("  %-52s ok" % name)
    # DRIVE THE REAL FUNCTION, never a reimplementation of its rule. Round 155 measured
    # the cost of the other choice: this loop used to repeat the ci.steps logic inline,
    # so emptying that loop inside ci_findings_in left every case green while the live
    # check was dead -- a case asserting against test-shaped code, which is the same
    # failure as asserting against production and harder to notice. ci_findings_in takes
    # the workflow TEXT so a fixture is a real input, not a stub.
    for name, ci, text, want in ci_cases:
        got = 1 if ci_findings_in(ci, text) else 0
        if got != want:
            bad += 1
            print("  %-52s FAIL want=%d got=%d" % (name, want, got))
        else:
            print("  %-52s ok" % name)
    for name, gate, want in schema_cases:
        got = len(schema_findings({"gates": [gate]}))
        if got != want:
            bad += 1
            print("  %-52s FAIL want=%d got=%d" % (name, want, got))
        else:
            print("  %-52s ok" % name)
    for name, command, want in st_cases:
        got = len(selftest_findings({"gates": [{"id": "under-test", "self_test": command}]}))
        if got != want:
            bad += 1
            print("  %-52s FAIL want=%d got=%d" % (name, want, got))
        else:
            print("  %-52s ok" % name)
    print("SELF-TEST %s (%d cases, no files touched)"
          % ("FAILED" if bad else "OK",
             len(cases) + len(ci_cases) + len(st_cases) + len(schema_cases)))
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="run the extractor cases and exit; touches no files")
    args = ap.parse_args()
    if args.self_test:
        return _self_test()

    for path in (CHECK_SH, GATES_JSON):
        if not path.is_file():
            print("refused: %s does not exist" % path)
            return 2

    steps = check_steps(CHECK_SH.read_text(encoding="utf-8", errors="replace"))
    manifest = json.loads(GATES_JSON.read_text(encoding="utf-8"))
    labels = declared_labels(manifest)
    missing = unclaimed(steps, labels)
    ci_bad = ci_claim_findings(manifest)
    st_bad = selftest_findings(manifest)
    schema_bad = schema_findings(manifest)

    for name in missing:
        print("  unclaimed step: %r -- no gates.json row names it" % name)
    for line in ci_bad:
        print("  bad ci claim: %s" % line)
    for line in st_bad:
        print("  bad self_test claim: %s" % line)
    for line in schema_bad:
        print("  unknown field: %s" % line)
    print("checked %d check.sh step(s) against %d declared runner label(s)"
          % (len(steps), len(labels)))
    print("checked the ci block of %d gate(s) against the workflow files"
          % sum(1 for g in manifest.get("gates", []) if (g.get("ci") or {}).get("job")))
    print("checked the self_test command of %d gate(s)"
          % sum(1 for g in manifest.get("gates", []) if g.get("self_test")))
    print("checked the field vocabulary: %d gate field(s), %d runners.* key(s), %d ci.* key(s)"
          % (len(GATE_FIELDS), len(RUNNER_FIELDS), len(CI_FIELDS)))
    if ci_bad or st_bad or schema_bad:
        print("FAIL: %d bad ci claim(s), %d bad self_test claim(s), %d unknown field(s). A wrong"
              " job name tells an auditor a gate is enforced somewhere it is not; an"
              " unreadable self_test command is a claim no tool can falsify; and an UNKNOWN"
              " field is worse than both, because a renamed key removes a claim silently --"
              " every check still exits 0." % (len(ci_bad), len(st_bad), len(schema_bad)))
        return 1
    if missing:
        print("FAIL: %d step(s) no roster row claims. A step with no row is invisible "
              "to verify-ci-docs-drift.py, which iterates the gates PRESENT in the "
              "manifest -- so it can never be reported as required-but-unenforced."
              % len(missing))
        return 1
    print("OK: every check.sh step is named by a gates.json runner label")
    return 0


if __name__ == "__main__":
    sys.exit(main())
