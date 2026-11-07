#!/usr/bin/env python3
"""Blank each checker's core predicate in turn and ask whether its self-test notices.

A self-test that cannot fail is the failure mode this project keeps finding. Reading the
source cannot settle it (measured 2026-10-23: four checkers looked path-less to a grep and
all four were fine). The only reliable question is behavioural:

    break the detector, run the self-test, does it go red?

This harness automates that over every Python checker. For each one it finds the first
top-level function that RETURNS something (skipping __main__/main/self_test), replaces
its body with a neutral return, runs --self-test, and records whether the exit code
changed. A SURVIVOR is a self-test that did not notice its detector being gutted.

It writes files, so every mutated run executes from a STAGED copy: a repo-shaped temp
tree (junctioned siblings, copied gate directories) -- never against the tracked checkout.

USAGE
    python scripts/sabotage-selftests.py            # full sweep, prints a table
    python scripts/sabotage-selftests.py --limit 5  # first five checkers only
    python scripts/sabotage-selftests.py --skip 41  # the rest, for chunked runs
"""

from __future__ import annotations

import argparse
import ast
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Never blanked: these ARE the harness, or are the entry point.
SKIP_DEFS = {"main", "self_test", "_self_test", "selfTest", "run", "cli"}
# selfTest is the JS naming convention for a self-test function. Gutting a file's ONLY
# function when that function IS the self-test cannot be caught by that self-test — the
# empty stub still exits 0 — so such a file reports NO MUTATABLE FUNCTION instead of
# counting as a survivor (verify-updater-signature.mjs, measured 2026-11-07).

#: Bare "bash" is WSL here and cannot see the Windows tree (exit 127), so a .sh self-test
#: run through it would fail for the wrong reason and score as a killed mutation.
GIT_BASH = r"C:\Program Files\Git\bin\bash.exe"


def candidate_functions(src: str) -> list[tuple[str, int, int]]:
    """(name, body_start_line, body_end_line) for blankable top-level functions."""
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return []
    out = []
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name in SKIP_DEFS or node.name.startswith("__"):
            continue
        if len(node.body) < 2:
            continue
        out.append((node.name, node.body[0].lineno, node.body[-1].end_lineno or node.body[-1].lineno))
    return out


def blank_body(src: str, name: str, start: int, end: int) -> str:
    """Return src with that function\'s body replaced by a neutral return."""
    lines = src.split("\n")
    indent = " " * (len(lines[start - 1]) - len(lines[start - 1].lstrip()))
    stub = [indent + "return None  # MUTATION: detector gutted"]
    return "\n".join(lines[: start - 1] + stub + lines[end:])


SH_FUNC = re.compile(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\)\s*\{", re.M)
# A plain declaration AND an exported one. Anchoring on "^function" alone missed
# export function collectErrors(...), which is how check-release-version.mjs scored
# "2 funcs, 0 killed": its whole detector was invisible to the sweep, so the score read
# as an uncovered self-test when the self-test simply could not be reached.
MJS_FUNC = re.compile(
    r"^(?:export\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", re.M)


def braces_span(src: str, open_idx: int) -> int | None:
    """Index of the "}" that closes the "{" at open_idx, or None if unbalanced.

    A brace counter, not a parser -- so comment and string contents are stripped first.
    Without that, a "}" inside a quoted message closes the function early and the blanking
    eats the rest of the file (or leaves an unbalanced stub that fails to parse, which the
    harness would then report as the self-test "catching" a mutation it never saw).
    """
    depth = 0
    i = open_idx
    while i < len(src):
        ch = src[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return None


def text_functions(src: str, pattern: re.Pattern, js: bool = False) -> list[tuple[str, int, int]]:
    """(name, open_line, close_line) for functions found by TEXT, for .sh and .mjs.

    js=True switches the stripper to the JS-aware one: regex and template literals
    exist only in .mjs, and a quote-only stripper mis-reads /"([^"]+)"/g as a
    string, then eats balanced braces until the next quote anywhere in the file.
    """
    out = []
    stripped = strip_comments_and_strings(src, js=js)
    for m in pattern.finditer(src):
        name = m.group(1)
        if name in SKIP_DEFS or name.startswith("__"):
            continue
        open_idx = stripped.find("{", m.start())
        if open_idx < 0:
            continue
        close_idx = braces_span(stripped, open_idx)
        if close_idx is None:
            continue
        open_line = src.count("\n", 0, open_idx) + 1
        close_line = src.count("\n", 0, close_idx) + 1
        if close_line - open_line < 2:
            continue          # one-liner: nothing to blank
        out.append((name, open_line, close_line))
    return out


_JS_REGEX_PRECEDERS = set("(=,:[!&|?{};<")
_JS_REGEX_KEYWORDS = ("return", "typeof", "instanceof", "in", "of", "new", "delete",
                      "void", "case", "do", "else", "yield", "await")


def _strip_js(src: str) -> str:
    """JS-aware blanking for .mjs sources: line and block comments, quoted
    strings, template literals with nested interpolations, and regex literals.
    Contents are blanked; offsets and newlines are preserved.

    Regex literals are the point: a quote-only stripper reads /"([^"]+)"/g as a
    string opening at the first double quote, and the phantom string then
    swallows source until the next double quote anywhere in the file — balanced
    function braces included. Measured 2026-11-07: every candidate in
    website/scripts/verify-deploy.mjs was dropped that way and a checker
    carrying 28 self-test cases scored NO MUTATABLE FUNCTION. A regex may start
    after ( = , : [ ! & | ? { ; < or a value-yielding keyword — never directly
    after an identifier or a close paren, which is division.
    """
    out = list(src)
    n = len(src)
    modes = ["code"]            # nesting stack: code/sq/dq/tpl/re/line/block
    re_class = [False]          # inside [...] of the frame's regex
    interp = []                 # ${ depth per interpolation frame

    def blank(i):
        if out[i] != "\n":
            out[i] = " "

    i = 0
    while i < n:
        ch = src[i]
        two = src[i:i + 2]
        mode = modes[-1]
        if mode == "code":
            if two == "//":
                blank(i)
                if i + 1 < n:
                    blank(i + 1)
                modes.append("line")
                i += 2
                continue
            if two == "/*":
                blank(i)
                blank(i + 1)
                modes.append("block")
                i += 2
                continue
            if ch in "'\"":
                modes.append("sq" if ch == "'" else "dq")
                blank(i)
                i += 1
                continue
            if ch == "`":
                modes.append("tpl")
                blank(i)
                i += 1
                continue
            if ch == "/":
                j = i - 1
                while j >= 0 and src[j] in " \t\r\n":
                    j -= 1
                prev = src[j] if j >= 0 else ";"
                word = ""
                k = j
                while k >= 0 and (src[k].isalnum() or src[k] in "_$"):
                    word = src[k] + word
                    k -= 1
                if j < 0 or prev in _JS_REGEX_PRECEDERS or word in _JS_REGEX_KEYWORDS:
                    modes.append("re")
                    re_class.append(False)
                    blank(i)
                i += 1
                continue
            if interp and ch == "{":
                interp[-1] += 1
                blank(i)             # interpolation braces are template machinery,
                i += 1               # not the function's braces: blank them all
                continue
            if interp and ch == "}":
                blank(i)
                if interp[-1] == 0:
                    interp.pop()
                    modes.pop()      # ${...} closed: back to the template
                else:
                    interp[-1] -= 1
                i += 1
                continue
            i += 1
            continue
        if mode == "line":
            if ch == "\n":
                modes.pop()
            else:
                blank(i)
            i += 1
            continue
        if mode == "block":
            if two == "*/":
                blank(i)
                blank(i + 1)
                modes.pop()
                i += 2
                continue
            blank(i)
            i += 1
            continue
        if mode in ("sq", "dq"):
            q = "'" if mode == "sq" else '"'
            if ch == "\\":
                blank(i)
                if i + 1 < n:
                    blank(i + 1)
                i += 2
                continue
            if ch == q:
                blank(i)
                modes.pop()
                i += 1
                continue
            if ch == "\n":          # unterminated: recover at the newline
                modes.pop()
                i += 1
                continue
            blank(i)
            i += 1
            continue
        if mode == "tpl":
            if ch == "\\":
                blank(i)
                if i + 1 < n:
                    blank(i + 1)
                i += 2
                continue
            if two == "${":
                blank(i)
                blank(i + 1)
                interp.append(0)
                modes.append("code")
                i += 2
                continue
            if ch == "`":
                blank(i)
                modes.pop()
                i += 1
                continue
            blank(i)
            i += 1
            continue
        if mode == "re":
            if ch == "\\":
                blank(i)
                if i + 1 < n:
                    blank(i + 1)
                i += 2
                continue
            if ch == "\n":          # a regex cannot span lines: recover
                modes.pop()
                re_class.pop()
                i += 1
                continue
            if re_class[-1]:
                if ch == "]":
                    re_class[-1] = False
                blank(i)
                i += 1
                continue
            if ch == "[":
                re_class[-1] = True
                blank(i)
                i += 1
                continue
            if ch == "/":
                modes.pop()
                re_class.pop()
            blank(i)
            i += 1
            continue
    return "".join(out)


def strip_comments_and_strings(src: str, js: bool = False) -> str:
    """Blank # // /* */ and quoted contents, preserving offsets and newlines.

    js=True adds the two literal kinds shell has no notion of and JS code is
    full of: regex literals (whose quotes and brackets would otherwise read as
    strings) and template literals (whose contents — and ${} interpolations
    — must not leak braces into the brace counter). See _strip_js.
    """
    if js:
        return _strip_js(src)
    out = list(src)
    i = 0
    n = len(src)
    while i < n:
        two = src[i:i + 2]
        if two == "//" or src[i] == "#":
            j = src.find("\n", i)
            j = n if j < 0 else j
            for k in range(i, j):
                out[k] = " "
            i = j
            continue
        if two == "/*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                if out[k] != "\n":
                    out[k] = " "
            i = j
            continue
        if src[i] in "\"'":
            quote = src[i]
            j = i + 1
            while j < n and src[j] != quote:
                if src[j] == "\\":
                    j += 2
                    continue
                j += 1
            for k in range(i + 1, min(j, n)):
                if out[k] != "\n":
                    out[k] = " "
            i = j + 1
            continue
        i += 1
    return "".join(out)


#: One neutral statement per language: shell's ":" is a no-op that cannot fail, and
#: JS's "return undefined;" keeps the function callable. A "return"-style stub would be
#: wrong in shell (the function would still exit 0, so a mutation could look harmless)
#: and a bare ":" is a syntax error in JS.
NEUTRAL = {".sh": "  :  # MUTATION: detector gutted",
           ".mjs": "  return undefined;  // MUTATION: detector gutted"}


def blank_text_body(src: str, open_line: int, close_line: int, suffix: str) -> str:
    """Gut a brace-delimited body found by text_functions(), keeping the file parseable.

    The opening and closing lines are KEPT and only the lines between them are replaced,
    so the braces still match and the file still parses. A mutation that leaves a syntax
    error would make every self-test "fail", scoring as KILLED while proving nothing.
    """
    lines = src.split("\n")
    return "\n".join(lines[:open_line] + [NEUTRAL[suffix]] + lines[close_line - 1:])


def failure_cause(stderr: str, stdout: str) -> str:
    """The one line a failed self-test's output says WHY in, or "" if none.

    The LAST non-empty line: self-tests print their progress first and their
    verdict last, so the tail is the sentence an operator needs. stderr is
    preferred (refusals and tracebacks land there); stdout is the fallback for
    checkers that report failure to it. Truncated to one table-width line --
    the cause is a pointer for a human, not the whole log.
    """
    for text in (stderr, stdout):
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        if lines:
            cause = lines[-1]
            return cause[:107] + "..." if len(cause) > 110 else cause
    return ""


def run_self_test_out(path: Path) -> tuple[int | None, str]:
    """Run the checker's --self-test with the interpreter its extension implies.

    Returns (exit code, failure cause line). The cause is extracted from the
    run's own output by failure_cause() and carried on the survey row, because
    a verdict that names no cause sends the operator re-running the failure by
    hand. An empty cause means the run passed or left nothing to quote.
    """
    suffix = path.suffix
    if suffix == ".sh":
        # Git's bash by FULL PATH, never a bare "bash": on this workstation the bare name
        # resolves to WSL, which cannot see the Windows tree and exits 127. That is not a
        # killed mutation, it is a checker that never ran -- and at the sweep level it would
        # have read as every .sh self-test "catching" every mutation.
        cmd = [GIT_BASH, str(path), "--self-test"]
    elif suffix == ".mjs":
        cmd = ["node", str(path), "--self-test"]
    else:
        cmd = [sys.executable, str(path), "--self-test"]
    try:
        r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        return None, "self-test timed out after 300s"
    return r.returncode, failure_cause(r.stderr, r.stdout)


def run_self_test(path: Path) -> int | None:
    """The exit code only -- the shape every caller before round-71 relied on."""
    return run_self_test_out(path)[0]


def build_temp_root(dest: Path, root: Path = ROOT) -> Path:
    """Stage a repo-shaped tree under dest: junctioned siblings, copied gate roots.

    A self-test that resolves paths through __file__ needs its checker to live at a
    plausible repo path with the repo's OTHER files reachable from there. So the temp
    tree junctions every top-level entry of the real repo (read-only by convention --
    nothing in this harness writes outside the three copied roots) and makes REAL
    copies of the enumeration roots, where the mutated bytes go. The tracked checkout
    is never written: all harness writes land under dest.
    """
    for entry in sorted(root.iterdir()):
        if entry.name in (".git", ".env"):
            continue                       # history and secrets never enter the staging tree
        target = dest / entry.name
        if entry.name in OVERLAY_ROOTS and entry.is_dir():
            _overlay(entry, target)
        elif entry.is_dir():
            _link_or_copy(entry, target)
        else:
            shutil.copy2(entry, target)
    return dest


OVERLAY_ROOTS = ("scripts", ".agents", "website")
SKIP_NAMES = {"node_modules", "__pycache__", "dist", ".astro", "build", "target"}


def _overlay(real: Path, mirror: Path) -> None:
    """Copy a gate directory wholesale (it is small text); skip regenerable dirs."""
    mirror.mkdir(parents=True, exist_ok=True)
    for child in sorted(real.iterdir()):
        if child.name in SKIP_NAMES:
            continue
        if child.is_dir():
            _overlay(child, mirror / child.name)
        else:
            shutil.copy2(child, mirror / child.name)


def _link_or_copy(real: Path, mirror: Path) -> None:
    """Junction a sibling directory so __file__-relative reads reach the real bytes."""
    r = subprocess.run(["cmd", "/c", "mklink", "/J", str(mirror), str(real)],
                       capture_output=True, text=True)
    if r.returncode != 0:                  # non-Windows or denied: copy instead
        shutil.copytree(real, mirror,
                        ignore=shutil.ignore_patterns(*SKIP_NAMES))


#: The self-test capability marker: the argparse flag INSIDE a quoted literal.
#: A substring search is not a census -- verify-website-assets.py MENTIONS
#: --self-test in a paragraph explaining why it has none, and that prose was
#: once read as a capability (it then errored "unrecognized arguments",
#: recorded in the round-51 survey as PATH ALREADY RED).
SELF_TEST_FLAG = re.compile(r"""["']--self-test["']""")

#: Self-tested scripts deliberately OUTSIDE the census: no running pipeline
#: depends on them and no censused file loads them (measured 2026-11-07 against
#: scripts/check.sh, .githooks/pre-push, the GitHub workflows, both package.json
#: manifests and every censused file's text). They are standalone operator
#: tools, audited 2026-11-07 (round-72), each ALIVE with its consumer named --
#: the per-file evidence that would otherwise have to be re-derived from 875
#: lines of docstring at every audit:
#:
#:   sign-plugin.py -- signs plugins; the verifying side is
#:       crates/kasirmu-plugin/src/signature.rs (plugin_digest), the flow is
#:       documented in docs/guides/developer/plugin-guide.md, and the example
#:       plugin it signs ships in scripts/examples/example-discount/.
#:   restaurant-coverage.py -- audits e2e coverage of the restaurant surface
#:       (109 specs under ui/e2e/ against the feature files); the instrument
#:       five records under docs/records/audits/ were written with.
#:   extract-updater-seed.py -- recovers the Ed25519 seed behind the updater
#:       pubkey pinned at apps/desktop-tauri/tauri.conf.json:73, the secret
#:       the live release.yml updater signing consumes.
#:
#: self_test() holds this list to the criterion with census_carriers() and
#: pipeline_references(): a pipeline that starts depending on one of these
#: reddens the self-test until the file joins the census, and a new
#: self-test-carrying script that lands without a census membership reddens it
#: too -- the round-66 failure mode, where eleven self-tested checkers ran
#: unmeasured under a copied glob list while 96 rows read as the world.
#: Round-69 lesson, now graded: allowlist-schema.py sat here as "no pipeline
#: runs it" while two censused gates loaded it by path -- wiring a name search
#: over pipeline files cannot see, so self_test() also scans censused files'
#: text for an excluded basename. Round-72 adds the mirror direction: an
#: excluded script that stops quoting the flag is a dead file that should be
#: deleted, not parked here, and the flag check below reddens when that
#: happens.
CENSUS_EXCLUDED = (
    "scripts/sign-plugin.py",
    "scripts/restaurant-coverage.py",
    "scripts/extract-updater-seed.py",
)


#: Every place a RUNNING pipeline can wire a checker. This is
#: verify-selftests-wired.py's RUNNERS list kept in step (round-74):
#: scripts/check.ps1 and scripts/check-auditor-selftests.sh were invisible to
#: the scan below, so an excluded script invoked by either read as unwired in
#: THIS vocabulary while the other gate called it wired -- two gates answering
#: an overlapping question with different runner sets make "wired" ambiguous
#: at exactly the boundary where a parked script's life is decided.
#: wiring_runner_gaps() holds the two lists to each other in both directions.
RUNNER_FILES = (
    "scripts/check.sh",
    ".githooks/pre-commit",
    ".githooks/pre-push",
    "scripts/check.ps1",
    "scripts/check-auditor-selftests.sh",
    "website/package.json",
    "ui/package.json",
)


def pipeline_references(name: str) -> list[str]:
    """Pipeline files mentioning `name` -- the wiring half of the criterion.

    A reference is necessary-but-not-sufficient evidence of wiring, which is
    the honest direction for holding CENSUS_EXCLUDED: the moment ANY pipeline
    names an excluded file, the self-test reddens and a human decides whether
    the file belongs in the census.

    Workflow scanning is RECURSIVE with attic/ skipped: a retired workflow is
    never executed (GitHub ignores .bak; the attic holds the rest), and the
    same false negative verify-flaky-quarantine.py suffered from .bak runners
    would wire a dead thing here.
    """
    hits = []
    for rel in RUNNER_FILES:
        p = ROOT / rel
        if p.exists() and name in p.read_text(encoding="utf-8", errors="replace"):
            hits.append(rel)
    for wf in sorted((ROOT / ".github" / "workflows").rglob("*.y*ml")):
        if "attic" in {q.lower() for q in wf.parts}:
            continue
        if name in wf.read_text(encoding="utf-8", errors="replace"):
            hits.append(wf.relative_to(ROOT).as_posix())
    return hits


def _other_gate_runners() -> set[str]:
    """The runner paths named by verify-selftests-wired.py's RUNNERS block."""
    text = (ROOT / "scripts/verify-selftests-wired.py").read_text(encoding="utf-8", errors="replace")
    block = text.split("RUNNERS = (", 1)[1].split("\n)", 1)[0]
    out: set[str] = set()
    for ln in block.splitlines():
        if not ln.lstrip().startswith("#"):
            toks = re.findall(r'"([^"]+)"', ln)
            if toks:
                out.add("/".join(toks))
    return out


def wiring_runner_gaps() -> list[str]:
    """Divergences between the census's runner list and the other wiring gate's.

    Two-sided on purpose: a runner the other gate knows must be scannable
    here (its invisibility would let an exclusion depend on wiring this
    vocabulary cannot see), and every baseline runner here must still be
    named there (the other gate narrowing on its own would deserve the same
    alarm). Either side changing alone reddens.
    """
    other = _other_gate_runners()
    gaps = sorted(r for r in other
                  if "." in r.rsplit("/", 1)[-1] and r not in RUNNER_FILES)
    for rel in RUNNER_FILES:
        if rel not in other:
            gaps.append(rel + " is no longer in verify-selftests-wired's RUNNERS")
    return gaps


def census_files() -> list[Path]:
    """Every self-tested, pipeline-wired script the sabotage survey grades.

    The single enumeration site: survey() and any census-completeness check must
    call THIS, never a copy of its globs -- a copied glob list rots the moment a
    checker lands (round-66: five website check-* scripts and six named scripts/
    files were invisible to exactly such a copy while 96 rows read as the world).
    Membership criterion: the script carries a quoted --self-test AND a running
    pipeline depends on it -- directly (check.sh step, pre-commit or pre-push
    hook, workflow,
    website package.json) or transitively (a censused checker loads it by
    path; round-69: the shared allowlist schema). Scripts that self-test but
    nothing depends on are out, listed in CENSUS_EXCLUDED and held there by
    self_test().
    """
    files = []
    for base, pattern in (
        ("scripts", "verify-*.py"), ("scripts", "check-*.py"),
        ("scripts", "verify-*.sh"), ("scripts", "check-*.sh"),
        ("scripts", "verify-*.mjs"), ("scripts", "check-*.mjs"),
        # Outside scripts/ but self-tested and wired into check.sh (round-51 census):
        # the docs-auditor checkers via scripts/check-auditor-selftests.sh, the website
        # deploy prober via its own step. backup-db.sh / restore-db.sh are named
        # outright: their names predate the verify-*/check-* convention.
        (".agents/skills/docs-auditor/scripts", "check-*.py"),
        ("website/scripts", "verify-*.mjs"),
        # Round-51 census missed the website check-* convention entirely: five more
        # self-tested checkers wired into check.sh, dev-ci.yml, and the website
        # package.json precheck ran unmeasured under every verify-*-* glob.
        ("website/scripts", "check-*.py"),
        ("website/scripts", "check-*.mjs"),
    ):
        files.extend(sorted((ROOT / base).glob(pattern)))
    # Named outright, round-66 census: self-tested scripts whose verdicts gates
    # depend on but whose names match no convention above -- two check.sh steps
    # each, one dev-ci step, one release-workflow signer, and the pre-push
    # orchestrator itself. allowlist-schema.py joins in round-69: both gates
    # that consume it (verify-ipc-parity.py, verify-scoped-reads.py) load it by
    # path, so it is wired TRANSITIVELY -- and a schema the survey refuses to
    # grade is a schema its two gates can silently disagree about, the disease
    # the module exists to cure. Deliberately NOT censused: the three scripts
    # in CENSUS_EXCLUDED carry --self-test but nothing depends on them (the
    # harness self-test holds that list to the criterion), and
    # sabotage-selftests.py is this harness.
    files.extend(ROOT / "scripts" / name for name in (
        "backup-db.sh", "restore-db.sh",
        "census-orphan-modules.py", "classify-finding-reachability.py",
        "scan-unwrap-panic.py", "generate-pg-migration.py",
        "generate-latest-json.mjs", "run-pre-push.py",
        "allowlist-schema.py",
    ))
    return [f for f in files if SELF_TEST_FLAG.search(f.read_text(encoding="utf-8", errors="replace"))]


def census_carriers() -> list[str]:
    """Tracked scripts quoting the self-test flag, derived INDEPENDENTLY.

    git ls-files over the census roots -- not a call into census_files(). This
    re-derivation is what self_test() grades the census against, so a glob that
    rots (round-66's failure mode) shows up as a DIFFERENCE between the two
    instead of agreement between two copies of the same assumption.
    """
    out = subprocess.run(
        ["git", "ls-files", "scripts", "website/scripts",
         ".agents/skills/docs-auditor/scripts"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    carriers = []
    for rel in out.stdout.splitlines():
        p = ROOT / rel
        if p.suffix not in (".py", ".sh", ".mjs"):
            continue
        try:
            if SELF_TEST_FLAG.search(p.read_text(encoding="utf-8", errors="replace")):
                carriers.append(rel.replace("\\", "/"))
        except OSError:
            continue
    return carriers


def survey(limit: int | None, skip: int = 0) -> list[tuple[str, str, int, int, str]]:
    """(checker, mutated function, before, after, verdict) for every candidate."""
    # Three languages, two mechanisms. Python is mutated through its AST (find the
    # FunctionDef, replace the body). .sh and .mjs have no stdlib parser here, so they are
    # mutated by TEXT: locate "name() {" / "function name(", then walk braces over a
    # comment-and-string-blanked copy to find the closing brace. Blanking first matters --
    # a "}" inside a quoted message would otherwise close the function early and the
    # "mutation" would be a broken file, which reads as the self-test working when it is
    # just a syntax error. Both mechanisms answer the same question: does the self-test
    # notice its detector being gutted.
    files = census_files()
    if skip:
        files = files[skip:]
    if limit:
        files = files[:limit]
    rows = []
    with tempfile.TemporaryDirectory() as td:
        td_root = build_temp_root(Path(td))
        for p in files:
            src = p.read_text(encoding="utf-8", errors="replace")
            base, base_cause = run_self_test_out(p)
            if base != 0:
                rows.append((p.name, "-", base if base is not None else -1, -1,
                             "PATH ALREADY RED", base_cause))
                continue
            if p.suffix == ".sh":
                cands = text_functions(src, SH_FUNC)
            elif p.suffix == ".mjs":
                cands = text_functions(src, MJS_FUNC, js=True)
            else:
                cands = candidate_functions(src)
            if not cands:
                rows.append((p.name, "-", 0, 0, "NO MUTATABLE FUNCTION", ""))
                continue
            # Relocation control, staged edition: the UNMUTATED file runs from the same
            # staged path the mutant will use. A self-test that still cannot run from
            # there gets its own verdict instead of lending its failure to a mutant.
            rel_target = td_root / p.relative_to(ROOT)
            rel_target.write_text(src, encoding="utf-8")
            relo_rc, relo_cause = run_self_test_out(rel_target)
            if relo_rc not in (0, None):
                rows.append((p.name, "-", 0, relo_rc, "RELOCATION-SENSITIVE", relo_cause))
                continue
            # Mutate only the FIRST candidate: enough to answer "can this self-test fail".
            name, s0, e0 = cands[0]
            if p.suffix in (".sh", ".mjs"):
                mutated = blank_text_body(src, s0, e0, p.suffix)
            else:
                mutated = blank_body(src, name, s0, e0)
            rel_target.write_text(mutated, encoding="utf-8")
            after = run_self_test(rel_target)
            verdict = "KILLED" if after not in (0, None) else "SURVIVED"
            rows.append((p.name, name, 0, after if after is not None else -1, verdict, ""))
            # Restore the staged bytes: a mutant's residue must not leak into the
            # shared tree. Measured 2026-11-07: check-updater-compat's staged control
            # spawned the PREVIOUS checker's still-gutted verify-updater-signature.mjs
            # ("verifyUpdaterSignature rejected a valid signature") and scored
            # RELOCATION-SENSITIVE from cross-checker contamination, not from anything
            # in the checker under test. The control ran against a sabotaged tree.
            rel_target.write_text(src, encoding="utf-8")
    return rows


def git_status_porcelain() -> str:
    """The tracked tree's dirt, exactly as `git status --porcelain` prints it."""
    return subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout


def junction_writethrough(before: str, after: str) -> list[tuple[str, str]]:
    """Tracked-tree changes that appeared between two porcelain snapshots.

    build_temp_root junctions every top-level sibling back at the REAL
    checkout, so each staged run is 300+ per survey chances for a checker to
    land a write in tracked files (measured 2026-11-07: a canary written to
    the staged crates/ appears in the real crates/). A survey owes the tree
    zero changes: anything in `after` that was not in `before` and is not
    untracked scratch ('??' — caches and .agents probes are common and benign)
    is a write-through and the survey's exit must say so.
    """
    prior = set(before.splitlines())
    out = []
    for line in after.splitlines():
        if line and line not in prior and not line.startswith("??"):
            out.append((line[:2], line[3:]))
    return out


def checksh_invokes_self_test() -> bool:
    """The pipeline's slice: check.sh must still invoke the harness's --self-test.

    The campaign's two-gate protocol rests on one line of check.sh: it is what
    runs these graded cases on every commit. If that line drifts away (renamed
    flag, dropped step), the harness keeps passing for everyone who runs it by
    hand and silently stops being a pipeline gate for everyone else. The
    inverse holds by design and is documented at the call site: check.sh runs
    NO survey -- 12-17 minutes of staged mutation per commit is not a gate,
    and the round-70 exit contract (unmeasured fails) would redden unrelated
    commits the moment any lane's checker sat under active development.
    """
    return ("scripts/sabotage-selftests.py --self-test"
            in (ROOT / "scripts/check.sh").read_text(encoding="utf-8", errors="replace"))


def survey_exit(rows: list[tuple[str, str, int, int, str, str]],
                through: list[tuple[str, str]]) -> int:
    """The survey's exit contract: green ONLY when every row killed, cleanly.

    A row whose verdict is not KILLED is a row the survey could not measure:
    PATH ALREADY RED (the checker is red before any mutation),
    RELOCATION-SENSITIVE (its self-test cannot run from a copy), NO MUTATABLE
    FUNCTION (nothing to gut), SURVIVED (the worst -- the self-test watched the
    gutting and said nothing). The table already says "unmeasured, not proven"
    about every one of them, so an exit 0 over them would contradict the table
    printed above it -- the r51 survey scored 6 relocation-sensitive rows under
    an exit 0 and called the sheet clean. A write-through fails for the same
    reason: the harness that guards the tree may not break it silently.
    """
    return 1 if (any(r[4] != "KILLED" for r in rows) or through) else 0


def self_test() -> int:
    """Grade the four parts that can lie silently: the MUTATOR, the CENSUS,
    the STAGED-RUN ISOLATION, and the EXIT.

    A mutation harness has one failure mode worth fearing: producing a mutation that is
    not one. A blanked function that leaves a syntax error makes every self-test "fail"
    and scores as KILLED while proving nothing -- the harness would report a clean sheet
    over checkers it never tested. So the mutant cases are about the mutants being VALID:
    parsable, brace-balanced, and actually different from the source. The census cases
    hold census_files() to its own membership criterion (round-66: a hand-copied glob
    list hid eleven self-tested checkers while 96 rows read as the world).
    """
    import subprocess as sp

    bad: list[str] = []

    def want(name, got, expect) -> None:
        if got != expect:
            bad.append(f"{name}: expected {expect!r}, got {got!r}")

    # Brace matching must ignore braces inside strings and comments, or a "}" in a message
    # closes the function early and the blanking eats the rest of the file.
    tricky = 'function f() {\n  log("}");\n  if (x) { y(); }\n}\nafter();'
    cands = text_functions(tricky, MJS_FUNC)
    want("one function found", [c[0] for c in cands], ["f"])
    # Guard the index: an over-eager brace walker finds no function at all here, and
    # cands[0] then raises IndexError instead of naming the broken case.
    want("the closing brace is the real one",
         [c[2] for c in cands], [4])  # line of the final }

    # The blanked body still parses in each language. A mutant that will not parse would
    # make every run "kill" its mutant.
    for suffix, src, pat, parser in (
        (".sh", "f() {\n  echo a\n  echo b\n}\nf", SH_FUNC, None),
        (".mjs", "function f() {\n  return 1;\n  return 2;\n}\nf", MJS_FUNC, None),
    ):
        cs = text_functions(src, pat)
        if not cs:
            bad.append(f"{suffix}: the fixture was not recognised as a function")
            continue
        mutated = blank_text_body(src, cs[0][1], cs[0][2], suffix)
        want(f"{suffix} mutant still has both braces",
             mutated.count("{") == src.count("{") and mutated.count("}") == src.count("}"), True)
        want(f"{suffix} mutant differs from the source", mutated != src, True)
        want(f"{suffix} mutant keeps the trailing line", mutated.rstrip().endswith("f"), True)

    # Exported JS functions are candidates. Anchoring on "^function" alone missed
    # export function collectErrors(...), and that one miss turned a covered checker into
    # a "0 killed" row.
    want("an exported function is a candidate",
         [c[0] for c in text_functions("export function g() {\n  a();\n  b();\n}\n", MJS_FUNC)],
         ["g"])

    # self_test itself is never a candidate, in any language: blanking the thing under
    # test and then reporting what it says is the definition of a meaningless result.
    want("self_test is never a candidate",
         [c[0] for c in text_functions("self_test() {\n  a\n  b\n}\n", SH_FUNC)], [])

    # A regex literal containing quotes must not read as a string: the phantom string
    # then swallows balanced braces and every candidate in the file is dropped
    # (measured 2026-11-07 on website/scripts/verify-deploy.mjs, which carries 28
    # self-test cases and scored NO MUTATABLE FUNCTION). The tricky fixture above
    # must also survive the JS-aware stripper, and templates must not leak braces.
    regexy = ("function f() {\n"
              '  const m = [...s.matchAll(/"([^"]+)"/g)];\n'
              "  if (m) { use(m); }\n"
              "}\nafter();")
    cands = text_functions(regexy, MJS_FUNC, js=True)
    want("a quote-bearing regex does not hide the function", [c[0] for c in cands], ["f"])
    want("...and the close is still the real one", [c[2] for c in cands], [4])
    want("tricky holds under the JS stripper too",
         [c[0] for c in text_functions(tricky, MJS_FUNC, js=True)], ["f"])
    tpl_fixture = ("function f() {\n"
                   "  const s = `a ${x} b`;\n"
                   "  log(`}`);\n"
                   "}\n")
    want("template literals do not leak braces",
         [c[0] for c in text_functions(tpl_fixture, MJS_FUNC, js=True)], ["f"])

    # ── the census is held to its own membership criterion (round-66 lesson) ──
    carriers = set(census_carriers())
    censused = {f.relative_to(ROOT).as_posix() for f in census_files()}
    expected = carriers - set(CENSUS_EXCLUDED) - {"scripts/sabotage-selftests.py"}
    missing = sorted(expected - censused)
    extra = sorted(censused - expected)
    if missing:
        bad.append("census misses self-tested script(s): " + ", ".join(missing))
    if extra:
        bad.append("census grades non-carrier(s): " + ", ".join(extra))
    want("the census is not empty", bool(censused), True)
    want("every excluded script still exists",
         all((ROOT / rel).exists() for rel in CENSUS_EXCLUDED), True)
    want("every excluded script still quotes the self-test flag",
         all(SELF_TEST_FLAG.search((ROOT / rel).read_text(encoding="utf-8", errors="replace"))
             for rel in CENSUS_EXCLUDED if (ROOT / rel).exists()), True)
    want("every runner file the census scans still exists",
         all((ROOT / rel).exists() for rel in RUNNER_FILES), True)
    want("the census's runner list agrees with verify-selftests-wired's",
         wiring_runner_gaps(), [])
    for rel in CENSUS_EXCLUDED:
        refs = pipeline_references(Path(rel).name)
        if refs:
            bad.append(f"{rel} is now pipeline-wired ({', '.join(refs)}) — it must join the census")
    excluded_names = [Path(rel).name for rel in CENSUS_EXCLUDED]
    for c in sorted(censused):
        text = (ROOT / c).read_text(encoding="utf-8", errors="replace")
        for rel, nm in zip(CENSUS_EXCLUDED, excluded_names):
            if nm in text:
                bad.append(f"{rel} is loaded by censused {c} — it must join the census")
    want("the harness is never its own subject",
         "scripts/sabotage-selftests.py" not in censused, True)

    # ── the pipeline's slice: check.sh runs the graded cases, never the survey ──
    want("check.sh still invokes the harness's --self-test",
         checksh_invokes_self_test(), True)

    # ── staged runs must never write through a junctioned sibling ────────────
    want("a new modification is reported",
         junction_writethrough("", " M scripts/x.py"), [(" M", "scripts/x.py")])
    want("pre-existing dirt is not re-reported",
         junction_writethrough(" M scripts/x.py", " M scripts/x.py"), [])
    want("untracked scratch never counts as write-through",
         junction_writethrough("", "?? .agents/probe.py"), [])
    want("an empty after is no write-through", junction_writethrough(" M a", ""), [])
    want("a staged addition is reported",
         junction_writethrough("", "A  crates/new.py"), [("A ", "crates/new.py")])
    want("a deletion is reported",
         junction_writethrough("", " D docs/x.md"), [(" D", "docs/x.md")])

    # ── the survey's exit contract: only an all-killed, clean-tree survey is 0 ──
    row = lambda v: ("x.py", "f", 0, 1, v, "")
    want("an all-killed survey with a clean tree exits 0",
         survey_exit([row("KILLED"), row("KILLED")], []), 0)
    want("a survivor fails the exit", survey_exit([row("KILLED"), row("SURVIVED")], []), 1)
    want("a relocation-sensitive row fails the exit",
         survey_exit([row("RELOCATION-SENSITIVE")], []), 1)
    want("a no-mutatable row fails the exit",
         survey_exit([row("NO MUTATABLE FUNCTION")], []), 1)
    want("a path-already-red row fails the exit",
         survey_exit([row("PATH ALREADY RED")], []), 1)
    want("a write-through fails the exit even with every row killed",
         survey_exit([row("KILLED")], [(" M", "crates/x.rs")]), 1)

    # ── a failed run's cause rides on the row, not in the bit bucket ──────────
    want("the stderr tail is the cause",
         failure_cause("ok 1\nok 2\nerror: bad shape\n", "ignored"), "error: bad shape")
    want("stdout is the fallback when stderr is empty",
         failure_cause("", "progress\nthe real failure"), "the real failure")
    want("blank lines never become the cause",
         failure_cause("\n  \nthe actual cause\n", ""), "the actual cause")
    want("nothing to quote is an empty cause", failure_cause("", ""), "")
    long_line = "x" * 200
    want("a cause longer than a table line is truncated",
         failure_cause(long_line, ""), long_line[:107] + "...")

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (42 cases, no checker is run)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--skip", type=int, default=0,
                    help="Drop the first N checkers of the filtered list, so the full "
                         "matrix can be measured in chunks that fit one tool call.")
    ap.add_argument("--self-test", action="store_true",
                    help="Grade the mutator on synthetic sources and exit.")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    before_tree = git_status_porcelain()
    rows = survey(args.limit, args.skip)
    through = junction_writethrough(before_tree, git_status_porcelain())
    survivors = [r for r in rows if r[4] == "SURVIVED"]
    relocated = [r for r in rows if r[4] == "RELOCATION-SENSITIVE"]
    unmutatable = [r for r in rows if r[4] == "NO MUTATABLE FUNCTION"]
    already_red = [r for r in rows if r[4] == "PATH ALREADY RED"]
    killed = [r for r in rows if r[4] == "KILLED"]
    for name, fn, before, after, verdict, cause in rows:
        print("  %-46s %-28s %-12s exit %s -> %s" % (name, fn[:28], verdict, before, after))
        if cause:
            print("      cause: %s" % cause)
    print("")
    print("sabotage: %d checker(s), %d SURVIVED (their self-test did not notice the gutted "
          "detector), %d killed, %d RELOCATION-SENSITIVE (self-test cannot run from a copy; "
          "unmeasured, not proven), %d NO MUTATABLE FUNCTION, %d PATH ALREADY RED (red "
          "before any mutation)."
          % (len(rows), len(survivors), len(killed), len(relocated), len(unmutatable),
             len(already_red)))
    if through:
        print("")
        print("STAGED WRITE-THROUGH: the survey left tracked dirt in the real tree:")
        for st, path in through:
            print("  %s %s" % (st, path))
        print("  a staged run wrote through a junctioned sibling; do not trust")
        print("  the table above until this is explained.")
    unmeasured = len(rows) - len(killed)
    if unmeasured:
        print("survey: %d row(s) unmeasured -- exit 1 by contract." % unmeasured)
    return survey_exit(rows, through)


if __name__ == "__main__":
    sys.exit(main())
