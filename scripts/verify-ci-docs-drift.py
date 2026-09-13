#!/usr/bin/env python3
r"""
scripts/verify-ci-docs-drift.py — Catch CI documentation drift between
docs/operations/ci-pipeline.md, docs/releases/checklist.md, the workflow
definitions, and the local runners.

WHY
===

`docs/operations/ci-pipeline.md` is the canonical CI dashboard (AUDIT-27 CI-08).
When a job is renamed, removed, or moved between workflows, the docs
tables go stale and contributors trust a matrix that no longer matches
what CI actually runs. Likewise, `scripts/check.sh` (repository gate)
and `scripts/check-ui.mjs` (the `check:all` gate) are documented as
sharing a common gate vocabulary — if one drifts, "all checks passed"
means different things per entry point.

`docs/releases/checklist.md` also enumerates the live `dev-ci.yml` jobs by hand,
in the one place a release manager reads at ship time. It went stale the same
week the checker was made blocking, which is the argument for checking it rather
than trusting it.

Since AUDIT-27 CI-08 the gate vocabulary + status live in a SINGLE
source of truth: `scripts/gates.json`. This script derives everything
from that manifest and verifies, fail-closed:

  1. **Jobs:** every job name referenced in `docs/operations/ci-pipeline.md` (the
     Job Matrix and Pre-Merge Validation Gates tables) exists as a real
     job in `.github/workflows/*.yml`.
  2. **Workflow inventory:** every workflow file named in the Workflow
     inventory table exists on disk.
  3. **Gate vocabulary (manifest-driven):** every gate in
     `scripts/gates.json` is declared by the runners it lists
     (`check.sh` / `check:all` needles matched against the extracted
     labels). A manifest gate that no runner declares is drift.
  4. **Gate CI mapping + status (manifest-driven):** every gate's
     `ci.workflow`/`ci.job` reference exists, and the workflow honours
     the gate's declared status:
       * `required`            → the job must NOT have
                                 `continue-on-error: true`
       * `advisory`            → the job (or a step when
                                 `advisory_at: "step"`) MUST have
                                 `continue-on-error: true`
       * `required-on-push`    → the job's `continue-on-error` must be a
                                 conditional `${{ ... }}` expression
                                 (advisory on PR, required on push)

Workflow jobs that exist but are not documented, and runner labels
that no manifest gate covers, are reported as informational notes —
the docs/manifest are never stale in the fail direction.

USAGE
=====

    python3 scripts/verify-ci-docs-drift.py           # strict: exit 1 on drift
    python3 scripts/verify-ci-docs-drift.py --report-only   # always exit 0
    python3 scripts/verify-ci-docs-drift.py --verbose       # show OK rows

EXIT CODES
==========

  * 0  no drift: every documented job/workflow exists, manifest gates
        are declared and their status matches the workflows.
  * 1  a documented job is missing, a workflow file is missing, a
        manifest gate is undeclared, or a gate status contradicts its
        workflow.
  * 2  a runtime error occurred (docs, workflows dir, or gates.json
        missing/invalid).
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# CICD-05 fix: the canonical CI dashboard lives under docs/operations/ —
# the old docs/ci-pipeline.md path made this gate exit 2 ("docs not found")
# on every run after the doc was moved.
DOCS = ROOT / "docs" / "operations" / "ci-pipeline.md"
# The release checklist hand-maintains its own list of dev-ci.yml job names. That
# list went stale the moment this session added `static-gates` -- the same drift
# class this checker exists to catch, in the one document a release manager
# actually reads at ship time, and outside this script's scope until now.
RELEASE_CHECKLIST = ROOT / "docs" / "releases" / "checklist.md"
WORKFLOWS_DIR = ROOT / ".github" / "workflows"
GATES_MANIFEST = ROOT / "scripts" / "gates.json"
CHECK_SH = ROOT / "scripts" / "check.sh"
PRE_COMMIT_HOOK = ROOT / ".githooks" / "pre-commit"
CHECK_UI = ROOT / "scripts" / "check-ui.mjs"

# Docs headings this checker parses. "Job Matrix" was literally
# "Job Matrix (ci.yml)", which stopped being true once ci.yml was retired: the
# table now has to cover dev-ci.yml's live jobs as well, and a heading naming a
# dead workflow is exactly how it ended up describing 11 retired jobs while
# omitting every live one. Kept as constants because the doc heading and the
# parser are a contract -- renaming one side without the other makes the checker
# refuse to run (the good outcome), but it should be a single deliberate edit.
MATRIX_SECTION = "Job Matrix"
GATES_SECTION = "Pre-Merge Validation Gates"
INVENTORY_SECTION = "Workflow inventory"

VALID_STATUS = {"required", "advisory", "required-on-push", "retired"}
# A `retired` gate asserts that the check enforces NOTHING today. It must carry
# no `ci` block, because a status paired with a workflow pointer is a claim that
# something runs, and that pairing is exactly the R36-10 lie: 13 gates were
# marked `required` while naming a workflow GitHub never executes and having no
# runner in check.sh or pre-push either. Retiring a gate should be expressible;
# silently pointing at a dead file should not.

# ── Docs parsing ──────────────────────────────────────────────────────
# Backticked kebab-case token (job IDs / workflow filenames).
KUBE_TOKEN = re.compile(r"`([a-z][a-z0-9-]*)`")
# Job Matrix table row: first cell is a backticked job ID.
JOB_MATRIX_ROW = re.compile(r"^\|\s*`([a-z][a-z0-9-]*)`\s*\|")
# Gate table row: capture the Job cell (second cell) for token extraction.
GATE_TABLE_ROW = re.compile(r"^\|\s*[^|]+\|\s*(.+?)\s*\|")
# Any backticked `*.yml` token — used across the WHOLE Workflow inventory
# section (a `.yml`-suffixed token cannot collide with `main`/`ui/e2e/**`
# branch/path mentions), so combined rows like `android.yml` / `ios.yml`
# are caught rather than requiring first-cell anchoring.
WORKFLOW_TOKEN = re.compile(r"`([a-z0-9][a-z0-9-]*\.yml)`")
# A retired workflow's inventory row must say so. Accept several phrasings so
# the doc is not forced into one magic word, but require an explicit statement —
# a row that merely omits the workflow from CI is the failure being guarded.
RETIRED_MARKER = re.compile(r"retired|inert|not executed|no longer runs|\.bak\b", re.I)
# Job Matrix table row: job ID (first cell) + Blocks marker (last cell).
JOB_MATRIX_FULL_ROW = re.compile(r"^\|\s*`([a-z][a-z0-9-]*)`\s*\|.*\|\s*([^|]+?)\s*\|$")

# Job-level `continue-on-error:` (4-space indent under a job key).
JOB_COE = re.compile(r"^ {4}continue-on-error:\s*(.+?)\s*$")
# Step-level `continue-on-error: true` (8-space indent under a step).
STEP_COE_TRUE = re.compile(r"^ {8}continue-on-error:\s*true\s*$")


def load_gates() -> list[dict] | None:
    """Load and validate scripts/gates.json. Returns None on failure.

    Fail-CLOSED schema validation: a malformed manifest (e.g. a `runners`
    value that is a string instead of a list of needles) must never make
    the gate pass vacuously. Every structural violation returns None →
    the caller exits 2.
    """
    if not GATES_MANIFEST.is_file():
        print(f"error: gate manifest not found: {GATES_MANIFEST}", file=sys.stderr)
        return None
    try:
        data = json.loads(GATES_MANIFEST.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"error: gate manifest invalid JSON: {e}", file=sys.stderr)
        return None
    gates = data.get("gates")
    if not isinstance(gates, list) or not gates:
        print("error: gate manifest has no non-empty 'gates' list", file=sys.stderr)
        return None

    seen_ids: set[str] = set()
    for g in gates:
        if not isinstance(g, dict) or not isinstance(g.get("id"), str) or not g["id"]:
            print("error: gate manifest entry missing non-empty string 'id'", file=sys.stderr)
            return None
        gid = g["id"]
        if gid in seen_ids:
            print(f"error: duplicate gate id '{gid}' in gates.json", file=sys.stderr)
            return None
        seen_ids.add(gid)

        status = g.get("status")
        if status not in VALID_STATUS:
            print(
                f"error: gate '{gid}' has invalid status "
                f"'{status}' (expected {sorted(VALID_STATUS)})",
                file=sys.stderr,
            )
            return None

        runners = g.get("runners")
        if runners is not None:
            if not isinstance(runners, dict):
                print(f"error: gate '{gid}' 'runners' must be an object", file=sys.stderr)
                return None
            for runner, needles in runners.items():
                if runner not in ("check.sh", "check:all"):
                    print(f"error: gate '{gid}' has unknown runner '{runner}'", file=sys.stderr)
                    return None
                if (
                    not isinstance(needles, list)
                    or not needles
                    or not all(isinstance(n, str) and n.strip() for n in needles)
                ):
                    print(
                        f"error: gate '{gid}' runner '{runner}' needles must be a "
                        f"non-empty list of non-empty strings",
                        file=sys.stderr,
                    )
                    return None

        ci = g.get("ci")
        if ci is not None:
            if (
                not isinstance(ci, dict)
                or not isinstance(ci.get("workflow"), str)
                or not ci["workflow"]
                or not isinstance(ci.get("job"), str)
                or not ci["job"]
            ):
                print(
                    f"error: gate '{gid}' 'ci' must have non-empty string "
                    f"'workflow' and 'job' fields",
                    file=sys.stderr,
                )
                return None
            advisory_at = ci.get("advisory_at")
            if advisory_at is not None:
                if status != "advisory":
                    print(
                        f"error: gate '{gid}' ci.advisory_at is only valid for "
                        f"advisory gates",
                        file=sys.stderr,
                    )
                    return None
                if advisory_at not in ("job", "step"):
                    print(
                        f"error: gate '{gid}' ci.advisory_at must be 'job' or 'step'",
                        file=sys.stderr,
                    )
                    return None

        if status == "required-on-push" and ci is None:
            print(
                f"error: gate '{gid}' has status required-on-push but no 'ci' "
                f"mapping (its conditionality is workflow-enforced)",
                file=sys.stderr,
            )
            return None
    return gates


def unrecorded_active_gates(gates: list[dict]) -> list[str]:
    """Active gates that name no CI job and give no reason why not.

    load_gates() validates the SHAPE of a `ci` mapping and hard-errors when a
    required-on-push gate omits one, but says nothing about a `required` gate that simply
    has no `ci` key. That is the exact shape AGENTS.md records as the motivating bug:
    migration column types and PG schema drift went unenforced for two releases and the
    drift checker could not report them as unenforced, because an absent mapping is
    indistinguishable from an intentional one.

    Absence is not itself wrong -- several active gates here are legitimately local-only
    (a11y has known open regressions and is advisory by design; the e2e gate needs a Docker
    backend CI does not provision). So the invariant is that absence must be EXPLAINED:
    either name the job, or carry a note saying why there is none. That keeps the check
    green on honest local-only gates while failing on the forgotten kind, and it is why
    this reports rather than hard-errors inside load_gates -- a missing rationale is a
    finding to fix, not a malformed file.
    """
    out: list[str] = []
    for g in gates:
        if g.get("status") not in ("required", "advisory"):
            continue
        if g.get("ci"):
            continue
        if (g.get("_note") or g.get("note") or "").strip():
            continue
        out.append(g["id"])
    return sorted(out)


def doc_section(lines: list[str], title: str) -> list[str]:
    """Return the lines under a `## <title>` section (until the next `## `)."""
    out: list[str] = []
    in_section = False
    for line in lines:
        if line.startswith("## "):
            in_section = line[3:].strip() == title
            continue
        if in_section:
            out.append(line)
    return out


def hook_step_orphans(gates: list[dict]) -> list[str]:
    """Pre-commit steps whose tooling is unreachable from any gates.json record.

    This closes a blind spot rather than a data error. Every other check in this file
    iterates the gates that ARE in the manifest, so a gate with no record at all is
    invisible to it -- it cannot be reported as "required but not enforced", because
    the checker never learns to ask. That is how `verify-bundle-parity.py` (hook step
    4, the step whose own docs record 14 broken keys shipping while it reported
    clean) and both migration gates sat for a full release cycle with coverage in
    exactly one place: the opt-in hook, on a machine that ran setup-dev.ps1.

    The join is a two-hop chain rather than a filename search, because gate records
    never contain script names -- they hold runner labels and CI step titles. So:
    gate -> its `runners` labels -> the `step "<label>" "<cmd>"` line in check.sh ->
    the scripts that command invokes. Every hop is data already in the repo, and the
    middle hop is exactly the indirection gates.json exists to describe.

    Matching is on filenames rather than fuzzy name similarity because gate IDs are
    concepts ("i18n-lint") and hook headers are prose ("i18n lint"); joining those
    by eye would invent links the manifest never claimed, which is the failure this
    whole family of checks was built to stop.
    """
    if not (PRE_COMMIT_HOOK.is_file() and CHECK_SH.is_file()):
        return []
    hook = PRE_COMMIT_HOOK.read_text(encoding="utf-8", errors="replace")
    check = CHECK_SH.read_text(encoding="utf-8", errors="replace")

    # label -> scripts that label's command invokes
    label_scripts: dict[str, set[str]] = {}
    # Leading whitespace allowed: several steps are declared inside an `if` block
    # (the ftl-dedupe one is, at an indent of 4), and anchoring on column 0 made
    # those labels unresolvable -- which reported a fully-wired gate as an orphan.
    for m in re.finditer(r'^\s*step\s+"([^"]+)"\s+"([^"]+)"', check, re.M):
        label, cmd = m.group(1), m.group(2)
        label_scripts.setdefault(label, set()).update(
            re.findall(r"scripts/([A-Za-z0-9_.-]+\.(?:py|sh|mjs))", cmd))

    reachable: set[str] = set()
    for g in gates:
        runners = g.get("runners") or {}
        if isinstance(runners, dict):
            for labels in runners.values():
                items = labels if isinstance(labels, list) else [labels]
                for lb in items:
                    reachable |= label_scripts.get(str(lb), set())
        # A gate may also name its tooling directly; honour that if it ever does.
        reachable |= set(re.findall(
            r"([A-Za-z0-9_.-]+\.(?:py|sh|mjs))", json.dumps(g)))

    orphans: list[str] = []
    headers = re.findall(r"^# ── (.+?) ─", hook, re.M)
    for name in headers:
        start = hook.index(f"# ── {name} ─")
        nxt = [hook.index(f"# ── {x} ─") for x in headers
               if hook.index(f"# ── {x} ─") > start]
        body = hook[start: min(nxt) if nxt else len(hook)]
        # Only scripts under scripts/ that the step actually invokes. `cargo fmt`
        # and bare `go vet` have no script to name, and the EOL step is inline shell
        # in the hook itself -- requiring a manifest entry for those would demand a
        # record for something that is not a check with an identity.
        scripts = sorted(set(re.findall(
            r"scripts/([A-Za-z0-9_.-]+\.(?:py|sh|mjs))", body)))
        if scripts and not any(s in reachable for s in scripts):
            orphans.append(f"{name}  (invokes {', '.join(scripts)})")
    return orphans


def hook_workflow_pointers_from_text(text: str, live: set[str]) -> list[str]:
    """Hook comments that cite a workflow GitHub does not actually run.

    The pre-commit hook says things like "mirrors
    `.github/workflows/ci.yml#ui i18n quality gate`" to tell an agent that a local
    step has a CI backstop. When a workflow is retired -- and on this branch nine of
    them were, renamed to `.bak` by `23c96330` with no replacement for several -- the
    citation outlives the file and starts asserting the opposite of the truth.

    That is not a cosmetic problem, because the hook is precisely where an agent
    looks to answer "is this gate enforced anywhere?". A pointer at a file that only
    exists as `.bak` reads as "enforced nowhere", which is how several rounds of
    0.0.36-backlog were spent re-verifying coverage that was in fact present in
    `dev-ci.yml` the whole time. The inverse failure is worse: an agent who greps for
    the cited name, finds only `.bak`, and stops looking may conclude the *hook step*
    itself is unbacked and skip reasoning about it.

    So the rule is narrow and mechanical: every `.github/workflows/<name>.yml` the
    hook mentions must be a live workflow file. `live` is deliberately built from a
    `*.yml` glob by the caller rather than from a directory listing, because
    `<name>.yml.bak` exists on disk and GitHub never executes it -- treating the
    directory as the truth would let every retired workflow pass this check, which is
    the exact bug being caught.
    """
    findings: set[str] = set()
    for m in re.finditer(r"\.github/workflows/([A-Za-z0-9_.-]+)\.yml", text):
        name = f"{m.group(1)}.yml"
        if name in live:
            continue
        line = text[:m.start()].count("\n") + 1
        findings.add(
            f"hook L{line}: cites .github/workflows/{name} "
            f"(not a live workflow -- only {', '.join(sorted(live)) or 'nothing'} is)")
    return sorted(findings)


def hook_workflow_pointers() -> list[str]:
    """Real-path wrapper over hook_workflow_pointers_from_text()."""
    if not PRE_COMMIT_HOOK.is_file():
        return []
    live = {p.name for p in (ROOT / ".github" / "workflows").glob("*.yml")}
    return hook_workflow_pointers_from_text(
        PRE_COMMIT_HOOK.read_text(encoding="utf-8", errors="replace"), live)


def looks_like_actions_workflow(path: Path) -> tuple[bool, str]:
    """Can GitHub actually run this file?

    GitHub parses EVERY `*.yml` in `.github/workflows/` as an Actions workflow.
    A file with no top-level `on:` cannot be triggered by anything, so it is not a
    workflow that is merely undocumented -- it is a workflow that can never run, and
    the Actions tab shows it as an error.

    This distinction changes the fix completely. "Undocumented live workflow" sends
    a reader to add a row to the inventory; a file that is not an Actions workflow
    at all needs to be MOVED OUT of the directory, and documenting it would enshrine
    the mistake. Found by exactly that confusion: a CircleCI config (`executors:`,
    `commands:`, `workflows:`, no `on:`) was relocated into `.github/workflows/` to
    match a CircleCI project setting, which makes GitHub try to execute it.

    Deliberately line-based, matching workflow_jobs() above: importing a YAML parser
    here would make the gate depend on a package the other checkers avoid.
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    has_on = bool(re.search(r"""^(?:on|'on'|"on")\s*:""", text, re.M))
    circleci_keys = [k for k in ("executors", "commands", "workflows", "orbs")
                     if re.search(rf"^{k}\s*:", text, re.M)]
    if not has_on:
        if circleci_keys:
            return False, (f"no `on:` trigger and CircleCI-only keys "
                           f"({', '.join(circleci_keys)}) -- this is not a GitHub "
                           f"Actions workflow, it is a config for another CI system")
        return False, "no top-level `on:` trigger, so nothing can ever run it"
    if circleci_keys:
        return True, f"has `on:` but also CircleCI keys ({', '.join(circleci_keys)})"
    return True, ""


def workflow_jobs(path: Path) -> set[str]:
    """Job IDs declared under the `jobs:` block of a workflow file.

    This repo's convention (and GitHub Actions' usual style) is job IDs
    indented exactly 2 spaces under `jobs:`; the `on:` trigger keys (also
    2-space indented) appear BEFORE `jobs:`, so we only start collecting
    after the `jobs:` line and stop at the next 0-indent top-level key.
    """
    jobs: set[str] = set()
    in_jobs = False
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not in_jobs:
            if re.match(r"^jobs:\s*(#.*)?$", stripped):
                in_jobs = True
            continue
        if re.match(r"^  [a-z0-9][a-z0-9_-]*:\s*$", line):
            jobs.add(line.strip()[:-1].strip())
        elif not line.startswith("  "):
            in_jobs = False  # 0-indent top-level key — jobs block ended
    return jobs


def job_coe(wf_path: Path, job: str) -> tuple[str | None, bool]:
    """Wrapper for job_coe_from_text that reads the file fresh."""
    return job_coe_from_text(wf_path.read_text(encoding="utf-8"), job)


def job_coe_from_text(text: str, job: str) -> tuple[str | None, bool]:
    """Return (job-level continue-on-error value, has-step-level COE:true)
    for the named job inside a workflow file.

    Job-level keys sit at 4-space indent under `  <job>:`; step-level
    keys sit at 8-space indent under a `      - name:` step. Values are
    returned raw (e.g. `true`, `${{ ... }}`), so callers can distinguish
    a bare `true` from a conditional expression.
    """
    lines = text.splitlines()
    in_jobs = False
    in_job = False
    job_level: str | None = None
    step_coe = False
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not in_jobs:
            if re.match(r"^jobs:\s*(#.*)?$", stripped):
                in_jobs = True
            continue
        # 2-space indent → job header.
        if re.match(r"^  [a-z0-9][a-z0-9_-]*:\s*$", line):
            in_job = line.strip()[:-1].strip() == job
            continue
        if not in_job:
            continue
        if line.startswith("  ") and not line.startswith("    "):
            continue  # 2-space key inside block (shouldn't happen) — skip
        m = JOB_COE.match(line)
        if m and job_level is None:
            job_level = m.group(1)
        if STEP_COE_TRUE.match(line):
            step_coe = True
        if not line.startswith("    ") and stripped:
            # 0-indent top-level key → jobs block ended.
            if not line.startswith("  "):
                break
    return job_level, step_coe


def check_sh_gates(path: Path) -> set[str]:
    """Gate labels from scripts/check.sh (`step "x"` + `echo -n "x..."`)."""
    text = path.read_text(encoding="utf-8")
    gates = set(re.findall(r'step\s+"([^"]+)"', text))
    # Non-step gates are announced with `echo -n "label... "` (the step()
    # helper's own `echo -n "${step_str}. checking ${name}... "` is excluded
    # by the `${` guard). Strip the trailing ellipsis/space to get the label.
    for label in re.findall(r'echo -n "([^"]+)"', text):
        if "${" in label:
            continue
        gates.add(label.rstrip(". \t"))
    return {g.lower() for g in gates}


def check_ui_gates(path: Path) -> set[str]:
    """Gate labels from scripts/check-ui.mjs (`gate('x')` + skip pushes)."""
    text = path.read_text(encoding="utf-8")
    gates = set(re.findall(r"gate\('([^']+)'", text))
    gates.update(re.findall(r"gate:\s*'([^']+)'", text))
    return {g.lower() for g in gates}


def has_needle(gates: set[str], needles: tuple[str, ...]) -> bool:
    """True if any extracted gate label contains any needle (ci-agnostic)."""
    return any(n in g for g in gates for n in needles)


def missing_needles(gates: set[str], needles: tuple[str, ...]) -> list[str]:
    """Every needle that matches NO declared label.

    This replaces an ANY-of test (`has_needle`) for the manifest -> runner direction,
    and the difference is the whole point. With ANY-of, a gate listing three runner
    labels is satisfied by one of them, so deleting the other two from check.sh leaves
    the manifest asserting guards that no longer exist. Demonstrated against this
    repo's own gate: `ci-docs-drift` declares both "ci docs drift" and "ci docs drift
    self-test"; removing the self-test step from check.sh kept the checker at
    "0 drift item(s)", because the first needle still matched.

    A runner list is a claim about the set of steps that implement a gate, so every
    member has to exist -- which is also how the `ci` block already works, where a
    named job that is absent is an error rather than one of several alternatives.
    Switching is safe here precisely because the manifest is currently accurate under
    the stricter rule: all 5 multi-label gates resolve every label today, so this
    tightens a latent gap rather than converting it into 15 false failures.
    """
    return [n for n in needles if not any(n in g for g in gates)]


def self_test() -> int:
    """Mutation-test the two pure classifiers this gate depends on.

    Scoped deliberately: the full scan() lives inside main() against module-level
    paths, and refactoring a 900-line gate that every other check leans on is a
    bigger risk than the coverage is worth today. What IS tested here is the pair of
    functions whose silent failure would make the gate lie: workflow_jobs() decides
    which jobs exist, and looks_like_actions_workflow() decides whether a file is a
    workflow at all. Both are exercised in the direction that matters -- a mutation
    that should be caught, plus the negative control that proves the detector is not
    simply always-on.
    """
    import tempfile

    failed: list[str] = []

    def check(label: str, got, want) -> bool:
        ok = got == want
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}")
        if not ok:
            print(f"        want {want!r}\n        got  {got!r}")
            failed.append(label)
        return ok

    good = (
        "name: x\non:\n  pull_request:\n    branches: [main]\njobs:\n"
        "  build:\n    runs-on: ubuntu-latest\n  lint:\n    runs-on: ubuntu-latest\n"
    )
    circleci = (
        "version: 2.1\nexecutors:\n  node:\n    docker:\n      - image: cimg/node:22\n"
        "commands:\n  setup:\n    steps: []\njobs:\n  static-gates:\n    executor: node\n"
        "    steps: []\nworkflows:\n  build:\n    jobs:\n      - static-gates\n"
    )
    no_trigger = "name: x\njobs:\n  build:\n    runs-on: ubuntu-latest\n"

    with tempfile.TemporaryDirectory() as td:
        def w(text: str) -> Path:
            p = Path(td) / "wf.yml"
            p.write_text(text, encoding="utf-8")
            return p

        print("\n  looks_like_actions_workflow")
        ok, _ = looks_like_actions_workflow(w(good))
        check("a real workflow with `on:` is accepted", ok, True)
        ok, why = looks_like_actions_workflow(w(circleci))
        check("a CircleCI config is rejected", ok, False)
        check("  ... and named as another CI system's config",
              "CircleCI" in why or "not a GitHub" in why, True)
        ok, why = looks_like_actions_workflow(w(no_trigger))
        check("a workflow missing `on:` is rejected", ok, False)
        check("  ... without claiming it is CircleCI", "CircleCI" in why, False)

        print("\n  workflow_jobs")
        check("both jobs found in a real workflow",
              workflow_jobs(w(good)), {"build", "lint"})
        # The negative control that matters: `pull_request` and `branches` are
        # 2-space indented under `on:`, which appears BEFORE `jobs:`. Collecting
        # from column 0 would add them and the gate would then demand docs for
        # trigger keys that are not jobs at all.
        check("trigger keys under `on:` are not mistaken for jobs",
              "pull_request" in workflow_jobs(w(good)), False)
        # CircleCI nests job bodies differently; the point is this must not crash
        # and must not invent jobs from `workflows:`.
        cj = workflow_jobs(w(circleci))
        check("a CircleCI file yields its `jobs:` names, not `workflows:`",
              cj, {"static-gates"})

        print("\n  hook_step_orphans")
        full = json.loads(
            GATES_MANIFEST.read_text(encoding="utf-8"))["gates"]
        # Control: the manifest as it stands covers every scripted hook step.
        check("current gates.json leaves no hook step orphaned",
              hook_step_orphans(full), [])
        # Remove one record and require its hook step to surface. This is the whole
        # point of the check: an absent gate must become visible, not silently
        # unpoliced.
        trimmed = [g for g in full if g["id"] != "bundle-parity"]
        assert len(trimmed) == len(full) - 1, "bundle-parity not in the manifest"
        orph = hook_step_orphans(trimmed)
        check("deleting the bundle-parity record orphans hook step 4",
              any("Bundle parity" in o for o in orph), True)
        check("  ... and names the script that lost its cover",
              any("verify-bundle-parity.py" in o for o in orph), True)
        # An empty manifest must not read as "nothing orphaned".
        check("an empty manifest orphans every scripted step",
              len(hook_step_orphans([])) > 0, True)

        print("\n  unrecorded_active_gates")
        # Control: the manifest as it stands answers every active gate with either a
        # job or a reason.
        check("current gates.json leaves no active gate unexplained",
              unrecorded_active_gates(full), [])
        # Positive: strip the rationale from a gate that has no CI job. This is the
        # exact shape the check exists for -- `e2e` is legitimately local-only, and
        # the only thing separating it from a forgotten gate is its _note.
        target = next(g for g in full if g["id"] == "e2e")
        assert "ci" not in target and target.get("_note"), \
            "e2e no longer has the shape this case depends on"
        stripped = [dict(g) for g in full]
        for g in stripped:
            if g["id"] == "e2e":
                g.pop("_note")
        check("removing a local-only gate's note makes it unexplained",
              unrecorded_active_gates(stripped), ["e2e"])
        # Negative control: the same gate with its note intact is NOT flagged, so the
        # check is not simply firing on every entry that lacks a ci mapping.
        check("  ... and restoring the note clears it",
              unrecorded_active_gates([dict(target)]), [])
        # A gate that names a CI job needs no note.
        check("a gate with a ci mapping is never flagged",
              unrecorded_active_gates(
                  [{"id": "x", "status": "required",
                    "ci": {"workflow": "dev-ci.yml", "job": "static-gates"}}]), [])
        # Retired gates run nowhere by definition; excluding them is what keeps the
        # check at 5 findings rather than 24. If that exclusion ever stopped working
        # the gate would arrive red on sixteen honest entries and get silenced.
        check("a retired gate with neither ci nor note is not flagged",
              unrecorded_active_gates([{"id": "old", "status": "retired"}]), [])
        # A note that is only whitespace is not an explanation.
        check("a whitespace-only note does not excuse a missing ci",
              unrecorded_active_gates(
                  [{"id": "lazy", "status": "required", "_note": "   "}]), ["lazy"])

        print("\n  hook_workflow_pointers_from_text")
        # A citation of a workflow that is not live must surface...
        stale = hook_workflow_pointers_from_text(
            "# mirrors `.github/workflows/ci.yml#ui i18n gate`\n", {"dev-ci.yml"})
        check("a citation of a retired workflow is reported",
              len(stale), 1)
        check("  ... and names the file it points at",
              any("ci.yml" in s for s in stale), True)
        # ...but the detector must not simply be always-on: the same prose about a
        # live workflow is correct and has to stay silent.
        check("a citation of a live workflow is not reported",
              hook_workflow_pointers_from_text(
                  "# see `.github/workflows/dev-ci.yml#static-gates`\n",
                  {"dev-ci.yml"}), [])
        # A `.bak` sitting beside the name is the exact trap: the file exists on disk
        # but GitHub never runs it, so glob("*.yml") must be the live set.
        check("a workflow only present as .bak counts as not live",
              len(hook_workflow_pointers_from_text(
                  "x .github/workflows/nightly.yml y", {"dev-ci.yml"})), 1)

    print()
    if failed:
        print(f"  {len(failed)} self-test case(s) FAILED:")
        for f in failed:
            print(f"    {f}")
        return 1
    print("  all self-test cases passed")
    return 0


def main() -> int:
    # Drift reports carry doc markers (✅/⚠️) — a cp1252 Windows console
    # must never crash with UnicodeEncodeError instead of failing the gate.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass  # non-reconfigurable stream (e.g. some embedded runners)

    parser = argparse.ArgumentParser(
        description=(
            "Verify docs/operations/ci-pipeline.md and scripts/gates.json only reference "
            "jobs/workflows that exist and that runners + workflows match the "
            "manifest gate vocabulary and status."
        )
    )
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="Always exit 0; print the report and return.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print OK rows in addition to problems.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        dest="self_test",
        help="Mutation-test the classifiers this gate depends on and exit.",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    gates = load_gates()
    if gates is None:
        return 2
    if not DOCS.is_file():
        print(f"error: docs not found: {DOCS}", file=sys.stderr)
        return 2
    if not WORKFLOWS_DIR.is_dir():
        print(f"error: workflows dir not found: {WORKFLOWS_DIR}", file=sys.stderr)
        return 2

    docs_lines = DOCS.read_text(encoding="utf-8").splitlines()
    workflow_files = sorted(WORKFLOWS_DIR.glob("*.yml"))
    workflows_by_name = {wf.name: wf for wf in workflow_files}
    # Workflows that exist only as `<name>.yml.bak`. 23c96330 retired every
    # non-dev CI workflow this way; GitHub never executes a .bak file, so a doc
    # row naming one is recording history, not claiming current enforcement.
    # Needed here because both the Job Matrix and the inventory use it.
    retired_workflow_names = {
        p.name[:-4] for p in WORKFLOWS_DIR.glob("*.yml.bak")
    } - {wf.name for wf in workflow_files}

    # Fail-open protection: if a required section is renamed or emptied,
    # an empty parse result would make the gate vacuously PASS. Treat a
    # missing/empty required section as a structural error instead.
    required_sections = [
        MATRIX_SECTION,
        GATES_SECTION,
        INVENTORY_SECTION,
    ]
    missing_sections = [
        title
        for title in required_sections
        if not doc_section(docs_lines, title)
    ]
    if missing_sections:
        print(
            f"error: docs/operations/ci-pipeline.md is missing required section(s) — "
            f"{', '.join(missing_sections)}",
            file=sys.stderr,
        )
        return 2

    # ── 1. Jobs: documented → workflows ─────────────────────────────
    matrix_lines = doc_section(docs_lines, MATRIX_SECTION)
    matrix_jobs: set[str] = set()
    # job id -> the workflow file its own row names, for rows that name one.
    # Used to distinguish "this job is missing from a LIVE workflow" (a real
    # error) from "this job lived in a workflow that was retired" (accurate
    # history that the old code counted as drift).
    matrix_job_workflow: dict[str, str] = {}
    for line in matrix_lines:
        m = JOB_MATRIX_ROW.match(line)
        if not m:
            continue
        job = m.group(1)
        matrix_jobs.add(job)
        # The Workflow column is a bare `ci.yml`, not backticked, so
        # WORKFLOW_TOKEN (which needs backticks) cannot see it. Split the row
        # into cells and read column 3.
        cells = [c.strip().strip("`") for c in line.strip().strip("|").split("|")]
        if len(cells) > 2:
            wm = re.fullmatch(r"([a-z0-9][a-z0-9-]*\.yml)", cells[2])
            if wm:
                matrix_job_workflow[job] = wm.group(1)
    if not matrix_jobs:
        print(
            "error: %s section contains no job rows" % MATRIX_SECTION,
            file=sys.stderr,
        )
        return 2

    gate_jobs: set[str] = set()
    # Same history-vs-enforcement distinction as the Job Matrix, but this table
    # puts the workflow in parentheses inside the job cell: `rust-test`
    # (nightly.yml). Without it, six accurately-documented nightly/website rows
    # count as missing jobs.
    gate_job_workflow: dict[str, str] = {}
    for line in doc_section(docs_lines, GATES_SECTION):
        m = GATE_TABLE_ROW.match(line)
        if not m:
            continue
        cell = m.group(1)
        gate_jobs.update(KUBE_TOKEN.findall(cell))
        wm = re.search(r"\(([a-z0-9][a-z0-9-]*\.yml)\)", cell)
        if wm:
            for j in KUBE_TOKEN.findall(cell):
                gate_job_workflow[j] = wm.group(1)
    if not gate_jobs:
        print(
            "error: Pre-Merge Validation Gates section contains no job rows",
            file=sys.stderr,
        )
        return 2

    # Cache per-workflow job sets + raw text once (status checks loop over
    # every ci-mapped gate; re-parsing per gate would be redundant work).
    all_jobs: set[str] = set()
    jobs_by_workflow: dict[str, set[str]] = {}
    wf_texts: dict[str, str] = {}
    for wf in workflow_files:
        jobs = workflow_jobs(wf)
        jobs_by_workflow[wf.name] = jobs
        wf_texts[wf.name] = wf.read_text(encoding="utf-8")
        all_jobs |= jobs
        # No per-workflow special-casing: `ci_jobs` used to be captured here only
        # when a file named ci.yml existed, and every consumer of it silently
        # degraded to the empty set the day that file was retired.

    # A matrix row whose own Workflow column names a retired file is recording
    # history, not claiming the job runs. Only rows that name a LIVE workflow (or
    # name none, which implies ci.yml by the section title) while the job is
    # absent are real drift. gate_jobs are never exempted: gates.json describes
    # what enforces merges TODAY, so a gate pointing at a retired workflow is the
    # R36-10 lie and must keep counting.
    retired_matrix_jobs = sorted(
        j for j in (matrix_jobs | gate_jobs) - all_jobs
        if (matrix_job_workflow.get(j) or gate_job_workflow.get(j))
        in retired_workflow_names
    )
    missing_jobs = sorted(
        (j for j in (matrix_jobs | gate_jobs) - all_jobs
         if j not in retired_matrix_jobs)
    )
    # Informational: the docs' Job Matrix catalogs ci.yml specifically, so
    # flag jobs ADDED to ci.yml that the docs don't mention (the fail
    # direction is docs-referenced-but-missing; this is the reverse).
    # Fail-open fix: this used to be `ci_jobs - documented`, but ci_jobs is only
    # populated when a file literally named ci.yml exists -- and it has not since
    # 23c96330 retired it. So the check silently became "nothing is undocumented"
    # and the static-gates job added in this same session passed through it
    # unnoticed. Compare against every job in every LIVE workflow instead, which
    # is the question actually worth asking: "does the docs table mention
    # everything that gates a merge today?"
    undocumented = sorted(all_jobs - (matrix_jobs | gate_jobs))

    # ── 2. Workflow inventory: named files exist ────────────────────
    # Extract every backticked `*.yml` token from the whole section so
    # combined rows like `android.yml` / `ios.yml` are also captured.
    inv_lines = doc_section(docs_lines, INVENTORY_SECTION)
    inventory_files = set(WORKFLOW_TOKEN.findall("\n".join(inv_lines)))
    if not inventory_files:
        print(
            "error: Workflow inventory section contains no *.yml references",
            file=sys.stderr,
        )
        return 2
    live_files = {wf.name for wf in workflow_files}
    # Retirement awareness. 23c96330 moved every non-dev CI workflow to
    # `<name>.yml.bak`, which GitHub never executes. The previous code globbed
    # only *.yml and then reported all 11 as "MISSING WORKFLOW FILES (inventory
    # names nothing on disk)" — false as stated, since every one of them IS on
    # disk. That mislabelling made the bucket look like doc rot when it was
    # partly a tooling gap, and buried the real finding: the inventory described
    # 11 dead workflows in present tense and omitted dev-ci.yml, the only live
    # one. A name matching no file at all is still a genuine error.
    retired_files = sorted(
        f for f in inventory_files
        if f not in live_files and (WORKFLOWS_DIR / f"{f}.bak").is_file()
    )
    missing_files = sorted(
        f for f in inventory_files if f not in live_files and f not in retired_files
    )
    # A retired workflow must be LABELLED retired in its own row. Otherwise the
    # table reads as present tense and misleads exactly as badly as omitting it,
    # and the gate would pass on a doc that says "release.yml: tag push (v*)"
    # while nothing builds a release.
    unlabelled_retired = sorted(
        f for f in retired_files
        if not any(
            RETIRED_MARKER.search(r)
            for r in inv_lines
            if r.lstrip().startswith("|") and f"`{f}`" in r
        )
    )
    # Inverse gap: a workflow that RUNS but is absent from the inventory.
    # Computed after the misplaced split below and excluding those files: a config
    # that can never be triggered is not "a live workflow nobody documented", and
    # reporting it under both headings would double-count one defect while pointing
    # half the readers at the wrong fix.
    misplaced: list[tuple[str, str]] = []
    for name in sorted(live_files):
        ok, why = looks_like_actions_workflow(WORKFLOWS_DIR / name)
        if not ok:
            misplaced.append((name, why))
    undocumented_live = sorted(
        live_files - inventory_files - {n for n, _ in misplaced}
    )
    # Hook steps with no manifest record at all -- the blind spot, not a lie.
    orphans = hook_step_orphans(gates)
    # Active manifest entries that cite no CI job and give no reason. The mirror of
    # `orphans`: an orphan is a step the manifest never saw, this is a gate the manifest
    # claims to track while recording nothing about whether anything enforces it.
    unrecorded = unrecorded_active_gates(gates)
    # Hook prose pointing at a workflow GitHub never runs.
    pointers = hook_workflow_pointers()

    # ── 3. Gate vocabulary: manifest → runners ──────────────────────
    sh_gates = check_sh_gates(CHECK_SH) if CHECK_SH.is_file() else set()
    ui_gates = check_ui_gates(CHECK_UI) if CHECK_UI.is_file() else set()

    gate_problems: list[str] = []
    for gate in gates:
        gid, label = gate["id"], gate["label"]
        runners = gate.get("runners") or {}
        sh_needles = tuple(n.lower() for n in (runners.get("check.sh") or ()))
        ui_needles = tuple(n.lower() for n in (runners.get("check:all") or ()))
        for src, needles, pool, present in (
                ("scripts/check.sh", sh_needles, sh_gates, CHECK_SH.is_file()),
                ("check:all", ui_needles, ui_gates, CHECK_UI.is_file())):
            if not needles:
                continue
            if not present:
                gate_problems.append(
                    f"manifest gate '{gid}' ({label}) names runners for {src}, "
                    f"which does not exist")
                continue
            for miss in missing_needles(pool, needles):
                gate_problems.append(
                    f"manifest gate '{gid}' ({label}) declares runner {miss!r} "
                    f"for {src}, but no step there matches it -- the label was "
                    f"either renamed or the step deleted")

    # Informational: labels the runners declare that no manifest gate covers.
    all_sh_needles = {
        n.lower() for g in gates for n in ((g.get("runners") or {}).get("check.sh") or ())
    }
    all_ui_needles = {
        n.lower() for g in gates for n in ((g.get("runners") or {}).get("check:all") or ())
    }
    sh_uncatalogued = sorted(s for s in sh_gates if not any(n in s for n in all_sh_needles))
    ui_uncatalogued = sorted(s for s in ui_gates if not any(n in s for n in all_ui_needles))

    # ── 4. Gate CI mapping + status: manifest → workflows ───────────
    status_problems: list[str] = []
    retired_gates: list[str] = []
    for gate in gates:
        ci = gate.get("ci")
        gid, status = gate["id"], gate["status"]
        if status == "retired":
            retired_gates.append(gid)
            # A retired gate that still names a workflow is claiming enforcement
            # while saying the opposite — refuse the combination rather than
            # letting `retired` become a way to mute the checker.
            if ci:
                status_problems.append(
                    f"manifest gate '{gid}': status 'retired' must not carry a ci "
                    f"block (it names {ci.get('workflow')}#{ci.get('job')}); drop "
                    f"the ci block and record where the check went in _note"
                )
            continue
        if not ci:
            continue
        wf_name = ci.get("workflow")
        job = ci.get("job")
        wf_path = workflows_by_name.get(wf_name)
        if wf_path is None:
            hint = (
                " — retire it (status: retired, no ci block) if the check no "
                "longer runs, or point it at a live workflow if it does"
            )
            status_problems.append(
                f"manifest gate '{gid}': status '{status}' but workflow file "
                f"'{wf_name}' does not exist{hint}"
            )
            continue
        if job not in jobs_by_workflow.get(wf_name, set()):
            status_problems.append(
                f"manifest gate '{gid}': job '{job}' not found in {wf_name}"
            )
            continue
        job_level, has_step_coe = job_coe_from_text(wf_texts[wf_name], job)
        if status == "required":
            if (job_level or "").strip() == "true":
                status_problems.append(
                    f"manifest gate '{gid}': status required but job "
                    f"'{wf_name}/{job}' has continue-on-error: true"
                )
        elif status == "advisory":
            advisory_at = ci.get("advisory_at", "job")
            if advisory_at == "step":
                if not has_step_coe:
                    status_problems.append(
                        f"manifest gate '{gid}': status advisory (advisory_at: step) "
                        f"but no step in '{wf_name}/{job}' has continue-on-error: true"
                    )
            else:
                v = (job_level or "").strip()
                if v != "true" and not v.startswith("${{"):
                    status_problems.append(
                        f"manifest gate '{gid}': status advisory but job "
                        f"'{wf_name}/{job}' lacks continue-on-error: true "
                        f"(got {v or 'none'})"
                    )
        elif status == "required-on-push":
            v = (job_level or "").strip()
            if not v.startswith("${{"):
                status_problems.append(
                    f"manifest gate '{gid}': status required-on-push but job "
                    f"'{wf_name}/{job}' continue-on-error must be a conditional "
                    f"${{{{ ... }}}} expression (got {v or 'none'})"
                )

    # ── 5. Docs Job Matrix Blocks column ↔ manifest status ─────────
    # The docs table's last column carries a per-job status marker
    # (✅ Required / ⚠️ Advisory / ⚠️ Advisory on PR, ✅ Required on
    # push / Push path). Cross-check it against the manifest status of
    # every ci.yml-mapped gate so the docs status prose cannot drift
    # from the manifest the way the old hardcoded lists did.
    docs_status_problems: list[str] = []
    for line in doc_section(docs_lines, MATRIX_SECTION):
        m = JOB_MATRIX_FULL_ROW.match(line)
        if not m:
            continue
        job_id, blocks = m.group(1), m.group(2).strip()
        if "advisory on pr" in blocks.lower() and "required on push" in blocks.lower():
            expected = "required-on-push"
        elif "advisory" in blocks.lower():
            expected = "advisory"
        elif "required" in blocks.lower():
            expected = "required"
        else:
            continue  # e.g. "Push path" or an unrecognised marker — no status semantics
        for gate in gates:
            ci = gate.get("ci") or {}
            if ci.get("workflow") != "ci.yml" or ci.get("job") != job_id:
                continue
            if gate["status"] != expected:
                docs_status_problems.append(
                    f"docs Job Matrix marks '{job_id}' as '{blocks}' but gates.json "
                    f"status is '{gate['status']}' (gate '{gate['id']}')"
                )

    # ── 6. Release checklist's live-job list ↔ dev-ci.yml ────────────
    # The checklist is what someone reads at ship time, and it enumerates the
    # live CI jobs by hand. It went stale the moment `static-gates` was added.
    # Rather than delete the list (a release manager needs it inline), check it:
    # every job named must exist in dev-ci.yml, and every dev-ci.yml job must be
    # named. A backtick token is only treated as a job name if it is a real job
    # in some live workflow OR appears inside the checklist's own "All CI jobs
    # pass" item -- otherwise prose like `Cargo.toml` in the same file would be
    # scanned as a job claim.
    checklist_problems: list[str] = []
    if RELEASE_CHECKLIST.is_file():
        cl_lines = RELEASE_CHECKLIST.read_text(encoding="utf-8").splitlines()
        # Grab the one bullet that enumerates the jobs, including its continuations.
        bullet: list[str] = []
        for k, line in enumerate(cl_lines):
            if "All CI jobs pass" in line:
                bullet = [line]
                for nxt in cl_lines[k + 1:]:
                    if nxt.strip().startswith(("-", "*", ">")) or nxt.strip() == "":
                        break
                    bullet.append(nxt)
                break
        if not bullet:
            checklist_problems.append(
                f"{RELEASE_CHECKLIST.name}: no 'All CI jobs pass' item found -- "
                f"the live-job list was removed or reworded, so nothing checks it"
            )
        else:
            text = "\n".join(bullet)
            named = set(re.findall(r"`([a-z][a-z0-9-]*)`", text))
            live_jobs = jobs_by_workflow.get("dev-ci.yml", set())
            # Ignore tokens that are clearly not job claims.
            # Ignore tokens that are step verbs or filenames in that bullet's
            # prose, not job claims. `i18n` is deliberately NOT here: it is both
            # an English abbreviation and a real job name, and excluding it made
            # the check report a live job as missing.
            named -= {"dev-ci.yml", "cargo", "ui", "npm", "vitest",
                      "typecheck", "lint", "fmt", "check", "clippy", "tz-invariance"}
            missing_from_checklist = sorted(live_jobs - named)
            phantom = sorted(named - live_jobs - all_jobs)
            if missing_from_checklist:
                checklist_problems.append(
                    f"{RELEASE_CHECKLIST.name} omits live dev-ci.yml job(s): "
                    f"{', '.join(missing_from_checklist)}"
                )
            if phantom:
                checklist_problems.append(
                    f"{RELEASE_CHECKLIST.name} names job(s) that exist in no live "
                    f"workflow: {', '.join(phantom)}"
                )
    else:
        checklist_problems.append(f"release checklist not found: {RELEASE_CHECKLIST}")

    # ── Report ──────────────────────────────────────────────────────
    manifest_counts: dict[str, int] = {
        "required": 0, "advisory": 0, "required-on-push": 0, "retired": 0,
    }
    for g in gates:
        # .get-style accumulation: a status added to VALID_STATUS must not be
        # able to crash the checker with a KeyError.
        manifest_counts[g["status"]] = manifest_counts.get(g["status"], 0) + 1

    print(
        f"verify-ci-docs-drift: {len(workflow_files)} workflow file(s), "
        f"{len(all_jobs)} job(s); docs reference {len(matrix_jobs)} matrix "
        f"job(s) + {len(gate_jobs)} gate job(s)."
    )
    print(
        f"  gates.json: {len(gates)} gate(s) "
        f"({manifest_counts['required']} required, "
        f"{manifest_counts['advisory']} advisory, "
        f"{manifest_counts['required-on-push']} required-on-push, "
        f"{manifest_counts['retired']} retired)."
    )
    print(
        f"  check.sh declares {len(sh_gates)} gate(s); check:all declares "
        f"{len(ui_gates)} gate(s)."
    )
    print()

    if args.verbose and not (
        missing_jobs or missing_files or gate_problems or status_problems or docs_status_problems
        or unlabelled_retired or undocumented_live
    ):
        print("  OK: every documented job/workflow exists; manifest gates match runners + workflows.")
        print()

    if missing_jobs:
        print(f"  MISSING JOBS (documented but no matching workflow job) — {len(missing_jobs)}:")
        for job in missing_jobs:
            print(f"    {job}")
        print()
    if retired_matrix_jobs:
        print(
            f"  note: {len(retired_matrix_jobs)} matrix job(s) name a retired "
            f"workflow in their own row, so they document history rather than "
            f"claiming enforcement (informational):"
        )
        print("    " + ", ".join(retired_matrix_jobs))
        print()
    if missing_files:
        print(f"  MISSING WORKFLOW FILES (named in the inventory, no file at all) — {len(missing_files)}:")
        for f in missing_files:
            print(f"    {f}")
        print()
    if unlabelled_retired:
        print(
            f"  UNLABELLED RETIRED WORKFLOWS (on disk only as .bak, but the "
            f"inventory row does not say retired) — {len(unlabelled_retired)}:"
        )
        for f in unlabelled_retired:
            print(f"    {f}  -> present tense in the docs reads as 'this still runs'")
        print()
    if checklist_problems:
        print(
            f"  RELEASE CHECKLIST JOB LIST (docs/releases/checklist.md disagrees "
            f"with dev-ci.yml) — {len(checklist_problems)}:"
        )
        for p in checklist_problems:
            print(f"    {p}")
        print()
    if retired_gates:
        print(
            f"  note: {len(retired_gates)} gate(s) are marked retired and claim "
            f"no CI enforcement (informational):"
        )
        print("    " + ", ".join(sorted(retired_gates)))
        print()
    if orphans:
        print(
            f"  PRE-COMMIT STEPS WITH NO gates.json RECORD — {len(orphans)}:\n"
            "    gates.json is the declared source of truth for gate names, and this\n"
            "    checker only polices gates it can see. A step absent from the\n"
            "    manifest is therefore unreportable by design -- which is how\n"
            "    bundle-parity ran for a release cycle with no record, no CI job and\n"
            "    no check.sh step while this file printed 0 drift."
        )
        for o in orphans:
            print(f"    {o}")
        print()
    if unrecorded:
        print(
            f"  ACTIVE GATES WITH NO CI JOB AND NO REASON — {len(unrecorded)}:\n"
            "    An absent `ci` mapping is not itself wrong: several gates here are\n"
            "    legitimately local-only (a11y is advisory with known open\n"
            "    regressions; e2e needs a Docker backend CI does not provision).\n"
            "    What is wrong is silence -- an entry that says `required`, cites no\n"
            "    job and explains nothing is indistinguishable from the two that went\n"
            "    unenforced for two releases (migration column types, PG schema\n"
            "    drift), which AGENTS.md records as the reason this manifest exists.\n"
            "    Fix by naming the job, or by adding a `_note` saying why there is\n"
            "    none. Either answer is acceptable; having no answer is not."
        )
        for u in unrecorded:
            print(f"    {u}")
        print()
    if pointers:
        print(
            f"  HOOK COMMENTS CITING A DEAD WORKFLOW — {len(pointers)}:\n"
            "    These comments exist to tell an agent that a local step has a CI\n"
            "    backstop. When the cited workflow is retired the claim inverts: the\n"
            "    gate looks enforced nowhere even when dev-ci.yml runs it today, and\n"
            "    the reverse reading is worse -- an agent that greps the cited name,\n"
            "    finds only a .bak, and stops looking may conclude the hook step is\n"
            "    unbacked and skip reasoning about it entirely. Several rounds of the\n"
            "    0.0.36 backlog went to re-verifying coverage that was present all\n"
            "    along, because of exactly this kind of stale pointer."
        )
        for p in pointers:
            print(f"    {p}")
        print()
    if misplaced:
        print(
            f"  NON-ACTIONS CONFIGS IN .github/workflows/ — {len(misplaced)}:\n"
            "    GitHub parses every *.yml in this directory as an Actions workflow,\n"
            "    so a config for another CI system here is shown as an errored\n"
            "    workflow that can never run. The fix is to MOVE the file, not to\n"
            "    document it — adding an inventory row would record the mistake as\n"
            "    if it were intended."
        )
        for name, why in misplaced:
            print(f"    {name}\n      {why}")
            print(f"      -> move it out of .github/workflows/ (e.g. .circleci/config.yml)")
        print()
    if undocumented_live:
        print(
            f"  UNDOCUMENTED LIVE WORKFLOWS (executed by GitHub, absent from the "
            f"inventory) — {len(undocumented_live)}:"
        )
        for f in undocumented_live:
            print(f"    {f}")
        print()
    if retired_files:
        print(
            f"  note: {len(retired_files)} inventoried workflow(s) exist only as "
            f".bak and are labelled retired (informational):"
        )
        print(f"    {', '.join(retired_files)}")
        print()
    if gate_problems:
        print(f"  GATE VOCABULARY DRIFT — {len(gate_problems)}:")
        for p in gate_problems:
            print(f"    {p}")
        print()
    if status_problems:
        print(f"  GATE STATUS DRIFT (workflow contradicts manifest) — {len(status_problems)}:")
        for p in status_problems:
            print(f"    {p}")
        print()
    if docs_status_problems:
        print(
            f"  DOCS STATUS DRIFT (docs Job Matrix contradicts manifest) — "
            f"{len(docs_status_problems)}:"
        )
        for p in docs_status_problems:
            print(f"    {p}")
        print()
    if undocumented:
        print(
            f"  UNDOCUMENTED LIVE JOBS (a live workflow runs this; the docs "
            f"never mention it) — {len(undocumented)}:"
        )
        for j in undocumented:
            print(f"    {j}")
        print()
        print()
    if sh_uncatalogued or ui_uncatalogued:
        extras = sh_uncatalogued + [f"[check:all] {x}" for x in ui_uncatalogued]
        print(
            f"  note: {len(extras)} runner label(s) not covered by any "
            f"gates.json gate (informational):"
        )
        print("    " + ", ".join(extras))
        print()

    problems = (
        len(missing_jobs)
        + len(missing_files)
        + len(gate_problems)
        + len(status_problems)
        + len(docs_status_problems)
        + len(unlabelled_retired)
        + len(undocumented_live)
        # A non-Actions config sitting in .github/workflows/ is blocking, not
        # informational: GitHub shows it as an errored workflow, and the existing
        # "undocumented live workflow" line would misreport it as a docs gap.
        + len(misplaced)
        # Blocking: an unrecorded step is the one defect this checker could not
        # previously express at all, so leaving it informational would restore the
        # blind spot under a heading that says "informational".
        + len(orphans)
        # Blocking for the same reason as orphans: a wrong pointer is not a stale
        # comment, it is a claim about enforcement that is now false, and this file's
        # whole purpose is that such claims be checkable rather than remembered.
        + len(pointers)
        # Blocking, on the same grounds as orphans and pointers. It arrives red on five
        # entries, which is the honest state: each is a gate the manifest tracks while
        # recording nothing about its enforcement. All five are then answered -- four by a
        # `_note` saying the gate is local-only and why, one by the CI job it actually has
        # -- so the check is green in the same commit that introduces it and cannot be
        # dismissed as a gate written to be bypassed.
        + len(unrecorded)
        # Escalated from informational to blocking. It was informational while it
        # compared against ci.yml's jobs, i.e. while it could never find anything;
        # pointed at the live workflows it immediately found four undocumented
        # jobs. A job that gates a merge but appears in no document is exactly the
        # gap that let this whole class of lie accumulate.
        + len(undocumented)
        + len(checklist_problems)
    )
    print(f"verify-ci-docs-drift: {problems} drift item(s).")
    return 0 if (args.report_only or problems == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
