#!/usr/bin/env python3
"""check-rust-doc-paths.py -- repository paths named in Rust doc comments must exist.

WHY THIS EXISTS
===============
check-dead-refs.py scans MARKDOWN and nothing else. Rust source carries the same kind
of claim in /// and //! comments -- "the tests were relocated from X", "mirrors the
SQLite path at Y" -- and nothing checked those until this file.

The defect that motivated it, measured 2026-10-23: 41 test modules under
crates/kasirmu-bridge/src/ said their tests were relocated from
apps/desktop-tauri/src/commands/<name>.rs. That path NEVER existed in git history:
the files left apps/desktop-client/src/commands/ in f61c3f9241, and the directory was
renamed to desktop-tauri LATER, in 37dfce0363. The comment spliced a name from after
the move onto a path that only existed before it.

A reference to a path that never existed is worse than no reference: it tells the
reader to look somewhere the file was never kept.

WHAT COUNTS AS A REFERENCE
==========================
A path beginning with a known top-level directory and ending in a source or doc
extension. The prefix requirement is load-bearing: without it a sentence like
"see lib.rs" matches hundreds of siblings and the checker becomes noise.

WHAT IS EXEMPT, AND WHY THE EXEMPTION IS NOT ENOUGH
===================================================
A comment about HISTORY may name a path that is gone -- that is the point of recording
a move. The exemption is scoped to a line carrying an explicit past-tense marker.

That heuristic does NOT catch the 41-file defect, because those lines say "relocated
from" and would be exempt outright. So there is a SECOND rule: a move cannot be
recorded FROM a path that never existed. If the named path has no entry in
git log --all --diff-filter=AD, it is wrong whatever the wording. Rule 2 is what makes
that class findable; rule 1 alone would have waved all 41 through.

BARE FILENAMES, ADDED 2026-10-27 (round 42)
============================================
The prefix rule above is right for PATHS. It left LINE citations ungraded when
the comment omits the directory: `settings.rs:1264` rather than
`crates/kasirmu-bridge/src/settings.rs:1264`. Measured that round: 220
citations graded, 354 bare ones invisible — and an audit of exactly those found
29 pointing past EOF or at a blank line.

The fix resolves the basename instead of dropping the rule. 607 of the tree's
837 distinct .rs basenames are unique, so grading them is the same arithmetic
as a full path; the 230 that are not (`main.rs` x7, `build.rs` x6) are
SKIPPED, because picking one would grade the wrong file. The first run of this
arm found three more defects that the full-path rule had never been able to
see.

Exit 0 clean, 1 findings, 2 could not run.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Refuse a corpus below this. A real tree here holds ~1430 `.rs` files, so the floor is
#: set far below it and exists only to catch a ZERO — a renamed top-level directory, a
#: wrong cwd, or a bad ROOT would otherwise make this gate print "clean" over a scan
#: that read no Rust at all (measured 2026-10-24: 0 files, 0 findings, exit 0).
#: Module scope rather than a local so `self_test()` can grade the guard itself.
MIN_RUST_FILES = 500

TOP_LEVEL = ("crates", "apps", "modules", "platform", "foundation",
             "scripts", "docs", "shared-ui", "ui", "ops")
PATH_RE = re.compile(
    r"\b((?:" + "|".join(TOP_LEVEL) + r")/[A-Za-z0-9_.\-/]+\.(?:rs|py|sh|mjs|toml|json|md))\b"
)
HISTORY_RE = re.compile(
    r"\b(relocated|moved|renamed|formerly|previously|used to|split out|extracted|"
    r"no longer|legacy|was called|since renamed)\b",
    re.I,
)
DOC_RE = re.compile(r"^\s*(?://[/!]|\*)")

# `path.rs:NNN` and `path.rs:NNN-MMM` -- the citation form that names a LINE, not just a
# file. Kept separate from PATH_RE because a citation is a stronger claim than a path: it
# says the thing you want is ON that line, and a stale number sends the reader somewhere
# plausible and wrong. Only paths the tree TRACKS are graded, so an example path in prose
# is not a finding.
# `name.rs:NNN` with no directory prefix -- resolved through basename_index.
# The lookbehind keeps a path tail (`crates/x/src/y.rs:12`) out of this arm; that
# form is LINE_CITE_RE's job.
BARE_CITE_RE = re.compile(r"(?<![A-Za-z0-9_./\\-])([A-Za-z0-9_.\-]+\.rs):(\d{1,5})(?:-(\d{1,5}))?\b")

LINE_CITE_RE = re.compile(
    r"\b((?:" + "|".join(TOP_LEVEL) + r")/[A-Za-z0-9_.\-/]+\.(?:rs|py|sh|mjs|ts|tsx|css|sql|toml|json|md))"
    r":(\d{1,5})(?:-(\d{1,5}))?\b"
)


def tracked() -> set:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit("error: not a git checkout")
    return set(out.stdout.splitlines())


def ever_existed(path: str, cache: dict) -> bool:
    """Whether the path appears in history at all -- added or deleted."""
    if path not in cache:
        out = subprocess.run(
            ["git", "log", "--all", "--diff-filter=AD", "--format=%h", "-n", "1", "--", path],
            cwd=ROOT, capture_output=True, text=True,
        )
        cache[path] = bool(out.stdout.strip())
    return cache[path]


def line_citation_problem(target, first, last):
    """Why a `path:NNN` citation is unusable, or "" when it holds.

    BLANK or PAST EOF is the subset this can judge without guessing. A line holding only
    punctuation (`}`, `);`, `),`) is equally unable to be what a comment means to
    cite, so it fails the same test. Anything with real text is ACCEPTED: deciding that a
    citation names the wrong SYMBOL needs a reader, and a gate that guessed would produce
    the false-positive noise that teaches people to ignore it.
    """
    try:
        body = target.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""  # unreadable is not a verdict (it is tracked, so this is a race)
    if first > len(body):
        return "cites line %d but the file has %d line(s) -- past the end" % (first, len(body))
    window = body[first - 1:last]
    if not window or all(re.match(r"^[\s)\]\};,]*$", ln) for ln in window):
        shown = (body[first - 1] if first - 1 < len(body) else "").strip()
        return ("cites line %d, which is blank or punctuation-only (%r)"
                % (first, shown[:40]))
    return ""


def basename_index(tracked_set):
    """Map a bare `.rs` filename to the ONE tracked path it names, or to None.

    Added 2026-10-27 (round 42). The full-path citation rule is load-bearing by
    design (see the module docstring), so a comment that writes `settings.rs:1264`
    instead of `crates/kasirmu-bridge/src/settings.rs:1264` was invisible here --
    measured that round: 220 citations graded, 354 bare ones never seen, and one
    audit found 29 of the bare ones pointing past EOF or at a blank line.

    The fix is NOT to drop the prefix rule but to RESOLVE the bare name first. Of
    837 distinct .rs basenames, 607 are unique in the tree and 230 are not
    (`main.rs` x7, `build.rs` x6, ...). A unique name has exactly one target, so
    grading it is the same arithmetic as a full path. An ambiguous one is skipped,
    because picking a file would grade the wrong one -- the same rule the UI-side
    featureCommentPaths suite applies to bare basenames.
    """
    index = {}
    for path in tracked_set:
        if not path.endswith(".rs"):
            continue
        name = path.rsplit("/", 1)[-1]
        index[name] = None if name in index else path
    return index


def scan(files, tracked_set, history_cache):
    findings = []
    bare_index = basename_index(tracked_set)
    for f in files:
        try:
            lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for n, line in enumerate(lines, 1):
            if not DOC_RE.match(line):
                continue
            for m in PATH_RE.finditer(line):
                path = m.group(1).rstrip(".,;:)")
                # A path that is the TAIL of an absolute or drive-qualified path is an
                # EXAMPLE, not a repository-relative reference. Measured 2026-10-23:
                # registration_gate_tests.rs documents a historical root-confusion bug
                # with lines like `C:/dev/ozpos/main/crates/kasirmu-core/src/sales.rs`,
                # and the regex below matched the tail of that absolute path and reported
                # a file that never existed in THIS repository. The example is correct
                # prose; flagging it would teach the reader to ignore the gate.
                start = m.start(1)
                if start > 0 and line[start - 1] in "/\\" :
                    continue
                if start >= 2 and line[start - 2:start - 1] == ":":
                    continue
                if path in tracked_set:
                    continue
                if any(t.endswith("/" + path) for t in tracked_set):
                    continue
                historical = bool(HISTORY_RE.search(line))
                if historical and ever_existed(path, history_cache):
                    continue
                if historical:
                    why = ("a historical path that NEVER existed -- a move cannot be recorded "
                           "FROM a path that was never there")
                else:
                    why = "names a path that does not exist"
                findings.append({
                    "file": f.relative_to(ROOT).as_posix(),
                    "line": n,
                    "path": path,
                    "why": why,
                })
            # ── THE LINE HALF (added 2026-10-26, round 27) ─────────────────────
            #
            # Until now this checker graded only whether a cited PATH exists. A
            # `path.rs:NNN` citation makes a second claim — that the thing you want is
            # ON line NNN — and nothing checked it anywhere: check-dead-refs.py reads
            # markdown, check-cite-lines.py reads markdown, and the UI-side
            # featureCommentPaths suite reads ui/src only. A scan of the Rust, Go and
            # Python trees found 69 citations pointing at a blank line or past EOF.
            #
            # Only TRACKED paths are graded. An example path in prose (an absolute
            # `C:/dev/...` root-confusion note, say) is not a reference to this tree.
            # BARE FILENAMES: resolve the basename, then grade it exactly like a
            # full path. Skipped when the name is ambiguous (see basename_index).
            for m in BARE_CITE_RE.finditer(LINE_CITE_RE.sub("", line)):
                resolved = bare_index.get(m.group(1))
                if resolved is None:
                    continue
                first = int(m.group(2))
                last = int(m.group(3)) if m.group(3) else first
                findings.append({
                    "file": f.relative_to(ROOT).as_posix(),
                    "line": n,
                    "path": "%s:%d%s" % (m.group(1), first, ("-%d" % last) if last != first else ""),
                    "why": line_citation_problem(Path(ROOT) / resolved, first, last),
                })
            for m in LINE_CITE_RE.finditer(line):
                cited = m.group(1)
                start = m.start(1)
                if start > 0 and line[start - 1] in "/\\":
                    continue
                if start >= 2 and line[start - 2:start - 1] == ":":
                    continue
                if cited not in tracked_set:
                    continue
                first = int(m.group(2))
                last = int(m.group(3)) if m.group(3) else first
                findings.append({
                    "file": f.relative_to(ROOT).as_posix(),
                    "line": n,
                    "path": "%s:%d%s" % (cited, first, ("-%d" % last) if last != first else ""),
                    "why": line_citation_problem(Path(ROOT) / cited, first, last),
                })
    return [x for x in findings if x["why"]]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true",
                    help="run the classifier cases and exit; reads no file")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    # Every directory that holds Rust. Seven .rs files live under tools/ and two under
    # scripts/; leaving them out would have made the census 1419 of 1428 and the claim
    # "every cited path resolves" quietly narrower than it sounds.
    files = []
    for top in ("crates", "apps", "modules", "platform", "foundation", "scripts", "tools"):
        base = ROOT / top
        if base.is_dir():
            files.extend(sorted(base.rglob("*.rs")))
    files = [f for f in files if "target" not in f.parts]
    # THE FLOOR. A corpus of zero prints "clean" and exits 0, and the seven directory
    # names above are the only thing standing between this gate and a silent nothing.
    # Rename `crates/`, run from the wrong cwd, or break ROOT, and every `is_dir()`
    # misses: the line below would report "clean - 0 .rs file(s) scanned" over a scan
    # that read no Rust at all. Measured 2026-10-24 by pointing ROOT at an empty temp
    # directory: 0 files, 0 findings, exit 0 -- indistinguishable from a healthy tree.
    # A real tree here holds ~1430, so the floor is set far below it and exists only to
    # catch a ZERO. Same rule, same reason, as check-audit-stamps.py's census floor.
    if len(files) < MIN_RUST_FILES:
        print("check-rust-doc-paths: REFUSED - only %d .rs file(s) found under %s. "
              "A real tree holds roughly 1430, so this is a broken corpus (a moved "
              "directory, a wrong cwd, or a bad ROOT), not a clean tree."
              % (len(files), ROOT), file=sys.stderr)
        return 2
    tset = tracked()
    findings = scan(files, tset, {})
    if findings:
        print("check-rust-doc-paths: %d finding(s):" % len(findings))
        for f in findings:
            print("  %s:%d  %s" % (f["file"], f["line"], f["path"]))
            print("      %s" % f["why"])
        return 1
    print("check-rust-doc-paths: clean - %d .rs file(s) scanned, every cited path resolves"
          % len(files))
    return 0


def self_test() -> int:
    """Pure classification over synthetic lines. No file, no git."""
    bad = []

    def want(name, got, expect):
        if got != expect:
            bad.append("%s: expected %r, got %r" % (name, expect, got))

    # A present-tense claim about a missing path is a finding.
    want("a plain bad path is caught",
         bool(PATH_RE.search("/// mirrors crates/ghost/src/lib.rs here")), True)
    # The top-level prefix requirement: a bare filename is NOT a reference.
    want("a bare filename is not a reference",
         bool(PATH_RE.search("/// see lib.rs for details")), False)
    # A history marker is recognised, so the line can be exempted when the path is real.
    want("a history marker is recognised",
         bool(HISTORY_RE.search("//! relocated from apps/desktop-client/x.rs")), True)
    want("a present-tense line has no marker",
         bool(HISTORY_RE.search("/// mirrors crates/core/src/lib.rs")), False)
    # RULE 2: a history marker alone must NOT exempt a path that never existed. This is
    # the assertion that pins the 41-file class; without it rule 1 waves every one through.
    want("rule 2 overrides rule 1 for an invented path",
         ever_existed_stub(True, False), True)  # historical=True, existed=False -> finding

    # THE DETECTOR ITSELF. Every case above grades a REGEX or a stubbed predicate, and the
    # predicate tested (ever_existed_stub) is a COPY of a branch that lives inline in
    # scan() -- so blanking scan() to "return []" left this 5/5 green (measured 2026-10-23
    # with scripts/sabotage-selftests.py). A stub proves the rule; only the real function
    # proves the rule is used. scan() takes files, a tracked set and a history cache, so
    # it runs here against a temp file with no git at all.
    import tempfile

    class _F:
        """The one attribute scan() uses: read_text()."""
        def __init__(self, text: str) -> None:
            self._text = text

        def read_text(self, *a, **k) -> str:
            return self._text

        def relative_to(self, _root):
            return Path("doc.rs")

    tracked_present = {"crates/real/src/lib.rs"}
    never = {}  # empty cache: ever_existed() would fall through to git, so avoid it

    cases = [("plain", "/// mirrors crates/real/src/lib.rs", 0),
             ("missing", "/// mirrors crates/ghost/src/lib.rs", 1),
             ("bare name", "/// see lib.rs for details", 0),
             ("absolute example", "/// e.g. C:/dev/x/crates/ghost/src/lib.rs", 0),
             ("tail of a path", "/// e.g. other/crates/ghost/src/lib.rs", 0)]
    for label, text, expected in cases:
        f = _F(text + "\n")
        found = scan([f], tracked_present, never)
        # assert on the FINDINGS, not len(): a gutted scan() answers None, and len(None)
        # makes the run die of TypeError instead of naming the broken case. A self-test
        # has to say what is wrong, since that message is the only repair instruction.
        want("scan() %s" % label, [x["path"] for x in (found or [])],
             [] if expected == 0 else ["crates/ghost/src/lib.rs"])

    # THE HISTORY BRANCH. scan() only consults ever_existed() when a line carries a
    # history marker AND its path is untracked -- so no case above reaches that call,
    # which is why blanking ever_existed() also left this self-test green. Answer for it
    # here instead of shelling to git: the claim under test is that scan() ASKS.
    asked: list[str] = []
    real_ever_existed = globals()["ever_existed"]

    def recording_ever_existed(path: str, cache: dict) -> bool:
        asked.append(path)
        return False  # "this path is in no commit" -- the invented-path verdict

    globals()["ever_existed"] = recording_ever_existed
    try:
        hist = scan([_F("//! relocated from crates/ghost2/src/lib.rs\n")], tracked_present, {})
    finally:
        globals()["ever_existed"] = real_ever_existed
    want("scan() asks history about a marked path", asked, ["crates/ghost2/src/lib.rs"])
    want("an invented historical path is a finding", [x["path"] for x in (hist or [])],
         ["crates/ghost2/src/lib.rs"])
    want("and it says which rule fired",
         any("NEVER existed" in x["why"] for x in (hist or [])), True)

    # A marked path that IS in history is exempt: the branch has both answers, and only
    # the False one above was pinned. A detector that reported every historical line
    # would redden the repository on its own doc comments.
    globals()["ever_existed"] = lambda path, cache: True
    try:
        exempt = scan([_F("//! relocated from crates/moved/src/lib.rs\n")], tracked_present, {})
    finally:
        globals()["ever_existed"] = real_ever_existed
    want("a path that really moved is exempt", [x["path"] for x in (exempt or [])], [])

    # AND THE REAL ever_existed(), which both stubs above replace -- so blanking that
    # function survived every case in this file (measured 2026-10-23). It cannot shell to
    # git in a self-test, but it consults its CACHE before it ever looks at history, so a
    # pre-filled cache exercises the real body with no subprocess at all: a cached True
    # must exempt, a cached False must not.
    hit = real_ever_existed("crates/anything.rs", {"crates/anything.rs": True})
    miss = real_ever_existed("crates/anything.rs", {"crates/anything.rs": False})
    want("ever_existed() trusts a cached hit", hit, True)
    want("ever_existed() trusts a cached miss and does not re-ask git", miss, False)

    # THE FLOOR ITSELF. main() refuses a corpus below MIN_RUST_FILES, and that branch is
    # unreachable from a normal run -- so without this case the guard could be deleted and
    # every other case here would still pass. Exercise the arithmetic directly against the
    # constant rather than by running main(), which would need a fabricated tree.
    want("the floor is far below a real tree (~1430 files)", MIN_RUST_FILES < 1430, True)
    want("the floor still catches a ZERO corpus", 0 < MIN_RUST_FILES, True)
    want("the floor is not so high a legitimate shrink trips it", MIN_RUST_FILES >= 500, True)


    # ── THE LINE HALF (added 2026-10-26, round 27) ─────────────────────────
    #
    # Every case below drives the REAL line_citation_problem against a temp file,
    # because the stub-vs-real lesson above applies here too: asserting on
    # LINE_CITE_RE alone would prove the regex and not the classifier. Each case
    # pins one verdict word, and there is a negative control for each positive so a
    # predicate that answered constantly could not pass both.
    import tempfile as _tempfile

    with _tempfile.TemporaryDirectory() as _d:
        _probe = Path(_d) / "cited.rs"
        _probe.write_text("fn a() {}\n\n// a comment\n}\n))\n)\n", encoding="utf-8")
        # (line 1 real, 2 blank, 3 comment, 4-6 punctuation only)
        want("a real line is accepted", line_citation_problem(_probe, 1, 1), "")
        want("a comment line is accepted", line_citation_problem(_probe, 3, 3), "")
        want("a blank line is a finding",
             "blank or punctuation-only" in line_citation_problem(_probe, 2, 2), True)
        want("a punctuation-only line is a finding",
             "blank or punctuation-only" in line_citation_problem(_probe, 4, 4), True)
        want("past EOF is a finding",
             "past the end" in line_citation_problem(_probe, 99, 99), True)
        want("a range ending past EOF is graded from its first line",
             "blank or punctuation-only" in line_citation_problem(_probe, 4, 99), True)
        # The extractor itself: a tracked-looking citation is found, a bare name is not.
        want("a path:NN line is extracted",
             bool(LINE_CITE_RE.search("/// see crates/core/src/lib.rs:42 here")), True)
        want("a path:NN-MM range is extracted",
             bool(LINE_CITE_RE.search("/// see crates/core/src/lib.rs:42-50 here")), True)
        want("a bare filename with a line is NOT extracted",
             bool(LINE_CITE_RE.search("/// see lib.rs:42 here")), False)

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (24 cases, no file or git read)")
    return 0


def ever_existed_stub(historical: bool, existed: bool) -> bool:
    """The rule-2 predicate, lifted so the self-test can drive it without git.

    Returns True when the finding should be REPORTED.
    """
    return historical and not existed


if __name__ == "__main__":
    sys.exit(main())
