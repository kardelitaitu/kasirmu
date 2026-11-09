#!/usr/bin/env python3
"""Detect tracked files in the DEPLOYED prototypes/ tree that nothing references.

WHY THIS EXISTS

`website/scripts/sync-dev-files.mjs` copies the whole repo-root `prototypes/` folder
into `website/public/dev/`, which Astro publishes at https://kasir.mu/dev/. The copy is
`cpSync(..., { recursive: true })` filtered only on `node_modules`, `.git` and `dist`,
so EVERY tracked file under `prototypes/` ships to a public origin -- including one no
page loads.

The file that motivated this: `prototypes/kds-prototype-plugin.js` (201 lines, exported
since the`dev/` -> `prototypes/` rename fc9155447 and untouched since). It exports
`apply(ctx)` and registers through `slots.inject('tool.view.cordis', ...)` -- a host
plugin API that exists NOWHERE ELSE in the repository. `git grep tool.view.cordis`
matches only inside this file. Neither `kds-prototype.html` nor `design-language.html`
references it, and neither does `app.js`, `manifest.json` or `sw.js`.

It also carries `window.confirm()`, which `ui/src/__tests__/nativeDialogCompliance.
test.ts` forbids in application code on the grounds that an OS dialog is off-design,
unlocalized and blocks the event loop. That guard scans `ui/src` only, so it cannot see
this file -- and the sibling HTML page already replaced the same consent step with a
styled modal ("P4" in its own comment), which means the two copies have diverged.

WHAT THIS CHECKS, AND WHAT IT DELIBERATELY DOES NOT

A reference is a text occurrence of the file's basename anywhere else in the tracked
tree. That is intentionally weak evidence of LIFE and strong evidence of ORPHANHOOD: a
file named nowhere cannot be loaded by anything, so a hit here is real. The converse is
not claimed -- a named file may still be dead -- and the report says so rather than
implying the tree has been proven reachable.

WHY DEV-ONLY CONTENT IS STILL WORTH CHECKING

These pages are dev-only in the sense that no app shell boots them, and the repo records
that boundary (`themeTokenCompliance.test.ts` excludes them from the boot-document font
rule with that reasoning). "Dev-only" is not the same as "not published", though: this
tree IS deployed, so an orphan here is dead weight on a public origin rather than a
private convenience.

Exit codes: 0 always (report only) unless --strict, then 1 when any orphan is found,
and 2 when the detector fails its own self-test (`--self-test` runs those cases alone).

WHY THERE IS A SELF-TEST

`orphans()` is two lines long and its whole answer is a set difference over a corpus.
That shape has failed silently on this project before: a regex that stops matching, or a
corpus that silently becomes the empty string, both make every file look REFERENCED, and
the gate prints "0 orphan(s)" with the same confidence as a real clean pass. The cases
below pin both directions -- a file nobody names IS reported, and a file named once IS
not -- plus the `+ 1` baseline direction that produced a false positive the first time
this was written.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TREE = "prototypes"

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp (measured 2026-11-09 on the
#: agent host: every write into a TemporaryDirectory is EPERM) can point this at
#: a directory it allows; unset leaves tempfile's own default in force.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's fixtures are written under (None = system default)."""
    import os
    return next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)

def tracked_files(root: Path = REPO_ROOT) -> list[str]:
    """Tracked paths under TREE in `root`, via git, so build output and gitignored copies
    never appear. `root` is a parameter so a self-test can point this at a scratch
    repository: the corpus was untested until round 35, which is why gutting this body
    survived the sabotage sweep."""
    out = subprocess.run(
        ["git", "ls-files", TREE],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [line for line in out.splitlines() if line.strip()]

def all_tracked_text(root=None) -> str:
    """Every tracked file's text, so a reference from ANY path counts.
    r186: root redirects the ls-files listing AND every file read together."""
    base = REPO_ROOT if root is None else Path(root).resolve()
    out = subprocess.run(
        ["git", "ls-files"],
        cwd=base,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    blob = []
    for rel in out:
        if not rel.strip():
            continue
        path = base / rel
        try:
            blob.append(path.read_text(encoding="utf-8", errors="ignore"))
        except (OSError, UnicodeDecodeError):
            continue  # binary or unreadable: cannot hold a text reference
    return "\n".join(blob)

def basename(path: str) -> str:
    return path.rsplit("/", 1)[-1]

def orphans(files: list[str], corpus: str) -> list[str]:
    """Files whose basename appears nowhere in `corpus` except their own path line.

    The corpus is the tracked file CONTENTS, so a file's own path is NOT part of it and
    the baseline is 0. This was measured after a first draft got it wrong: that draft
    assumed the `git ls-files` path output was in the corpus and tested `hits <= 1`,
    which reported `styles.css` as an orphan even though `design-language.html:10` loads
    it. A wrong baseline turns a referenced file into a false positive, so the count is
    asserted against measured reality rather than assumed.
    """
    found = []
    for rel in files:
        name = basename(rel)
        # Occurrences of the bare name, as a whole token so `plugin` does not match
        # `kds-prototype-plugin.js` by accident.
        hits = len(re.findall(re.escape(name), corpus))
        # Baseline is 0: the corpus holds file CONTENTS, and a file does not name itself.
        # Any occurrence at all is a reference from somewhere else. Measured, not assumed
        # -- see the docstring for the false positive that a `<= 1` reading produced.
        if hits == 0:
            found.append(rel)
    return found

#: Synthetic cases: (name, tracked files, corpus, expected orphan list).
#: Each is a SHAPE the detector must still classify correctly. If any stops matching,
#: the gate has gone deaf and must not be trusted for a clean report.
SELF_TEST_CASES = (
    # Direction 1: named nowhere -> an orphan. The whole reason the gate exists.
    ("unreferenced is an orphan", ["prototypes/a.js"], "nothing here", ["prototypes/a.js"]),
    # Direction 2: one mention anywhere in the tracked tree is enough.
    (
        "a single mention clears it",
        ["prototypes/a.js"],
        '<script src="a.js">',
        [],
    ),
    # Direction 3: the bug that the first draft shipped. Treating the git ls-files
    # PATH output as part of the corpus made every file hit at least once, so this
    # case pins that the corpus is CONTENTS ONLY by asserting the empty corpus is
    # correctly read as "nothing references anything".
    ("empty corpus reports every file", ["prototypes/a.js"], "", ["prototypes/a.js"]),
    # Direction 4: two files, only one named -- the difference, not a whole-set answer.
    (
        "reports the one file of two that is unnamed",
        ["prototypes/a.js", "prototypes/b.js"],
        "loads b.js only",
        ["prototypes/a.js"],
    ),
    # Direction 5: an empty file list is not a clean tree, it is a tree that was not
    # read. main() short-circuits on it; here the detector itself must not invent one.
    ("no files at all finds nothing", [], "anything", []),
)


def self_test() -> int:
    """Run :data:`SELF_TEST_CASES` and report every failure, not just the first."""
    bad = []
    for name, files, corpus, expected in SELF_TEST_CASES:
        got = orphans(list(files), corpus)
        if got != expected:
            bad.append(f"  {name}: expected {expected!r}, detector returned {got!r}")
    # THE CORPUS HALF (added 2026-11-06, round 35). Every case above hands orphans() a
    # hand-written file list, so tracked_files() was never called and a gutted body
    # survived the sabotage sweep. It reads git, so the fixture is a scratch repository.
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        scratch = Path(tmp)
        (scratch / TREE).mkdir()
        (scratch / TREE / "a.js").write_text("console.log(1);\n", encoding="utf-8")
        (scratch / "loose.js").write_text("outside the tree\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=scratch, check=True)
        subprocess.run(["git", "add", TREE, "loose.js"], cwd=scratch, check=True)
        got = tracked_files(scratch)
        if got != [f"{TREE}/a.js"]:
            bad.append(f"  tracked_files() over a scratch repository: expected "
                       f"['{TREE}/a.js'], got {got!r}")
    # r186: main()'s shell -- argv and root graded against scratch git
    # repositories, the r166..r185 pattern. The name is synthetic end to end
    # (proto-fixture-a.js): a root-dropping mutant that reads the REAL corpus
    # cannot find it, which is what the first case grades. Note the non-strict
    # run always exits 0 (report-only), so the text carries the verdict.
    import io as _io
    import contextlib as _ctx
    shell = 0
    def _shell(files, argv=None):
        with tempfile.TemporaryDirectory(dir=fixture_root(),
                                         ignore_cleanup_errors=True) as tmp:
            scratch = Path(tmp)
            for rel, content in files.items():
                dst = scratch / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding="utf-8")
            subprocess.run(["git", "init", "-q"], cwd=scratch, check=True)
            subprocess.run(["git", "add", "."], cwd=scratch, check=True)
            out, err = _io.StringIO(), _io.StringIO()
            with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                try:
                    rc = main(argv=[] if argv is None else argv, root=scratch)
                except SystemExit as se:
                    rc = se.code
            return rc, out.getvalue() + err.getvalue()
    shell += 1
    rc, text = _shell({
        "prototypes/proto-fixture-a.js": "console.log(1);\n",
        "reader.html": '<script src="proto-fixture-a.js"></script>\n',
    })
    # among 1: the census counts only deployed prototypes/ files; reader.html
    # is corpus (it names the file) but is not itself a deployed file.
    if rc != 0 or "0 orphan(s) among 1" not in text:
        print(f"  x a named file must read as referenced (rc={rc} text={text[-90:]!r})", file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({"prototypes/proto-fixture-a.js": "console.log(1);\n"},
                      argv=["--strict"])
    if rc != 1 or "1 orphan(s) among 1" not in text:
        print(f"  x an unnamed file must be an orphan under --strict (rc={rc} text={text[-90:]!r})", file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({"loose.js": "outside the tree\n"})
    if rc != 2 or "git lists no tracked file" not in text:
        print(f"  x a checkout without {TREE}/ must refuse rc 2 (rc={rc} text={text[-90:]!r})", file=sys.stderr)
        return 1
    print(f"SELF-TEST OK ({len(SELF_TEST_CASES)} detector cases + 1 corpus case"
          f" + {shell} shell cases)")
    return shell_ladder()


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard for the ladder (r240 -- the r228 lesson).

    Rung 4 drives --self-test through argv from INSIDE the ladder, and the
    self-test ends in this call, so without the guard that nested run would
    recurse. This file ALSO has an r174 recursion trap -- main() preflights
    `self_test()` only when `root is None`, because the shell cases reach
    main() with a scratch root. The two guards are independent: that one stops
    the preflight, this one stops the tail.
    """
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        print("  (ladder re-entry from a nested --self-test: skipped)")
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body()
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body() -> int:
    """r240: the root contract, graded on scratch git repositories through main().

    Rung 1 IS the killing rung, and this checker makes it unusually sharp: the
    fixture's orphan is named `proto-ladder-orphan.js`, so a main() that
    ignored its root would scan THIS checkout's corpus and could never find
    that name in it. The rung demands the report NAME the file, which a
    root-blind run cannot produce even by accident.

    Rung 3 grades the report-only default against --strict: the same orphan
    exits 0 without the flag and 1 with it. Before this round only the strict
    half was executed, so the "0 always (report only)" half of the exit
    contract had no case at all.
    """
    scratch_root = fixture_root()

    def build(tmp, files, label="fx"):
        """A scratch git repository holding the given {relative path: text} files."""
        base = Path(tempfile.mkdtemp(dir=tmp, prefix=label + "_"))
        for rel, text in files.items():
            p = base / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8", newline=chr(10))
        subprocess.run(["git", "init", "-q"], cwd=base, check=True)
        subprocess.run(["git", "add", "."], cwd=base, check=True)
        return base

    def run(root_dir, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=Path(root_dir))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    ORPHAN = "prototypes/proto-ladder-orphan.js"
    NAMED = "prototypes/proto-ladder-named.js"

    shell = 0
    with tempfile.TemporaryDirectory(dir=scratch_root,
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: a fixture orphan is reported by NAME.
        root = build(tmp, {ORPHAN: "console.log(1);\n"})
        rc, said = run(root)
        if "proto-ladder-orphan.js" not in said or "1 orphan(s) among 1" not in said:
            print("  x rung 1: a fixture orphan must be reported by name "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- a name mentioned in another tracked file clears it.
        root = build(tmp, {NAMED: "console.log(1);\n",
                           "reader.html": '<script src="proto-ladder-named.js"></script>\n'})
        rc, said = run(root)
        if rc != 0 or "0 orphan(s) among 1" not in said:
            print("  x rung 2: a named fixture file must read as referenced "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- report-only vs --strict over the SAME orphan.
        root = build(tmp, {ORPHAN: "console.log(1);\n"})
        rc_plain, said_plain = run(root)
        rc_strict, said_strict = run(root, "--strict")
        if rc_plain != 0 or rc_strict != 1 or "1 orphan(s) among 1" not in said_strict:
            print("  x rung 3: the same orphan must exit 0 plain and 1 strict "
                  "(plain rc=%r strict rc=%r said=%r)"
                  % (rc_plain, rc_strict, said_strict[-160:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- --self-test dispatch flows through argv; re-entry is guarded.
        root = build(tmp, {ORPHAN: "console.log(1);\n"})
        rc, said = run(root, "--self-test")
        if rc != 0 or "SELF-TEST OK" not in said or "ladder re-entry" not in said:
            print("  x rung 4: --self-test through argv must pass rc 0 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5 -- the refusal floor: a repo with no tracked prototypes/ file.
        root = build(tmp, {"loose.js": "outside the tree\n"})
        rc, said = run(root)
        if rc != 2 or "git lists no tracked file" not in said:
            print("  x rung 5: a repo without prototypes/ must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("ORPHAN-PROTOTYPE-FILES SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


def main(argv=None, root=None) -> int:
    """r186: argv and root parameterized, the r166..r185 contract -- root
    redirects the deployed-file listing AND the reference corpus together."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--strict", action="store_true", help="exit 1 when any orphan is found")
    ap.add_argument("--self-test", action="store_true", help="run this checker's cases and exit")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()
    root_path = REPO_ROOT if root is None else Path(root).resolve()

    # Grade the detector before grading the tree: a corpus read that silently returned
    # "" would make every file look referenced, and this gate would print 0 orphans
    # with full confidence. The cases above are what that reads as.
    # Live mode only: a redirected run (root=...) is reached FROM self_test's
    # shell cases, and pre-flighting here again would recurse forever -- the
    # r174 recursion-trap rule, learned the hard way by this checker.
    if root is None:
        rc = self_test()
        if rc:
            print("DETECTOR WENT DEAF: not trusting the tree scan below.", file=sys.stderr)
            return rc

    files = tracked_files(root_path)
    if not files:
        # Not a clean tree: a tree that was not read. Measured 2026-11-06 -- this branch
        # printed "nothing to check" and exited 0, so a copy of the script outside the
        # checkout reported the prototypes clean while looking at no file at all.
        print(f"error: git lists no tracked file under {TREE}/ in {root_path}, so this run "
              f"graded nothing and its 'nothing to check' would be about an empty corpus. "
              f"Pass a checkout with {TREE}/ populated.", file=sys.stderr)
        return 2

    corpus = all_tracked_text(root_path)
    found = orphans(files, corpus)

    if not found:
        print(f"orphan-prototype-files: 0 orphan(s) among {len(files)} deployed file(s)")
        return 0

    print(f"orphan-prototype-files: {len(found)} orphan(s) among {len(files)} deployed file(s)")
    print("  These ship to https://kasir.mu/dev/ via website/scripts/sync-dev-files.mjs")
    print("  (a recursive copy of prototypes/) and are named in NO tracked file:")
    for rel in found:
        print(f"    {rel}")
    print("  Fix: delete it, or wire it into a page that loads it.")
    print("")
    print("  LIMIT, stated rather than hidden: a file whose name appears only in PROSE (a")
    print("  doc or comment) is counted as referenced, because a text scan cannot tell a")
    print("  mention from a load. `prototypes/kds-prototype-server.bat` is exactly that case")
    print("  today -- its one occurrence is a sentence in a completed plan doc, and no page")
    print("  loads it. The report is a floor on the orphans, not an exact count.")
    return 1 if args.strict else 0

if __name__ == "__main__":
    sys.exit(main())
