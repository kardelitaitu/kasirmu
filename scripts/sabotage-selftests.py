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


def alliance_grade(rc: int | None, cause: str) -> list:
    """The alliance case's arithmetic, pure: [rc] on green, [rc, cause] on red,
    [None] on a timeout -- each graded against [0]. The cause rides along ONLY
    when red: on a green run failure_cause carries the partner's own OK line
    (stdout fallback), and letting it leak would redden every green partner.
    Extracted (round-86) so the fire directions are GRADED, not probe-proven.
    """
    return [rc] + ([cause] if rc else [])


def ok_line_count(text: str) -> int | None:
    """PURE: the case count a SELF-TEST OK line declares -- None when the text
    is not an OK line. Round-94: the alliance fixture quoted the partner's old
    8-case line after the partner had grown past it, a stale literal no case
    parsed -- and both gates' own OK counts turned out to be hand-maintained
    lies (this gate said 98 over 92 want() sites, the partner 12 over 11). The
    counts are now derived from the inventory and graded against it."""
    m = re.search(r"SELF-TEST OK \((\d+) cases", text)
    return int(m.group(1)) if m else None


def want_inventory(text: str) -> int:
    """PURE: the number of want() call sites in a gate's source -- the count an
    OK line must declare. Sites are counted after full-line comment strips by
    the call token, excluding want's own def line; a multi-line call counts
    once, and a site inside a loop counts once (the printed number is CASES,
    not assertions -- three sites here fire once per parsed suffix). The count
    is LINE-START calls on comment-stripped text: every call site opens its
    own line here, and a prose mention of want() in a docstring must not
    count (the first draft's regex-all counter matched this gate's own
    helper docstring and over-counted by one)."""
    return len(re.findall(r"^[ \t]+want\(", _drop_comment_lines(text), re.M))


def self_test_command(path: Path) -> list[str]:
    """The interpreter a checker's extension implies -- pure, so the mapping is
    gradeable without running anything. Round-96: the dispatch lived inline in
    run_self_test_out, and a missing interpreter crashed the sweep with an
    unhandled FileNotFoundError instead of a named verdict. .sh must go through
    Git's bash by FULL PATH, never a bare "bash": on this workstation the bare
    name resolves to WSL, which cannot see the Windows tree and exits 127 -- a
    checker that never ran, which at the sweep level would have read as every
    .sh self-test "catching" every mutation."""
    suffix = path.suffix
    if suffix == ".sh":
        return [GIT_BASH, str(path), "--self-test"]
    if suffix == ".mjs":
        return ["node", str(path), "--self-test"]
    return [sys.executable, str(path), "--self-test"]


def run_self_test_out(path: Path) -> tuple[int | None, str]:
    """Run the checker's --self-test with the interpreter its extension implies.

    Returns (exit code, failure cause line). The cause is extracted from the
    run's own output by failure_cause() and carried on the survey row, because
    a verdict that names no cause sends the operator re-running the failure by
    hand. An empty cause means the run passed or left nothing to quote.
    """
    cmd = self_test_command(path)
    try:
        r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        return None, "self-test timed out after 300s"
    except FileNotFoundError:
        return None, "self-test could not run: interpreter " + cmd[0] + " not found"
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

#: The alliance partner (round-76): the other wiring gate, whose self-test this
#: harness runs as a graded case. Its flag is itself wired (check.sh
#: "self-tests wired self-test" step, dev-ci.yml) and its self-test costs under
#: half a second, so the pairing the campaign relies on -- two gates, each run
#: green every round -- is enforced by the census side instead of remembered by
#: the operator. One-directional ON PURPOSE: the harness grades the alliance;
#: the partner never runs THIS self-test, so the case cannot recurse.
ALLIANCE_PARTNER = "scripts/verify-selftests-wired.py"


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
    return wiring_hits(name, runner_texts())


def runner_texts() -> dict[str, str]:
    """Every runner's text, keyed by repo-relative path -- the wiring corpus."""
    texts: dict[str, str] = {}
    for rel in RUNNER_FILES:
        p = ROOT / rel
        if p.exists():
            texts[rel] = p.read_text(encoding="utf-8", errors="replace")
    for wf in sorted((ROOT / ".github" / "workflows").rglob("*.y*ml")):
        if "attic" in {q.lower() for q in wf.parts}:
            continue
        texts[wf.relative_to(ROOT).as_posix()] = wf.read_text(encoding="utf-8", errors="replace")
    return texts


def declares_flag(text: str) -> bool:
    """The census's declaration predicate: a QUOTED --self-test on a live line.
    Round-95: the search ran over raw text, so a quoted flag in a COMMENT
    declared a self-test -- the r84 semantics (comments cannot wire, load,
    invoke) now extend to declare. Measured before landing: no flag carrier's
    flag is comment-only, so every verdict is unchanged."""
    return bool(SELF_TEST_FLAG.search(_drop_comment_lines(text)))


def _drop_comment_lines(text: str) -> str:
    """Whole-line comments dropped -- the partner's strip_full_line_comments.

    A checker documenting its own dead flag beside the flag it declares must
    not read as WIRED here either; the partner's docstring records the live
    case that made the strip necessary on its side
    (verify-migration-column-types.py). Measured 2026-11-07: zero censused
    files and zero accounts change verdict under the strip, so this aligns
    the two vocabularies without moving the live tree. Whole-line only:
    a trailing comment on a live line stays counted, and that
    under-reporting toward wired is named rather than hidden.
    """
    return "\n".join(ln for ln in text.split("\n") if not ln.lstrip().startswith("#"))


def wiring_hits(name: str, texts: dict[str, str]) -> list[str]:
    """Runner paths whose text mentions `name` -- the wiring signal, PURE.

    Kept pure so self_test() can hold the exclusion alarm's FIRE direction
    every run (round-79): until now a wired exclusion was proven to redden
    only by ephemeral probes against a doctored tree, while the graded case
    covered the live tree's silence. Sorted output keeps the alarm message
    deterministic. Comment lines do not wire (round-83, the partner's
    semantics): a checker whose only runner mention sits in a comment is
    NOT wired, and counting the comment would grade a lie.
    """
    return sorted(rel for rel, text in texts.items()
                  if name in _drop_comment_lines(text))


def _parse_partner_dirs(text: str) -> list[str]:
    """The alliance partner's CHECKER_DIRS as repo-relative dir strings.

    r82-style source parse: the partner writes each dir as ROOT / "piece" /
    ..., so the quoted pieces between commas are joined with "/". Whole-line
    comments are dropped first (the round-83 primitive) so a commented entry
    cannot count, and a missing block parses to [] -- which reddens the
    mirror case. Round-88: the harness's CENSUS_DIRS and the partner's
    CHECKER_DIRS are held equal from BOTH sides (the partner carries the
    mirror case), so one gate cannot widen its audit scope alone.
    """
    block = re.search(r"CHECKER_DIRS\s*=\s*\(([^)]*)\)",
                      _drop_comment_lines(text), re.S)
    if block is None:
        return []
    out = []
    for entry in block.group(1).split(","):
        pieces = re.findall(r'"([^"]+)"', entry)
        if pieces:
            out.append("/".join(pieces))
    return out


def _parse_other_runners(text: str) -> tuple[set[str], list[str]]:
    """The partner's RUNNERS block, parsed -- plus every line REFUSED.

    TOTAL on purpose (round-82): the r74 parser silently dropped any entry
    line with no quoted token -- a variable splat or computed path joins the
    partner's scan while this side sees nothing, and the whole point of the
    agreement (no runner outside this vocabulary) dies QUIETLY. Measured
    2026-11-07: the live block has zero such lines, so the parse is exact
    today; this makes the next one loud. Every block line yields either an
    entry or a refusal naming its line.
    """
    if "RUNNERS = (" not in text:
        return set(), ["verify-selftests-wired.py no longer has a RUNNERS = ( block"]
    block = text.split("RUNNERS = (", 1)[1].split("\n)", 1)[0]
    entries: set[str] = set()
    refused: list[str] = []
    for i, ln in enumerate(block.splitlines(), 1):
        if not ln.strip() or ln.lstrip().startswith("#"):
            continue
        toks = re.findall(r'"([^"]+)"', ln)
        if toks:
            entries.add("/".join(toks))
        else:
            refused.append(f"partner RUNNERS line {i} has no quoted path: {ln.strip()[:60]}")
    return entries, refused


def runner_gaps(other_file_runners: set[str]) -> list[str]:
    """The two-sided runner-list gaps, PURE over the partner's parsed entries."""
    gaps = sorted(r for r in other_file_runners
                  if "." in r.rsplit("/", 1)[-1] and r not in RUNNER_FILES)
    for rel in RUNNER_FILES:
        if rel not in other_file_runners:
            gaps.append(rel + " is no longer in verify-selftests-wired's RUNNERS")
    return gaps


def wiring_runner_gaps() -> list[str]:
    """Divergences between the census's runner list and the other wiring gate's.

    Two-sided on purpose: a runner the other gate knows must be scannable
    here (its invisibility would let an exclusion depend on wiring this
    vocabulary cannot see), and every baseline runner here must still be
    named there (the other gate narrowing on its own would deserve the same
    alarm). Either side changing alone reddens -- and so does a line the
    parser cannot read: refusals ARE gaps.
    """
    other, refused = _parse_other_runners(
        (ROOT / "scripts/verify-selftests-wired.py").read_text(encoding="utf-8", errors="replace"))
    return refused + runner_gaps(other)


#: The checker-name convention, one vocabulary with verify-selftests-wired.py's
#: SCRIPT_RE (round-75). Until r75 this convention trailed the other gate's by
#: one widening: classify-finding-reachability.py and census-orphan-modules.py
#: sat in the named list below because their prefixes matched no glob here
#: (the other gate widened to classify-|census- in its r157 for the same two
#: files). Matching the prefixes STRUCTURALLY means the next classify- or
#: census- checker joins the census by convention instead of by a red round,
#: and wiring_runner_gaps()'s sibling case holds the two prefix sets equal in
#: both directions.
CONVENTION_PREFIXES = ("verify", "check", "classify", "census")
CONVENTION_RE = re.compile(
    r"^(?:" + "|".join(CONVENTION_PREFIXES) + r")-[A-Za-z0-9_-]+\.(?:py|mjs|sh)$")

#: The dirs the census walks -- ONE constant, consumed by census_files() and by
#: flag_carriers() (round-87). A second inline copy is the round-66 disease:
#: the copied glob rots the moment a checker lands elsewhere.
CENSUS_DIRS = ("scripts", ".agents/skills/docs-auditor/scripts", "website/scripts")


# Named outright, round-66 census: self-tested scripts whose verdicts gates
# depend on but whose names match NO convention prefix -- see census_files()
# for the per-file why. One site; a copy is the round-66 disease.
CENSUS_NAMED = (
    "backup-db.sh", "restore-db.sh",
    "scan-unwrap-panic.py", "generate-pg-migration.py",
    "generate-latest-json.mjs", "run-pre-push.py",
    "allowlist-schema.py",
)


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
    path; round-69: the shared allowlist schema). A workflow counts on the
    PARTNER's scan directly; this harness sees workflow invocations only
    through the round-90 graded redundancy -- every workflow-invoked
    census-shaped script must also be named in a runner file. Scripts that self-test but
    nothing depends on are out, listed in CENSUS_EXCLUDED and held there by
    self_test().
    """
    files = []
    for base in CENSUS_DIRS:
        d = ROOT / base
        if d.is_dir():
            # The convention as a per-file match, not a matrix of glob pairs:
            # every prefix x suffix combination in every census dir, so a new
            # docs-auditor verify-*.mjs or website classify-*.sh cannot fall
            # between a pair that was never written down.
            files.extend(sorted(p for p in d.iterdir()
                                if p.is_file() and CONVENTION_RE.match(p.name)))
    # Named outright, round-66 census: self-tested scripts whose verdicts gates
    # depend on but whose names match NO convention prefix -- backup/restore
    # (names predate the convention), the pre-push orchestrator itself, one
    # dev-ci step, one release-workflow signer, the unwrap scanner, and the
    # shared schema. allowlist-schema.py joins in round-69: both gates that
    # consume it (verify-ipc-parity.py, verify-scoped-reads.py) load it by
    # path, so it is wired TRANSITIVELY -- and a schema the survey refuses to
    # grade is a schema its two gates can silently disagree about, the disease
    # the module exists to cure. census-orphan-modules.py and
    # classify-finding-reachability.py left this list in r75: their prefixes
    # joined the convention. Deliberately NOT censused: the three scripts in
    # CENSUS_EXCLUDED carry --self-test but nothing depends on them (the
    # harness self-test holds that list to the criterion), and
    # sabotage-selftests.py is this harness.
    files.extend(ROOT / "scripts" / name for name in CENSUS_NAMED)
    return [f for f in files if declares_flag(f.read_text(encoding="utf-8", errors="replace"))]


def flag_carriers(root: Path = ROOT) -> list[str]:
    """Every quoted-flag .py/.mjs/.sh in CENSUS_DIRS, as repo-relative paths.

    The census's honest DENOMINATOR, walked rather than curated. census_files()
    unions the convention and CENSUS_NAMED, so a NEW checker named outside the
    convention and wired into a runner would enter neither ledger and the
    survey would never grade it -- silent, the round-66 disease in a new key.
    Round-87: this walk exists so that file reddens the self-test instead.
    """
    out = []
    for base in CENSUS_DIRS:
        d = root / base
        if not d.is_dir():
            continue
        for f in sorted(d.iterdir()):
            if not f.is_file() or f.suffix not in (".py", ".mjs", ".sh"):
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if declares_flag(text):
                out.append(f.relative_to(root).as_posix())
    return out


def account_carriers(carriers: list[str],
                     named: tuple[str, ...] = CENSUS_NAMED,
                     excluded: tuple[str, ...] = CENSUS_EXCLUDED,
                     meter: str = "sabotage-selftests.py",
                     convention: "re.Pattern[str]" = CONVENTION_RE) -> list[str]:
    """PURE: which flag-carriers no ledger holds. Four ledgers, each with its
    own key shape: the convention census-matches by basename, CENSUS_NAMED is
    basenames, CENSUS_EXCLUDED is scripts/-relative paths, and the meter is
    this harness file -- it runs the survey, it is not a survey subject.
    Round-87: the completeness claim is this function's empty result, graded
    live and pure; a carrier outside all four reddens.
    """
    known = set(named) | {Path(rel).name for rel in excluded} | {meter}
    return [rel for rel in carriers
            if not convention.match(Path(rel).name)
            and Path(rel).name not in known]


def orchestrator_invocations(text: str) -> list[str]:
    """Script basenames the pre-push orchestrator invokes, comment lines
    dropped, deduped, sorted. Round-89: run-pre-push.py is runner-WIRED (the
    pre-push hook, check.sh and check.ps1 all name it) but is not itself a
    runner file, so the wiring scan cannot see its children -- the mirror
    property below is what keeps a sole-provider checker from hiding behind
    it.
    """
    return sorted(set(re.findall(r"scripts/([A-Za-z0-9_-]+\.(?:py|mjs|sh))",
                                 _drop_comment_lines(text))))


def workflow_invocations(text: str) -> list[str]:
    """Script basenames a workflow file invokes, comment lines dropped, deduped,
    sorted. Round-90: the CI plane applied to the round-89 property -- a YAML
    comment cannot invoke anything, and the mirror case below holds every
    workflow-invoked census-shaped script to a runner file's text, since this
    harness's wiring scan reads no .yml.
    """
    return sorted(set(re.findall(r"scripts/([A-Za-z0-9_-]+\.(?:py|mjs|sh))",
                                 _drop_comment_lines(text))))


def sole_orchestrator_wiring(invocations: list[str],
                             runner_texts: dict[str, str],
                             named: tuple[str, ...] = CENSUS_NAMED,
                             convention: "re.Pattern[str]" = CONVENTION_RE) -> list[str]:
    """PURE: census-shaped checkers the orchestrator invokes that NO runner
    file names. Census-shaped = convention basename or CENSUS_NAMED basename,
    exactly the scripts whose wiring the census claims to know; helpers
    outside that shape are out of the claim's scope. Round-89: the live
    measurement is empty -- the orchestrator is a mirror of runner-visible
    gates -- and this function is the graded form of that measurement.
    """
    known = set(named)
    out = []
    for n in invocations:
        base = Path(n).name
        if ((convention.match(base) or base in known)
                and not any(base in t for t in runner_texts.values())):
            out.append(base)
    return out


# ── census-eligible files that deliberately do NOT carry --self-test ─────────
# The flag filter in census_files() makes flag-loss silent: a checker whose
# self-test was removed drops out of BOTH sides of the coverage diff (round-80
# measurement -- the coverage case cannot see it at all), and a
# convention-matching file with no flag never enters any ledger. Everything
# the pre-filter enumeration finds must either carry the flag or be accounted
# here with its wiring DECLARED, and the declared wiring is graded with the
# round-79 pure signal, so a stale account reddens instead of rotting.
CENSUS_UNFLAGGED = (
    # Deliberately runner-less by its own docstring: it is a census, not a
    # gate, and "claims none of that authority" -- a flag would make it a fake
    # control (the round-66 disease). Zero runner mentions, measured 2026-11-07.
    ("scripts/census-sync-ingest-admits.py", ()),
    # The COR-7 replay-fork gate carries no --self-test BY DESIGN: its cases
    # live in scripts/test-replay-fork.py (external self-test; that file's
    # docstring records a mutation probe that once MISSED the gate, which is
    # why case keying matters). Gate and self-test must stay invoked exactly
    # as declared or the account is stale.
    ("scripts/check-replay-fork.py",
     (("check-replay-fork.py", (".github/workflows/dev-ci.yml", "scripts/check.sh")),
      ("test-replay-fork.py", (".github/workflows/dev-ci.yml", "scripts/check.sh")))),
    # A RUNNER, not a checker: it invokes eleven docs-auditor self-tests with
    # UNQUOTED --self-test (deliberately explicit, its own lines 21-23 explain
    # why), so SELF_TEST_FLAG's quoted-only rule rightly keeps it out of the
    # carrier set -- but the convention sweep catches it by name. Wired at
    # check.sh:295 + dev-ci.yml:1038; it is itself in RUNNER_FILES.
    ("scripts/check-auditor-selftests.sh",
     (("check-auditor-selftests.sh", (".github/workflows/dev-ci.yml", "scripts/check.sh")),)),
    # The fourth entry here was scripts/verify-website-assets.py, the known
    # unclosable "checkers without self-tests" gap (round-80 accounting).
    # Retired 2026-11-07: the gate grew a graded --self-test and joined the
    # census by convention; nothing flag-less and runner-wired remains.
)


def census_enumeration_problems() -> list[str]:
    """What the census's PRE-FLAG enumeration sheds silently.

    census_files() filters BY the flag, so flag-loss moves carriers and
    censused together and the coverage diff stays empty -- a checker whose
    self-test was removed leaves the survey without a line (the round-72
    mirror was graded for EXCLUDED files only). Same silence if a
    CENSUS_NAMED entry is deleted outright. This is the honest denominator:
    convention-matching files in the census dirs plus every CENSUS_NAMED
    entry must carry the flag or sit in CENSUS_UNFLAGGED.
    """
    accounted = {rel for rel, _ in CENSUS_UNFLAGGED}
    problems = []
    for base in ("scripts", ".agents/skills/docs-auditor/scripts", "website/scripts"):
        d = ROOT / base
        if d.is_dir():
            for p in sorted(d.iterdir()):
                rel = p.relative_to(ROOT).as_posix()
                if rel in accounted or not (p.is_file() and CONVENTION_RE.match(p.name)):
                    continue
                if not declares_flag(p.read_text(encoding="utf-8", errors="replace")):
                    problems.append(rel + " matches the census convention but carries no --self-test")
    for name in CENSUS_NAMED:
        p = ROOT / "scripts" / name
        if not p.exists():
            problems.append("scripts/" + name + " is in CENSUS_NAMED but is gone")
        elif not declares_flag(p.read_text(encoding="utf-8", errors="replace")):
            problems.append("scripts/" + name + " is in CENSUS_NAMED but carries no --self-test")
    return sorted(problems)


def transitively_loaded(name: str, censused_texts: dict[str, str]) -> list[str]:
    """Censused files whose text names `name` -- the r69 path-load signal, PURE.

    A runner scan cannot see a checker loaded by path from another checker's
    code (round-69: allowlist-schema.py, loaded by verify-ipc-parity.py and
    verify-scoped-reads.py). Comment lines are not loads (round-84: the
    round-81 note called comment over-firing "the safe direction" -- wrong:
    the r83 alignment established that a comment mention wiring a file is a
    graded lie, and a load is wiring).
    """
    return sorted(rel for rel, text in censused_texts.items()
                  if Path(rel).name != name
                  and name in _drop_comment_lines(text))


def collisions_of(pairs: list[tuple[str, str]]) -> dict[str, list[str]]:
    """PURE: basenames borne by more than one file, from (basename, rel) pairs,
    keyed by basename with sorted rel paths. Round-92: the wiring corpus keys
    on basenames -- wiring_hits, account_carriers, sole_orchestrator_wiring
    and the exclusion case all match by name -- so two files sharing a
    basename are ONE key to every signal, and deleting one file's runner step
    looks like nothing. This is the graded shape of that precision limit.
    """
    seen: dict[str, list[str]] = {}
    for name, rel in pairs:
        seen.setdefault(name, []).append(rel)
    return {n: sorted(rels) for n, rels in seen.items() if len(rels) > 1}


def collided_census_names() -> dict[str, list[str]]:
    """The census's own collisions, live. The census has exactly one today --
    check-gate-runners.py in scripts/ and in the docs-auditor skill -- and
    the sibling case holds each collided file to a FULL-path mention, so the
    shared basename is not what wires it."""
    return collisions_of([(p.name, p.relative_to(ROOT).as_posix())
                          for p in census_files()])


def fullpath_wiring(rel: str, texts: dict[str, str]) -> list[str]:
    """PURE: runners whose comment-stripped text contains the FULL
    repo-relative path -- identity-precision wiring, as opposed to the
    basename scan. A bare-basename mention does not satisfy it."""
    return sorted(rr for rr, t in texts.items()
                  if rel in _drop_comment_lines(t))


def censused_wiring_problems() -> list[str]:
    """Censused files that no runner invokes and no censused file loads.

    The census criterion's second half -- a RUNNING pipeline depends on it --
    was held only backwards (an EXCLUDED file gaining wiring reddens) and
    structurally for convention files (the partner gate audits every
    flag-carrying SCRIPT_RE match). The seven CENSUS_NAMED files match no
    convention prefix, so the partner cannot see them: a named file whose
    runner step was deleted stayed censused forever with nobody grading the
    loss -- the coverage case compares enumeration, not invocation. Round-81
    measurement: 107 of 108 runner-wired; allowlist-schema.py is the one
    transitive case -- the r69 shape, now held instead of remembered.
    """
    texts = runner_texts()
    censused = census_files()
    censused_texts: dict[str, str] = {}
    for p in censused:
        try:
            censused_texts[p.relative_to(ROOT).as_posix()] = p.read_text(
                encoding="utf-8", errors="replace")
        except OSError:
            pass
    problems = []
    for p in censused:
        if wiring_hits(p.name, texts):
            continue
        if transitively_loaded(p.name, censused_texts):
            continue
        problems.append(p.name + " is censused but no runner invokes it "
                        "and no censused file loads it")
    return problems


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
            if declares_flag(p.read_text(encoding="utf-8", errors="replace")):
                carriers.append(rel.replace("\\", "/"))
        except OSError:
            continue
    return carriers


def slice_error(limit: int | None, skip: int) -> str | None:
    """Why --limit/--skip would measure the wrong thing, or None if they are sane.

    Python slicing silently wraps negatives (files[-3:] is the LAST three), and
    0 is falsy, so a naive `if limit:` turns --limit 0 into a FULL survey.
    Both failure directions read as measured, so they are refused instead of
    interpreted.
    """
    if skip < 0:
        return "--skip must be >= 0 (a negative value would wrap to the census tail)"
    if limit is not None and limit <= 0:
        return "--limit must be > 0 (0 or negative measures nothing)"
    return None


def survey_slice(files: list[Path], limit: int | None, skip: int) -> list[Path]:
    """The deterministic slice --limit/--skip measure.

    Order is census_files()'s own -- three census dirs in fixed tuple order,
    sorted within each dir, then the named list -- identical every run, so
    consecutive chunks [skip:skip+limit] partition the census with neither
    overlap nor gap (graded in self_test with synthetic lists; running real
    checkers is never a self-test act). Bounds are validated by slice_error.
    """
    problem = slice_error(limit, skip)
    if problem:
        raise SystemExit(problem)
    out = files[skip:]
    if limit is not None:
        out = out[:limit]
    return out


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
    files = survey_slice(census_files(), limit, skip)
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


def checksh_invokes_self_test(text: str | None = None) -> bool:
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
    if text is None:
        text = (ROOT / "scripts/check.sh").read_text(encoding="utf-8", errors="replace")
    return "scripts/sabotage-selftests.py --self-test" in _drop_comment_lines(text)



def checksh_invokes_alliance(text: str | None = None) -> bool:
    """check.sh still runs the alliance partner's self-test per commit.

    Round-73 graded this harness's own wiring for the same reason: the pipeline
    runs graded case sets per commit, and a self-test nobody per-commits rots
    in silence. The partner sits one layer out with a hole its own gate cannot
    see: its wiring criterion accepts ANY runner, so moving its step to
    CI-only (dropping check.sh's "self-tests wired self-test" step while
    dev-ci.yml keeps its twin) leaves it wired, green, and unenforced per
    commit. Measured 2026-11-07: that state reddens nothing anywhere -- this
    case is the only alarm.
    """
    if text is None:
        text = (ROOT / "scripts/check.sh").read_text(encoding="utf-8", errors="replace")
    return "scripts/verify-selftests-wired.py --self-test" in _drop_comment_lines(text)

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


def survey_summary(rows, skip, limit, censused) -> str:
    """The one-line verdict summary, full or sliced.

    A chunked run must say so: a summary that reads "30 checker(s)" is
    indistinguishable from a full census of 30, and chunks that silently miss
    checkers read as measured (the round-66 disease in slice form). The sliced
    line names skip, limit and the census denominator so a chunk can never read
    as the whole; the full line keeps the per-verdict parentheticals that tell
    the operator what each non-KILLED verdict means. Extracted (round-101) so
    the operator-facing half of the slice contract is GRADED, not assumed.
    """
    survivors = [r for r in rows if r[4] == "SURVIVED"]
    relocated = [r for r in rows if r[4] == "RELOCATION-SENSITIVE"]
    unmutatable = [r for r in rows if r[4] == "NO MUTATABLE FUNCTION"]
    already_red = [r for r in rows if r[4] == "PATH ALREADY RED"]
    killed = [r for r in rows if r[4] == "KILLED"]
    if limit is not None or skip:
        return ("sabotage: %d checker(s) [slice skip=%s limit=%s of %d censused], "
                "%d SURVIVED, %d killed, %d RELOCATION-SENSITIVE, %d NO MUTATABLE, "
                "%d PATH ALREADY RED."
                % (len(rows), skip, limit, censused,
                   len(survivors), len(killed), len(relocated), len(unmutatable),
                   len(already_red)))
    return ("sabotage: %d checker(s), %d SURVIVED (their self-test did not notice the gutted "
            "detector), %d killed, %d RELOCATION-SENSITIVE (self-test cannot run from a copy; "
            "unmeasured, not proven), %d NO MUTATABLE FUNCTION, %d PATH ALREADY RED (red "
            "before any mutation)."
            % (len(rows), len(survivors), len(killed), len(relocated), len(unmutatable),
               len(already_red)))


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
         all(declares_flag((ROOT / rel).read_text(encoding="utf-8", errors="replace"))
             for rel in CENSUS_EXCLUDED if (ROOT / rel).exists()), True)
    want("every runner file the census scans still exists",
         all((ROOT / rel).exists() for rel in RUNNER_FILES), True)
    want("the census's runner list agrees with verify-selftests-wired's",
         wiring_runner_gaps(), [])
    # ── one checker-NAME vocabulary across both wiring gates ──────────────────
    other = re.search(
        r'SCRIPT_RE = re\.compile\(r"\^\(\?:(.*?)\)-',
        (ROOT / "scripts/verify-selftests-wired.py").read_text(encoding="utf-8", errors="replace"))
    want("the census's name convention matches verify-selftests-wired's SCRIPT_RE",
         sorted((other.group(1) if other else "?").split("|")),
         sorted(CONVENTION_PREFIXES))
    # ── the exclusion alarm fires on the signal, not only on the live tree ────
    # Measured 2026-11-07 (round-79): a wired exclusion yields exactly ONE bad
    # entry -- "<rel> is now pipeline-wired (<runner>) — it must join the
    # census" -- no crash, no muddy second signal (the transitive scan is a
    # different signal with its own line). The fire direction below is graded
    # purely; no file is written.
    synth = {"scripts/check.sh": "run: python3 scripts/restaurant-coverage.py --x",
             "ui/package.json": "nothing relevant"}
    want("a wired exclusion surfaces with its runner named",
         wiring_hits("restaurant-coverage.py", synth), ["scripts/check.sh"])
    want("an unwired name stays silent",
         wiring_hits("sign-plugin.py", synth), [])

    # ── the census enumeration cannot shed a file silently (round-80) ─────────
    want("the census enumeration sheds nothing silently",
         census_enumeration_problems(), [])
    want("every unflagged account still exists and stays flag-less",
         all((ROOT / rel).exists()
             and not declares_flag((ROOT / rel).read_text(encoding="utf-8", errors="replace"))
             for rel, _ in CENSUS_UNFLAGGED), True)
    unflagged_texts = runner_texts()
    want("each unflagged account's declared wiring is still exactly true",
         [sorted(wiring_hits(bn, unflagged_texts)) == sorted(exp)
          for _, claims in CENSUS_UNFLAGGED for bn, exp in claims],
         [True] * sum(len(cl) for _, cl in CENSUS_UNFLAGGED))

    # ── the exclusion account is held to its own criterion, live (round-91) ───
    # The pure fire direction (wiring_hits above) graded the SIGNAL; this is
    # the live claim: the three excluded scripts carry a self-test and nothing
    # depends on them. If one gains a runner step or a path-load, the account
    # is a hiding place -- a wired, self-tested checker outside the census --
    # and this case reddens with the wiring named, forcing the decision:
    # census it or unwire it. Measured 2026-11-07: all three silent.
    censused_texts = {p.relative_to(ROOT).as_posix():
                      p.read_text(encoding="utf-8", errors="replace")
                      for p in census_files()}
    want("every excluded script is still unwired -- runner and load",
         [wiring_hits(Path(rel).name, unflagged_texts)
          + transitively_loaded(Path(rel).name, censused_texts)
          for rel in CENSUS_EXCLUDED],
         [[], [], []])
    # ── the wiring corpus's key is a basename; collisions are a precision lie ──
    want("the collision detector finds a synthetic pair",
         collisions_of([("a.py", "scripts/a.py"), ("a.py", "x/scripts/a.py"),
                        ("b.py", "scripts/b.py")]),
         {"a.py": ["scripts/a.py", "x/scripts/a.py"]})
    want("a collision-free set yields nothing",
         collisions_of([("a.py", "scripts/a.py"), ("b.py", "x/b.py")]), {})
    want("the census has exactly one basename collision, the known pair",
         collided_census_names(),
         {"check-gate-runners.py": [".agents/skills/docs-auditor/scripts/check-gate-runners.py",
                                    "scripts/check-gate-runners.py"]})
    want("full-path wiring is not satisfied by the basename alone",
         fullpath_wiring("scripts/verify-x.py", {"r": "run verify-x.py"}), [])
    want("a full path mention is identity wiring",
         fullpath_wiring("scripts/verify-x.py", {"r": "run scripts/verify-x.py"}),
         ["r"])
    want("each collided file is wired by its full path, not the shared name",
         [bool(fullpath_wiring(rel, unflagged_texts))
          for rels in collided_census_names().values() for rel in rels],
         [True] * sum(len(rels) for rels in collided_census_names().values()))
    # ── the criterion's wiring half, held for the WHOLE censused set (r81) ────
    want("every censused file stays runner-wired or transitively loaded",
         censused_wiring_problems(), [])
    want("a path-load in a censused file counts as the wiring",
         transitively_loaded("allowlist-schema.py",
                             {"scripts/verify-ipc-parity.py":
                              "spec_from_file_location('m', REPO / 'scripts/allowlist-schema.py')",
                              "scripts/verify-x.py": "nothing"}),
         ["scripts/verify-ipc-parity.py"])
    want("a file does not load itself",
         transitively_loaded("verify-x.py",
                             {"scripts/verify-x.py": "python3 scripts/verify-x.py --self-test",
                              "scripts/verify-y.py": "y"}),
         [])

    # ── the alliance's list parse is total, not silently partial (r82) ─────────
    splat_entries, splat_refused = _parse_other_runners(
        'RUNNERS = (\n'
        '    ROOT / "scripts" / "check.sh",\n'
        '    RUNNERS_BASE,\n'
        ')\n')
    want("a variable-splat runner line is refused, not silently dropped",
         [sorted(splat_entries), len(splat_refused)], [["scripts/check.sh"], 1])
    want("a missing RUNNERS block is refused outright",
         _parse_other_runners("def main(): ...\n")[1] != [], True)
    want("a partner runner only it knows is a gap, named",
         runner_gaps({"scripts/check.sh", "scripts/check-new.sh"})[:1],
         ["scripts/check-new.sh"])
    # the set passed holds ONE baseline runner, so exactly the other six are
    # reported -- and the shared member is NOT double-reported as an extra.
    want("a shrunken partner set reports every lost runner, once",
         runner_gaps({"scripts/check.sh"}),
         [rel + " is no longer in verify-selftests-wired's RUNNERS"
          for rel in RUNNER_FILES if rel != "scripts/check.sh"])

    # ── the flag-declaration and comment vocabularies are shared (r83) ────────
    want("the partner's flag-declaration literal is the same quoted-flag regex",
         SELF_TEST_FLAG.pattern in
         (ROOT / "scripts/verify-selftests-wired.py").read_text(encoding="utf-8", errors="replace"),
         True)
    want("a whole-line comment is not wiring (the partner's semantics)",
         wiring_hits("verify-x.py",
                     {"scripts/check.sh": "# python3 scripts/verify-x.py --self-test  (dead)"}),
         [])
    want("a live line beside a comment still wires",
         wiring_hits("verify-x.py",
                     {"scripts/check.sh": "# retired\n  run: python3 scripts/verify-x.py --self-test"}),
         ["scripts/check.sh"])
    want("a commented-out step does not wire the harness's self-test",
         checksh_invokes_self_test("# python scripts/sabotage-selftests.py --self-test"), False)
    want("a commented-out step does not wire the alliance",
         checksh_invokes_alliance("# python scripts/verify-selftests-wired.py --self-test"), False)
    want("a live step beside a comment still wires the harness",
         checksh_invokes_self_test("# retired\npython scripts/sabotage-selftests.py --self-test"), True)
    want("a comment naming a checker is not a load",
         transitively_loaded("allowlist-schema.py",
                             {"scripts/verify-x.py": "# allowlist-schema.py was dropped here"}),
         [])
    for rel in CENSUS_EXCLUDED:
        refs = pipeline_references(Path(rel).name)
        if refs:
            bad.append(f"{rel} is now pipeline-wired ({', '.join(refs)}) — it must join the census")
    excluded_names = [Path(rel).name for rel in CENSUS_EXCLUDED]
    for c in sorted(censused):
        text = _drop_comment_lines(
            (ROOT / c).read_text(encoding="utf-8", errors="replace"))
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

    # ── the two-gate alliance is itself two-gated (round-76) ──────────────────
    # run_self_test_out is the survey's own runner: same timeout contract, same
    # failure_cause on red, so a partner self-test that starts failing surfaces
    # here with its cause line, not as a memory that someone ran it by hand.
    # The cause rides along ONLY when red -- on a green run failure_cause
    # carries the partner's own OK line (stdout fallback), not "".
    # Measured 2026-11-07 (round-77): python and python3 are the same CPython
    # 3.14.5 here, so this runner matches check.sh's invocation, not merely its
    # tree. Like every other case this one grades the WORKING TREE -- the
    # survey, census_carriers and the SCRIPT_RE extraction all do -- so pinning
    # this one case to HEAD would diverge it from the rest; a mid-edit tree is
    # the §7.3 stop condition, a human fact no pin can encode.
    arc, acause = run_self_test_out(ROOT / ALLIANCE_PARTNER)
    want("verify-selftests-wired's own self-test stays green (the alliance gate)",
         alliance_grade(arc, acause), [0])
    want("a red partner reddens the alliance case, cause riding along",
         alliance_grade(2, "its own cause"), [2, "its own cause"])
    want("a red partner is not the green grade",
         alliance_grade(2, "its own cause") != [0], True)
    want("a timeout is not the green grade either",
         alliance_grade(None, "timeout") != [0], True)
    # ── the interpreter resolution is graded, not assumed (round-96) ───────────
    want("the .sh interpreter resolves (Git's bash by full path, never bare)",
         Path(GIT_BASH).exists(), True)
    want("the .mjs interpreter resolves (node on PATH)",
         shutil.which("node") is not None, True)
    want("the dispatch maps each suffix to its interpreter",
         [self_test_command(Path("a.sh"))[0] == GIT_BASH,
          self_test_command(Path("a.mjs"))[0] == "node",
          self_test_command(Path("a.py"))[0] == sys.executable], [True, True, True])
    # ── the survey's exit contract is graded, not remembered (round-97) ───────
    # survey_exit, junction_writethrough and survey_slice had no cases at all --
    # the r51 disease (exit 0 over unmeasured rows) could return by a one-line
    # edit, and survey_slice's docstring PROMISED synthetic grading that did
    # not exist. All three are pure; graded on synthetic rows and lists.
    row97 = lambda v: ("x.py", "f", 0, 2, v, "")
    files9 = [Path("c%02d.py" % i) for i in range(9)]
    want("an all-killed sweep exits 0",
         survey_exit([row97("KILLED")], []), 0)
    want("every unmeasured verdict fails the exit contract",
         [survey_exit([row97(v)], [])
          for v in ("SURVIVED", "PATH ALREADY RED", "RELOCATION-SENSITIVE",
                    "NO MUTATABLE FUNCTION")], [1, 1, 1, 1])
    want("a clean sweep with a write-through still fails",
         survey_exit([row97("KILLED")], [(" M", "scripts/check.sh")]), 1)
    want("the write-through guard reports new tracked lines only",
         junction_writethrough("?? .agents/x.py\n",
                               "?? .agents/x.py\n M scripts/check.sh\n?? .agents/new.py"),
         [(" M", "scripts/check.sh")])
    want("consecutive slices partition the census, no overlap or gap",
         [a == b for a, b in zip(
             [f for i in (0, 4, 8) for f in survey_slice(files9, 4, i)],
             files9)], [True] * 9)
    want("no limit slices to the tail",
         survey_slice(files9, None, 7), files9[7:])
    # ── the python mutator and the staging tree are graded (round-98) ─────────
    # candidate_functions and blank_body decide WHICH detector 84 of the 109
    # censused checkers lose -- and build_temp_root decides whether the survey's
    # 300+ staged runs can write through to the shared checkout. Neither had a
    # case; both are graded here on synthetic sources and a real staging tree.
    synth_py = (
        "def tiny(): return 1\n"
        "def first_detector(x):\n"
        "    total = x + 1\n"
        "    return total\n"
        "def second_detector():\n"
        "    note = 'kept'\n"
        "    return note\n"
        "def __dunder__():\n"
        "    return 1\n"
    )
    cands98 = candidate_functions(synth_py)
    want("the python candidate picker takes blankable top-level functions only",
         [c[0] for c in cands98], ["first_detector", "second_detector"])
    mutated98 = blank_body(synth_py, *cands98[0])
    want("the python blanker guts the first candidate, keeps the rest, still parses",
         ["total" not in mutated98, "return note" in mutated98,
          "tiny" in mutated98, "MUTATION: detector gutted" in mutated98,
          bool(ast.parse(mutated98))], [True] * 5)
    with tempfile.TemporaryDirectory() as td98s:
        staged98 = build_temp_root(Path(td98s))
        canary = staged98 / "scripts" / "__r98_canary.py"
        canary.write_text("x = 1\n", encoding="utf-8")
        want("staged gate roots are real copies -- a staged write stays staged",
             [canary.is_file(),
              not (ROOT / "scripts" / "__r98_canary.py").exists(),
              (staged98 / "scripts" / "sabotage-selftests.py").is_file()],
             [True, True, True])
        want("history and secrets never enter the staging tree",
             [not (staged98 / ".git").exists(), not (staged98 / ".env").exists()],
             [True, True])
        want("staged siblings reach the real bytes (junction or copy)",
             [(staged98 / "docs").exists(),
              any((staged98 / "docs").rglob("*.md"))], [True, True])
        td_path = Path(td98s)
    want("the staging tree is cleaned up after the survey shape",
         not td_path.exists(), True)
    want("every census directory in scope exists",
         [d for d in CENSUS_DIRS if not Path(d).is_dir()], [])
    # ── the text mutator's string edges are graded, not inherited (round-100) ──
    # braces_span is a RAW brace counter -- the docstring says so -- and the
    # stripper's whole job is feeding it brace-free text. Grade the pair
    # TOGETHER so the rawness and the reason for the stripper are both pinned.
    raw100 = 'f() { s = "}"; }'
    want("a quoted closing brace does not close the span early",
         [braces_span(strip_comments_and_strings(raw100), 4),
          braces_span(raw100, 4)], [15, 11])
    want("a hash inside quotes is content, not a comment that eats the span",
         [strip_comments_and_strings('x = "# { eat }"; y{1}').count("{"),
          strip_comments_and_strings('x = "# { eat }"; y{1}').count("}")], [1, 1])
    want("an unbalanced span reads as None in both directions",
         [braces_span("{a", 0), braces_span("}a{", 0)], [None, None])
    re100 = _strip_js('const re = /"([^"]+)"/g; f(){1}')
    tpl100 = _strip_js('\u0060a\u0024{x{1}}b\u0060; g(){2}')
    want("regex and template contents never leak braces into the counter",
         [[re100.count("{"), re100.count("}")],
          [tpl100.count("{"), tpl100.count("}")]], [[1, 1], [1, 1]])
    miss100_rc, miss100_cause = run_self_test_out(Path("no/such/census-checker.py"))
    want("a vanished census script reads as rc 2 with a named cause",
         [miss100_rc, bool(miss100_cause), "can't open" in miss100_cause],
         [2, True, True])
    # ── the summary line's slice contract is graded, not assumed (round-101) ──
    rows101 = [("a.py", "f", 0, 2, "KILLED", ""),
               ("b.py", "f", 0, 2, "SURVIVED", "cause x")]
    want("a chunked summary names the slice, never reads as a full census",
         [survey_summary(rows101, 4, 2, 109).count("[slice skip=4 limit=2 of 109 censused]"),
          survey_summary(rows101, 4, 2, 109).count("1 SURVIVED"),
          survey_summary(rows101, 4, 2, 109).count("1 killed"),
          survey_summary(rows101, 4, 2, 109).count("2 checker(s), 1 SURVIVED (")], [1, 1, 1, 0])
    want("a full summary keeps the per-verdict meanings and no slice marker",
         [survey_summary(rows101, 0, None, 2).count("2 checker(s)"),
          survey_summary(rows101, 0, None, 2).count("SURVIVED (their self-test did not notice"),
          survey_summary(rows101, 0, None, 2).count("[slice")], [1, 1, 0])
    # ── the declaration predicate is comment-blind (round-95) ─────────────────
    want("a quoted flag in a comment does not declare a self-test",
         declares_flag('# add a "--self-test" mode someday'), False)
    want("a quoted flag on a live line declares",
         declares_flag('if "--self-test" in sys.argv:\n    run_self_test()'), True)
    carrier_rels = flag_carriers(ROOT)
    want("no flag carrier's flag lives only in a comment",
         [declares_flag((ROOT / rel).read_text(encoding="utf-8", errors="replace"))
          == bool(SELF_TEST_FLAG.search((ROOT / rel).read_text(encoding="utf-8", errors="replace")))
          for rel in carrier_rels], [True] * len(carrier_rels))
    # ── the OK line's case count is derived, not a literal (round-94) ──────────
    # Measured before landing: this gate's literal said 98 over 92 want() sites,
    # the partner's said 12 over 11, and the fixture below still quoted the
    # partner's 8-case line. A count no case reads is a lie with tenure.
    partner_src = (ROOT / ALLIANCE_PARTNER).read_text(encoding="utf-8", errors="replace")
    harness_src = Path(__file__).read_text(encoding="utf-8", errors="replace")
    want("the OK-line count parser reads the declared number",
         ok_line_count("SELF-TEST OK (12 cases, no files touched)"), 12)
    want("a non-OK line declares no count",
         ok_line_count("SELF-TEST WRONG: red"), None)
    fixture = "SELF-TEST OK (%d cases, no files touched)" % want_inventory(partner_src)
    want("the round-76 fixture quotes the partner's live inventory",
         ok_line_count(fixture), want_inventory(partner_src))
    want("the partner's live OK count equals its want() inventory",
         [ok_line_count(acause), want_inventory(partner_src)],
         [want_inventory(partner_src)] * 2)
    want("this gate's OK print derives its count from the inventory",
         [l.count("want_inventory(")
          for l in harness_src.splitlines()
          if l.strip().startswith("print(") and "SELF-TEST OK" in l], [1])
    want("the partner's OK print derives its count too",
         [l.count("want_inventory(")
          for l in partner_src.splitlines()
          if "SELF-TEST OK" in l and "print(" in l], [1])
    want("a green partner drops the OK-line cause (round-76 fallback)",
         alliance_grade(0, fixture), [0])
    want("check.sh still runs the alliance partner's self-test per commit",
         checksh_invokes_alliance(), True)

    # ── the census's denominator is walked, not curated (round-87) ────────────
    want("every flag-carrier in the census dirs is accounted",
         account_carriers(flag_carriers()), [])
    want("a convention carrier is accounted by its name alone",
         account_carriers(["scripts/check-tz-invariance.py"]), [])
    want("the walk actually sees the known carriers",
         [c in flag_carriers() for c in
          ("scripts/sabotage-selftests.py", "scripts/backup-db.sh")],
         [True, True])
    want("a new non-convention carrier with no ledger entry reddens",
         account_carriers(["scripts/orchestrate-x.py"]), ["scripts/orchestrate-x.py"])
    want("a CENSUS_NAMED basename is accounted",
         account_carriers(["scripts/backup-db.sh"]), [])
    want("a CENSUS_EXCLUDED path is accounted",
         account_carriers(["scripts/sign-plugin.py"]), [])
    want("the meter is accounted and not a subject of its own survey",
         [account_carriers(["scripts/sabotage-selftests.py"]),
          any(p.name == "sabotage-selftests.py" for p in census_files())],
         [[], False])
    want("the partner-dir parser joins ROOT pieces",
         _parse_partner_dirs('CHECKER_DIRS = (ROOT / "a", ROOT / "b" / "c")'),
         ["a", "b/c"])
    want("a missing CHECKER_DIRS block parses to nothing (and reddens)",
         _parse_partner_dirs("x = 1"), [])
    want("the census dirs mirror the alliance partner's audit dirs",
         _parse_partner_dirs((ROOT / ALLIANCE_PARTNER).read_text(encoding="utf-8", errors="replace")),
         list(CENSUS_DIRS))
    # ── the pre-push orchestrator is a mirror, not a sole provider (round-89) ──
    want("a census-shaped checker no runner mentions reddens",
         sole_orchestrator_wiring(["scripts/verify-lonely.py"], {"r": "unrelated"}),
         ["verify-lonely.py"])
    want("a runner mention satisfies the mirror property",
         sole_orchestrator_wiring(["scripts/verify-dup.py"],
                                  {"scripts/check.sh": "run verify-dup.py"}), [])
    want("a non-census helper is out of the claim's scope",
         sole_orchestrator_wiring(["scripts/helper.py"], {"r": "unrelated"}), [])
    want("the extraction sees the orchestrator's real invocations",
         [n in orchestrator_invocations((ROOT / "scripts/run-pre-push.py").read_text(encoding="utf-8", errors="replace"))
          for n in ("verify-website-assets.py", "check-tz-invariance.py")], [True, True])
    want("every census-shaped checker the orchestrator invokes is runner-visible",
         sole_orchestrator_wiring(
             orchestrator_invocations((ROOT / "scripts/run-pre-push.py").read_text(encoding="utf-8", errors="replace")),
             {rel: (ROOT / rel).read_text(encoding="utf-8", errors="replace") for rel in RUNNER_FILES}),
         [])
    # ── the CI plane is a mirror too (round-90) ───────────────────────────────
    want("the workflow extractor reads invocations and drops comments",
         workflow_invocations("run: python3 scripts/verify-x.py  # tail\n"
                              + "# scripts/verify-commented.py --self-test\n"
                              + "- python3 scripts/check-y.py --strict"),
         ["check-y.py", "verify-x.py"])
    want("a workflow comment alone invokes nothing",
         workflow_invocations("# scripts/verify-commented.py --self-test"), [])
    want("the workflow walk sees real CI invocations",
         [n in workflow_invocations((ROOT / ".github" / "workflows" / "dev-ci.yml").read_text(encoding="utf-8", errors="replace"))
          for n in ("verify-website-assets.py", "verify-architecture-boundaries.py")],
         [True, True])
    want("every workflow-invoked census-shaped script is runner-visible",
         sole_orchestrator_wiring(
             [n for p in sorted((ROOT / ".github" / "workflows").iterdir())
              if p.suffix in (".yml", ".yaml")
              for n in workflow_invocations(p.read_text(encoding="utf-8", errors="replace"))],
             {rel: (ROOT / rel).read_text(encoding="utf-8", errors="replace") for rel in RUNNER_FILES}),
         [])
    # ── survey slices are deterministic, bounded, self-describing (round-78) ──
    want("a negative --skip is refused (it would wrap to the census tail)",
         slice_error(None, -1) is not None, True)
    want("a non-positive --limit is refused (0 is falsy, not empty)",
         [slice_error(0, 0) is not None, slice_error(-1, 0) is not None],
         [True, True])
    want("a valid chunk passes the bounds check",
         slice_error(30, 0), None)
    synth = [Path(n + ".py") for n in "abcdef"]
    want("consecutive chunks partition the census without overlap or gap",
         sum(len(survey_slice(synth, 2, s)) for s in (0, 2, 4)), 6)
    want("a mid-census slice takes exactly the census-order rows",
         [p.name for p in survey_slice(synth, 2, 1)], ["b.py", "c.py"])

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print(f"SELF-TEST OK ({want_inventory(Path(__file__).read_text(encoding='utf-8'))} cases, one alliance self-test runs: verify-selftests-wired)")
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
    # A chunked run must say so: a summary that reads "30 checker(s)" is
    # indistinguishable from a full census of 30, and chunks that silently
    # miss checkers read as measured (the round-66 disease in slice form).
    through = junction_writethrough(before_tree, git_status_porcelain())
    for name, fn, before, after, verdict, cause in rows:
        print("  %-46s %-28s %-12s exit %s -> %s" % (name, fn[:28], verdict, before, after))
        if cause:
            print("      cause: %s" % cause)
    print("")
    print(survey_summary(rows, args.skip, args.limit, len(census_files())))
    if through:
        print("")
        print("STAGED WRITE-THROUGH: the survey left tracked dirt in the real tree:")
        for st, path in through:
            print("  %s %s" % (st, path))
        print("  a staged run wrote through a junctioned sibling; do not trust")
        print("  the table above until this is explained.")
    unmeasured = len(rows) - sum(1 for r in rows if r[4] == "KILLED")
    if unmeasured:
        print("survey: %d row(s) unmeasured -- exit 1 by contract." % unmeasured)
    return survey_exit(rows, through)


if __name__ == "__main__":
    sys.exit(main())
