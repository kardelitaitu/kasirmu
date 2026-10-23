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

Exit 0 clean, 1 findings, 2 could not run.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

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


def scan(files, tracked_set, history_cache):
    findings = []
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
    return findings


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

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (15 cases, no file or git read)")
    return 0


def ever_existed_stub(historical: bool, existed: bool) -> bool:
    """The rule-2 predicate, lifted so the self-test can drive it without git.

    Returns True when the finding should be REPORTED.
    """
    return historical and not existed


if __name__ == "__main__":
    sys.exit(main())
